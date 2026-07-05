# LDZcode — ZCode 布局调整插件注入 (PowerShell)
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\inject-zcode.ps1"

$ErrorActionPreference = "Stop"

# 自动检测路径
$pluginDir = if (Test-Path "$PSScriptRoot\zcode-customize.js") { $PSScriptRoot } else { "$env:USERPROFILE\.zcode\LDZcode" }

$zcodeDir = if ($env:ZCODE_DIR -and (Test-Path "$env:ZCODE_DIR\ZCode.exe")) {
    $env:ZCODE_DIR
} elseif (Test-Path "$env:LOCALAPPDATA\Programs\ZCode\ZCode.exe") {
    "$env:LOCALAPPDATA\Programs\ZCode"
} elseif (Test-Path "$env:USERPROFILE\AppData\Local\Programs\ZCode\ZCode.exe") {
    "$env:USERPROFILE\AppData\Local\Programs\ZCode"
} elseif (Test-Path "C:\Program Files\ZCode\ZCode.exe") {
    "C:\Program Files\ZCode"
} else {
    Write-Host "[错误] 找不到 ZCode.exe！请设置环境变量 ZCODE_DIR。" -ForegroundColor Red
    exit 1
}

$asar = "$zcodeDir\resources\app.asar"
$asarBak = "$zcodeDir\resources\app.asar.bak"
$pluginJs = "$pluginDir\zcode-customize.js"

Write-Host "插件目录: $pluginDir" -ForegroundColor Cyan
Write-Host "ZCode目录: $zcodeDir" -ForegroundColor Cyan

if (-not (Test-Path $pluginJs)) {
    Write-Host "[错误] 找不到插件文件：$pluginJs" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $asar)) {
    Write-Host "[错误] 找不到 app.asar：$asar" -ForegroundColor Red
    exit 1
}

# 关闭 ZCode
$zcodeProc = Get-Process ZCode -ErrorAction SilentlyContinue
if ($zcodeProc) {
    Write-Host "[*] 正在关闭 ZCode..."
    Stop-Process -Name ZCode -Force
    Start-Sleep -Seconds 3
}

# 备份
if (-not (Test-Path $asarBak)) {
    Write-Host "[*] 备份原始 app.asar..."
    Copy-Item $asar $asarBak
}

Write-Host "[1/4] 解压 app.asar..."
$tmpDir = "$env:TEMP\_ldzcode_inject"
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
Push-Location $tmpDir

npx asar e "$asar" "."
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] 解压失败" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host "[2/4] 注入插件脚本..."
$assetsDir = "out\renderer\assets"
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null }
Copy-Item $pluginJs "$assetsDir\zcode-customize.js" -Force

Write-Host "[3/4] 修改 index.html..."
$htmlPath = "out\renderer\index.html"
$html = Get-Content $htmlPath -Raw
if ($html -notmatch 'zcode-customize') {
    $html = $html -replace '(</body>)', '  <script defer src="./assets/zcode-customize.js"></script>`r`n$1'
    Set-Content $htmlPath $html -Encoding UTF8 -NoNewline
    Write-Host "OK"
} else {
    Write-Host "已存在，跳过"
}

Write-Host "[4/4] 重新打包 app.asar..."
npx asar p "." "$asar"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] 打包失败" -ForegroundColor Red
    Pop-Location
    exit 1
}

Pop-Location
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $asarBak)) { Copy-Item $asar $asarBak }

Write-Host ""
Write-Host "[完成] LDZcode 插件注入成功！" -ForegroundColor Green
Write-Host "[提示] 请重新启动 ZCode，快捷键 Alt+L 打开设置面板。" -ForegroundColor Yellow
