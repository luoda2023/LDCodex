/**
 * Provider Registry Module
 *
 * Central registry for all AI providers (both built-in and custom).
 * Providers register themselves with a name and handler functions.
 *
 * A provider is any object that implements:
 *   { name, base, key, supportedModels[], handler(ctx, body) }
 */

import { log } from "./logger.mjs";

// ── Internal state ──
const _providers = new Map();   // name.toLowerCase() → provider descriptor
const _modelMap = new Map();     // modelName.toLowerCase() → provider name
const _nameSlugMap = new Map();  // slug → name

// ── Provider descriptor shape ──
// {
//   name: "deepseek",          // unique key
//   slug: "deepseek-v4-pro",   // display slug
//   base: "https://...",       // upstream base URL
//   key: "sk-...",             // API key
//   modelId: "deepseek-chat",  // model ID sent upstream
//   models: ["deepseek-chat"], // supported model names
//   isBuiltin: true,           // built-in vs custom
//   handler: async function(ctx, req, body) { ... },
//   healthCheck: async function() { ... },
// }

/**
 * Register a provider in the registry.
 */
export function register(provider) {
  const key = provider.name.toLowerCase();
  const existing = _providers.get(key);

  if (existing) {
    log.warn(`[registry] provider "${provider.name}" already registered, overwriting`);
  }

  _providers.set(key, provider);

  // Map models → provider
  const models = provider.models || [];
  for (const model of models) {
    _modelMap.set(model.toLowerCase(), key);
    if (provider.modelId && model.toLowerCase() !== provider.modelId.toLowerCase()) {
      _modelMap.set(provider.modelId.toLowerCase(), key);
    }
  }

  // Map slug → name
  if (provider.slug) {
    _nameSlugMap.set(provider.slug.toLowerCase(), key);
  }

  log.debug(`[registry] registered provider: ${provider.name} (${models.length} models)`);
  return provider;
}

/**
 * Unregister a provider by name.
 */
export function unregister(name) {
  const key = name.toLowerCase();
  const provider = _providers.get(key);
  if (!provider) return false;

  // Clean up model mappings
  const models = provider.models || [];
  for (const model of models) {
    _modelMap.delete(model.toLowerCase());
  }

  _nameSlugMap.delete((provider.slug || "").toLowerCase());
  _providers.delete(key);
  log.debug(`[registry] unregistered provider: ${provider.name}`);
  return true;
}

/**
 * Find a provider by name or slug.
 */
export function find(nameOrSlug) {
  if (!nameOrSlug) return null;
  const key = nameOrSlug.toLowerCase();

  // Direct name match first
  if (_providers.has(key)) return _providers.get(key);

  // Slug match
  const slugKey = _nameSlugMap.get(key);
  if (slugKey && _providers.has(slugKey)) return _providers.get(slugKey);

  // Partial name match (e.g. "deep" matches "deepseek")
  for (const [k, p] of _providers) {
    if (k.includes(key) || key.includes(k)) return p;
  }

  return null;
}

/**
 * Find provider for a given model name.
 */
export function findForModel(modelName) {
  if (!modelName) return null;
  const key = modelName.toLowerCase();

  // Direct model match
  if (_modelMap.has(key)) {
    const providerKey = _modelMap.get(key);
    return _providers.get(providerKey) || null;
  }

  // Prefix match (e.g. "gpt-4" matches "gpt-" prefix)
  for (const [modelPattern, providerKey] of _modelMap) {
    if (key.startsWith(modelPattern) || modelPattern.startsWith(key)) {
      return _providers.get(providerKey) || null;
    }
  }

  return null;
}

/**
 * Get all registered providers.
 */
export function getAll() {
  return Array.from(_providers.values());
}

/**
 * Get all built-in providers.
 */
export function getBuiltins() {
  return getAll().filter(p => p.isBuiltin);
}

/**
 * Get all custom providers (from models.json).
 */
export function getCustom() {
  return getAll().filter(p => !p.isBuiltin);
}

/**
 * Get count of registered providers.
 */
export function getCount() {
  return _providers.size;
}

/**
 * Check if a provider name is built-in.
 */
export function isBuiltin(name) {
  const p = find(name);
  return p ? p.isBuiltin : true; // not found = treat as builtin
}

/**
 * Iterate all providers (for health checks, etc.)
 */
export function forEach(fn) {
  for (const [, provider] of _providers) {
    fn(provider);
  }
}
