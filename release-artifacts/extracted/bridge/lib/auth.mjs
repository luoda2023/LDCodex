/**
 * Auth Module — 请求认证
 *
 * 验证 Bearer token，所有有效 key 统一权限。
 */

import { log } from "./logger.mjs";
import { AUTH } from "./config.mjs";

/**
 * 开放路由（无需认证）
 */
const OPEN_ROUTES = new Set([
  "/health",
  "/v1/models",
  "/models",
  "/api/proxy-info",
]);

/**
 * 检查是否开放路由
 */
export function isOpenRoute(url, method) {
  if (method !== "GET") return false;
  const path = url.split("?")[0].split("#")[0];
  return OPEN_ROUTES.has(path);
}

/**
 * 认证请求
 */
export function authenticate(req) {
  const header = req.headers["authorization"] || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  // 未启用认证 → 放行
  if (!AUTH.enabled) {
    return { authorized: true, key: null };
  }

  // 开放路由放行
  if (isOpenRoute(req.url, req.method)) {
    return { authorized: true, key: null };
  }

  // 无 token
  if (!presented) {
    return {
      authorized: false,
      status: 401,
      body: {
        error: {
          message: "Missing proxy key. Set Authorization: Bearer <key>.",
          type: "invalid_request_error",
          code: "proxy_auth_required",
        },
      },
    };
  }

  // 查 key 表
  const lock = AUTH.keyTable.get(presented);
  if (!lock && AUTH.mode === "strict") {
    return {
      authorized: false,
      status: 401,
      body: {
        error: {
          message: "Invalid proxy key.",
          type: "invalid_request_error",
          code: "proxy_auth_invalid",
        },
      },
    };
  }

  return { authorized: true, key: presented };
}
