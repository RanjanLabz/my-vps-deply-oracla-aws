from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from agent.models.request import Request, RequestCreate
from agent.models.enums import StatusType
from agent.db import crud

router = APIRouter(prefix="/requests", tags=["requests"])


def _check_extension_token(account_id: str) -> bool:
    """Check if the extension has a valid flow key for this account."""
    try:
        from agent.services.flow_client import get_flow_client
        fc = get_flow_client()
        stored_key = fc.get_account_flow_key(account_id)
        if stored_key:
            ws = fc.get_ws_for_flow_key(stored_key)
            if ws and ws in fc._extension_ws_set:
                return True
    except Exception:
        pass
    return False


class RequestUpdate(BaseModel):
    status: Optional[StatusType] = None
    media_id: Optional[str] = None
    output_url: Optional[str] = None
    error_message: Optional[str] = None
    request_id: Optional[str] = None


class BatchRequestCreate(BaseModel):
    requests: list[RequestCreate]


class BatchStatus(BaseModel):
    total: int
    pending: int
    processing: int
    completed: int
    failed: int
    done: bool
    all_succeeded: bool
    orientation: Optional[str] = None


@router.post("", response_model=Request)
async def create(body: RequestCreate):
    data = body.model_dump(exclude_none=True)
    data["req_type"] = data.pop("type")

    # Reject if there's already an active request for the same scene + type
    scene_id = data.get("scene_id")
    req_type = data.get("req_type")
    if scene_id and req_type:
        existing = await crud.list_requests(scene_id=scene_id)
        active = [r for r in existing
                  if r.get("type") == req_type
                  and r.get("status") in ("PENDING", "PROCESSING")]
        if active:
            raise HTTPException(
                409,
                f"Active {req_type} request already exists for scene {scene_id[:8]} "
                f"(status={active[0]['status']}, id={active[0]['id'][:8]})"
            )

    # Auto-set video orientation (symmetric with batch endpoint)
    vid = data.get("video_id")
    orient = data.get("orientation")
    if vid and orient:
        await crud.update_video(vid, orientation=orient)

    return await crud.create_request(**data)


@router.post("/batch", response_model=list[Request])
async def create_batch(body: BatchRequestCreate):
    """Submit multiple requests atomically. Server handles throttling (max 5 concurrent, 10s cooldown).
    Duplicate active requests for the same scene+type are skipped (not errors)."""
    # Auto-set video orientation from the batch (tracks current active orientation)
    _seen_vids: set[str] = set()
    for item in body.requests:
        vid = item.video_id
        orient = item.orientation
        if vid and orient and vid not in _seen_vids:
            _seen_vids.add(vid)
            await crud.update_video(vid, orientation=orient)
    results = []
    for item in body.requests:
        data = item.model_dump(exclude_none=True)
        data["req_type"] = data.pop("type")
        scene_id = data.get("scene_id")
        character_id = data.get("character_id")
        req_type = data.get("req_type")
        # Idempotent: skip if active request already exists
        if scene_id and req_type:
            existing = await crud.list_requests(scene_id=scene_id)
            active = [r for r in existing
                      if r.get("type") == req_type
                      and r.get("status") in ("PENDING", "PROCESSING")]
            if active:
                results.append(active[0])
                continue
        if character_id and req_type:
            existing = await crud.list_requests(project_id=data.get("project_id"))
            active = [r for r in existing
                      if r.get("character_id") == character_id
                      and r.get("type") == req_type
                      and r.get("status") in ("PENDING", "PROCESSING")]
            if active:
                results.append(active[0])
                continue
        results.append(await crud.create_request(**data))
    return results


@router.get("/flow-debug")
async def flow_debug():
    """Return enriched request data for the visual flow debug page."""
    from agent.db.schema import get_db
    from agent.services.cdp_client import get_cdp_client
    from agent.services.redis_queue import queue_size
    from agent.services.flow_client import get_flow_client
    import json as _json

    db = await get_db()
    cdp = get_cdp_client()
    client = get_flow_client()

    # Load accounts
    cur = await db.execute("SELECT id, name, in_use, max_count, models, locked FROM account")
    accounts = {r["id"]: dict(r) for r in await cur.fetchall()}

    # Load projects
    cur = await db.execute("SELECT id, name FROM project")
    projects = {r["id"]: r["name"] for r in await cur.fetchall()}

    # Get recent requests (last 50)
    cur = await db.execute("""
        SELECT id, type, status, account_id, project_id, chrome_pid,
               media_id, output_url, error_message, retry_count,
               progress_pct, progress_stage, created_at, updated_at
        FROM request ORDER BY created_at DESC LIMIT 50
    """)
    requests = []
    for row in await cur.fetchall():
        r = dict(row)
        # Enrich with account name
        if r["account_id"] and r["account_id"] in accounts:
            r["account_name"] = accounts[r["account_id"]]["name"]
            r["account_models"] = accounts[r["account_id"]]["models"]
        else:
            r["account_name"] = None
            r["account_models"] = None

        # Enrich with project name
        if r["project_id"] and r["project_id"] in projects:
            r["project_name"] = projects[r["project_id"]]
        else:
            r["project_name"] = None

        # Determine pipeline step
        r["flow_step"] = _get_flow_step(r)

        # Check if chrome_pid is still alive
        if r["chrome_pid"]:
            try:
                import psutil
                proc = psutil.Process(r["chrome_pid"])
                r["chrome_alive"] = proc.is_running() and proc.status() != psutil.STATUS_ZOMBIE
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                r["chrome_alive"] = False
        else:
            r["chrome_alive"] = False

        requests.append(r)

    # Active Chrome sessions (from CDPClient + Chrome Manager)
    sessions = []
    for sid, sess in cdp._sessions.items():
        sessions.append({
            "session_id": sid,
            "account_id": sess.account_id,
            "account_name": accounts.get(sess.account_id, {}).get("name", "?"),
            "pid": sess.pid,
            "status": sess.status,
            "has_token": sess.bearer_token is not None,
            "uptime_s": int(__import__("time").time() - sess.created_at) if sess.created_at else 0,
        })

    # Also query Chrome Manager for instances
    try:
        from agent.config import CHROME_MANAGER_URL
        import httpx
        async with httpx.AsyncClient(timeout=5) as hc:
            resp = await hc.get(f"{CHROME_MANAGER_URL}/chrome")
            if resp.status_code == 200:
                for ci in resp.json().get("instances", []):
                    cm_sid = ci.get("session_id", "")
                    if any(s["session_id"] == cm_sid for s in sessions):
                        continue
                    cm_acct = ci.get("account_id", "default")
                    sessions.append({
                        "session_id": cm_sid,
                        "account_id": cm_acct,
                        "account_name": accounts.get(cm_acct, {}).get("name", cm_acct[:12] if cm_acct else "?"),
                        "pid": ci.get("pid", 0),
                        "status": ci.get("status", "UNKNOWN"),
                        "has_token": (any(s.account_id == cm_acct and s.bearer_token for s in cdp._sessions.values()) or _check_extension_token(cm_acct)),
                        "uptime_s": ci.get("uptime", 0),
                    })
    except Exception:
        pass

    # Queue stats
    try:
        queue_sizes = await queue_size()
        queue_detail = {}
        if isinstance(queue_sizes, dict):
            for model_name, size in queue_sizes.items():
                try:
                    from agent.services.redis_queue import peek
                    items = await peek(model_name, limit=20)
                    queue_detail[model_name] = {
                        "size": size,
                        "items": [
                            {
                                "request_id": item["request_id"][:8],
                                "full_id": item["request_id"],
                                "score": item.get("score", 0),
                                "age_s": int(__import__("time").time() - item.get("enqueued_at", __import__("time").time())),
                            }
                            for item in items
                        ],
                    }
                except Exception:
                    queue_detail[model_name] = {"size": size, "items": []}
    except Exception:
        queue_sizes = {}
        queue_detail = {}

    return {
        "requests": requests,
        "accounts": list(accounts.values()),
        "chrome_sessions": sessions,
        "queue_length": queue_sizes if isinstance(queue_sizes, int) else sum(queue_sizes.values()) if isinstance(queue_sizes, dict) else 0,
        "queue_detail": queue_detail,
        "extension_connected": client.connected,
        "flow_key_present": bool(client._flow_key),
    }


def _get_flow_step(req: dict) -> dict:
    """Determine which pipeline step a request is at, with details."""
    status = req.get("status", "")
    error = req.get("error_message", "")
    retry = req.get("retry_count", 0)
    progress = req.get("progress_pct", 0)
    stage = req.get("progress_stage", "")
    account_id = req.get("account_id")
    chrome_pid = req.get("chrome_pid")
    media_id = req.get("media_id")

    if status == "COMPLETED":
        return {"step": "done", "label": "Complete", "detail": f"media_id: {media_id[:12]}..." if media_id else "Done", "color": "emerald"}
    if status == "FAILED":
        if "auth" in (error or "").lower() or "credentials" in (error or "").lower():
            return {"step": "auth_failed", "label": "Auth Failed", "detail": error[:80] if error else "Auth error", "color": "red"}
        if "recaptcha" in (error or "").lower():
            return {"step": "recaptcha", "label": "reCAPTCHA", "detail": "Rate limited by Google", "color": "amber"}
        return {"step": "failed", "label": "Failed", "detail": error[:80] if error else "Unknown error", "color": "red"}

    # PENDING or PROCESSING — determine step
    if not account_id:
        if retry > 0:
            return {"step": "retrying", "label": "Retrying", "detail": f"Retry #{retry}", "color": "amber"}
        return {"step": "queued", "label": "Queued", "detail": "Waiting for account", "color": "violet"}
    if not chrome_pid:
        return {"step": "chrome_launching", "label": "Chrome", "detail": "Launching Chrome...", "color": "cyan"}
    if "authenticat" in (stage or "").lower():
        return {"step": "authenticating", "label": "Auth", "detail": "Injecting cookies & capturing token", "color": "cyan"}
    if "generat" in (stage or "").lower():
        return {"step": "generating", "label": "Generating", "detail": f"{progress}% — {stage}", "color": "cyan"}
    if progress > 0:
        return {"step": "processing", "label": "Processing", "detail": f"{progress}% — {stage}", "color": "cyan"}
    return {"step": "assigned", "label": "Assigned", "detail": f"Account assigned, starting...", "color": "violet"}


@router.post("/flow-debug/flush-queue")
async def flush_queue():
    """Flush all Redis queue entries (stale/orphaned requests)."""
    from agent.services.redis_queue import _get_redis
    r = await _get_redis()
    if not r:
        return {"ok": False, "error": "Redis not connected"}

    cursor = 0
    deleted = 0
    while True:
        cursor, keys = await r.scan(cursor, match="queue:*", count=100)
        for key in keys:
            await r.delete(key)
            deleted += 1
        if cursor == 0:
            break

    return {"ok": True, "deleted_queues": deleted}


@router.get("")
async def list_all(scene_id: str = None, status: str = None,
                   video_id: str = None, project_id: str = None,
                   from_date: str = None, to_date: str = None,
                   limit: int = 50, dev: bool = False):
    rows = await crud.list_requests(scene_id=scene_id, status=status,
                                    video_id=video_id, project_id=project_id,
                                    from_date=from_date, to_date=to_date)
    if limit:
        rows = rows[:limit]
    if not dev:
        return rows

    # Dev mode: enrich with account names, profile info, and project names
    from agent.db.schema import get_db
    db = await get_db()

    # Load accounts
    cur = await db.execute("SELECT id, name, in_use, max_count, models FROM account")
    accounts = {r["id"]: dict(r) for r in await cur.fetchall()}

    # Load projects
    cur = await db.execute("SELECT id, name FROM project")
    projects = {r["id"]: r["name"] for r in await cur.fetchall()}

    # Load active profiles
    cur = await db.execute(
        "SELECT account_id, pid, status, site, created_at FROM chrome_profile WHERE status='ACTIVE'"
    )
    profiles = {r["account_id"]: dict(r) for r in await cur.fetchall()}

    enriched = []
    for r in rows:
        acc_id = r.get("account_id")
        acc = accounts.get(acc_id, {}) if acc_id else {}
        prof = profiles.get(acc_id, {}) if acc_id else {}
        r["account_name"] = acc.get("name") if acc else None
        r["account_in_use"] = acc.get("in_use", 0) if acc else 0
        r["account_max_count"] = acc.get("max_count", 1) if acc else 1
        r["project_name"] = projects.get(r.get("project_id"))
        r["chrome_pid"] = prof.get("pid") if prof else r.get("chrome_pid")
        r["chrome_status"] = prof.get("status") if prof else None
        r["chrome_site"] = prof.get("site") if prof else None
        enriched.append(r)

    return enriched


@router.get("/pending", response_model=list[Request])
async def list_pending():
    return await crud.list_pending_requests()


@router.get("/batch-status", response_model=BatchStatus)
async def batch_status(video_id: str = None, project_id: str = None,
                       type: str = None, orientation: str = None):
    """Aggregate status for all requests matching the filter.
    Poll this instead of polling N individual request IDs."""
    rows = await crud.list_requests(video_id=video_id, project_id=project_id)
    if type:
        rows = [r for r in rows if r.get("type") == type]
    if orientation:
        rows = [r for r in rows if r.get("orientation") == orientation]
    counts = {"PENDING": 0, "PROCESSING": 0, "COMPLETED": 0, "FAILED": 0}
    for r in rows:
        s = r.get("status", "PENDING")
        counts[s] = counts.get(s, 0) + 1
    total = len(rows)
    return BatchStatus(
        total=total,
        pending=counts["PENDING"],
        processing=counts["PROCESSING"],
        orientation=orientation,
        completed=counts["COMPLETED"],
        failed=counts["FAILED"],
        done=(counts["PENDING"] == 0 and counts["PROCESSING"] == 0),
        all_succeeded=(counts["COMPLETED"] == total and total > 0),
    )


@router.get("/{rid}", response_model=Request)
async def get(rid: str):
    r = await crud.get_request(rid)
    if not r:
        raise HTTPException(404, "Request not found")
    return r


@router.patch("/{rid}", response_model=Request)
async def update(rid: str, body: RequestUpdate):
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "No fields to update")
    r = await crud.update_request(rid, **data)
    if not r:
        raise HTTPException(404, "Request not found")
    return r


@router.get("/{rid}/events")
async def get_request_events(rid: str):
    """Return request + its events for the detail page."""
    from agent.db.schema import get_db
    r = await crud.get_request(rid)
    if not r:
        raise HTTPException(404, "Request not found")
    db = await get_db()
    events = []
    try:
        cur = await db.execute(
            "SELECT id, request_id, event_type, message, why, details, created_at "
            "FROM request_event WHERE request_id=? ORDER BY created_at ASC", (rid,)
        )
        rows = await cur.fetchall()
        for row in rows:
            events.append({
                "id": row["id"],
                "request_id": row["request_id"],
                "event_type": row["event_type"],
                "message": row["message"],
                "why": row["why"],
                "details": row["details"],
                "created_at": row["created_at"],
                "label": row["event_type"].replace("_", " ").title(),
            })
    except Exception:
        pass  # table may not exist yet
    return {"request": r, "events": events}


@router.get("/log/accounts")
async def log_accounts():
    """Account-focused log: each account with stats and recent requests."""
    from agent.db.schema import get_db
    from agent.services.cdp_client import get_cdp_client
    import json as _json
    db = await get_db()
    cdp = get_cdp_client()

    cur = await db.execute("SELECT id, name, in_use, max_count, models, locked_at FROM account")
    accounts = [dict(r) for r in await cur.fetchall()]

    # Load projects
    cur = await db.execute("SELECT id, name FROM project")
    projects = {r["id"]: r["name"] for r in await cur.fetchall()}

    # Get request counts per account
    cur = await db.execute("""
        SELECT account_id, type, status, COUNT(*) as cnt
        FROM request WHERE account_id IS NOT NULL
        GROUP BY account_id, type, status
    """)
    stats = {}
    for r in await cur.fetchall():
        aid = r["account_id"]
        if aid not in stats:
            stats[aid] = {"completed": 0, "failed": 0, "processing": 0, "pending": 0, "total": 0}
        stats[aid]["total"] += r["cnt"]
        s = r["status"].lower()
        if s in stats[aid]:
            stats[aid][s] += r["cnt"]

    # Get last 5 requests per account
    cur = await db.execute("""
        SELECT account_id, type, status, progress_pct, progress_stage, created_at, chrome_pid, project_id
        FROM request WHERE account_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 50
    """)
    recent = {}
    for r in await cur.fetchall():
        aid = r["account_id"]
        if aid not in recent:
            recent[aid] = []
        if len(recent[aid]) < 5:
            recent[aid].append(dict(r))

    # Get active sessions from CDPClient
    active_sessions = {}
    for sid, session in cdp._sessions.items():
        if session.status == "RUNNING":
            active_sessions[session.account_id] = {
                "pid": session.pid,
                "status": session.status,
                "uptime_s": int(__import__("time").time() - session.created_at) if session.created_at else 0,
                "has_token": session.bearer_token is not None,
            }

    result = []
    for acc in accounts:
        aid = acc["id"]
        models = acc.get("models", "[]")
        if isinstance(models, str):
            try:
                models = _json.loads(models)
            except Exception:
                models = []

        # Resolve project names in recent requests
        recent_reqs = recent.get(aid, [])
        for rr in recent_reqs:
            pid = rr.get("project_id")
            if pid:
                rr["project_name"] = projects.get(pid)

        result.append({
            "id": aid,
            "name": acc["name"],
            "in_use": acc.get("in_use", 0),
            "max_count": acc.get("max_count", 1),
            "models": models,
            "locked": acc.get("locked_at") is not None,
            "stats": stats.get(aid, {"completed": 0, "failed": 0, "processing": 0, "pending": 0, "total": 0}),
            "recent_requests": recent_reqs,
            "session": active_sessions.get(aid),
        })

    return result


@router.get("/log/profiles")
async def log_profiles():
    """Profile log grouped by unique profile directory. Each profile can have multiple open/close sessions."""
    from agent.db.schema import get_db
    from agent.services.cdp_client import get_cdp_client, CHROME_IDLE_TIMEOUT
    from datetime import datetime
    import json as _json
    import time as _time
    db = await get_db()
    cdp = get_cdp_client()

    now = _time.time()

    # Load accounts
    cur = await db.execute("SELECT id, name, site, models, max_count, in_use, status, project_id FROM account")
    all_accounts = {}
    for r in await cur.fetchall():
        all_accounts[r["id"]] = dict(r)

    # Load projects
    cur = await db.execute("SELECT id, name FROM project")
    projects = {r["id"]: r["name"] for r in await cur.fetchall()}

    # Load all chrome_profile rows grouped by profile_dir
    cur = await db.execute(
        "SELECT id, account_id, site, profile_dir, pid, status, created_at, closed_at "
        "FROM chrome_profile ORDER BY created_at DESC"
    )
    profile_rows = [dict(r) for r in await cur.fetchall()]

    # Load ALL requests with chrome_pid
    cur = await db.execute(
        "SELECT chrome_pid, id, type, status, project_id, account_id, created_at, error_message "
        "FROM request WHERE chrome_pid IS NOT NULL ORDER BY created_at DESC"
    )
    all_jobs = [dict(r) for r in await cur.fetchall()]

    # Index jobs by chrome_pid
    jobs_by_pid: dict[int, list] = {}
    for j in all_jobs:
        cpid = j["chrome_pid"]
        if cpid not in jobs_by_pid:
            jobs_by_pid[cpid] = []
        pid_val = j["project_id"]
        jobs_by_pid[cpid].append({
            "id": j["id"],
            "type": j["type"],
            "status": j["status"],
            "project_id": pid_val,
            "project_name": projects.get(pid_val) if pid_val else None,
            "account_id": j["account_id"],
            "created_at": j["created_at"],
            "error_message": j["error_message"],
        })

    # Get currently processing requests
    cur = await db.execute(
        "SELECT account_id, type, status, progress_pct, progress_stage, project_id FROM request WHERE status='PROCESSING'"
    )
    processing = {}
    for r in await cur.fetchall():
        aid = r.get("account_id")
        if aid:
            pid = r.get("project_id")
            processing[aid] = {
                "type": r["type"],
                "progress_pct": r.get("progress_pct", 0),
                "progress_stage": r.get("progress_stage", ""),
                "project_id": pid,
                "project_name": projects.get(pid) if pid else None,
            }

    # Active CDPClient sessions indexed by pid
    live_by_pid = {}
    for sid, session in cdp._sessions.items():
        if session.status == "RUNNING" and session.pid:
            live_by_pid[session.pid] = session

    # Build pid→profile_dir mapping for live sessions
    pid_to_profile_dir = {}
    for row in profile_rows:
        if row["pid"] and row["profile_dir"]:
            pid_to_profile_dir[row["pid"]] = row["profile_dir"]

    # ── Group by profile_dir ──
    profile_map: dict[str, dict] = {}

    for row in profile_rows:
        pdir = row["profile_dir"]
        if not pdir:
            continue

        if pdir not in profile_map:
            profile_map[pdir] = {
                "profile_id": pdir,
                "profile_id_short": pdir.split("/")[-1][:12] if "/" in pdir else pdir[:12],
                "account_id": row["account_id"],
                "site": row["site"],
                "sessions": [],
                "total_jobs": 0,
                "total_duration_s": 0,
                "all_account_names": set(),
            }

        pm = profile_map[pdir]
        pm["all_account_names"].add(all_accounts.get(row["account_id"], {}).get("name", row["account_id"][:12]))

        chrome_pid = row["pid"]
        is_live = chrome_pid and chrome_pid in live_by_pid
        live_session = live_by_pid.get(chrome_pid) if is_live else None

        # Compute duration
        opened_at = row["created_at"]
        closed_at = row["closed_at"]
        duration_s = 0
        chrome_status = "CLOSED"
        if closed_at:
            try:
                t_open = datetime.fromisoformat(opened_at.replace("Z", "+00:00"))
                t_close = datetime.fromisoformat(closed_at.replace("Z", "+00:00"))
                duration_s = int((t_close - t_open).total_seconds())
            except Exception:
                pass
        elif is_live:
            duration_s = int(now - live_session.created_at) if live_session and live_session.created_at else 0
            chrome_status = "RUNNING"

        auto_close_in = 0
        if live_session:
            last_active = live_session.token_captured_at or live_session.created_at or now
            auto_close_in = max(0, int(CHROME_IDLE_TIMEOUT - (now - last_active)))

        jobs = jobs_by_pid.get(chrome_pid, [])
        busy = processing.get(row["account_id"]) if is_live else None

        pm["sessions"].append({
            "session_id": row["id"],
            "pid": chrome_pid,
            "chrome_status": chrome_status,
            "is_live": is_live,
            "has_token": live_session.bearer_token is not None if live_session else False,
            "account_id": row["account_id"],
            "account_name": all_accounts.get(row["account_id"], {}).get("name", row["account_id"][:12] if row["account_id"] else "?"),
            "opened_at": opened_at,
            "closed_at": closed_at,
            "duration_s": duration_s,
            "auto_close_in": auto_close_in,
            "current_request": busy,
            "jobs": jobs[:20],
            "job_count": len(jobs),
        })

        pm["total_jobs"] += len(jobs)
        pm["total_duration_s"] += duration_s

    # Build final sorted list (newest profile_dir first)
    result = []
    for pdir, pm in profile_map.items():
        # Aggregate stats across all sessions
        all_session_jobs = []
        for sess in pm["sessions"]:
            all_session_jobs.extend(sess["jobs"])

        agg_stats = {"completed": 0, "failed": 0, "processing": 0, "pending": 0}
        for j in all_session_jobs:
            if j["status"] in agg_stats:
                agg_stats[j["status"]] += 1

        # Account details
        aid = pm["account_id"]
        acct = all_accounts.get(aid, {})
        bound_pid = acct.get("project_id")
        models = []
        try:
            models = _json.loads(acct.get("models", "[]"))
        except Exception:
            pass

        # Check if any session is live
        any_live = any(s["is_live"] for s in pm["sessions"])
        latest_opened = pm["sessions"][0]["opened_at"] if pm["sessions"] else None

        result.append({
            "profile_id": pm["profile_id"],
            "profile_id_short": pm["profile_id_short"],
            "account_id": aid,
            "account_name": acct.get("name", aid[:12] if aid else "?"),
            "account_names": list(pm["all_account_names"]),
            "site": pm["site"],
            "is_live": any_live,
            "total_sessions": len(pm["sessions"]),
            "total_jobs": pm["total_jobs"],
            "total_duration_s": pm["total_duration_s"],
            "stats": agg_stats,
            "sessions": pm["sessions"],
            "models": models,
            "max_count": acct.get("max_count", 1),
            "in_use": acct.get("in_use", 0),
            "bound_project": {"id": bound_pid, "name": projects.get(bound_pid)} if bound_pid else None,
            "project_mode": "BOUND" if bound_pid else "RANDOM",
            "latest_opened_at": latest_opened,
        })

    # Sort by latest activity
    result.sort(key=lambda x: x["latest_opened_at"] or "", reverse=True)

    # 2. Orphaned Chrome (running but not in chrome_profile table)
    tracked_pids = {s.pid for s in cdp._sessions.values() if s.pid and s.status == "RUNNING"}
    db_pids = {row["pid"] for row in profile_rows if row["pid"]}
    try:
        import psutil
        for proc in psutil.process_iter(["pid", "name", "cmdline", "create_time"]):
            if proc.info["name"] != "chrome.exe":
                continue
            cmdline = " ".join(proc.info.get("cmdline") or [])
            if "--remote-debugging-port=9223" not in cmdline:
                continue
            pid = proc.info["pid"]
            if pid in tracked_pids or pid in db_pids:
                continue
            idle_s = int(now - (proc.info.get("create_time") or now))
            orphan_jobs = jobs_by_pid.get(pid, [])
            result.append({
                "profile_id": None,
                "profile_id_short": f"orphan-{pid}",
                "account_id": None,
                "account_name": "Unknown",
                "account_names": ["Unknown"],
                "site": "unknown",
                "is_live": False,
                "total_sessions": 0,
                "total_jobs": len(orphan_jobs),
                "total_duration_s": idle_s,
                "stats": None,
                "sessions": [{
                    "session_id": None,
                    "pid": pid,
                    "chrome_status": "ORPHANED",
                    "is_live": False,
                    "has_token": False,
                    "account_id": None,
                    "account_name": "Unknown",
                    "opened_at": None,
                    "closed_at": None,
                    "duration_s": idle_s,
                    "auto_close_in": max(0, int(CHROME_IDLE_TIMEOUT - idle_s)),
                    "current_request": None,
                    "jobs": orphan_jobs[:20],
                    "job_count": len(orphan_jobs),
                }],
                "models": [],
                "max_count": 0,
                "in_use": 0,
                "bound_project": None,
                "project_mode": None,
                "latest_opened_at": None,
            })
    except Exception:
        pass

    return result


@router.get("/log/profiles/timeline")
async def log_profiles_timeline():
    """Flat chronological timeline of all jobs with profile info."""
    from agent.db.schema import get_db
    db = await get_db()

    cur = await db.execute("SELECT id, name FROM account")
    accounts = {r["id"]: r["name"] for r in await cur.fetchall()}

    cur = await db.execute("SELECT id, name FROM project")
    projects = {r["id"]: r["name"] for r in await cur.fetchall()}

    cur = await db.execute("SELECT pid, profile_dir FROM chrome_profile WHERE pid IS NOT NULL")
    pid_to_profile: dict[int, str] = {}
    for r in await cur.fetchall():
        pid_to_profile[r["pid"]] = r["profile_dir"]

    cur = await db.execute(
        "SELECT id, type, status, project_id, account_id, chrome_pid, created_at, updated_at, error_message "
        "FROM request ORDER BY created_at DESC LIMIT 200"
    )

    timeline = []
    for r in await cur.fetchall():
        pid_val = r["project_id"]
        cpid = r["chrome_pid"]
        pdir = pid_to_profile.get(cpid) if cpid else None
        aid = r["account_id"]

        timeline.append({
            "id": r["id"],
            "type": r["type"],
            "status": r["status"],
            "project_id": pid_val,
            "project_name": projects.get(pid_val) if pid_val else None,
            "account_id": aid,
            "account_name": accounts.get(aid, aid[:12] if aid else None),
            "chrome_pid": cpid,
            "profile_id": pdir,
            "profile_id_short": pdir.split("/")[-1][:12] if pdir and "/" in pdir else (pdir[:12] if pdir else None),
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "error_message": r["error_message"],
        })

    return timeline
