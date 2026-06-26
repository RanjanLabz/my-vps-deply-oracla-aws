"""FastAPI router for server settings and browser configuration."""
import asyncio
import json
import logging
import os
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent.config import BASE_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])

ENV_FILE = BASE_DIR / ".env"


def _read_env() -> dict[str, str]:
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def _write_env(updates: dict[str, str]) -> None:
    env = _read_env()
    env.update(updates)
    lines = [f'{k}="{v}"' for k, v in env.items()]
    ENV_FILE.write_text("\n".join(lines) + "\n")


SETTINGS_FIELDS = {
    "CHROME_BINARY": {"label": "Chrome Binary Path", "type": "string", "group": "chrome"},
    "CHROME_MANAGER_MAX_PROFILES": {"label": "Max Chrome Profiles", "type": "int", "group": "chrome", "min": 1, "max": 20},
    "CHROME_IDLE_TIMEOUT": {"label": "Chrome Idle Timeout (s)", "type": "int", "group": "chrome", "min": 60, "max": 3600},
    "CHROME_MANAGER_ACCOUNT_LOCK_TTL": {"label": "Account Lock TTL (s)", "type": "int", "group": "chrome", "min": 30, "max": 3600},
    "MAX_CONCURRENT_REQUESTS": {"label": "Max Concurrent Requests", "type": "int", "group": "worker", "min": 1, "max": 20},
    "API_COOLDOWN": {"label": "API Cooldown (s)", "type": "int", "group": "worker", "min": 1, "max": 60},
    "POLL_INTERVAL": {"label": "Worker Poll Interval (s)", "type": "int", "group": "worker", "min": 1, "max": 30},
    "MAX_RETRIES": {"label": "Max Retries", "type": "int", "group": "worker", "min": 1, "max": 20},
    "STALE_PROCESSING_TIMEOUT": {"label": "Stale Processing Timeout (s)", "type": "int", "group": "worker", "min": 60, "max": 3600},
    "WS_HOST": {"label": "WebSocket Host", "type": "string", "group": "network"},
    "WS_PORT": {"label": "WebSocket Port", "type": "int", "group": "network", "min": 1024, "max": 65535},
    "API_HOST": {"label": "API Host", "type": "string", "group": "network"},
    "API_PORT": {"label": "API Port", "type": "int", "group": "network", "min": 1024, "max": 65535},
    "REDIS_URL": {"label": "Redis URL", "type": "string", "group": "storage"},
    "R2_BUCKET_NAME": {"label": "R2 Bucket", "type": "string", "group": "storage"},
    "R2_PUBLIC_URL": {"label": "R2 Public URL", "type": "string", "group": "storage"},
}


class SettingsUpdate(BaseModel):
    key: str
    value: str


@router.get("")
async def get_settings():
    env = _read_env()
    from agent import config
    result = {}
    for key, meta in SETTINGS_FIELDS.items():
        current = env.get(key, "")
        if not current:
            current = str(getattr(config, key, ""))
        result[key] = {**meta, "value": current}
    return result


@router.patch("")
async def update_settings(updates: list[SettingsUpdate]):
    env_updates = {}
    for u in updates:
        if u.key not in SETTINGS_FIELDS:
            raise HTTPException(400, f"Unknown setting: {u.key}")
        meta = SETTINGS_FIELDS[u.key]
        if meta["type"] == "int":
            try:
                val = int(u.value)
            except ValueError:
                raise HTTPException(400, f"{u.key} must be an integer")
            if "min" in meta and val < meta["min"]:
                raise HTTPException(400, f"{u.key} must be >= {meta['min']}")
            if "max" in meta and val > meta["max"]:
                raise HTTPException(400, f"{u.key} must be <= {meta['max']}")
            u.value = str(val)
        env_updates[u.key] = u.value
    _write_env(env_updates)
    logger.info("Settings updated: %s", list(env_updates.keys()))
    return {"ok": True, "updated": list(env_updates.keys()), "restart_required": True}


@router.get("/profiles")
async def list_profiles():
    from agent.services.cdp_client import get_cdp_client, CHROME_IDLE_TIMEOUT
    from agent.db.schema import get_db
    import urllib.request as _urllib
    cdp = get_cdp_client()
    db = await get_db()

    # Get account info
    cur = await db.execute("SELECT id, name, in_use, max_count, models FROM account")
    accounts = {r["id"]: dict(r) for r in await cur.fetchall()}

    # Get chrome_profile records for orphan matching
    cur = await db.execute(
        "SELECT id, account_id, profile_dir, pid, site, status FROM chrome_profile WHERE status='ACTIVE'"
    )
    db_profiles = {r["profile_dir"]: dict(r) for r in await cur.fetchall()}

    # Get processing/pending requests
    cur = await db.execute(
        "SELECT id, type, status, progress_pct, progress_stage, payload_json "
        "FROM request WHERE status IN ('PROCESSING', 'PENDING') ORDER BY created_at DESC"
    )
    processing = [dict(r) for r in await cur.fetchall()]

    now = time.time()
    tracked_pids = set()

    def _match_busy(account_id):
        account = accounts.get(account_id, {})
        account_models = account.get("models", "[]")
        if isinstance(account_models, str):
            try:
                account_models = json.loads(account_models)
            except Exception:
                account_models = []
        for req in processing:
            # Extract model from payload_json
            payload = req.get("payload_json", "{}")
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except Exception:
                    payload = {}
            req_model = payload.get("model", payload.get("model_name", ""))
            if req_model and req_model in account_models:
                return {
                    "id": req["id"][:12],
                    "type": req["type"],
                    "progress_pct": req.get("progress_pct", 0),
                    "progress_stage": req.get("progress_stage", ""),
                }
        return None

    profiles = []

    # 1. Tracked sessions from CDPClient
    for sid, session in cdp._sessions.items():
        uptime = int(now - session.created_at) if session.created_at else 0
        account = accounts.get(session.account_id, {})
        in_use = account.get("in_use", 0)
        max_count = account.get("max_count", 1)
        account_name = account.get("name", session.account_id[:12] if session.account_id else "?")
        busy_request = _match_busy(session.account_id)
        is_busy = in_use > 0 or busy_request is not None

        # Auto-close countdown
        last_active = session.token_captured_at or session.created_at or now
        idle_elapsed = now - last_active
        auto_close_in = max(0, int(CHROME_IDLE_TIMEOUT - idle_elapsed))

        if session.pid:
            tracked_pids.add(session.pid)

        profiles.append({
            "session_id": sid,
            "account_id": session.account_id[:12] if session.account_id else "?",
            "account_name": account_name,
            "site": session.site,
            "pid": session.pid,
            "status": session.status,
            "has_token": session.bearer_token is not None,
            "uptime_s": uptime,
            "created_at": session.created_at,
            "is_busy": is_busy,
            "in_use": in_use,
            "max_count": max_count,
            "busy_request": busy_request,
            "profile_dir": session.profile_dir,
            "is_orphaned": False,
            "auto_close_in": auto_close_in,
        })

    # 2. Detect orphaned Chrome for Testing processes on port 9223
    killed_orphans = []
    try:
        import psutil
        for proc in psutil.process_iter(["pid", "name", "cmdline", "create_time"]):
            if proc.info["name"] != "chrome.exe":
                continue
            cmdline = proc.info.get("cmdline") or []
            cmdline_str = " ".join(cmdline)
            if "--remote-debugging-port=9223" not in cmdline_str:
                continue
            if "--type=" in cmdline_str:
                continue
            pid = proc.info["pid"]
            if pid in tracked_pids:
                continue

            create_time = proc.info.get("create_time", now)
            uptime = int(now - create_time)

            profile_dir = ""
            for arg in cmdline:
                if arg.startswith("--user-data-dir="):
                    profile_dir = arg.split("=", 1)[1]
                    break

            db_profile = db_profiles.get(profile_dir, {})
            account_id = db_profile.get("account_id", "unknown")
            account = accounts.get(account_id, {})
            account_name = account.get("name", account_id[:12] if account_id else "?")
            in_use = account.get("in_use", 0)
            max_count = account.get("max_count", 1)
            busy_request = _match_busy(account_id)
            is_busy = in_use > 0 or busy_request is not None

            # Adopt orphan if process is alive — don't kill it
            if pid not in tracked_pids:
                # Try to adopt into CDPClient so it can be reused
                try:
                    from agent.services.cdp_client import get_cdp_client as _get_cdp, CDPSession as _CS
                    _cdp = _get_cdp()
                    if not any(s.pid == pid for s in _cdp._sessions.values()):
                        _session_id = f"adopted_{pid}"
                        _sess = _CS(
                            session_id=_session_id,
                            account_id=account_id or "default",
                            site=db_profile.get("site", "labs.google"),
                            profile_dir=profile_dir,
                        )
                        _sess.pid = pid
                        _sess.status = "RUNNING"
                        _cdp._sessions[_session_id] = _sess
                        _cdp._start_idle_timer(_session_id)
                        tracked_pids.add(pid)
                        logger.info("Adopted orphaned Chrome PID %d for account %s", pid, (account_id or "default")[:8])
                except Exception as e:
                    logger.debug("Failed to adopt orphan PID %d: %s", pid, e)

            # Calculate auto-close countdown for orphans too
            orphan_auto_close = max(0, CHROME_IDLE_TIMEOUT - uptime) if not is_busy else 0

            profiles.append({
                "session_id": f"orphan_{pid}",
                "account_id": account_id[:12] if account_id else "?",
                "account_name": account_name,
                "site": db_profile.get("site", "unknown"),
                "pid": pid,
                "status": "ORPHANED",
                "has_token": False,
                "uptime_s": uptime,
                "created_at": create_time,
                "is_busy": is_busy,
                "in_use": in_use,
                "max_count": max_count,
                "busy_request": busy_request,
                "profile_dir": profile_dir,
                "is_orphaned": True,
                "auto_close_in": orphan_auto_close,
            })
    except ImportError:
        pass

    # 3. Query Chrome Manager for instances not tracked by CDPClient
    try:
        from agent.config import CHROME_MANAGER_URL
        import httpx
        async with httpx.AsyncClient(timeout=5) as hc:
            resp = await hc.get(f"{CHROME_MANAGER_URL}/chrome")
            if resp.status_code == 200:
                cm_instances = resp.json().get("instances", [])
                for ci in cm_instances:
                    cm_sid = ci.get("session_id", "")
                    cm_pid = ci.get("pid", 0)
                    if cm_pid in tracked_pids:
                        continue
                    cm_acct = ci.get("account_id", "default")
                    cm_account = accounts.get(cm_acct, {})
                    cm_name = cm_account.get("name", cm_acct[:12] if cm_acct else "?")
                    cm_in_use = cm_account.get("in_use", 0)
                    cm_max = cm_account.get("max_count", 1)
                    cm_busy = _match_busy(cm_acct)
                    profiles.append({
                        "session_id": cm_sid,
                        "account_id": cm_acct[:12] if cm_acct else "?",
                        "account_name": cm_name,
                        "site": ci.get("site", "labs.google"),
                        "pid": cm_pid,
                        "status": ci.get("status", "UNKNOWN"),
                        "has_token": False,
                        "uptime_s": ci.get("uptime", 0),
                        "created_at": now - ci.get("uptime", 0),
                        "is_busy": cm_in_use > 0 or cm_busy is not None,
                        "in_use": cm_in_use,
                        "max_count": cm_max,
                        "busy_request": cm_busy,
                        "profile_dir": "",
                        "is_orphaned": False,
                        "auto_close_in": 0,
                    })
    except Exception:
        pass

    return {
        "active_sessions": profiles,
        "active_count": len([p for p in profiles if not p["is_orphaned"]]),
        "orphaned_count": len([p for p in profiles if p["is_orphaned"]]),
        "max_profiles": cdp._sessions.maxlen if hasattr(cdp._sessions, 'maxlen') else "unlimited",
    }


@router.post("/profiles/orphan/{pid}/kill")
async def kill_orphan(pid: int):
    """Kill an orphaned Chrome process not tracked by CDPClient."""
    import psutil
    from agent.db.schema import get_db

    try:
        proc = psutil.Process(pid)
        cmdline = proc.cmdline()
        cmdline_str = " ".join(cmdline)

        if "--remote-debugging-port=9223" not in cmdline_str:
            raise HTTPException(400, f"PID {pid} is not a Chrome for Testing instance")

        # Extract profile dir to update DB
        profile_dir = ""
        for arg in cmdline:
            if arg.startswith("--user-data-dir="):
                profile_dir = arg.split("=", 1)[1]
                break

        proc.kill()

        # Update chrome_profile DB
        if profile_dir:
            db = await get_db()
            await db.execute(
                "UPDATE chrome_profile SET status='CLOSED', closed_at=datetime('now') WHERE profile_dir=?",
                (profile_dir,)
            )
            await db.commit()

        return {"ok": True, "killed": pid}
    except psutil.NoSuchProcess:
        raise HTTPException(404, f"PID {pid} not found")
    except psutil.AccessDenied:
        raise HTTPException(403, f"Access denied to PID {pid}")


@router.post("/profiles/{session_id}/kill")
async def kill_profile(session_id: str):
    from agent.services.cdp_client import get_cdp_client
    cdp = get_cdp_client()

    session = cdp._sessions.get(session_id)
    if not session:
        raise HTTPException(404, f"Session '{session_id}' not found")

    try:
        if session.driver:
            session.driver.close()
        if session.pid:
            import psutil
            try:
                proc = psutil.Process(session.pid)
                proc.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        cdp._sessions.pop(session_id, None)
        return {"ok": True, "killed": session_id}
    except Exception as e:
        raise HTTPException(500, f"Failed to kill: {e}")


@router.post("/profiles/kill-all")
async def kill_all_profiles():
    from agent.services.cdp_client import get_cdp_client
    cdp = get_cdp_client()

    killed = []
    for sid in list(cdp._sessions.keys()):
        session = cdp._sessions.get(sid)
        if session:
            try:
                if session.driver:
                    session.driver.close()
                if session.pid:
                    import psutil
                    try:
                        proc = psutil.Process(session.pid)
                        proc.kill()
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                killed.append(sid)
            except Exception:
                pass
    cdp._sessions.clear()
    return {"ok": True, "killed": killed, "count": len(killed)}


@router.get("/extension")
async def get_extension_status():
    from agent.services.flow_client import get_flow_client
    client = get_flow_client()

    return {
        "connected": client.connected,
        "flow_key_present": bool(client._flow_key),
        "flow_key": client._flow_key[:20] + "..." if client._flow_key else None,
        "token_captured_at": getattr(client, "_token_captured_at", None),
        "tier": getattr(client, "_tier", None),
    }


@router.post("/extension/reconnect")
async def reconnect_extension():
    from agent.services.cdp_client import get_cdp_client
    cdp = get_cdp_client()
    asyncio.create_task(cdp.ensure_chrome("default", "labs.google"))
    return {"ok": True, "message": "Chrome re-launch initiated"}


@router.post("/actions/recover-accounts")
async def recover_accounts():
    from agent.api.accounts import recover_stuck_in_use
    recovered = await recover_stuck_in_use()
    return {"ok": True, "recovered": recovered}


@router.post("/actions/reset-stale")
async def reset_stale_requests():
    from agent.db import crud
    reset = await crud.reset_stale_processing()
    return {"ok": True, "reset": reset}
