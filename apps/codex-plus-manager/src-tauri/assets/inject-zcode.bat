@echo off
chcp 65001 >nul
title LDZcode 插件注入工具

setlocal enabledelayedexpansion

:: ========== 自动检测路径 ==========
:: 1) 插件目录
set "PLUGIN_DIR=%~dp0"
set "PLUGIN_DIR=%PLUGIN_DIR:~0,-1%"
if not exist "%PLUGIN_DIR%\zcode-customize.js" (
    set "PLUGIN_DIR=%USERPROFILE%\.zcode\LDZcode"
)

:: 2) ZCode 安装目录
:: 注意：用 enabledelayedexpansion 的 !VAR! 语法，避开 %VAR% 在 if 块内的展开陷阱
set "ZCODE_DIR="
if defined ZCODE_DIR if exist "!ZCODE_DIR!\ZCode.exe" goto :found_zcode
if exist "!LOCALAPPDATA!\Programs\ZCode\ZCode.exe" set "ZCODE_DIR=!LOCALAPPDATA!\Programs\ZCode" & goto :found_zcode
if exist "!USERPROFILE!\AppData\Local\Programs\ZCode\ZCode.exe" set "ZCODE_DIR=!USERPROFILE!\AppData\Local\Programs\ZCode" & goto :found_zcode
if exist "!ProgramFiles!\ZCode\ZCode.exe" set "ZCODE_DIR=!ProgramFiles!\ZCode" & goto :found_zcode
if exist "!ProgramFiles(x86)!\ZCode\ZCode.exe" set "ZCODE_DIR=!ProgramFiles(x86)!\ZCode" & goto :found_zcode
:: 注册表查询
for /f "skip=2 tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "ZCode" 2^>nul ^| find "DisplayIcon"') do (
    if exist "%%~dpBZCode.exe" set "ZCODE_DIR=%%~dpB" & goto :found_zcode
)
:: where 命令兜底
for /f "delims=" %%p in ('where ZCode.exe 2^>nul') do set "ZCODE_DIR=%%~dpp" & goto :found_zcode

echo [错误] 找不到 ZCode.exe！请确认 ZCode 已安装。
echo   检测过的路径：
echo     !LOCALAPPDATA!\Programs\ZCode
echo     !USERPROFILE!\AppData\Local\Programs\ZCode
echo     !ProgramFiles!\ZCode
echo     !ProgramFiles(x86)!\ZCode
echo   可设置环境变量 ZCODE_DIR 指向 ZCode 安装目录。
pause & exit /b 1
:found_zcode

:: ========== 后续步骤 ==========
set "ASAR=%ZCODE_DIR%\resources\app.asar"
set "ASAR_BAK=%ZCODE_DIR%\resources\app.asar.bak"
set "PLUGIN_JS=%PLUGIN_DIR%\zcode-customize.js"

echo ════════════════════════════════════════
echo    LDZcode — ZCode 布局调整插件注入
echo ════════════════════════════════════════
echo.
echo  插件目录：%PLUGIN_DIR%
echo  ZCode目录：%ZCODE_DIR%
echo.

:: 关闭 ZCode
tasklist /FI "IMAGENAME eq ZCode.exe" 2>nul | find /I "ZCode.exe" >nul
if %errorlevel%==0 (
    echo [*] 正在关闭 ZCode...
    taskkill /F /IM ZCode.exe >nul 2>&1
    timeout /t 3 /nobreak >nul
)

:: 3) 查找 npx
set "NPX_CMD="
for %%p in (
    "%ProgramFiles%\nodejs\npx.cmd"
    "%ProgramFiles(x86)%\nodejs\npx.cmd"
    "%LOCALAPPDATA%\fnm\node-versions\*\installation\npx.cmd"
    "%APPDATA%\npm\npx.cmd"
) do if exist %%p set "NPX_CMD=%%p"
if not defined NPX_CMD where npx.cmd >nul 2>&1 && set "NPX_CMD=npx.cmd"
if not defined NPX_CMD where npx >nul 2>&1 && set "NPX_CMD=npx"
if not defined NPX_CMD (
    echo [错误] 未找到 npx，请安装 Node.js https://nodejs.org
    pause & exit /b 1
)
echo  使用 npx: !NPX_CMD!

:: 检查文件
if not exist "%PLUGIN_JS%" (
    echo [错误] 找不到插件文件：%PLUGIN_JS%
    pause & exit /b 1
)
if not exist "%ASAR%" (
    echo [错误] 找不到 app.asar：%ASAR%
    pause & exit /b 1
)

:: 备份
if not exist "%ASAR_BAK%" (
    echo [*] 备份原始 app.asar...
    copy "%ASAR%" "%ASAR_BAK%" >nul
)

pushd "%TEMP%"
if exist _ldzcode_inject rmdir /s /q _ldzcode_inject >nul 2>&1
mkdir _ldzcode_inject 2>nul
cd _ldzcode_inject

echo [1/4] 解压 app.asar...
"%NPX_CMD%" asar e "%ASAR%" .
if %errorlevel% neq 0 (
    echo [错误] 解压失败，请检查 app.asar 是否存在
    popd & rmdir /s /q _ldzcode_inject >nul 2>&1
    pause & exit /b 1
)

echo [2/4] 注入插件脚本...
if not exist "out\renderer\assets" mkdir "out\renderer\assets"
copy "%PLUGIN_JS%" "out\renderer\assets\zcode-customize.js" >nul
if not exist "out\renderer\assets\zcode-customize.js" (
    echo [错误] 复制插件脚本失败
    popd & rmdir /s /q _ldzcode_inject >nul 2>&1
    pause & exit /b 1
)

echo [3/4] 修改 index.html...
powershell -NoProfile -NonInteractive -Command ^
"$f='out\renderer\index.html'; ^
 $c=Get-Content $f -Raw; ^
 if($c -notmatch 'zcode-customize'){ ^
   $c=$c -replace '(</body>)','  <script defer src=\"./assets/zcode-customize.js\"></script>`r`n$1'; ^
   Set-Content $f $c -Encoding UTF8 -NoNewline; ^
   Write-Host 'OK' ^
 } else { ^
   Write-Host '已存在，跳过' ^
 }"

echo [4/4] 重新打包 app.asar...
"%NPX_CMD%" asar p . "%ASAR%"
if %errorlevel% neq 0 (
    echo [错误] 打包失败
    popd & rmdir /s /q _ldzcode_inject >nul 2>&1
    pause & exit /b 1
)

popd
rmdir /s /q "%TEMP%\_ldzcode_inject" >nul 2>&1

if not exist "%ASAR_BAK%" copy "%ASAR%" "%ASAR_BAK%" >nul

echo.
echo [完成] LDZcode 插件注入成功！
echo [提示] 请重新启动 ZCode，快捷键 Alt+L 打开设置面板。
echo [提示] ZCode 升级后，再次运行此文件即可恢复。
echo [备份] %ASAR_BAK%
echo.
pause
