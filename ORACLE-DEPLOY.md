# Flow Kit — Oracle Cloud Deployment Guide

## Step 1: Create VM on Oracle Cloud

1. Go to https://cloud.oracle.com → **Compute** → **Instances** → **Create Instance**
2. Configure:
   - **Name:** `flowkit`
   - **Image:** Ubuntu 22.04 or 24.04 (or Ubuntu Minimal)
   - **Shape:** VM.Standard.E2.1.Micro (Free tier, 1 OCPU, 1 GB RAM)
   - **Networking:** Create new VCN → Create new subnet → Assign public IP
   - **SSH Keys:** Upload your SSH public key (`~/.ssh/id_rsa.pub`)
3. Click **Create** and wait 2-3 minutes for the instance to start
4. Note the **Public IP address** (e.g., `129.154.xx.xx`)

## Step 2: Open Firewall Ports

Oracle Cloud blocks ports by default. You need to open them:

1. Go to **Networking** → **Virtual Cloud Networks** → click your VCN
2. Click **Subnet** → **Security Lists** → **Default Security List**
3. **Add Ingress Rules:**

| Port | Protocol | Description |
|------|----------|-------------|
| 22 | TCP | SSH |
| 3000 | TCP | Frontend UI |
| 8100 | TCP | Backend API |
| 9222 | TCP | WebSocket (Chrome extension) |

4. Click **Add Ingress Rules**

## Step 3: Deploy Flow Kit

### Option A: Auto Deploy (Recommended)

```powershell
# From your Windows machine
cd C:\Users\Ranjan Shrestha\OneDrive\Desktop\backup\final-production

# Deploy to Oracle Cloud
.\deploy-oracle.ps1 -VmIp <YOUR_VM_IP>
```

### Option B: Manual Deploy

```powershell
# 1. SSH into VM
ssh ubuntu@<YOUR_VM_IP>

# 2. Upload setup script
scp oracle-cloud-setup.sh ubuntu@<YOUR_VM_IP>:/tmp/

# 3. Run setup
ssh ubuntu@<YOUR_VM_IP>
sudo bash /tmp/oracle-cloud-setup.sh
```

## Step 4: Get Your Auth Token

```bash
ssh ubuntu@<YOUR_VM_IP> 'cat /opt/flowkit/.auth-token'
```

Save this token — you'll need it for the Chrome extension.

## Step 5: Configure Chrome Extension

In Chrome DevTools → Console, run:

```javascript
// Set for Oracle Cloud (replace <YOUR_VM_IP>)
chrome.storage.local.set({
  config_ws_url: 'ws://<YOUR_VM_IP>:9222',
  config_http_callback_url: 'http://<YOUR_VM_IP>:8100/api/ext/callback',
  config_auth_token: '<YOUR_AUTH_TOKEN>'
});
```

## Step 6: Access Your App

- **Frontend:** `http://<YOUR_VM_IP>:3000`
- **Backend:** `http://<YOUR_VM_IP>:8100`

## Troubleshooting

### Can't connect via SSH

```bash
# Check instance status in Oracle Cloud console
# Ensure Security List has port 22 open
# Try: ssh -i ~/.ssh/id_rsa ubuntu@<YOUR_VM_IP>
```

### Services not starting

```bash
# Check logs
sudo journalctl -u flowkit-backend -f
sudo journalctl -u flowkit-frontend -f

# Restart services
sudo systemctl restart flowkit-backend
sudo systemctl restart flowkit-frontend
```

### Chrome extension not connecting

1. Check firewall ports 8100 and 9222 are open
2. Verify extension config in Chrome DevTools → Application → Storage
3. Check backend logs for connection attempts
