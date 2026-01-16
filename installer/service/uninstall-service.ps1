# H265 Transcoder Service Uninstaller
# This script removes the H265 Transcoder Windows service

param(
    [string]$ServiceName = "H265TranscoderService"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "H265 Transcoder Service Uninstaller" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check for administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script requires administrator privileges." -ForegroundColor Red
    Write-Host "Please run PowerShell as Administrator and try again." -ForegroundColor Yellow
    exit 1
}

# Check if service exists
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existingService) {
    Write-Host "Service '$ServiceName' is not installed." -ForegroundColor Yellow
    exit 0
}

Write-Host "Found service: $ServiceName" -ForegroundColor Cyan
Write-Host "Status: $($existingService.Status)" -ForegroundColor Gray
Write-Host ""

# Stop the service if running
if ($existingService.Status -eq 'Running') {
    Write-Host "Stopping service..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force
    Start-Sleep -Seconds 2
    Write-Host "Service stopped." -ForegroundColor Green
}

# Remove the service
Write-Host "Removing service..." -ForegroundColor Yellow
sc.exe delete $ServiceName | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to remove service." -ForegroundColor Red
    exit 1
}

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Service uninstalled successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Note: Configuration files were not removed." -ForegroundColor Gray
Write-Host "Config location: $env:ProgramData\H265 Transcoder\" -ForegroundColor Gray
Write-Host ""
