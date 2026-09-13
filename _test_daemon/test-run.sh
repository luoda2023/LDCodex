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

# 本机安装状态（信息性，**不参与**下面的成败判定，所以 `|| true`）：
# 回答「用户机器上跑的到底是哪一版」。历史教训 —— 两次「改了没用」的真实原因
# 都是「根本没装上」，所以每次跑测试都顺手报一次，别再靠肉眼猜。
# 脚本内部对 reg.exe 被沙箱拦截做了降级（改走 PowerShell），读不到就记 SKIP，不会误报。
echo ""
"$NODE" "$TMP/verify-installed-version.mjs" || true
echo ""

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
# 插件面板布局实测：从 inject.js 抽出真实样式表，复刻 .wbs-* DOM，
# 验证「账号 / 会话 / 增强」三个页签在矮窗口下面板不会顶出客户端窗口上沿。
echo ""
"$NODE" "$TMP/verify-plugin-layout.mjs"
RC4=$?
# 管理器 .fill Panel 高度跟随（WorkBuddy 国际/国内版 8 个 tab + MCP&插件）：
# 验证 Card 不被 .screen 的 grid stretch 钉死、内容能自然撑开 Panel。
# 同样无头 Chrome，harness 在 fill-panel-harness.html。
echo ""
"$NODE" "$TMP/verify-fill-panel.mjs"
RC4b=$?
# 结束隔离 daemon。⚠️ kill 有时不生效（MSYS pid 与 Windows pid 不是一回事，进程也可能忽略
# 信号）：实测残留的 daemon 会一直 LISTEN 在 47999，下一轮的端口预检直接 exit 2，
# 而且 Bash 任务会被这个子进程吊住不结束。所以再按「端口占用者」兜底强杀，最多等 10 秒。
kill "$DPID" 2>/dev/null
for _ in $(seq 1 20); do
  OWNER=$(netstat -ano 2>/dev/null | grep ":$PORT" | grep -i listening | awk '{print $NF}' | head -1)
  [ -z "$OWNER" ] && break
  MSYS_NO_PATHCONV=1 taskkill /F /PID "$OWNER" >/dev/null 2>&1
  sleep 0.5
done
if [ "$RC" -ne 0 ] || [ "$RC2" -ne 0 ] || [ "$RC3" -ne 0 ] || [ "$RC4" -ne 0 ] || [ "$RC4b" -ne 0 ]; then exit 1; fi
exit 0
