/**
 * Built-in Providers
 *
 * Registers DeepSeek, MiMo, and OpenAI as built-in providers.
 * Each provider supports OpenAI-compatible Chat Completions API.
 */

import { log } from "./logger.mjs";
import { register } from "./provider-registry.mjs";
import { UPSTREAM } from "./config.mjs";
import { proxyFetch } from "./protocol/openai-chat.mjs";

/**
 * Create a built-in provider descriptor.
 */
function createBuiltinProvider(name, config, modelList, defaultModel) {
  const models = (modelList && modelList.length > 0) ? modelList : (defaultModel ? [defaultModel] : []);
  const modelId = models[0] || defaultModel || name;

  return {
    name,
    slug: name,
    base: config.base,
    key: config.key,
    modelId,
    models,
    isBuiltin: true,
    disabled: !config.key,

    async handler(ctx, req, body) {
      return proxyFetch(this.base, this.key, ctx, req, body);
    },

    async healthCheck() {
      try {
        const res = await fetch(`${this.base}/models`, {
          headers: { Authorization: `Bearer ${this.key}` },
          signal: AbortSignal.timeout(5000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Register all built-in providers.
 */
export function registerBuiltins() {
  const providers = [];

  // DeepSeek
  if (UPSTREAM.deepseek.key) {
    const p = createBuiltinProvider(
      "deepseek",
      UPSTREAM.deepseek,
      UPSTREAM.deepseek.models,
      "deepseek-chat"
    );
    register(p);
    providers.push(p.name);
    log.info(`[builtin] registered DeepSeek (${UPSTREAM.deepseek.models.join(", ")})`);
  }

  // MiMo
  if (UPSTREAM.mimo.key) {
    const p = createBuiltinProvider(
      "mimo",
      UPSTREAM.mimo,
      UPSTREAM.mimo.models,
      "mimo-chat"
    );
    register(p);
    providers.push(p.name);
    log.info(`[builtin] registered MiMo (${UPSTREAM.mimo.models.join(", ")})`);
  }

  // OpenAI
  if (UPSTREAM.openai.key) {
    const p = createBuiltinProvider(
      "openai",
      UPSTREAM.openai,
      UPSTREAM.openai.models,
      "gpt-4o"
    );
    register(p);
    providers.push(p.name);
    log.info(`[builtin] registered OpenAI (prefixes: ${UPSTREAM.openai.modelPrefixes.join(", ")})`);
  }

  if (providers.length === 0) {
    log.warn("[builtin] No built-in providers configured (check .env API keys)");
  }

  return providers;
}
