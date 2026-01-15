# PowerShell script to extract GStreamer MSI
param(
    [string]$MsiPath,
    [string]$ExtractDir
)

# Set default paths
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

# Create extract directory
if (-not (Test-Path $ExtractDir)) {
    New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
}

# Method 1: Try msiexec
Write-Host "`nTrying msiexec..." -ForegroundColor Yellow
$logFile = Join-Path $ExtractDir "msiexec.log"
$msiexecProcess = Start-Process -FilePath "msiexec.exe" -ArgumentList "/a", "`"$MsiPath`"", "/qn", "TARGETDIR=`"$ExtractDir`"", "/L*v", "`"$logFile`"" -Wait -PassThru -NoNewWindow -ErrorAction SilentlyContinue

if ($msiexecProcess -and $msiexecProcess.ExitCode -eq 0) {
    $gstLaunch = Join-Path $ExtractDir "bin\gst-launch-1.0.exe"
    if (Test-Path $gstLaunch) {
        Write-Host "✓ Successfully extracted using msiexec" -ForegroundColor Green
        exit 0
    }
    Write-Host "✗ msiexec completed but files not found" -ForegroundColor Yellow
} else {
    Write-Host "✗ msiexec failed (may require admin privileges)" -ForegroundColor Yellow
}

# Method 2: Try 7-Zip
$sevenZipPaths = @(
    "${env:ProgramFiles}\7-Zip\7z.exe",
    "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
)

foreach ($sevenZip in $sevenZipPaths) {
    if (-not (Test-Path $sevenZip)) {
        continue
    }
    
    Write-Host "`nTrying 7-Zip at: $sevenZip" -ForegroundColor Yellow
    
    $tempDir = Join-Path $ExtractDir "temp"
    if (-not (Test-Path $tempDir)) {
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    }
    
    $extractOutput = & $sevenZip x "`"$MsiPath`"" -o"`"$tempDir`"" -y 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ 7-Zip extraction failed" -ForegroundColor Yellow
        break
    }
    
    # Look for extracted files
    $path1 = Join-Path $tempDir "bin\gst-launch-1.0.exe"
    $path2 = Join-Path $tempDir "MSVC-x86_64-1.0\bin\gst-launch-1.0.exe"
    
    $sourceDir = $null
    if (Test-Path $path1) {
        $sourceDir = Split-Path (Split-Path $path1)
    } elseif (Test-Path $path2) {
        $sourceDir = Split-Path (Split-Path $path2)
    }
    
    if ($sourceDir -and (Test-Path $sourceDir)) {
        Write-Host "Found files at: $sourceDir" -ForegroundColor Green
        Copy-Item -Path "$sourceDir\*" -Destination $ExtractDir -Recurse -Force
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        
        $gstLaunch = Join-Path $ExtractDir "bin\gst-launch-1.0.exe"
        if (Test-Path $gstLaunch) {
            Write-Host "✓ Successfully extracted using 7-Zip" -ForegroundColor Green
            exit 0
        }
    }
    
    Write-Host "✗ 7-Zip extraction completed but files not found" -ForegroundColor Yellow
    break
}

Write-Host "`n❌ Automatic extraction failed." -ForegroundColor Red
Write-Host "`nPlease extract manually:" -ForegroundColor Yellow
Write-Host "1. Install 7-Zip and right-click the MSI > 7-Zip > Extract Here" -ForegroundColor White
Write-Host "2. Copy extracted files to: $ExtractDir" -ForegroundColor White
exit 1
