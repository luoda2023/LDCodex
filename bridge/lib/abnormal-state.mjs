/**
 * Abnormal State Manager
 *
 * 设计目标：
 * - 对外保留用户原始输入（大小写、中英文均原样保存）
 * - 对内提供大小写不敏感 + slug/name 双索引匹配
 * - 避免 abnormal_models / _abnormal_reasons / _providerQuotaState 出现“查不到、删不掉、重复进”的问题
 */

import { log } from "./logger.mjs";
import { getAll, find } from "./provider-registry.mjs";

// 原始列表，保留用户输入原样
let _abnormalList = [];
// reasons key 也保留原样
let _abnormalReasons = {};

// 内部索引：normalizedKey -> originalKey
const _normToOriginal = new Map();
// 反向索引：originalKey -> normalizedKey
const _originalToNorm = new Map();

function _normalizeKey(key) {
  if (!key || typeof key !== "string") return "";
  return key.trim().toLowerCase();
}

function _rebuildIndex() {
  _normToOriginal.clear();
  _originalToNorm.clear();
  for (const raw of _abnormalList) {
    const norm = _normalizeKey(raw);
    if (!norm) continue;
    _normToOriginal.set(norm, raw);
    _originalToNorm.set(raw, norm);
  }
}

export function initAbnormalState(list, reasons) {
  _abnormalList = Array.isArray(list) ? list.slice() : [];
  _abnormalReasons = reasons && typeof reasons === "object" ? { ...reasons } : {};
  _rebuildIndex();
}

/**
 * 判断某个 key 是否已在 abnormal 中（大小写不敏感）
 */
export function isAbnormal(key) {
  if (!key) return false;
  const norm = _normalizeKey(key);
  if (!norm) return false;
  // 直接命中
  if (_abnormalList.indexOf(key) >= 0) return true;
  // normalized 命中
  if (_normToOriginal.has(norm)) return true;
  // 尝试通过 provider slug/name 兼容
  const provider = find(key);
  if (provider) {
    const slugNorm = _normalizeKey(provider.slug || "");
    const nameNorm = _normalizeKey(provider.name || "");
    if (slugNorm && _normToOriginal.has(slugNorm)) return true;
    if (nameNorm && _normToOriginal.has(nameNorm)) return true;
  }
  return false;
}

/**
 * 添加 abnormal（保留原始 key，内部去重）
 */
export function addAbnormal(key, reason) {
  if (!key) return false;
  const trimmed = String(key).trim();
  const norm = _normalizeKey(trimmed);
  if (!norm) return false;

  // 如果已经存在（原样或 normalized），不重复添加
  if (_abnormalList.indexOf(trimmed) >= 0 || _normToOriginal.has(norm)) {
    return false;
  }

  _abnormalList.push(trimmed);
  if (reason !== undefined && reason !== null && String(reason).trim() !== "") {
    _abnormalReasons[trimmed] = String(reason).trim();
  }
  _rebuildIndex();
  return true;
}

/**
 * 移除 abnormal（大小写不敏感）
 */
export function removeAbnormal(key) {
  if (!key) return false;
  const trimmed = String(key).trim();
  const norm = _normalizeKey(trimmed);

  // 精确移除
  let idx = _abnormalList.indexOf(trimmed);
  if (idx >= 0) {
    _abnormalList.splice(idx, 1);
  } else {
    // normalized 移除
    const original = _normToOriginal.get(norm);
    if (original) {
      idx = _abnormalList.indexOf(original);
      if (idx >= 0) _abnormalList.splice(idx, 1);
    } else {
      // 兼容 provider slug/name
      const provider = find(trimmed);
      if (provider) {
        const slugNorm = _normalizeKey(provider.slug || "");
        const nameNorm = _normalizeKey(provider.name || "");
        const candidate = _normToOriginal.get(slugNorm) || _normToOriginal.get(nameNorm);
        if (candidate) {
          idx = _abnormalList.indexOf(candidate);
          if (idx >= 0) _abnormalList.splice(idx, 1);
        } else {
          return false;
        }
      } else {
        return false;
      }
    }
  }

  // reasons 同步清理：原样 key 或 normalized key 都删
  delete _abnormalReasons[trimmed];
  delete _abnormalReasons[norm];
  const originalByNorm = _normToOriginal.get(norm);
  if (originalByNorm) delete _abnormalReasons[originalByNorm];

  _rebuildIndex();
  return true;
}

/**
 * 获取当前 abnormal 列表（原样）
 */
export function getAbnormalList() {
  return _abnormalList.slice();
}

/**
 * 获取 reasons（原样）
 */
export function getAbnormalReasons() {
  return { ..._abnormalReasons };
}

/**
 * 根据 key 获取 reason（大小写不敏感）
 */
export function getReason(key) {
  if (!key) return "";
  const trimmed = String(key).trim();
  const norm = _normalizeKey(trimmed);

  // 精确
  if (_abnormalReasons[trimmed]) return _abnormalReasons[trimmed];
  // normalized
  if (_abnormalReasons[norm]) return _abnormalReasons[norm];
  // provider 兼容
  const provider = find(trimmed);
  if (provider) {
    const slugNorm = _normalizeKey(provider.slug || "");
    const nameNorm = _normalizeKey(provider.name || "");
    const candidate = _normToOriginal.get(slugNorm) || _normToOriginal.get(nameNorm);
    if (candidate && _abnormalReasons[candidate]) return _abnormalReasons[candidate];
  }
  return "";
}

/**
 * 清理状态：用于恢复异常时重置
 */
export function clearState(key) {
  if (!key) return;
  const trimmed = String(key).trim();
  const norm = _normalizeKey(trimmed);
  // 如果存在则移除
  removeAbnormal(trimmed);
  // reasons 额外清理
  delete _abnormalReasons[trimmed];
  delete _abnormalReasons[norm];
}

/**
 * 清理 provider quota 状态相关的映射（对外保持原接口）
 */
export function syncFromRaw(list, reasons) {
  // ★ 去重：按 normalized key 保留第一个出现的原始 key，避免 "cloud1"+"Cloud1" 并存
  const seen = new Set();
  _abnormalList = [];
  if (Array.isArray(list)) {
    for (const raw of list) {
      const norm = _normalizeKey(raw);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      _abnormalList.push(raw);
    }
  }
  _abnormalReasons = reasons && typeof reasons === "object" ? { ...reasons } : {};
  _rebuildIndex();
}
