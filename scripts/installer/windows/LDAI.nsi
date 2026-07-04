Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define ROOT "..\..\.."

Name "LDAI"
OutFile "${ROOT}\dist\windows\LDAI-${VERSION}-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\LDAI"
InstallDirRegKey HKCU "Software\LDAI" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!define MUI_ICON "${ROOT}\apps\codex-plus-manager\src-tauri\icons\LDAI.ico"
!define MUI_UNICON "${ROOT}\apps\codex-plus-manager\src-tauri\icons\LDAI.ico"

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
  nsExec::ExecToLog 'taskkill /IM ldzcode.exe /F'
  Pop $0

  File "${ROOT}\dist\windows\app\ldcodex.exe"
  File "${ROOT}\dist\windows\app\ldcodex-manager.exe"
  File "${ROOT}\dist\windows\app\ldzcode.exe"

  ; 清理旧的 LDCodex 快捷方式（兼容升级）
  Delete "$DESKTOP\LDCodex.lnk"
  Delete "$DESKTOP\LDCodex 管理工具.lnk"
  Delete "$DESKTOP\LD AI工具.lnk"
  Delete "$DESKTOP\LD AI工具 管理工具.lnk"
  Delete "$DESKTOP\LD AI工具 ZCode启动器.lnk"
  Delete "$SMPROGRAMS\LDCodex\LDCodex.lnk"
  Delete "$SMPROGRAMS\LDCodex\LDCodex 管理工具.lnk"
  Delete "$SMPROGRAMS\LDCodex\LD AI工具.lnk"
  Delete "$SMPROGRAMS\LDCodex\LD AI工具 管理工具.lnk"
  Delete "$SMPROGRAMS\LDCodex\LD AI工具 ZCode启动器.lnk"
  Delete "$SMPROGRAMS\LDCodex\卸载 LDCodex.lnk"
  RMDir "$SMPROGRAMS\LDCodex"

  ; 创建新的 LDAI 快捷方式
  Delete "$DESKTOP\LDCodex.lnk"
  Delete "$DESKTOP\LDAI管理工具.lnk"
  Delete "$DESKTOP\LDZcode.lnk"

  CreateShortcut "$DESKTOP\LDCodex.lnk" "$INSTDIR\ldcodex.exe" "" "$INSTDIR\ldcodex.exe"
  CreateShortcut "$DESKTOP\LDAI管理工具.lnk" "$INSTDIR\ldcodex-manager.exe" "" "$INSTDIR\ldcodex-manager.exe"
  CreateShortcut "$DESKTOP\LDZcode.lnk" "$INSTDIR\ldzcode.exe" "" "$INSTDIR\ldzcode.exe"
  CreateDirectory "$SMPROGRAMS\LDAI"
  CreateShortcut "$SMPROGRAMS\LDAI\LDCodex.lnk" "$INSTDIR\ldcodex.exe" "" "$INSTDIR\ldcodex.exe"
  CreateShortcut "$SMPROGRAMS\LDAI\LDAI管理工具.lnk" "$INSTDIR\ldcodex-manager.exe" "" "$INSTDIR\ldcodex-manager.exe"
  CreateShortcut "$SMPROGRAMS\LDAI\LDZcode.lnk" "$INSTDIR\ldzcode.exe" "" "$INSTDIR\ldzcode.exe"
  CreateShortcut "$SMPROGRAMS\LDAI\卸载 LDAI.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\ldcodex.exe"

	  # ★ 安装 bridge 代理服务
	  SetOutPath "$INSTDIR\bridge"
	  File /r "${ROOT}\bridge\*"
	  SetOutPath "$INSTDIR"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; 注册表（统一使用 LDAI）
  WriteRegStr HKCU "Software\LDAI" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "DisplayName" "LDAI"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "Publisher" "luoda"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "DisplayIcon" "$INSTDIR\ldcodex.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "UninstallString" "$INSTDIR\uninstall.exe"

  ; 清理旧的 LDCodex 注册表（兼容升级）
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDCodex"
  DeleteRegKey HKCU "Software\LDCodex"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'taskkill /IM ldcodex.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM ldcodex-manager.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM ldzcode.exe /F'
  Pop $0

  Delete "$DESKTOP\LDCodex.lnk"
  Delete "$DESKTOP\LDAI管理工具.lnk"
  Delete "$DESKTOP\LDZcode.lnk"
  Delete "$SMPROGRAMS\LDAI\LDCodex.lnk"
  Delete "$SMPROGRAMS\LDAI\LDAI管理工具.lnk"
  Delete "$SMPROGRAMS\LDAI\LDZcode.lnk"
  Delete "$SMPROGRAMS\LDAI\卸载 LDAI.lnk"
  RMDir "$SMPROGRAMS\LDAI"

  Delete "$INSTDIR\ldcodex.exe"
  Delete "$INSTDIR\ldcodex-manager.exe"
  Delete "$INSTDIR\ldzcode.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\bridge"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI"
  DeleteRegKey HKCU "Software\LDAI"
SectionEnd
