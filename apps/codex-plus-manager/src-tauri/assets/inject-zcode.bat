@echo off
chcp 65001 >nul
title LDZcode 插件注入工具

setlocal enabledelayedexpansion

:: ========== 自动检测路径 ==========
:: 1) 插件目录（本 bat 所在目录或 ~\.zcode\LDZcode）
set "PLUGIN_DIR=%~dp0"
set "PLUGIN_DIR=%PLUGIN_DIR:~0,-1%"
if not exist "%PLUGIN_DIR%\zcode-customize.js" (
    set "PLUGIN_DIR=%USERPROFILE%\.zcode\LDZcode"
)

:: 2) ZCode 安装目录
set "ZCODE_DIR="
:: 已设置的环境变量
if defined ZCODE_DIR if exist "!ZCODE_DIR!\ZCode.exe" goto :found_zcode
:: 硬编码路径（你的机器）
if exist "!LOCALAPPDATA!\Programs\ZCode\ZCode.exe" set "ZCODE_DIR=!LOCALAPPDATA!\Programs\ZCode" & goto :found_zcode
if exist "!USERPROFILE!\AppData\Local\Programs\ZCode\ZCode.exe" set "ZCODE_DIR=!USERPROFILE!\AppData\Local\Programs\ZCode" & goto :found_zcode
if exist "!ProgramFiles!\ZCode\ZCode.exe" set "ZCODE_DIR=!ProgramFiles!\ZCode" & goto :found_zcode
if exist "!ProgramFiles(x86)!\ZCode\ZCode.exe" set "ZCODE_DIR=!ProgramFiles(x86)!\ZCode" & goto :found_zcode
:: 注册表查询
for /f "skip=2 tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "ZCode" 2^>nul ^| find "DisplayIcon"') do (
    if exist "%%~dpBZCode.exe" set "ZCODE_DIR=%%~dpB" & goto :found_zcode
)
:: where 兜底
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

:: ========== 设置文件路径 ==========
set "ASAR=%ZCODE_DIR%\resources\app.asar"
set "ASAR_BAK=%ZCODE_DIR%\resources\app.asar.bak"
set "PLUGIN_JS=%PLUGIN_DIR%\zcode-customize.js"
set "INJECT_JS=%PLUGIN_DIR%\do-inject.js"

echo ════════════════════════════════════════
echo    LDZcode — ZCode 布局调整插件注入
echo ════════════════════════════════════════
echo.
echo  插件目录：%PLUGIN_DIR%
echo  ZCode目录：%ZCODE_DIR%
echo.

:: 检查必需文件
if not exist "%PLUGIN_JS%" (
    echo [错误] 找不到插件文件：%PLUGIN_JS%
    pause & exit /b 1
)
if not exist "%ASAR%" (
    echo [错误] 找不到 app.asar：%ASAR%
    pause & exit /b 1
)

:: 关闭 ZCode
tasklist /FI "IMAGENAME eq ZCode.exe" 2>nul | find /I "ZCode.exe" >nul
if %errorlevel%==0 (
    echo [*] 正在关闭 ZCode...
    taskkill /F /IM ZCode.exe >nul 2>&1
    timeout /t 3 /nobreak >nul
)

:: 备份
if not exist "%ASAR_BAK%" (
    echo [*] 备份原始 app.asar...
    copy "%ASAR%" "%ASAR_BAK%" >nul
)

:: ========== 注入方案 1：Node.js + do-inject.js (推荐) ==========
echo.
echo [方案1] 使用 Node.js + @electron/asar 注入...

:: 查找 node.exe
set "NODE="
for %%p in (
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "%LOCALAPPDATA%\Programs\nodejs\node.exe"
) do if exist %%p set "NODE=%%p"
if not defined NODE for /f "delims=" %%p in ('where node.exe 2^>nul') do set "NODE=%%p"

if defined NODE if exist "%INJECT_JS%" (
    echo  使用 Node: !NODE!
    echo.
    "!NODE!" "%INJECT_JS%" "%ASAR%" "%PLUGIN_JS%"
    if !errorlevel! equ 0 goto :success
    echo  [*] do-inject.js 失败，回退到方案2...
) else (
    echo  [*] 未找到 Node.js 或 do-inject.js，尝试方案2...
)

:: ========== 注入方案 2：npx asar CLI (兜底) ==========
echo.
echo [方案2] 使用 npx asar CLI 注入...

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
    echo [错误] 未找到 Node.js/npx。请安装 Node.js https://nodejs.org
    echo   或复制 node_modules/@electron/asar 到 %PLUGIN_DIR% 目录后重试。
    pause & exit /b 1
)
echo  使用 npx: !NPX_CMD!

pushd "%TEMP%"
if exist _ldzcode_inject rmdir /s /q _ldzcode_inject >nul 2>&1
mkdir _ldzcode_inject 2>nul
cd _ldzcode_inject

echo [1/3] 解压 app.asar...
"!NPX_CMD!" asar e "%ASAR%" .
if !errorlevel! neq 0 (
    echo [错误] 解压失败
    popd & rmdir /s /q _ldzcode_inject >nul 2>&1
    pause & exit /b 1
)

echo [2/3] 注入插件脚本...
if not exist "out\renderer\assets" mkdir "out\renderer\assets"
copy "%PLUGIN_JS%" "out\renderer\assets\zcode-customize.js" >nul
:: 注入 script 引用
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

echo [3/3] 打包 app.asar...
"!NPX_CMD!" asar p . "%ASAR%"
if !errorlevel! neq 0 (
    echo [错误] 打包失败
    popd & rmdir /s /q _ldzcode_inject >nul 2>&1
    pause & exit /b 1
)
popd
rmdir /s /q "%TEMP%\_ldzcode_inject" >nul 2>&1

:success
if not exist "%ASAR_BAK%" copy "%ASAR%" "%ASAR_BAK%" >nul

echo.
echo ════════════════════════════════════════
echo    [完成] LDZcode 插件注入成功！
echo.
echo    [操作] 请重新启动 ZCode
echo    [快捷键] Alt+L 打开设置面板
echo    [恢复] ZCode 升级后，再次运行此 bat 即可
echo    [备份] app.asar.bak 已保留
echo ════════════════════════════════════════
echo.
pause
