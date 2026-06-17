@echo off
chcp 65001 >nul
title LuoDaBridge 线上部署脚本

set SSH_HOST=47.114.75.115
set SSH_USER=root
set SSH_PASS=Lkw-666999
set LOCAL_DIR=J:\codex-bridge-main
set REMOTE_DIR=/root/codex-bridge-main

echo [OK] 开始部署到线上服务器 %SSH_HOST% ...
echo.

:: 上传修改后的文件
echo [OK] 上传 lib/protocol/openai-responses.mjs ...
sshpass -p %SSH_PASS% scp -o StrictHostKeyChecking=no "%LOCAL_DIR%\lib\protocol\openai-responses.mjs" %SSH_USER%@%SSH_HOST%:%REMOTE_DIR%/lib/protocol/openai-responses.mjs

if %ERRORLEVEL% neq 0 (
    echo [ERR] 上传失败！请检查网络连接和密码
    pause
    exit /b 1
)

:: 重启服务
echo [OK] 重启 LuoDaBridge 服务 ...
sshpass -p %SSH_PASS% ssh -o StrictHostKeyChecking=no %SSH_USER%@%SSH_HOST% "pm2 restart luoda-bridge 2>/dev/null || systemctl restart luoda-bridge 2>/dev/null || (cd %REMOTE_DIR% && pkill -f 'node index.mjs' 2>/dev/null; nohup node index.mjs > /var/log/luoda-bridge.log 2>&1 &)"

if %ERRORLEVEL% eq 0 (
    echo [OK] 部署完成！服务已重启
) else (
    echo [ERR] 重启命令执行异常，请手动检查
)

echo.
echo [OK] 完成！按任意键退出
pause >nul
