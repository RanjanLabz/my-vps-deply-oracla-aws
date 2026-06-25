# Flow Kit — Oracle Cloud Deploy (Terraform)

Deploy Flow Kit to Oracle Cloud using Terraform. This creates a VPS with everything pre-configured.

## Prerequisites

1. **Terraform** — [Install](https://developer.hashicorp.com/terraform/install)
2. **OCI Account** — [Sign up](https://cloud.oracle.com)
3. **OCI API Key** — Generated and uploaded to OCI Console

## Quick Start

### Option 1: PowerShell Script (Recommended)

```powershell
cd terraform\oracle
.\deploy.ps1
```

The script will prompt for your OCI credentials.

### Option 2: Manual Steps

1. Copy `terraform.tfvars.example` to `terraform.tfvars`
2. Fill in your OCI credentials
3. Run:

```bash
terraform init
terraform plan    # Review changes
terraform apply   # Deploy
```

## Getting Your OCI Credentials

1. Log in to [OCI Console](https://cloud.oracle.com)
2. Click your profile → **User Settings**
3. Note your **User OCID**
4. Click your tenancy name → note **Tenancy OCID**
5. Go to **API Keys** → **Add API Key**
6. Paste your SSH public key, note the **Fingerprint**
7. Your region is shown in the top-right corner

## What Gets Created

- **VCN** with internet gateway, route table, and security list
- **Security rules** for: SSH (22), Node (3000), Backend (8100), Chrome DevTools (9222)
- **Compute instance** with:
  - Ubuntu 22.04 on ARM (VM.Standard.A1.Flex)
  - Xvfb (virtual framebuffer for Chrome)
  - Chromium browser
  - Node.js 20
  - Python 3
  - Flow Kit backend service (systemd)

## Outputs

After deployment, Terraform shows:
- `public_ip` — Your VPS IP address
- `instance_id` — OCI instance ID
- `instance_state` — Should be `RUNNING`

## SSH Into Your VPS

```bash
ssh opc@<public_ip>
```

## Destroy

```bash
terraform destroy
```

## Files

- `main.tf` — Terraform resources (VCN, subnet, compute)
- `variables.tf` — Input variables
- `terraform.tfvars.example` — Example config
- `deploy.ps1` — Windows deploy script
- `scripts/setup.sh` — Server setup script (run on instance)
