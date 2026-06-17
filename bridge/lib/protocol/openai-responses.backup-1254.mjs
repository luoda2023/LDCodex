/**
 * OpenAI Responses API Protocol Handler
 *
 * Codex CLI uses OpenAI Responses API format. This handler converts
 * Responses API requests to Chat Completions for upstream providers,
 * then converts back.
 *
 * Key features:
 * - Vision model pre-processing: images → GLM-4.6V description → replace with text
 * - Always non-streaming: deepseek/sensenova returns complete tool_calls in non-streaming mode
 * - Accept header always consistent with actual stream mode
 */

import { log } from "../logger.mjs";
import { UPSTREAM } from "../config.mjs";
import { isQuotaError } from "./openai-chat.mjs";
import { find } from "../provider-registry.mjs";
import https from "node:https";
import http from "node:http";

// ── Vision Model Provider ──
// GLM-4.6V supports image understanding very well
const VISION_PROVIDER_NAMES = ["智谱2", "zhipu2", "GLM-4.6V"];

/**
 * Check if the request body contains input_image blocks.
 */
function checkForImages(input) {
  for (const item of input) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block.type === "input_image") return true;
      }
    }
  }
  return false;
}

/**
 * Extract image data from an input_image block.
 * Returns { imageData, mediaType } or null.
 */
function extractImageData(block) {
  const imgUrl = block.image_url || block.url;
  if (imgUrl) return { imageData: imgUrl, mediaType: "image/png" };

  if (block.source) {
    if (block.source.type === "base64") {
      return {
        imageData: "data:" + (block.source.media_type || "image/png") + ";base64," + block.source.data,
        mediaType: block.source.media_type || "image/png",
      };
    }
    const url = block.source.url || block.source.data;
    if (url) return { imageData: url, mediaType: "image/png" };
  }

  return null;
}

/**
 * Send image to vision model (GLM-4.6V) and get back a text description.
 * Uses non-streaming Chat Completions API.
 */
async function askVisionModel(provider, imageData) {
  const base = provider.base.replace(/\/+$/, "");
  const url = base + "/chat/completions";

  const visionBody = {
    model: provider.modelId || "GLM-4.6V",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Please describe this image in detail. Focus on what you see: text, objects, people, colors, layout, and any notable details. Be concise but thorough.",
          },
          { type: "image_url", image_url: { url: imageData } },
        ],
      },
    ],
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
    timeout: 30000,
  });

  const chunks = [];
  for await (const chunk of upstreamRes) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error("vision parse error: " + raw.substring(0, 200));
  }

  if ((upstreamRes.statusCode && upstreamRes.statusCode >= 400) || (data && data.error)) {
    const errMsg =
      data && data.error && data.error.message
        ? data.error.message
        : "vision request failed (status " + upstreamRes.statusCode + ")";
    throw new Error(errMsg);
  }

  const choice = (data.choices || [])[0] || {};
  const msg = choice.message || {};
  return msg.content || "(no description)";
}

/**
 * Describe all images in the request using a vision-capable model.
 * Returns a new body with input_image blocks replaced by text descriptions.
 * Falls back to original body if vision provider is unavailable or errors out.
 */
async function describeImagesWithVision(body) {
  if (!body.input || !Array.isArray(body.input)) return body;

  // Find vision provider
  let visionProvider = null;
  for (const name of VISION_PROVIDER_NAMES) {
    visionProvider = find(name);
    if (visionProvider) break;
  }

  if (!visionProvider) {
    log.warn("[vision] no vision provider found (tried: " + VISION_PROVIDER_NAMES.join(", ") + "), keeping original images");
    return body;
  }

  // Deep clone to avoid mutating original
  const newBody = JSON.parse(JSON.stringify(body));
  let replacedAny = false;

  for (const item of newBody.input) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;

    const newContent = [];
    for (const block of item.content) {
      if (block.type !== "input_image") {
        newContent.push(block);
        continue;
      }

      const extracted = extractImageData(block);
      if (!extracted) {
        newContent.push(block);
        continue;
      }

      try {
        log.debug("[vision] describing image via " + visionProvider.name + "...");
        const description = await askVisionModel(visionProvider, extracted.imageData);
        log.debug("[vision] got description (" + description.length + " chars)");
        newContent.push({
          type: "input_text",
          text: "[Image Description: " + description + "]",
        });
        replacedAny = true;
      } catch (e) {
        log.warn("[vision] vision model error: " + e.message + " - keeping original image");
        newContent.push(block);
      }
    }
    item.content = newContent;
  }

  if (!replacedAny) {
    log.debug("[vision] no images were replaced, returning original body");
    return body;
  }

  return newBody;
}

/**
 * Handle an OpenAI Responses API request by converting to Chat Completions
 * and proxying to the upstream provider.
 *
 * Always uses non-streaming mode because providers like deepseek/sensenova
 * do not return tool_calls in streaming delta events.
 */
export async function handleResponses(ctx, req, body) {
  const { res, provider, clientId } = ctx;
  const model = provider.modelId || body.model;
  const timeout = ctx.timeout || UPSTREAM.upstreamTimeout;

  // ── Detect and pre-process images via vision model ──
  let modifiedBody = body;
  let visionUsed = false;
  const hasImages = body.input && Array.isArray(body.input) && checkForImages(body.input);

  if (hasImages) {
    log.debug("[responses] images detected in request, describing via vision model...");
    modifiedBody = await describeImagesWithVision(body);
    visionUsed = modifiedBody !== body;
    if (visionUsed) {
      log.debug("[responses] images replaced with text descriptions");
    } else {
      log.debug("[responses] vision model not available or failed, sending images as-is in non-streaming mode");
    }
  }

  // Convert Responses API -> Chat Completions
  const chatBody = responsesToChat(modifiedBody, model);

  // Force non-streaming — deepseek/sensenova returns complete tool_calls
  // only in non-streaming mode. This is critical for CODEX tool folding.
  const isStreaming = false;
  chatBody.stream = false;

  // Build upstream URL
  const base = provider.base.replace(/\/+$/, "");
  const upstreamUrl = base + "/chat/completions";

  // Accept header must match actual stream mode (always non-streaming here)
  const upstreamHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + provider.key,
    Accept: "application/json",
  };

  log.debug(
    "[responses] " +
      provider.name +
      " model=" +
      model +
      " stream=false" +
      (visionUsed ? " (vision-described)" : hasImages ? " (images-sent-raw)" : "") +
      " bodyLen=" +
      (modifiedBody.input ? JSON.stringify(modifiedBody.input).length : 0)
  );

  try {
    // Use native request to bypass undici proxy issues
    const upstreamRes = await nativeRequest(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(chatBody),
      timeout,
    });

    const chunks = [];
    for await (const chunk of upstreamRes) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = { error: raw.substring(0, 200) };
    }

    if ((!upstreamRes.statusCode || upstreamRes.statusCode >= 400) || (data && data.error)) {
      // Return error to server.mjs for sanitized handling and fallback logic
      return { error: true, status: upstreamRes.statusCode || 502, data };
    }

    // Convert Chat Completions -> Responses API
    const responsesData = chatToResponses(data, model);
    log.debug(
      "[responses] output items=" +
        (responsesData.output ? responsesData.output.length : 0) +
        " toolCalls=" +
        (responsesData.output ? responsesData.output.filter((o) => o.type === "function_call").length : 0)
    );
    sendJson(res, 200, responsesData);
    return { error: false, data: data, tokens: extractTokens(data) };
  } catch (e) {
    log.warn(
      "[responses] upstream error: " +
        e.message +
        " stack=" +
        (e.stack ? e.stack.substring(0, 200) : "")
    );
    return {
      error: true,
      status: 502,
      data: { error: { message: e.message, type: "upstream_error" } },
    };
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
      content:
        "[System Instructions] " +
        body.instructions +
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
        const role = item.role === "developer" || item.role === "system" ? "user" : item.role;
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
                  imgUrl =
                    "data:" +
                    (block.source.media_type || "image/png") +
                    ";base64," +
                    block.source.data;
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
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === "assistant" && msg.tool_calls) {
        const tcList = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: tc.function,
        }));
        messages.unshift({
          role: "assistant",
          content: msg.content || null,
          tool_calls: tcList,
        });
      } else if (msg.role === "tool" && msg.tool_call_id) {
        messages.unshift({
          role: "tool",
          tool_call_id: msg.tool_call_id,
          content: msg.content || msg.output || "",
        });
      } else if (msg.role === "function_call") {
        const tcList = (msg.tool_calls || []).map((tc) => ({
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
        messages.unshift({ role: msg.role, content: msg.content });
      }
    }
  }

  // Normalize messages: merge consecutive same-role messages
  const merged = [];
  for (const msg of messages) {
    if (merged.length > 0) {
      const prev = merged[merged.length - 1];
      if (
        prev.role === msg.role &&
        typeof prev.content === "string" &&
        typeof msg.content === "string" &&
        !prev.tool_calls &&
        !msg.tool_calls &&
        prev.role !== "tool"
      ) {
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
      msg.content =
        msg.content.substring(0, TOOL_OUTPUT_MAX) +
        "\n\n[truncated: original output was " +
        msg.content.length +
        " chars]";
    }
  }

  // Handle tools - only pass valid function-type tools
  const rawTools = body.tools || body.functions || undefined;
  const tools =
    rawTools && Array.isArray(rawTools)
      ? rawTools.filter((t) => {
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
 */
function chatToResponses(chatData, modelId) {
  const choice = (chatData.choices || [])[0] || {};
  const msg = choice.message || {};
  const content = msg.content || "";
  const reasoningContent = msg.reasoning_content || msg.reasoning || "";
  const toolCalls = msg.tool_calls || [];

  const output = [];

  // Add reasoning output item
  if (reasoningContent) {
    output.push({
      type: "reasoning",
      status: "completed",
      content: [{ type: "output_text", text: reasoningContent }],
    });
  }

  // Add message output
  if (content) {
    output.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: content }],
    });
  }

  // Add tool call outputs (Responses API format)
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
    const req = mod.request(
      urlStr,
      {
        method: options.method || "POST",
        headers: options.headers || {},
        timeout: reqTimeout,
      },
      (res) => resolve(res)
    );
    req.on("error", (e) => {
      req.destroy();
      reject(e);
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * Detect quota/rate-limit errors from upstream response.
 */
export { isQuotaError } from "./openai-chat.mjs";
