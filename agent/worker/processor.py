"""Background worker — processes pending requests via Chrome extension.

Thin dispatcher: picks up PENDING requests, delegates to OperationService
for actual API work, handles status transitions + retry + scene updates.
"""
import asyncio
import base64
import json
import logging
import time

import aiohttp

from agent.db import crud
from agent.services.flow_client import get_flow_client
from agent.services.event_bus import event_bus
from agent.services import redis_queue
from agent.api.accounts import try_acquire_account, release_account
from agent.api.defaults import get_default_model
from agent.config import POLL_INTERVAL, MAX_RETRIES, API_COOLDOWN, MAX_CONCURRENT_REQUESTS

# How many times a request can be deferred before we fail it with a clear error
_MAX_DEFER_BEFORE_FAIL = 6  # 6 defers * 10s = 60s total grace period


async def _fail_request_clear(rid: str, error: str):
    """Set a request to FAILED with a human-readable error message."""
    logger.warning("Request %s FAILED: %s", rid[:8], error)
    await crud.update_request(rid, status="FAILED", error_message=error, progress_pct=0, progress_stage="")
    await event_bus.emit("request_update", {"id": rid, "status": "FAILED", "error": error})
from agent.worker._parsing import _is_error
from agent.sdk.services.result_handler import parse_result, apply_scene_result, apply_character_result

logger = logging.getLogger(__name__)

_API_CALL_TYPES = {"GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE",
                   "GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS", "UPSCALE_VIDEO",
                   "GENERATE_CHARACTER_IMAGE", "REGENERATE_CHARACTER_IMAGE",
                   "EDIT_CHARACTER_IMAGE"}

_TYPE_PRIORITY = {
    "GENERATE_CHARACTER_IMAGE": 0, "REGENERATE_CHARACTER_IMAGE": 0, "EDIT_CHARACTER_IMAGE": 0,
    "GENERATE_IMAGE": 1, "REGENERATE_IMAGE": 1, "EDIT_IMAGE": 1,
    "GENERATE_VIDEO": 2, "REGENERATE_VIDEO": 2, "GENERATE_VIDEO_REFS": 2,
    "UPSCALE_VIDEO": 3,
}


async def _ensure_account_project(account: dict) -> dict:
    """If account has no project, create one and bind permanently."""
    if account.get("project_id"):
        return account
    proj = await crud.create_project(
        name=f"{account.get('name', 'Account')} Project",
        material="realistic",
    )
    from agent.db.schema import get_db, _db_lock
    db = await get_db()
    async with _db_lock:
        await db.execute(
            "UPDATE account SET project_id=? WHERE id=?",
            (proj["id"], account["id"]))
        await db.commit()
    logger.info("Auto-created project %s for account %s", proj["id"][:8], account["id"][:8])
    account["project_id"] = proj["id"]
    return account


class APIRateLimiter:
    """Enforces max concurrent requests AND minimum gap between API calls."""
    def __init__(self, max_concurrent: int, cooldown_seconds: float):
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._cooldown = cooldown_seconds
        self._last_call = 0.0
        self._gate = asyncio.Lock()

    async def acquire(self):
        await self._semaphore.acquire()
        async with self._gate:
            elapsed = time.monotonic() - self._last_call
            if elapsed < self._cooldown:
                await asyncio.sleep(self._cooldown - elapsed)
            self._last_call = time.monotonic()

    def release(self):
        self._semaphore.release()


class WorkerController:
    """Controls the background worker loop with rate limiting and graceful shutdown."""

    def __init__(self):
        self._shutdown = asyncio.Event()
        self._active_ids: set[str] = set()
        self._rate_limiter = APIRateLimiter(MAX_CONCURRENT_REQUESTS, API_COOLDOWN)
        self._deferred: dict[str, float] = {}  # rid -> defer_until timestamp
        self._retry_after: dict[str, float] = {}  # rid -> retry_after timestamp
        self._last_in_use_recovery: float = 0.0  # timestamp of last in_use recovery check
        self._chrome_launch_task: asyncio.Task | None = None
        # Serialize request processing — only one Chrome profile can be "active"
        # (extension WS + flow_key) at a time. Prevents token/account conflicts.
        self._process_lock = asyncio.Lock()
        self._account_retry_attempts: dict[str, int] = {}  # rid -> consecutive retry attempts on same account

    @property
    def active_count(self) -> int:
        """Number of currently active requests."""
        return len(self._active_ids)

    async def start(self):
        """Start the worker loop."""
        await self._cleanup_stale_processing()
        await self._run_loop()

    def request_shutdown(self):
        """Signal the worker to stop after current tasks drain."""
        self._shutdown.set()

    async def drain(self, timeout: float = 30.0):
        """Wait until all active tasks complete, with timeout."""
        deadline = time.monotonic() + timeout
        while self._active_ids and time.monotonic() < deadline:
            await asyncio.sleep(0.5)
        if self._active_ids:
            logger.warning("Drain timeout: %d tasks still active after %.0fs", len(self._active_ids), timeout)

    async def _cleanup_stale_processing(self):
        """Reset any requests stuck in PROCESSING state from a previous run."""
        try:
            stale = await crud.list_requests(status="PROCESSING")
            for req in stale:
                await crud.update_request(req["id"], status="PENDING",
                                          error_message="reset: stale PROCESSING on startup")
                logger.warning("Stale request reset: %s type=%s", req["id"][:8], req.get("type"))
            if stale:
                logger.info("Cleaned up %d stale PROCESSING requests", len(stale))
        except Exception as e:
            logger.warning("Could not clean up stale requests: %s", e)

    async def _run_loop(self):
        client = get_flow_client()
        _last_chrome_launch = 0.0
        _CHROME_LAUNCH_COOLDOWN = 30  # seconds between Chrome launch attempts

        while not self._shutdown.is_set():
            try:
                if not client.connected:
                    now = time.time()
                    # Auto-launch Chrome for the account that has pending work
                    if (self._chrome_launch_task is None or self._chrome_launch_task.done()) \
                            and (now - _last_chrome_launch) > _CHROME_LAUNCH_COOLDOWN:
                        pending_idle = await crud.list_actionable_requests(limit=1)
                        if pending_idle:
                            req_idle = pending_idle[0]
                            idle_account = req_idle.get("account_id") or "default"
                            idle_site = "labs.google"
                            from agent.services.cdp_client import get_cdp_client
                            cdp_idle = get_cdp_client()
                            if not cdp_idle.has_active_session(account_id=idle_account):
                                logger.info("Extension offline, launching Chrome for account %s", idle_account[:8])
                                _last_chrome_launch = now
                                self._chrome_launch_task = asyncio.create_task(
                                    cdp_idle.ensure_chrome(idle_account, idle_site)
                                )

                    # Track how long extension has been offline per request
                    # Fail requests that have been stuck too long
                    pending_idle_all = await crud.list_actionable_requests(limit=50)
                    for p in pending_idle_all:
                        pid = p["id"]
                        defer_count = self._deferred.get(f"ext_offline_{pid}", 0)
                        if defer_count >= _MAX_DEFER_BEFORE_FAIL:
                            await _fail_request_clear(pid,
                                "Chrome extension is not connected. "
                                "Please start Chrome with the Flow Kit extension, "
                                "or check PinchTab if using split-VPS deployment.")
                            self._deferred.pop(f"ext_offline_{pid}", None)
                        else:
                            self._deferred[f"ext_offline_{pid}"] = defer_count + 1

                    await asyncio.sleep(POLL_INTERVAL)
                    continue
                else:
                    # Extension is connected — clear any ext_offline defer tracking
                    keys_to_remove = [k for k in self._deferred if k.startswith("ext_offline_")]
                    for k in keys_to_remove:
                        self._deferred.pop(k)

                now = time.time()
                slots_available = MAX_CONCURRENT_REQUESTS - len(self._active_ids)
                if slots_available <= 0:
                    await asyncio.sleep(POLL_INTERVAL)
                    continue

                pending = await crud.list_actionable_requests(
                    exclude_ids=self._active_ids, limit=slots_available
                )

                # Also check Redis queues for overflow requests
                if slots_available > 0 and await redis_queue.is_available():
                    # Check all known model queues from DB defaults
                    all_model_names = {"default"}  # always scan the fallback queue
                    for op_type in ("generate_image", "generate_video", "upscale_video"):
                        model = await get_default_model(op_type)
                        if model:
                            all_model_names.add(model)
                    # Also check image model variants from config
                    from agent.config import IMAGE_MODELS
                    all_model_names.update(IMAGE_MODELS.values())
                    for model_name in all_model_names:
                        if slots_available <= 0:
                            break
                        entry = await redis_queue.dequeue(model_name)
                        if entry:
                            req_id = entry["request_id"]
                            if req_id not in self._active_ids:
                                # Load request from SQLite
                                req = await crud.get_request(req_id)
                                if req and req["status"] == "PENDING":
                                    pending.append(req)
                                    slots_available -= 1

                pending_count = len(pending)
                await event_bus.emit("worker_tick", {
                    "active": len(self._active_ids),
                    "slots": slots_available,
                    "pending": pending_count,
                })

                # Periodic in_use recovery: reset stuck counters every 60s
                now_ts = time.time()
                if now_ts - self._last_in_use_recovery > 60:
                    self._last_in_use_recovery = now_ts
                    try:
                        from agent.api.accounts import recover_stuck_in_use
                        await recover_stuck_in_use()
                    except Exception as e:
                        logger.debug("Periodic in_use recovery failed: %s", e)

                if pending:
                    logger.info("Worker: %d actionable, %d active, %d slots",
                                len(pending), len(self._active_ids), slots_available)

                for req in pending:
                    if slots_available <= 0:
                        break
                    rid = req["id"]

                    # Skip in-flight
                    if rid in self._active_ids:
                        continue

                    # Skip recently deferred (prereq or retry cooldown)
                    if rid in self._deferred and self._deferred[rid] > now:
                        continue
                    self._deferred.pop(rid, None)

                    # Skip if retry backoff not elapsed
                    if rid in self._retry_after and self._retry_after[rid] > now:
                        continue

                    self._active_ids.add(rid)
                    slots_available -= 1
                    asyncio.create_task(self._run_one(req))

                # Prune stale deferred/retry entries for requests no longer pending
                pending_ids = {r["id"] for r in pending}
                self._deferred = {k: v for k, v in self._deferred.items() if k in pending_ids}
                self._retry_after = {k: v for k, v in self._retry_after.items() if k in pending_ids}

            except Exception as e:
                logger.exception("Worker loop error: %s", e)

            await asyncio.sleep(POLL_INTERVAL)

    async def _run_one(self, req: dict):
        rid = req["id"]
        try:
            await self._rate_limiter.acquire()
            try:
                await _process_one(req, self._deferred, self._retry_after)
            finally:
                self._rate_limiter.release()
        finally:
            self._active_ids.discard(rid)


async def _prerequisites_met(req: dict, orientation: str) -> bool:
    """Check if prerequisites are ready. Returns False to defer (stay PENDING)."""
    req_type = req.get("type", "")
    prefix = "vertical" if orientation == "VERTICAL" else "horizontal"

    # Video gen needs scene image to be ready; upscale needs video to be ready
    if req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS", "UPSCALE_VIDEO"):
        scene = await crud.get_scene(req.get("scene_id"))
        if not scene:
            return True  # let _dispatch handle "scene not found"
        if req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS"):
            if not scene.get(f"{prefix}_image_media_id"):
                logger.info("VIDEO prereq deferred: scene=%s no %s_image_media_id", req.get("scene_id","")[:12], prefix)
                return False
        elif req_type == "UPSCALE_VIDEO":
            if not scene.get(f"{prefix}_video_media_id"):
                logger.info("UPSCALE prereq deferred: scene=%s no %s_video_media_id", req.get("scene_id","")[:12], prefix)
                return False

    # Edit requests need source media (own image or parent's for INSERT scenes)
    if req_type in ("EDIT_IMAGE", "EDIT_CHARACTER_IMAGE"):
        if not req.get("source_media_id"):
            if req_type == "EDIT_CHARACTER_IMAGE":
                char = await crud.get_character(req.get("character_id"))
                if not char or not char.get("media_id"):
                    return False
            elif req_type == "EDIT_IMAGE":
                scene = await crud.get_scene(req.get("scene_id"))
                if not scene:
                    return True  # let _dispatch handle
                # CONTINUATION scenes always use parent's image as source
                src = None
                if scene.get("parent_scene_id"):
                    parent = await crud.get_scene(scene["parent_scene_id"])
                    src = parent.get(f"{prefix}_image_media_id") if parent else None
                if not src:
                    src = scene.get(f"{prefix}_image_media_id")
                logger.info("EDIT_IMAGE prereq: scene=%s src=%s parent=%s", req.get("scene_id","")[:12], src, scene.get("parent_scene_id","")[:12] if scene.get("parent_scene_id") else "none")
                if not src:
                    return False

    return True


async def _resolve_orientation(req: dict) -> str:
    """Resolve orientation from request, falling back to video table, then VERTICAL."""
    orient = req.get("orientation")
    if orient:
        return orient
    vid = req.get("video_id")
    if vid:
        video = await crud.get_video(vid)
        if video and video.get("orientation"):
            return video["orientation"]
    return "VERTICAL"


async def _process_one(req: dict, deferred: dict = None, retry_after: dict = None):
    rid, req_type = req["id"], req["type"]
    orientation = await _resolve_orientation(req)

    if await _is_already_completed(req, orientation):
        logger.info("Request %s skipped — already COMPLETED", rid[:8])
        # Copy existing result data from scene/character onto the request record
        skip_kwargs = {"status": "COMPLETED", "error_message": "skipped: already completed"}
        prefix = "vertical" if orientation == "VERTICAL" else "horizontal"
        if req_type in ("GENERATE_CHARACTER_IMAGE", "REGENERATE_CHARACTER_IMAGE", "EDIT_CHARACTER_IMAGE"):
            char = await crud.get_character(req.get("character_id"))
            if char:
                skip_kwargs["media_id"] = char.get("media_id")
                skip_kwargs["output_url"] = char.get("image_url")
        else:
            scene = await crud.get_scene(req.get("scene_id"))
            if scene:
                if req_type == "GENERATE_IMAGE":
                    skip_kwargs["media_id"] = scene.get(f"{prefix}_image_media_id")
                    skip_kwargs["output_url"] = scene.get(f"{prefix}_image_url")
                elif req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS"):
                    skip_kwargs["media_id"] = scene.get(f"{prefix}_video_media_id")
                    skip_kwargs["output_url"] = scene.get(f"{prefix}_video_url")
                elif req_type == "UPSCALE_VIDEO":
                    skip_kwargs["media_id"] = scene.get(f"{prefix}_upscale_media_id")
                    skip_kwargs["output_url"] = scene.get(f"{prefix}_upscale_url")
        await crud.update_request(rid, **skip_kwargs)
        return

    # Check prerequisites before dispatching — don't burn retries on missing deps
    if not await _prerequisites_met(req, orientation):
        logger.debug("Request %s deferred: prerequisites not met (type=%s)", rid[:8], req_type)
        if deferred is not None:
            deferred[rid] = time.time() + 30  # defer 30s before rechecking
        return

    # Quick check: are there any accounts at all? Fail immediately if not.
    from agent.db.schema import get_db
    db = await get_db()
    cursor = await db.execute("SELECT COUNT(*) FROM account")
    row = await cursor.fetchone()
    if not row or row[0] == 0:
        await _fail_request_clear(rid,
            "No Google accounts configured. "
            "Go to Accounts page and add a Google account with valid cookies.")
        return

    # Account selection: atomically find + acquire a free account for this request type
    account = None
    account_id = None
    try:
        # Determine which model is needed
        model_name = None
        if req_type in ("GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE",
                        "GENERATE_CHARACTER_IMAGE", "REGENERATE_CHARACTER_IMAGE",
                        "EDIT_CHARACTER_IMAGE"):
            model_name = await get_default_model("generate_image")
        elif req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS"):
            model_name = await get_default_model("generate_video")
        elif req_type == "UPSCALE_VIDEO":
            model_name = await get_default_model("upscale_video")

        # Resolve short name (e.g. NANO_BANANA_2) to API model name (e.g. NARWHAL)
        # to match what accounts store in their models list
        from agent.config import IMAGE_MODELS
        account_model = IMAGE_MODELS.get(model_name, model_name) if model_name else None

        # Extract project_id for account-project binding
        # Normalize empty string to None
        pid = req.get("project_id") or None

        if account_model:
            existing_account_id = req.get("account_id")
            retry_attempts = get_worker_controller()._account_retry_attempts.get(rid, 0)

            # RETRY PATH: request already has an account_id from a previous attempt
            if existing_account_id and retry_attempts < 3:
                from agent.api.accounts import acquire_account as _acquire_specific, get_account as _get_account
                if await _acquire_specific(existing_account_id):
                    account = await _get_account(existing_account_id)
                    account_id = existing_account_id
                    logger.info("Request %s RETRY: re-acquired same account %s (attempt %d/3)",
                                rid[:8], account_id[:8], retry_attempts + 1)
                    get_worker_controller()._account_retry_attempts[rid] = retry_attempts + 1
                else:
                    # Same account still busy — defer and try again
                    get_worker_controller()._account_retry_attempts[rid] = retry_attempts + 1
                    logger.info("Request %s RETRY: same account %s busy (attempt %d/3), deferring",
                                rid[:8], existing_account_id[:8], retry_attempts + 1)
                    if deferred is not None:
                        deferred[rid] = time.time() + 10
                    return
            else:
                # FRESH PATH: no existing account, or gave up after 3 retries on same account
                if existing_account_id:
                    await crud.update_request(rid, account_id=None)
                    get_worker_controller()._account_retry_attempts.pop(rid, None)
                    logger.info("Request %s: gave up on account %s after 3 retries, picking new",
                                rid[:8], existing_account_id[:8])

                account = await try_acquire_account(account_model, project_id=pid)
                if account:
                    account_id = account["id"]
                    await crud.update_request(rid, account_id=account_id)
                    get_worker_controller()._account_retry_attempts.pop(rid, None)
                else:
                    # No free account — track deferral count
                    defer_key = f"no_acct_{rid}"
                    defer_count = (deferred or {}).get(defer_key, 0)
                    if defer_count >= _MAX_DEFER_BEFORE_FAIL:
                        # Check if ANY accounts exist at all
                        from agent.db.schema import get_db
                        db = await get_db()
                        cursor = await db.execute("SELECT COUNT(*) FROM account")
                        row = await cursor.fetchone()
                        account_count = row[0] if row else 0
                        if account_count == 0:
                            await _fail_request_clear(rid,
                                "No Google accounts configured. "
                                "Go to Accounts page and add a Google account with valid cookies.")
                        else:
                            await _fail_request_clear(rid,
                                f"No free account available for model '{account_model}'. "
                                "All accounts are busy or locked. Try again later.")
                        if deferred is not None:
                            deferred.pop(defer_key, None)
                    else:
                        if deferred is not None:
                            deferred[defer_key] = defer_count + 1

                    logger.debug("Request %s deferred: no free account for model %s project=%s (attempt %d/%d)",
                                 rid[:8], account_model, pid[:8] if pid else "none",
                                 defer_count + 1, _MAX_DEFER_BEFORE_FAIL)
                    # No free account — requeue to Redis
                    if await redis_queue.is_available():
                        await redis_queue.enqueue(rid, account_model)
                        logger.info("Request %s requeued to Redis (no free account)", rid[:8])
                    else:
                        if deferred is not None:
                            deferred[rid] = time.time() + 10  # retry in 10s
                    return
            # Use account's project if request has none
            if not pid and account.get("project_id"):
                pid = account["project_id"]
                await crud.update_request(rid, project_id=pid)
        else:
            await _fail_request_clear(rid,
                f"Unsupported request type: {req_type}. No default model configured for this operation.")

        # Ensure cookies are injected and flowKey is fresh before dispatching
        chrome_pid = None
        if account:
            from agent.api.flow import ensure_fresh_session
            from agent.services.cdp_client import get_cdp_client, MaxProfilesError
            from agent.config import CHROME_MANAGER_MAX_PROFILES

            cdp = get_cdp_client()

            # Check if this account needs a new Chrome profile
            if not cdp.has_active_session(account_id=account["id"]):
                # Different account — needs new profile. Check max limit.
                if cdp.active_count >= CHROME_MANAGER_MAX_PROFILES:
                    logger.info("Request %s deferred: max profiles reached (%d/%d), waiting for free slot",
                                rid[:8], cdp.active_count, CHROME_MANAGER_MAX_PROFILES)
                    # Release account and requeue
                    await release_account(account_id)
                    if await redis_queue.is_available():
                        await redis_queue.requeue_front(rid, account_model)
                        logger.info("Request %s requeued to Redis (max profiles)", rid[:8])
                    else:
                        if deferred is not None:
                            deferred[rid] = time.time() + 10
                    return

            await crud.update_request_progress(rid, 10, "Authenticating")
            
            # ENHANCED: Cookie injection with validation and retry
            # Try twice with 30s timeout each
            injection_success = False
            for injection_attempt in range(2):
                if await ensure_fresh_session(account, timeout=30, max_attempts=1):
                    injection_success = True
                    break
                if injection_attempt == 0:
                    logger.warning("Request %s: Cookie injection attempt 1/2 failed, retrying in 5s...", rid[:8])
                    await asyncio.sleep(5)
            
            if not injection_success:
                logger.error("Request %s: Cookie injection FAILED after 2 attempts, requeueing with backoff", rid[:8])
                # Release account and requeue to front with exponential backoff
                await release_account(account_id)
                
                # Track injection failures for exponential backoff
                retry_count = req.get("retry_count", 0)
                backoff_seconds = min(30 * (2 ** retry_count), 300)  # 30s, 60s, 120s, 240s, max 300s
                
                if await redis_queue.is_available():
                    await redis_queue.requeue_front(rid, account_model)
                    logger.info("Request %s requeued with %ds backoff (injection retry %d)", 
                                rid[:8], backoff_seconds, retry_count + 1)
                
                if deferred is not None:
                    deferred[rid] = time.time() + backoff_seconds
                
                # Don't increment actual retry_count (that's for API errors)
                # Just defer and let it retry
                return
            
            session = cdp._get_running_session(account_id=account["id"])
            chrome_pid = session.pid if session else None
            await crud.update_request_progress(rid, 20, "Auth done ✅")

        account_name = account.get("name", account_id[:8]) if account else "none"
        logger.info("Processing request %s type=%s account=%s pid=%s", rid[:8], req_type,
                     account_name, chrome_pid if chrome_pid else "none")

        if chrome_pid:
            await crud.update_request(rid, chrome_pid=chrome_pid)
        await crud.update_request(rid, status="PROCESSING")
        await crud.update_request_progress(rid, 25, "Generating")
        await event_bus.emit("request_update", {"id": rid, "status": "PROCESSING", "type": req_type})

        try:
            # Set account context so _send() routes to correct Chrome extension
            from agent.services.flow_client import get_flow_client
            get_flow_client()._current_account_id = account_id
            try:
                result = await _dispatch(req, orientation)
            finally:
                get_flow_client()._current_account_id = None
            if _is_error(result):
                await _handle_failure(rid, req, result, retry_after)
            else:
                gen_result = parse_result(result, req_type)
                await crud.update_request(rid, status="COMPLETED", media_id=gen_result.media_id, output_url=gen_result.url)
                if req_type in ("GENERATE_CHARACTER_IMAGE", "REGENERATE_CHARACTER_IMAGE", "EDIT_CHARACTER_IMAGE"):
                    char_id = req.get("character_id")
                    if char_id:
                        await apply_character_result(char_id, gen_result)
                elif req.get("scene_id"):
                    await apply_scene_result(req.get("scene_id"), req_type, orientation, gen_result)

                # ── R2 Upload (non-fatal) ──────────────────────────────────
                output_url = gen_result.url
                if output_url and req_type in ("GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE",
                                               "GENERATE_CHARACTER_IMAGE", "REGENERATE_CHARACTER_IMAGE",
                                               "EDIT_CHARACTER_IMAGE",
                                               "GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS", "UPSCALE_VIDEO"):
                    try:
                        from agent.services.storage import get_storage
                        storage = get_storage()

                        ext = ".mp4" if "video" in req_type.lower() else ".jpg"
                        r2_key = f"requests/{rid}{ext}"

                        await crud.update_request_progress(rid, 80, "Uploading to storage")
                        r2_url = storage.upload_from_url(output_url, r2_key)
                        if r2_url:
                            await crud.update_request(rid, output_url=r2_url)
                            logger.info("R2 stored: %s → %s", rid[:8], r2_url[:60])
                    except Exception as e:
                        logger.warning("R2 upload failed (non-fatal): %s", e)

                await crud.update_request_progress(rid, 100, "Complete")
                await event_bus.emit("request_update", {"id": rid, "status": "COMPLETED"})
                logger.info("Request %s COMPLETED: media=%s", rid[:8], gen_result.media_id[:20] if gen_result.media_id else "?")
                # Clean up retry tracking on success
                get_worker_controller()._account_retry_attempts.pop(rid, None)
        except Exception as e:
            logger.exception("Request %s exception: %s", rid[:8], e)
            await event_bus.emit("request_update", {"id": rid, "status": "FAILED", "error": str(e)})
            await _handle_failure(rid, req, {"error": str(e)}, retry_after)
    finally:
        # Release account when done
        if account_id:
            await release_account(account_id)


async def _dispatch(req: dict, orientation: str) -> dict:
    """Route request to the appropriate OperationService method."""
    from agent.sdk.services.operations import get_operations
    ops = get_operations()
    req_type, rid = req["type"], req["id"]
    pid = req.get("project_id", "0")

    # Scene-based operations
    if req_type in ("GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE",
                    "GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS", "UPSCALE_VIDEO"):
        scene = await crud.get_scene(req.get("scene_id"))
        if not scene:
            if req_type == "GENERATE_IMAGE" and req.get("payload_json"):
                payload = json.loads(req["payload_json"])
                # Use the request's resolved project_id (may have been auto-created)
                if req.get("project_id"):
                    payload["project_id"] = req["project_id"]
                model_name = await get_default_model("generate_image")
                return await get_flow_client().generate_images(
                    **payload,
                    model_name=model_name,
                )
            if req_type == "EDIT_IMAGE" and req.get("payload_json"):
                payload = json.loads(req["payload_json"])
                source_url = payload.get("source_url")
                if source_url:
                    return await _edit_image_from_url(
                        source_url,
                        payload.get("prompt", ""),
                        pid,
                        payload.get("aspect_ratio", "IMAGE_ASPECT_RATIO_PORTRAIT"),
                        payload.get("user_paygate_tier", "PAYGATE_TIER_ONE"),
                        rid=rid,
                    )
            return {"error": "Scene not found"}
        scene["_project_id"] = pid

        if req_type in ("GENERATE_IMAGE", "REGENERATE_IMAGE"):
            return await ops.generate_scene_image(scene, orientation)
        if req_type == "EDIT_IMAGE":
            return await ops.edit_scene_image(scene, orientation, source_media_id=req.get("source_media_id"))
        if req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO"):
            return await ops.generate_scene_video(scene, orientation, request_id=rid)
        if req_type == "GENERATE_VIDEO_REFS":
            return await ops.generate_scene_video_refs(scene, orientation, request_id=rid)
        if req_type == "UPSCALE_VIDEO":
            return await ops.upscale_scene_video(scene, orientation, request_id=rid)

    # Character operations
    if req_type in ("GENERATE_CHARACTER_IMAGE", "REGENERATE_CHARACTER_IMAGE", "EDIT_CHARACTER_IMAGE"):
        char = await crud.get_character(req.get("character_id"))
        if not char:
            return {"error": "Character not found"}
        if req_type == "REGENERATE_CHARACTER_IMAGE":
            # Clear existing media so generate_reference_image takes the normal (not fast) path
            await crud.update_character(char["id"], media_id=None, reference_image_url=None)
            char["media_id"] = None
            char["reference_image_url"] = None
            return await ops.generate_reference_image(char, pid)
        if req_type == "EDIT_CHARACTER_IMAGE":
            src = req.get("source_media_id") or char.get("media_id")
            if not src:
                return {"error": "No source image to edit — generate a reference image first"}
            edit_prompt = char.get("image_prompt") or char.get("description", "")
            project = await crud.get_project(pid) if pid != "0" else None
            tier = project.get("user_paygate_tier", "PAYGATE_TIER_ONE") if project else "PAYGATE_TIER_ONE"
            aspect = "IMAGE_ASPECT_RATIO_LANDSCAPE" if char.get("entity_type") in ("location",) else "IMAGE_ASPECT_RATIO_PORTRAIT"
            return await ops._client.edit_image(
                prompt=edit_prompt, source_media_id=src,
                project_id=pid, aspect_ratio=aspect,
                user_paygate_tier=tier,
                model_name=await get_default_model("edit_image"),
            )
        return await ops.generate_reference_image(char, pid)

    return {"error": f"Unknown request type: {req_type}"}


async def _reupload_media(url: str, project_id: str) -> str | None:
    """Download image from URL and re-upload to get a fresh media_id."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    logger.warning("Re-upload: failed to download %s (status %d)", url[:60], resp.status)
                    return None
                image_bytes = await resp.read()
                content_type = resp.headers.get("Content-Type", "image/jpeg")

        if not content_type.startswith("image/"):
            logger.warning("Re-upload: unexpected content-type %s from %s", content_type, url[:60])
            return None
        image_b64 = base64.b64encode(image_bytes).decode()
        mime = content_type.split(";")[0].strip()

        client = get_flow_client()
        result = await client.upload_image(image_b64, mime_type=mime, project_id=project_id)
        new_mid = result.get("_mediaId")
        if new_mid:
            logger.info("Re-upload OK: fresh media_id=%s", new_mid[:20])
            return new_mid
        logger.warning("Re-upload: no media_id in response: %s", str(result)[:200])
    except Exception as e:
        logger.warning("Re-upload failed: %s", e)
    return None


async def _edit_image_from_url(source_url: str, prompt: str, project_id: str,
                                aspect_ratio: str = "IMAGE_ASPECT_RATIO_PORTRAIT",
                                user_paygate_tier: str = "PAYGATE_TIER_ONE",
                                rid: str = None) -> dict:
    """Download image from URL, upload to Google Flow, then edit."""
    import httpx as _httpx

    try:
        if rid:
            await crud.update_request_progress(rid, 30, "Downloading source image")
        async with _httpx.AsyncClient(timeout=60, follow_redirects=True) as hc:
            resp = await hc.get(source_url)
            resp.raise_for_status()
            image_bytes = resp.content
    except Exception as e:
        return {"error": f"Failed to download source image: {e}"}

    content_type = resp.headers.get("content-type", "image/jpeg")
    mime = content_type.split(";")[0].strip()
    image_b64 = base64.b64encode(image_bytes).decode()

    client = get_flow_client()
    if rid:
        await crud.update_request_progress(rid, 50, "Uploading to Google Flow")
    upload_result = await client.upload_image(image_b64, mime_type=mime, project_id=project_id)
    if upload_result.get("error"):
        return {"error": f"Upload failed: {upload_result['error']}"}

    source_media_id = upload_result.get("_mediaId")
    if not source_media_id:
        return {"error": "No media_id in upload response"}

    model_name = await get_default_model("edit_image")
    if rid:
        await crud.update_request_progress(rid, 60, "Editing image")
    return await client.edit_image(
        prompt, source_media_id, project_id,
        aspect_ratio=aspect_ratio,
        user_paygate_tier=user_paygate_tier,
        model_name=model_name,
    )


async def _recover_entity_not_found(req: dict) -> bool:
    """When Google returns 'entity not found', re-upload the image to get a fresh media_id."""
    req_type = req.get("type", "")
    pid = req.get("project_id", "")
    orientation = await _resolve_orientation(req)
    prefix = "vertical" if orientation == "VERTICAL" else "horizontal"

    # Scene-based requests: re-upload scene image
    if req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS", "UPSCALE_VIDEO"):
        scene = await crud.get_scene(req.get("scene_id"))
        if not scene:
            return False
        url = scene.get(f"{prefix}_image_url")
        if not url:
            return False
        new_mid = await _reupload_media(url, pid)
        if new_mid:
            await crud.update_scene(scene["id"], **{f"{prefix}_image_media_id": new_mid})
            logger.info("Recovered scene %s: new %s_image_media_id=%s", scene["id"][:12], prefix, new_mid[:12])
            return True

    # Character-based requests: re-upload ref image
    if req_type in ("EDIT_CHARACTER_IMAGE",):
        char = await crud.get_character(req.get("character_id"))
        if not char:
            return False
        url = char.get("reference_image_url")
        if not url:
            return False
        new_mid = await _reupload_media(url, pid)
        if new_mid:
            await crud.update_character(char["id"], media_id=new_mid)
            logger.info("Recovered character %s: new media_id=%s", char["id"][:12], new_mid[:12])
            return True

    return False


async def _handle_failure(rid: str, req: dict, result: dict, retry_after: dict = None):
    error_msg = result.get("error")
    if not error_msg:
        data = result.get("data", {})
        if isinstance(data, dict):
            ef = data.get("error", "Unknown error")
            if isinstance(ef, dict):
                error_msg = ef.get("message", json.dumps(ef)[:200])
                # Extract detailed reason from error details (e.g. PUBLIC_ERROR_UNSAFE_GENERATION)
                details = ef.get("details", [])
                if details and isinstance(details, list):
                    for d in details:
                        reason = d.get("reason") if isinstance(d, dict) else None
                        if reason:
                            error_msg = f"{error_msg} [{reason}]"
                            break
            else:
                error_msg = str(ef)
        else:
            error_msg = "Unknown error"
    if isinstance(error_msg, dict):
        error_msg = json.dumps(error_msg)[:200]

    # Auto-recover expired media by re-uploading
    if "not found" in str(error_msg).lower():
        recovered = await _recover_entity_not_found(req)
        if recovered:
            logger.info("Request %s: recovered expired media, retrying", rid[:8])
            await crud.update_request(rid, status="PENDING", error_message=f"recovered: {error_msg}")
            return

    error_lower = str(error_msg).lower()

    # WS transient errors (extension disconnect/reconnect): retry without incrementing count
    if "extension reconnected" in error_lower or "extension disconnected" in error_lower or "extension not connected" in error_lower:
        await crud.update_request(rid, status="PENDING", error_message=str(error_msg))
        logger.info("Request %s transient WS error, will retry (no retry increment): %s", rid[:8], error_msg)
        return

    # reCAPTCHA errors: retry up to 10 times — deferred dict in main loop handles delay
    if "captcha" in error_lower or "recaptcha" in error_lower:
        retry = req.get("retry_count", 0) + 1
        if retry < 10:
            await crud.update_request(rid, status="PENDING", retry_count=retry, error_message=str(error_msg))
            logger.warning("Request %s reCAPTCHA failed (retry %d/10), will retry", rid[:8], retry)
            return
        else:
            await crud.update_request(rid, status="FAILED", error_message=str(error_msg))
            await _mark_scene_failed(req)
            logger.error("Request %s FAILED after 10 reCAPTCHA retries: %s", rid[:8], error_msg)
            return

    retry = req.get("retry_count", 0) + 1
    if retry < MAX_RETRIES:
        now = time.time()
        if retry_after is not None:
            ra = retry_after.get(rid, 0.0)
            if ra > now:
                # Still in backoff — reset to PENDING so it's not stuck in PROCESSING
                await crud.update_request(rid, status="PENDING", error_message=str(error_msg))
                return
            retry_after[rid] = now + min(2 ** retry * 10, 300)
        await crud.update_request(rid, status="PENDING", retry_count=retry, error_message=str(error_msg))
        logger.warning("Request %s failed (retry %d/%d): %s", rid[:8], retry, MAX_RETRIES, error_msg)
    else:
        await crud.update_request(rid, status="FAILED", error_message=str(error_msg))
        await _mark_scene_failed(req)
        logger.error("Request %s FAILED permanently: %s", rid[:8], error_msg)


async def _mark_scene_failed(req: dict):
    scene_id = req.get("scene_id")
    if not scene_id:
        return
    orientation = await _resolve_orientation(req)
    prefix = "vertical" if orientation == "VERTICAL" else "horizontal"
    req_type = req["type"]
    updates = {}
    if req_type in ("GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE"):
        updates[f"{prefix}_image_status"] = "FAILED"
    elif req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS"):
        updates[f"{prefix}_video_status"] = "FAILED"
    elif req_type == "UPSCALE_VIDEO":
        updates[f"{prefix}_upscale_status"] = "FAILED"
    if updates:
        await crud.update_scene(scene_id, **updates)


async def _is_already_completed(req: dict, orientation: str) -> bool:
    scene_id = req.get("scene_id")
    req_type = req.get("type", "")
    if not scene_id or req_type == "GENERATE_CHARACTER_IMAGE":
        return False
    scene = await crud.get_scene(scene_id)
    if not scene:
        return False
    prefix = "vertical" if orientation == "VERTICAL" else "horizontal"
    if req_type in ("EDIT_IMAGE", "REGENERATE_IMAGE", "REGENERATE_VIDEO", "REGENERATE_CHARACTER_IMAGE", "EDIT_CHARACTER_IMAGE"):
        return False  # Always run — explicitly requesting new generation
    if req_type == "GENERATE_IMAGE":
        return scene.get(f"{prefix}_image_status") == "COMPLETED"
    if req_type in ("GENERATE_VIDEO", "GENERATE_VIDEO_REFS"):
        return scene.get(f"{prefix}_video_status") == "COMPLETED"
    if req_type == "UPSCALE_VIDEO":
        return scene.get(f"{prefix}_upscale_status") == "COMPLETED"
    return False


# ─── Module-level controller ──────────────────────────────────

_controller: WorkerController | None = None


def get_worker_controller() -> WorkerController:
    global _controller
    if _controller is None:
        _controller = WorkerController()
    return _controller
