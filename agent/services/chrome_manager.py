"""Chrome Manager — manages Chrome profiles via CDP (no extension needed).

Uses undetected-chromedriver + Chrome DevTools Protocol to:
1. Launch Chrome with fresh profile
2. Inject cookies for authentication
3. Navigate to sites and process requests
4. Clean up after job completion
"""
import asyncio
import json
import logging
import os
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from agent.config import (
    CHROME_MANAGER_MAX_PROFILES,
    CHROME_MANAGER_PROFILE_DIR,
)
from agent.db.schema import get_db, _db_lock

logger = logging.getLogger(__name__)


@dataclass
class ChromeSession:
    session_id: str
    account_id: str
    site: str
    profile_dir: str
    pid: Optional[int] = None
    status: str = "STARTING"
    cdp_session: object = None  # CDPSession from cdp_client


class ChromeManager:
    """Manages ephemeral Chrome profiles via CDP.

    Each profile is a fresh Chrome instance that:
    1. Launches via undetected-chromedriver
    2. Gets cookies injected via CDP
    3. Navigates to the target site
    4. Processes the job
    5. Gets killed and cleaned up
    """

    def __init__(self):
        self._sessions: dict[str, ChromeSession] = {}
        self._lock = asyncio.Lock()
        CHROME_MANAGER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def active_count(self) -> int:
        return len(self._sessions)

    @property
    def has_capacity(self) -> bool:
        return self.active_count < CHROME_MANAGER_MAX_PROFILES

    async def get_active_sessions(self) -> list[ChromeSession]:
        async with self._lock:
            return list(self._sessions.values())

    async def launch(self, account_id: str, site: str) -> ChromeSession:
        """Launch a new Chrome profile via CDP.

        Returns a ChromeSession with CDP access for cookie injection and API calls.
        """
        from agent.services.cdp_client import get_cdp_client

        async with self._lock:
            if not self.has_capacity:
                raise RuntimeError(
                    f"Max Chrome profiles reached ({CHROME_MANAGER_MAX_PROFILES}). "
                    f"Active: {self.active_count}"
                )

            session_id = str(uuid.uuid4())
            profile_dir = str(CHROME_MANAGER_PROFILE_DIR / session_id)
            os.makedirs(profile_dir, exist_ok=True)

            session = ChromeSession(
                session_id=session_id,
                account_id=account_id,
                site=site,
                profile_dir=profile_dir,
            )

            try:
                cdp = get_cdp_client()
                cdp_session = await cdp.launch(account_id, site, profile_dir)

                session.pid = cdp_session.pid
                session.cdp_session = cdp_session
                session.status = "ACTIVE"

                # Store in DB
                await self._store_profile_db(session)

                self._sessions[session_id] = session
                logger.info("Chrome launched via CDP: pid=%d, session=%s",
                           session.pid, session_id[:8])

                return session

            except Exception as e:
                session.status = "FAILED"
                logger.error("Failed to launch Chrome: %s", e)
                if os.path.exists(profile_dir):
                    shutil.rmtree(profile_dir, ignore_errors=True)
                raise

    async def close(self, session_id: str):
        """Close a Chrome session and clean up."""
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            if not session:
                return

            session.status = "CLOSING"

            if session.cdp_session:
                from agent.services.cdp_client import get_cdp_client
                try:
                    cdp = get_cdp_client()
                    await cdp.close(session_id)
                except Exception as e:
                    logger.warning("Error closing CDP session: %s", e)

            # Clean up profile directory
            if os.path.exists(session.profile_dir):
                try:
                    shutil.rmtree(session.profile_dir, ignore_errors=True)
                except Exception:
                    pass

            await self._close_profile_db(session_id)
            logger.info("Chrome closed: session=%s", session_id[:8])

    async def close_all(self):
        """Close all active Chrome sessions."""
        from agent.services.cdp_client import get_cdp_client
        cdp = get_cdp_client()
        await cdp.close_all()

        session_ids = list(self._sessions.keys())
        for sid in session_ids:
            session = self._sessions.pop(sid, None)
            if session and os.path.exists(session.profile_dir):
                try:
                    shutil.rmtree(session.profile_dir, ignore_errors=True)
                except Exception:
                    pass
                await self._close_profile_db(sid)

    async def inject_cookies(self, session: ChromeSession, cookies: list[dict], site: str) -> dict:
        """Inject cookies into the Chrome profile via CDP."""
        if not session.cdp_session:
            return {"success": False, "error": "No CDP session"}

        from agent.services.cdp_client import get_cdp_client
        cdp = get_cdp_client()
        return await cdp.inject_cookies(session.cdp_session, cookies, site)

    async def navigate(self, session: ChromeSession, url: str):
        """Navigate Chrome to a URL."""
        if not session.cdp_session:
            raise RuntimeError("No CDP session")

        from agent.services.cdp_client import get_cdp_client
        cdp = get_cdp_client()
        await cdp.navigate(session.cdp_session, url)

    async def api_request(self, session: ChromeSession, url: str, method: str = "POST",
                          headers: dict = None, body: dict = None) -> dict:
        """Make an API request through the browser context."""
        if not session.cdp_session:
            return {"error": "No CDP session"}

        from agent.services.cdp_client import get_cdp_client
        cdp = get_cdp_client()
        return await cdp.api_request(session.cdp_session, url, method, headers, body)

    async def _store_profile_db(self, session: ChromeSession):
        db = await get_db()
        now = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        async with _db_lock:
            await db.execute(
                "INSERT INTO chrome_profile (id, account_id, site, profile_dir, pid, status, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (session.session_id, session.account_id, session.site,
                 session.profile_dir, session.pid, session.status, now))
            await db.commit()

    async def _close_profile_db(self, session_id: str):
        db = await get_db()
        now = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        async with _db_lock:
            await db.execute(
                "UPDATE chrome_profile SET status='CLOSED', closed_at=? WHERE id=?",
                (now, session_id))
            await db.commit()


# Singleton
_manager: Optional[ChromeManager] = None


def get_chrome_manager() -> ChromeManager:
    global _manager
    if _manager is None:
        _manager = ChromeManager()
    return _manager
