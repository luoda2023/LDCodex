// LDCodex：本模块替换上游的 Sentry 诊断上报实现（来源与许可见同目录 NOTICE）。
//
// 上游会把脱敏诊断数据 POST 到一个硬编码的 Sentry 端点。
// LDCodex 不再保留任何外部上报能力：这里提供完整同名导出，但全部为本地 no-op ——
// 不联网、不落盘、不读取任何凭证。所有调用点无需改动即可安全生效。
'use strict';

/** 始终返回 false：LDCodex 不启用任何诊断上报。 */
function telemetryEnabled() {
  return false;
}

/** 始终返回 null：不再支持用环境变量覆盖（上游为 LDCODEX_TELEMETRY）。 */
function telemetryEnvironmentOverride() {
  return null;
}

/** 接口兼容：请求开启诊断时不生效，返回 false 表示最终状态。 */
function setTelemetryEnabled() {
  return false;
}

/** 兼容上游关于页读取：固定为关闭。 */
function readTelemetrySetting() {
  return { value: false, checkedAt: 0 };
}

/** no-op：不发送任何事件。 */
function captureMessage() {
  return false;
}

/** no-op：不上报任何异常。 */
function captureException() {
  return false;
}

/** no-op：没有本地待发送队列。 */
function flushOutbox() {
  return Promise.resolve({ sent: 0 });
}

/** 兼容上游 makeEvent：仅返回一个不含任何外部端点的本地对象。 */
function makeEvent(kind, fields) {
  return { kind: kind || 'event', at: Date.now(), fields: fields || {} };
}

module.exports = {
  captureMessage,
  captureException,
  flushOutbox,
  makeEvent,
  readTelemetrySetting,
  setTelemetryEnabled,
  telemetryEnvironmentOverride,
  telemetryEnabled,
};
