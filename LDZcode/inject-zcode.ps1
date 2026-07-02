#!/usr/bin/env powershell
# 一键注入 LDZcode 插件到 ZCode
# 用法：右键 PowerShell 管理员运行，执行：
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   & "J:\WorkBuddy-work\free\inject-zcode.ps1"

$ErrorActionPreference = "Stop"

$SourceFile = "J:\WorkBuddy-work\free\zcode-customize.js"
$ZCodeDir = "C:\Users\Administrator\AppData\Local\Programs\ZCode\resources\app_extracted\out\renderer"
$AssetsDir = Join-Path $ZCodeDir "assets"
$IndexHtml = Join-Path $ZCodeDir "index.html"
$TargetFile = Join-Path $AssetsDir "zcode-customize.js"

function Stop-ZCodeProcess {
    Get-Process -Name "ZCode" -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

if (!(Test-Path $SourceFile)) {
    Write-Host "[LDZcode] 错误：源文件不存在：$SourceFile" -ForegroundColor Red
    exit 1
}

if (!(Test-Path $ZCodeDir)) {
    Write-Host "[LDZcode] 错误：未找到 ZCode 目录：$ZCodeDir" -ForegroundColor Red
    exit 1
}

Write-Host "[LDZcode] 正在关闭 ZCode..." -ForegroundColor Cyan
Stop-ZCodeProcess

if (!(Test-Path $AssetsDir)) {
    New-Item -ItemType Directory -Path $AssetsDir -Force | Out-Null
}

Write-Host "[LDZcode] 正在复制插件脚本到 ZCode..." -ForegroundColor Cyan
Copy-Item -Path $SourceFile -Destination $TargetFile -Force

if (!(Test-Path $IndexHtml)) {
    Write-Host "[LDZcode] 错误：未找到 index.html：$IndexHtml" -ForegroundColor Red
    exit 1
}

Write-Host "[LDZcode] 正在修改 index.html 注入插件..." -ForegroundColor Cyan
$Marker = '<script src="./assets/zcode-customize.js"></script>'
$Html = Get-Content -Path $IndexHtml -Raw -Encoding UTF8

# 如果已经注入过，先移除旧标记，避免重复
$Html = $Html -replace "\s*<script src=\"\./assets/zcode-customize\.js\"></script>\s*", ""

# 在 </head> 前插入标记
if ($Html -notcontains $Marker) {
    $Html = $Html -replace "(</head>)", "$Marker`n    `$1"
}

Set-Content -Path $IndexHtml -Value $Html -Encoding UTF8 -NoNewline

Write-Host "[LDZcode] 注入完成。请重新启动 ZCode。" -ForegroundColor Green
Write-Host "[LDZcode] 提示：下次 ZCode 升级后，重新运行此脚本即可。" -ForegroundColor Green

# 可选：启动 ZCode
$Start = Read-Host "是否现在启动 ZCode？ (y/n)"
if ($Start -eq 'y' -or $Start -eq 'Y') {
    $Exe = "C:\Users\Administrator\AppData\Local\Programs\ZCode\ZCode.exe"
    if (Test-Path $Exe) {
        Start-Process $Exe
    } else {
        Write-Host "[LDZcode] 未找到 ZCode.exe：$Exe" -ForegroundColor Yellow
    }
}
