/**
 * Custom Providers — 精简版
 *
 * 从 models.json 加载 provider，只支持 OpenAI 兼容 Chat Completions。
 */

import { log } from "./logger.mjs";
import { register } from "./provider-registry.mjs";
import { MODELS, slugify } from "./config.mjs";
import { proxyFetch } from "./protocol/openai-chat.mjs";

/**
 * 创建 provider 描述对象
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
    handler(ctx, req, body) {
      return proxyFetch(this.base, this.key, ctx, req, body);
    },
  };
}

/**
 * 注册所有自定义 provider
 */
export function registerCustom() {
  const registered = [];

  for (const entry of MODELS) {
    if (!entry.base || !entry.key) {
      log.debug(`[custom] skipping "${entry.name || entry.slug}": missing base or key`);
      continue;
    }

    try {
      const provider = createCustomProvider(entry);
      register(provider);
      registered.push(provider.name);
      log.info(`[custom] registered "${provider.name}" → ${provider.base}`);
    } catch (e) {
      log.warn(`[custom] failed to register "${entry.name || entry.slug}": ${e.message}`);
    }
  }

  if (registered.length === 0) {
    log.info("[custom] No custom providers loaded (empty models.json)");
  }

  return registered;
}
