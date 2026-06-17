@echo off
chcp 65001 >nul
title LUODA - Backend Service
cd /d "%~dp0"

:: Kill any existing node processes to avoid port conflicts
taskkill /f /im node.exe >nul 2>&1
ping 127.0.0.1 -n 3 >nul

set PROXY_PORT=40000
set CONFIG_PORT=40001
set ADMIN_PORT=40002

:: Clear proxy env vars to avoid interfering with upstream API calls
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Node.js not found
    pause
    exit /b 1
)

echo ============================================
echo   LUODA Backend Service - Starting
echo ============================================
echo.
echo Proxy:      http://127.0.0.1:%PROXY_PORT%
echo Config API: http://127.0.0.1:%CONFIG_PORT%
echo Admin:      http://127.0.0.1:%ADMIN_PORT%
echo.

if not exist data mkdir data
start /B node index.mjs > dataluoda.log 2>&1

echo Starting services, please wait...
ping 127.0.0.1 -n 5 >nul

echo Opening admin panel...
start http://127.0.0.1:%ADMIN_PORT%/login.html

echo.
echo --------------------------------------------
echo   Service is running in background.
echo   Close this window will not stop service.
echo   To stop: double-click stop.bat
echo --------------------------------------------
echo.
timeout /t 10 >nul
