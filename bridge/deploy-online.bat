@echo off
title LuoDaBridge Deploy

set SSH_HOST=47.114.75.115
set SSH_USER=root
set REMOTE_DIR=/root/codex-bridge-main

echo [OK] Deploying to %SSH_HOST% ...
echo.

:: Upload modified file
echo [OK] Uploading lib/protocol/openai-responses.mjs ...
copy "J:\codex-bridge-main\lib\protocol\openai-responses.mjs" "J:\codex-bridge-main\vps-backup\lib\protocol\openai-responses.mjs" >nul 2>&1

:: Check if sshpass is available
where sshpass >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] sshpass not found. Installing via winget...
    winget install sshpass 2>nul || (
        echo [ERR] Cannot install sshpass automatically.
        echo.
        echo Please manually run:
        echo   scp J:\codex-bridge-main\lib\protocol\openai-responses.mjs root@47.114.75.115:/root/codex-bridge-main/lib/protocol/openai-responses.mjs
        echo.
        echo Then SSH and restart service:
        echo   ssh root@47.114.75.115 "pm2 restart luoda-bridge"
        pause
        exit /b 1
    )
)

:: Upload to server
sshpass -p Lkw-666999 scp -o StrictHostKeyChecking=no "J:\codex-bridge-main\lib\protocol\openai-responses.mjs" %SSH_USER%@%SSH_HOST%:%REMOTE_DIR%/lib/protocol/openai-responses.mjs

if %errorlevel% neq 0 (
    echo [ERR] scp failed! Check network and password.
    pause
    exit /b 1
)

:: Restart service on server
echo [OK] Restarting LuodaBridge service...
sshpass -p Lkw-666999 ssh -o StrictHostKeyChecking=no %SSH_USER%@%SSH_HOST% "pm2 restart luoda-bridge 2>/dev/null || systemctl restart luoda-bridge 2>/dev/null || (cd %REMOTE_DIR% && pkill -f 'node index.mjs' 2>/dev/null && nohup node index.mjs > /dev/null 2>&1 &)"

if %errorlevel% equ 0 (
    echo [OK] Deploy complete! Service restarted.
) else (
    echo [WARN] Restart command may have failed. Please check manually.
)

echo.
echo [OK] Done. Press any key to exit.
pause >nul
