/**
 * 自定义模型池：虚拟模型配置
 *
 * 一个虚拟模型 = 一个对外暴露的模型 ID，内部包含多个真实 API 端点。
 * 当某个端点返回 429 / 额度耗尽时，自动轮转到下一个端点；
 * 当该虚拟模型下所有端点都耗尽时，切换到下一个虚拟模型。
 */

export type VirtualEndpoint = {
  id: string;
  /** API 基础地址，如 https://api.openai.com/v1 */
  baseUrl: string;
  /** API 密钥 */
  apiKey: string;
  /** 该端点实际使用的模型 ID（如 gpt-4o） */
  modelId: string;
  /** 可选备注名 */
  label: string;
  /** 是否启用 */
  enabled: boolean;
};

export type VirtualModel = {
  id: string;
  /** 对外暴露的虚拟模型名称，如 "my-gpt4o" */
  name: string;
  /** 对外暴露的虚拟模型 ID（Codex 里配置的 model） */
  virtualModelId: string;
  /** 端点列表 */
  endpoints: VirtualEndpoint[];
  /** 轮转策略：429 或额度耗尽时切换 */
  strategy: "failover";
  /** 是否启用 */
  enabled: boolean;
};

export type VirtualModelConfig = {
  models: VirtualModel[];
};

const STORAGE_KEY = "ldcodex_virtual_models";

let cache: VirtualModelConfig | null = null;

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function loadVirtualModelConfig(): VirtualModelConfig {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cache = JSON.parse(raw) as VirtualModelConfig;
      return cache!;
    }
  } catch {
    // ignore
  }
  cache = { models: [] };
  return cache;
}

export function saveVirtualModelConfig(config: VirtualModelConfig): void {
  cache = config;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function createEmptyVirtualModel(): VirtualModel {
  return {
    id: uid(),
    name: "",
    virtualModelId: "",
    endpoints: [],
    strategy: "failover",
    enabled: true,
  };
}

export function createEmptyEndpoint(): VirtualEndpoint {
  return {
    id: uid(),
    baseUrl: "",
    apiKey: "",
    modelId: "",
    label: "",
    enabled: true,
  };
}

/** 端点失败状态 */
export type EndpointFailoverState = {
  /** 端点 ID */
  endpointId: string;
  /** 失败时间戳 */
  failedAtMs: number;
  /** 失败原因 */
  reason: string;
};

/** 模型当前活跃端点索引 */
const ACTIVE_ENDPOINT_KEY = "ldcodex_active_endpoints";
/** 端点失败状态 */
const FAILOVER_STATE_KEY = "ldcodex_failover_state";
/** 失败冷却时间：5分钟 */
const FAILOVER_COOLDOWN_MS = 5 * 60 * 1000;

let activeEndpointsCache: Record<string, string> | null = null;
let failoverStateCache: EndpointFailoverState[] | null = null;

function loadActiveEndpoints(): Record<string, string> {
  if (activeEndpointsCache) return activeEndpointsCache;
  try {
    const raw = localStorage.getItem(ACTIVE_ENDPOINT_KEY);
    if (raw) {
      activeEndpointsCache = JSON.parse(raw);
      return activeEndpointsCache!;
    }
  } catch { /* ignore */ }
  activeEndpointsCache = {};
  return activeEndpointsCache;
}

function saveActiveEndpoints(state: Record<string, string>): void {
  activeEndpointsCache = state;
  localStorage.setItem(ACTIVE_ENDPOINT_KEY, JSON.stringify(state));
}

function loadFailoverState(): EndpointFailoverState[] {
  if (failoverStateCache) return failoverStateCache;
  try {
    const raw = localStorage.getItem(FAILOVER_STATE_KEY);
    if (raw) {
      failoverStateCache = JSON.parse(raw);
      return failoverStateCache!;
    }
  } catch { /* ignore */ }
  failoverStateCache = [];
  return failoverStateCache;
}

function saveFailoverState(state: EndpointFailoverState[]): void {
  failoverStateCache = state;
  localStorage.setItem(FAILOVER_STATE_KEY, JSON.stringify(state));
}

/** 清除过期的失败状态（超过冷却时间） */
function pruneExpiredFailures(): void {
  const now = Date.now();
  const state = loadFailoverState();
  const valid = state.filter((s) => now - s.failedAtMs < FAILOVER_COOLDOWN_MS);
  if (valid.length !== state.length) {
    saveFailoverState(valid);
  }
}

/** 检查端点是否处于失败冷却期 */
function isEndpointInCooldown(endpointId: string): boolean {
  const now = Date.now();
  const state = loadFailoverState();
  return state.some((s) => s.endpointId === endpointId && now - s.failedAtMs < FAILOVER_COOLDOWN_MS);
}

/** 获取模型的第一个可用端点索引 */
function findFirstAvailableEndpointIndex(model: VirtualModel, excludeIds: Set<string> = new Set()): number {
  return model.endpoints.findIndex((ep) => ep.enabled && !excludeIds.has(ep.id) && !isEndpointInCooldown(ep.id));
}

/**
 * 获取当前活跃端点
 * @param virtualModelId 虚拟模型 ID
 * @param config 虚拟模型配置
 * @returns 当前活跃端点，如果没有可用端点返回 null
 */
export function getActiveEndpoint(
  virtualModelId: string,
  config: VirtualModelConfig,
): { model: VirtualModel; endpoint: VirtualEndpoint } | null {
  pruneExpiredFailures();
  const activeEndpoints = loadActiveEndpoints();
  const enabledModels = config.models.filter((m) => m.enabled && m.virtualModelId === virtualModelId);

  if (enabledModels.length === 0) return null;

  // 按顺序尝试每个模型
  for (const model of enabledModels) {
    const activeEndpointId = activeEndpoints[model.id];
    const excludeIds = new Set<string>();

    // 如果有记录的活跃端点，先尝试它
    if (activeEndpointId) {
      const ep = model.endpoints.find((e) => e.id === activeEndpointId);
      if (ep && ep.enabled && !isEndpointInCooldown(ep.id)) {
        return { model, endpoint: ep };
      }
      // 标记为排除，继续寻找
      excludeIds.add(activeEndpointId);
    }

    // 寻找第一个可用端点
    const idx = findFirstAvailableEndpointIndex(model, excludeIds);
    if (idx >= 0) {
      // 更新活跃端点
      activeEndpoints[model.id] = model.endpoints[idx].id;
      saveActiveEndpoints(activeEndpoints);
      return { model, endpoint: model.endpoints[idx] };
    }
  }

  return null;
}

/**
 * 处理端点失败（429 或其他错误）
 * @param modelId 模型 ID
 * @param failedEndpointId 失败的端点 ID
 * @param reason 失败原因
 * @param config 虚拟模型配置
 * @returns 下一个可用端点，如果没有返回 null
 */
export function handleFailover(
  modelId: string,
  failedEndpointId: string,
  reason: string,
  config: VirtualModelConfig,
): { model: VirtualModel; endpoint: VirtualEndpoint } | null {
  pruneExpiredFailures();

  // 记录失败状态
  const failoverState = loadFailoverState();
  const existing = failoverState.findIndex((s) => s.endpointId === failedEndpointId);
  const entry: EndpointFailoverState = {
    endpointId: failedEndpointId,
    failedAtMs: Date.now(),
    reason,
  };
  if (existing >= 0) {
    failoverState[existing] = entry;
  } else {
    failoverState.push(entry);
  }
  saveFailoverState(failoverState);

  // 查找当前模型
  const model = config.models.find((m) => m.id === modelId);
  if (!model) return null;

  // 在当前模型内寻找下一个可用端点
  const excludeIds = new Set([failedEndpointId]);
  const nextIdx = findFirstAvailableEndpointIndex(model, excludeIds);
  if (nextIdx >= 0) {
    const activeEndpoints = loadActiveEndpoints();
    activeEndpoints[model.id] = model.endpoints[nextIdx].id;
    saveActiveEndpoints(activeEndpoints);
    return { model, endpoint: model.endpoints[nextIdx] };
  }

  // 当前模型所有端点都失败，切换到下一个模型
  const activeEndpoints = loadActiveEndpoints();
  delete activeEndpoints[model.id];
  saveActiveEndpoints(activeEndpoints);

  const enabledModels = config.models.filter((m) => m.enabled && m.id !== modelId);
  for (const nextModel of enabledModels) {
    const idx = findFirstAvailableEndpointIndex(nextModel);
    if (idx >= 0) {
      activeEndpoints[nextModel.id] = nextModel.endpoints[idx].id;
      saveActiveEndpoints(activeEndpoints);
      return { model: nextModel, endpoint: nextModel.endpoints[idx] };
    }
  }

  return null;
}

/**
 * 重置指定模型的失败状态（手动恢复）
 */
export function resetModelFailover(modelId: string): void {
  const model = loadVirtualModelConfig().models.find((m) => m.id === modelId);
  if (!model) return;

  const endpointIds = new Set(model.endpoints.map((e) => e.id));
  const state = loadFailoverState().filter((s) => !endpointIds.has(s.endpointId));
  saveFailoverState(state);

  const activeEndpoints = loadActiveEndpoints();
  delete activeEndpoints[modelId];
  saveActiveEndpoints(activeEndpoints);
}

/**
 * 清除所有失败状态
 */
export function resetAllFailover(): void {
  saveFailoverState([]);
  saveActiveEndpoints({});
}

/**
 * 获取所有端点的失败状态
 */
export function getFailoverState(): EndpointFailoverState[] {
  pruneExpiredFailures();
  return loadFailoverState();
}

export type EndpointTestResult = {
  success: boolean;
  message: string;
  latencyMs?: number;
  models?: string[];
};

export function exportVirtualModelConfig(config: VirtualModelConfig): string {
  return JSON.stringify(config, null, 2);
}

export function importVirtualModelConfig(jsonStr: string): VirtualModelConfig {
  const parsed = JSON.parse(jsonStr);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.models)) {
    throw new Error("无效的配置格式：缺少 models 数组");
  }
  // 验证每个模型的基本结构
  for (const model of parsed.models) {
    if (!model.id || !model.virtualModelId) {
      throw new Error(`模型配置缺少必要字段 id 或 virtualModelId`);
    }
    if (!Array.isArray(model.endpoints)) {
      model.endpoints = [];
    }
  }
  return parsed as VirtualModelConfig;
}

export async function testEndpointConnection(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 10000,
): Promise<EndpointTestResult> {
  const trimmedUrl = baseUrl.replace(/\/+$/, "");
  const endpoint = trimmedUrl.endsWith("/v1")
    ? `${trimmedUrl}/models`
    : `${trimmedUrl}/v1/models`;

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    if (response.ok) {
      const data = await response.json();
      const models = (data?.data ?? []).map((m: { id?: string }) => m.id).filter(Boolean);
      return {
        success: true,
        message: `连接成功 (${response.status})`,
        latencyMs,
        models,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: `认证失败 (HTTP ${response.status})：API Key 无效或无权限`,
        latencyMs,
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        message: `速率限制 (HTTP 429)：当前端点已达配额上限`,
        latencyMs,
      };
    }

    const text = await response.text().catch(() => "");
    return {
      success: false,
      message: `请求失败 (HTTP ${response.status})${text ? ": " + text.slice(0, 120) : ""}`,
      latencyMs,
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - start;
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        success: false,
        message: `连接超时 (${timeoutMs}ms)`,
        latencyMs,
      };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `网络错误：${msg}`,
      latencyMs,
    };
  }
}
