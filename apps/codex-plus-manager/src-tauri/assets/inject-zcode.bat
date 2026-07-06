@echo off
chcp 65001 >nul
title LDZcode 插件注入工具

setlocal enabledelayedexpansion

:: ========== 自动检测路径 ==========
:: 1) 插件目录：和本 bat 同目录 或 ~\.zcode\LDZcode
set "SELF_DIR=%~dp0"
set "PLUGIN_DIR=%SELF_DIR:~0,-1%"
if not exist "%PLUGIN_DIR%\zcode-customize.js" (
    set "PLUGIN_DIR=%USERPROFILE%\.zcode\LDZcode"
)

:: 2) ZCode 安装目录：环境变量优先，依次尝试已知路径
set "ZCODE_DIR=%ZCODE_DIR%"
if not defined ZCODE_DIR (
    set "ZCODE_DIR=%LOCALAPPDATA%\Programs\ZCode"
)
if not exist "%ZCODE_DIR%\ZCode.exe" (
    set "ZCODE_DIR=%USERPROFILE%\AppData\Local\Programs\ZCode"
)
if not exist "%ZCODE_DIR%\ZCode.exe" (
    set "ZCODE_DIR=C:\Program Files\ZCode"
)
if not exist "%ZCODE_DIR%\ZCode.exe" (
    echo [错误] 找不到 ZCode.exe！请设置环境变量 ZCODE_DIR 指向安装目录。
    pause & exit /b 1
)

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

:: 3) 查找 npx（cmd.exe 可能找不到 Node.js PATH）
set "NPX_CMD="
for %%p in (
    "%ProgramFiles%\nodejs\npx.cmd"
    "%ProgramFiles(x86)%\nodejs\npx.cmd"
    "%LOCALAPPDATA%\fnm\node-versions\*\installation\npx.cmd"
    "%APPDATA%\npm\npx.cmd"
) do if exist %%p set "NPX_CMD=%%p"
if not defined NPX_CMD (
    where npx.cmd >nul 2>&1 && set "NPX_CMD=npx.cmd"
)
if not defined NPX_CMD (
    where npx >nul 2>&1 && set "NPX_CMD=npx"
)
if not defined NPX_CMD (
    echo [错误] 未找到 npx，请安装 Node.js https://nodejs.org
    pause & exit /b 1
)
echo  使用 npx: %NPX_CMD%

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

:: 检查 npx 是否可用
where npx >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 npx，请安装 Node.js https://nodejs.org
    pause & exit /b 1
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
:: 在 </body> 前插入脚本
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

:: 创建 .bak 标记（用于 UI 检测注入状态）
if not exist "%ASAR_BAK%" copy "%ASAR%" "%ASAR_BAK%" >nul

echo.
echo [完成] LDZcode 插件注入成功！
echo [提示] 请重新启动 ZCode，快捷键 Alt+L 打开设置面板。
echo [提示] ZCode 升级后，再次运行此文件即可恢复。
echo [备份] %ASAR_BAK%
echo.

pause
