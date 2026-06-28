/**
 * OpenAI Responses API Protocol Handler
 *
 * Codex CLI uses OpenAI Responses API format. This handler converts
 * Responses API requests to Chat Completions for upstream providers,
 * then converts back. Supports streaming (SSE) bridge.
 */

import { log } from "../logger.mjs";
import { UPSTREAM, CONFIG_PROXY } from "../config.mjs";
import { isQuotaError } from "./openai-chat.mjs";
import { proxyRequest } from "./proxy-helper.mjs";

/**
 * Handle an OpenAI Responses API request by converting to Chat Completions
 * and proxying to the upstream provider.
 */
export async function handleResponses(ctx, req, body) {
  const { res, provider, clientId } = ctx;
  const model = provider.modelId || body.model;
  const timeout = ctx.timeout || UPSTREAM.upstreamTimeout;
  const isStreaming = body.stream === true;

  // ── Image handling ──
  // Multimodal models (sensenova-6.7-flash-lite etc.) handle images natively — skip vision preprocessing.
  // For non-multimodal models, use separate vision model to describe images.
  // In BOTH cases: check image size first — if any image is too large, use placeholder.
  let processedBody = body;
  if (body.input && Array.isArray(body.input) && hasInputImages(body.input)) {
    // Check image sizes — if any is too large, skip to placeholder immediately
    const tooLarge = hasOversizedImage(body.input);
    if (tooLarge) {
      log.warn("[vision] image too large (" + tooLarge.len + " bytes base64), using placeholder to avoid 400");
      processedBody = replaceImagesWithPlaceholder(JSON.parse(JSON.stringify(body)));
    } else {
      const isMultimodal = MULTIMODAL_MODELS.some(m => model.includes(m));
      if (isMultimodal) {
        log.info("[vision] model " + model + " is multimodal, passing images through directly");
      } else {
        processedBody = await describeImagesWithVision(body);
      }
    }
  }

  // Convert Responses API -> Chat Completions
  const chatBody = responsesToChat(processedBody, model);

  // Build upstream URL
  const base = provider.base.replace(/\/+$/, "");
  const upstreamUrl = base + "/chat/completions";
  const authHeader = "Bearer " + provider.key;

  // Serialize once, reuse: for 200+ message requests this is expensive
  const upstreamBodyStr = JSON.stringify(chatBody);

  // Log body size only (minimal overhead)
  var _nTools = chatBody.tools ? chatBody.tools.length : 0;
  var _nMsgs = chatBody.messages ? chatBody.messages.length : 0;
  log.info("[responses] sending to " + provider.name + " model=" + model + " stream=" + isStreaming + " bodySize=" + upstreamBodyStr.length + " tools=" + _nTools + " msgs=" + _nMsgs);

  // Fire-and-forget: log large body sample after request starts (non-blocking)
  if (upstreamBodyStr.length > 100000) {
    // Schedule sample log after send, don't hold up the request
    setImmediate(function() {
      log.info("[responses] large body sample: " + upstreamBodyStr.substring(0, 500));
    });
  }

  const upstreamHeaders = {
    "Content-Type": "application/json",
    Authorization: authHeader,
    Accept: isStreaming ? "text/event-stream" : "application/json",
  };

  try {
    // Use native request to bypass undici proxy issues
    const upstreamRes = await nativeRequest(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: upstreamBodyStr,
      timeout,
    });

    if (!isStreaming) {
      const chunks = [];
      for await (const chunk of upstreamRes) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      let data;
      try { data = JSON.parse(raw); } catch(e) { data = { error: raw.substring(0, 200) }; }
      if ((!upstreamRes.statusCode || upstreamRes.statusCode >= 400) || (data && data.error)) {
        // Return error to server.mjs for sanitized handling and fallback logic
        return { error: true, status: upstreamRes.statusCode || 502, data };
      }

      // Convert Chat Completions -> Responses API
      const responsesData = chatToResponses(data, model);
      log.debug("[responses] non-streaming output items=" + (responsesData.output ? responsesData.output.length : 0) + " contentLen=" + ((responsesData.output && responsesData.output[0] && responsesData.output[0].content) ? (responsesData.output[0].content[0] ? responsesData.output[0].content[0].text.length : 0) : 0));
      sendJson(res, 200, responsesData);
      return { error: false, data: data, tokens: extractTokens(data) };
    }

    // Streaming: bridge SSE events in OpenAI Responses API format
    const decoder = new TextDecoder();

    // Check upstream status code BEFORE entering streaming loop
    if (upstreamRes.statusCode && upstreamRes.statusCode >= 400) {
      // Read the error body and return it for fallback handling
      const errChunks = [];
      for await (const ec of upstreamRes) errChunks.push(ec);
      const errRaw = Buffer.concat(errChunks).toString();
      let errData;
      try { errData = JSON.parse(errRaw); } catch(e) { errData = { error: errRaw.substring(0, 200) }; }
      log.warn("[responses] upstream error status=" + upstreamRes.statusCode + " body=" + errRaw.substring(0, 300));

      // For streaming requests, send SSE error events before returning
      // so CODEX CLI gets a proper event instead of raw JSON
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const errorMsg = (errData && errData.error && errData.error.message) ? errData.error.message : "service temporarily unavailable";
      // Send graceful completion instead of response.failed to prevent CODEX reconnect loops
      var _errRespId = "resp_" + Date.now();
      var _errCreated = Math.floor(Date.now() / 1000);
      // 1) response.created
      res.write("event: response.created\ndata: " + JSON.stringify({ type: "response.created", response: { id: _errRespId, object: "response", model: model, created: _errCreated, status: "in_progress", output: [] } }) + "\n\n");
      // 2) response.in_progress
      res.write("event: response.in_progress\ndata: " + JSON.stringify({ type: "response.in_progress", response: { id: _errRespId, object: "response", model: model, created: _errCreated, status: "in_progress", output: [] } }) + "\n\n");
      // 3) response.completed (no output, no error - clean completion so CODEX doesn't reconnect)
      res.write("event: response.completed\ndata: " + JSON.stringify({
        type: "response.completed",
        response: {
          id: _errRespId, object: "response", model: model, created: _errCreated,
          status: "completed",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "", annotations: [] }] }],
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
        }
      }) + "\n\n");
      try { res.end(); } catch {}
      return { error: true, status: upstreamRes.statusCode, data: errData, isStreamingError: true };
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Build a stable response ID for the whole stream
    const responseId = "resp_" + Date.now();
    const created = Math.floor(Date.now() / 1000);

    // Streaming state
    let bufferParts = [];
    let bufferStr = "";
    let lastUsage = null;
    let outputTextLen = 0;
    let itemId = null;
    let hasStarted = false;
    let accumulatedContent = "";
    let finished = false;
    let wasToolCall = false; // track whether current item is a tool call
    let toolCallResults = []; // accumulated tool calls for response.completed output
    let outputIndex = 0; // output_index for Responses API streaming events

    // Reasoning state (for reasoning_content from upstream)
    let reasoningAccumulated = "";
    let hasReasoningStarted = false;
    let reasoningItemId = null;
    let hasReasoningEmittedDone = false; // track if reasoning content_part.done was sent

    // 1) response.created
    res.write("event: response.created\ndata: " + JSON.stringify({
      type: "response.created",
      response: {
        id: responseId, object: "response", model: model,
        created: created, status: "in_progress", output: []
      }
    }) + "\n\n");

    // 2) response.in_progress
    res.write("event: response.in_progress\ndata: " + JSON.stringify({
      type: "response.in_progress",
      response: {
        id: responseId, object: "response", model: model,
        created: created, status: "in_progress", output: []
      }
    }) + "\n\n");

    // Process upstream SSE stream - with safety limits and idle timeout
    const SS_STREAM_IDLE_TIMEOUT = 15000; // 15秒空闲超时
    const timeoutIterator2 = {
      [Symbol.asyncIterator]() {
        const it = upstreamRes[Symbol.asyncIterator]();
        return {
          async next() {
            const result = await Promise.race([
              it.next(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`stream idle timeout (${SS_STREAM_IDLE_TIMEOUT}ms)`)), SS_STREAM_IDLE_TIMEOUT)
              ),
            ]);
            return result;
          },
        };
      },
    };
    let rawChunkCount = 0;
    const MAX_BUFFER = 1024 * 1024; // 1MB max buffered data
    for await (const rawChunk of timeoutIterator2) {
      rawChunkCount++;
      const chunkStr = decoder.decode(rawChunk, { stream: true });
      // Log first few raw chunks for debugging
      if (rawChunkCount <= 3) {
        log.debug("[responses] raw chunk #" + rawChunkCount + ": " + chunkStr.substring(0, 200).replace(/\n/g, "\\n"));
      }
      bufferParts.push(chunkStr);
      bufferStr = bufferParts.join('');
      // Safety: prevent OOM from malformed SSE (no newlines)
      if (bufferStr.length > MAX_BUFFER) {
        log.warn("[responses] buffer exceeded 1MB, resetting");
        bufferStr = bufferStr.substring(bufferStr.length - 4096); // Keep last 4KB
        bufferParts = [bufferStr];
      }
      const lines = bufferStr.split("\n");
      bufferParts = [lines.pop() || ""];

      // Cork for batch write efficiency
      try { res.cork(); } catch (e) {}
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        try {
          const chunk = JSON.parse(jsonStr);

          // Capture usage from final upstream SSE events
          if (chunk.usage && chunk.usage.total_tokens) {
            lastUsage = chunk.usage;
          }

          const choice = (chunk.choices || [])[0] || {};
          const delta = choice.delta || {};
          const finishReason = choice.finish_reason;

          // Handle reasoning content (thinking) from upstream providers
          // Providers like DeepSeek/商汤 send reasoning_content in delta
          const reasoningDelta = (delta.reasoning_content || delta.reasoning || "")
            .replace(/<\/?think>/gi, '').replace(/<\/?response>/gi, '').trim();
          const textDelta = delta.content || "";

          // Handle reasoning content streaming first
          if (reasoningDelta) {
            reasoningAccumulated += reasoningDelta;
            outputTextLen += reasoningDelta.length;

            if (!hasReasoningStarted) {
              hasReasoningStarted = true;
              reasoningItemId = "reason_" + responseId;
              // Reasoning is first output item (before message content)
              outputIndex = 0;
              // response.output_item.added for reasoning
              res.write("event: response.output_item.added\ndata: " + JSON.stringify({
                type: "response.output_item.added",
                output_index: outputIndex,
                item: { id: reasoningItemId, type: "reasoning", role: "assistant", content: [] }
              }) + "\n\n");
              // response.content_part.added for reasoning
              res.write("event: response.content_part.added\ndata: " + JSON.stringify({
                type: "response.content_part.added",
                output_index: outputIndex,
                content_index: 0,
                part: { type: "output_text", text: "" },
                item_id: reasoningItemId
              }) + "\n\n");
            }

            // response.output_text.delta for reasoning content
            res.write("event: response.output_text.delta\ndata: " + JSON.stringify({
              type: "response.output_text.delta",
              output_index: outputIndex,
              content_index: 0,
              delta: reasoningDelta,
              item_id: reasoningItemId
            }) + "\n\n");
          }

          // Emit reasoning content_part.done + output_item.done when content arrives
          // (reasoning always comes before content in upstream streams)
          if (textDelta && hasReasoningStarted && !hasReasoningEmittedDone) {
            hasReasoningEmittedDone = true;
            // Complete reasoning output_text
            res.write("event: response.output_text.done\ndata: " + JSON.stringify({
              type: "response.output_text.done",
              output_index: outputIndex,
              content_index: 0,
              item_id: reasoningItemId
            }) + "\n\n");
            // Complete reasoning content_part
            res.write("event: response.content_part.done\ndata: " + JSON.stringify({
              type: "response.content_part.done",
              output_index: outputIndex,
              content_index: 0,
              part: { type: "output_text", text: reasoningAccumulated },
              item_id: reasoningItemId
            }) + "\n\n");
            // Complete reasoning output_item
            res.write("event: response.output_item.done\ndata: " + JSON.stringify({
              type: "response.output_item.done",
              output_index: outputIndex,
              item: {
                id: reasoningItemId, type: "reasoning", role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: reasoningAccumulated }]
              }
            }) + "\n\n");
          }

          // Handle text content delta (the actual response)
          if (textDelta) {
            // Fast path: only strip tags if the chunk contains angle brackets
            var cleanDelta = textDelta;
            if (textDelta.indexOf('<') >= 0) {
              cleanDelta = textDelta.replace(/<\/?think>/gi, '').replace(/<\/?response>/gi, '');
            }
            outputTextLen += cleanDelta.length;
            accumulatedContent += cleanDelta;

            // If reasoning started, content gets output_index=1
            // Otherwise content gets output_index=0
            if (!hasStarted) {
              hasStarted = true;
              itemId = "msg_" + responseId;
              outputIndex = hasReasoningStarted ? 1 : 0;
              // response.output_item.added for message
              res.write("event: response.output_item.added\ndata: " + JSON.stringify({
                type: "response.output_item.added",
                output_index: outputIndex,
                item: { id: itemId, type: "message", role: "assistant", content: [] }
              }) + "\n\n");
              // response.content_part.added for message
              res.write("event: response.content_part.added\ndata: " + JSON.stringify({
                type: "response.content_part.added",
                output_index: outputIndex,
                content_index: 0,
                part: { type: "output_text", text: "" },
                item_id: itemId
              }) + "\n\n");
            }

            // response.output_text.delta for message content
            res.write("event: response.output_text.delta\ndata: " + JSON.stringify({
              type: "response.output_text.delta",
              output_index: outputIndex,
              content_index: 0,
              delta: cleanDelta,
              item_id: itemId
            }) + "\n\n");
          }

          // Handle tool calls (may appear after or before content in stream)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!hasStarted) {
                // First item: create function_call
                hasStarted = true;
                wasToolCall = true;
                itemId = tc.id || "call_" + responseId;
                outputIndex = hasReasoningStarted ? 1 : 0;
                res.write("event: response.output_item.added\ndata: " + JSON.stringify({
                  type: "response.output_item.added",
                  output_index: outputIndex,
                  item: {
                    id: itemId,
                    type: "function_call",
                    call_id: itemId,
                    name: tc.function?.name || "",
                    arguments: "",
                    status: "in_progress",
                  }
                }) + "\n\n");
                toolCallResults.push({
                  type: "function_call",
                  call_id: itemId,
                  name: tc.function?.name || "",
                  arguments: "",
                  status: "completed",
                });
              } else if (!wasToolCall && accumulatedContent.trim()) {
                // Text was streamed first, now tool calls arrived.
                // Close the text item properly before starting function_call
                wasToolCall = true;
                // Close previously streamed text item
                res.write("event: response.output_text.done\ndata: " + JSON.stringify({
                  type: "response.output_text.done", output_index: outputIndex,
                  content_index: 0, item_id: itemId
                }) + "\n\n");
                res.write("event: response.content_part.done\ndata: " + JSON.stringify({
                  type: "response.content_part.done", output_index: outputIndex,
                  content_index: 0,
                  part: { type: "output_text", text: accumulatedContent },
                  item_id: itemId
                }) + "\n\n");
                res.write("event: response.output_item.done\ndata: " + JSON.stringify({
                  type: "response.output_item.done", output_index: outputIndex,
                  item: {
                    id: itemId, type: "message", role: "assistant",
                    status: "completed",
                    content: [{ type: "output_text", text: accumulatedContent, annotations: [] }]
                  }
                }) + "\n\n");
                // Now create the function_call item
                itemId = tc.id || "call_" + responseId;
                outputIndex = hasReasoningStarted ? 1 : 0;
                res.write("event: response.output_item.added\ndata: " + JSON.stringify({
                  type: "response.output_item.added",
                  output_index: outputIndex,
                  item: {
                    id: itemId, type: "function_call",
                    call_id: itemId,
                    name: tc.function?.name || "",
                    arguments: "", status: "in_progress",
                  }
                }) + "\n\n");
                toolCallResults.push({
                  type: "function_call",
                  call_id: itemId,
                  name: tc.function?.name || "",
                  arguments: "",
                  status: "completed",
                });
              }
              // Stream arguments deltas
              const argsDelta = tc.function?.arguments || "";
              if (argsDelta) {
                res.write("event: response.function_call_arguments.delta\ndata: " + JSON.stringify({
                  type: "response.function_call_arguments.delta",
                  output_index: outputIndex,
                  call_id: itemId,
                  delta: argsDelta,
                }) + "\n\n");
                if (toolCallResults.length > 0) {
                  toolCallResults[toolCallResults.length - 1].arguments += argsDelta;
                }
              }
            }
          }

          // Handle finish (stop, length, etc.)
          if (finishReason && (hasStarted || hasReasoningStarted) && !finished) {
            finished = true;

            // If reasoning was started but not yet completed, complete it now
            if (hasReasoningStarted && !hasReasoningEmittedDone) {
              hasReasoningEmittedDone = true;
              outputIndex = 0;
              res.write("event: response.output_text.done\ndata: " + JSON.stringify({
                type: "response.output_text.done",
                output_index: outputIndex,
                content_index: 0,
                item_id: reasoningItemId
              }) + "\n\n");
              res.write("event: response.content_part.done\ndata: " + JSON.stringify({
                type: "response.content_part.done",
                output_index: outputIndex,
                content_index: 0,
                part: { type: "output_text", text: reasoningAccumulated },
                item_id: reasoningItemId
              }) + "\n\n");
              res.write("event: response.output_item.done\ndata: " + JSON.stringify({
                type: "response.output_item.done",
                output_index: outputIndex,
                item: {
                  id: reasoningItemId, type: "reasoning", role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text: reasoningAccumulated }]
                }
              }) + "\n\n");
            }

            if (wasToolCall) {
              // 6) response.function_call_arguments.done for tool call
              res.write("event: response.function_call_arguments.done\ndata: " + JSON.stringify({
                type: "response.function_call_arguments.done",
                output_index: outputIndex,
                call_id: itemId
              }) + "\n\n");
              // 7) response.output_item.done for function_call
              const lastTc = toolCallResults.length > 0 ? toolCallResults[toolCallResults.length - 1] : null;
              res.write("event: response.output_item.done\ndata: " + JSON.stringify({
                type: "response.output_item.done",
                output_index: outputIndex,
                item: lastTc ? {
                  id: lastTc.call_id || itemId,
                  type: "function_call",
                  call_id: lastTc.call_id || itemId,
                  name: lastTc.name || "",
                  arguments: lastTc.arguments || "",
                  status: "completed"
                } : {
                  id: itemId, type: "function_call",
                  call_id: itemId, name: "", arguments: "", status: "completed"
                }
              }) + "\n\n");
            } else {
              // 6) response.output_text.done
              res.write("event: response.output_text.done\ndata: " + JSON.stringify({
                type: "response.output_text.done",
                output_index: outputIndex,
                content_index: 0,
                item_id: itemId
              }) + "\n\n");
              // 7) response.output_item.done
              res.write("event: response.output_item.done\ndata: " + JSON.stringify({
                type: "response.output_item.done",
                output_index: outputIndex,
                item: {
                  id: itemId, type: "message", role: "assistant",
                  content: [{ type: "output_text", text: accumulatedContent }]
                }
              }) + "\n\n");
            }
          }
        } catch {
          // Skip malformed chunks
        }
      }
      try { res.uncork(); } catch (e) {}
    }

    // Safety net: if upstream never sent finish_reason, emit completion events now
    // Handle reasoning first, then content
    if ((hasReasoningStarted && !hasReasoningEmittedDone) || (hasStarted && !finished)) {
      // Complete unfinished reasoning
      if (hasReasoningStarted && !hasReasoningEmittedDone) {
        hasReasoningEmittedDone = true;
        outputIndex = 0;
        res.write("event: response.output_text.done\ndata: " + JSON.stringify({
          type: "response.output_text.done",
          output_index: outputIndex,
          content_index: 0,
          item_id: reasoningItemId
        }) + "\n\n");
        res.write("event: response.content_part.done\ndata: " + JSON.stringify({
          type: "response.content_part.done",
          output_index: outputIndex,
          content_index: 0,
          part: { type: "output_text", text: reasoningAccumulated },
          item_id: reasoningItemId
        }) + "\n\n");
        res.write("event: response.output_item.done\ndata: " + JSON.stringify({
          type: "response.output_item.done",
          output_index: outputIndex,
          item: {
            id: reasoningItemId, type: "reasoning", role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: reasoningAccumulated }]
          }
        }) + "\n\n");
      }

      // Complete unfinished content
      if (hasStarted && !finished) {
        if (wasToolCall) {
          res.write("event: response.function_call_arguments.done\ndata: " + JSON.stringify({
            type: "response.function_call_arguments.done",
            output_index: outputIndex,
            call_id: itemId
          }) + "\n\n");
          res.write("event: response.output_item.done\ndata: " + JSON.stringify({
            type: "response.output_item.done",
            output_index: outputIndex,
            item: (toolCallResults.length > 0) ? {
              id: toolCallResults[toolCallResults.length - 1].call_id || itemId,
              type: "function_call",
              call_id: toolCallResults[toolCallResults.length - 1].call_id || itemId,
              name: toolCallResults[toolCallResults.length - 1].name || "",
              arguments: toolCallResults[toolCallResults.length - 1].arguments || "",
              status: "completed"
            } : {
              id: itemId, type: "function_call",
              call_id: itemId, name: "", arguments: "", status: "completed"
            }
          }) + "\n\n");
        } else {
          res.write("event: response.output_text.done\ndata: " + JSON.stringify({
            type: "response.output_text.done",
            output_index: outputIndex,
            content_index: 0,
            item_id: itemId
          }) + "\n\n");
          res.write("event: response.output_item.done\ndata: " + JSON.stringify({
            type: "response.output_item.done",
            output_index: outputIndex,
            item: {
              id: itemId, type: "message", role: "assistant",
              content: [{ type: "output_text", text: accumulatedContent }]
            }
          }) + "\n\n");
        }
      }
    }

    // Fallback: estimate usage from text length if upstream didn't provide it
    if (!lastUsage && outputTextLen > 0) {
      const estimated = Math.max(1, Math.round(outputTextLen / 2));
      lastUsage = { prompt_tokens: 0, completion_tokens: estimated, total_tokens: estimated };
    }

    // 8) response.completed (CRITICAL: this is what CODEX CLI waits for)
    // Always send status="completed" - the stream itself is complete even if empty
    // Build output array with all completed items (reasoning + text + tool calls)
    const completedOutput = [];
    if (reasoningAccumulated.trim()) {
      completedOutput.push({
        id: reasoningItemId || ("reason_" + responseId),
        type: "reasoning",
        status: "completed",
        content: [{ type: "output_text", text: reasoningAccumulated.trim() }]
      });
    }

    // Detect if accumulated text is actually a tool call (upstream returned XML text)
    const ac = accumulatedContent.trim();
    let extractedToolCalls = null;
    if (ac && !wasToolCall) {
      const result = tryExtractToolCall(ac);
      if (result && Array.isArray(result) && result.length > 0) {
        extractedToolCalls = result;
      }
    }

    // ── 自适应文本格式化 ──
    // 对扁平文本自动补充分段标记，不干扰 deepseek 已有格式
    // 注意：不要在 extractedToolCalls 之前做格式化（会破坏 XML 工具调用检测）
    const formattedContent = (ac && !extractedToolCalls) ? formatContentIfNeeded(ac) : ac;

    if (extractedToolCalls) {
      for (const tc of extractedToolCalls) {
        const newCallId = "call_" + responseId + "_" + Math.random().toString(36).slice(2, 6);
        try {
          res.write("event: response.output_item.added\ndata: " + JSON.stringify({
            type: "response.output_item.added",
            output_index: 0,
            item: {
              id: newCallId, type: "function_call",
              call_id: newCallId,
              name: tc.name,
              arguments: "",
              status: "in_progress",
            }
          }) + "\n\n");
          const fullArgs = tc.arguments;
          if (fullArgs) {
            res.write("event: response.function_call_arguments.delta\ndata: " + JSON.stringify({
              type: "response.function_call_arguments.delta",
              output_index: 0,
              call_id: newCallId,
              delta: fullArgs,
            }) + "\n\n");
          }
          res.write("event: response.function_call_arguments.done\ndata: " + JSON.stringify({
            type: "response.function_call_arguments.done",
            output_index: 0,
            call_id: newCallId,
          }) + "\n\n");
          res.write("event: response.output_item.done\ndata: " + JSON.stringify({
            type: "response.output_item.done",
            output_index: 0,
            item: {
              id: newCallId, type: "function_call",
              call_id: newCallId,
              name: tc.name,
              arguments: tc.arguments,
              status: "completed",
            }
          }) + "\n\n");
        } catch (ee) {}
        completedOutput.push({
          id: newCallId,
          type: "function_call",
          call_id: newCallId,
          name: tc.name,
          arguments: tc.arguments,
          status: "completed",
        });
      }
    } else if (ac) {
      completedOutput.push({
        id: itemId || ("msg_" + responseId),
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: formattedContent, annotations: [] }]
      });
    }
    if (wasToolCall && toolCallResults.length > 0) {
      completedOutput.push(...toolCallResults);
    }
    const usage = lastUsage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    res.write("event: response.completed\ndata: " + JSON.stringify({
      type: "response.completed",
      response: {
        id: responseId, object: "response", model: model,
        created: created,
        status: "completed",
        output: completedOutput,
        usage: {
          input_tokens: usage.prompt_tokens || 0,
          output_tokens: usage.completion_tokens || 0,
          total_tokens: usage.total_tokens || 0
        }
      }
    }) + "\n\n");

    try { res.end(); } catch {}
    log.debug("[responses] streaming complete: hasStarted=" + hasStarted + " finished=" + finished + " textLen=" + accumulatedContent.length + " hasUsage=" + (!!lastUsage) + " rawChunks=" + rawChunkCount);
    return { error: false, data: { stream: true, usage: lastUsage } };

  } catch (e) {
    log.warn("[responses] upstream error: " + e.message + " stack=" + (e.stack ? e.stack.substring(0, 200) : ""));
    // If headers haven't been sent and it's streaming, send SSE error events
    // to prevent CODEX from seeing raw JSON and triggering reconnect loops
    if (!res.headersSent) {
      if (isStreaming) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        var _errRespId = "resp_" + Date.now();
        var _errCreated = Math.floor(Date.now() / 1000);
        res.write("event: response.created\ndata: " + JSON.stringify({ type: "response.created", response: { id: _errRespId, object: "response", model: model, created: _errCreated, status: "in_progress", output: [] } }) + "\n\n");
        res.write("event: response.in_progress\ndata: " + JSON.stringify({ type: "response.in_progress", response: { id: _errRespId, object: "response", model: model, created: _errCreated, status: "in_progress", output: [] } }) + "\n\n");
        res.write("event: response.completed\ndata: " + JSON.stringify({
          type: "response.completed",
          response: {
            id: _errRespId, object: "response", model: model, created: _errCreated,
            status: "completed",
            output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "", annotations: [] }] }],
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
          }
        }) + "\n\n");
        try { res.end(); } catch {}
        return { error: true, status: 502, data: { error: { message: e.message, type: "upstream_error" } }, isStreamingError: true };
      }
      // Non-streaming: return error for server.mjs to handle
      return { error: true, status: 502, data: { error: { message: e.message, type: "upstream_error" } } };
    }
    // Already streaming - send response.failed event to close gracefully
    try {
      res.write("event: response.failed\ndata: " + JSON.stringify({
        type: "response.failed",
        response: {
          id: "resp_" + Date.now(), object: "response",
          model: model, created: Math.floor(Date.now() / 1000),
          status: "failed",
          error: { message: "service temporarily unavailable", code: "upstream_error", type: "upstream_error" },
          output: [], usage: {}
        }
      }) + "\n\n");
      res.end();
    } catch(ee) {}
    return { error: true, status: 502, data: { error: { message: e.message, type: "upstream_error" } }, isStreamingError: true };
  }
}

/**
 * Convert Responses API body to Chat Completions body.
 */
function responsesToChat(body, model) {
  const messages = [];

  // Handle instructions as system prompt
  if (body.instructions) {
    messages.push({
      role: "user",
      content: "[System Instructions] " + body.instructions +
        "\n\nNote: Be efficient with tool calls. Avoid repeating the same tool call unnecessarily.",
    });
  }

  // Convert input items to messages (full format)
  if (body.input && Array.isArray(body.input)) {
    let pendingToolCalls = [];
    const flushPendingToolCalls = () => {
      if (pendingToolCalls.length === 0) return;
      messages.push({ role: "assistant", content: null, tool_calls: pendingToolCalls });
      pendingToolCalls = [];
    };

    for (const item of body.input) {
      const itemType = item.type || (item.role ? "message" : undefined);

      if (itemType === "message") {
        const role = (item.role === "developer" || item.role === "system") ? "user" : item.role;
        let content;

        if (typeof item.content === "string") {
          content = item.content;
        } else if (Array.isArray(item.content)) {
          content = item.content.map((block) => {
            if (block.type === "input_text") return { type: "text", text: block.text };
            if (block.type === "output_text") return { type: "text", text: block.text };
            if (block.type === "input_image") {
              // Multimodal models handle images natively — convert to image_url
              // Non-multimodal models should never see input_image (preprocessing replaces them)
              const imgUrl = block.image_url || block.url || (block.source
                ? (block.source.type === "base64"
                    ? "data:" + (block.source.media_type || "image/png") + ";base64," + block.source.data
                    : block.source.url || block.source.data || "")
                : "");
              log.debug("[responses] converting input_image to image_url (len=" + imgUrl.length + ")");
              return { type: "image_url", image_url: { url: imgUrl } };
            }
            return block;
          });
          // Collapse single text item to string
          if (content.length === 1 && content[0].type === "text") {
            content = content[0].text;
          }
        }

        flushPendingToolCalls();
        messages.push({ role, content });

      } else if (itemType === "function_call") {
        // 关键修复：Codex CLI 的 function_call 项是"已执行的工具调用"
        // 需要把它还原成 Chat API 的 tool_calls 格式
        const tcId = item.call_id || item.id;
        const toolName = item.name || item.function?.name;
        const rawArgs = item.arguments || item.function?.arguments;
        // ★ Chat Completions 规范要求 arguments 必须是 JSON 字符串
        //   商汤等 Python 后端遍历 function.arguments.items() 会因对象而非字符串报错
        const toolArgs = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs);

        if (tcId && toolName && toolArgs !== undefined && toolArgs !== null) {
          pendingToolCalls.push({
            id: tcId,
            type: "function",
            function: { name: toolName, arguments: toolArgs },
          });
        }

      } else if (itemType === "function_call_output") {
        // 关键修复：function_call_output 是工具调用的执行结果
        // 在 Chat API 中必须配合 tool_calls 一起发送
        flushPendingToolCalls();
        messages.push({
          role: "tool",
          tool_call_id: item.call_id,
          content: item.output || item.content || "",
        });
      }
    }

    flushPendingToolCalls();

  } else if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
  }

  // Add previous messages from body.messages or body.history
  // 关键修复：正确处理工具调用历史消息
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === "assistant" && msg.tool_calls) {
        // assistant 带 tool_calls → 还原为 assistant + tool_calls 消息
        const tcList = msg.tool_calls.map(tc => {
          var fn = tc.function || {};
          // ★ 确保 arguments 是 JSON 字符串（商汤后端要求）
          if (typeof fn.arguments !== 'string') {
            fn = { name: fn.name, arguments: JSON.stringify(fn.arguments) };
          }
          return { id: tc.id, type: "function", function: fn };
        });
        // 如果有 tool_calls，content 可能为 null，不要设为普通文本
        var tcMsg = { role: "assistant", tool_calls: tcList };
        if (msg.content) tcMsg.content = msg.content;
        messages.unshift(tcMsg);
      } else if (msg.role === "tool" && msg.tool_call_id) {
        // tool 角色 → tool_call_output
        messages.unshift({
          role: "tool",
          tool_call_id: msg.tool_call_id,
          content: msg.content || msg.output || "",
        });
      } else if (msg.role === "function_call") {
        // Codex 格式: role=function_call → 转成 assistant + tool_calls
        const tcList = (msg.tool_calls || []).map(tc => ({
          id: tc.id || tc.call_id,
          type: "function",
          function: tc.function || { name: tc.name, arguments: tc.arguments },
        }));
        messages.unshift({
          role: "assistant",
          content: null,
          tool_calls: tcList,
        });
      } else if (msg.role === "function_call_output") {
        messages.unshift({
          role: "tool",
          tool_call_id: msg.call_id || msg.tool_call_id,
          content: msg.output || msg.content || "",
        });
      } else {
        // 普通消息 — ensure content is a string (Responses API may send arrays)
        let content = msg.content;
        if (Array.isArray(content)) {
          content = content.map(b => b.text || b.content || "").join("\n").trim();
        }
        messages.unshift({ role: msg.role, content: content || "" });
      }
    }
  }

  // Normalize messages: merge consecutive same-role messages
  const merged = [];
  for (const msg of messages) {
    if (merged.length > 0) {
      const prev = merged[merged.length - 1];
      // 只有当两个都是纯文本消息时才合并
      if (prev.role === msg.role && typeof prev.content === "string" && typeof msg.content === "string"
          && !prev.tool_calls && !msg.tool_calls && prev.role !== "tool") {
        prev.content += "\n\n" + msg.content;
        continue;
      }
    }
    merged.push({ ...msg });
  }

  // Truncate old tool outputs to limit token usage
  const TOOL_OUTPUT_MAX = 2000;
  const KEEP_RECENT_FULL = 10;
  for (let i = 0; i < Math.max(0, merged.length - KEEP_RECENT_FULL); i++) {
    const msg = merged[i];
    if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > TOOL_OUTPUT_MAX) {
      msg.content = msg.content.substring(0, TOOL_OUTPUT_MAX) +
        "\n\n[truncated: original output was " + msg.content.length + " chars]";
    }
  }

  // Handle tools - convert from Responses API format to Chat Completions format
  // Responses API: [{ type: "function", name: "bash", input_schema: {...}, description: "..." }]
  // Chat Completions: [{ type: "function", function: { name: "bash", parameters: {...}, description: "..." } }]
  // CODEX may also send non-function types (file_search, code_interpreter, computer_use, bash etc.)
  // that Chinese upstream providers don't support — filter those out.
  const rawTools = body.tools || body.functions || undefined;
  let tools = undefined;
  if (rawTools && Array.isArray(rawTools) && rawTools.length > 0) {
    const converted = [];
    for (const t of rawTools) {
      const toolType = t.type || "function";
      // Skip non-function tool types (file_search, code_interpreter, computer_use, bash, etc.)
      // CODEX sends these as separate types; only "function" type is supported by Chinese providers
      if (toolType !== "function") continue;

      // Get the tool name — Responses API puts it at top level, Chat Completions nests under .function
      let fnName = t.name || (t.function && t.function.name) || "";
      if (!fnName) continue; // Skip tools with no name

      // Build the function object for Chat Completions format
      // Truncate description to reduce body size (CODEX descriptions are very verbose)
      const fullDesc = t.description || (t.function && t.function.description) || "";
      const DESC_MAX = 300;
      const truncatedDesc = fullDesc.length > DESC_MAX ? fullDesc.substring(0, DESC_MAX) + "..." : fullDesc;
      const fnObj = {
        name: fnName,
        description: truncatedDesc,
      };

      // Parameters: Responses API uses input_schema, Chat Completions uses .function.parameters
      let params = t.input_schema || (t.function && t.function.parameters) || { type: "object", properties: {} };
      // If parameters is a string, try to parse as JSON
      if (typeof params === "string") {
        try { params = JSON.parse(params); } catch(e) { params = { type: "object", properties: {} }; }
      }
      // Truncate property descriptions to reduce body size
      if (params.properties) {
        const truncatedProps = {};
        for (const [key, prop] of Object.entries(params.properties)) {
          truncatedProps[key] = { ...prop };
          if (typeof truncatedProps[key].description === "string" && truncatedProps[key].description.length > 200) {
            truncatedProps[key].description = truncatedProps[key].description.substring(0, 200) + "...";
          }
        }
        params.properties = truncatedProps;
      }
      fnObj.parameters = params;

      // Ensure parameters has at minimum a valid structure
      if (fnObj.parameters.type !== "object" && !fnObj.parameters.properties) {
        // Some providers require parameters.type === "object"; fix malformed params
        const existingProps = fnObj.parameters.properties || {};
        fnObj.parameters = { type: "object", properties: existingProps };
      }

      converted.push({ type: "function", function: fnObj });
    }
    // Only set tools if we have at least one valid tool; omit entirely if empty
    tools = converted.length > 0 ? converted : undefined;
  }

  // Convert tool_choice from Responses API format to Chat Completions format
  // Responses API: { type: "function", name: "xxx" }
  // Chat Completions: { type: "function", function: { name: "xxx" } }
  // But sensenova/deepseek in thinking mode only supports "auto" — force it
  let toolChoice = body.tool_choice;
  if (tools && toolChoice) {
    if (typeof toolChoice === "object" && toolChoice.type === "function") {
      // Force "auto" — sensenova/deepseek rejects specific function choice in thinking mode
      toolChoice = "auto";
    } else if (toolChoice === "required") {
      // "required" also not supported
      toolChoice = "auto";
    }
  } else {
    // No tools available — omit tool_choice entirely
    toolChoice = undefined;
  }

  return {
    model,
    messages: merged,
    stream: body.stream === true,
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_output_tokens || body.max_tokens,
    tools,
    tool_choice: toolChoice,
    stop: body.stop,
  };
}

/**
 * Convert Chat Completions response to Responses API format (non-streaming).
 * Some providers (e.g. sensenova) use "reasoning" instead of "content".
 */
function chatToResponses(chatData, modelId) {
  const choice = (chatData.choices || [])[0] || {};
  const msg = choice.message || {};
  // Some providers return content in "reasoning" field instead of "content"
  let content = msg.content || msg.reasoning || "";
  const reasoningContent = msg.reasoning_content || "";
  const toolCalls = msg.tool_calls || [];

  // Strip <think> and <response> tags
  content = content.replace(/<\/?think>/gi, '').replace(/<\/?response>/gi, '').trim();

  const output = [];

  // Add reasoning output item (if provider sent reasoning_content)
  if (reasoningContent) {
    output.push({
      type: "reasoning",
      status: "completed",
      content: [{ type: "output_text", text: reasoningContent }],
    });
  }

  // If content looks like an XML tool call, convert to function_call
  if (content && toolCalls.length === 0) {
    const extracted = tryExtractToolCall(content);
    if (extracted && Array.isArray(extracted)) {
      for (const tc of extracted) {
        output.push({
          type: "function_call",
          call_id: "call_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          name: tc.name,
          arguments: tc.arguments,
          status: "completed",
        });
      }
      content = ""; // clear content so text message is not emitted
    }
  }

  // Add message output
  if (content) {
    const formattedContent = formatContentIfNeeded(content);
    output.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: formattedContent }],
    });
  }

  // Add tool call outputs (Responses API format: call_id + name + arguments)
  for (const tc of toolCalls) {
    const fn = tc.function || {};
    output.push({
      type: "function_call",
      call_id: tc.id || "call_" + Date.now(),
      name: fn.name || "",
      arguments: fn.arguments || "",
      status: "completed",
    });
  }

  return {
    id: chatData.id || "resp_" + Date.now(),
    object: "response",
    model: modelId,
    created: Math.floor(Date.now() / 1000),
    status: "completed",
    output,
    usage: chatData.usage || {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  };
}

/**
 * 自适应文本格式化 — 对扁平文本自动补充分段标记
 * 
 * 不区分模型，统一检测文本是否缺少分段：
 * - 已有 \n\n 分段 → 跳过（deepseek 等不受影响）
 * - 短文本 (< 80 字符) → 跳过
 * - 包含代码块或 URL → 跳过（避免破坏格式）
 * - 英文句号后无空格 → 跳过（避免破坏 URL/数字）
 */
function formatContentIfNeeded(text) {
  if (!text || text.length < 80) return text;
  if (text.indexOf('\n\n') >= 0) return text;
  if (text.indexOf('```') >= 0 || text.indexOf('http://') >= 0 || text.indexOf('https://') >= 0) return text;

  var result = '';
  var len = text.length;

  for (var i = 0; i < len; i++) {
    var c = text.charAt(i);
    var next = (i + 1 < len) ? text.charAt(i + 1) : '';

    // ── 中文句末标点（。？！）→ 补 \n\n ──
    if (c === '。' || c === '？' || c === '！') {
      result += c;
      while (i + 1 < len && (text.charAt(i + 1) === ' ' || text.charAt(i + 1) === '\t' || text.charAt(i + 1) === '\r')) i++;
      if (i + 1 < len && text.charAt(i + 1) !== '\n') {
        result += '\n\n';
      }
    }
    // ── 英文句末标点（.!?）— 仅当后面是空格时才分段 ──
    else if (c === '.' || c === '!' || c === '?') {
      result += c;
      if (i + 1 < len && text.charAt(i + 1) === ' ') {
        while (i + 1 < len && text.charAt(i + 1) === ' ') i++;
        if (i + 1 < len && text.charAt(i + 1) !== '\n') {
          result += '\n\n';
        }
      }
    }
    // ── 列表项标记（- * •）→ 前加分段 ──
    else if ((c === '-' || c === '*' || c === '•') && next === ' ') {
      if (result.length > 0 && !result.endsWith('\n')) {
        result += '\n\n';
      }
      result += c;
    }
    // ── 数字序号（1. 2. ① 等）→ 前加分段 ──
    else if (c >= '0' && c <= '9' && (next === '.' || next === '、' || next === '．' || next === ')')) {
      if (result.length > 0 && !result.endsWith('\n')) {
        result += '\n\n';
      }
      result += c;
    }
    // ── 已有 \n 分段 ──
    else if (c === '\n') {
      if (next === '\n') {
        result += '\n\n';
        i++;
      } else {
        result += '\n\n';
      }
    }
    else {
      result += c;
    }
  }

  result = result.trim();
  // 如果格式化后和原始文本一样 → 回退
  if (result === text.trim()) return text;
  return result;
}

/**
 * Extract token counts from a Chat Completions response.
 */
function extractTokens(data) {
  if (!data || !data.usage) return null;
  return {
    prompt: data.usage.prompt_tokens || 0,
    completion: data.usage.completion_tokens || 0,
    total: data.usage.total_tokens || 0,
  };
}

/**
 * Send JSON response.
 */
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Make native HTTP/HTTPS request through system proxy if configured.
 * Returns a response stream with an attached timeout.
 * The timeout will destroy the stream and emit an 'error' event on timeout.
 */
function nativeRequest(urlStr, options) {
  return new Promise((resolve, reject) => {
    const reqTimeout = options.timeout || 60000;
    const body = options.body;
    const opt = {
      method: options.method || "POST",
      headers: options.headers || {},
      timeout: reqTimeout,
    };
    if (body) opt.body = body;
    
    proxyRequest(urlStr, opt).then((res) => {
      // Wrap the response with a timeout
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        res.destroy(new Error("response timeout"));
      }, reqTimeout);
      res.on("close", () => { clearTimeout(timer); });
      res._timedOut = () => timedOut;
      resolve(res);
    }).catch(reject);
  });
}


// ── Tool Call Extraction ─────────────────────────────────────
// Some upstream providers/models don't support structured tool_calls and instead
// return tool calls as XML text in the content field. This function extracts
// them into an array of { name, arguments } so CODEX CLI can fold them.
function tryExtractToolCall(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  const results = [];

  // ── Try DSML format: <||DSML||tool_calls> ──
  if (trimmed.includes("DSML")) {
    log.info("[extract] DSML found (" + trimmed.length + " chars)");
    let normalized = trimmed
      .replace(/<\s*[｜|]\s*[｜|]?\s*DSML\s*[｜|]\s*[｜|]?\s*/gi, "<DSML")
      .replace(/<\s*\/\s*[｜|]\s*[｜|]?\s*DSML\s*[｜|]\s*[｜|]?\s*/gi, "</DSML");

    if (!normalized.includes("<DSMLtool_calls>")) {
      log.info("[extract] DSML found but no tool_calls wrapper, trying other formats");
      // Don't return null — fall through to other formats
    } else {
      const invokeRegex = /<DSMLinvoke\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/DSMLinvoke>/g;
      let m;
      while ((m = invokeRegex.exec(normalized)) !== null) {
        const name = m[1].trim();
        if (!name) continue;
        const inner = m[2].trim();
        const argsObj = {};
        const pRe = /<DSMLparameter\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/DSMLparameter>/g;
        let pm;
        let hasP = false;
        while ((pm = pRe.exec(inner)) !== null) {
          argsObj[pm[1].trim()] = pm[2].trim();
          hasP = true;
        }
        results.push({ name, arguments: hasP ? JSON.stringify(argsObj) : JSON.stringify(inner) });
      }
      if (results.length > 0) {
        log.info("[extract] DSML extracted " + results.length + " tool calls");
        return results;
      }
      log.info("[extract] DSML had wrapper but no valid invokes, trying other formats");
    }
  }

  // ── <tool_call><function=name><parameter=k>v</parameter> format ──
  // Multiple <tool_call> blocks can appear in sequence
  if (trimmed.includes("<tool_call>") && trimmed.includes("function=")) {
    // Extract each tool_call block
    const toolCallRe = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let m;
    while ((m = toolCallRe.exec(trimmed)) !== null) {
      const block = m[1].trim();
      // Extract function name: <function=name> or <function name="name">
      const fnMatch = block.match(/<function[=\s]+"?([^">\s]+)"?\s*>([\s\S]*?)<\/function>/);
      if (!fnMatch) continue;
      const name = fnMatch[1].trim();
      if (!name) continue;
      const innerBody = fnMatch[2].trim();
      // Extract parameters: <parameter=key>value</parameter>
      const argsObj = {};
      const pRe = /<parameter[=\s]+"?([^">\s]+)"?\s*>([\s\S]*?)<\/parameter>/g;
      let pm;
      let hasP = false;
      while ((pm = pRe.exec(innerBody)) !== null) {
        argsObj[pm[1].trim()] = pm[2].trim();
        hasP = true;
      }
      results.push({ name, arguments: hasP ? JSON.stringify(argsObj) : JSON.stringify(innerBody) });
    }
    if (results.length > 0) {
      log.info("[extract] extracted " + results.length + " tool calls via <tool_call> format");
      return results;
    }
  }

  // ── Standard XML format: <tagname>content</tagname> ──
  // Multiple blocks can be present
  const singleRe = /<([\w][\w=\-]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = singleRe.exec(trimmed)) !== null) {
    const name = m[1].trim();
    let innerContent = m[2].trim();
    if (!name) continue;

    let argsStr = innerContent;
    try {
      JSON.parse(innerContent);
      argsStr = innerContent;
    } catch {
      const argsObj = {};
      const kvRe = /<(\w[\w-]*)>([\s\S]*?)<\/\1>/g;
      let km;
      let hasK = false;
      while ((km = kvRe.exec(innerContent)) !== null) {
        argsObj[km[1]] = km[2].trim();
        hasK = true;
      }
      argsStr = hasK ? JSON.stringify(argsObj) : JSON.stringify(innerContent);
    }
    results.push({ name, arguments: argsStr });
  }
  if (results.length > 0) {
    log.info("[extract] extracted " + results.length + " tool calls via standard XML");
    return results;
  }

  return null;
}

// ── Vision Model Support ──────────────────────────────────────
// ONLY the configured vision model (from admin panel → 视觉模型页面 → "设为当前") is used.
// No hardcoded fallback chain. If the configured model fails → placeholder immediately.
let _allVisionExhausted = false;
let _visionExhaustedAt = 0;
const VISION_EXHAUSTED_TTL = 60 * 1000; // 1 minute — quick retry in case of transient timeout

// Models that support multimodal input natively — skip vision preprocessing entirely
// When these are the current upstream model, images pass through directly
const MULTIMODAL_MODELS = ["sensenova-6.7-flash-lite"];

// Maximum base64 image data size to send to vision model (4MB base64 ≈ 3MB raw)
// Images larger than this will use placeholder to avoid "400 input length too long"
const MAX_IMAGE_BASE64_LENGTH = 4 * 1024 * 1024;

/**
 * Get the configured vision model settings from admin panel.
 * Returns { base, key, model } or null if not configured.
 * Completely independent from custom provider list.
 */
function getVisionConfig() {
  const base = CONFIG_PROXY?.vision_base;
  const key = CONFIG_PROXY?.vision_key;
  const model = CONFIG_PROXY?.vision_model;
  if (!base || !key || !model) return null;
  return { base: base.replace(/\/+$/, ""), key, model };
}

/**
 * Check if input array has any input_image blocks.
 */
function hasInputImages(input) {
  if (!Array.isArray(input)) return false;
  for (var i = 0; i < input.length; i++) {
    var item = input[i];
    // Fast path: if content is a string (most text messages), skip
    if (typeof item.content === "string") continue;
    var itemType = item.type || (item.role ? "message" : undefined);
    if (itemType === "message" && Array.isArray(item.content)) {
      var content = item.content;
      for (var j = 0; j < content.length; j++) {
        if (content[j].type === "input_image") return true;
      }
    }
  }
  return false;
}

/**
 * Check if any image in the input exceeds the max allowed base64 size.
 * Returns { len, idx } if too large, or null if all images are OK.
 */
function hasOversizedImage(input) {
  if (!Array.isArray(input)) return null;
  for (var i = 0; i < input.length; i++) {
    var item = input[i];
    if (typeof item.content === "string") continue;
    var itemType = item.type || (item.role ? "message" : undefined);
    if (itemType === "message" && Array.isArray(item.content)) {
      for (var j = 0; j < item.content.length; j++) {
        if (item.content[j].type === "input_image") {
          var imgData = extractImageData(item.content[j]);
          if (imgData && imgData.length > MAX_IMAGE_BASE64_LENGTH) {
            return { len: imgData.length, idx: j };
          }
        }
      }
    }
  }
  return null;
}

/**
 * Extract image data from an input_image block.
 */
function extractImageData(block) {
  const imgUrl = block.image_url || block.url;
  if (imgUrl) return imgUrl;

  if (block.source) {
    if (block.source.type === "base64") {
      return "data:" + (block.source.media_type || "image/png") + ";base64," + block.source.data;
    }
    return block.source.url || block.source.data || null;
  }

  return null;
}

/**
 * Describe all images using the admin-configured vision model ONLY.
 * If no vision model is configured, or it fails → replace with placeholder immediately.
 * No hardcoded fallback chain.
 */
async function describeImagesWithVision(body) {
  if (!body.input || !Array.isArray(body.input)) return body;

  // Fast-fail: if configured model was recently exhausted, skip
  if (_allVisionExhausted && (Date.now() - _visionExhaustedAt) < VISION_EXHAUSTED_TTL) {
    log.info("[vision] model known exhausted, using placeholder immediately");
    return replaceImagesWithPlaceholder(body);
  }

  const newBody = JSON.parse(JSON.stringify(body));

  // Collect all image blocks (match both {type:"message"} and {role:"user"} formats)
  const imageBlocks = [];
  for (const item of newBody.input) {
    var itemType = item.type || (item.role ? "message" : undefined);
    if (itemType !== "message" || !Array.isArray(item.content)) continue;
    for (let i = 0; i < item.content.length; i++) {
      if (item.content[i].type === "input_image") {
        imageBlocks.push({ item, idx: i, block: item.content[i] });
      }
    }
  }

  if (imageBlocks.length === 0) return body;

  // ── Try the configured vision model (from admin panel: 视觉模型 → 设为当前) ──
  const visionCfg = getVisionConfig();
  if (visionCfg) {
    log.info("[vision] trying configured: " + visionCfg.model + " @ " + visionCfg.base);
    for (const ib of imageBlocks) {
      const imgData = extractImageData(ib.block);
      if (!imgData) {
        ib.item.content[ib.idx] = { type: "input_text", text: "[Image: no data]" };
        continue;
      }
      // Check image size — skip if too large to avoid 400 errors from upstream
      if (imgData.length > MAX_IMAGE_BASE64_LENGTH) {
        log.warn("[vision] image too large (" + imgData.length + " bytes), using placeholder");
        ib.item.content[ib.idx] = { type: "input_text", text: "[Image: too large for vision model]" };
        continue;
      }
      try {
        const desc = await askVisionModel(visionCfg, imgData);
        log.info("[vision] configured model OK (" + desc.length + " chars)");
        ib.item.content[ib.idx] = { type: "input_text", text: "[Image Description: " + desc + "]" };
      } catch (e) {
        log.warn("[vision] configured model failed: " + e.message + " — using placeholder");
        _allVisionExhausted = true;
        _visionExhaustedAt = Date.now();
        return replaceImagesWithPlaceholder(newBody);
      }
    }
    log.info("[vision] all images described via configured model");
    return newBody;
  }

  // No vision model configured — use placeholder
  log.info("[vision] no configured vision model, using placeholder");
  return replaceImagesWithPlaceholder(newBody);
}

/**
 * Replace all image blocks with placeholder text (no vision model available).
 */
function replaceImagesWithPlaceholder(body) {
  for (const item of body.input) {
    var itemType = item.type || (item.role ? "message" : undefined);
    if (itemType !== "message" || !Array.isArray(item.content)) continue;
    for (let i = 0; i < item.content.length; i++) {
      if (item.content[i].type === "input_image") {
        item.content[i] = { type: "input_text", text: "[Image: vision models unavailable]" };
      }
    }
  }
  return body;
}

/**
 * Send image to a vision model and get text description.
 */
async function askVisionModel(provider, imageData) {
  // Support both config object ({ base, key, model }) and provider object ({ base, key, modelId })
  const base = (provider.base || "").replace(/\/+$/, "");
  const url = base + "/chat/completions";
  const modelId = provider.model || provider.modelId;

  const visionBody = {
    model: modelId,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Describe this image in detail. Focus on: text, objects, people, colors, layout. Be concise but thorough." },
        { type: "image_url", image_url: { url: imageData } },
      ],
    }],
    stream: false,
    max_tokens: 1500,
  };

  const upstreamRes = await nativeRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + provider.key,
    },
    body: JSON.stringify(visionBody),
    timeout: 30000, // Vision models need time for image processing; 30s timeout
  });

  const chunks = [];
  for await (const chunk of upstreamRes) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();

  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error("parse error: " + raw.substring(0, 200)); }

  if ((upstreamRes.statusCode && upstreamRes.statusCode >= 400) || (data && data.error)) {
    const errMsg = data?.error?.message || "status " + upstreamRes.statusCode;
    throw new Error(errMsg);
  }

  return (data.choices || [])[0]?.message?.content || "(no description)";
}

export { isQuotaError } from "./openai-chat.mjs";

/**
 * Reset the vision model exhaustion cache (called when vision model config changes).
 */
export function resetVisionCache() {
  _allVisionExhausted = false;
  _visionExhaustedAt = 0;
  log.info("[vision] cache reset");
}
