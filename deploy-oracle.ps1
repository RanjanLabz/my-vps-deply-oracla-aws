# =============================================================================
# Flow Kit — Deploy to Oracle Cloud
# =============================================================================
# Pushes local project to Oracle Cloud VM and sets up everything.
#
# Prerequisites:
#   - SSH key configured for your Oracle Cloud VM
#   - VM running Ubuntu 22.04/24.04
#
# Usage:
#   .\deploy-oracle.ps1 -VmIp <VM_IP> -SshKey <path_to_key>
# =============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$VmIp,

    [Parameter(Mandatory=$false)]
    [string]$SshKey = "$env:USERPROFILE\.ssh\id_rsa",

    [Parameter(Mandatory=$false)]
    [string]$SshUser = "ubuntu",

    [Parameter(Mandatory=$false)]
    [string]$ProjectDir = "$PSScriptRoot\.."
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Flow Kit — Deploy to Oracle Cloud" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "VM: ${SshUser}@${VmIp}"
Write-Host "SSH Key: ${SshKey}"
Write-Host "Project: ${ProjectDir}"
Write-Host ""

# ─── Test SSH Connection ─────────────────────────────────────

Write-Host "[1/5] Testing SSH connection..." -ForegroundColor Yellow
$sshArgs = @("-i", $SshKey, "-o", "StrictHostKeyChecking=no", "${SshUser}@${VmIp}")
$testResult = ssh @sshArgs "echo 'SSH OK'" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Cannot connect to VM. Check SSH key and VM status." -ForegroundColor Red
    exit 1
}
Write-Host "  SSH connection successful" -ForegroundColor Green

# ─── Upload Setup Script ─────────────────────────────────────

Write-Host "[2/5] Uploading setup script..." -ForegroundColor Yellow
scp -i $SshKey -o StrictHostKeyChecking=no "$ProjectDir\oracle-cloud-setup.sh" "${SshUser}@${VmIp}:/tmp/"

# ─── Upload Project Files ───────────────────────────────────

Write-Host "[3/5] Uploading project files..." -ForegroundColor Yellow

# Create tarball of project (excluding venv, node_modules, etc)
$tempTar = Join-Path $env:TEMP "flowkit-deploy.tar.gz"
$tarExclude = @(
    "venv",
    "node_modules",
    ".next",
    "chrome_for_testing",
    "chrome_profiles",
    "__pycache__",
    "*.pyc",
    ".env"
)

# Create exclusion list
$excludeArgs = @()
foreach ($ex in $tarExclude) {
    $excludeArgs += "--exclude=$ex"
}

# Create tarball
Write-Host "  Creating tarball..."
& tar @excludeArgs -czf $tempTar -C $ProjectDir .

# Upload tarball
Write-Host "  Uploading..."
scp -i $SshKey -o StrictHostKeyChecking=no $tempTar "${SshUser}@${VmIp}:/tmp/flowkit-deploy.tar.gz"

# Extract on VM
Write-Host "  Extracting on VM..."
ssh @sshArgs "sudo mkdir -p /opt/flowkit && sudo tar -xzf /tmp/flowkit-deploy.tar.gz -C /opt/flowkit && sudo chown -R root:root /opt/flowkit"

# Cleanup
Remove-Item $tempTar -ErrorAction SilentlyContinue

# ─── Run Setup Script ────────────────────────────────────────

Write-Host "[4/5] Running setup script on VM..." -ForegroundColor Yellow
ssh @sshArgs "chmod +x /tmp/oracle-cloud-setup.sh && sudo bash /tmp/oracle-cloud-setup.sh"

# ─── Display Results ─────────────────────────────────────────

Write-Host "[5/5] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Deployment Complete!" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Get your auth token:"
Write-Host "  ssh -i $SshKey ${SshUser}@${VmIp} 'cat /opt/flowkit/.auth-token'" -ForegroundColor Yellow
Write-Host ""
Write-Host "Access your app:"
Write-Host "  Frontend: http://${VmIp}:3000" -ForegroundColor Green
Write-Host "  Backend:  http://${VmIp}:8100" -ForegroundColor Green
Write-Host ""
