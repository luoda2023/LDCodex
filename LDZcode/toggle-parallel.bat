@echo off
chcp 65001 >nul
title LDZcode 并行对话切换

set "PLUGIN_DIR=J:\WorkBuddy-work\LDZcode"
set "NODE_EXE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe"

echo ════════════════════════════════════════
echo    LDZcode — 并行对话模式切换
echo ════════════════════════════════════════
echo.

if "%1"=="" (
    "%NODE_EXE%" "%PLUGIN_DIR%\toggle-parallel.js"
    echo.
    echo 用法: 双击本文件切换到并行模式
    echo       按住 Shift 双击切换到队列模式
    pause
    exit /b
)

"%NODE_EXE%" "%PLUGIN_DIR%\toggle-parallel.js" %1
echo.
pause
