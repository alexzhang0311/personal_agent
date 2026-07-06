"""
OpenClaw Bridge — persistent WebSocket connection to an OpenClaw gateway.

Implements the real OpenClaw gateway protocol (v3) reverse-engineered from
the installed `openclaw` package (custom envelope + Ed25519 device-identity
handshake). Replaces the original JSON-RPC 2.0 guess.

Public surface (unchanged for callers):
    class OpenClawBridge(config, username)
    register_bridge / unregister_bridge / get_bridge

Protocol reference:
    docs/gateway/protocol.md
    dist/device-identity-D3srcfXR.js         (Ed25519, sha256 device-id, base64url)
    dist/method-scopes-Gjdcdc0s.js           (buildDeviceAuthPayloadV3, sendConnect, AgentParamsSchema)
    dist/device-metadata-normalization-*.js  (normalizeDeviceMetadataForAuth)
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

try:
    import websockets
    from websockets.exceptions import ConnectionClosed
except ImportError:
    websockets = None  # type: ignore[assignment]
    ConnectionClosed = Exception  # type: ignore[assignment,misc]

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ed25519
    _CRYPTO_OK = True
except ImportError:
    _CRYPTO_OK = False

from ..config import get_settings
from ...middleware.logging import get_channels_logger
from ...models.channels import OpenClawChannelConfig

logger = get_channels_logger("openclaw")


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _b64url(data: bytes) -> str:
    """base64url encode without padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _new_id() -> str:
    return uuid4().hex[:16]


def _now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Device identity — Ed25519 keypair persisted per user
# ---------------------------------------------------------------------------

class _DeviceIdentity:
    """Loads or creates an Ed25519 keypair for this user.

    Persisted at {work_dir}/{username}/.vivian.openclaw.device.json (mode 0600)
    as PEM (for storage). Raw 32-byte public/private bytes are derived on use.
    """

    VERSION = 1

    def __init__(self, username: str):
        if not _CRYPTO_OK:
            raise RuntimeError("cryptography package not installed")
        self.username = username
        self._path = self._resolve_path(username)
        self._private_key: ed25519.Ed25519PrivateKey | None = None
        self._public_raw: bytes = b""
        self._device_id: str = ""
        self._load_or_create()

    @staticmethod
    def _resolve_path(username: str) -> Path:
        settings = get_settings()
        return (
            Path(settings.server.work_dir).expanduser()
            / username
            / ".vivian.openclaw.device.json"
        )

    def _load_or_create(self) -> None:
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text())
                priv_pem = data["privateKeyPem"].encode("utf-8")
                self._private_key = serialization.load_pem_private_key(
                    priv_pem, password=None
                )  # type: ignore[assignment]
                self._public_raw = self._private_key.public_key().public_bytes(  # type: ignore[union-attr]
                    encoding=serialization.Encoding.Raw,
                    format=serialization.PublicFormat.Raw,
                )
                self._device_id = hashlib.sha256(self._public_raw).hexdigest()
                return
            except Exception as e:
                logger.warning(
                    "Failed to load OpenClaw device identity for {} ({}), regenerating",
                    self.username,
                    e,
                )

        # Create fresh keypair
        self._private_key = ed25519.Ed25519PrivateKey.generate()
        self._public_raw = self._private_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        self._device_id = hashlib.sha256(self._public_raw).hexdigest()

        priv_pem = self._private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("ascii")
        pub_pem = self._private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")

        payload = {
            "version": self.VERSION,
            "deviceId": self._device_id,
            "publicKeyPem": pub_pem,
            "privateKeyPem": priv_pem,
            "createdAtMs": _now_ms(),
        }
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # Write with restrictive permissions
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2))
        try:
            os.chmod(tmp, 0o600)
        except Exception:
            pass
        tmp.replace(self._path)
        try:
            os.chmod(self._path, 0o600)
        except Exception:
            pass
        logger.info(
            "OpenClaw device identity created for {} (deviceId={})",
            self.username,
            self._device_id,
        )

    @property
    def device_id(self) -> str:
        return self._device_id

    @property
    def public_key_b64url(self) -> str:
        return _b64url(self._public_raw)

    def sign(self, payload: str) -> str:
        assert self._private_key is not None
        sig = self._private_key.sign(payload.encode("utf-8"))
        return _b64url(sig)


# ---------------------------------------------------------------------------
# Protocol — frame builders and parsers (pure functions for easy testing)
# ---------------------------------------------------------------------------

class OpenClawProtocol:
    """Static helpers for OpenClaw gateway v3 protocol frames."""

    PROTOCOL_VERSION = 3
    # Must be one of the GatewayClientIdSchema literals in the openclaw SDK:
    # "cli" | "webchat" | "webchat-ui" | "openclaw-control-ui" | "openclaw-tui"
    # | "gateway-client" | "openclaw-macos" | "openclaw-ios" | "openclaw-android"
    # | "node-host" | "test" | "fingerprint" | "openclaw-probe"
    CLIENT_ID = "gateway-client"
    CLIENT_VERSION = "1.0.0"
    # Must be one of GatewayClientModeSchema: cli|node|webchat|backend|ui|test|probe
    CLIENT_MODE = "backend"
    CLIENT_PLATFORM = "linux"
    ROLE = "operator"
    SCOPES = ["operator.admin"]

    @staticmethod
    def _normalize_meta(value: str) -> str:
        return (value or "").strip().lower()

    @classmethod
    def build_v3_payload(
        cls,
        device_id: str,
        client_id: str,
        client_mode: str,
        role: str,
        scopes: list[str],
        signed_at_ms: int,
        token: str,
        nonce: str,
        platform: str,
        device_family: str,
    ) -> str:
        """Build the pipe-delimited string that gets signed.

        Mirrors buildDeviceAuthPayloadV3 in method-scopes-Gjdcdc0s.js:144.
        """
        scopes_csv = ",".join(scopes)
        return (
            f"v3|{device_id}|{client_id}|{client_mode}|{role}|{scopes_csv}|"
            f"{signed_at_ms}|{token}|{nonce}|"
            f"{cls._normalize_meta(platform)}|{cls._normalize_meta(device_family)}"
        )

    @classmethod
    def build_connect_frame(
        cls,
        req_id: str,
        identity: _DeviceIdentity,
        auth_token: str,
        nonce: str,
        signed_at_ms: int,
    ) -> dict:
        payload_str = cls.build_v3_payload(
            device_id=identity.device_id,
            client_id=cls.CLIENT_ID,
            client_mode=cls.CLIENT_MODE,
            role=cls.ROLE,
            scopes=cls.SCOPES,
            signed_at_ms=signed_at_ms,
            token=auth_token,
            nonce=nonce,
            platform=cls.CLIENT_PLATFORM,
            device_family="",
        )
        signature = identity.sign(payload_str)
        return {
            "type": "req",
            "id": req_id,
            "method": "connect",
            "params": {
                "minProtocol": cls.PROTOCOL_VERSION,
                "maxProtocol": cls.PROTOCOL_VERSION,
                "client": {
                    "id": cls.CLIENT_ID,
                    "version": cls.CLIENT_VERSION,
                    "platform": cls.CLIENT_PLATFORM,
                    "mode": cls.CLIENT_MODE,
                },
                "role": cls.ROLE,
                "scopes": list(cls.SCOPES),
                "caps": [],
                "auth": {"token": auth_token},
                "device": {
                    "id": identity.device_id,
                    "publicKey": identity.public_key_b64url,
                    "signature": signature,
                    "signedAt": signed_at_ms,
                    "nonce": nonce,
                },
            },
        }

    @staticmethod
    def build_agent_frame(
        req_id: str,
        message: str,
        agent_id: str | None,
        idempotency_key: str,
        timeout_s: int | None,
        session_key: str | None = None,
    ) -> dict:
        params: dict[str, Any] = {
            "message": message,
            "idempotencyKey": idempotency_key,
        }
        if agent_id:
            params["agentId"] = agent_id
        if timeout_s:
            params["timeout"] = int(timeout_s)
        if session_key:
            params["sessionKey"] = session_key
        return {
            "type": "req",
            "id": req_id,
            "method": "agent",
            "params": params,
        }

    @staticmethod
    def build_agent_wait_frame(req_id: str, run_id: str, timeout_ms: int) -> dict:
        return {
            "type": "req",
            "id": req_id,
            "method": "agent.wait",
            "params": {
                "runId": run_id,
                "timeoutMs": int(timeout_ms),
            },
        }

    @staticmethod
    def build_chat_history_frame(req_id: str, session_key: str, limit: int = 50) -> dict:
        return {
            "type": "req",
            "id": req_id,
            "method": "chat.history",
            "params": {
                "sessionKey": session_key,
                "limit": int(limit),
            },
        }

    @staticmethod
    def build_tick_frame(req_id: str) -> dict:
        return {
            "type": "req",
            "id": req_id,
            "method": "tick",
            "params": {},
        }

    @staticmethod
    def extract_run_id(payload: dict) -> str | None:
        """Extract runId from an `agent` res payload ({runId, status, acceptedAt})."""
        if not isinstance(payload, dict):
            return None
        run_id = payload.get("runId")
        if isinstance(run_id, str) and run_id:
            return run_id
        return None

    @staticmethod
    def extract_latest_assistant_reply(history_payload: dict) -> str | None:
        """Walk chat.history messages newest-first and return the latest assistant text.

        Handles both string content and block-array content shapes (the gateway
        emits either depending on provider/message).
        """
        if not isinstance(history_payload, dict):
            return None
        messages = history_payload.get("messages")
        if not isinstance(messages, list):
            return None
        for msg in reversed(messages):
            if not isinstance(msg, dict):
                continue
            if msg.get("role") != "assistant":
                continue
            content = msg.get("content")
            text = OpenClawProtocol._flatten_message_content(content)
            if text:
                return text
        return None

    @staticmethod
    def _flatten_message_content(content: Any) -> str:
        """Flatten message content into plain text. Accepts str, list[block], or dict."""
        if content is None:
            return ""
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for block in content:
                if isinstance(block, str):
                    parts.append(block)
                    continue
                if not isinstance(block, dict):
                    continue
                # Skip tool_use / tool_result / thinking blocks — we want final text
                btype = block.get("type")
                if btype in ("tool_use", "tool_result", "thinking"):
                    continue
                text_val = block.get("text") or block.get("content")
                if isinstance(text_val, str) and text_val:
                    parts.append(text_val)
                elif isinstance(text_val, list):
                    parts.append(OpenClawProtocol._flatten_message_content(text_val))
            return "".join(parts).strip()
        if isinstance(content, dict):
            text_val = content.get("text") or content.get("message") or content.get("content")
            if isinstance(text_val, str):
                return text_val.strip()
            return OpenClawProtocol._flatten_message_content(text_val)
        return ""

    @staticmethod
    def parse_error(res: dict) -> str:
        err = res.get("error") or {}
        if isinstance(err, str):
            return err
        msg = err.get("message") or "unknown error"
        details = err.get("details") or {}
        code = None
        if isinstance(details, dict):
            code = details.get("code")
        code = code or err.get("code")
        if code:
            return f"{msg} (code={code})"
        return str(msg)

    @staticmethod
    def extract_error_code(res: dict) -> str | None:
        err = res.get("error") or {}
        if not isinstance(err, dict):
            return None
        details = err.get("details") or {}
        if isinstance(details, dict) and details.get("code"):
            return str(details["code"])
        if err.get("code"):
            return str(err["code"])
        return None


# ---------------------------------------------------------------------------
# Bridge — persistent WS connection manager (one per user)
# ---------------------------------------------------------------------------

class OpenClawBridge:
    def __init__(self, config: OpenClawChannelConfig, username: str):
        self.config = config
        self.username = username

        self._ws = None
        self._connected = False
        self._connected_at: datetime | None = None
        self._error_message: str | None = None
        self._active_delegations: int = 0

        self._listener_task: asyncio.Task | None = None
        self._tick_task: asyncio.Task | None = None
        self._reconnect_task: asyncio.Task | None = None

        self._pending: dict[str, asyncio.Future] = {}
        self._shutdown = False
        self._tick_interval_ms: int = 30_000

        self._identity: _DeviceIdentity | None = None
        # Lazily created — avoid raising in constructor if cryptography missing

    # --- Public properties ---

    @property
    def is_connected(self) -> bool:
        return self._connected and self._ws is not None

    @property
    def connected_at(self) -> datetime | None:
        return self._connected_at

    @property
    def error_message(self) -> str | None:
        return self._error_message

    @property
    def active_delegations(self) -> int:
        return self._active_delegations

    @property
    def status(self) -> str:
        if self._connected:
            return "connected"
        if self._reconnect_task and not self._reconnect_task.done():
            return "connecting"
        if self._error_message:
            return "error"
        return "disconnected"

    # --- Public lifecycle ---

    async def connect(self) -> None:
        """Establish WS connection and perform the v3 handshake.

        On success: starts listener + tick tasks.
        On PAIRING_REQUIRED: sets error_message and stays idle (no reconnect thrash).
        On other transient failures: kicks off a reconnect loop.
        """
        if websockets is None:
            self._error_message = "websockets package not installed"
            logger.error("Cannot connect to OpenClaw: websockets not installed")
            return
        if not _CRYPTO_OK:
            self._error_message = "cryptography package not installed"
            logger.error("Cannot connect to OpenClaw: cryptography not installed")
            return

        url = self.config.gateway_url
        if not url:
            self._error_message = "No gateway URL configured"
            return

        self._shutdown = False

        # Lazy device identity
        try:
            if self._identity is None:
                self._identity = _DeviceIdentity(self.username)
        except Exception as e:
            self._error_message = f"Device identity error: {e}"
            logger.error("OpenClaw device identity load failed: {}", e)
            return

        try:
            ws = await websockets.connect(url, ping_interval=None, open_timeout=10)
        except Exception as e:
            self._connected = False
            self._error_message = f"WS connect failed: {e}"
            logger.warning("OpenClaw WS connect failed: {}", e)
            self._start_reconnect()
            return

        self._ws = ws

        try:
            # Step 1: wait for connect.challenge event
            nonce = await self._await_challenge()

            # Step 2: build + send connect request, await res
            req_id = _new_id()
            signed_at_ms = _now_ms()
            frame = OpenClawProtocol.build_connect_frame(
                req_id=req_id,
                identity=self._identity,  # type: ignore[arg-type]
                auth_token=self.config.auth_token or "",
                nonce=nonce,
                signed_at_ms=signed_at_ms,
            )
            loop = asyncio.get_event_loop()
            fut: asyncio.Future[dict] = loop.create_future()
            self._pending[req_id] = fut
            await ws.send(json.dumps(frame))

            # We don't have a listener yet — read frames manually until we see our res
            res = await asyncio.wait_for(
                self._read_until_res(req_id, fut), timeout=15
            )
        except asyncio.TimeoutError:
            self._error_message = "Handshake timeout"
            logger.warning("OpenClaw handshake timed out")
            await self._close_ws_silent()
            self._start_reconnect()
            return
        except Exception as e:
            self._error_message = f"Handshake error: {e}"
            logger.warning("OpenClaw handshake error: {}", e)
            await self._close_ws_silent()
            self._start_reconnect()
            return
        finally:
            self._pending.pop(req_id if 'req_id' in locals() else "", None)

        if not res.get("ok"):
            err_msg = OpenClawProtocol.parse_error(res)
            code = OpenClawProtocol.extract_error_code(res)
            if code == "PAIRING_REQUIRED" and self._identity is not None:
                self._error_message = (
                    f"Pairing required — run: openclaw devices pair approve {self._identity.device_id}"
                )
                logger.warning(
                    "OpenClaw handshake rejected: PAIRING_REQUIRED (deviceId={})",
                    self._identity.device_id,
                )
            else:
                self._error_message = err_msg
                logger.warning("OpenClaw handshake rejected: {}", err_msg)
            await self._close_ws_silent()
            # Do NOT auto-reconnect on PAIRING_REQUIRED or other auth errors
            return

        # Success — hello-ok
        payload = res.get("payload") or {}
        policy = payload.get("policy") or {}
        tick_ms = policy.get("tickIntervalMs")
        if isinstance(tick_ms, (int, float)) and tick_ms > 0:
            self._tick_interval_ms = int(tick_ms)

        self._connected = True
        self._connected_at = datetime.now(timezone.utc)
        self._error_message = None
        logger.info("OpenClaw bridge connected to {}", url)
        logger.info(
            "hello-ok received (protocol={}, tick={}ms)",
            payload.get("protocol") or OpenClawProtocol.PROTOCOL_VERSION,
            self._tick_interval_ms,
        )

        # Spawn background tasks
        self._listener_task = asyncio.create_task(self._event_listener())
        self._tick_task = asyncio.create_task(self._tick_loop())

    async def disconnect(self) -> None:
        """Cleanly shut down the bridge. Idempotent."""
        self._shutdown = True
        self._connected = False

        # Cancel tasks in order: listener, tick, reconnect
        for task_name in ("_listener_task", "_tick_task", "_reconnect_task"):
            task: asyncio.Task | None = getattr(self, task_name)
            if task and not task.done():
                task.cancel()
                try:
                    await asyncio.wait_for(task, timeout=2)
                except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                    pass
            setattr(self, task_name, None)

        # Fail all pending futures
        for fut in list(self._pending.values()):
            if not fut.done():
                fut.set_exception(ConnectionError("Bridge disconnected"))
        self._pending.clear()

        await self._close_ws_silent()
        logger.info("OpenClaw bridge disconnected")

    async def send_and_wait(
        self,
        agent_id: str,
        text: str,
        timeout: int | None = None,
        progress_callback: Callable | None = None,
    ) -> str:
        """Full async agent delegation: agent → agent.wait → chat.history.

        The OpenClaw `agent` RPC is asynchronous — it returns immediately with
        {runId, status:"accepted"}. The actual assistant reply must be awaited
        via `agent.wait` (blocks until the run terminates) and then fetched
        from the session transcript via `chat.history`.
        """
        if not self.is_connected:
            raise ConnectionError("OpenClaw bridge not connected")

        timeout = timeout or self.config.timeout_seconds
        # Per-delegation isolated sessionKey → clean one-turn history readback.
        session_key = f"vivian-{self.username}-{uuid4().hex[:16]}"
        idempotency_key = f"vivian-{self.username}-{uuid4()}"

        self._active_delegations += 1
        try:
            # ── Step 1: send `agent`, get runId ───────────────────────────────
            run_id = await self._call_agent(
                agent_id=agent_id,
                message=text,
                idempotency_key=idempotency_key,
                session_key=session_key,
                timeout_s=timeout,
            )

            # ── Step 2: agent.wait until the run terminates ───────────────────
            await self._call_agent_wait(
                run_id=run_id,
                timeout_s=timeout,
                progress_callback=progress_callback,
            )

            # ── Step 3: fetch the latest assistant reply from chat.history ────
            reply = await self._call_chat_history_for_reply(session_key)
            if not reply:
                return "(agent completed but returned no text)"
            return reply

        finally:
            self._active_delegations -= 1

    async def _call_agent(
        self,
        *,
        agent_id: str,
        message: str,
        idempotency_key: str,
        session_key: str,
        timeout_s: int,
    ) -> str:
        req_id = _new_id()
        frame = OpenClawProtocol.build_agent_frame(
            req_id=req_id,
            message=message,
            agent_id=agent_id,
            idempotency_key=idempotency_key,
            timeout_s=timeout_s,
            session_key=session_key,
        )
        res = await self._send_and_await_res(req_id, frame, timeout=15)
        if not res.get("ok"):
            raise RuntimeError(OpenClawProtocol.parse_error(res))
        run_id = OpenClawProtocol.extract_run_id(res.get("payload") or {})
        if not run_id:
            raise RuntimeError(
                f"OpenClaw agent accepted without runId: {res.get('payload')!r}"
            )
        logger.debug("OpenClaw agent accepted runId={}", run_id)
        return run_id

    async def _call_agent_wait(
        self,
        *,
        run_id: str,
        timeout_s: int,
        progress_callback: Callable | None,
    ) -> None:
        """Send agent.wait and pump progress_callback every 10s while it blocks.

        The gateway's agent.wait itself blocks for up to timeoutMs. We issue a
        single long-lived request and poll the future with a progress interval,
        so the frontend's tool card keeps its live-timer ticking.
        """
        req_id = _new_id()
        timeout_ms = max(1000, int(timeout_s) * 1000)
        frame = OpenClawProtocol.build_agent_wait_frame(req_id, run_id, timeout_ms)

        loop = asyncio.get_event_loop()
        fut: asyncio.Future[dict] = loop.create_future()
        self._pending[req_id] = fut
        try:
            await self._ws.send(json.dumps(frame))  # type: ignore[union-attr]

            elapsed = 0
            interval = 10
            # Give agent.wait an extra 5s grace beyond its own timeoutMs so we
            # don't cut the client side off early.
            hard_deadline = timeout_s + 5
            while elapsed < hard_deadline:
                try:
                    res = await asyncio.wait_for(
                        asyncio.shield(fut),
                        timeout=min(interval, hard_deadline - elapsed),
                    )
                    break
                except asyncio.TimeoutError:
                    elapsed += interval
                    if progress_callback and elapsed < hard_deadline:
                        try:
                            await progress_callback(elapsed, timeout_s)
                        except Exception:
                            pass
            else:
                # No break → exceeded hard deadline
                raise TimeoutError(
                    f"OpenClaw agent.wait did not return within {hard_deadline}s"
                )
        finally:
            self._pending.pop(req_id, None)

        if not res.get("ok"):
            raise RuntimeError(OpenClawProtocol.parse_error(res))

        payload = res.get("payload") or {}
        status = payload.get("status")
        if status == "timeout":
            raise TimeoutError(
                f"OpenClaw agent run timed out after {timeout_s}s (runId={run_id})"
            )
        if status == "error":
            err = payload.get("error") or "unknown error"
            raise RuntimeError(f"OpenClaw agent run failed: {err}")
        # status == "ok" — done
        logger.debug("OpenClaw agent.wait ok runId={}", run_id)

    async def _call_chat_history_for_reply(self, session_key: str) -> str | None:
        req_id = _new_id()
        frame = OpenClawProtocol.build_chat_history_frame(req_id, session_key, limit=50)
        res = await self._send_and_await_res(req_id, frame, timeout=15)
        if not res.get("ok"):
            logger.warning(
                "OpenClaw chat.history failed: {}", OpenClawProtocol.parse_error(res)
            )
            return None
        payload = res.get("payload") or {}
        return OpenClawProtocol.extract_latest_assistant_reply(payload)

    async def _send_and_await_res(
        self, req_id: str, frame: dict, timeout: float
    ) -> dict:
        """Send a req frame and await its matching res via the pending-futures map."""
        loop = asyncio.get_event_loop()
        fut: asyncio.Future[dict] = loop.create_future()
        self._pending[req_id] = fut
        try:
            await self._ws.send(json.dumps(frame))  # type: ignore[union-attr]
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending.pop(req_id, None)

    # --- Internal: frame handling ---

    async def _await_challenge(self) -> str:
        """Wait for the server's first frame (connect.challenge event)."""
        raw = await asyncio.wait_for(self._ws.recv(), timeout=10)  # type: ignore[union-attr]
        try:
            frame = json.loads(raw)
        except (json.JSONDecodeError, TypeError) as e:
            raise RuntimeError(f"Invalid challenge frame: {e}")
        if frame.get("type") != "event" or frame.get("event") != "connect.challenge":
            raise RuntimeError(f"Expected connect.challenge, got: {frame!r}")
        payload = frame.get("payload") or {}
        nonce = payload.get("nonce")
        if not nonce or not isinstance(nonce, str):
            raise RuntimeError("connect.challenge missing nonce")
        return nonce

    async def _read_until_res(
        self, req_id: str, fut: asyncio.Future[dict]
    ) -> dict:
        """Read frames until we see the res matching req_id (pre-listener phase)."""
        while True:
            if fut.done():
                return fut.result()
            raw = await self._ws.recv()  # type: ignore[union-attr]
            try:
                frame = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue
            if frame.get("type") == "res" and frame.get("id") == req_id:
                if not fut.done():
                    fut.set_result(frame)
                return frame
            # Ignore other frames during handshake

    async def _event_listener(self) -> None:
        """Dispatch incoming frames to pending futures or log events."""
        try:
            async for raw in self._ws:  # type: ignore[union-attr]
                try:
                    frame = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue

                ftype = frame.get("type")
                if ftype == "res":
                    msg_id = frame.get("id")
                    if msg_id and msg_id in self._pending:
                        pending = self._pending[msg_id]
                        if not pending.done():
                            pending.set_result(frame)
                elif ftype == "event":
                    event_name = frame.get("event")
                    logger.debug("OpenClaw event: {}", event_name)
                # ignore other frame types
        except ConnectionClosed:
            logger.warning("OpenClaw WS connection closed")
        except asyncio.CancelledError:
            return
        except Exception as e:
            logger.warning("OpenClaw listener error: {}", e)
        finally:
            self._connected = False
            # Fail remaining futures
            for f in list(self._pending.values()):
                if not f.done():
                    f.set_exception(ConnectionError("Connection lost"))
            self._pending.clear()
            if not self._shutdown:
                self._start_reconnect()

    async def _tick_loop(self) -> None:
        """Send periodic tick frames at half the server's tickIntervalMs."""
        interval = max(1.0, (self._tick_interval_ms / 2) / 1000.0)
        try:
            while self._connected and not self._shutdown:
                await asyncio.sleep(interval)
                if not self._connected or self._ws is None:
                    return
                try:
                    frame = OpenClawProtocol.build_tick_frame(_new_id())
                    await self._ws.send(json.dumps(frame))
                except Exception as e:
                    logger.debug("OpenClaw tick send failed: {}", e)
                    # Don't fail reconnect on tick errors
        except asyncio.CancelledError:
            return

    # --- Internal: reconnect + shutdown ---

    def _start_reconnect(self) -> None:
        if self._shutdown:
            return
        if self._reconnect_task and not self._reconnect_task.done():
            return
        self._reconnect_task = asyncio.create_task(self._reconnect_loop())

    async def _reconnect_loop(self) -> None:
        backoff = 1
        max_backoff = 60
        try:
            while not self._connected and not self._shutdown:
                logger.info("OpenClaw reconnecting in {}s...", backoff)
                await asyncio.sleep(backoff)
                if self._shutdown:
                    return
                try:
                    await self.connect()
                    if self._connected:
                        logger.info("OpenClaw reconnected successfully")
                        return
                    # If connect() set an error and did not schedule another
                    # reconnect (e.g. PAIRING_REQUIRED), stop the loop.
                    if self._error_message and not (
                        self._reconnect_task and self._reconnect_task is not asyncio.current_task()
                    ):
                        if self._error_message.startswith("Pairing required"):
                            logger.warning(
                                "OpenClaw reconnect halted: {}", self._error_message
                            )
                            return
                except Exception as e:
                    logger.warning("OpenClaw reconnect failed: {}", e)
                backoff = min(backoff * 2, max_backoff)
        except asyncio.CancelledError:
            return

    async def _close_ws_silent(self) -> None:
        ws = self._ws
        self._ws = None
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Module-level bridge registry (one bridge per username)
# ---------------------------------------------------------------------------

_bridges: dict[str, OpenClawBridge] = {}


def register_bridge(username: str, bridge: OpenClawBridge) -> None:
    # Replace any prior bridge cleanly — prevents duplicate instances after
    # uvicorn --reload leaks a previous lifespan's bridge.
    prior = _bridges.get(username)
    if prior is not None and prior is not bridge:
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(prior.disconnect())
        except Exception:
            pass
    _bridges[username] = bridge


def unregister_bridge(username: str) -> None:
    _bridges.pop(username, None)


def get_bridge(username: str) -> OpenClawBridge | None:
    return _bridges.get(username)
