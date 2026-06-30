/**
 * Built-in Providers
 *
 * For LDCodex, the proxy must only use models configured in the manager.
 * Built-in providers from the standalone VPS platform are intentionally disabled.
 */

import { log } from "./logger.mjs";

/**
 * Register all built-in providers.
 *
 * LDCodex 规范：代理服务器不得使用本机平台自带的模型；
 * 必须只使用「模型设置」里添加的模型配置。
 */
export function registerBuiltins() {
  log.info("[builtin] LDCodex mode: skip built-in provider registration");
  return [];
}
