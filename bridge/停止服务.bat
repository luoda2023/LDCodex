@echo off
chcp 65001 >nul
title LUODA - Stop Service
cd /d "%~dp0"

taskkill /f /im node.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Service stopped.
) else (
    echo No running service found.
)

echo.
timeout /t 3 /nobreak >nul
