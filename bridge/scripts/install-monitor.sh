#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# install-monitor.sh – LuoDaBridge VPS 监控一键安装脚本
# ═══════════════════════════════════════════════════════════════
# 在 VPS 上执行：
#   sudo bash scripts/install-monitor.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { printf "${GREEN}[✓]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
error() { printf "${RED}[✗]${NC} %s\n" "$1"; }
step()  { printf "${BLUE}[→]${NC} %s\n" "$1"; }

# 检查 root
if [[ $EUID -ne 0 ]]; then
    error "请使用 sudo 或 root 用户运行此脚本"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

step "安装 LuoDaBridge VPS 监控..."

# ── 1. 安装监控脚本 ──
step "复制 vps-monitor.sh 到 /usr/local/bin/..."
cp "${SCRIPT_DIR}/vps-monitor.sh" /usr/local/bin/luodabridge-monitor
chmod +x /usr/local/bin/luodabridge-monitor
info "监控脚本已安装"

# ── 2. 安装 systemd 服务 ──
step "安装 systemd 服务..."
cp "${SCRIPT_DIR}/luodabridge-watchdog.service" /etc/systemd/system/
systemctl daemon-reload
info "systemd 服务文件已安装"

# ── 3. 启用并启动 ──
step "启用并启动 watchdog 服务..."
systemctl enable luodabridge-watchdog
systemctl start luodabridge-watchdog
sleep 2

# ── 4. 验证状态 ──
if systemctl is-active --quiet luodabridge-watchdog; then
    info "luodabridge-watchdog 服务运行中"
else
    warn "服务状态异常，请检查: systemctl status luodabridge-watchdog"
    systemctl status luodabridge-watchdog --no-pager || true
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  LuoDaBridge VPS 监控已安装！"
echo ""
echo "  管理命令："
echo "    sudo systemctl status luodabridge-watchdog    # 查看状态"
echo "    sudo journalctl -u luodabridge-watchdog -f    # 查看日志"
echo "    sudo systemctl restart luodabridge-watchdog   # 重启监控"
echo ""
echo "  配置（编辑 /etc/systemd/system/luodabridge-watchdog.service）："
echo "    MEM_FREE_MIN_MB=100          # 系统可用内存阈值（MB）"
echo "    PROXY_MEM_LIMIT_MB=2048      # 代理进程内存阈值（MB）"
echo "    CHECK_INTERVAL=60            # 检查间隔（秒）"
echo "═══════════════════════════════════════════════════"
