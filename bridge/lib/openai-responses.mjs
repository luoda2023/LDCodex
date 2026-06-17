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

  // Convert Responses API -> Chat Completions
  const chatBody = responsesToChat(body, model);

  // Build upstream URL
  const base = provider.base.replace(/\/+$/, "");
  const upstreamUrl = base + "/chat/completions";

  const upstreamHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + provider.key,
    Accept: isStreaming ? "text/event-stream" : "application/json",
  };

  log.debug("[responses] " + provider.name + " model=" + model + " stream=" + isStreaming + " bodyLen=" + (body.input ? JSON.stringify(body.input).length : 0));

  try {
    // Use native request to bypass undici proxy issues
    const upstreamRes = await nativeRequest(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(chatBody),
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
      // Send response.failed event so CODEX CLI knows the request failed
      res.write("event: response.failed\ndata: " + JSON.stringify({
        type: "response.failed",
        response: {
          id: "resp_" + Date.now(),
          object: "response",
          model: model,
          created: Math.floor(Date.now() / 1000),
          status: "failed",
          error: { message: errorMsg, code: "upstream_error", type: "upstream_error" },
          output: [],
          usage: {}
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

          // Handle content delta (some providers use "reasoning" instead of "content")
          const textDelta = delta.content || delta.reasoning || "";
          if (textDelta) {
            outputTextLen += textDelta.length;
            accumulatedContent += textDelta;

            if (!hasStarted) {
              hasStarted = true;
              itemId = "msg_" + responseId;
              // 3) response.output_item.added (first time only)
              res.write("event: response.output_item.added\ndata: " + JSON.stringify({
                type: "response.output_item.added",
                item: { id: itemId, type: "message", role: "assistant", content: [] }
              }) + "\n\n");
              // 4) response.content_part.added (first time only)
              res.write("event: response.content_part.added\ndata: " + JSON.stringify({
                type: "response.content_part.added",
                part: { type: "output_text", text: "" },
                item_id: itemId
              }) + "\n\n");
            }

            // 5) response.output_text.delta (every content chunk)
            res.write("event: response.output_text.delta\ndata: " + JSON.stringify({
              type: "response.output_text.delta",
              delta: textDelta,
              item_id: itemId
            }) + "\n\n");
          }

          // Handle tool calls (may appear after or before content in stream)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!hasStarted) {
                hasStarted = true;
                itemId = tc.id || "call_" + responseId;
                // 1) response.output_item.added for function_call
                res.write("event: response.output_item.added\ndata: " + JSON.stringify({
                  type: "response.output_item.added",
                  item: {
                    id: itemId,
                    type: "function_call",
                    call_id: itemId,
                    name: tc.function?.name || "",
                    arguments: "",
                    status: "in_progress",
                  }
                }) + "\n\n");
              }
              // 2) stream arguments deltas
              const argsDelta = tc.function?.arguments || "";
              if (argsDelta) {
                res.write("event: response.function_call_arguments.delta\ndata: " + JSON.stringify({
                  type: "response.function_call_arguments.delta",
                  call_id: itemId,
                  delta: argsDelta,
                }) + "\n\n");
              }
            }
          }

          // Handle finish (stop, length, etc.)
          if (finishReason && hasStarted && !finished) {
            finished = true;
            // 6) response.output_text.done
            res.write("event: response.output_text.done\ndata: " + JSON.stringify({
              type: "response.output_text.done", item_id: itemId
            }) + "\n\n");
            // 7) response.output_item.done
            res.write("event: response.output_item.done\ndata: " + JSON.stringify({
              type: "response.output_item.done",
              item: {
                id: itemId, type: "message", role: "assistant",
                content: [{ type: "output_text", text: accumulatedContent }]
              }
            }) + "\n\n");
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    // Safety net: if upstream never sent finish_reason, emit completion events now
    if (hasStarted && !finished) {
      res.write("event: response.output_text.done\ndata: " + JSON.stringify({
        type: "response.output_text.done", item_id: itemId
      }) + "\n\n");
      res.write("event: response.output_item.done\ndata: " + JSON.stringify({
        type: "response.output_item.done",
        item: {
          id: itemId, type: "message", role: "assistant",
          content: [{ type: "output_text", text: accumulatedContent }]
        }
      }) + "\n\n");
    }

    // Fallback: estimate usage from text length if upstream didn't provide it
    if (!lastUsage && outputTextLen > 0) {
      const estimated = Math.max(1, Math.round(outputTextLen / 2));
      lastUsage = { prompt_tokens: 0, completion_tokens: estimated, total_tokens: estimated };
    }

    // 8) response.completed (CRITICAL: this is what CODEX CLI waits for)
    // Always send status="completed" - the stream itself is complete even if empty
    const usage = lastUsage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    res.write("event: response.completed\ndata: " + JSON.stringify({
      type: "response.completed",
      response: {
        id: responseId, object: "response", model: model,
        created: created,
        status: "completed",
        output: [],
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

        if (tcId && toolName && toolArgs) {
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
  // that Chinese upstream providers don't support, or tools with empty function defs)
  const rawTools = body.tools || body.functions || undefined;
  const tools = rawTools && Array.isArray(rawTools)
    ? rawTools.filter(t => {
        if (t.type && t.type !== "function") return false;
        if (!t.function || !t.function.name) return false;
        return true;
      })
    : rawTools;

  return {
    model,
    messages: merged,
    stream: body.stream === true,
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_output_tokens || body.max_tokens,
    tools,
    tool_choice: body.tool_choice,
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
  const content = msg.content || msg.reasoning || "";
  const toolCalls = msg.tool_calls || [];

  const output = [];

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
