# Start the Next.js frontend
# Uses node directly to avoid Bun segfault on Windows
param(
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\.."

# Install deps if needed
if (-not (Test-Path "frontend\node_modules")) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location frontend
    npm install
    Pop-Location
}

Write-Host "Starting Flow Kit UI on http://localhost:$Port ..." -ForegroundColor Cyan
Push-Location frontend
node node_modules\next\dist\bin\next dev --webpack -p $Port
Pop-Location
