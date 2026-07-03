/**
 * Provider Module — 单路代理 (codexAPI only)
 *
 * 从 models.json 中获取第一个有效 provider，或从 CONFIG_PROXY.single_model 读取。
 * 替换原 fallback.mjs 的多链/多客户端/额度检测等复杂逻辑。
 */

import { log } from "./logger.mjs";
import { CONFIG_PROXY } from "./config.mjs";
import { find, getAll } from "./provider-registry.mjs";

/**
 * 获取当前 provider。
 * 优先使用 single_model 配置，否则取 models.json 中第一个注册的 provider。
 */
export function getProvider() {
  // 1. 从配置读取锁定模型
  const singleModel = CONFIG_PROXY.single_model || "";
  if (singleModel) {
    const provider = find(singleModel);
    if (provider) return provider;
    log.warn(`[provider] single_model "${singleModel}" 未找到，fallback 到列表第一个`);
  }

  // 2. 取列表第一个
  const all = getAll();
  if (all.length > 0) return all[0];

  return null;
}

/**
 * 获取完整状态（用于 proxy-info 页面）
 */
export function getFullStatus() {
  const provider = getProvider();
  return {
    provider_online: !!provider,
    provider_name: provider ? provider.name : null,
    provider_slug: provider ? provider.slug : null,
    provider_base: provider ? provider.base : null,
    provider_model: provider ? provider.modelId : null,
    providers_total: getAll().length,
    uptime: process.uptime(),
    uptime_text: formatUptime(process.uptime()),
  };
}

function formatUptime(seconds) {
  if (seconds < 60) return Math.round(seconds) + "秒";
  if (seconds < 3600) return Math.round(seconds / 60) + "分" + Math.round(seconds % 60) + "秒";
  if (seconds < 86400) return Math.round(seconds / 3600) + "小时" + Math.round((seconds % 3600) / 60) + "分";
  return Math.round(seconds / 86400) + "天" + Math.round((seconds % 86400) / 3600) + "小时";
}
