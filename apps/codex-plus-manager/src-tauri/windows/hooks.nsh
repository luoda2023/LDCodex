; LDCodex 安装器钩子（Tauri NSIS installerHooks）
;
; 职责：在安装 / 卸载 / 覆盖升级之前，把正在运行的 LDCodex 全部停掉。
;
; ── 为什么必须「抢在『已安装』页面出现之前」就停 ─────────────────────────────
; 覆盖安装时文件被占用，会报「无法打开要写入的文件」。
; 更麻烦的是「已安装」页面上的「安装前卸载」：安装器会去调**旧版**的卸载器，
; 而旧卸载器删不掉正在运行的 LDCodexManager.exe —— 文件删完还在原地，
; 于是 installer.nsi 里的 ${FileExists "$INSTDIR\LDCodexManager.exe"} 命中，
; 弹「无法卸载！」并 Abort，整个升级就此中断（88.8.1 → 88.8.2 就是这么失败的）。
; 旧卸载器已经装在用户机器上了，我们改不了它 ——
; 所以只能让**新安装器**提前把程序关掉，让旧卸载器「无文件可锁」。
;
; ── 时机：MUI2 的 .onGUIInit（MUI_CUSTOMFUNCTION_GUIINIT）────────────────────
; MUI2 是在「第一个 MUI_LANGUAGE 被 include 时」才展开 MUI_FUNCTION_GUIINIT 的
; （见 Contrib\Modern UI 2\MUI2.nsh 里 !macro MUI_INSERT 的注释），
; 而本文件是在 installer.nsi 顶部（第 28 行）被 include 的，早于语言文件（第 464 行），
; 所以这里 !define 能被 MUI2 看到。.onGUIInit 在 .onInit 之后、任何页面显示之前执行 ——
; 正好赶在「已安装」页面之前。万一某天 MUI2 改了行为导致这个 define 失效，
; 也不会编译失败或卡住安装，只是退化成「只能靠 NSIS_HOOK_PREINSTALL 兜底」，是安全的失败方向。
;
; ── ⚠️ 本文件有三条硬约束（踩过坑，改之前务必先看）─────────────────────────
; 1) **只能用「默认插件目录」里的插件**。installer.nsi 的
;    `!addplugindir "${ADDITIONALPLUGINSPATH}"` 在第 89 行，而本文件在第 28 行就被 include，
;    所以 `nsis_tauri_utils::` 一律用不了 —— 会直接报
;    “Plugin not found, cannot call nsis_tauri_utils::FindProcess” 编译失败。
;    这里只用 nsExec（在默认插件目录里）。
; 2) **不能用 StrFunc 系列（${StrLoc} / ${StrCase} / ${StrRep}）**。它们展开成
;    `Call StrLoc`，而 NSIS 在 Uninstall 区要求 `Call un.StrLoc` —— 会报
;    “Call must be used with function names starting with "un." in the uninstall section”。
;    本文件的宏同时被插进「安装」和「卸载」两处，所以必须绕开。
;    进程探测因此改用 `cmd /c tasklist ... | find <镜像名>` 的**退出码**（0=找到，1=没找到），
;    既不需要字符串函数，也不受系统语言影响。
; 3) **不要手写 label + Goto**。宏会被插入多次，手写标签会撞名。用 LogicLib 的
;    ${If}/${Else}/${Do}/${Loop}/${Break}（它内部生成唯一标签）。
;
; ── 为什么要单独处理 daemon ─────────────────────────────────────────────────
; daemon 是独立于主程序的 node.exe 进程（安装目录下 resources\node\node.exe daemon.js），
; Tauri 默认模板只检测主程序是否在运行，抓不到这个子进程。
; 这里按「命令行里带 workbuddy-runtime」精确匹配它 —— 绝不误杀用户其它的 node.exe。

Var /GLOBAL LDCodexKillRound

; 探测 LDCodex 主程序是否在运行 → 写入 ${outVar}（1 = 在跑，0 = 没跑）。
!macro LDCodexDetect outVar
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq LDCodexManager.exe" /NH | find LDCodexManager.exe'
  Pop $0 ; 退出码：0 = 找到，1 = 没找到
  Pop $1 ; 输出（不需要，但要弹掉，否则栈会越积越多）
  ${If} $0 == "0"
    StrCpy ${outVar} 1
  ${Else}
    StrCpy ${outVar} 0
  ${EndIf}
!macroend

; 关一轮。
;   · taskkill /T 能连带结束子进程（WebView2 helper 等）；
;   · PowerShell 兜底覆盖「主程序被 /T 漏掉」以及独立跑的 daemon。
!macro LDCodexKillOnce
  nsExec::Exec 'taskkill /IM LDCodexManager.exe /F /T'
  Pop $0
  nsExec::Exec 'taskkill /IM ldcodex.exe /F /T'
  Pop $0

  nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { ($$_.Name -eq $\'node.exe$\' -and $$_.CommandLine -like $\'*workbuddy-runtime*$\') -or ($$_.ExecutablePath -like $\'*LDCodex*$\') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  Pop $0
!macroend

; 停干净再返回：最多 12 轮 × 500ms，最后再多等 800ms 让系统释放文件句柄。
; 只「发一次 taskkill 就往下走」是不够的 —— 句柄还没释放，紧接着写文件照样失败，
; 这正是「明明杀了进程还是提示无法卸载 / 无法写入」的由来。
!macro LDCodexStopRunningProcesses
  StrCpy $LDCodexKillRound 0

  ${Do}
    !insertmacro LDCodexKillOnce

    !insertmacro LDCodexDetect $0
    ${If} $0 = 0
      ${Break}
    ${EndIf}

    IntOp $LDCodexKillRound $LDCodexKillRound + 1
    ${If} $LDCodexKillRound >= 12
      ${Break}
    ${EndIf}

    Sleep 500
  ${Loop}

  Sleep 800
!macroend

; ── 1) 抢在「已安装」页面之前：一打开安装程序就把程序关掉 ──
; 这一步是「安装前卸载」能成功的关键，也是本文件存在的首要原因。
!define MUI_CUSTOMFUNCTION_GUIINIT LDCodexOnGuiInit

Function LDCodexOnGuiInit
  !insertmacro LDCodexDetect $0
  ${If} $0 = 0
    Return ; 没在运行，什么都不做，避免无谓打扰
  ${EndIf}

  ; 静默安装（/S）绝不能弹窗 —— 那会把自动化 / 无人值守安装卡死
  IfSilent ldcodex_gui_kill

  MessageBox MB_OKCANCEL|MB_ICONINFORMATION "检测到 LDCodex 正在运行。$\r$\n$\r$\n安装程序需要先关闭它，才能替换旧版本 —— 否则「安装前卸载」会失败并提示「无法卸载！」。$\r$\n$\r$\n· 点「确定」：自动关闭 LDCodex 并继续安装$\r$\n· 点「取消」：退出安装程序，你可以自己从托盘退出后再重新运行" IDOK ldcodex_gui_kill
  Quit

  ldcodex_gui_kill:
    DetailPrint "检测到 LDCodex 正在运行，先关闭它…"
    !insertmacro LDCodexStopRunningProcesses
FunctionEnd

; ── 2) 常规安装前（含用户选「请勿卸载」直接覆盖安装的情形）──
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "停止正在运行的 LDCodex 进程…"
  !insertmacro LDCodexStopRunningProcesses
!macroend

; ── 3) 卸载前（本版及以后版本的卸载器都会带上这段）──
!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "停止正在运行的 LDCodex 进程…"
  !insertmacro LDCodexStopRunningProcesses
!macroend
