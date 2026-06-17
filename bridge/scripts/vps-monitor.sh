#!/bin/bash
set -euo pipefail
MEM_FREE_MIN_MB=${MEM_FREE_MIN_MB:-100}
PROXY_MEM_LIMIT_MB=${PROXY_MEM_LIMIT_MB:-512}
CHECK_INTERVAL=${CHECK_INTERVAL:-60}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-10}
PROXY_PORT=${PROXY_PORT:-40000}
CONFIG_PORT=${CONFIG_PORT:-40001}
PROXY_DIR=${PROXY_DIR:-/opt/1panel/LuoDaBridge}
LOG_FILE=${LOG_FILE:-/var/log/luodabridge-monitor.log}
LOG_MAX_DAYS=${LOG_MAX_DAYS:-7}
MONITOR_LOG="/var/log/luodabridge-memory.log"

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
warn() { log "[WARN] $*"; }
info() { log "[INFO] $*"; }
err()  { log "[ERROR] $*"; }

check_memory() {
    local mem_free_kb mem_free_mb mem_total_kb mem_used_pct
    mem_free_kb=$(grep -E '^MemAvailable:' /proc/meminfo | awk '{print $2}')
    [[ -z "$mem_free_kb" ]] && mem_free_kb=$(grep -E '^MemFree:' /proc/meminfo | awk '{print $2}')
    mem_free_mb=$((mem_free_kb / 1024))
    mem_total_kb=$(grep -E '^MemTotal:' /proc/meminfo | awk '{print $2}')
    mem_used_pct=$(( (mem_total_kb - mem_free_kb) * 100 / mem_total_kb ))

    # Log memory usage for trend analysis
    echo "$(date '+%s'),${mem_total_kb},${mem_free_kb},$((mem_total_kb - mem_free_kb))" >> "$MONITOR_LOG"
    tail -n 1440 "$MONITOR_LOG" > "${MONITOR_LOG}.tmp" && mv "${MONITOR_LOG}.tmp" "$MONITOR_LOG"

    if [[ "$mem_free_mb" -lt "$MEM_FREE_MIN_MB" ]]; then
        err "系统剩余内存仅 ${mem_free_mb}MB（${mem_used_pct}%），低于阈值 ${MEM_FREE_MIN_MB}MB —— 准备重启 VPS！"
        /sbin/shutdown -r now "LuoDaBridge 监控：系统内存不足 ${mem_free_mb}MB，自动重启"
        exit 0
    fi
    # Early warning at 60% usage
    if [[ "$mem_used_pct" -ge 60 ]]; then
        warn "内存使用率 ${mem_used_pct}% (可用 ${mem_free_mb}MB)，接近阈值"
    fi
    info "系统内存: ${mem_used_pct}% 使用 (可用 ${mem_free_mb}MB, 阈值 ${MEM_FREE_MIN_MB}MB)"
}

check_proxy_health() {
    if ! curl -sf --max-time "$HEALTH_TIMEOUT" "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null 2>&1; then
        warn "代理 API 端口 ${PROXY_PORT} 无响应"
        return 1
    fi
    if ! curl -sf --max-time "$HEALTH_TIMEOUT" "http://127.0.0.1:${CONFIG_PORT}/" >/dev/null 2>&1; then
        warn "配置 UI 端口 ${CONFIG_PORT} 无响应"
        return 1
    fi
    return 0
}

check_proxy_process() {
    local proxy_pid proxy_mem_kb proxy_mem_mb
    proxy_pid=$(lsof -ti :"${PROXY_PORT}" -s TCP:LISTEN 2>/dev/null | head -1)
    [[ -z "$proxy_pid" ]] && { err "未找到监听 ${PROXY_PORT} 端口的代理进程"; return 1; }
    if [[ -f "/proc/${proxy_pid}/status" ]]; then
        proxy_mem_kb=$(grep -E '^VmRSS:' "/proc/${proxy_pid}/status" | awk '{print $2}')
        proxy_mem_mb=$((proxy_mem_kb / 1024))
        if [[ "$proxy_mem_mb" -gt "$PROXY_MEM_LIMIT_MB" ]]; then
            warn "代理进程(PID ${proxy_pid}) 内存: ${proxy_mem_mb}MB 超过阈值 ${PROXY_MEM_LIMIT_MB}MB"
            restart_proxy "代理进程内存超限"
            return 1
        fi
        info "代理进程(PID ${proxy_pid}) 内存: ${proxy_mem_mb}MB (阈值: ${PROXY_MEM_LIMIT_MB}MB)"
    fi
    return 0
}

restart_proxy() {
    local reason="$1"
    warn "重启代理: ${reason}"
    curl -sf -X POST "http://127.0.0.1:${CONFIG_PORT}/api/restart" >/dev/null 2>&1 || systemctl restart luodabridge
}

rotate_logs() {
    find "$(dirname "$LOG_FILE")" -name "$(basename "$LOG_FILE")*" -mtime +${LOG_MAX_DAYS} -delete 2>/dev/null || true
}

info "═══════════════════════════════════════════"
info "LuoDaBridge VPS 监控启动"
info "  内存阈值: ${MEM_FREE_MIN_MB}MB (VPS 重启)"
info "  代理内存阈值: ${PROXY_MEM_LIMIT_MB}MB (代理重启)"
info "  检查间隔: ${CHECK_INTERVAL}s"
info "  代理目录: ${PROXY_DIR}"
info "═══════════════════════════════════════════"

while true; do
    check_memory
    if ! check_proxy_health; then
        restart_proxy "健康检查失败"
    else
        check_proxy_process
    fi
    rotate_logs
    sleep "$CHECK_INTERVAL"
done
