# H265 Transcoder Service Installer
# This script installs the H265 Transcoder CLI as a Windows service

param(
    [string]$InstallDir = "$env:ProgramFiles\H265 Transcoder",
    [string]$ConfigPath = "$env:ProgramData\H265 Transcoder\config.yaml",
    [string]$ServiceName = "H265TranscoderService",
    [string]$DisplayName = "H265 Transcoder Service",
    [string]$Description = "Monitors directories and automatically transcodes video files to H.265"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "H265 Transcoder Service Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check for administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script requires administrator privileges." -ForegroundColor Red
    Write-Host "Please run PowerShell as Administrator and try again." -ForegroundColor Yellow
    exit 1
}

# Determine paths
$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodePath) {
    # Try common Node.js locations
    $possiblePaths = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "$env:ProgramFiles (x86)\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )
    foreach ($p in $possiblePaths) {
        if (Test-Path $p) {
            $NodePath = $p
            break
        }
    }
}

if (-not $NodePath -or -not (Test-Path $NodePath)) {
    Write-Host "ERROR: Node.js not found. Please install Node.js first." -ForegroundColor Red
    exit 1
}

$CliPath = Join-Path $InstallDir "resources\app.asar.unpacked\out\cli\cli\index.js"
if (-not (Test-Path $CliPath)) {
    # Try alternative path for development
    $CliPath = Join-Path $InstallDir "out\cli\cli\index.js"
}

Write-Host "Node.js: $NodePath" -ForegroundColor Gray
Write-Host "CLI: $CliPath" -ForegroundColor Gray
Write-Host "Config: $ConfigPath" -ForegroundColor Gray
Write-Host ""

# Create config directory if needed
$ConfigDir = Split-Path $ConfigPath -Parent
if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    Write-Host "Created config directory: $ConfigDir" -ForegroundColor Green
}

# Create default config if not exists
if (-not (Test-Path $ConfigPath)) {
    $defaultConfig = @"
# H265 Transcoder Service Configuration
# Edit this file to configure the service

# Required: Input directory to monitor for new video files
input: C:\Videos\Input

# Required: Output directory for processed files
output: C:\Videos\Output

# Encoder: x265 (CPU), nvh265 (NVIDIA GPU), qsvh265 (Intel GPU)
encoder: x265

# Output format: mp4, mkv, mov
format: mkv

# Chunk duration in minutes
chunkDurationMinutes: 60

# Speed preset for x265: ultrafast, veryfast, faster, fast, medium, slow, slower, veryslow
speedPreset: medium

# Enable watch mode (required for service)
watch: true

# Optional: Move processed originals here
# processedDir: C:\Videos\Processed

# Optional: Move failed files here
# failedDir: C:\Videos\Failed

# Number of files to process simultaneously
concurrency: 1
"@
    Set-Content -Path $ConfigPath -Value $defaultConfig -Encoding UTF8
    Write-Host "Created default config: $ConfigPath" -ForegroundColor Green
    Write-Host "IMPORTANT: Edit the config file to set your input/output directories!" -ForegroundColor Yellow
}

# Check if service already exists
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Service '$ServiceName' already exists. Stopping and removing..." -ForegroundColor Yellow
    
    if ($existingService.Status -eq 'Running') {
        Stop-Service -Name $ServiceName -Force
        Start-Sleep -Seconds 2
    }
    
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
    Write-Host "Removed existing service." -ForegroundColor Green
}

# Create the service using sc.exe
$binPath = "`"$NodePath`" `"$CliPath`" --config `"$ConfigPath`" --watch"

Write-Host "Creating Windows service..." -ForegroundColor Cyan
sc.exe create $ServiceName binPath= $binPath start= auto displayname= $DisplayName | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to create service." -ForegroundColor Red
    exit 1
}

# Set service description
sc.exe description $ServiceName $Description | Out-Null

# Configure service recovery options (restart on failure)
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Service installed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Service Name: $ServiceName" -ForegroundColor Cyan
Write-Host "Config File:  $ConfigPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Edit the config file to set your input/output directories"
Write-Host "2. Start the service with: Start-Service $ServiceName"
Write-Host "3. Or use Services.msc to manage the service"
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Gray
Write-Host "  Start-Service $ServiceName"
Write-Host "  Stop-Service $ServiceName"
Write-Host "  Get-Service $ServiceName"
Write-Host ""
