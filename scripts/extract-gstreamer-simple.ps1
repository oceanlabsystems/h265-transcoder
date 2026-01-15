# Simple PowerShell script to extract GStreamer MSI using 7-Zip
param(
    [string]$MsiPath,
    [string]$ExtractDir
)

if (-not $MsiPath) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $MsiPath = Join-Path (Split-Path $scriptDir) "gstreamer\gstreamer-1.0-msvc-x86_64-1.22.10.msi"
}

if (-not $ExtractDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $arch = if ([Environment]::Is64BitProcess) { "x64" } else { "x86" }
    $ExtractDir = Join-Path (Split-Path $scriptDir) "gstreamer\$arch"
}

Write-Host "Extracting GStreamer MSI..." -ForegroundColor Cyan
Write-Host "MSI: $MsiPath" -ForegroundColor Gray
Write-Host "Target: $ExtractDir" -ForegroundColor Gray

if (-not (Test-Path $MsiPath)) {
    Write-Host "Error: MSI file not found: $MsiPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $ExtractDir)) {
    New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
}

# Find 7-Zip
$sevenZip = $null
$paths = @(
    "${env:ProgramFiles}\7-Zip\7z.exe",
    "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
)

foreach ($path in $paths) {
    if (Test-Path $path) {
        $sevenZip = $path
        break
    }
}

if (-not $sevenZip) {
    Write-Host ""
    Write-Host "7-Zip not found. Please install 7-Zip or extract manually." -ForegroundColor Red
    Write-Host "Download from: https://www.7-zip.org/" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Using 7-Zip at: $sevenZip" -ForegroundColor Yellow

$tempDir = Join-Path $ExtractDir "temp"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
}

try {
    & $sevenZip x "`"$MsiPath`"" -o"`"$tempDir`"" -y | Out-Null
    
    if ($LASTEXITCODE -ne 0) {
        throw "7-Zip extraction failed"
    }
    
    # Find extracted files
    $searchPaths = @(
        Join-Path $tempDir "bin\gst-launch-1.0.exe",
        Join-Path $tempDir "MSVC-x86_64-1.0\bin\gst-launch-1.0.exe",
        Join-Path $tempDir "gstreamer-1.0-msvc-x86_64-1.22.10\bin\gst-launch-1.0.exe"
    )
    
    $sourceDir = $null
    foreach ($searchPath in $searchPaths) {
        if (Test-Path $searchPath) {
            $sourceDir = Split-Path (Split-Path $searchPath)
            break
        }
    }
    
    if ($sourceDir) {
        Write-Host "Found files at: $sourceDir" -ForegroundColor Green
        Copy-Item -Path "$sourceDir\*" -Destination $ExtractDir -Recurse -Force
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        
        $gstLaunch = Join-Path $ExtractDir "bin\gst-launch-1.0.exe"
        if (Test-Path $gstLaunch) {
            Write-Host "Successfully extracted" -ForegroundColor Green
            exit 0
        }
    }
    
    Write-Host "Files extracted but not found in expected location" -ForegroundColor Yellow
} catch {
    Write-Host "Extraction failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Extraction failed. Please extract manually using 7-Zip." -ForegroundColor Red
exit 1
