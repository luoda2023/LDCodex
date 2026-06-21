/**
 * Dynamic Concurrency Module
 *
 * Slot-based concurrency pool with auto-tuning based on response latency.
 * Re-exports from the existing dynamic_limiter.mjs.
 */

import { log } from "./logger.mjs";
import { DYN_CONCURRENCY } from "./config.mjs";

let currentSlots = DYN_CONCURRENCY.min;
let activeCount = 0;
let drained = false;
let drainSettleResolve = null;

const WINDOW_SIZE = 20;
const latencyWindow = new Float64Array(WINDOW_SIZE);
let latencyStart = 0;
let latencyCount = 0;
let latencySum = 0;

const waitQueue = [];

const stats = {
  totalAcquired: 0,
  totalRejected: 0,
  totalTimedOut: 0,
  currentWaiters: 0,
  peakActive: 0,
  lastTunedAt: Date.now(),
  currentSlots,
};

let _tuneTimer = null;

function currentLatencyAvg() {
  if (latencyCount === 0) return 0;
  return latencySum / latencyCount;
}

function recordLatency(ms) {
  if (latencyCount < WINDOW_SIZE) {
    latencyWindow[latencyCount] = ms;
    latencySum += ms;
    latencyCount++;
  } else {
    const idx = latencyStart % WINDOW_SIZE;
    latencySum -= latencyWindow[idx];
    latencyWindow[idx] = ms;
    latencySum += ms;
    latencyStart++;
  }
}

function autoTune() {
  if (drained) return;
  const avg = currentLatencyAvg();
  if (avg === 0) return;

  if (avg < DYN_CONCURRENCY.targetLatency * 0.7) {
    currentSlots = Math.min(currentSlots + 1, DYN_CONCURRENCY.max);
  } else if (avg > DYN_CONCURRENCY.targetLatency * 1.3) {
    currentSlots = Math.max(currentSlots - 1, DYN_CONCURRENCY.min);
  }

  stats.lastTunedAt = Date.now();
  stats.currentSlots = currentSlots;
  pumpQueue();
}

function pumpQueue() {
  while (waitQueue.length > 0 && activeCount < currentSlots) {
    const waiter = waitQueue.shift();
    if (waiter.expired) {
      stats.totalTimedOut++;
      continue;
    }
    activeCount++;
    stats.currentWaiters = waitQueue.length;
    stats.peakActive = Math.max(stats.peakActive, activeCount);
    waiter.resolve(true);
  }
}

function startAutoTune() {
  if (_tuneTimer) clearInterval(_tuneTimer);
  _tuneTimer = setInterval(autoTune, DYN_CONCURRENCY.tuneInterval);
  _tuneTimer.unref();
}

/**
 * Acquire a concurrency slot.
 */
export function acquireSlot(timeoutMs) {
  if (drained) return Promise.resolve(false);

  if (activeCount < currentSlots) {
    activeCount++;
    stats.totalAcquired++;
    stats.peakActive = Math.max(stats.peakActive, activeCount);
    return Promise.resolve(true);
  }

  // Queue the request
  return new Promise((resolve) => {
    const waiter = { resolve, expired: false };

    if (timeoutMs && timeoutMs > 0) {
      setTimeout(() => {
        waiter.expired = true;
        stats.totalTimedOut++;
        resolve(false);
      }, timeoutMs);
    }

    waitQueue.push(waiter);
    stats.currentWaiters = waitQueue.length;
  });
}

/**
 * Release a concurrency slot.
 */
export function releaseSlot() {
  activeCount = Math.max(0, activeCount - 1);
  pumpQueue();
}

/**
 * Record a response latency measurement.
 */
export function recordLatencyMs(ms) {
  recordLatency(ms);
}

/**
 * Get current metrics.
 */
export function getMetrics() {
  return {
    currentSlots,
    activeCount,
    waitQueueLength: waitQueue.length,
    ...stats,
    avgLatency: currentLatencyAvg(),
    drainState: drained,
  };
}

/**
 * Start draining (for graceful shutdown).
 */
export function startDrain() {
  drained = true;
  if (_tuneTimer) clearInterval(_tuneTimer);
  log.info("[concurrency] drain started, no new slots will be issued");
}

/**
 * Wait for all active requests to complete.
 */
export function waitForDrain(timeoutMs = 30000) {
  if (activeCount === 0 && waitQueue.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      log.warn("[concurrency] drain timeout, force resolving");
      resolve();
    }, timeoutMs);
    drainSettleResolve = () => { clearTimeout(timer); resolve(); };
  });
}

/**
 * Trigger a hot restart.
 */
export function triggerHotRestart() {
  log.info("[concurrency] hot restart triggered");
  // In production, this would emit an event for the main process
  process.emit("hot-restart");
}

// Initialize auto-tune on import
startAutoTune();

// Dynamic concurrency feature flag
const DYNAMIC_ENABLED = true;

export { DYNAMIC_ENABLED };
