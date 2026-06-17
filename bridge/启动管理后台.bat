@echo off
chcp 65001 >nul
title LuoDaBridge 管理服务
echo [OK] 正在启动管理服务（独立于转发代理）...
echo [OK] 管理后台: http://127.0.0.1:37002
echo [OK] 登录密码: lkw666999
echo.
cd /d "%~dp0"
"C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe" manage.mjs
pause
