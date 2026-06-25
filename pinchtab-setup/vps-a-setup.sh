#!/bin/bash
# =============================================================================
# Flow Kit - VPS A Setup Script (Backend + Frontend)
# =============================================================================
# This script sets up the backend on VPS A to accept connections from
# Chrome instances running on VPS B (PinchTab).
#
# Prerequisites:
#   - Ubuntu 22.04+ or Debian 12+
#   - Root access
#   - Flow Kit project cloned
#   - Python 3.11+
#   - Node.js 18+
#
# Usage:
#   chmod +x vps-a-setup.sh
#   sudo ./vps-a-setup.sh --auth-token <TOKEN>
# =============================================================================

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────

AUTH_TOKEN=""
BACKEND_PORT=8100
WS_PORT=9222
FRONTEND_PORT=3000

# ─── Parse Arguments ─────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    --auth-token)
      AUTH_TOKEN="$2"
      shift 2
      ;;
    --backend-port)
      BACKEND_PORT="$2"
      shift 2
      ;;
    --ws-port)
      WS_PORT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "Usage: $0 --auth-token <TOKEN>"
  exit 1
fi

echo "=========================================="
echo "Flow Kit - VPS A Setup (Backend)"
echo "=========================================="
echo "Backend Port: $BACKEND_PORT"
echo "WebSocket Port: $WS_PORT"
echo "Frontend Port: $FRONTEND_PORT"
echo ""

# ─── System Dependencies ─────────────────────────────────────

echo "[1/6] Installing system dependencies..."
apt-get update
apt-get install -y curl wget git ufw

# ─── Install Python 3.11+ ───────────────────────────────────

echo "[2/6] Installing Python 3.11..."
apt-get install -y python3.11 python3.11-venv python3-pip

# ─── Install Node.js 18+ ────────────────────────────────────

echo "[3/6] Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install Bun (for frontend)
curl -fsSL https://bun.sh/install | bash

# ─── Configure Firewall ──────────────────────────────────────

echo "[4/6] Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow 22/tcp

# Allow backend HTTP API
ufw allow ${BACKEND_PORT}/tcp

# Allow WebSocket server
ufw allow ${WS_PORT}/tcp

# Allow frontend (optional, for external access)
ufw allow ${FRONTEND_PORT}/tcp

ufw --force enable

echo "Firewall configured:"
echo "  - SSH: 22/tcp"
echo "  - Backend HTTP: ${BACKEND_PORT}/tcp"
echo "  - WebSocket: ${WS_PORT}/tcp"
echo "  - Frontend: ${FRONTEND_PORT}/tcp"

# ─── Generate Auth Token ─────────────────────────────────────

echo "[5/6] Generating auth token..."

# Save auth token to file
mkdir -p /opt/flowkit
echo "$AUTH_TOKEN" > /opt/flowkit/auth-token
chmod 600 /opt/flowkit/auth-token

echo "Auth token saved to: /opt/flowkit/auth-token"

# ─── Create Backend Config ───────────────────────────────────

echo "[6/6] Creating backend configuration..."

cat > /opt/flowkit/config.json << EOF
{
  "backend": {
    "host": "0.0.0.0",
    "port": ${BACKEND_PORT},
    "ws_port": ${WS_PORT},
    "auth_token": "${AUTH_TOKEN}"
  },
  "frontend": {
    "port": ${FRONTEND_PORT},
    "api_url": "http://0.0.0.0:${BACKEND_PORT}"
  },
  "chrome": {
    "mode": "pinchtab",
    "pinchtabs_url": "http://<VPS_B_IP>:9867",
    "pinchtabs_token": "${AUTH_TOKEN}"
  }
}
EOF

echo "Config written to: /opt/flowkit/config.json"
echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Edit /opt/flowkit/config.json - set pinchtabs_url to VPS B IP"
echo "  2. Start backend: cd <flowkit-path> && python -m agent.main"
echo "  3. Start frontend: cd <flowkit-path>/frontend && npm run dev"
echo ""
echo "Firewall ports open:"
echo "  - ${BACKEND_PORT}/tcp (Backend HTTP API)"
echo "  - ${WS_PORT}/tcp (WebSocket server for Chrome extensions)"
echo "  - ${FRONTEND_PORT}/tcp (Frontend UI)"
echo ""
