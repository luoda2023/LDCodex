/**
 * Config Module — 精简版配置加载
 *
 * 只从 config-proxy.json 和 models.json 读取配置，无 SQLite。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Load .env manually (zero dependency, no dotenv) ──
function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
    return true;
  } catch (e) {
    if (e.code !== "ENOENT") log.warn("[config] .env load error:", e.message);
    return false;
  }
}

loadEnvFile(path.join(ROOT, ".env"));

// ── File paths ──
export const PATHS = {
  root: ROOT,
  models: path.join(ROOT, "models.json"),
  configProxy: path.join(ROOT, "config-proxy.json"),
  data: path.join(ROOT, "data"),
};

// ── Ports ──
export const PORTS = {
  proxy: parseInt(process.env.PROXY_PORT || "40005", 10),
};

// ── Proxy auth ──
export const AUTH = (() => {
  const authKey = (process.env.PROXY_AUTH_KEY || "").trim();
  const keysRaw = (process.env.PROXY_KEYS || "").trim();
  const keyTable = new Map();

  function parseCsv(str) {
    if (!str) return [];
    return str.split(";").map(s => s.trim()).filter(Boolean);
  }

  for (const entry of parseCsv(keysRaw)) {
    const idx = entry.lastIndexOf(":");
    if (idx === -1) {
      keyTable.set(entry, "*");
      continue;
    }
    const key = entry.slice(0, idx).trim();
    if (key) keyTable.set(key, "*");
  }
  if (authKey && !keyTable.has(authKey)) {
    keyTable.set(authKey, "*");
  }

  const mode = (process.env.PROXY_AUTH_MODE || "optional").toLowerCase();
  const enabled = mode !== "disabled" && (mode === "strict" || keyTable.size > 0);

  return { authKey, keyTable, mode, enabled };
})();

// ── Upstream timeout ──
export const UPSTREAM = {
  upstreamTimeout: parseInt(process.env.UPSTREAM_TIMEOUT_MS || "60000", 10),
};

// ── Load JSON data files ──
export function loadJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    if (e.code !== "ENOENT") log.warn(`[config] load ${filePath}: ${e.message}`);
    return fallback;
  }
}

export function saveJSON(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (e) {
    log.warn(`[config] save ${filePath}: ${e.message}`);
    return false;
  }
}

// ── Load models & config ──
export const MODELS = loadJSON(PATHS.models, []);
export const CONFIG_PROXY = loadJSON(PATHS.configProxy, {});

// ── Slugify helper ──
export function slugify(str) {
  if (!str) return "";
  let r = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str.charAt(i);
    if (/[a-zA-Z0-9]/.test(ch)) r += ch;
    else r += '\\u' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  }
  return r.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}
