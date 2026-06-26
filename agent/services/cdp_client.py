"""CDP Client — launches Chrome for automated sessions.

Uses subprocess + Chrome DevTools Protocol to:
1. Launch Chrome with fresh profile + extension loaded via loadUnpacked
2. Inject cookies for authentication
3. Capture bearer token from network requests
4. Proxy API calls through the browser context
"""
import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import time
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Callable

from agent.config import CHROME_MANAGER_PROFILE_DIR, CHROME_MANAGER_EXTENSION_DIR, CHROME_IDLE_TIMEOUT, CHROME_BINARY, CHROME_MANAGER_MAX_PROFILES, CHROME_MANAGER_URL

logger = logging.getLogger(__name__)


class MaxProfilesError(Exception):
    """Raised when all Chrome profile slots are occupied."""
    def __init__(self, active: int):
        self.active = active
        super().__init__(f"Max Chrome profiles reached ({active}/{CHROME_MANAGER_MAX_PROFILES})")

RECAPTCHA_SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV"
EXTENSION_ID = "opdipieponnoalohmkmiajeeanaffnbe"

# Regex for Google OAuth2 bearer tokens
BEARER_TOKEN_RE = re.compile(r"Bearer (ya29\.[A-Za-z0-9_-]+)")


class CDPDriver:
    """Lightweight CDP connection wrapper replacing undetected-chromedriver."""

    def __init__(self, debugger_url: str):
        self._debugger_url = debugger_url
        self._ws = None
        self._cmd_id = 0
        self._responses: dict[int, dict] = {}
        self._lock = threading.Lock()

    def connect(self):
        import websocket
        self._ws = websocket.create_connection(self._debugger_url)

    def execute_cdp_cmd(self, method: str, params: dict = None) -> dict:
        # A CDP WebSocket is a single ordered stream. Keep the complete
        # send/receive exchange under one lock so background token polling
        # cannot consume another task's response.
        with self._lock:
            self._cmd_id += 1
            cmd_id = self._cmd_id
            msg = {"id": cmd_id, "method": method}
            if params:
                msg["params"] = params
            self._ws.send(json.dumps(msg))
            # Read until we get our response.
            while True:
                data = json.loads(self._ws.recv())
                if data.get("id") == cmd_id:
                    if "error" in data:
                        error = data["error"]
                        raise RuntimeError(
                            f"CDP {method} failed: {error.get('message', error)}"
                        )
                    return data

    def get(self, url: str):
        self.execute_cdp_cmd("Page.navigate", {"url": url})

    def close(self):
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass

    def __del__(self):
        self.close()


@dataclass
class CDPSession:
    """A Chrome session controlled via CDP."""
    session_id: str
    account_id: str
    site: str
    profile_dir: str
    pid: Optional[int] = None
    cdp_port: int = 9223
    driver: Optional[CDPDriver] = None
    bearer_token: Optional[str] = None
    token_captured_at: Optional[float] = None
    created_at: float = field(default_factory=time.time, repr=False)
    status: str = "STARTING"
    _token_event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)


class CDPClient:
    """Manages Chrome sessions via CDP with loadUnpacked (Chrome 149+ workaround)."""

    def __init__(self):
        self._sessions: dict[str, CDPSession] = {}
        self._lock = asyncio.Lock()
        self._idle_timers: dict[str, asyncio.TimerHandle] = {}
        self._idle_timeout = CHROME_IDLE_TIMEOUT
        CHROME_MANAGER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def active_count(self) -> int:
        return len(self._sessions)

    def _is_process_alive(self, pid: int) -> bool:
        """Check if a process is still running."""
        try:
            import psutil
            return psutil.pid_exists(pid)
        except Exception:
            try:
                os.kill(pid, 0)
                return True
            except (OSError, ProcessLookupError):
                return False

    def has_active_session(self, account_id: str = None) -> bool:
        """Check if Chrome is running (optionally for a specific account)."""
        if account_id:
            return any(s.account_id == account_id and s.status == "RUNNING"
                       and s.pid and self._is_process_alive(s.pid)
                       for s in self._sessions.values())
        return any(s.status == "RUNNING" and s.pid and self._is_process_alive(s.pid)
                   for s in self._sessions.values())

    def _get_running_session(self, account_id: str = None) -> Optional[CDPSession]:
        """Get the first running session (optionally for a specific account).

        Cleans up stale sessions whose Chrome process has been killed.
        """
        for sid, s in list(self._sessions.items()):
            if s.status == "RUNNING":
                if s.pid and not self._is_process_alive(s.pid):
                    # Chrome was killed externally — clean up stale session
                    logger.warning("Stale session detected (pid %d dead), cleaning up %s", s.pid, sid[:8])
                    s.status = "CLOSED"
                    self._sessions.pop(sid, None)
                    continue
                if account_id is None or s.account_id == account_id:
                    return s
        return None

    def _start_idle_timer(self, session_id: str):
        """Start/restart idle timeout timer for a session."""
        self._cancel_idle_timer(session_id)
        loop = asyncio.get_event_loop()
        handle = loop.call_later(
            self._idle_timeout,
            lambda: asyncio.create_task(self._idle_timeout_handler(session_id))
        )
        self._idle_timers[session_id] = handle
        logger.debug("Idle timer started: %ds for session %s", self._idle_timeout, session_id[:8])

    def _cancel_idle_timer(self, session_id: str):
        """Cancel idle timer for a session."""
        handle = self._idle_timers.pop(session_id, None)
        if handle:
            handle.cancel()

    def _refresh_idle_timer(self, session_id: str):
        """Refresh (restart) idle timer."""
        self._start_idle_timer(session_id)

    async def _idle_timeout_handler(self, session_id: str):
        """Called after idle timeout — closes Chrome."""
        logger.info("Chrome idle timeout reached, closing session %s", session_id[:8])
        await self.close(session_id)

    async def ensure_chrome(self, account_id: str = "default", site: str = "labs.google") -> tuple[CDPSession, bool]:
        """Ensure Chrome is running. Returns (session, was_newly_launched).

        If Chrome is already running, refreshes idle timer and returns existing session.
        If not, launches a new Chrome instance.
        """
        async with self._lock:
            existing = self._get_running_session(account_id)
            if existing:
                self._refresh_idle_timer(existing.session_id)
                return existing, False

            # Enforce max profiles — different account needs a new Chrome instance
            if self.active_count >= CHROME_MANAGER_MAX_PROFILES:
                raise MaxProfilesError(self.active_count)

            # Launch exactly one Chrome instance even when the route and worker
            # discover the same cold-start request concurrently.
            profile_dir = str(CHROME_MANAGER_PROFILE_DIR / f"auto_{account_id}_{int(time.time())}")
            session = await self.launch(account_id, site, profile_dir)
            self._start_idle_timer(session.session_id)
            return session, True

    async def launch(self, account_id: str, site: str, profile_dir: str) -> CDPSession:
        """Launch Chrome for Testing with --load-extension (no dialog needed).

        When CHROME_MANAGER_URL is set, delegates to the Chrome Manager API
        instead of launching Chrome directly via subprocess.
        """
        session_id = os.path.basename(profile_dir)
        os.makedirs(profile_dir, exist_ok=True)

        session = CDPSession(
            session_id=session_id,
            account_id=account_id,
            site=site,
            profile_dir=profile_dir,
        )

        logger.info("Launching Chrome: profile=%s", session_id[:8])

        # ── Chrome Manager mode ────────────────────────────────
        if CHROME_MANAGER_URL:
            await self._launch_via_chrome_manager(session, account_id, site)
            self._sessions[session.session_id] = session
            logger.info("Chrome launched via Chrome Manager: session=%s cdp_port=%d",
                        session.session_id[:8], session.cdp_port)
            return session

        # ── Direct subprocess mode (original) ──────────────────
        chrome_exe = CHROME_BINARY
        if not os.path.exists(chrome_exe):
            raise RuntimeError(f"Chrome for Testing not found: {chrome_exe}")

        ext_path = str(CHROME_MANAGER_EXTENSION_DIR)

        args = [
            chrome_exe,
            f"--user-data-dir={profile_dir}",
            f"--load-extension={ext_path}",
            f"--disable-extensions-except={ext_path}",
            "--no-first-run",
            "--no-default-browser-check",
            "--window-size=1280,720",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--remote-debugging-port=9223",
            "--remote-allow-origins=*",
        ]

        # Set DISPLAY for Xvfb on headless Linux
        env = os.environ.copy()
        if not env.get("DISPLAY"):
            env["DISPLAY"] = ":99"

        # Launch Chrome in a thread since it blocks
        proc = None
        error = None
        def _launch():
            nonlocal proc, error
            try:
                proc = subprocess.Popen(args, env=env)
            except Exception as e:
                error = e

        t = threading.Thread(target=_launch, daemon=True)
        t.start()
        t.join(timeout=15)

        if error:
            raise RuntimeError(f"Failed to launch Chrome: {error}")
        if proc is None:
            raise RuntimeError("Chrome launch timed out after 15s")

        session.pid = proc.pid
        session.status = "RUNNING"

        # Record profile launch in DB
        try:
            from agent.db.schema import get_db
            import uuid as _uuid
            from datetime import datetime, timezone
            db = await get_db()
            profile_db_id = str(_uuid.uuid4())
            now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            await db.execute(
                "INSERT INTO chrome_profile (id, account_id, site, profile_dir, pid, status, created_at) VALUES (?,?,?,?,?,?,?)",
                (profile_db_id, account_id, site, profile_dir, proc.pid, "ACTIVE", now_str)
            )
            await db.commit()
        except Exception as e:
            logger.warning("Failed to record chrome_profile on launch: %s", e)

        # Connect CDP driver to Chrome
        try:
            debugger_url = await self._connect_cdp(session)
            logger.info("CDP connected: %s", debugger_url[:60])
        except Exception as e:
            logger.warning("CDP connect failed: %s", e)

        # Auto-navigate to labs.google to trigger token capture
        try:
            await self._navigate_to_flow(session)
        except Exception as e:
            logger.warning("Auto-navigate to Flow failed: %s", e)

        # Start token capture listener in background
        asyncio.create_task(self._capture_token_loop(session))

        # Start auth token interceptor via Fetch domain
        asyncio.create_task(self._intercept_auth_tokens(session))

        self._sessions[session_id] = session
        logger.info("Chrome launched: pid=%d, session=%s", session.pid, session_id[:8])
        return session

    async def _launch_via_chrome_manager(self, session: CDPSession, account_id: str, site: str):
        """Launch Chrome via the Chrome Manager API (Docker mode)."""
        import httpx

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{CHROME_MANAGER_URL}/chrome/launch",
                json={"account_id": account_id, "site": site, "profile_name": session.session_id},
            )
            resp.raise_for_status()
            data = resp.json()

        session.pid = data["pid"]
        session.cdp_port = data["cdp_port"]
        session.status = data.get("status", "RUNNING")
        # Use Chrome Manager's session_id for CDP proxy routing
        cm_session_id = data.get("session_id", session.session_id)
        session.session_id = cm_session_id
        # Update _sessions dict key to match
        if session.session_id in self._sessions:
            del self._sessions[session.session_id]
        self._sessions[cm_session_id] = session

        # Record profile launch in DB
        try:
            from agent.db.schema import get_db
            import uuid as _uuid
            from datetime import datetime, timezone
            db = await get_db()
            profile_db_id = str(_uuid.uuid4())
            now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            await db.execute(
                "INSERT INTO chrome_profile (id, account_id, site, profile_dir, pid, status, created_at) VALUES (?,?,?,?,?,?,?)",
                (profile_db_id, account_id, site, data.get("profile_dir", ""), data["pid"], "ACTIVE", now_str)
            )
            await db.commit()
        except Exception as e:
            logger.warning("Failed to record chrome_profile on launch: %s", e)

        # Connect CDP driver to Chrome via Chrome Manager's CDP proxy
        try:
            debugger_url = await self._connect_cdp(session)
            logger.info("CDP connected (Chrome Manager): %s", debugger_url[:60])
        except Exception as e:
            logger.warning("CDP connect failed (Chrome Manager): %s", e)

        # Auto-navigate to labs.google to trigger token capture
        try:
            await self._navigate_to_flow(session)
        except Exception as e:
            logger.warning("Auto-navigate to Flow failed: %s", e)

        # Start token capture listener in background
        asyncio.create_task(self._capture_token_loop(session))

        # Start auth token interceptor via Fetch domain
        asyncio.create_task(self._intercept_auth_tokens(session))

    async def _navigate_to_flow(self, session: CDPSession):
        """Navigate Chrome to labs.google/fx/tools/flow to trigger token capture."""
        import websocket as ws_lib
        import urllib.request
        from urllib.parse import urlparse

        await asyncio.sleep(2)  # Wait for extension to initialize

        cdp_port = session.cdp_port
        if CHROME_MANAGER_URL:
            # Use Chrome Manager CDP proxy
            cdp_host = urlparse(CHROME_MANAGER_URL).hostname or "127.0.0.1"
            cdp_base = urlparse(CHROME_MANAGER_URL).port or 8200
            proxy_base = f"http://{cdp_host}:{cdp_base}/cdp/{session.session_id}"
            try:
                pages = json.loads(urllib.request.urlopen(f"{proxy_base}/json", timeout=5).read())
                for p in pages:
                    if p["type"] == "page":
                        # Rewrite WebSocket URL to go through Chrome Manager proxy
                        ws_url = f"ws://{cdp_host}:{cdp_base}/cdp/{session.session_id}/ws"
                        ws = ws_lib.create_connection(ws_url)
                        ws.send(json.dumps({"id": 30, "method": "Page.navigate",
                                           "params": {"url": f"https://{session.site}/fx/tools/flow"}}))
                        ws.recv()
                        ws.close()
                        logger.info("Navigated to %s/fx/tools/flow via proxy", session.site)
                        return
            except Exception as e:
                logger.warning("Failed to navigate to Flow via proxy: %s", e)
        else:
            # Direct local mode
            cdp_host = "127.0.0.1"
            try:
                pages = json.loads(urllib.request.urlopen(f"http://{cdp_host}:{cdp_port}/json", timeout=5).read())
                for p in pages:
                    if p["type"] == "page":
                        ws_url = p["webSocketDebuggerUrl"]
                        ws = ws_lib.create_connection(ws_url)
                        ws.send(json.dumps({"id": 30, "method": "Page.navigate",
                                           "params": {"url": f"https://{session.site}/fx/tools/flow"}}))
                        ws.recv()
                        ws.close()
                        logger.info("Navigated to %s/fx/tools/flow", session.site)
                        return
            except Exception as e:
                logger.warning("Failed to navigate to Flow: %s", e)

    async def _connect_cdp(self, session: CDPSession) -> str:
        """Connect CDPDriver to a page target on Chrome's debugging port."""
        import urllib.request
        from urllib.parse import urlparse

        cdp_port = session.cdp_port
        if CHROME_MANAGER_URL:
            # Use Chrome Manager CDP proxy — connects through port 8200
            cdp_host = urlparse(CHROME_MANAGER_URL).hostname or "127.0.0.1"
            cdp_base = urlparse(CHROME_MANAGER_URL).port or 8200
            proxy_base = f"http://{cdp_host}:{cdp_base}/cdp/{session.session_id}"
        else:
            cdp_host = "127.0.0.1"
            proxy_base = f"http://{cdp_host}:{cdp_port}"

        # Wait for Chrome to start debugging server
        for _ in range(20):
            try:
                data = await asyncio.to_thread(
                    lambda: urllib.request.urlopen(
                        f"{proxy_base}/json", timeout=2
                    ).read()
                )
                targets = json.loads(data)
                page = next(
                    (
                        target for target in targets
                        if target.get("type") == "page"
                        and target.get("url", "").startswith("http")
                    ),
                    None,
                )
                if page is None:
                    page = next(
                        (target for target in targets if target.get("type") == "page"),
                        None,
                    )
                debugger_url = page.get("webSocketDebuggerUrl", "") if page else ""
                if debugger_url:
                    if CHROME_MANAGER_URL:
                        # Rewrite WebSocket URL to go through Chrome Manager proxy
                        debugger_url = f"ws://{cdp_host}:{cdp_base}/cdp/{session.session_id}/ws"
                    driver = CDPDriver(debugger_url)
                    await asyncio.to_thread(driver.connect)
                    session.driver = driver
                    return debugger_url
            except Exception:
                pass
            await asyncio.sleep(0.5)
        raise RuntimeError("Chrome CDP not available after 10s")

    async def inject_cookies(self, session: CDPSession, cookies: list[dict], site: str) -> dict:
        """Inject cookies via CDP Network.setCookie."""
        driver = session.driver
        if not driver:
            return {"success": False, "error": "No driver"}

        def _inject():
            results = []
            for cookie in cookies:
                try:
                    cdp_cookie = {
                        "name": cookie["name"],
                        "value": cookie["value"],
                        "path": cookie.get("path", "/"),
                        "secure": cookie.get("secure", True),
                        "httpOnly": cookie.get("httpOnly", False),
                    }

                    # __Host- and __Secure- prefix cookies require url (not domain)
                    # in CDP Network.setCookie, otherwise Chrome silently rejects them
                    is_special_prefix = cookie["name"].startswith(("__Host-", "__Secure-"))
                    if is_special_prefix:
                        cdp_cookie["url"] = f"https://{site}{cookie.get('path', '/')}"
                    else:
                        cdp_cookie["domain"] = cookie.get("domain", ".google.com")

                    if cookie.get("sameSite"):
                        ss = cookie["sameSite"].capitalize()
                        if ss in ("Strict", "Lax", "None"):
                            cdp_cookie["sameSite"] = ss
                    if cookie.get("expirationDate"):
                        cdp_cookie["expires"] = cookie["expirationDate"]

                    result = driver.execute_cdp_cmd("Network.setCookie", cdp_cookie)
                    success = result.get("result", {}).get("success", False)
                    if not success:
                        logger.warning("Chrome rejected cookie: %s (url=%s, domain=%s) - result: %s", 
                                       cookie["name"], 
                                       cdp_cookie.get("url", ""),
                                       cdp_cookie.get("domain", ""),
                                       result)
                    results.append({"name": cookie["name"], "success": success, "cdp_result": result})
                except Exception as e:
                    results.append({"name": cookie["name"], "success": False, "error": str(e)})
            return results

        results = await asyncio.to_thread(_inject)
        injected = sum(1 for r in results if r["success"])
        failed = sum(1 for r in results if not r["success"])
        return {"success": failed == 0, "injected": injected, "failed": failed, "details": results}

    async def navigate(self, session: CDPSession, url: str):
        """Navigate to a URL."""
        await asyncio.to_thread(session.driver.get, url)
        await asyncio.sleep(3)  # Wait for page load

    async def capture_token(self, session: CDPSession, timeout: float = 30) -> Optional[str]:
        """Wait for bearer token to be captured from network requests."""
        try:
            await asyncio.wait_for(session._token_event.wait(), timeout=timeout)
            return session.bearer_token
        except asyncio.TimeoutError:
            return None

    async def get_bearer_token(self, session: CDPSession) -> Optional[str]:
        """Get the current bearer token."""
        return session.bearer_token

    async def solve_captcha(self, session: CDPSession, action: str = "IMAGE_GENERATION") -> Optional[str]:
        """Solve reCAPTCHA via CDP Page.evaluate."""
        driver = session.driver
        if not driver:
            return None

        js_code = f"""
        return new Promise((resolve, reject) => {{
            const timeout = 15000;
            const start = Date.now();
            const check = () => {{
                if (window.grecaptcha && window.grecaptcha.enterprise && window.grecaptcha.enterprise.execute) {{
                    window.grecaptcha.enterprise.execute('{RECAPTCHA_SITE_KEY}', {{action: '{action}'}})
                        .then(token => resolve(token))
                        .catch(err => reject(err.message));
                }} else if (Date.now() - start > timeout) {{
                    reject(new Error('grecaptcha not available after {{timeout}}ms'));
                }} else {{
                    setTimeout(check, 200);
                }}
            }};
            check();
        }});
        """

        try:
            # Execute async JS via CDP
            result = driver.execute_cdp_cmd("Runtime.evaluate", {
                "expression": f"({js_code})()",
                "awaitPromise": True,
                "returnByValue": True,
            })
            token = result.get("result", {}).get("value")
            if token:
                logger.info("reCAPTCHA solved: %s...", token[:30])
            return token
        except Exception as e:
            logger.error("reCAPTCHA solve failed: %s", e)
            return None

    async def api_request(self, session: CDPSession, url: str, method: str = "POST",
                          headers: dict = None, body: dict = None,
                          captcha_action: str = None) -> dict:
        """Make an API request through the browser context.

        Uses fetch() in the page context with the captured OAuth token.
        """
        driver = session.driver
        if not driver:
            return {"error": "No driver"}

        # Get the captured OAuth token
        auth_header = None
        if session.bearer_token and session.bearer_token.startswith("ya29."):
            auth_header = f"Bearer {session.bearer_token}"
        else:
            # Try to get from page context
            try:
                result = driver.execute_cdp_cmd("Runtime.evaluate", {
                    "expression": "window.__flowKitToken",
                    "returnByValue": True,
                })
                token = result.get("result", {}).get("value")
                if token and token.startswith("ya29."):
                    auth_header = f"Bearer {token}"
                    session.bearer_token = token
            except Exception:
                pass

        # Build headers
        fetch_headers = headers.copy() if headers else {}
        fetch_headers["Content-Type"] = fetch_headers.get("Content-Type", "application/json")
        fetch_headers["Accept"] = fetch_headers.get("Accept", "*/*")
        if auth_header:
            fetch_headers["Authorization"] = auth_header

        # Build fetch options
        fetch_opts = {
            "method": method,
            "headers": fetch_headers,
            "credentials": "include",
        }
        if body:
            fetch_opts["body"] = json.dumps(body)

        fetch_opts_json = json.dumps(fetch_opts)

        # Execute fetch in page context - use arrow function to avoid "Illegal return"
        js = f"""
        (() => fetch('{url}', {fetch_opts_json})
            .then(r => r.json().then(data => ({{status: r.status, data: data}})))
            .catch(err => ({{error: err.message}})))()
        """

        try:
            result = driver.execute_cdp_cmd("Runtime.evaluate", {
                "expression": js,
                "awaitPromise": True,
                "returnByValue": True,
            })
            return result.get("result", {}).get("value", {"error": "No result"})
        except Exception as e:
            return {"error": str(e)}

    async def make_flow_request(self, session: CDPSession, endpoint: str, body: dict,
                                captcha_action: str = None) -> dict:
        """Make a request to Google Flow API through the browser.

        This uses the page's fetch() which automatically includes cookies.
        """
        url = f"https://aisandbox-pa.googleapis.com{endpoint}"

        headers = {
            "Content-Type": "application/json",
            "Accept": "*/*",
        }
        if session.bearer_token:
            headers["Authorization"] = f"Bearer {session.bearer_token}"

        return await self.api_request(session, url, "POST", headers, body, captcha_action)

    async def close(self, session_id: str):
        """Close a Chrome session."""
        session = self._sessions.pop(session_id, None)
        if not session:
            return

        # Cancel idle timer
        self._cancel_idle_timer(session_id)

        session.status = "CLOSING"
        if session.driver:
            try:
                session.driver.close()
            except Exception:
                pass

        # Kill Chrome process tree
        if session.pid:
            try:
                import psutil
                parent = psutil.Process(session.pid)
                for child in parent.children(recursive=True):
                    child.kill()
                parent.kill()
            except Exception:
                try:
                    os.kill(session.pid, 9)
                except Exception:
                    pass

        # Clean up profile directory
        if os.path.exists(session.profile_dir):
            try:
                shutil.rmtree(session.profile_dir, ignore_errors=True)
            except Exception:
                pass

        session.status = "CLOSED"
        logger.info("Chrome closed: session=%s", session_id[:8])

        # Record profile close in DB
        try:
            from agent.db.schema import get_db
            from datetime import datetime, timezone
            db = await get_db()
            now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            await db.execute(
                "UPDATE chrome_profile SET status='CLOSED', closed_at=? WHERE pid=? AND status='ACTIVE'",
                (now_str, session.pid)
            )
            await db.commit()
        except Exception as e:
            logger.warning("Failed to update chrome_profile on close: %s", e)

    async def close_all(self):
        """Close all sessions."""
        for sid in list(self._sessions.keys()):
            await self.close(sid)

    async def _capture_token_loop(self, session: CDPSession):
        """Background task to capture bearer token from network requests."""
        driver = session.driver
        if not driver:
            return

        # Enable network tracking
        try:
            driver.execute_cdp_cmd("Network.enable", {})
        except Exception:
            return

        # Poll for bearer token via CDP - check cookies for OAuth token
        for _ in range(150):  # 5 minutes max
            await asyncio.sleep(2)
            try:
                # Check all cookies for the OAuth token (ya29.* pattern)
                cookies = driver.execute_cdp_cmd("Network.getCookies", {
                    "urls": [
                        "https://labs.google",
                        "https://aisandbox-pa.googleapis.com",
                        "https://accounts.google.com",
                        "https://myaccount.google.com",
                    ]
                })
                for cookie in cookies.get("cookies", []):
                    val = cookie.get("value", "")
                    # OAuth tokens start with ya29.
                    if val.startswith("ya29."):
                        session.bearer_token = val
                        session.token_captured_at = time.time()
                        session._token_event.set()
                        logger.info("Captured OAuth bearer token from cookie: %s", val[:30])
                        break
                    # Also check __Secure-next-auth.session-token
                    if cookie.get("name") == "__Secure-next-auth.session-token" and not session.bearer_token:
                        # Don't set _token_event yet — keep looking for ya29.* token
                        session.bearer_token = f"session_cookie:{val[:30]}"
                        session.token_captured_at = time.time()
                        logger.info("Captured session cookie for auth (still looking for OAuth token)")
            except Exception:
                pass

            # Also try to extract token from JS context if available
            try:
                result = driver.execute_cdp_cmd("Runtime.evaluate", {
                    "expression": """
                    (function() {
                        // Check if there's a global token variable
                        if (window.__token) return window.__token;
                        // Check localStorage
                        var keys = Object.keys(localStorage);
                        for (var i = 0; i < keys.length; i++) {
                            var val = localStorage.getItem(keys[i]);
                            if (val && val.startsWith('ya29.')) return val;
                        }
                        return null;
                    })()
                    """,
                    "returnByValue": True,
                })
                token = result.get("result", {}).get("value")
                if token and token.startswith("ya29.") and not session.bearer_token:
                    session.bearer_token = token
                    session.token_captured_at = time.time()
                    session._token_event.set()
                    logger.info("Captured OAuth bearer token from JS: %s", token[:30])
            except Exception:
                pass

            if session.bearer_token and session.bearer_token.startswith("ya29."):
                break

        if not session.bearer_token:
            logger.warning("Token capture timed out for session %s", session.session_id[:8])

    async def _intercept_auth_tokens(self, session: CDPSession):
        """Intercept auth tokens by monkey-patching fetch in the page context."""
        driver = session.driver
        if not driver:
            return

        # Wait for page to load
        await asyncio.sleep(3)

        # Inject a fetch interceptor that captures Authorization headers
        try:
            driver.execute_cdp_cmd("Runtime.evaluate", {
                "expression": """
                (function() {
                    if (window.__flowKitInterceptor) return;
                    window.__flowKitInterceptor = true;
                    window.__flowKitToken = null;
                    window.__flowKitTokenTime = 0;

                    const originalFetch = window.fetch;
                    window.fetch = function() {
                        const url = typeof arguments[0] === 'string' ? arguments[0] : arguments[0]?.url;
                        const opts = arguments[1] || {};
                        const headers = opts.headers || {};

                        // Check for Authorization header
                        let authHeader = null;
                        if (headers instanceof Headers) {
                            authHeader = headers.get('authorization');
                        } else if (typeof headers === 'object') {
                            authHeader = headers.authorization || headers.Authorization;
                        }

                        if (authHeader && authHeader.startsWith('Bearer ya29.')) {
                            window.__flowKitToken = authHeader.replace('Bearer ', '');
                            window.__flowKitTokenTime = Date.now();
                            console.log('[FlowKit] Captured OAuth token');
                        }

                        return originalFetch.apply(this, arguments);
                    };

                    // Also intercept XMLHttpRequest
                    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
                    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
                        if (name.toLowerCase() === 'authorization' && value.startsWith('Bearer ya29.')) {
                            window.__flowKitToken = value.replace('Bearer ', '');
                            window.__flowKitTokenTime = Date.now();
                            console.log('[FlowKit] Captured OAuth token from XHR');
                        }
                        return originalSetRequestHeader.apply(this, arguments);
                    };

                    console.log('[FlowKit] Interceptors installed');
                })()
                """,
                "returnByValue": True,
            })
            logger.info("Auth token interceptors installed")
        except Exception as e:
            logger.warning("Failed to install interceptors: %s", e)
            return

        # Poll for captured token
        for _ in range(60):  # 120 seconds max
            await asyncio.sleep(2)
            try:
                result = driver.execute_cdp_cmd("Runtime.evaluate", {
                    "expression": "window.__flowKitToken",
                    "returnByValue": True,
                })
                token = result.get("result", {}).get("value")
                if token and token.startswith("ya29.") and len(token) > 20:
                    session.bearer_token = token
                    session.token_captured_at = time.time()
                    session._token_event.set()
                    logger.info("Captured OAuth bearer token: %s", token[:30])
                    break
            except Exception:
                pass

            # After 10 seconds, trigger an API call to capture token
            if _ == 5:
                try:
                    driver.execute_cdp_cmd("Runtime.evaluate", {
                        "expression": """
                        // Trigger page interactions to generate API calls
                        window.scrollTo(0, 100);
                        var btns = document.querySelectorAll('button');
                        for (var i = 0; i < btns.length; i++) {
                            var text = btns[i].textContent.toLowerCase();
                            if (text.includes('new project') || text.includes('try') || text.includes('start')) {
                                btns[i].click();
                                break;
                            }
                        }
                        """,
                        "returnByValue": True,
                    })
                except Exception:
                    pass


# Singleton
_cdp_client: Optional[CDPClient] = None


def get_cdp_client() -> CDPClient:
    global _cdp_client
    if _cdp_client is None:
        _cdp_client = CDPClient()
    return _cdp_client
