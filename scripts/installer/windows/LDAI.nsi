Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define ROOT "..\..\.."

Name "LD AI工具"
OutFile "${ROOT}\dist\windows\LDAI-${VERSION}-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\LDAI"
InstallDirRegKey HKCU "Software\LDAI" "InstallDir"
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
  nsExec::ExecToLog 'taskkill /IM ldzcode.exe /F'
  Pop $0

  File "${ROOT}\dist\windows\app\ldcodex.exe"
  File "${ROOT}\dist\windows\app\ldcodex-manager.exe"
  File "${ROOT}\dist\windows\app\ldzcode.exe"

  Delete "$DESKTOP\LD AI工具.lnk"
  Delete "$DESKTOP\LD AI工具 管理工具.lnk"
  Delete "$DESKTOP\LD AI工具 ZCode启动器.lnk"
  Delete "$SMPROGRAMS\LD AI工具\LD AI工具.lnk"
  Delete "$SMPROGRAMS\LD AI工具\LD AI工具 管理工具.lnk"
  Delete "$SMPROGRAMS\LD AI工具\LD AI工具 ZCode启动器.lnk"

  CreateShortcut "$DESKTOP\LD AI工具.lnk" "$INSTDIR\ldcodex.exe" "" "$INSTDIR\ldcodex.exe"
  CreateShortcut "$DESKTOP\LD AI工具 管理工具.lnk" "$INSTDIR\ldcodex-manager.exe" "" "$INSTDIR\ldcodex-manager.exe"
  CreateShortcut "$DESKTOP\LD AI工具 ZCode启动器.lnk" "$INSTDIR\ldzcode.exe" "" "$INSTDIR\ldcodex.exe"
  CreateDirectory "$SMPROGRAMS\LD AI工具"
  CreateShortcut "$SMPROGRAMS\LD AI工具\LD AI工具.lnk" "$INSTDIR\ldcodex.exe" "" "$INSTDIR\ldcodex.exe"
  CreateShortcut "$SMPROGRAMS\LD AI工具\LD AI工具 管理工具.lnk" "$INSTDIR\ldcodex-manager.exe" "" "$INSTDIR\ldcodex-manager.exe"
  CreateShortcut "$SMPROGRAMS\LD AI工具\LD AI工具 ZCode启动器.lnk" "$INSTDIR\ldzcode.exe" "" "$INSTDIR\ldcodex.exe"
  CreateShortcut "$SMPROGRAMS\LD AI工具\卸载 LD AI工具.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\ldcodex.exe"

	  # ★ 安装 bridge 代理服务
	  SetOutPath "$INSTDIR\bridge"
	  File /r "${ROOT}\bridge\*"
	  SetOutPath "$INSTDIR"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\LDAI" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "DisplayName" "LD AI工具"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "Publisher" "luoda"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "DisplayIcon" "$INSTDIR\ldcodex.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI" "UninstallString" "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'taskkill /IM ldcodex.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM ldcodex-manager.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM ldzcode.exe /F'
  Pop $0

  Delete "$DESKTOP\LD AI工具.lnk"
  Delete "$DESKTOP\LD AI工具 管理工具.lnk"
  Delete "$DESKTOP\LD AI工具 ZCode启动器.lnk"
  Delete "$SMPROGRAMS\LD AI工具\LD AI工具.lnk"
  Delete "$SMPROGRAMS\LD AI工具\LD AI工具 管理工具.lnk"
  Delete "$SMPROGRAMS\LD AI工具\LD AI工具 ZCode启动器.lnk"
  Delete "$SMPROGRAMS\LD AI工具\卸载 LD AI工具.lnk"
  RMDir "$SMPROGRAMS\LD AI工具"

  Delete "$INSTDIR\ldcodex.exe"
  Delete "$INSTDIR\ldcodex-manager.exe"
  Delete "$INSTDIR\ldzcode.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\bridge"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LDAI"
  DeleteRegKey HKCU "Software\LDAI"
SectionEnd
