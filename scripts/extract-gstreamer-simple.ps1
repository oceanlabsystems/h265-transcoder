# PowerShell script to extract GStreamer MSI using multiple methods
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

function Test-GstLaunchExists {
    param([string]$Dir)
    $gstLaunch = Join-Path $Dir "bin\gst-launch-1.0.exe"
    return (Test-Path $gstLaunch)
}

function Find-GstLaunch {
    param([string]$SearchDir)
    $searchPaths = @(
        Join-Path $SearchDir "bin\gst-launch-1.0.exe",
        Join-Path $SearchDir "MSVC-x86_64-1.0\bin\gst-launch-1.0.exe",
        Join-Path $SearchDir "gstreamer-1.0-msvc-x86_64-1.22.10\bin\gst-launch-1.0.exe",
        Join-Path $SearchDir "1.0\msvc_x86_64\bin\gst-launch-1.0.exe"
    )
    
    foreach ($searchPath in $searchPaths) {
        if (Test-Path $searchPath) {
            return Split-Path (Split-Path $searchPath)
        }
    }
    return $null
}

# Method 1: Try Windows Installer COM object (no admin needed, reads MSI database)
Write-Host "`nMethod 1: Using Windows Installer COM object..." -ForegroundColor Yellow
try {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.GetType().InvokeMember("OpenDatabase", "InvokeMethod", $null, $installer, @($MsiPath, 0))
    
    $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, "SELECT `Name`, `Data` FROM `Binary` WHERE `Name` LIKE '%gst-launch%'")
    $view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null)
    
    # This method is complex for full extraction, so we'll skip it and try other methods
    Write-Host "COM object method available but complex for full extraction, trying other methods..." -ForegroundColor Gray
} catch {
    Write-Host "COM object method not available: $_" -ForegroundColor Gray
}

# Method 2: Try msiexec /a (administrative install - may work without admin in some cases)
Write-Host "`nMethod 2: Trying msiexec administrative install..." -ForegroundColor Yellow
$tempDir = Join-Path $ExtractDir "temp_msiexec"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
}

try {
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList "/a", "`"$MsiPath`"", "/qn", "TARGETDIR=`"$tempDir`"" -Wait -PassThru -NoNewWindow -ErrorAction SilentlyContinue
    
    if ($process -and $process.ExitCode -eq 0) {
        $sourceDir = Find-GstLaunch -SearchDir $tempDir
        if ($sourceDir) {
            Write-Host "Found files at: $sourceDir" -ForegroundColor Green
            Copy-Item -Path "$sourceDir\*" -Destination $ExtractDir -Recurse -Force
            Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
            
            if (Test-GstLaunchExists -Dir $ExtractDir) {
                Write-Host "✓ Successfully extracted using msiexec" -ForegroundColor Green
                exit 0
            }
        }
    }
    Write-Host "msiexec completed but files not found" -ForegroundColor Yellow
} catch {
    Write-Host "msiexec failed: $_" -ForegroundColor Yellow
}

# Method 3: Try 7-Zip (if available)
Write-Host "`nMethod 3: Trying 7-Zip..." -ForegroundColor Yellow
$sevenZip = $null
$paths = @(
    "${env:ProgramFiles}\7-Zip\7z.exe",
    "${env:ProgramFiles(x86)}\7-Zip\7z.exe",
    "${env:ProgramFiles}\7-Zip\7za.exe",
    "${env:ProgramFiles(x86)}\7-Zip\7za.exe"
)

foreach ($path in $paths) {
    if (Test-Path $path) {
        $sevenZip = $path
        break
    }
}

if ($sevenZip) {
    Write-Host "Using 7-Zip at: $sevenZip" -ForegroundColor Gray
    $tempDir = Join-Path $ExtractDir "temp_7zip"
    if (-not (Test-Path $tempDir)) {
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    }
    
    try {
        $output = & $sevenZip x "`"$MsiPath`"" -o"`"$tempDir`"" -y 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            $sourceDir = Find-GstLaunch -SearchDir $tempDir
            if ($sourceDir) {
                Write-Host "Found files at: $sourceDir" -ForegroundColor Green
                Copy-Item -Path "$sourceDir\*" -Destination $ExtractDir -Recurse -Force
                Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
                
                if (Test-GstLaunchExists -Dir $ExtractDir) {
                    Write-Host "✓ Successfully extracted using 7-Zip" -ForegroundColor Green
                    exit 0
                }
            }
        }
        Write-Host "7-Zip extraction completed but files not found" -ForegroundColor Yellow
    } catch {
        Write-Host "7-Zip extraction failed: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "7-Zip not found" -ForegroundColor Yellow
}

# Method 4: Try using expand.exe (Windows built-in, but MSI files are not CAB files)
# This won't work for MSI, but we'll note it

# All methods failed
Write-Host "`n❌ All automatic extraction methods failed." -ForegroundColor Red
Write-Host "`nPlease try one of these manual methods:" -ForegroundColor Yellow
Write-Host "1. Install 7-Zip from https://www.7-zip.org/ and extract the MSI manually" -ForegroundColor White
Write-Host "2. Run as Administrator and use: msiexec /a `"$MsiPath`" /qn TARGETDIR=`"$ExtractDir`"" -ForegroundColor White
Write-Host "3. Double-click the MSI and install to a temp location, then copy files to: $ExtractDir" -ForegroundColor White
exit 1
