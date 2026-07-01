Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define ROOT "..\..\.."

Name "LDCodex"
OutFile "${ROOT}\dist\windows\LDCodex-${VERSION}-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\LDCodex"
InstallDirRegKey HKCU "Software\LDCodex" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!define MUI_ICON "${ROOT}\apps\codex-plus-manager\src-tauri\icons\icon.ico"
!define MUI_UNICON "${ROOT}\apps\codex-plus-manager\src-tauri\icons\icon.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"

  nsExec::ExecToLog 'taskkill /IM ldcodex.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM ldcodex-manager.exe /F'
  Pop $0

  File "${ROOT}\dist\windows\app\ldcodex.exe"
  File "${ROOT}\dist\windows\app\ldcodex-manager.exe"

  Delete "$DESKTOP\LDCodex 管理工具.lnk"
  Delete "$SMPROGRAMS\LDCodex\LDCodex 管理工具.lnk"

  CreateShortcut "$DESKTOP\LDCodex.lnk" "$INSTDIR\ldcodex.exe" "" "$INSTDIR\ldcodex.exe"
  CreateShortcut "$DESKTOP\LDCodex 管理工具.lnk" "$INSTDIR\ldcodex-manager.exe" "" "$INSTDIR\ldcodex-manager.exe"
  CreateDirectory "$SMPROGRAMS\LDCodex"
  CreateShortcut "$SMPROGRAMS\LDCodex\LDCodex.lnk" "$INSTDIR\ldcodex.exe" "" "$INSTDIR\ldcodex.exe"
  CreateShortcut "$SMPROGRAMS\LDCodex\LDCodex 管理工具.lnk" "$INSTDIR\ldcodex-manager.exe" "" "$INSTDIR\ldcodex-manager.exe"
  CreateShortcut "$SMPROGRAMS\LDCodex\卸载 LDCodex.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\ldcodex.exe"

  # ★ 安装 Node.js 便携运行时（launcher 用它来启动 bridge 进程）
  SetOutPath "$INSTDIR\node-portable"
  File /r "${ROOT}\dist\windows\app\node-portable\*"
  SetOutPath "$INSTDIR"

  # ★ 安装 bridge 代理服务
  SetOutPath "$INSTDIR\bridge"
  File /r "${ROOT}\bridge\*"
  SetOutPath "$INSTDIR"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\LDCodex" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDCodex" "DisplayName" "LDCodex"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDCodex" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDCodex" "Publisher" "luoda"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDCodex" "DisplayIcon" "$INSTDIR\ldcodex.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDCodex" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDCodex" "UninstallString" "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'taskkill /IM ldcodex.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM ldcodex-manager.exe /F'
  Pop $0

  Delete "$DESKTOP\LDCodex.lnk"
  Delete "$DESKTOP\LDCodex 管理工具.lnk"
  Delete "$DESKTOP\LDCodex 管理工具.lnk"
  Delete "$SMPROGRAMS\LDCodex\LDCodex.lnk"
  Delete "$SMPROGRAMS\LDCodex\LDCodex 管理工具.lnk"
  Delete "$SMPROGRAMS\LDCodex\LDCodex 管理工具.lnk"
  Delete "$SMPROGRAMS\LDCodex\卸载 LDCodex.lnk"
  RMDir "$SMPROGRAMS\LDCodex"

  Delete "$INSTDIR\ldcodex.exe"
  Delete "$INSTDIR\ldcodex.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\bridge"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDCodex"
  DeleteRegKey HKCU "Software\LDCodex"
SectionEnd