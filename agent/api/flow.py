"""Direct Flow API endpoints — for manual operations outside the queue."""
import asyncio
import json
import logging
import time
from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel
from typing import Optional
from agent.services.flow_client import get_flow_client
from agent.services import redis_queue
from agent.api.accounts import try_acquire_account, release_account

# Serializes ensure_fresh_session so two accounts don't fight over client._flow_key
_session_lock = asyncio.Lock()
from agent.api.defaults import get_default_model
from agent.config import IMAGE_MODELS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/flow", tags=["flow"])


async def _validate_project_id(pid: str) -> str | None:
    """Return pid if it exists in the project table, else None."""
    if not pid:
        return None
    from agent.db.schema import get_db
    db = await get_db()
    cur = await db.execute("SELECT 1 FROM project WHERE id=?", (pid,))
    return pid if await cur.fetchone() else None


class GenerateImageRequest(BaseModel):
    prompt: str
    project_id: str
    aspect_ratio: str = "IMAGE_ASPECT_RATIO_PORTRAIT"
    user_paygate_tier: str = "PAYGATE_TIER_ONE"
    character_media_ids: Optional[list[str]] = None
    queue: bool = True  # If True, queue when busy; if False, wait


class GenerateVideoRequest(BaseModel):
    start_image_media_id: str
    prompt: str
    project_id: str
    scene_id: str
    aspect_ratio: str = "VIDEO_ASPECT_RATIO_PORTRAIT"
    end_image_media_id: Optional[str] = None
    user_paygate_tier: str = "PAYGATE_TIER_ONE"


class GenerateVideoRefsRequest(BaseModel):
    reference_media_ids: list[str]
    prompt: str
    project_id: str
    scene_id: str
    aspect_ratio: str = "VIDEO_ASPECT_RATIO_PORTRAIT"
    user_paygate_tier: str = "PAYGATE_TIER_ONE"


class UpscaleVideoRequest(BaseModel):
    media_id: str
    scene_id: str
    aspect_ratio: str = "VIDEO_ASPECT_RATIO_PORTRAIT"
    resolution: str = "VIDEO_RESOLUTION_4K"


class UploadImageRequest(BaseModel):
    file_path: str  # absolute path to local image file
    project_id: str = ""
    file_name: str = "image.png"


class CheckStatusRequest(BaseModel):
    operations: list[dict]


class EditImageRequest(BaseModel):
    prompt: str
    source_media_id: str
    project_id: str
    aspect_ratio: str = "IMAGE_ASPECT_RATIO_PORTRAIT"
    user_paygate_tier: str = "PAYGATE_TIER_ONE"


async def ensure_fresh_session(account: dict, timeout: float = 30.0, max_attempts: int = 2) -> bool:
    """Inject account cookies into Chrome and wait for flowKey capture with retry.

    Called after every account selection to guarantee fresh auth.
    Each account MUST use its own Chrome session — never share across accounts.
    Uses a lock so concurrent calls from different accounts serialize.

    Enhanced with:
    - Extended timeout (30s default)
    - Multi-attempt retry (2 attempts default)
    - Explicit WS health validation

    Per-account flow key tracking:
    - Stores account_id → flowKey mapping in client._account_flow_keys
    - Stores flowKey → WebSocket mapping in client._flow_key_ws
    - _send() uses these mappings to route commands to the correct Chrome

    Returns True if flowKey captured and validated, False after all attempts fail.
    """
    async with _session_lock:
        client = get_flow_client()

        account_id = account.get("id")

        # Check if this account already has a valid stored token
        existing_key = client.get_account_flow_key(account_id)
        if existing_key:
            ws = client.get_ws_for_flow_key(existing_key)
            if ws and ws in client._extension_ws_set:
                # Validate WS is healthy AND token is not too old
                try:
                    await asyncio.wait_for(ws.ping(), timeout=2.0)
                    
                    # Check token age (tokens expire after ~30 minutes)
                    # Force re-injection if token is older than 20 minutes
                    token_age_threshold = 1200  # 20 minutes in seconds
                    if hasattr(client, '_account_flow_key_timestamps'):
                        token_timestamp = client._account_flow_key_timestamps.get(account_id, 0)
                        token_age = time.time() - token_timestamp
                        if token_age > token_age_threshold:
                            logger.info("ensure_fresh_session: token too old (%.0f minutes) for account %s, re-injecting",
                                         token_age / 60, account.get("name", account_id[:8]))
                        else:
                            logger.info("ensure_fresh_session: reusing stored flow_key for account %s (age=%.0f minutes)",
                                         account.get("name", account_id[:8]), token_age / 60)
                            return True
                    else:
                        # No timestamp tracking yet, assume fresh enough
                        logger.info("ensure_fresh_session: reusing stored flow_key for account %s",
                                     account.get("name", account_id[:8]))
                        return True
                except:
                    logger.info("ensure_fresh_session: stored flow_key WS unhealthy for account %s, re-capturing",
                                 account.get("name", account_id[:8]))
            else:
                # WS disconnected — need to re-capture
                logger.info("ensure_fresh_session: stored flow_key ws gone for account %s, re-capturing",
                             account.get("name", account_id[:8]))

        from agent.services.cdp_client import get_cdp_client, CDPDriver, CDPSession, MaxProfilesError
        cdp = get_cdp_client()

        # CRITICAL: Get session for THIS account only — never share across accounts
        session = cdp._get_running_session(account_id=account_id)

        # If no session for THIS account, try to reassign the "default" session
        if not session:
            default_session = cdp._get_running_session(account_id="default")
            if default_session:
                default_session.account_id = account_id
                session = default_session
                logger.info("Reassigned default Chrome (pid=%s) to account %s", session.pid, account_id[:8])

        # If still no session, launch a new Chrome instance
        if not session:
            try:
                from agent.config import CHROME_MANAGER_MAX_PROFILES
                if cdp.active_count >= CHROME_MANAGER_MAX_PROFILES:
                    logger.warning("ensure_fresh_session: max profiles reached (%d/%d) for account %s",
                                   cdp.active_count, CHROME_MANAGER_MAX_PROFILES, account_id[:8])
                    return False
                session, _ = await cdp.ensure_chrome(account_id, account.get("site", "labs.google"))
                logger.info("Launched new Chrome for account %s (pid=%s)", account.get("name", account_id[:8]), session.pid)
            except MaxProfilesError:
                logger.warning("ensure_fresh_session: MaxProfilesError for account %s", account_id[:8])
                return False
            except Exception as e:
                logger.warning("ensure_fresh_session: Chrome launch failed for account %s: %s", account_id[:8], e)
                return False

        if not session or not session.driver:
            return False

        cookies = json.loads(account.get("cookies", "[]"))
        if not cookies:
            logger.warning("ensure_fresh_session: account %s has no cookies", account.get("name", account_id[:8]))
            return False

        # Multi-attempt retry loop
        for attempt in range(max_attempts):
            try:
                flow_url = "https://labs.google/fx/tools/flow"

                # Navigate to Flow FIRST (site must be loaded before cookies can be set)
                await asyncio.wait_for(
                    asyncio.to_thread(
                        lambda: session.driver.execute_cdp_cmd(
                            "Page.navigate", {"url": flow_url}
                        )
                    ),
                    timeout=10,
                )
                await asyncio.sleep(3)

                # NOW inject cookies AFTER the site is loaded
                await cdp.inject_cookies(session, cookies, "labs.google")
                logger.info("Injecting %d cookies for labs.google into account %s session (attempt %d/%d)",
                             len(cookies), account.get("name", account_id[:8]), attempt + 1, max_attempts)

                # Force a fresh page load to activate the cookies
                await asyncio.wait_for(
                    asyncio.to_thread(
                        lambda: session.driver.execute_cdp_cmd(
                            "Page.reload", {"ignoreCache": True}
                        )
                    ),
                    timeout=10,
                )
                await asyncio.sleep(3)

                # Wait for flowKey with extended timeout
                # Chrome extensions send cached token on connect, so _flow_key may
                # already be set. We need to confirm it's usable.
                for _ in range(int(timeout * 2)):
                    if client._flow_key:
                        # Check if the WS that captured this token is still connected
                        ws = client.get_ws_for_flow_key(client._flow_key)
                        if ws and ws in client._extension_ws_set:
                            # EXPLICIT VALIDATION: Verify WS is healthy
                            try:
                                await asyncio.wait_for(ws.ping(), timeout=2.0)
                            except Exception as ping_err:
                                logger.warning("flowKey WS ping failed for account %s: %s", 
                                               account.get("name", account_id[:8]), ping_err)
                                await asyncio.sleep(0.5)
                                continue
                            
                            client.store_account_flow_key(account_id, client._flow_key)
                            logger.info("✅ Cookie injection SUCCESS: account=%s key=%s... (attempt %d/%d)",
                                         account.get("name", account_id[:8]), 
                                         client._flow_key[:12], 
                                         attempt + 1, max_attempts)
                            return True
                        # Token exists but WS is gone — wait for new token
                    await asyncio.sleep(0.5)

                # This attempt timed out
                if attempt < max_attempts - 1:
                    logger.warning("Cookie injection attempt %d/%d timed out for account %s, retrying in 5s...", 
                                   attempt + 1, max_attempts, account.get("name", account_id[:8]))
                    await asyncio.sleep(5)
                    # Force page reload for retry
                    if session and session.driver:
                        await asyncio.wait_for(
                            asyncio.to_thread(
                                lambda: session.driver.execute_cdp_cmd("Page.reload", {"ignoreCache": True})
                            ),
                            timeout=10,
                        )
                        await asyncio.sleep(2)

            except Exception as e:
                if attempt < max_attempts - 1:
                    logger.warning("ensure_fresh_session attempt %d/%d failed for account %s: %s, retrying...", 
                                   attempt + 1, max_attempts, account.get("name", account_id[:8]), e)
                    await asyncio.sleep(5)
                else:
                    logger.error("ensure_fresh_session failed for account %s after %d attempts: %s", 
                                 account.get("name", account_id[:8]), max_attempts, e)

        logger.error("❌ Cookie injection FAILED after %d attempts for account %s", 
                     max_attempts, account.get("name", account_id[:8]))
        return False


async def _ensure_chrome_and_queue(request_data: dict, model_name: str = None) -> dict:
    """Queue the request. Chrome is launched by the worker for the correct account."""
    from agent.db import crud

    # Create a real DB request so the worker can pick it up
    req = await crud.create_request(
        "GENERATE_IMAGE",
        project_id=await _validate_project_id(request_data.get("project_id")),
        payload_json=json.dumps(request_data),
    )
    await crud.update_request(req["id"], status="PENDING")
    position = await redis_queue.enqueue(req["id"], model_name or "default")

    return {
        "queued": True,
        "request_id": req["id"],
        "position": position,
        "model": model_name,
        "message": "Request queued. Chrome will launch when a profile slot is available.",
    }


@router.get("/status")
async def extension_status():
    """Check if extension is connected."""
    client = get_flow_client()
    return {
        "connected": client.connected,
        "flow_key_present": client._flow_key is not None,
    }


@router.get("/credits")
async def get_credits():
    """Get user credits from Google Flow."""
    client = get_flow_client()
    if not client.connected:
        raise HTTPException(503, "Extension not connected")
    result = await client.get_credits()
    if result.get("error"):
        raise HTTPException(502, result["error"])
    return result.get("data", result)


@router.post("/generate-image")
async def generate_image(body: GenerateImageRequest):
    """Generate image via Chrome extension bridge."""
    client = get_flow_client()
    model_name = await get_default_model("generate_image")
    account_model = IMAGE_MODELS.get(model_name, model_name)

    # If extension not connected, launch Chrome and queue request
    if not client.connected:
        if body.queue:
            return await _ensure_chrome_and_queue(
                body.model_dump(exclude={"queue"}),
                model_name=account_model,
            )
        raise HTTPException(503, "Extension not connected. Use queue=true to auto-launch Chrome.")

    # When queue=True, always queue to Redis — worker handles auth + generation
    if body.queue:
        from agent.db import crud
        req = await crud.create_request(
            "GENERATE_IMAGE",
            project_id=await _validate_project_id(body.project_id),
            payload_json=json.dumps(body.model_dump(exclude={"queue"})),
        )
        await crud.update_request(req["id"], status="PENDING")
        position = await redis_queue.enqueue(req["id"], account_model)
        return {
            "queued": True,
            "request_id": req["id"],
            "position": position,
            "model": model_name,
            "message": "Request queued. Will process when extension is ready.",
        }

    # Non-queued mode: atomically find + acquire account, do auth, generate inline
    account = None
    account_id = None

    try:
        account = await try_acquire_account(account_model, project_id=body.project_id)
        if account:
            account_id = account["id"]
            logger.info("generate-image acquired account=%s (%s) project=%s", account.get("name", "?"), account_id[:8], body.project_id[:8] if body.project_id else "none")
        else:
            raise HTTPException(429, f"No free accounts for model '{model_name}'")

        # Ensure cookies are injected and flowKey is fresh
        if not await ensure_fresh_session(account):
            raise HTTPException(503, "Failed to capture auth token. Chrome may need cookies. Try again.")

        result = await client.generate_images(**body.model_dump(exclude={"queue"}), model_name=model_name)
        if result.get("error") or (isinstance(result.get("status"), int) and result["status"] >= 400):
            raise HTTPException(result.get("status", 502), result.get("error", result.get("data")))
        return result.get("data", result)

    finally:
        if account_id:
            await release_account(account_id)


@router.post("/generate-video")
async def generate_video(body: GenerateVideoRequest):
    """Submit video generation via Redis queue."""
    client = get_flow_client()
    if not client.connected:
        return await _ensure_chrome_and_queue(
            body.model_dump(exclude_none=True),
            model_name=await get_default_model("generate_video"),
        )
    video_model_key = await get_default_model("generate_video")
    from agent.db import crud
    req = await crud.create_request(
        "GENERATE_VIDEO",
        scene_id=body.scene_id,
        project_id=await _validate_project_id(body.project_id),
        video_id=body.video_id,
        orientation=body.aspect_ratio,
        payload_json=json.dumps(body.model_dump(exclude_none=True)),
    )
    await crud.update_request(req["id"], status="PENDING")
    position = await redis_queue.enqueue(req["id"], video_model_key)
    return {"queued": True, "request_id": req["id"], "position": position, "message": "Video generation queued."}


@router.post("/generate-video-refs")
async def generate_video_refs(body: GenerateVideoRefsRequest):
    """Submit r2v video generation via Redis queue."""
    client = get_flow_client()
    if not client.connected:
        return await _ensure_chrome_and_queue(
            body.model_dump(),
            model_name=await get_default_model("generate_video_refs"),
        )
    video_model_key = await get_default_model("generate_video_refs")
    from agent.db import crud
    req = await crud.create_request(
        "GENERATE_VIDEO_REFS",
        scene_id=body.scene_id,
        project_id=await _validate_project_id(body.project_id),
        video_id=body.video_id,
        orientation=body.aspect_ratio,
        payload_json=json.dumps(body.model_dump()),
    )
    await crud.update_request(req["id"], status="PENDING")
    position = await redis_queue.enqueue(req["id"], video_model_key)
    return {"queued": True, "request_id": req["id"], "position": position, "message": "Reference video queued."}


@router.post("/upscale-video")
async def upscale_video(body: UpscaleVideoRequest):
    """Submit video upscale via Redis queue."""
    client = get_flow_client()
    if not client.connected:
        return await _ensure_chrome_and_queue(
            body.model_dump(),
            model_name=await get_default_model("upscale_video"),
        )
    upscale_model_key = await get_default_model("upscale_video")
    from agent.db import crud
    req = await crud.create_request(
        "UPSCALE_VIDEO",
        scene_id=body.scene_id,
        project_id=body.project_id,
        orientation=body.aspect_ratio,
        payload_json=json.dumps(body.model_dump()),
    )
    await crud.update_request(req["id"], status="PENDING")
    position = await redis_queue.enqueue(req["id"], upscale_model_key)
    return {"queued": True, "request_id": req["id"], "position": position, "message": "Upscale queued."}


@router.post("/check-status")
async def check_status(body: CheckStatusRequest):
    """Check video generation status."""
    client = get_flow_client()
    if not client.connected:
        raise HTTPException(503, "Extension not connected")
    result = await client.check_video_status(body.operations)
    if result.get("error"):
        raise HTTPException(502, result["error"])
    return result.get("data", result)


@router.post("/refresh-urls/{project_id}")
async def refresh_project_urls(project_id: str):
    """Bulk refresh all media URLs for a project via per-media get_media calls."""
    client = get_flow_client()
    if not client.connected:
        raise HTTPException(503, "Extension not connected")
    result = await client.refresh_project_urls(project_id)
    if result.get("error"):
        raise HTTPException(502, result["error"])
    return result


@router.get("/media/{media_id}")
async def get_media(media_id: str):
    """Get media metadata + fresh signed URL from Google Flow.

    Returns the raw response which should contain a fresh fifeUrl/servingUri.
    Use this to refresh expired GCS signed URLs.
    """
    client = get_flow_client()
    if not client.connected:
        raise HTTPException(503, "Extension not connected")
    result = await client.get_media(media_id)
    if result.get("error"):
        raise HTTPException(502, result["error"])
    status = result.get("status", 200)
    if isinstance(status, int) and status >= 400:
        raise HTTPException(status, result.get("data", "Media not found"))
    return result.get("data", result)


@router.post("/edit-image")
async def edit_image(body: EditImageRequest):
    """Edit an existing image using IMAGE_INPUT_TYPE_BASE_IMAGE."""
    client = get_flow_client()
    if not client.connected:
        raise HTTPException(503, "Extension not connected")
    model_name = await get_default_model("edit_image")
    result = await client.edit_image(
        body.prompt, body.source_media_id, body.project_id,
        aspect_ratio=body.aspect_ratio,
        user_paygate_tier=body.user_paygate_tier,
        model_name=model_name,
    )
    if result.get("error") or (isinstance(result.get("status"), int) and result["status"] >= 400):
        raise HTTPException(result.get("status", 502), result.get("error", result.get("data")))
    return result.get("data", result)


@router.post("/upload-image")
async def upload_image(body: UploadImageRequest):
    """Upload a local image file to Google Flow and get a media_id."""
    import base64, mimetypes
    client = get_flow_client()
    if not client.connected:
        raise HTTPException(503, "Extension not connected")
    try:
        with open(body.file_path, "rb") as f:
            image_bytes = f.read()
    except FileNotFoundError:
        raise HTTPException(404, f"File not found: {body.file_path}")
    b64 = base64.b64encode(image_bytes).decode()
    mime = mimetypes.guess_type(body.file_path)[0] or "image/png"
    result = await client.upload_image(b64, mime_type=mime, project_id=body.project_id, file_name=body.file_name)
    if result.get("error") or (isinstance(result.get("status"), int) and result["status"] >= 400):
        raise HTTPException(result.get("status", 502), result.get("error", result.get("data")))
    media_id = result.get("_mediaId")
    return {"media_id": media_id, "raw": result.get("data", result)}


class UploadImageURLRequest(BaseModel):
    url: str
    project_id: str = ""


@router.post("/upload-image-url")
async def upload_image_url(body: UploadImageURLRequest):
    """Download image from URL and upload to Google Flow to get a media_id."""
    import base64, mimetypes
    import httpx as _httpx

    client = get_flow_client()
    if not client.connected:
        raise HTTPException(503, "Extension not connected")

    try:
        async with _httpx.AsyncClient(timeout=60, follow_redirects=True) as hc:
            resp = await hc.get(body.url)
            resp.raise_for_status()
            image_bytes = resp.content
    except Exception as e:
        raise HTTPException(400, f"Failed to download image: {e}")

    content_type = resp.headers.get("content-type", "")
    if "video" in content_type:
        raise HTTPException(400, "URL points to a video, not an image")

    mime = content_type.split(";")[0].strip() if content_type else mimetypes.guess_type(body.url)[0] or "image/jpeg"
    b64 = base64.b64encode(image_bytes).decode()

    result = await client.upload_image(b64, mime_type=mime, project_id=body.project_id or "")
    if result.get("error") or (isinstance(result.get("status"), int) and result["status"] >= 400):
        raise HTTPException(result.get("status", 502), result.get("error", result.get("data")))

    media_id = result.get("_mediaId")
    return {"media_id": media_id}


@router.post("/upload-to-r2")
async def upload_to_r2(
    url: str = Body(..., embed=True),
    key: str = Body(None, embed=True),
):
    """Upload a file from URL to Cloudflare R2 and return the permanent URL."""
    import uuid
    from agent.services.storage import get_storage

    storage = get_storage()

    if not key:
        ext = ".mp4" if ".mp4" in url or "video" in url else ".jpg"
        key = f"uploads/{uuid.uuid4().hex}{ext}"

    permanent_url = storage.upload_from_url(url, key)

    if not permanent_url:
        raise HTTPException(status_code=500, detail="Failed to upload to R2")

    return {"url": permanent_url, "key": key}


class UploadImageBase64Request(BaseModel):
    image_base64: str  # base64-encoded image data (with or without data URI prefix)
    mime_type: str = "image/jpeg"
    project_id: str = ""


@router.post("/upload-image-base64")
async def upload_image_base64(body: UploadImageBase64Request):
    """Upload a base64-encoded image to R2 and return a permanent URL."""
    import base64
    import uuid
    from agent.services.storage import get_storage

    b64 = body.image_base64
    # Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]

    storage = get_storage()
    image_bytes = base64.b64decode(b64)
    ext = ".png" if "png" in body.mime_type else ".jpg"
    key = f"uploads/source/{uuid.uuid4().hex}{ext}"
    url = storage.upload_bytes(image_bytes, key, body.mime_type)
    return {"source_url": url}


class EditImageURLRequest(BaseModel):
    prompt: str
    source_url: str  # R2 URL of the source image
    project_id: str = "default"
    aspect_ratio: str = "IMAGE_ASPECT_RATIO_PORTRAIT"
    user_paygate_tier: str = "PAYGATE_TIER_ONE"
    queue: bool = True


@router.post("/edit-image-url")
async def edit_image_url(body: EditImageURLRequest):
    """Edit image using a URL source. Always queues for worker processing."""
    from agent.services import redis_queue
    from agent.db import crud

    req = await crud.create_request(
        "EDIT_IMAGE",
        project_id=await _validate_project_id(body.project_id),
        payload_json=json.dumps(body.model_dump(exclude={"queue"})),
    )
    await crud.update_request(req["id"], status="PENDING")

    position = await redis_queue.enqueue(req["id"], "default")
    return {
        "queued": True,
        "request_id": req["id"],
        "position": position,
        "message": "Request queued. Will process when extension connects.",
    }
