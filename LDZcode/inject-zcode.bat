@echo off
chcp 65001 >nul
title LDZcode 插件注入工具

setlocal enabledelayedexpansion

set "PLUGIN_DIR=J:\WorkBuddy-work\LDZcode"
set "ZCODE_DIR=C:\Users\Administrator\AppData\Local\Programs\ZCode"
set "ASAR=%ZCODE_DIR%\resources\app.asar"
set "ASAR_BAK=%ZCODE_DIR%\resources\app.asar.bak"
set "PLUGIN_JS=%PLUGIN_DIR%\zcode-customize.js"

echo ════════════════════════════════════════
echo    LDZcode — ZCode 布局调整插件注入
echo ════════════════════════════════════════
echo.

:: 关闭 ZCode
tasklist /FI "IMAGENAME eq ZCode.exe" 2>nul | find /I "ZCode.exe" >nul
if %errorlevel%==0 (
    echo [*] 正在关闭 ZCode...
    taskkill /F /IM ZCode.exe >nul 2>&1
    timeout /t 3 /nobreak >nul
)

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

echo [1/4] 解压 app.asar...
cd /d "%PLUGIN_DIR%"
if exist _tmp rmdir /s /q _tmp
mkdir _tmp 2>nul
cd _tmp
npx asar e "%ASAR%" . 2>nul
if %errorlevel% neq 0 (
    echo [错误] 解压失败，请检查 app.asar 是否存在
    cd .. & rmdir /s /q _tmp
    pause & exit /b 1
)

echo [2/4] 注入插件脚本...
copy "%PLUGIN_JS%" "out\renderer\assets\zcode-customize.js" >nul
if not exist "out\renderer\assets\zcode-customize.js" (
    echo [错误] 复制插件脚本失败
    cd .. & rmdir /s /q _tmp
    pause & exit /b 1
)

echo [3/4] 修改 index.html...
:: 在 </body> 前插入脚本（最可靠的位置）
powershell -Command ^
"$f='out\renderer\index.html'; ^
 $c=Get-Content $f -Raw; ^
 if($c -notmatch 'zcode-customize'){ ^
   $c=$c -replace '(</body>)','    <script src=\"./assets/zcode-customize.js\"></script>`r`n$1'; ^
   Set-Content $f $c -Encoding UTF8 -NoNewline; ^
   Write-Host 'OK' ^
 } else { ^
   Write-Host '已存在，跳过' ^
 }"

echo [4/4] 重新打包 app.asar...
npx asar p . "%ASAR%" 2>nul
if %errorlevel% neq 0 (
    echo [错误] 打包失败
    cd .. & rmdir /s /q _tmp
    pause & exit /b 1
)

cd ..
rmdir /s /q _tmp

echo.
echo [5/5] 设置并行对话模式...
set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe"
if exist "%NODE%" (
    "%NODE%" "%PLUGIN_DIR%\toggle-parallel.js" parallel >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] 并行对话模式已启用
    ) else (
        echo [警告] 并行模式设置失败，请稍后手动运行 toggle-parallel.bat
    )
) else (
    echo [跳过] 未找到 Node.js 运行环境
)

echo.
echo [完成] LDZcode 插件注入成功！
echo [提示] 请重新启动 ZCode，快捷键 Alt+L 打开设置面板。
echo [提示] ZCode 升级后，再次双击此 bat 即可恢复。
echo [备份] app.asar.bak 已保留在 ZCode 目录下
echo.

pause
