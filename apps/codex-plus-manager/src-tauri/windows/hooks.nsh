; LDCodex 安装器钩子（Tauri NSIS installerHooks）
;
; 目的：安装 / 卸载前停止所有正在运行的 LDCodex 进程。
; 否则安装程序无法覆盖被占用的文件，典型表现是弹出：
;   「无法打开要写入的文件: ...\resources\node\node.exe」
;
; 为什么要单独处理 node.exe：
;   daemon 是独立于主程序的 node.exe 进程（安装目录下 resources\node\node.exe），
;   Tauri 默认模板只检测主程序是否在运行，检测不到这个 daemon 子进程，
;   所以必须在这里按「安装目录路径」把它精确清掉。

!macro LDCodexStopRunningProcesses
  ; 1) 主程序与启动器：按镜像名结束，/T 连带其子进程
  nsExec::Exec 'taskkill /IM LDCodexManager.exe /F /T'
  Pop $0
  nsExec::Exec 'taskkill /IM ldcodex.exe /F /T'
  Pop $0

  ; 2) 兜底：结束安装目录下的所有进程（含 resources\node\node.exe 这个 daemon）。
  ;    只按可执行文件路径过滤，绝不误杀用户其它的 node.exe 进程。
  nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like $\'$INSTDIR\*$\' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  Pop $0

  ; 给系统一点时间释放文件句柄，否则紧接着写文件仍可能失败
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "停止正在运行的 LDCodex 进程…"
  !insertmacro LDCodexStopRunningProcesses
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "停止正在运行的 LDCodex 进程…"
  !insertmacro LDCodexStopRunningProcesses
!macroend
