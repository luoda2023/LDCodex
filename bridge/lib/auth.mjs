/**
 * Auth Module — Request Authentication Gate
 *
 * Validates inbound API keys against the proxy key table.
 * Sets req.lockedProvider to restrict routing if the key is provider-locked.
 */

import { log } from "./logger.mjs";
import { AUTH } from "./config.mjs";

/**
 * Open routes that bypass auth.
 */
const OPEN_ROUTES = new Set([
  "/health",
  "/v1/models",
  "/models",
  "/api/status",
  "/api/dynmetrics",
]);

/**
 * Check if a URL is an open route (no auth required).
 */
export function isOpenRoute(url, method) {
  if (method !== "GET") return false;
  // Strip query params
  const path = url.split("?")[0].split("#")[0];
  return OPEN_ROUTES.has(path);
}

/**
 * Authenticate a request.
 *
 * On success, returns { authorized: true, lockedProvider: "*" | "deepseek" | ... }
 * On failure, returns { authorized: false, status: 401, body: { error: ... } }
 */
export function authenticate(req) {
  const header = req.headers["authorization"] || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  // No auth key configured = all requests pass
  if (!AUTH.enabled) {
    return { authorized: true, lockedProvider: "*", key: null };
  }

  // Open routes pass (but without provider lock)
  if (isOpenRoute(req.url, req.method)) {
    return { authorized: true, lockedProvider: "*", key: null };
  }

  // No token presented
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

  // Look up key
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

  // optional mode: unknown keys get wildcard
  const lockedProvider = lock || "*";
  return { authorized: true, lockedProvider, key: presented };
}
