# Flow Kit — Split VPS Setup with PinchTab

Deploy Flow Kit across two VPS servers: backend on VPS A, Chrome browser on VPS B.

## Architecture

```
VPS A (Backend + Frontend)              VPS B (PinchTab + Chrome)
+-------------------------+            +-------------------------+
| Python Backend :8100    |            | PinchTab Server :9867   |
| WebSocket Server :9222  | <--- WS -- |   Chrome Instance 1     |
| Next.js Frontend :3000  |            |     + Extension         |
+-------------------------+            |   Chrome Instance 2     |
                                       |     + Extension         |
                                       +-------------------------+
```

## Quick Start

### Step 1: Generate Auth Token

```bash
openssl rand -hex 32
```

Save this token — you'll need it for both VPS.

### Step 2: Setup VPS A (Backend)

```bash
# Upload setup script
scp pinchtab-setup/vps-a-setup.sh root@VPS_A_IP:/tmp/

# SSH into VPS A
ssh root@VPS_A_IP

# Run setup
chmod +x /tmp/vps-a-setup.sh
sudo /tmp/vps-a-setup.sh --auth-token <YOUR_TOKEN>

# Edit config to point to VPS B
nano /opt/flowkit/config.json
# Set pinchtabs_url to http://VPS_B_IP:9867

# Start backend
cd /path/to/final-production
python -m agent.main

# Start frontend (in another terminal)
.\scripts\start-frontend.ps1
```

### Step 3: Setup VPS B (PinchTab)

```bash
# Upload setup script
scp pinchtab-setup/vps-b-setup.sh root@VPS_B_IP:/tmp/

# SSH into VPS B
ssh root@VPS_B_IP

# Run setup
chmod +x /tmp/vps-b-setup.sh
sudo /tmp/vps-b-setup.sh --vps-a-ip VPS_A_IP --auth-token <YOUR_TOKEN>

# Upload extension
cd /path/to/final-production
zip -r extension.zip extension/
curl -X POST http://VPS_B_IP:8080/extension/upload \
  -F "name=flowkit" \
  -F "extension=@extension.zip"

# Start Chrome instance
curl -X POST http://VPS_B_IP:8080/instance/start \
  -F "profile_name=account1" \
  -F "extensions=flowkit"
```

## Endpoints

### Extension Manager API (VPS B — port 8080)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /extension/upload` | POST | Upload new extension (zip) |
| `GET /extension` | GET | List installed extensions |
| `GET /extension/{name}` | GET | Get extension details |
| `PUT /extension/{name}` | PUT | Update extension |
| `DELETE /extension/{name}` | DELETE | Remove extension |
| `POST /instance/start` | POST | Start Chrome instance |
| `POST /instance/{id}/stop` | POST | Stop Chrome instance |
| `POST /instance/{id}/restart` | POST | Restart Chrome instance |
| `POST /instance/restart-all` | POST | Restart all instances |
| `GET /instance` | GET | List running instances |
| `GET /health` | GET | Health check |
| `GET /config` | GET | Get config |

### Backend API (VPS A — port 8100)

Same as single-VPS mode.

### WebSocket (VPS A — port 9222)

Chrome extensions connect here from VPS B.

## Updating Extension

```bash
# From local machine
zip -r extension-updated.zip extension/

# Upload to VPS B
curl -X PUT http://VPS_B_IP:8080/extension/flowkit \
  -F "extension=@extension-updated.zip"

# Instances auto-restart with new extension
```

## Extension Configuration

The extension reads config from `chrome.storage.local`:

| Key | Default | Purpose |
|-----|---------|---------|
| `config_ws_url` | `ws://127.0.0.1:9222` | WebSocket server URL |
| `config_http_callback_url` | `http://127.0.0.1:8100/api/ext/callback` | HTTP callback URL |
| `config_auth_token` | `null` | Auth token for WS handshake |

For split-VPS, set these via Chrome DevTools or PinchTab profile config.

## Firewall Ports

### VPS A
- `8100/tcp` — Backend HTTP API
- `9222/tcp` — WebSocket server (for Chrome extensions)
- `3000/tcp` — Frontend UI

### VPS B
- `9867/tcp` — PinchTab API
- `8080/tcp` — Extension Manager API

## Troubleshooting

### Extension not connecting to VPS A

1. Check firewall allows port 9222 from VPS B
2. Verify `config_ws_url` in extension storage
3. Check backend logs for connection attempts

### PinchTab not starting Chrome

1. Check Chrome binary exists: `ls /opt/chrome-for-testing/chrome`
2. Check PinchTab config: `pinchtab config show`
3. Check logs: `journalctl -u pinchtab -f`

### Bun segfault on Windows

This is an opencode internal issue, not your code. Safe to ignore.
