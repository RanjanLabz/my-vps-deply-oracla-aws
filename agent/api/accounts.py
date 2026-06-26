"""FastAPI router for account (cookie-based auth) endpoints."""
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from agent.db.schema import get_db, _db_lock
from agent.config import IMAGE_MODELS

# Build reverse mapping: API name -> short name (e.g. "NARWHAL" -> "NANO_BANANA_2")
_REVERSE_MODELS = {v: k for k, v in IMAGE_MODELS.items()}

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/accounts", tags=["accounts"])


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _uuid() -> str:
    return str(uuid.uuid4())


class AccountCreate(BaseModel):
    site: str
    name: str
    cookies: str = "[]"
    models: list[str] = Field(default_factory=list)
    max_count: int = 1
    project_id: Optional[str] = None


class AccountUpdate(BaseModel):
    site: Optional[str] = None
    name: Optional[str] = None
    cookies: Optional[str] = None
    models: Optional[list[str]] = None
    max_count: Optional[int] = None
    status: Optional[str] = None
    project_id: Optional[str] = None


class AccountResponse(BaseModel):
    id: str
    site: str
    name: str
    cookies: str
    models: str
    max_count: int
    in_use: int
    locked: int
    locked_at: Optional[str]
    status: str
    project_id: Optional[str]
    project_mode: Optional[str] = None
    bound_project_id: Optional[str] = None
    created_at: str
    updated_at: str


@router.get("", response_model=list[AccountResponse])
async def list_accounts(site: str = None, model: str = None):
    """List all accounts, optionally filtered by site or model."""
    db = await get_db()
    if site:
        cur = await db.execute("SELECT * FROM account WHERE site=? ORDER BY created_at DESC", (site,))
    else:
        cur = await db.execute("SELECT * FROM account ORDER BY created_at DESC")
    rows = await cur.fetchall()
    accounts = [dict(r) for r in rows]
    for a in accounts:
        a["project_mode"] = "BOUND" if a.get("project_id") else "RANDOM"
        a["bound_project_id"] = a.get("project_id")
    if model:
        accounts = [a for a in accounts if model in json.loads(a["models"])]
    return accounts


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(account_id: str):
    """Get a single account by ID."""
    db = await get_db()
    cur = await db.execute("SELECT * FROM account WHERE id=?", (account_id,))
    row = await cur.fetchone()
    if not row:
        raise HTTPException(404, f"Account '{account_id}' not found")
    return dict(row)


@router.post("", response_model=AccountResponse, status_code=201)
async def create_account(body: AccountCreate):
    """Create a new account with cookies and model associations."""
    db = await get_db()
    aid, now = _uuid(), _now()
    models_json = json.dumps(body.models)

    # Validate project_id exists if provided
    project_id = body.project_id
    if project_id:
        cur = await db.execute("SELECT 1 FROM project WHERE id=?", (project_id,))
        if not await cur.fetchone():
            raise HTTPException(400, f"Project {project_id} not found")

    async with _db_lock:
        await db.execute(
            "INSERT INTO account (id,site,name,cookies,models,max_count,project_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (aid, body.site, body.name, body.cookies, models_json, body.max_count, project_id, now, now))
        await db.commit()
    cur = await db.execute("SELECT * FROM account WHERE id=?", (aid,))
    return dict(await cur.fetchone())


@router.patch("/{account_id}", response_model=AccountResponse)
async def update_account(account_id: str, body: AccountUpdate):
    """Update an account's cookies, models, max_count, status, or project binding."""
    db = await get_db()
    cur = await db.execute("SELECT * FROM account WHERE id=?", (account_id,))
    row = await cur.fetchone()
    if not row:
        raise HTTPException(404, f"Account '{account_id}' not found")

    updates = {}
    if body.site is not None:
        updates["site"] = body.site
    if body.name is not None:
        updates["name"] = body.name
    if body.cookies is not None:
        updates["cookies"] = body.cookies
    if body.models is not None:
        updates["models"] = json.dumps(body.models)
    if body.max_count is not None:
        updates["max_count"] = body.max_count
    if body.status is not None:
        if body.status not in ("ACTIVE", "DISABLED", "LOCKED"):
            raise HTTPException(400, f"Invalid status: {body.status}")
        updates["status"] = body.status

    # Handle project_id binding
    if body.project_id is not None:
        project_id = body.project_id if body.project_id else None
        if project_id:
            cur = await db.execute("SELECT 1 FROM project WHERE id=?", (project_id,))
            if not await cur.fetchone():
                raise HTTPException(400, f"Project {project_id} not found")
        updates["project_id"] = project_id

    if updates:
        updates["updated_at"] = _now()
        sets = ", ".join(f"{k}=?" for k in updates)
        vals = list(updates.values()) + [account_id]
        async with _db_lock:
            await db.execute(f"UPDATE account SET {sets} WHERE id=?", vals)
            await db.commit()

    cur = await db.execute("SELECT * FROM account WHERE id=?", (account_id,))
    return dict(await cur.fetchone())


@router.delete("/{account_id}")
async def delete_account(account_id: str):
    """Delete an account and its associated chrome profiles."""
    db = await get_db()
    async with _db_lock:
        cur = await db.execute("DELETE FROM account WHERE id=?", (account_id,))
        await db.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, f"Account '{account_id}' not found")
    return {"ok": True}


@router.post("/{account_id}/lock")
async def lock_account(account_id: str):
    """Force-lock an account (e.g., for crash recovery or manual intervention)."""
    db = await get_db()
    cur = await db.execute("SELECT * FROM account WHERE id=?", (account_id,))
    row = await cur.fetchone()
    if not row:
        raise HTTPException(404, f"Account '{account_id}' not found")
    now = _now()
    async with _db_lock:
        await db.execute("UPDATE account SET locked=1, locked_at=?, status='LOCKED', updated_at=? WHERE id=?",
                         (now, now, account_id))
        await db.commit()
    cur = await db.execute("SELECT * FROM account WHERE id=?", (account_id,))
    return dict(await cur.fetchone())


@router.post("/{account_id}/unlock")
async def unlock_account(account_id: str):
    """Force-unlock an account (clear stuck locks)."""
    db = await get_db()
    cur = await db.execute("SELECT * FROM account WHERE id=?", (account_id,))
    row = await cur.fetchone()
    if not row:
        raise HTTPException(404, f"Account '{account_id}' not found")
    now = _now()
    async with _db_lock:
        await db.execute("UPDATE account SET locked=0, locked_at=NULL, in_use=0, status='ACTIVE', updated_at=? WHERE id=?",
                         (now, account_id))
        await db.commit()
    cur = await db.execute("SELECT * FROM account WHERE id=?", (account_id,))
    return dict(await cur.fetchone())


@router.post("/recover-stuck")
async def recover_stuck_accounts():
    """Manually trigger recovery of accounts with stuck in_use counters."""
    recovered = await recover_stuck_in_use()
    return {"recovered": recovered, "message": f"Reset in_use for {recovered} accounts"}


# ─── Account selection for workers ───────────────────────────

async def find_free_account(model: str, site: str = None) -> Optional[dict]:
    """Find an account that supports the given model and has available capacity.

    Returns the account dict or None if all accounts are busy/locked.
    """
    db = await get_db()
    if site:
        cur = await db.execute(
            "SELECT * FROM account WHERE site=? AND status='ACTIVE' AND locked=0 ORDER BY in_use ASC",
            (site,))
    else:
        cur = await db.execute(
            "SELECT * FROM account WHERE status='ACTIVE' AND locked=0 ORDER BY in_use ASC")
    rows = await cur.fetchall()
    for row in rows:
        account = dict(row)
        models = json.loads(account["models"])
        if model in models and account["in_use"] < account["max_count"]:
            return account
    return None


async def try_acquire_account(model: str, site: str = None, project_id: str = None) -> Optional[dict]:
    """Atomically find a free account AND acquire it under a single lock.

    Smart account selection algorithm:
    1. If project has bound accounts → ONLY use bound accounts (no unbound fallback)
    2. If project has NO bound accounts → use unbound accounts
    3. Among eligible accounts, prefer least-busy (lowest in_use)
    4. Must match model AND have capacity (in_use < max_count)

    This prevents:
    - Using wrong profile for a project
    - Falling back to unbound when bound accounts exist
    - Race conditions from concurrent selection

    Returns the account dict if acquired, None if all accounts are busy.
    """
    db = await get_db()
    now = _now()
    pid = project_id  # shorthand

    async with _db_lock:
        # Step 1: Check if project has bound accounts
        has_bound = False
        if pid:
            cur = await db.execute(
                "SELECT 1 FROM account WHERE project_id=? AND status='ACTIVE' AND locked=0 LIMIT 1",
                (pid,))
            has_bound = await cur.fetchone() is not None

        # Step 2: Build query based on project binding
        if pid and has_bound:
            # Project has bound accounts → ONLY use bound accounts
            where = "project_id=? AND status='ACTIVE' AND locked=0"
            params = [pid]
            if site:
                where = "site=? AND " + where
                params = [site] + params
            cur = await db.execute(
                f"SELECT * FROM account WHERE {where} ORDER BY in_use ASC",
                params)
            rows = await cur.fetchall()
            logger.debug("Account selection: project=%s has_bound=true, querying bound accounts only", pid[:8])
        elif pid and not has_bound:
            # Project specified but no bound accounts → use unbound accounts
            where = "project_id IS NULL AND status='ACTIVE' AND locked=0"
            params = []
            if site:
                where = "site=? AND " + where
                params = [site]
            cur = await db.execute(
                f"SELECT * FROM account WHERE {where} ORDER BY in_use ASC",
                params)
            rows = await cur.fetchall()
            logger.debug("Account selection: project=%s has_bound=false, using unbound accounts", pid[:8])
        else:
            # No project specified → prefer unbound accounts (for auto-project creation)
            where = "project_id IS NULL AND status='ACTIVE' AND locked=0"
            params = []
            if site:
                where = "site=? AND " + where
                params = [site]
            cur = await db.execute(
                f"SELECT * FROM account WHERE {where} ORDER BY in_use ASC",
                params)
            rows = await cur.fetchall()

            # If no unbound accounts, fall back to any available account
            if not rows:
                where = "status='ACTIVE' AND locked=0"
                params = []
                if site:
                    where = "site=? AND " + where
                    params = [site]
                cur = await db.execute(
                    f"SELECT * FROM account WHERE {where} ORDER BY in_use ASC",
                    params)
                rows = await cur.fetchall()
                logger.debug("Account selection: no project, no unbound accounts, using any available")
            else:
                logger.debug("Account selection: no project, using unbound accounts")

        # Step 3: Try to acquire the best candidate (least busy, model match, has capacity)
        for row in rows:
            account = dict(row)
            models = json.loads(account["models"])
            acc_name = account.get("name", account["id"][:8])

            # Match model directly OR via reverse mapping (short name <-> API name)
            # Empty models list means account accepts ALL models
            model_short = _REVERSE_MODELS.get(model, model)
            matched = not models or model in models or model_short in models
            if not matched:
                logger.debug("Account %s skipped: model %s not in %s", acc_name, model, models)
                continue
            if account["in_use"] >= account["max_count"]:
                logger.debug("Account %s skipped: at capacity %d/%d",
                             acc_name, account["in_use"], account["max_count"])
                continue

            # Try atomic acquire
            cur = await db.execute(
                "UPDATE account SET in_use=in_use+1, updated_at=? WHERE id=? AND locked=0 AND in_use < max_count",
                (now, account["id"]))
            await db.commit()
            if cur.rowcount > 0:
                logger.info("Account %s SELECTED: model=%s project=%s in_use=%d/%d",
                            acc_name, model, pid[:8] if pid else "none",
                            account["in_use"] + 1, account["max_count"])
                return account

        logger.debug("Account selection: no free account for model=%s project=%s (%d candidates checked)",
                     model, pid[:8] if pid else "none", len(rows))
        return None


async def acquire_account(account_id: str) -> bool:
    """Try to acquire an account (increment in_use). Returns False if at capacity."""
    db = await get_db()
    now = _now()
    async with _db_lock:
        cur = await db.execute(
            "UPDATE account SET in_use=in_use+1, updated_at=? WHERE id=? AND locked=0 AND in_use < max_count",
            (now, account_id))
        await db.commit()
    return cur.rowcount > 0


async def release_account(account_id: str):
    """Release an account (decrement in_use)."""
    db = await get_db()
    now = _now()
    async with _db_lock:
        await db.execute(
            "UPDATE account SET in_use=MAX(in_use-1, 0), updated_at=? WHERE id=?",
            (now, account_id))
        await db.commit()


async def recover_stale_locks(max_age_seconds: int = 300):
    """Auto-unlock accounts that have been locked longer than max_age_seconds."""
    db = await get_db()
    now = _now()
    async with _db_lock:
        cur = await db.execute(
            "UPDATE account SET locked=0, locked_at=NULL, in_use=0, status='ACTIVE', updated_at=? "
            "WHERE locked=1 AND locked_at IS NOT NULL AND "
            "julianday('now') - julianday(locked_at) > ?",
            (now, max_age_seconds / 86400))
        await db.commit()
    if cur.rowcount > 0:
        logger.info("Recovered %d stale account locks", cur.rowcount)
    return cur.rowcount


async def recover_stuck_in_use():
    """Reset in_use counters for accounts with no active Chrome sessions.

    After a crash, release_account() may never be called, leaving in_use > 0.
    Checks both CDPClient (in-memory) sessions and chrome_profile DB table.
    """
    db = await get_db()
    now = _now()

    # Check which accounts have active Chrome sessions via CDPClient
    try:
        from agent.services.cdp_client import get_cdp_client
        cdp = get_cdp_client()
        active_account_ids = set()
        for session in cdp._sessions.values():
            if session.status == "RUNNING":
                active_account_ids.add(session.account_id)
    except Exception:
        active_account_ids = set()

    async with _db_lock:
        # Find accounts with in_use > 0
        cursor = await db.execute("SELECT id, in_use FROM account WHERE in_use > 0")
        stuck_accounts = await cursor.fetchall()

        recovered = 0
        for row in stuck_accounts:
            account_id = row["id"]
            old_in_use = row["in_use"]

            # Account is stuck if no active CDP session AND no active DB profile
            has_active_cdp = account_id in active_account_ids
            if has_active_cdp:
                continue

            # Reset in_use to 0
            await db.execute(
                "UPDATE account SET in_use=0, updated_at=? WHERE id=?",
                (now, account_id))
            recovered += 1
            logger.warning("Recovered stuck in_use for account %s: %d -> 0 (no active CDP session)",
                         account_id[:8], old_in_use)

        await db.commit()

    if recovered > 0:
        logger.info("Recovered %d accounts with stuck in_use counters", recovered)
    return recovered
