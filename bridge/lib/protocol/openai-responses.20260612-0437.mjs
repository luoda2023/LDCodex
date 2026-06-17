/**
 * OpenAI Responses API Protocol Handler
 *
 * Codex CLI uses OpenAI Responses API format. This handler converts
 * Responses API requests to Chat Completions for upstream providers,
 * then converts back. Supports streaming (SSE) bridge.
 */

import { log } from "../logger.mjs";
import { UPSTREAM } from "../config.mjs";
import { isQuotaError } from "./openai-chat.mjs";
import https from "node:https";
import http from "node:http";

/**
 * Handle an OpenAI Responses API request by converting to Chat Completions
 * and proxying to the upstream provider.
 */
export async function handleResponses(ctx, req, body) {
  const { res, provider, clientId } = ctx;
  const model = provider.modelId || body.model;
  const timeout = ctx.timeout || UPSTREAM.upstreamTimeout;
  const isStreaming = body.stream === true;

  // 🔥 CRITICAL FIX: When tools are present, force non-streaming mode.
  // sensenova/deepseek's streaming returns function_call with EMPTY arguments
  // (no function_call_arguments.delta events). Non-streaming returns correct arguments.
  const hasTools = body.tools && Array.isArray(body.tools) && body.tools.length > 0;
  const forceNonStream = hasTools && isStreaming;
  if (forceNonStream) {
    log.info(`[responses] tools present (${body.tools.length}), forcing non-streaming to preserve arguments`);
  }

  // Convert Responses API -> Chat Completions
  const chatBody = responsesToChat(body, model, provider.tool_format);

  // Log tools being sent upstream for debugging tool call issues
  if (chatBody.tools && chatBody.tools.length > 0) {
    const toolNames = chatBody.tools.map(t => t.function?.name || t.name || "?").join(",");
    log.info(`[responses] tools=${chatBody.tools.length} names=[${toolNames}] choice=${JSON.stringify(chatBody.tool_choice)}`);
  } else if (!chatBody.tools) {
    log.warn(`[responses] NO tools sent! choice=${JSON.stringify(chatBody.tool_choice)}`);
  }

  // Build upstream URL
  const base = provider.base.replace(/\/+$/, "");
  const upstreamUrl = base + "/chat/completions";

  const upstreamHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + provider.key,
    Accept: isStreaming ? "text/event-stream" : "application/json",
  };

  if (forceNonStream) {
    // Override stream to false so the upstream sends a complete response
    chatBody.stream = false;
  }

  log.debug("[responses] " + provider.name + " model=" + model + " stream=" + (chatBody.stream !== false) + " bodyLen=" + (body.input ? JSON.stringify(body.input).length : 0));

  try {
    // Use native request to bypass undici proxy issues
    const upstreamBodyStr = JSON.stringify(chatBody);
    // Debug: log first 300 chars of upstream body to verify tools are included
    log.info(`[responses] upstream body sample: ${upstreamBodyStr.substring(0, 300)}`);
    const upstreamRes = await nativeRequest(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: upstreamBodyStr,
      timeout,
    });

    if (forceNonStream) {
      // Non-streaming path (forced when tools are present)
      const chunks = [];
      for await (const chunk of upstreamRes) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      let data;
      try { data = JSON.parse(raw); } catch(e) { data = { error: raw.substring(0, 200) }; }
      if ((!upstreamRes.statusCode || upstreamRes.statusCode >= 400) || (data && data.error)) {
        return { error: true, status: upstreamRes.statusCode || 502, data };
      }

      // Convert Chat Completions → Responses API
      const responsesData = chatToResponses(data, model);
      // Strip <think> and <response> tags from all output text
      if (responsesData.output && Array.isArray(responsesData.output)) {
        responsesData.output.forEach(function(item) {
          if (item.content && Array.isArray(item.content)) {
            item.content.forEach(function(part) {
              if (part.text && typeof part.text === 'string') {
                part.text = part.text.replace(/<\/?think>/gi, '').replace(/<\/?response>/gi, '');
              }
            });
          }
        });
      }
      // Send SSE events for compatibility (CODEX expects streaming)
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const respId = "resp_" + Date.now();
      const created = Math.floor(Date.now() / 1000);
      // Emit response.created
      res.write("event: response.created\ndata: " + JSON.stringify({
        type: "response.created",
        response: { id: respId, object: "response", model: model, created_at: created, status: "in_progress", output: [] }
      }) + "\n\n");
      // Emit response.in_progress
      res.write("event: response.in_progress\ndata: " + JSON.stringify({
        type: "response.in_progress",
        response: { id: respId, object: "response", model: model, created_at: created, status: "in_progress", output: [] }
      }) + "\n\n");
      // Emit output items as SSE events
      for (const item of (responsesData.output || [])) {
        const outputIndex = responsesData.output.indexOf(item);
        if (item.type === "message") {
          const text = (item.content && item.content[0] && item.content[0].text || "").replace(/<\/?think>/gi, '').replace(/<\/?response>/gi, '');
          res.write("event: response.output_item.added\ndata: " + JSON.stringify({
            type: "response.output_item.added", output_index: outputIndex,
            item: { id: "msg_" + respId, type: "message", role: "assistant", content: [] }
          }) + "\n\n");
          res.write("event: response.content_part.added\ndata: " + JSON.stringify({
            type: "response.content_part.added", output_index: outputIndex, content_index: 0,
            part: { type: "output_text", text: "" }, item_id: "msg_" + respId
          }) + "\n\n");
          res.write("event: response.output_text.delta\ndata: " + JSON.stringify({
            type: "response.output_text.delta", output_index: outputIndex, content_index: 0,
            delta: text, item_id: "msg_" + respId
          }) + "\n\n");
          res.write("event: response.output_text.done\ndata: " + JSON.stringify({
            type: "response.output_text.done", output_index: outputIndex, content_index: 0,
            text: text, item_id: "msg_" + respId
          }) + "\n\n");
          res.write("event: response.content_part.done\ndata: " + JSON.stringify({
            type: "response.content_part.done", output_index: outputIndex, content_index: 0,
            part: { type: "output_text", text: text, annotations: [] }, item_id: "msg_" + respId
          }) + "\n\n");
          res.write("event: response.output_item.done\ndata: " + JSON.stringify({
            type: "response.output_item.done", output_index: outputIndex,
            item: { id: "msg_" + respId, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: text, annotations: [] }] }
          }) + "\n\n");
        } else if (item.type === "function_call") {
          res.write("event: response.output_item.added\ndata: " + JSON.stringify({
            type: "response.output_item.added", output_index: outputIndex,
            item: { id: item.id || item.call_id, type: "function_call", call_id: item.call_id, name: item.name, arguments: "", status: "in_progress" }
          }) + "\n\n");
          if (item.arguments) {
            res.write("event: response.function_call_arguments.delta\ndata: " + JSON.stringify({
              type: "response.function_call_arguments.delta", output_index: outputIndex,
              call_id: item.call_id, delta: item.arguments
            }) + "\n\n");
          }
          res.write("event: response.function_call_arguments.done\ndata: " + JSON.stringify({
            type: "response.function_call_arguments.done", output_index: outputIndex,
            call_id: item.call_id
          }) + "\n\n");
          res.write("event: response.output_item.done\ndata: " + JSON.stringify({
            type: "response.output_item.done", output_index: outputIndex,
            item: { id: item.id || item.call_id, type: "function_call", call_id: item.call_id, name: item.name, arguments: item.arguments || "", status: "completed" }
          }) + "\n\n");
        }
      }
      // Emit response.completed
      res.write("event: response.completed\ndata: " + JSON.stringify({
        type: "response.completed",
        response: {
          id: respId, object: "response", model: model,
          created_at: created, status: "completed",
          output: responsesData.output || [],
          usage: responsesData.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
        }
      }) + "\n\n");
      try { res.end(); } catch {}
      return { error: false, data: data, tokens: extractTokens(data) };
    }

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
      // Strip <think> and <response> tags from output text
      if (responsesData.output && Array.isArray(responsesData.output)) {
        responsesData.output.forEach(function(item) {
          if (item.content && Array.isArray(item.content)) {
            item.content.forEach(function(part) {
              if (part.text && typeof part.text === 'string') {
                part.text = part.text.replace(/<\/?think>/gi, '').replace(/<\/?response>/gi, '');
              }
            });
          }
        });
      }
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
      res.write("event: response.created\ndata: " + JSON.stringify({ type: "response.created", response: { id: _errRespId, object: "response", model: model, created_at: _errCreated, status: "in_progress", output: [] } }) + "\n\n");
      // 2) response.in_progress
      res.write("event: response.in_progress\ndata: " + JSON.stringify({ type: "response.in_progress", response: { id: _errRespId, object: "response", model: model, created_at: _errCreated, status: "in_progress", output: [] } }) + "\n\n");
      // 3) response.completed (no output, no error - clean completion so CODEX doesn't reconnect)
      res.write("event: response.completed\ndata: " + JSON.stringify({
        type: "response.completed",
        response: {
          id: _errRespId, object: "response", model: model, created_at: _errCreated,
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
    let buffer = "";
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
        created_at: created, status: "in_progress", output: []
      }
    }) + "\n\n");

    // 2) response.in_progress
    res.write("event: response.in_progress\ndata: " + JSON.stringify({
      type: "response.in_progress",
      response: {
        id: responseId, object: "response", model: model,
        created_at: created, status: "in_progress", output: []
      }
    }) + "\n\n");

    // Process upstream SSE stream - with safety limits
    let rawChunkCount = 0;
    const MAX_BUFFER = 1024 * 1024; // 1MB max buffered data
    for await (const rawChunk of upstreamRes) {
      rawChunkCount++;
      const chunkStr = decoder.decode(rawChunk, { stream: true });
      // Log first few raw chunks for debugging
      if (rawChunkCount <= 3) {
        log.debug("[responses] raw chunk #" + rawChunkCount + ": " + chunkStr.substring(0, 200).replace(/\n/g, "\\n"));
      }
      buffer += chunkStr;
      // Safety: prevent OOM from malformed SSE (no newlines)
      if (buffer.length > MAX_BUFFER) {
        log.warn("[responses] buffer exceeded 1MB, resetting");
        buffer = buffer.substring(buffer.length - 4096); // Keep last 4KB
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

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

          // Handle reasoning content (thinking) from upstream providers — capture silently.
          // Do NOT emit as a separate output item; CODEX CLI doesn't handle reasoning items
          // in the Responses API stream. The old proxy.mjs also skips forwarding reasoning_content.
          //
          // CRITICAL FIX: Many Chinese upstream providers (sensenova, deepseek) output ALL content
          // through the `reasoning` field instead of `content`. If we only capture it silently,
          // CODEX CLI receives empty responses and enters an infinite retry loop.
          // Solution: treat reasoning as text content when content is not available.
          const reasoningDelta = delta.reasoning_content || delta.reasoning || "";
          const hasContent = !!delta.content;
          const textDelta = (hasContent ? delta.content : reasoningDelta).replace(/<\/?think>/gi, '').replace(/<\/?response>/gi, '');

          if (reasoningDelta && hasContent) {
            // Only track reasoning length for stats when it's separate from content
            reasoningAccumulated += reasoningDelta;
            outputTextLen += reasoningDelta.length;
          }

          // Handle text content delta (the actual response)
          if (textDelta) {
            outputTextLen += textDelta.length;
            accumulatedContent += textDelta;

            if (!hasStarted) {
              hasStarted = true;
              itemId = "msg_" + responseId;
              outputIndex = 0;
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
              delta: textDelta,
              item_id: itemId
            }) + "\n\n");
          }

          // Handle tool calls (may appear after or before content in stream)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const tcName = (tc.function?.name || "").trim();
              // Skip empty tool calls — model returned a tool_call with no name
              if (!tcName) {
                log.warn(`[responses] stream: skipping empty tool_call (id=${tc.id || "?"})`);
                continue;
              }
              if (!hasStarted) {
                // Normal case: tool calls come first, before any text
                hasStarted = true;
                wasToolCall = true;
                itemId = tc.id || "call_" + responseId;
                outputIndex = 0;
                // 1) response.output_item.added for function_call
                res.write("event: response.output_item.added\ndata: " + JSON.stringify({
                  type: "response.output_item.added",
                  output_index: outputIndex,
                  item: {
                    id: itemId,
                    type: "function_call",
                    call_id: itemId,
                    name: tcName,
                    arguments: "",
                    status: "in_progress",
                  }
                }) + "\n\n");
                // track completed tool call for response.completed output
                toolCallResults.push({
                  type: "function_call",
                  call_id: itemId,
                  name: tc.function?.name || "",
                  arguments: "",
                  status: "completed",
                });
              } else if (!wasToolCall && (accumulatedContent.trim() || hasStarted)) {
                // 🔥 FIX: upstream sent text first (thinking/reasoning), NOW tool calls arrive
                // Need to close the text item and start a function_call item
                // Also handle edge case where upstream sends whitespace-only text before tool_calls.
                hasStarted = true;
                if (accumulatedContent.trim()) {
                  res.write("event: response.output_text.done\ndata: " + JSON.stringify({
                    type: "response.output_text.done",
                    output_index: outputIndex,
                    content_index: 0,
                    text: accumulatedContent.trim(),
                    item_id: itemId
                  }) + "\n\n");
                  res.write("event: response.content_part.done\ndata: " + JSON.stringify({
                    type: "response.content_part.done",
                    output_index: outputIndex,
                    content_index: 0,
                    part: { type: "output_text", text: accumulatedContent.trim(), annotations: [] },
                    item_id: itemId
                  }) + "\n\n");
                  res.write("event: response.output_item.done\ndata: " + JSON.stringify({
                    type: "response.output_item.done",
                    output_index: outputIndex,
                    item: {
                      id: itemId, type: "message", role: "assistant",
                      status: "completed",
                      content: [{ type: "output_text", text: accumulatedContent.trim(), annotations: [] }]
                    }
                  }) + "\n\n");
                }
                // Now start function_call at next output_index
                wasToolCall = true;
                outputIndex++;
                const callItemId = tc.id || "call_" + responseId + "_1";
                res.write("event: response.output_item.added\ndata: " + JSON.stringify({
                  type: "response.output_item.added",
                  output_index: outputIndex,
                  item: {
                    id: callItemId,
                    type: "function_call",
                    call_id: callItemId,
                    name: tc.function?.name || "",
                    arguments: "",
                    status: "in_progress",
                  }
                }) + "\n\n");
                toolCallResults.push({
                  type: "function_call",
                  call_id: callItemId,
                  name: tc.function?.name || "",
                  arguments: "",
                  status: "completed",
                });
                itemId = callItemId;
              }
              // 2) stream arguments deltas
              const argsDelta = tc.function?.arguments || "";
              if (argsDelta) {
                res.write("event: response.function_call_arguments.delta\ndata: " + JSON.stringify({
                  type: "response.function_call_arguments.delta",
                  output_index: outputIndex,
                  call_id: itemId,
                  delta: argsDelta,
                }) + "\n\n");
                // accumulate arguments for the completed output
                if (toolCallResults.length > 0) {
                  toolCallResults[toolCallResults.length - 1].arguments += argsDelta;
                }
              }
            }
          }

          // Handle finish (stop, length, etc.)
          if (finishReason && hasStarted && !finished) {
            finished = true;

            if (wasToolCall) {
              // 6) response.function_call_arguments.done for tool call
              res.write("event: response.function_call_arguments.done\ndata: " + JSON.stringify({
                type: "response.function_call_arguments.done",
                output_index: outputIndex,
                call_id: itemId
              }) + "\n\n");
              // 7) response.output_item.done for function_call
              // Use the accumulated tool name/args from toolCallResults
              const lastToolCallName = toolCallResults.length > 0 ?
                toolCallResults[toolCallResults.length - 1].name : "";
              const lastToolCallArgs = toolCallResults.length > 0 ?
                toolCallResults[toolCallResults.length - 1].arguments : "";
              res.write("event: response.output_item.done\ndata: " + JSON.stringify({
                type: "response.output_item.done",
                output_index: outputIndex,
                item: {
                  id: itemId, type: "function_call",
                  call_id: itemId, name: lastToolCallName,
                  arguments: lastToolCallArgs, status: "completed"
                }
              }) + "\n\n");
            } else if (hasStarted) {
              // 6) response.output_text.done (with full text for markdown parsing)
              res.write("event: response.output_text.done\ndata: " + JSON.stringify({
                type: "response.output_text.done",
                output_index: outputIndex,
                content_index: 0,
                text: accumulatedContent,
                item_id: itemId
              }) + "\n\n");
              // 6b) response.content_part.done for message
              res.write("event: response.content_part.done\ndata: " + JSON.stringify({
                type: "response.content_part.done",
                output_index: outputIndex,
                content_index: 0,
                part: { type: "output_text", text: accumulatedContent, annotations: [] },
                item_id: itemId
              }) + "\n\n");
              // 7) response.output_item.done
              res.write("event: response.output_item.done\ndata: " + JSON.stringify({
                type: "response.output_item.done",
                output_index: outputIndex,
                item: {
                  id: itemId, type: "message", role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text: accumulatedContent, annotations: [] }]
                }
              }) + "\n\n");
            }
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    // Safety net: if upstream never sent finish_reason, emit completion events now
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
          item: {
            id: itemId, type: "function_call",
            call_id: itemId,
            name: toolCallResults.length > 0 ? toolCallResults[toolCallResults.length - 1].name : "",
            arguments: toolCallResults.length > 0 ? toolCallResults[toolCallResults.length - 1].arguments : "",
            status: "completed"
          }
        }) + "\n\n");
      } else {
        res.write("event: response.output_text.done\ndata: " + JSON.stringify({
          type: "response.output_text.done",
          output_index: outputIndex,
          content_index: 0,
          text: accumulatedContent,
          item_id: itemId
        }) + "\n\n");
        res.write("event: response.content_part.done\ndata: " + JSON.stringify({
          type: "response.content_part.done",
          output_index: outputIndex,
          content_index: 0,
          part: { type: "output_text", text: accumulatedContent, annotations: [] },
          item_id: itemId
        }) + "\n\n");
        res.write("event: response.output_item.done\ndata: " + JSON.stringify({
          type: "response.output_item.done",
          output_index: outputIndex,
          item: {
            id: itemId, type: "message", role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: accumulatedContent, annotations: [] }]
          }
        }) + "\n\n");
      }
    }

    // Fallback: estimate usage from text length if upstream didn't provide it
    if (!lastUsage && outputTextLen > 0) {
      const estimated = Math.max(1, Math.round(outputTextLen / 2));
      lastUsage = { prompt_tokens: 0, completion_tokens: estimated, total_tokens: estimated };
    }

    // 8) response.completed (CRITICAL: this is what CODEX CLI waits for)
    // Always send status="completed" - the stream itself is complete even if empty
    // Build output array with all completed items (text + tool calls)
    const completedOutput = [];
    const ac = accumulatedContent.trim();

    // Detect if accumulated text is actually a tool call (upstream returned XML text)
    let textAsToolCall = null;
    if (ac && !wasToolCall) {
      textAsToolCall = tryExtractToolCall(ac);
    }

    if (textAsToolCall) {
      // Convert text-based tool call to structured function_call
      const newCallId = "call_" + responseId;
      // Re-emit function_call events so Codex gets proper streaming events
      // (We already sent output_text events, but the response.completed output
      //  is what Codex ultimately uses. However, also send function_call events
      //  so the UI shows folding cards.)
      try {
        // Override: emit function_call events NOW to fix the UI
        res.write("event: response.output_item.added\ndata: " + JSON.stringify({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            id: newCallId, type: "function_call",
            call_id: newCallId,
            name: textAsToolCall.name,
            arguments: "",
            status: "in_progress",
          }
        }) + "\n\n");
        // arguments delta (full at once since we don't have streaming from text)
        // Split into chunks for realism — but for reliability just send it all at once
        const fullArgs = textAsToolCall.arguments;
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
            name: textAsToolCall.name,
            arguments: textAsToolCall.arguments,
            status: "completed",
          }
        }) + "\n\n");
      } catch (ee) {
        log.warn("[responses] failed to emit tool call events: " + (ee.message || ee));
      }

      // Put function_call in the completed output
      completedOutput.push({
        id: newCallId,
        type: "function_call",
        call_id: newCallId,
        name: textAsToolCall.name,
        arguments: textAsToolCall.arguments,
        status: "completed",
      });
    } else if (ac) {
      // Normal text output
      completedOutput.push({
        id: itemId || ("msg_" + responseId),
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: ac, annotations: [] }]
      });
    }
    if (wasToolCall && toolCallResults.length > 0) {
      // Validate arguments — skip tool calls with empty or invalid arguments
      for (let ti = toolCallResults.length - 1; ti >= 0; ti--) {
        const tr = toolCallResults[ti];
        if (!tr.arguments || tr.arguments.trim() === "" || tr.arguments.trim() === "{}") {
          log.warn(`[responses] stream: skipping tool_call "${tr.name}" with empty arguments`);
          toolCallResults.splice(ti, 1);
        }
      }
      completedOutput.push(...toolCallResults);
    }
    const usage = lastUsage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    res.write("event: response.completed\ndata: " + JSON.stringify({
      type: "response.completed",
      response: {
        id: responseId, object: "response", model: model,
        created_at: created,
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
    // If headers were already sent (streaming mode), send response.failed event
    if (!res.headersSent) {
      // Haven't started streaming yet, return error for server.mjs to handle
      return { error: true, status: 502, data: { error: { message: e.message, type: "upstream_error" } } };
    }
    // Already streaming - send response.failed event to close gracefully
    try {
      res.write("event: response.failed\ndata: " + JSON.stringify({
        type: "response.failed",
        response: {
          id: "resp_" + Date.now(), object: "response",
          model: model, created_at: Math.floor(Date.now() / 1000),
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
 * @param {object} tool_format - Provider's tool format: "tools", "functions", or "none"
 */
function responsesToChat(body, model, tool_format) {
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
              var imgUrl = block.image_url || block.url;
              if (!imgUrl && block.source) {
                if (block.source.type === "base64") {
                  imgUrl = "data:" + (block.source.media_type || "image/png") + ";base64," + block.source.data;
                } else {
                  imgUrl = block.source.url || block.source.data || "";
                }
              }
              return { type: "image_url", image_url: { url: imgUrl || "" } };
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
        const toolArgs = item.arguments || item.function?.arguments;

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
        const tcList = msg.tool_calls.map(tc => ({
          id: tc.id,
          type: "function",
          function: tc.function,
        }));
        // 如果有 tool_calls，content 可能为 null，不要设为普通文本
        messages.unshift({
          role: "assistant",
          content: msg.content || null,
          tool_calls: tcList,
        });
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
        // 普通消息
        messages.unshift({ role: msg.role, content: msg.content });
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

  // Handle tools - only pass valid function-type tools (CODEX may send file_search, code_interpreter etc.
  // that Chinese upstream providers don't support. Passing unknown tool types upstream causes the
  // model to return empty responses (thinking-only, no actual content).

  // 🔥 CRITICAL FIX: Responses API tool format is DIFFERENT from Chat Completions:
  //   Responses: { type:"function", name:"xxx", description:"...", input_schema:{...} }
  //   Chat:      { type:"function", function:{ name:"xxx", description:"...", parameters:{...} } }
  // We must normalize before filtering.
  let rawTools = body.tools || body.functions || undefined;
  let tools = rawTools && Array.isArray(rawTools)
    ? rawTools.map(t => {
        // Normalize Responses API function format → Chat Completions format
        if (t.type === "function" && t.name && !t.function) {
          return {
            type: "function",
            function: {
              name: t.name,
              description: t.description || "",
              parameters: t.input_schema || t.parameters || {},
            }
          };
        }
        // Convert CODEX non-function tools (computer_use, bash, etc.) to function type.
        // CODEX CLI sends tools with type="computer_use" / type="bash" etc. for its
        // built-in sandbox. The upstream model needs to see these as function definitions
        // so it can generate proper tool calls.
        if (t.type && t.type !== "function" && t.name) {
          return {
            type: "function",
            function: {
              name: t.name,
              description: t.description || "",
              parameters: t.input_schema || t.parameters || t.properties || {},
            }
          };
        }
        return t;
      }).filter(t => {
        if (!t.function || !t.function.name) return false;
        return true;
      })
    : rawTools;

  // Fix: if tools array is empty, don't send it at all
  // Empty array can confuse some upstream APIs
  if (tools && Array.isArray(tools) && tools.length === 0) {
    tools = undefined;
  }

  // Build the request body — tool format depends on provider capability
  const result = {
    model,
    messages: merged,
    stream: body.stream === true,
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_output_tokens || body.max_tokens,
    tool_choice: normalizeToolChoice(body.tool_choice),
    stop: body.stop,
  };

  // Apply tool format: each provider may need a different parameter
  const fmt = tool_format || "tools";
  if (fmt === "none" || !tools) {
    // Don't send tool definitions (model doesn't support or no tools to send)
    // tool_choice would confuse the model without tools, remove it too
    if (!tools) delete result.tool_choice;
  } else if (fmt === "functions") {
    // Deprecated format — some older providers need this
    result.functions = tools.map(t => t.function).filter(Boolean);
  } else {
    // Default: "tools" — standard OpenAI Chat Completions format
    result.tools = tools;
  }

  return result;
}

/**
 * Normalize tool_choice from Responses API format to Chat Completions format.
 * Responses: { type:"function", name:"xxx" }
 * Chat:      { type:"function", function:{ name:"xxx" } }
 */
function normalizeToolChoice(tc) {
  if (!tc || typeof tc !== "object" || Array.isArray(tc)) return tc;
  if (tc.type === "function" && tc.name && !tc.function) {
    return { type: "function", function: { name: tc.name } };
  }
  return tc;
}

/**
 * Try to detect and parse XML-style tool calls from plain text content.
 *
 * Some upstream providers/models don't support structured tool_calls and instead
 * output the tool call as XML text like:
 *   <read_file><path>J:\foo\bar</path></read_file>
 *
 * Some providers also output DSML (Document Structure Markup Language) format:
 *   <||DSML||tool_calls>
 *     <||DSML||invoke name="read_file">
 *       <||DSML||parameter name="path">value</||DSML||parameter>
 *     </||DSML||invoke>
 *   </||DSML||tool_calls>
 *
 * This function detects both patterns and converts them to structured form.
 * Returns { name, arguments } or null if not a tool call.
 */
function tryExtractToolCall(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  // 🔥 快速失败：95% 的普通文本不以 < 开头，避免跑正则
  if (trimmed.charCodeAt(0) !== 60) return null; // 60 = '<'

  // ── Try DSML format first: <||DSML||tool_calls> → <||DSML||invoke name="xxx"> → <||DSML||parameter name="k">v</||DSML||parameter>
  if (trimmed.includes("||DSML||") || trimmed.includes("|| DSML ||")) {
    // Normalize tag prefix — handle both "||DSML||" and "|| DSML ||" variants
    const normalized = trimmed
      .replace(/\|\|\s*DSML\s*\|\|/g, "DSML");
    
    // Check if it's a tool_calls wrapper
    if (!normalized.includes("<DSMLtool_calls>")) return null;

    // Extract invoke elements: <DSMLinvoke name="toolName">...</DSMLinvoke>
    const invokeRegex = /<DSMLinvoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/DSMLinvoke>/g;
    let invokeMatch;
    
    // We'll return the FIRST invoke found (Codex typically only needs one per response)
    while ((invokeMatch = invokeRegex.exec(normalized)) !== null) {
      const name = invokeMatch[1].trim();
      const innerBlock = invokeMatch[2].trim();

      // Extract parameters: <DSMLparameter name="k">v</DSMLparameter>
      const argsObj = {};
      const paramRegex = /<DSMLparameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/DSMLparameter>/g;
      let paramMatch;
      let hasParams = false;
      while ((paramMatch = paramRegex.exec(innerBlock)) !== null) {
        argsObj[paramMatch[1].trim()] = paramMatch[2].trim();
        hasParams = true;
      }

      const argsStr = hasParams ? JSON.stringify(argsObj) : JSON.stringify(innerBlock);
      return { name, arguments: argsStr };
    }
    return null;
  }

  // ── Standard XML format: <tagname>content</tagname>
  const outerMatch = trimmed.match(/^<(\w[\w-]*)>([\s\S]*)<\/\1>$/);
  if (!outerMatch) return null;

  const name = outerMatch[1];
  let innerContent = outerMatch[2].trim();

  // Known Codex tool names — only convert if it matches one of these
  const knownTools = [
    "read_file", "write_to_file", "edit", "bash", "execute_bash",
    "grep", "glob", "web_search", "web_fetch", "fetch",
    "ask_user", "list_files", "list_dir", "create_directory", "mkdir",
    "read_multiple_files", "write", "edit_file", "replace_in_file",
    "search_files", "search_code", "read", "file_search", "code_interpreter",
  ];
  if (!knownTools.includes(name)) {
    // Not a known tool name — could be a nested XML structure, skip
    return null;
  }

  // Try to parse inner content as JSON first
  // (some models output JSON inside the tags: <tool>{"key":"val"}</tool>)
  let argsStr = innerContent;
  try {
    JSON.parse(innerContent);
    // Valid JSON, use as-is
    argsStr = innerContent;
  } catch {
    // Not JSON — try to parse key-value XML:
    // <path>xxx</path><content>xxx</content> → {"path":"xxx","content":"xxx"}
    const argsObj = {};
    const kvRegex = /<(\w[\w-]*)>([\s\S]*?)<\/\1>/g;
    let kvMatch;
    let hasKeys = false;
    while ((kvMatch = kvRegex.exec(innerContent)) !== null) {
      argsObj[kvMatch[1]] = kvMatch[2].trim();
      hasKeys = true;
    }
    if (hasKeys) {
      argsStr = JSON.stringify(argsObj);
    } else {
      // Plain text content — use as single string argument
      argsStr = JSON.stringify(innerContent);
    }
  }

  return { name, arguments: argsStr };
}

/**
 * Convert Chat Completions response to Responses API format (non-streaming).
 * Some providers (e.g. sensenova) use "reasoning" instead of "content".
 * Note: reasoning_content is captured silently (NOT emitted as a separate output item)
 * to match CODEX CLI expectations.
 */
function chatToResponses(chatData, modelId) {
  const choice = (chatData.choices || [])[0] || {};
  const msg = choice.message || {};
  // Some providers return content in "reasoning" field instead of "content"
  let content = msg.content || msg.reasoning || "";
  const toolCalls = msg.tool_calls || [];

  // Strip <think> and <response> tags — reasoning embedded in content (old proxy behavior)
  content = content.replace(/<\/?think>/gi, '').replace(/<\/?response>/gi, '').trim();

  const output = [];

  // If the upstream returned content that looks like an XML tool call,
  // convert it to structured function_call instead of plain text
  if (content && toolCalls.length === 0) {
    const extracted = tryExtractToolCall(content);
    if (extracted) {
      // Convert to tool call instead of text message
      const callId = "call_" + Date.now();
      output.push({
        type: "function_call",
        call_id: callId,
        name: extracted.name,
        arguments: extracted.arguments,
        status: "completed",
      });
      // Clear content so we don't also emit a text message
      content = "";
    }
  }

  // Add message output
  if (content) {
    output.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: content }],
    });
  }

  // Add tool call outputs (Responses API format: call_id + name + arguments)
  for (const tc of toolCalls) {
    const fn = tc.function || {};
    const name = (fn.name || "").trim();
    const args = fn.arguments || "";
    // Skip empty function calls — model returned a tool_call with no name
    if (!name) {
      log.warn(`[responses] skipping empty tool_call (id=${tc.id || "?"})`);
      continue;
    }
    output.push({
      type: "function_call",
      call_id: tc.id || "call_" + Date.now(),
      name: name,
      arguments: args,
      status: "completed",
    });
  }

  return {
    id: chatData.id || "resp_" + Date.now(),
    object: "response",
    model: modelId,
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    output,
    usage: {
      input_tokens: (chatData.usage && chatData.usage.prompt_tokens) || chatData.usage?.input_tokens || 0,
      output_tokens: (chatData.usage && chatData.usage.completion_tokens) || chatData.usage?.output_tokens || 0,
      total_tokens: (chatData.usage && chatData.usage.total_tokens) || 0,
    },
  };
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
 * Make native HTTP/HTTPS request (bypasses undici/fetch proxy env issues).
 */
function nativeRequest(urlStr, options) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const mod = url.protocol === "https:" ? https : http;
    const reqTimeout = options.timeout || 30000;
    const req = mod.request(urlStr, {
      method: options.method || "POST",
      headers: options.headers || {},
      timeout: reqTimeout,
    }, (res) => resolve(res));
    req.on("error", e => { req.destroy(); reject(e); });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * Detect quota/rate-limit errors from upstream response.
 */
export { isQuotaError } from "./openai-chat.mjs";
