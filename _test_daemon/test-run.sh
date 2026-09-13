#!/usr/bin/env bash
# LDCodex daemon 功能测试：在同一命令内启动隔离实例 → 跑测试 → 关闭
# 关键点：Windows 上后台进程会被 shell 任务的 Job Object 连带杀掉，
#        所以必须在同一个命令生命周期内完成「启动 + 测试 + 关闭」。
# 隔离保证：独立数据目录 data4 + 独立端口 47999 + CDP 指向空端口 47998，
#          不会连接或注入正在运行的真实 WorkBuddy 客户端。
#          （1.2.9 起 findCdpEndpoint 会按页面归属强信号判定，即使回退到 9222 也只会连
#            属于本 profile 的页面；这里仍显式指向空端口，确保测试不碰用户的真实客户端。）
set -u

NODE="C:/Users/Administrator/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe"
RUNTIME="D:/LUODA/LDcodex/apps/codex-plus-manager/src-tauri/workbuddy-runtime"
TMP="D:/LUODA/LDcodex/_test_daemon"
PORT=47999
DATADIR="$TMP/data4"

# 每次从干净状态开跑：残留的 cdp-port.json / .api-token 会让断言失真
rm -rf "$DATADIR"

echo "=== 端口预检 ==="
if netstat -ano 2>/dev/null | grep ":$PORT" | grep -qi listening; then
  echo "⚠️  端口 $PORT 已被占用，测试可能打到别的实例上，请先清理。"
  netstat -ano 2>/dev/null | grep ":$PORT" | grep -i listening
  exit 2
fi
echo "端口 $PORT 空闲 ✅"

cd "$RUNTIME" || exit 1
WBSWITCH_DATA_DIR="$DATADIR" \
WBSWITCH_PORT="$PORT" \
WBSWITCH_CDP_PORT=47998 \
WBSWITCH_PROFILE=workbuddy-cn \
WBSWITCH_SETTINGS_FILE="$DATADIR/settings.json" \
"$NODE" daemon.js > "$TMP/daemon-stdout.log" 2>&1 &
DPID=$!
echo "daemon pid=$DPID, 轮询等待就绪..."

for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --noproxy '*' --max-time 2 "http://127.0.0.1:$PORT/api/status" 2>/dev/null)
  if [ "$code" = "200" ]; then echo "✅ 就绪（等待 ${i}s）"; break; fi
  sleep 1
done

echo "=== 运行测试 ==="
"$NODE" "$TMP/run-tests.js"
RC=$?
# 判定逻辑测试不依赖 daemon（纯函数 + DOM 桩），放在后面跑
echo ""
"$NODE" "$TMP/verify-no-disturb.js"
RC2=$?
# 布局滚动实测：用无头 Chrome 量真实构建产物，验证长列表不会掉出窗口下边框。
# 找不到 Chrome 时脚本自己 SKIP 并以 0 退出，不会阻塞其它测试。
echo ""
"$NODE" "$TMP/verify-layout-scroll.mjs"
RC3=$?
kill "$DPID" 2>/dev/null
if [ "$RC" -ne 0 ] || [ "$RC2" -ne 0 ] || [ "$RC3" -ne 0 ]; then exit 1; fi
exit 0
