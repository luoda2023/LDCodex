/**
 * Logger Module - Unified Logging System
 *
 * LOG_LEVEL = silent | error | warn | info (default) | debug
 * ACCESS_LOG=0 suppresses per-request access lines
 */

const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function resolveLevel(name) {
  return LOG_LEVELS[(name || "info").toLowerCase()] ?? LOG_LEVELS.info;
}

const LOG_LEVEL = resolveLevel(process.env.LOG_LEVEL);
const ACCESS_LOG_ON = process.env.ACCESS_LOG !== "0" && LOG_LEVEL >= LOG_LEVELS.info;

export const log = {
  error: (...a) => { if (LOG_LEVEL >= LOG_LEVELS.error) console.error(...a); },
  warn:  (...a) => { if (LOG_LEVEL >= LOG_LEVELS.warn)  console.warn(...a); },
  info:  (...a) => { if (LOG_LEVEL >= LOG_LEVELS.info)  console.log(...a); },
  debug: (...a) => { if (LOG_LEVEL >= LOG_LEVELS.debug) console.log(...a); },
  access: (...a) => { if (ACCESS_LOG_ON) console.log(...a); },
};

export { LOG_LEVEL, LOG_LEVELS };
