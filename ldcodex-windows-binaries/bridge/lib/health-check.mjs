/**
 * Health Check Module — DISABLED
 *
 * Periodically checks all registered providers' health status.
 * DISABLED per user request (2026-06-13):
 *   "模型的健康程序取消了"
 *
 * This file is kept as a stub so existing imports don't break.
 * All functions are no-ops.
 */

export function initHealthCheck() {
  // DISABLED
  console.log('[health] health check is disabled');
}

export function stopHealthCheck() {
  // DISABLED
}

export async function runHealthCheck() {
  // DISABLED
}

export function getHealth(name) {
  return { status: 'unknown', failures: 0 };
}

export function getAllHealth() {
  return {};
}
