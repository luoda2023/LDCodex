/**
 * Custom Providers
 *
 * Loads providers from models.json and registers them in the registry.
 * Each custom provider supports OpenAI-compatible Chat Completions API.
 */

import { log } from "./logger.mjs";
import { register } from "./provider-registry.mjs";
import { MODELS, slugify, loadJSON, PATHS } from "./config.mjs";
import { proxyFetch } from "./protocol/openai-chat.mjs";

/**
 * Create a custom provider descriptor from a models.json entry.
 */
export function createCustomProvider(entry) {
  const name = entry.name || entry.slug || "unknown";
  const slug = entry.slug || slugify(name);
  const models = entry.models || (entry.id ? [entry.id] : [slug]);
  const modelId = entry.id || models[0];

  return {
    name,
    slug,
    base: entry.base,
    key: entry.key,
    modelId,
    models,
    idx: typeof entry.idx === "number" ? entry.idx : 0,
    isBuiltin: false,
    // Tool format: "tools" (default), "functions" (deprecated), or "none"
    // Controls how tool definitions are sent to this provider
    tool_format: entry.tool_format || "tools",

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
 * Register all custom providers from models.json.
 */
export function registerCustom() {
  const registered = [];

  let entries;
  try { entries = loadJSON(PATHS.models, []); } catch(e) { entries = null; }
  if (!entries || entries.length === 0) entries = MODELS;

  for (const entry of entries) {
    if (!entry.base || !entry.key) {
      log.debug(`[custom] skipping "${entry.name || entry.slug}": missing base or key`);
      continue;
    }

    try {
      const provider = createCustomProvider(entry);
      register(provider);
      registered.push(provider.name);
      log.info(`[custom] registered "${provider.name}" â†?${provider.base}`);
    } catch (e) {
      log.warn(`[custom] failed to register "${entry.name || entry.slug}": ${e.message}`);
    }
  }

  if (registered.length === 0) {
    log.info("[custom] No custom providers loaded (empty models.json)");
  }

  return registered;
}
