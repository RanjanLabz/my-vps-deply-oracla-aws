# Flow Kit - Setup Script
# Creates virtual environment, installs dependencies, downloads Chrome for Testing

Write-Host "=== Flow Kit Setup ===" -ForegroundColor Cyan

# Check Python
try {
    $pyVer = python --version 2>&1
    Write-Host "Python: $pyVer" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Python not found. Install Python 3.10+" -ForegroundColor Red
    exit 1
}

# Create venv
if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
    Write-Host "Created venv/" -ForegroundColor Green
} else {
    Write-Host "venv/ already exists" -ForegroundColor Yellow
}

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
& "venv\Scripts\pip.exe" install -r requirements.txt
Write-Host "Dependencies installed" -ForegroundColor Green

# Download Chrome for Testing if not present
$chromeExe = "chrome_for_testing\chrome-win64\chrome.exe"
if (-not (Test-Path $chromeExe)) {
    Write-Host "Downloading Chrome for Testing..." -ForegroundColor Yellow
    $chromeVersion = "150.0.7871.24"
    $chromeUrl = "https://storage.googleapis.com/chrome-for-testing-public/$chromeVersion/win64/chrome-win64.zip"
    $zipPath = "chrome_for_testing\chrome-win64.zip"

    New-Item -ItemType Directory -Force -Path "chrome_for_testing" | Out-Null

    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $chromeUrl -OutFile $zipPath -TimeoutSec 300
        Expand-Archive -Path $zipPath -DestinationPath "chrome_for_testing" -Force
        Remove-Item $zipPath -Force
        $ProgressPreference = 'Continue'

        if (Test-Path $chromeExe) {
            Write-Host "Chrome for Testing downloaded: $chromeVersion" -ForegroundColor Green
        } else {
            Write-Host "WARNING: Chrome download succeeded but exe not found at expected path" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "WARNING: Chrome download failed: $_" -ForegroundColor Yellow
        Write-Host "You can manually download Chrome for Testing from:" -ForegroundColor Yellow
        Write-Host "  https://googlechromelabs.github.io/chrome-for-testing/" -ForegroundColor Yellow
        Write-Host "  Extract to: chrome_for_testing/chrome-win64/chrome.exe" -ForegroundColor Yellow
        Write-Host "  Or set CHROME_BINARY env var to your Chrome path" -ForegroundColor Yellow
    }
} else {
    Write-Host "Chrome for Testing already installed" -ForegroundColor Green
}

# Verify
Write-Host "Verifying agent import..." -ForegroundColor Yellow
& "venv\Scripts\python.exe" -c "import agent; print('agent OK')"
Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host "Next steps:"
Write-Host "  1. Start agent:  .\scripts\start-agent.ps1" -ForegroundColor White
Write-Host "  2. Start UI:     .\scripts\start-frontend.ps1" -ForegroundColor White
Write-Host "  3. Load extension in Chrome from extension/ folder" -ForegroundColor White
