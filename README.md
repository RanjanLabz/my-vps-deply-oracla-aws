# Flow Kit - Production

AI video production platform that automates Google Flow (labs.google) for image and video generation via Chrome extension bridge.

## Architecture

```
+------------------+    WebSocket    +------------------+    HTTPS    +--------------+
|  Python Agent    | <------------> | Chrome Extension | ---------> | Google Flow  |
|  (FastAPI :8100) |                |  (Manifest V3)   |            |  API         |
|  WS Server :9222 |                +------------------+            +--------------+
+------------------+
        |
        | HTTP
        v
+------------------+
|  Next.js UI      |
|  (localhost:3000)|
+------------------+
```

## Prerequisites

Before you start, make sure you have:

| Requirement | Version | Check |
|-------------|---------|-------|
| **Python** | 3.10+ | `python --version` |
| **Node.js** | 18+ | `node --version` |
| **Google Account** | Any | For accessing labs.google |

That's it. The setup script handles everything else (Chrome, dependencies, etc).

## Quick Start (3 Steps)

### Step 1: Run Setup

```powershell
# Clone the repo
git clone <repo-url>
cd final-production

# Run setup (installs Python deps + Chrome for Testing)
.\scripts\setup.ps1
```

This will:
- Create a Python virtual environment
- Install all Python dependencies
- Download Chrome for Testing v150 automatically (~150MB)

### Step 2: Start the Servers

Open **two terminals**:

```powershell
# Terminal 1 - Backend
.\scripts\start-agent.ps1
```

```powershell
# Terminal 2 - Frontend
.\scripts\start-frontend.ps1
```

### Step 3: Open the UI

Go to **http://localhost:3000** in your browser.

That's it. The backend runs on `http://127.0.0.1:8100` and the frontend on `http://localhost:3000`.

## Setting Up Google Accounts

This is the **most important step**. You need valid Google session cookies to generate images/videos.

### How to Get Cookies

1. Open **Google Chrome** (your regular browser)
2. Go to **https://labs.google/fx/tools/flow**
3. Sign in with your Google account
4. Open **DevTools** (F12 or Ctrl+Shift+I)
5. Go to **Application** tab
6. Click **Cookies** in the left sidebar
7. Click on `https://labs.google`
8. You need to export these cookies as JSON

### Required Cookies

Copy these cookies into a JSON array format:

```json
[
  {
    "name": "__Secure-next-auth.session-token",
    "value": "YOUR_SESSION_TOKEN",
    "domain": "labs.google",
    "path": "/",
    "secure": true,
    "httpOnly": true,
    "sameSite": "lax"
  },
  {
    "name": "__Host-next-auth.csrf-token",
    "value": "YOUR_CSRF_TOKEN",
    "domain": "labs.google",
    "path": "/",
    "secure": true,
    "httpOnly": true,
    "sameSite": "lax"
  },
  {
    "name": "SSID",
    "value": "YOUR_SSID",
    "domain": ".google.com",
    "path": "/",
    "secure": true,
    "httpOnly": true,
    "sameSite": "none"
  }
]
```

### Create Account via UI

1. Go to **http://localhost:3000/accounts**
2. Click **"Add Account"**
3. Fill in:
   - **Name**: `My Google Account` (any display name)
   - **Site**: `labs.google`
   - **Cookies**: Paste the JSON array above
   - **Models**: `["NARWHAL", "GEM_PIX_2"]`
   - **Max Count**: `1`
4. Click **Save**

### Create Account via API

```bash
curl -X POST http://127.0.0.1:8100/api/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "site": "labs.google",
    "name": "My Account",
    "cookies": "[{\"name\":\"__Secure-next-auth.session-token\",\"value\":\"...\",\"domain\":\"labs.google\",\"path\":\"/\",\"secure\":true,\"httpOnly\":true,\"sameSite\":\"lax\"}]",
    "models": ["NARWHAL", "GEM_PIX_2"],
    "max_count": 1
  }'
```

## Image Models

| Short Name | API Name | Description |
|------------|----------|-------------|
| `NANO_BANANA_PRO` | `GEM_PIX_2` | High quality generation |
| `NANO_BANANA_2` | `NARWHAL` | Fast generation (default) |

Both names work in the accounts - the system matches them automatically.

## Creating Projects

### Via UI

1. Go to **http://localhost:3000/projects**
2. Click **"Create Project"**
3. Set a name and select a material (visual style)

### Via API

```bash
curl -X POST http://127.0.0.1:8100/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Project",
    "material": "realistic",
    "language": "en"
  }'
```

### Materials (Visual Styles)

Available: `realistic`, `3d_pixar`, `anime`, `ghibli`, `stop_motion`, `minecraft`, `oil_painting`, `watercolor`, `comic_book`, `cyberpunk`, `claymation`, `lego`, `retro_vhs`

## Generating Images

### Via UI

1. Go to **http://localhost:3000/generate/image**
2. Select a project
3. Enter a prompt
4. Click **Generate**

### Via API

```bash
# First create a scene
curl -X POST http://127.0.0.1:8100/api/scenes \
  -H "Content-Type: application/json" \
  -d '{
    "video_id": "YOUR_VIDEO_ID",
    "narrator_text": "A beautiful sunset over the mountains"
  }'

# Then generate the image
curl -X POST http://127.0.0.1:8100/api/flow/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "scene_id": "YOUR_SCENE_ID",
    "prompt": "A beautiful sunset over the mountains, golden hour lighting",
    "orientation": "VERTICAL"
  }'
```

## Configuration

All configuration is in `agent/config.py`. You can override any value via environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `API_HOST` | `127.0.0.1` | Backend host |
| `API_PORT` | `8100` | Backend port |
| `WS_HOST` | `127.0.0.1` | WebSocket host |
| `WS_PORT` | `9222` | WebSocket port |
| `CHROME_BINARY` | `chrome_for_testing/chrome-win64/chrome.exe` | Chrome path |
| `POLL_INTERVAL` | `5` | Queue check interval (seconds) |
| `MAX_RETRIES` | `5` | Max retries per request |
| `MAX_CONCURRENT_REQUESTS` | `5` | Max parallel requests |

Copy `.env.example` to `.env` and uncomment values to customize.

## Project Structure

```
final-production/
+-- agent/              # Python backend (FastAPI + WebSocket)
|   +-- api/            # Route handlers (15 routers)
|   +-- db/             # SQLite schema + async CRUD
|   +-- models/         # Pydantic request/response models
|   +-- sdk/            # Domain model layer + operations engine
|   +-- services/       # Chrome CDP, Flow API bridge, Redis queue, TTS, etc.
|   +-- utils/          # Slugify, path helpers
|   +-- worker/         # Background request processor
+-- extension/          # Chrome extension (Manifest V3)
+-- frontend/           # Next.js 16 UI (React 19 + Tailwind CSS 4)
+-- tests/              # Unit tests (pytest)
+-- scripts/            # Setup and start scripts
+-- requirements.txt    # Python dependencies
+-- .env.example        # Environment variable template
+-- README.md           # This file
```

## Troubleshooting

### "Chrome for Testing not found"

The setup script should download it automatically. If it fails:

1. Download manually from https://googlechromelabs.github.io/chrome-for-testing/
2. Choose **win64** platform, latest stable version
3. Extract the zip so `chrome_for_testing/chrome-win64/chrome.exe` exists

Or set the environment variable:
```powershell
$env:CHROME_BINARY = "C:\Path\To\chrome.exe"
```

### "No free account" / Requests stuck in PENDING

This means no account can handle the request. Check:

1. Account status is `ACTIVE` (not `LOCKED` or `DISABLED`)
2. Account models include `NARWHAL` or `GEM_PIX_2`
3. Account `in_use` < `max_count`
4. Cookies are valid (not expired)

### "Invalid authentication credentials"

Your Google session cookies have expired. You need to:

1. Go back to https://labs.google/fx/tools/flow
2. Sign in again
3. Extract fresh cookies
4. Update the account in the UI or via API

### Extension not connected

The Chrome extension auto-connects via WebSocket. If it's not connecting:

1. Check that port 9222 is not blocked
2. The extension loads automatically when Chrome for Testing launches
3. Check the extension popup for connection status

### "Bun segfault" / Frontend crashes on start

Next.js 16 uses Turbopack (powered by Bun) which crashes on Windows. This is already fixed - the `dev` script in `package.json` uses webpack mode. If you still see this:

1. Run `cd frontend && npm run dev -- -p 3000` (the default script now uses webpack)
2. Do NOT use `npx next dev` directly - it bypasses the webpack flag

### Frontend shows "Cannot connect to backend"

Make sure the backend is running on port 8100:
```powershell
curl http://127.0.0.1:8100/health
```

If the backend is running but frontend can't connect, check that `frontend/.env.local` has:
```
NEXT_PUBLIC_API_URL=http://127.0.0.1:8100
```

### Request fails with "captcha" errors

The Chrome extension solves reCAPTCHA automatically. If it fails:

1. Ensure a Google Flow tab is open in the Chrome profile
2. The extension uses the tab's `grecaptcha.enterprise` to solve challenges
3. Check the extension side panel for error details

## License

MIT

## Cloud Deployment (One-Click)

Flow Kit can be deployed to Oracle Cloud or AWS with one click via the **Deploy Portal**.

### Deploy Portal UI

The `deploy-portal/` folder contains a static website that guides users through deployment:

```bash
# Open deploy-portal/index.html in your browser
# Or host it on GitHub Pages
```

**Features:**
- Oracle Cloud: Enter tenancy/user OCID, API key, region, instance shape
- AWS: Enter access key, secret key, region, instance type
- Existing VPS: Enter IP + SSH key for manual install
- Real-time progress logs
- Auto-generated auth token + extension config

### Cloudflare Worker (Backend)

The `workers/` folder contains the serverless backend that handles deployment:

```bash
cd workers
npm install
npx wrangler dev          # Local development
npx wrangler deploy       # Deploy to Cloudflare Workers
```

**Setup:**
1. Create a Cloudflare account (free tier works)
2. Run `npx wrangler login`
3. Update `wrangler.toml` with your settings
4. Create a KV namespace: `npx wrangler kv namespace create DEPLOY_JOBS`
5. Deploy: `npx wrangler deploy`

### GitHub Pages Deployment

To host the deploy portal on GitHub Pages:

1. Push to GitHub
2. Go to Settings → Pages
3. Source: Deploy from branch → `main`, folder: `/deploy-portal`
4. Your portal URL: `https://<username>.github.io/final-production/deploy-portal/`

### Server-Side Setup Scripts

| Script | Target | Notes |
|--------|--------|-------|
| `oracle-cloud-setup.sh` | Oracle Cloud VM | Ubuntu 22.04/24.04, ARM/AMD |
| `aws-setup.sh` | AWS EC2 | Ubuntu 22.04/24.04, t3/t3a instances |

Both scripts install: Python 3.11, Node.js 18, Chrome for Testing, Xvfb, and create systemd services.



### Worker Configuration

After deploying the Worker, update `deploy-portal/config.js` with your Worker URL.

### Oracle Cloud Setup

See [terraform/oracle/README.md](terraform/oracle/README.md) for one-command deployment using Terraform.