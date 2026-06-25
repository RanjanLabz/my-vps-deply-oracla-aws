#!/bin/bash
set -euxo pipefail

# Update system
apt-get update -y
apt-get upgrade -y

# Install dependencies
apt-get install -y curl wget git unzip xvfb iptables-persistent

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Python
apt-get install -y python3 python3-pip python3-venv

# Install Chromium
apt-get install -y chromium-browser

# Open firewall ports
iptables -I INPUT 4 -p tcp --dport 8100 -j ACCEPT
iptables -I INPUT 5 -p tcp --dport 9222 -j ACCEPT
iptables -I INPUT 6 -p tcp --dport 3000 -j ACCEPT
netfilter-persistent save

# Create flowkit user
useradd -m -s /bin/bash flowkit || true

# Clone and setup Flow Kit
su - flowkit -c '
  cd ~
  git clone https://github.com/RanjanLabz/my-vps-deply-oracla-aws.git flowkit || true
  cd flowkit
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt 2>/dev/null || true

  # Create .env
  cat > .env << EOF
API_HOST=0.0.0.0
API_PORT=8100
WS_HOST=0.0.0.0
WS_PORT=9222
CHROME_MANAGER_MAX_PROFILES=3
MAX_CONCURRENT_REQUESTS=5
EOF

  # Build frontend
  cd frontend
  npm install
  PUBLIC_IP=$(curl -s http://checkip.amazonaws.com)
  NEXT_PUBLIC_API_URL=http://$PUBLIC_IP:8100 npm run build
  cd ..
'

# Setup Xvfb display
cat > /etc/systemd/system/xvfb.service << 'EOF'
[Unit]
Description=X Virtual Frame Buffer Service
After=network.target

[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Setup Flow Kit backend service
cat > /etc/systemd/system/flowkit-backend.service << 'EOF'
[Unit]
Description=Flow Kit Backend
After=network.target xvfb.service
Requires=xvfb.service

[Service]
Type=simple
User=flowkit
WorkingDirectory=/home/flowkit/flowkit
Environment=DISPLAY=:99
EnvironmentFile=/home/flowkit/flowkit/.env
ExecStart=/home/flowkit/flowkit/venv/bin/python -m agent.main
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Setup Flow Kit frontend service
cat > /etc/systemd/system/flowkit-ui.service << 'EOF'
[Unit]
Description=Flow Kit Frontend
After=network.target

[Service]
Type=simple
User=flowkit
WorkingDirectory=/home/flowkit/flowkit/frontend
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=/home/flowkit/flowkit/frontend/node_modules/.bin/next start -p 3000 -H 0.0.0.0
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable xvfb
systemctl enable flowkit-backend
systemctl enable flowkit-ui
systemctl start xvfb
systemctl start flowkit-backend
systemctl start flowkit-ui

echo "Flow Kit deployment complete!"
echo "Backend: http://$PUBLIC_IP:8100"
echo "Frontend: http://$PUBLIC_IP:3000"
echo "WebSocket: ws://$PUBLIC_IP:9222"
