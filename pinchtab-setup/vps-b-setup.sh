#!/bin/bash
# =============================================================================
# Flow Kit - VPS B Setup Script (PinchTab + Extension)
# =============================================================================
# This script sets up PinchTab on VPS B to manage Chrome instances
# with the Flow Kit extension loaded.
#
# Prerequisites:
#   - Ubuntu 22.04+ or Debian 12+
#   - Root access
#   - VPS A IP address (backend server)
#
# Usage:
#   chmod +x vps-b-setup.sh
#   sudo ./vps-b-setup.sh --vps-a-ip <VPS_A_IP> --auth-token <TOKEN>
# =============================================================================

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────

VPS_A_IP=""
AUTH_TOKEN=""
PINCHTAB_PORT=9867
EXTENSION_NAME="flowkit"
CHROME_FOR_TESTING_VERSION="136.0.7103.92"
CHROME_DIR="/opt/chrome-for-testing"

# ─── Parse Arguments ─────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    --vps-a-ip)
      VPS_A_IP="$2"
      shift 2
      ;;
    --auth-token)
      AUTH_TOKEN="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$VPS_A_IP" || -z "$AUTH_TOKEN" ]]; then
  echo "Usage: $0 --vps-a-ip <VPS_A_IP> --auth-token <TOKEN>"
  exit 1
fi

echo "=========================================="
echo "Flow Kit - VPS B Setup (PinchTab)"
echo "=========================================="
echo "VPS A IP: $VPS_A_IP"
echo "PinchTab Port: $PINCHTAB_PORT"
echo "Extension Name: $EXTENSION_NAME"
echo ""

# ─── System Dependencies ─────────────────────────────────────

echo "[1/8] Installing system dependencies..."
apt-get update
apt-get install -y curl wget unzip jq

# ─── Install Chrome for Testing ──────────────────────────────

echo "[2/8] Installing Chrome for Testing v${CHROME_FOR_TESTING_VERSION}..."
mkdir -p "$CHROME_DIR"

# Download Chrome for Testing (Linux)
CHROME_URL="https://storage.googleapis.com/chrome-for-testing-public/${CHROME_FOR_TESTING_VERSION}/linux64/chrome-linux64.zip"
wget -q "$CHROME_URL" -O /tmp/chrome.zip
unzip -q -o /tmp/chrome.zip -d /tmp/
mv /tmp/chrome-linux64/* "$CHROME_DIR/"
rm -rf /tmp/chrome.zip /tmp/chrome-linux64

# Make chrome executable
chmod +x "$CHROME_DIR/chrome"

echo "Chrome installed at: $CHROME_DIR/chrome"

# ─── Install PinchTab ────────────────────────────────────────

echo "[3/8] Installing PinchTab..."
curl -fsSL https://get.pinchtab.com | bash

# Verify installation
if ! command -v pinchtab &> /dev/null; then
  echo "ERROR: PinchTab installation failed"
  exit 1
fi

echo "PinchTab installed: $(pinchtab --version)"

# ─── Create Directory Structure ──────────────────────────────

echo "[4/8] Creating directory structure..."
mkdir -p ~/.pinchtab/extensions
mkdir -p ~/.pinchtab/profiles
mkdir -p ~/.pinchtab/config

# ─── Configure PinchTab ─────────────────────────────────────

echo "[5/8] Configuring PinchTab..."

cat > ~/.pinchtab/config.json << EOF
{
  "configVersion": "0.8.0",
  "server": {
    "port": "${PINCHTAB_PORT}",
    "bind": "0.0.0.0",
    "token": "${AUTH_TOKEN}"
  },
  "browser": {
    "binary": "${CHROME_DIR}/chrome",
    "extensionPaths": [
      "${HOME}/.pinchtab/extensions"
    ],
    "extraFlags": [
      "--no-first-run",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  },
  "instanceDefaults": {
    "mode": "headed",
    "stealthLevel": "light",
    "maxTabs": 20
  },
  "security": {
    "allowEvaluate": true,
    "allowCookies": true
  }
}
EOF

echo "PinchTab config written to: ~/.pinchtab/config.json"

# ─── Create Systemd Service ─────────────────────────────────

echo "[6/8] Creating PinchTab systemd service..."

cat > /etc/systemd/system/pinchtab.service << EOF
[Unit]
Description=PinchTab Browser Automation Server
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/pinchtab serve
Restart=always
RestartSec=5
Environment=HOME=/root
Environment=PINCHTAB_CONFIG=/root/.pinchtab/config.json

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pinchtab

echo "PinchTab service created"

# ─── Create Extension Manager API ────────────────────────────

echo "[7/8] Creating Extension Manager API..."

cat > /opt/extension-manager/requirements.txt << EOF
fastapi>=0.104.0
uvicorn>=0.24.0
python-multipart>=0.0.6
aiohttp>=3.9.0
EOF

cat > /opt/extension-manager/main.py << 'PYEOF'
"""
Extension Manager API for VPS B
Manages extensions and PinchTab instances via HTTP API.
"""
import os
import shutil
import subprocess
import zipfile
import tempfile
import json
import asyncio
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
import aiohttp

app = FastAPI(title="Extension Manager API")

PINCHTAB_URL = os.getenv("PINCHTAB_URL", "http://127.0.0.1:9867")
PINCHTAB_TOKEN = os.getenv("PINCHTAB_TOKEN", "")
EXTENSIONS_DIR = Path.home() / ".pinchtab" / "extensions"

# ─── Extension Management ────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "pinchtabs_url": PINCHTAB_URL}

@app.post("/extension/upload")
async def upload_extension(name: str = Form(...), extension: UploadFile = File(...)):
    ext_dir = EXTENSIONS_DIR / name
    if ext_dir.exists():
        shutil.rmtree(ext_dir)
    ext_dir.mkdir(parents=True)

    # Save uploaded zip
    zip_path = Path(tempfile.mktemp(suffix=".zip"))
    with open(zip_path, "wb") as f:
        content = await extension.read()
        f.write(content)

    # Extract
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(ext_dir)

    zip_path.unlink()

    files = list(ext_dir.rglob("*"))
    return {"status": "uploaded", "name": name, "files": len(files)}

@app.get("/extension")
async def list_extensions():
    extensions = []
    if EXTENSIONS_DIR.exists():
        for d in EXTENSIONS_DIR.iterdir():
            if d.is_dir():
                files = list(d.rglob("*"))
                extensions.append({"name": d.name, "files": len(files)})
    return {"extensions": extensions}

@app.get("/extension/{name}")
async def get_extension(name: str):
    ext_dir = EXTENSIONS_DIR / name
    if not ext_dir.exists():
        raise HTTPException(404, f"Extension '{name}' not found")
    files = [str(f.relative_to(ext_dir)) for f in ext_dir.rglob("*")]
    return {"name": name, "files": files}

@app.put("/extension/{name}")
async def update_extension(name: str, extension: UploadFile = File(...)):
    ext_dir = EXTENSIONS_DIR / name
    if ext_dir.exists():
        shutil.rmtree(ext_dir)
    ext_dir.mkdir(parents=True)

    zip_path = Path(tempfile.mktemp(suffix=".zip"))
    with open(zip_path, "wb") as f:
        content = await extension.read()
        f.write(content)

    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(ext_dir)

    zip_path.unlink()

    # Restart all instances to apply changes
    await _restart_all_instances()

    files = list(ext_dir.rglob("*"))
    return {"status": "updated", "name": name, "files": len(files), "restarted": True}

@app.delete("/extension/{name}")
async def delete_extension(name: str):
    ext_dir = EXTENSIONS_DIR / name
    if not ext_dir.exists():
        raise HTTPException(404, f"Extension '{name}' not found")
    shutil.rmtree(ext_dir)
    return {"status": "deleted", "name": name}

# ─── Instance Management ─────────────────────────────────────

async def _pinchtabs_request(method: str, path: str, data: dict = None):
    url = f"{PINCHTAB_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if PINCHTAB_TOKEN:
        headers["Authorization"] = f"Bearer {PINCHTAB_TOKEN}"

    async with aiohttp.ClientSession() as session:
        async with session.request(method, url, json=data, headers=headers) as resp:
            return await resp.json()

@app.get("/instance")
async def list_instances():
    result = await _pinchtabs_request("GET", "/instances")
    return result

@app.post("/instance/start")
async def start_instance(profile_name: str = Form("default"), extensions: str = Form("flowkit")):
    ext_list = [e.strip() for e in extensions.split(",")]
    data = {
        "profileName": profile_name,
        "extensions": ext_list,
    }
    result = await _pinchtabs_request("POST", "/instances/start", data)
    return result

@app.post("/instance/{instance_id}/stop")
async def stop_instance(instance_id: str):
    result = await _pinchtabs_request("POST", f"/instances/{instance_id}/stop")
    return result

@app.post("/instance/{instance_id}/restart")
async def restart_instance(instance_id: str):
    result = await _pinchtabs_request("POST", f"/instances/{instance_id}/restart")
    return result

@app.post("/instance/restart-all")
async def restart_all_instances():
    return await _restart_all_instances()

async def _restart_all_instances():
    instances = await _pinchtabs_request("GET", "/instances")
    results = []
    for inst in instances.get("instances", []):
        inst_id = inst.get("id")
        if inst_id:
            try:
                await _pinchtabs_request("POST", f"/instances/{inst_id}/restart")
                results.append({"id": inst_id, "status": "restarted"})
            except Exception as e:
                results.append({"id": inst_id, "error": str(e)})
    return {"results": results}

# ─── Config ──────────────────────────────────────────────────

@app.get("/config")
async def get_config():
    return {
        "pinchtabs_url": PINCHTAB_URL,
        "extensions_dir": str(EXTENSIONS_DIR),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
PYEOF

mkdir -p /opt/extension-manager
cat > /opt/extension-manager/start.sh << 'EOF'
#!/bin/bash
cd /opt/extension-manager
source venv/bin/activate
export PINCHTAB_URL="http://127.0.0.1:9867"
export PINCHTAB_TOKEN="<AUTH_TOKEN>"
python main.py
EOF
chmod +x /opt/extension-manager/start.sh

# Create venv and install deps
python3 -m venv /opt/extension-manager/venv
/opt/extension-manager/venv/bin/pip install -r /opt/extension-manager/requirements.txt

# Create systemd service for Extension Manager
cat > /etc/systemd/system/extension-manager.service << EOF
[Unit]
Description=Extension Manager API
After=network.target pinchtab.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/extension-manager
ExecStart=/opt/extension-manager/venv/bin/python main.py
Restart=always
RestartSec=5
Environment=HOME=/root
Environment=PINCHTAB_URL=http://127.0.0.1:${PINCHTAB_PORT}
Environment=PINCHTAB_TOKEN=${AUTH_TOKEN}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable extension-manager

echo "Extension Manager API created"

# ─── Start Services ──────────────────────────────────────────

echo "[8/8] Starting services..."
systemctl start pinchtab
systemctl start extension-manager

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Services:"
echo "  - PinchTab: http://0.0.0.0:${PINCHTAB_PORT}"
echo "  - Extension Manager: http://0.0.0.0:8080"
echo ""
echo "Next steps:"
echo "  1. Upload extension: curl -X POST http://<VPS_B_IP>:8080/extension/upload -F 'name=flowkit' -F 'extension=@extension.zip'"
echo "  2. Start instance: curl -X POST http://<VPS_B_IP>:8080/instance/start -F 'profile_name=account1' -F 'extensions=flowkit'"
echo ""
echo "Firewall ports to open:"
echo "  - ${PINCHTAB_PORT}/tcp (PinchTab API)"
echo "  - 8080/tcp (Extension Manager API)"
echo ""
