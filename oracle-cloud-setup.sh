#!/bin/bash
# =============================================================================
# Flow Kit — Oracle Cloud Auto Setup (Single VPS)
# =============================================================================
# Run this ONCE on a fresh Ubuntu 22.04/24.04 Oracle Cloud VM.
# It installs everything: Python, Node, Chrome, backend, frontend.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/you/repo/main/oracle-cloud-setup.sh | bash
#   OR
#   scp oracle-cloud-setup.sh root@YOUR_VM_IP:/tmp/
#   ssh root@YOUR_VM_IP
#   bash /tmp/oracle-cloud-setup.sh
# =============================================================================

set -euo pipefail

echo "============================================"
echo "  Flow Kit — Oracle Cloud Auto Setup"
echo "============================================"
echo ""

# ─── System Updates ──────────────────────────────────────────

echo "[1/9] Updating system..."
apt-get update -y
apt-get upgrade -y

# ─── Install Dependencies ────────────────────────────────────

echo "[2/9] Installing dependencies..."
apt-get install -y \
  curl wget git unzip jq build-essential \
  python3.11 python3.11-venv python3.11-dev python3-pip \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
  libatspi2.0-0

# ─── Install Node.js 18 ─────────────────────────────────────

echo "[3/9] Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

echo "Node: $(node --version)"
echo "npm: $(npm --version)"

# ─── Install Chrome for Testing ──────────────────────────────

echo "[4/9] Installing Chrome for Testing..."
CHROME_VERSION="136.0.7103.92"
CHROME_DIR="/opt/chrome-for-testing"

mkdir -p "$CHROME_DIR"
wget -q "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" -O /tmp/chrome.zip
unzip -q -o /tmp/chrome.zip -d /tmp/
mv /tmp/chrome-linux64/* "$CHROME_DIR/"
rm -rf /tmp/chrome.zip /tmp/chrome-linux64
chmod +x "$CHROME_DIR/chrome"

echo "Chrome installed: $CHROME_DIR/chrome"

# ─── Install Xvfb (Virtual Display) ─────────────────────────

echo "[5/9] Installing Xvfb..."
apt-get install -y xvfb

# Start Xvfb
Xvfb :99 -screen 0 1920x1080x24 -ac &>/dev/null &
export DISPLAY=:99
echo "Xvfb started on display :99"

# ─── Clone Flow Kit ──────────────────────────────────────────

echo "[5/9] Cloning Flow Kit..."
FLOWKIT_DIR="/opt/flowkit"

if [ -d "$FLOWKIT_DIR" ]; then
  cd "$FLOWKIT_DIR" && git pull
else
  git clone https://github.com/YOUR_USERNAME/final-production.git "$FLOWKIT_DIR"
fi

cd "$FLOWKIT_DIR"

# ─── Setup Python Backend ────────────────────────────────────

echo "[6/9] Setting up Python backend..."
python3.11 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install websocket-client

# Generate auth token
AUTH_TOKEN=$(openssl rand -hex 32)
echo "$AUTH_TOKEN" > /opt/flowkit/.auth-token
chmod 600 /opt/flowkit/.auth-token

# Create .env file
cat > .env << EOF
# Flow Kit Backend Configuration
API_HOST=0.0.0.0
API_PORT=8100
WS_HOST=0.0.0.0
WS_PORT=9222
CHROME_BINARY=${CHROME_DIR}/chrome
CHROME_EXTENSION_DIR=${FLOWKIT_DIR}/extension
AUTH_TOKEN=${AUTH_TOKEN}
DISPLAY=:99
EOF

echo "Auth token saved to: /opt/flowkit/.auth-token"

# ─── Setup Frontend ──────────────────────────────────────────

echo "[7/9] Setting up frontend..."
cd frontend
npm install
cd ..

# ─── Create Systemd Services ─────────────────────────────────

echo "[8/9] Creating systemd services..."

# Backend service
cat > /etc/systemd/system/flowkit-backend.service << EOF
[Unit]
Description=Flow Kit Backend API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${FLOWKIT_DIR}
ExecStartPre=/usr/bin/bash -c 'pgrep Xvfb || (Xvfb :99 -screen 0 1920x1080x24 -ac &>/dev/null & sleep 1)'
ExecStart=${FLOWKIT_DIR}/venv/bin/python -m agent.main
Restart=always
RestartSec=5
Environment=HOME=/root
Environment=DISPLAY=:99
EnvironmentFile=${FLOWKIT_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF

# Frontend service
cat > /etc/systemd/system/flowkit-frontend.service << EOF
[Unit]
Description=Flow Kit Frontend
After=network.target flowkit-backend.service

[Service]
Type=simple
User=root
WorkingDirectory=${FLOWKIT_DIR}/frontend
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 3000
Restart=always
RestartSec=5
Environment=HOME=/root
EnvironmentFile=${FLOWKIT_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable flowkit-backend
systemctl enable flowkit-frontend

# ─── Configure Firewall ──────────────────────────────────────

echo "[9/9] Configuring firewall..."
apt-get install -y ufw
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 3000/tcp  # Frontend
ufw allow 8100/tcp  # Backend API
ufw allow 9222/tcp  # WebSocket
ufw --force enable

# ─── Start Services ──────────────────────────────────────────

echo ""
echo "Starting services..."
systemctl start flowkit-backend
systemctl start flowkit-frontend

# Wait for services to start
sleep 5

echo ""
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
echo "Services:"
echo "  Backend API:  http://$(curl -s ifconfig.me):8100"
echo "  Frontend UI:  http://$(curl -s ifconfig.me):3000"
echo "  WebSocket:    ws://$(curl -s ifconfig.me):9222"
echo ""
echo "Auth Token: $(cat /opt/flowkit/.auth-token)"
echo ""
echo "Save this token! You'll need it for the Chrome extension."
echo ""
echo "Next steps:"
echo "  1. Open http://$(curl -s ifconfig.me):3000 in browser"
echo "  2. Install the Chrome extension"
echo "  3. Set extension config_ws_url to ws://$(curl -s ifconfig.me):9222"
echo "  4. Set extension config_http_callback_url to http://$(curl -s ifconfig.me):8100/api/ext/callback"
echo ""
echo "Check services:"
echo "  systemctl status flowkit-backend"
echo "  systemctl status flowkit-frontend"
echo "  journalctl -u flowkit-backend -f"
echo ""
