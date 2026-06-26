"""Chrome Manager API — manages Chrome instances for Flow Kit.

Runs in a Docker container with Chrome + Xvfb.
Launches Chrome instances with unique CDP ports and returns connection info.
"""
import asyncio
import json
import logging
import os
import signal
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("chrome-manager")

app = FastAPI(title="Chrome Manager API")

# ─── Configuration ───────────────────────────────────────────
CHROME_BINARY = os.environ.get("CHROME_BINARY", "/usr/bin/chromium")
EXTENSION_DIR = os.environ.get("EXTENSION_DIR", "/app/extension")
BACKEND_WS_URL = os.environ.get("BACKEND_WS_URL", "ws://flowkit-backend:9222")
BACKEND_HTTP_URL = os.environ.get("BACKEND_HTTP_URL", "http://flowkit-backend:8100")
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "")
CDP_PORT_START = int(os.environ.get("CDP_PORT_START", "9223"))
MAX_INSTANCES = int(os.environ.get("MAX_INSTANCES", "3"))
DISPLAY = os.environ.get("DISPLAY", ":99")
CHROME_FLAGS = os.environ.get("CHROME_FLAGS", "").split(",") if os.environ.get("CHROME_FLAGS") else []

# ─── State ───────────────────────────────────────────────────
@dataclass
class ChromeInstance:
    session_id: str
    pid: int
    cdp_port: int
    profile_dir: str
    status: str = "STARTING"
    launched_at: float = field(default_factory=time.time)
    account_id: str = ""
    site: str = ""

_instances: dict[str, ChromeInstance] = {}
_port_allocator: int = CDP_PORT_START

# ─── Models ──────────────────────────────────────────────────
class LaunchRequest(BaseModel):
    account_id: str = ""
    site: str = "labs.google"
    profile_name: str = ""

class ConfigResponse(BaseModel):
    ws_url: str
    http_callback_url: str
    auth_token: str

# ─── Endpoints ───────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "instances": len(_instances), "chrome_binary": CHROME_BINARY}

@app.get("/config", response_model=ConfigResponse)
async def get_config():
    """Return extension config — extension fetches this on startup."""
    return ConfigResponse(
        ws_url=BACKEND_WS_URL,
        http_callback_url=f"{BACKEND_HTTP_URL}/api/ext/callback",
        auth_token=AUTH_TOKEN,
    )

@app.get("/chrome")
async def list_instances():
    return {
        "instances": [
            {
                "session_id": inst.session_id,
                "pid": inst.pid,
                "cdp_port": inst.cdp_port,
                "status": inst.status,
                "account_id": inst.account_id,
                "site": inst.site,
                "uptime": int(time.time() - inst.launched_at),
            }
            for inst in _instances.values()
        ]
    }

@app.post("/chrome/launch")
async def launch_chrome(req: LaunchRequest):
    global _port_allocator

    if len(_instances) >= MAX_INSTANCES:
        raise HTTPException(429, f"Max Chrome instances reached ({len(_instances)}/{MAX_INSTANCES})")

    # Allocate CDP port
    cdp_port = _port_allocator
    _port_allocator += 1
    if _port_allocator >= CDP_PORT_START + MAX_INSTANCES + 10:
        _port_allocator = CDP_PORT_START

    session_id = f"profile_{req.account_id}_{int(time.time())}" if req.account_id else f"profile_{int(time.time())}"
    profile_dir = f"/tmp/chrome_profiles/{session_id}"

    os.makedirs(profile_dir, exist_ok=True)

    ext_path = EXTENSION_DIR
    args = [
        CHROME_BINARY,
        f"--user-data-dir={profile_dir}",
        f"--load-extension={ext_path}",
        f"--disable-extensions-except={ext_path}",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,720",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        f"--remote-debugging-port={cdp_port}",
        "--remote-allow-origins=*",
    ]
    args.extend([f for f in CHROME_FLAGS if f])

    env = os.environ.copy()
    env["DISPLAY"] = DISPLAY

    logger.info("Launching Chrome: session=%s cdp_port=%d", session_id[:8], cdp_port)

    proc = None
    error = None
    def _launch():
        nonlocal proc, error
        try:
            proc = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            error = e

    import threading
    t = threading.Thread(target=_launch, daemon=True)
    t.start()
    t.join(timeout=15)

    if error:
        raise HTTPException(500, f"Failed to launch Chrome: {error}")
    if proc is None:
        raise HTTPException(500, "Chrome launch timed out after 15s")

    inst = ChromeInstance(
        session_id=session_id,
        pid=proc.pid,
        cdp_port=cdp_port,
        profile_dir=profile_dir,
        status="STARTING",
        account_id=req.account_id,
        site=req.site,
    )
    _instances[session_id] = inst

    # Wait for CDP to become available
    for i in range(30):
        try:
            import urllib.request
            data = await asyncio.to_thread(
                lambda: urllib.request.urlopen(f"http://127.0.0.1:{cdp_port}/json/version", timeout=2).read()
            )
            info = json.loads(data)
            inst.status = "RUNNING"
            logger.info("Chrome ready: session=%s pid=%d cdp_port=%d browser=%s",
                        session_id[:8], proc.pid, cdp_port, info.get("Browser", "unknown"))
            return {
                "session_id": session_id,
                "pid": proc.pid,
                "cdp_port": cdp_port,
                "profile_dir": profile_dir,
                "status": "RUNNING",
                "browser": info.get("Browser", "unknown"),
            }
        except Exception:
            pass
        await asyncio.sleep(0.5)

    inst.status = "RUNNING"
    return {
        "session_id": session_id,
        "pid": proc.pid,
        "cdp_port": cdp_port,
        "profile_dir": profile_dir,
        "status": "RUNNING",
    }

@app.post("/chrome/{session_id}/stop")
async def stop_chrome(session_id: str):
    inst = _instances.get(session_id)
    if not inst:
        raise HTTPException(404, f"Instance {session_id} not found")

    try:
        os.kill(inst.pid, signal.SIGTERM)
        await asyncio.sleep(2)
        try:
            os.kill(inst.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    except ProcessLookupError:
        pass

    inst.status = "STOPPED"
    del _instances[session_id]
    logger.info("Chrome stopped: session=%s", session_id[:8])
    return {"status": "stopped", "session_id": session_id}

@app.post("/chrome/restart-all")
async def restart_all():
    results = []
    for session_id in list(_instances.keys()):
        try:
            await stop_chrome(session_id)
            results.append({"session_id": session_id, "status": "restarted"})
        except Exception as e:
            results.append({"session_id": session_id, "error": str(e)})
    return {"results": results}

# ─── Cleanup on shutdown ─────────────────────────────────────
@app.on_event("shutdown")
async def shutdown():
    for inst in list(_instances.values()):
        try:
            os.kill(inst.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    _instances.clear()
