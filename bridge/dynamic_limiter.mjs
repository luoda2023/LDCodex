// ─────────────────────────────────────────────────────────
// dynamic_limiter.mjs — Dynamic concurrency limiter with async queue
// ─────────────────────────────────────────────────────────
// Features:
//   • Slot-based concurrency pool (min 5 / max 50, auto‑tuned)
//   • FIFO async wait queue — never drop requests, just queue
//   • Latency‑driven auto‑tuning: < target → add slots, > target → remove slots
//   • Drain state for graceful shutdown / hot restart
//   • Metrics endpoint for config‑ui / /api/status
//   • Hot‑restart event emitter
// ─────────────────────────────────────────────────────────

import { EventEmitter } from "node:events";

// ── Bounds & tuning ──────────────────────────────────────

const MIN_CONCURRENCY   = Number(process.env.DYN_LIMIT_MIN) || 5;
const MAX_CONCURRENCY   = Number(process.env.DYN_LIMIT_MAX) || 50;
const TARGET_LATENCY_MS = Number(process.env.DYN_TARGET_LATENCY) || 30000; // 30 s
const TUNE_INTERVAL_MS  = Number(process.env.DYN_TUNE_INTERVAL) || 60000; // 60 s
const WINDOW_SIZE       = Number(process.env.DYN_WINDOW) || 20; // last N requests

// ── State ─────────────────────────────────────────────

let currentSlots       = MIN_CONCURRENCY;
let activeCount        = 0;
let drained            = false;   // true → no new slots, wait queue gets rejected
let drainSettleResolve = null;

/** Rolling response‑time window (most recent WINDOW_SIZE entries) */
const latencyWindow = [];
let  latencySum     = 0;

/** FIFO wait queue */
const waitQueue = [];

/** Stats for monitoring */
const stats = {
  totalAcquired:  0,
  totalRejected:  0,
  totalTimedOut:  0,
  currentWaiters: 0,
  peakActive:     0,
  lastTunedAt:    Date.now(),
  currentSlots,
};

// ── Event bus for hot restart ────────────────────────

const bus = new EventEmitter();
bus.setMaxListeners(100);

// ── Helpers ──────────────────────────────────────────

function currentLatencyAvg() {
  if (latencyWindow.length === 0) return 0;
  return latencySum / latencyWindow.length;
}

function recordLatency(ms) {
  latencyWindow.push(ms);
  latencySum += ms;
  while (latencyWindow.length > WINDOW_SIZE) {
    const removed = latencyWindow.shift();
    latencySum -= removed;
  }
}

let _tuneTimer = setInterval(autoTune, TUNE_INTERVAL_MS);
_tuneTimer.unref();

function autoTune() {
  if (drained) return;
  const avg = currentLatencyAvg();
  if (avg === 0) return; // no data yet

  if (avg < TARGET_LATENCY_MS * 0.7) {
    // Response is fast — increase capacity
    currentSlots = Math.min(currentSlots + 2, MAX_CONCURRENCY);
  } else if (avg > TARGET_LATENCY_MS * 1.3) {
    // Response is slow — reduce load
    currentSlots = Math.max(currentSlots - 2, MIN_CONCURRENCY);
  }
  // else: within acceptable range → hold steady

  stats.lastTunedAt = Date.now();
  stats.currentSlots = currentSlots;
  pumpQueue(); // try to serve waiters
}

// ── Core API ─────────────────────────────────────────

/**
 * Acquire a slot. Returns immediately if slots available,
 * otherwise waits in the FIFO queue.
 *
 * @param {number} [timeoutMs] - optional max wait in queue (0 = no wait)
 * @returns {Promise<boolean>} true if slot acquired, false if timed out / drained
 */
function acquireSlot(timeoutMs) {
  if (drained) return Promise.resolve(false);

  if (activeCount < currentSlots) {
    activeCount++;
    stats.totalAcquired++;
    stats.peakActive = Math.max(stats.peakActive, activeCount);
    stats.currentWaiters = waitQueue.length;
    return Promise.resolve(true);
  }

  // No slots available — enqueue
  return new Promise((resolve) => {
    const entry = { resolve };
    waitQueue.push(entry);
    stats.currentWaiters = waitQueue.length;

    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      entry._timer = setTimeout(() => {
        const idx = waitQueue.indexOf(entry);
        if (idx !== -1) {
          waitQueue.splice(idx, 1);
          stats.currentWaiters = waitQueue.length;
          stats.totalTimedOut++;
          resolve(false);
        }
      }, timeoutMs);
    }
  });
}

/**
 * Release a previously acquired slot.
 * Immediately hands it to the next waiter (FIFO).
 */
function releaseSlot() {
  if (activeCount > 0) activeCount--;

  // Try to pass slot to next waiter
  while (activeCount < currentSlots && waitQueue.length > 0) {
    const entry = waitQueue.shift();
    stats.currentWaiters = waitQueue.length;
    if (entry._timer) clearTimeout(entry._timer);
    activeCount++;
    stats.totalAcquired++;
    stats.peakActive = Math.max(stats.peakActive, activeCount);
    entry.resolve(true);
  }
}

/**
 * Run an async function inside a concurrency slot.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.timeout] - max queue wait
 * @returns {Promise<T>}
 */
async function withSlot(fn, opts = {}) {
  const acquired = await acquireSlot(opts.timeout);
  if (!acquired) {
    stats.totalRejected++;
    throw Object.assign(new Error("Concurrency limit: no slot available"), {
      code: "CONCURRENCY_LIMIT",
      drained,
    });
  }

  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    recordLatency(Date.now() - t0);
    releaseSlot();
  }
}

/**
 * Same as withSlot but scoped to a resource group (for future use).
 * Currently just an alias; can be extended for per‑provider limits.
 */
function withSlotOf(/* resourceKey */ fn, opts) {
  return withSlot(fn, opts);
}

// ── Drain & restart ──────────────────────────────────

/**
 * Enter drain state. No new slots will be issued.
 * Current requests are allowed to finish.
 * Returns a promise that resolves when all active slots are released.
 */
function triggerHotRestart() {
  if (drained) return;
  drained = true;
  clearInterval(_tuneTimer);
  _tuneTimer = null;

  // Reject all pending waiters
  while (waitQueue.length > 0) {
    const entry = waitQueue.shift();
    if (entry._timer) clearTimeout(entry._timer);
    stats.totalRejected++;
    entry.resolve(false);
  }
  stats.currentWaiters = 0;

  // Signal restart
  bus.emit("restart");

  // Wait for active requests to finish
  return new Promise((resolve) => {
    drainSettleResolve = resolve;
    checkDrainSettle();
  });
}

function checkDrainSettle() {
  if (activeCount === 0) {
    if (drainSettleResolve) {
      drainSettleResolve();
      drainSettleResolve = null;
    }
    bus.emit("drained");
    return;
  }
  // Retry shortly
  setTimeout(checkDrainSettle, 500).unref();
}

/** @returns {boolean} */
function getDrainState() { return drained; }

/** `true` if auto‑tuning is enabled */
const DYNAMIC_ENABLED = true;

// ── Metrics ─────────────────────────────────────────

function getDynMetrics() {
  return {
    enabled:             DYNAMIC_ENABLED,
    drained,
    currentSlots,
    maxSlots:            MAX_CONCURRENCY,
    minSlots:            MIN_CONCURRENCY,
    activeCount,
    peakActive:          stats.peakActive,
    waitQueueDepth:      waitQueue.length,
    latencyAvgMs:        Math.round(currentLatencyAvg()),
    targetLatencyMs:     TARGET_LATENCY_MS,
    totalAcquired:       stats.totalAcquired,
    totalRejected:       stats.totalRejected,
    totalTimedOut:       stats.totalTimedOut,
    lastTunedAt:         stats.lastTunedAt,
    uptimeMs:            Date.now() - global.__luodabridge_start || Date.now(),
  };
}

// ── Exports ─────────────────────────────────────────

export {
  withSlot,
  withSlotOf,
  acquireSlot,
  releaseSlot,
  getDynMetrics,
  DYNAMIC_ENABLED,
  triggerHotRestart,
  getDrainState,
  bus,
};
