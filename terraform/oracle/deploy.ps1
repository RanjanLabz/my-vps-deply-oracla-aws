# Flow Kit — Oracle Cloud Deploy via Terraform
# Run this script to deploy Flow Kit to Oracle Cloud

param(
    [string]$TenancyOcid,
    [string]$UserOcid,
    [string]$Fingerprint,
    [string]$PrivateKeyPath,
    [string]$Region = "ap-singapore-1",
    [string]$SshPublicKeyPath = "$env:USERPROFILE\.ssh\id_rsa.pub",
    [string]$InstanceName = "flowkit-vps"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Flow Kit — Oracle Cloud Deploy" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan

# Check Terraform
if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Terraform..." -ForegroundColor Yellow
    $tfUrl = "https://releases.hashicorp.com/terraform/1.7.5/terraform_1.7.5_windows_amd64.zip"
    $zip = "$env:TEMP\terraform.zip"
    Invoke-WebRequest -Uri $tfUrl -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath "$env:LOCALAPPDATA\Terraform" -Force
    $env:PATH += ";$env:LOCALAPPDATA\Terraform"
}

# Prompt for missing values
if (-not $TenancyOcid) { $TenancyOcid = Read-Host "Tenancy OCID" }
if (-not $UserOcid) { $UserOcid = Read-Host "User OCID" }
if (-not $Fingerprint) { $Fingerprint = Read-Host "API Key Fingerprint" }
if (-not $PrivateKeyPath) { $PrivateKeyPath = Read-Host "Private Key Path (e.g. C:\Users\you\.oci\key.pem)" }

# Read SSH public key
$sshKey = Get-Content $SshPublicKeyPath -Raw

# Create terraform.tfvars
$tfvars = @"
tenancy_ocid     = "$TenancyOcid"
user_ocid        = "$UserOcid"
fingerprint      = "$Fingerprint"
private_key_path = "$($PrivateKeyPath -replace '\\','/')"
region           = "$Region"
ssh_public_key   = "$($sshKey.Trim())"
instance_name    = "$InstanceName"
"@

Set-Content -Path "$scriptDir\terraform.tfvars" -Value $tfvars
Write-Host "Created terraform.tfvars" -ForegroundColor Green

# Initialize and apply
Push-Location $scriptDir
try {
    Write-Host "`nInitializing Terraform..." -ForegroundColor Yellow
    terraform init

    Write-Host "`nPlanning deployment..." -ForegroundColor Yellow
    terraform plan

    $confirm = Read-Host "`nProceed with deploy? (yes/no)"
    if ($confirm -eq "yes") {
        Write-Host "`nDeploying..." -ForegroundColor Yellow
        terraform apply -auto-approve

        Write-Host "`nDeployment complete!" -ForegroundColor Green
        terraform output
    } else {
        Write-Host "Deployment cancelled." -ForegroundColor Red
    }
} finally {
    Pop-Location
}
