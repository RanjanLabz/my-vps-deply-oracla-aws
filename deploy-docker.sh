#!/bin/bash
# =============================================================================
# Flow Kit — Docker Deployment Script
# =============================================================================
# Deploys Flow Kit using Docker Compose on a fresh VPS.
#
# Prerequisites:
#   - Ubuntu 22.04+ or Debian 12+
#   - Root access
#   - Docker + Docker Compose installed
#   - .env file configured
#
# Usage:
#   chmod +x deploy-docker.sh
#   sudo ./deploy-docker.sh
# =============================================================================

set -euo pipefail

echo "=========================================="
echo "Flow Kit — Docker Deployment"
echo "=========================================="

# ─── Check Docker ────────────────────────────────────────────

if ! command -v docker &> /dev/null; then
    echo "[1/5] Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "[1/5] Docker already installed: $(docker --version)"
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "ERROR: Docker Compose not found"
    exit 1
fi

# ─── Install Docker Compose plugin if needed ─────────────────

if ! docker compose version &> /dev/null; then
    echo "[2/5] Installing Docker Compose plugin..."
    mkdir -p ~/.docker/cli-plugins
    curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
        -o ~/.docker/cli-plugins/docker-compose
    chmod +x ~/.docker/cli-plugins/docker-compose
else
    echo "[2/5] Docker Compose plugin already installed"
fi

# ─── Check .env file ────────────────────────────────────────

if [ ! -f .env ]; then
    echo ""
    echo "ERROR: .env file not found!"
    echo ""
    echo "Create one from the template:"
    echo "  cp .env.docker .env"
    echo "  nano .env"
    echo ""
    echo "Required variables:"
    echo "  REDIS_URL          — Upstash Redis URL"
    echo "  R2_ACCOUNT_ID      — Cloudflare R2 account ID"
    echo "  R2_ACCESS_KEY_ID   — Cloudflare R2 access key"
    echo "  R2_SECRET_ACCESS_KEY — Cloudflare R2 secret key"
    echo "  R2_BUCKET_NAME     — R2 bucket name"
    echo "  R2_ENDPOINT_URL    — R2 endpoint URL"
    echo "  R2_PUBLIC_URL      — R2 public URL"
    exit 1
fi

echo "[3/5] .env file found"

# ─── Configure Firewall ──────────────────────────────────────

echo "[4/5] Configuring firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp
    ufw allow 8100/tcp   # Backend API
    ufw allow 9222/tcp   # WebSocket
    ufw allow 3000/tcp   # Frontend
    ufw allow 8200/tcp   # Chrome Manager (internal, optional)
    ufw --force enable
    echo "Firewall configured"
else
    echo "ufw not found, skipping firewall setup"
fi

# ─── Build and Start ────────────────────────────────────────

echo "[5/5] Building and starting containers..."

# Detect docker compose command
if docker compose version &> /dev/null; then
    COMPOSE="docker compose"
else
    COMPOSE="docker-compose"
fi

$COMPOSE down --remove-orphans 2>/dev/null || true
$COMPOSE build --parallel
$COMPOSE up -d

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Services:"
echo "  - Backend API:  http://$(hostname -I | awk '{print $1}'):8100"
echo "  - Frontend:     http://$(hostname -I | awk '{print $1}'):3000"
echo "  - WebSocket:    ws://$(hostname -I | awk '{print $1}'):9222"
echo "  - Chrome Mgr:   http://$(hostname -I | awk '{print $1}'):8200"
echo ""
echo "Check status:"
echo "  $COMPOSE ps"
echo "  $COMPOSE logs -f"
echo ""
echo "View logs:"
echo "  $COMPOSE logs -f flowkit-backend"
echo "  $COMPOSE logs -f flowkit-chrome"
echo "  $COMPOSE logs -f flowkit-ui"
echo ""
