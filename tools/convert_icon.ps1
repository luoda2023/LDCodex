Add-Type -AssemblyName System.Drawing

$root = "J:/codex-work/LDCodex"
$iconsDir = "$root/apps/codex-plus-manager/src-tauri/icons"

function Convert-PngToIco {
    param([string]$inputFile, [string]$outputFile)
    
    $bmp = [System.Drawing.Image]::FromFile($inputFile)
    $sizes = @(16, 24, 32, 48, 64, 128, 256)
    
    $fs = New-Object System.IO.FileStream($outputFile, [System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter($fs)
    
    # ICO header
    $bw.Write([UInt16]0)     # reserved
    $bw.Write([UInt16]1)     # ICO type
    $bw.Write([UInt16]$sizes.Length)  # image count
    
    $dirOffset = 6 + $sizes.Length * 16
    $imageDatas = @()
    
    foreach ($size in $sizes) {
        $resized = New-Object System.Drawing.Bitmap($bmp, $size, $size)
        $ms = New-Object System.IO.MemoryStream
        $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $imageDatas += $ms.ToArray()
        $ms.Close()
        $resized.Dispose()
    }
    
    for ($i = 0; $i -lt $sizes.Length; $i++) {
        $w = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
        $bw.Write([Byte]$w)   # width
        $bw.Write([Byte]$w)   # height
        $bw.Write([Byte]0)    # color palette
        $bw.Write([Byte]0)    # reserved
        $bw.Write([UInt16]1)  # color planes
        $bw.Write([UInt16]32) # bits per pixel
        $bw.Write([UInt32]$imageDatas[$i].Length)  # image size
        $bw.Write([UInt32]$dirOffset)  # image offset
        $dirOffset += $imageDatas[$i].Length
    }
    
    foreach ($data in $imageDatas) {
        $bw.Write($data)
    }
    
    $bw.Close()
    $fs.Close()
    $bmp.Dispose()
    
    Write-Host "Created $outputFile"
}

# Convert LDAI.png → LDAI.ico (for management tool + installer)
Convert-PngToIco -inputFile "$root/LDAI.png" -outputFile "$iconsDir/LDAI.ico"

# Convert LDZcode.png → LDZcode.ico (for ZCode launcher)
Convert-PngToIco -inputFile "$root/LDZcode.png" -outputFile "$iconsDir/LDZcode.ico"

# Keep original icon.ico unchanged (for LDCodex main app)
Write-Host "Done. icon.ico unchanged (for LDCodex)."
