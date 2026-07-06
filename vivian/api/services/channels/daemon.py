"""
Channel Daemon — standalone async process.

Run with: python -m api.services.channels.daemon
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

# Ensure project root is on sys.path so relative imports work
_daemon_file = Path(__file__).resolve()
_project_root = _daemon_file.parent.parent.parent.parent  # vivian/api/services/channels -> vivian
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

# Remove CLAUDECODE env var to prevent "nested session" error from Claude SDK
os.environ.pop("CLAUDECODE", None)

from aibot import WSClient, WSClientOptions, generate_req_id

from api.middleware.logging import configure_logging, get_channels_logger
from api.models.channels import OpenClawChannelConfig, WeComChannelConfig
from api.services.audit_log import AuditEntry, get_audit_logger
from api.services.channels.config_store import ChannelConfigStore
from api.services.channels.wecom_feedback import (
    answer_line,
    build_permission_card,
    build_question_card,
    parse_card_event,
    parse_permission_text,
    parse_question_answer,
    render_options_detail,
    render_permission_detail,
    render_permission_text,
    render_question_text,
    value_from_card_selection,
)
from api.services.channels.shared import (
    get_channels_dir,
    get_commands_dir,
    get_heartbeat_path,
    get_sessions_path,
    get_state_path,
)
from api.services.config import get_settings
from api.services.user_env import read_user_env
from api.services.user_store import get_user_store

logger = get_channels_logger("daemon")

_sdk_ssl_patched = False


def _patch_sdk_ssl_for_ws():
    """Monkey-patch the aibot SDK to skip SSL when connecting to ws:// URLs.

    The SDK hardcodes `ssl=_SSL_CONTEXT` in every `websockets.connect()` call,
    which fails for ws:// (non-TLS) URLs. We replace the connect method in
    WsConnectionManager to conditionally drop the ssl argument.
    """
    global _sdk_ssl_patched
    if _sdk_ssl_patched:
        return
    _sdk_ssl_patched = True

    import aibot.ws as _aibot_ws
    _original_connect = _aibot_ws.WsConnectionManager.connect

    async def _patched_connect(self):
        # Temporarily nullify SSL for ws:// URLs
        if self._ws_url and self._ws_url.startswith("ws://"):
            old_ssl = _aibot_ws._SSL_CONTEXT
            _aibot_ws._SSL_CONTEXT = None
            try:
                return await _original_connect(self)
            finally:
                _aibot_ws._SSL_CONTEXT = old_ssl
        else:
            return await _original_connect(self)

    _aibot_ws.WsConnectionManager.connect = _patched_connect
    logger.info("Patched aibot SDK SSL for ws:// proxy support")


_sdk_proxy_patched = False


def _patch_sdk_connect_proxy():
    """Monkey-patch the aibot SDK to tunnel through an HTTP CONNECT proxy.

    The SDK calls `websockets.connect(self._ws_url, ...)` with no proxy
    argument, so it always dials the WeCom endpoint directly. When a
    connection manager carries a `_vivian_http_proxy` attribute, we inject
    `proxy=<url>` into that call so the wss:// handshake is tunneled via the
    forward proxy (e.g. Squid) instead of being sent to it origin-form
    (which the proxy rejects with HTTP 400 ERR_INVALID_URL).

    websockets >= 15 understands `proxy=` and performs an HTTP CONNECT to the
    proxy before the TLS+WS handshake to the real ws_url.
    """
    global _sdk_proxy_patched
    if _sdk_proxy_patched:
        return
    _sdk_proxy_patched = True

    import aibot.ws as _aibot_ws
    _original_connect = _aibot_ws.WsConnectionManager.connect

    async def _patched_connect(self):
        proxy = getattr(self, "_vivian_http_proxy", None)
        if not proxy:
            return await _original_connect(self)
        # Temporarily wrap the module-level websockets.connect to inject the
        # CONNECT proxy for this connection. Mirrors the SSL patch's
        # temporary-swap pattern.
        _orig_ws_connect = _aibot_ws.websockets.connect

        def _connect_with_proxy(*args, **kwargs):
            kwargs.setdefault("proxy", proxy)
            return _orig_ws_connect(*args, **kwargs)

        _aibot_ws.websockets.connect = _connect_with_proxy
        try:
            return await _original_connect(self)
        finally:
            _aibot_ws.websockets.connect = _orig_ws_connect

    _aibot_ws.WsConnectionManager.connect = _patched_connect
    logger.info("Patched aibot SDK connect for HTTP CONNECT proxy support")


# --- Frame normalizer ---

@dataclass
class NormalizedMessage:
    sender_id: str
    chat_id: str | None
    text: str
    raw_frame: dict
    chat_type: str | None = None   # WeCom "chattype": "single" | "group"


def normalize_wecom_frame(frame: dict) -> NormalizedMessage | None:
    """Extract sender_id, chat_id, text from a WeCom frame with tolerant lookups."""
    body = frame.get("body", {})
    if not isinstance(body, dict):
        logger.warning("Frame body is not a dict: {}", str(frame)[:200])
        return None

    # Extract sender_id from multiple possible paths
    sender_id = None
    from_field = body.get("from", {})
    if isinstance(from_field, dict):
        sender_id = from_field.get("user_id") or from_field.get("userid")
    if not sender_id:
        sender_id = body.get("from_userid") or body.get("sender")
    if not sender_id:
        logger.warning("Cannot extract sender_id from frame: {}", str(body)[:200])
        return None

    # Extract chat_id
    chat_id = body.get("chatid") or body.get("chat_id") or None

    # Extract chat type ("single" | "group"); governs access control downstream.
    chat_type = body.get("chattype") or body.get("chat_type") or None

    # Extract text
    text_field = body.get("text", {})
    text = ""
    if isinstance(text_field, dict):
        text = text_field.get("content", "")
    elif isinstance(text_field, str):
        text = text_field
    text = text.strip()

    if not text:
        return None

    return NormalizedMessage(
        sender_id=sender_id,
        chat_id=chat_id,
        text=text,
        raw_frame=frame,
        chat_type=chat_type,
    )


def wecom_access_allowed(
    *,
    chat_type: str | None,
    mode: str,
    sender_id: str,
    owner_username: str,
    allowed_user_ids: list[str],
) -> bool:
    """Decide whether ``sender_id`` may use the bot in this chat.

    Group chats are always open — anyone in the group can @-trigger the bot.
    Single (1:1) chats consult ``mode``:
      - ``"all"``              → anyone who can DM the bot
      - ``"private"``          → only the owner (sender == ``owner_username``,
                                 matched case-insensitively)
      - ``"allowed_user_ids"`` → sender must be in ``allowed_user_ids``; an empty
                                 list means allow-all (so a new operator can
                                 discover user IDs before locking the bot down)

    Any unrecognized ``mode`` falls back to the conservative whitelist behavior.
    """
    if (chat_type or "").strip().lower() == "group":
        return True
    if mode == "all":
        return True
    if mode == "private":
        return bool(sender_id) and sender_id.strip().lower() == (owner_username or "").strip().lower()
    # "allowed_user_ids" (and any unknown mode → safe whitelist semantics)
    if allowed_user_ids:
        return sender_id in allowed_user_ids
    return True


async def _quick_reply(client: WSClient, frame: dict, text: str) -> None:
    """Send a short text reply via reply_stream (WeCom requires stream format for aibot_respond_msg)."""
    stream_id = generate_req_id("stream")
    await client.reply_stream(frame, stream_id, text, finish=True)


# --- Internal data structures ---

@dataclass
class UserSession:
    session_id: str | None
    wecom_user_id: str
    last_activity: float  # time.monotonic()


@dataclass
class MessageQueueItem:
    frame: dict
    text: str
    wecom_user_id: str
    chat_id: str | None


@dataclass
class PendingFeedback:
    """A user-feedback request blocking an in-flight agent run for one chat.

    Created when the run emits ``permission_request``; cleared when the user
    answers (card tap or text), the per-question timer fires, or the run ends.
    Invariant: at most one PendingFeedback per ``chat_key`` at a time.
    """
    coordinator: Any                    # PermissionCoordinator (resolved in-process)
    request_id: str
    kind: str                           # "ask_user" | "permission"
    asker_id: str                       # only this userid may answer (decision 11)
    chatid: str                         # send target for cards / echoes / result
    frame: dict | None = None           # original frame, for _quick_reply fallback
    questions: list = field(default_factory=list)   # ask_user only
    q_idx: int = 0                                   # current question (ask_user)
    collected: list = field(default_factory=list)    # answer_line() strings
    reprompts: int = 0                               # permission unrecognised count
    timer: Any = None                                # asyncio.TimerHandle
    timer_gen: int = 0                               # bumped on each (re)arm; guards stale fires


@dataclass
class UserConnection:
    username: str
    config: WeComChannelConfig
    client: WSClient | None = None
    status: str = "disconnected"
    connected_at: datetime | None = None
    error_message: str | None = None
    sessions: dict = field(default_factory=dict)           # wecom_user_key -> UserSession
    queues: dict = field(default_factory=dict)              # wecom_user_key -> list[MessageQueueItem]
    active_runs: dict = field(default_factory=dict)         # wecom_user_key -> asyncio.Task
    pending: dict = field(default_factory=dict)             # chat_key -> PendingFeedback
    messages_handled: int = 0


class ChannelDaemon:
    def __init__(self):
        self._settings = get_settings()
        self._config_store = ChannelConfigStore()
        self._connections: dict[str, UserConnection] = {}
        self._oc_bridges: dict[str, Any] = {}  # username -> OpenClawBridge
        self._shutdown_requested = False
        # Log the first template_card_event raw frame at INFO so the live test
        # can confirm the (undocumented) callback field names (plan decision 12).
        self._card_event_logged = False
        # Strong refs to fire-and-forget tasks (timeout handlers) so the event
        # loop does not GC them mid-flight.
        self._bg_tasks: set = set()

    async def start(self) -> None:
        configure_logging(self._settings)
        logger.info("Channel daemon starting...")

        # Create directories
        for d in (get_channels_dir(), get_commands_dir()):
            d.mkdir(parents=True, exist_ok=True)
        failed_dir = get_commands_dir() / "failed"
        failed_dir.mkdir(parents=True, exist_ok=True)

        # Register signal handlers
        loop = asyncio.get_event_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, self._signal_handler)

        # Auto-connect all enabled users
        await self._auto_connect_all()

        # Process any leftover commands (crash recovery)
        await self._process_pending_commands()

        # Write initial heartbeat + state
        self._write_heartbeat()
        self._update_state_file()

        # Main loop
        poll_interval = self._settings.channels.command_poll_interval
        heartbeat_interval = self._settings.channels.heartbeat_interval
        session_cleanup_interval = 60.0
        last_heartbeat = time.monotonic()
        last_session_cleanup = time.monotonic()

        while not self._shutdown_requested:
            await self._process_pending_commands()

            now = time.monotonic()
            if now - last_heartbeat >= heartbeat_interval:
                self._write_heartbeat()
                self._update_state_file()
                last_heartbeat = now

            if now - last_session_cleanup >= session_cleanup_interval:
                self._cleanup_idle_sessions()
                last_session_cleanup = now

            await asyncio.sleep(poll_interval)

        await self._shutdown()

    def _signal_handler(self) -> None:
        logger.info("Received shutdown signal")
        self._shutdown_requested = True

    # --- Auto-connect ---

    async def _auto_connect_all(self) -> None:
        enabled = self._config_store.list_enabled_configs()
        total = 0
        for username, config in enabled.items():
            try:
                await self._connect_user(username, config)
                total += 1
            except Exception as e:
                logger.error("Failed to auto-connect user {}: {}", username, e)
        logger.info("Auto-connected {} WeCom users", total)

        # Auto-connect OpenClaw bridges
        oc_configs = self._config_store.list_enabled_openclaw_configs()
        oc_total = 0
        for username, oc_config in oc_configs.items():
            try:
                await self._connect_openclaw_user(username, oc_config)
                oc_total += 1
            except Exception as e:
                logger.error("Failed to auto-connect OpenClaw for user {}: {}", username, e)
        if oc_total:
            logger.info("Auto-connected {} OpenClaw bridges", oc_total)

    # --- Connect / Disconnect ---

    async def _connect_user(self, username: str, config: WeComChannelConfig) -> None:
        if not config.bot_id or not config.secret:
            logger.warning("Cannot connect user {} — missing bot_id or secret", username)
            return

        # Duplicate bot_id check
        for other_username, conn in self._connections.items():
            if other_username != username and conn.config.bot_id == config.bot_id and conn.status == "connected":
                logger.error(
                    "Cannot connect user {} — bot_id {} already active for user {}",
                    username, config.bot_id, other_username,
                )
                self._connections[username] = UserConnection(
                    username=username,
                    config=config,
                    status="error",
                    error_message=f"Bot ID already in use by user '{other_username}'",
                )
                return

        # Verify API credentials
        env = read_user_env(username)
        if not env or not env.get("ANTHROPIC_BASE_URL") or not env.get("ANTHROPIC_AUTH_TOKEN"):
            logger.warning("No API credentials for user {}, skipping connect", username)
            self._connections[username] = UserConnection(
                username=username,
                config=config,
                status="error",
                error_message="API credentials not configured",
            )
            return

        # Load persisted sessions
        sessions = self._load_sessions(username)

        # Create WSClient
        options = WSClientOptions(
            bot_id=config.bot_id,
            secret=config.secret,
            max_reconnect_attempts=-1,  # Infinite reconnect for production
        )
        # Route through proxy if configured. Two modes, by URL scheme:
        #   - ws:// | wss://  → relay proxy: the SDK dials it as the WS endpoint
        #     (override ws_url, legacy behavior).
        #   - http:// | https:// → forward/CONNECT proxy (e.g. Squid): keep the
        #     real WeCom ws_url and tunnel the handshake through the proxy.
        proxy_url = config.ws_proxy_url
        is_http_proxy = bool(proxy_url) and proxy_url.startswith(("http://", "https://"))
        if proxy_url and not is_http_proxy:
            options.ws_url = proxy_url
            logger.info("Using WS relay proxy for user {}: {}", username, proxy_url)
        elif is_http_proxy:
            # ws_url stays as the SDK default (wss://openws.work.weixin.qq.com)
            logger.info("Using HTTP CONNECT proxy for user {}: {}", username, proxy_url)
        client = WSClient(options)

        # Patch SDK SSL for ws:// relay proxy URLs (SDK hardcodes ssl=_SSL_CONTEXT on every connect)
        if proxy_url and proxy_url.startswith("ws://"):
            _patch_sdk_ssl_for_ws()

        # For an HTTP CONNECT proxy, inject the proxy into the SDK's websockets.connect call
        if is_http_proxy:
            _patch_sdk_connect_proxy()
            client._ws_manager._vivian_http_proxy = proxy_url

        conn = UserConnection(
            username=username,
            config=config,
            client=client,
            status="connecting",
            sessions=sessions,
        )
        self._connections[username] = conn

        # Register event handlers
        @client.on("authenticated")
        def on_authenticated():
            conn.status = "connected"
            conn.connected_at = datetime.now(timezone.utc)
            conn.error_message = None
            logger.info("WeCom bot authenticated for user {}", username)

        @client.on("disconnected")
        def on_disconnected(reason=None):
            conn.status = "disconnected"
            logger.info("WeCom bot disconnected for user {}: {}", username, reason)

        @client.on("reconnecting")
        def on_reconnecting(attempt=None):
            conn.status = "connecting"
            logger.info("WeCom bot reconnecting for user {} (attempt {})", username, attempt)

        @client.on("error")
        def on_error(error=None):
            error_str = str(error) if error else "Unknown error"
            logger.error("WeCom bot error for user {}: {}", username, error_str)

            # Detect auth failure — treat as terminal
            if error_str and ("subscribe" in error_str.lower() or "auth" in error_str.lower()
                              or "认证" in error_str or "errcode" in error_str.lower()):
                conn.status = "auth_failed"
                conn.error_message = error_str
                logger.error("Auth failure detected for user {}, disconnecting", username)
                client.disconnect()
            else:
                conn.status = "error"
                conn.error_message = error_str

        @client.on("message.text")
        async def on_text(frame):
            await self._handle_text_message(username, frame)

        @client.on("message.image")
        async def on_image(frame):
            await self._handle_unsupported_message(username, frame, "图片")

        @client.on("message.voice")
        async def on_voice(frame):
            await self._handle_unsupported_message(username, frame, "语音")

        @client.on("message.file")
        async def on_file(frame):
            await self._handle_unsupported_message(username, frame, "文件")

        @client.on("event.enter_chat")
        async def on_enter_chat(frame):
            await self._handle_welcome(username, frame)

        @client.on("event.template_card_event")
        async def on_card_event(frame):
            await self._handle_card_event(username, frame)

        # Connect (async, non-blocking)
        try:
            await client.connect()
        except Exception as e:
            conn.status = "error"
            conn.error_message = str(e)
            logger.error("Failed to connect WeCom for user {}: {}", username, e)

    async def _disconnect_user(self, username: str) -> None:
        conn = self._connections.get(username)
        if not conn:
            return

        # Cancel all active runs
        for task in list(conn.active_runs.values()):
            task.cancel()

        if conn.client:
            try:
                conn.client.disconnect()
            except Exception as e:
                logger.warning("Error disconnecting WeCom for user {}: {}", username, e)

        # Save sessions before removing
        self._save_sessions(username, conn.sessions)

        del self._connections[username]
        logger.info("Disconnected WeCom for user {}", username)

    # --- Message handling ---

    async def _handle_welcome(self, username: str, frame: dict) -> None:
        conn = self._connections.get(username)
        if not conn or not conn.client:
            return

        # Access control for welcome (group = open; single = per configured mode).
        # Silent rejection — an unauthorized user simply gets no greeting.
        body = frame.get("body", {})
        from_field = body.get("from", {})
        sender_id = from_field.get("user_id", "") if isinstance(from_field, dict) else ""
        chat_type = body.get("chattype") or body.get("chat_type") or None
        if sender_id and not wecom_access_allowed(
            chat_type=chat_type,
            mode=conn.config.single_chat_access_mode,
            sender_id=sender_id,
            owner_username=username,
            allowed_user_ids=conn.config.allowed_user_ids,
        ):
            return  # Silent rejection for welcome
        logger.debug("Sending welcome to wecom_user={}", sender_id)

        try:
            await conn.client.reply_welcome(frame, {
                "msgtype": "text",
                "text": {"content": conn.config.welcome_message},
            })
        except Exception as e:
            logger.error("Welcome reply failed for {}: {}", username, e)

    async def _handle_unsupported_message(self, username: str, frame: dict, msg_type: str) -> None:
        conn = self._connections.get(username)
        if not conn or not conn.client:
            return
        try:
            await _quick_reply(conn.client, frame, f"抱歉，暂不支持{msg_type}消息，请发送文字消息。")
        except Exception as e:
            logger.error("Unsupported message reply failed for {}: {}", username, e)

    async def _handle_text_message(self, username: str, frame: dict) -> None:
        conn = self._connections.get(username)
        if not conn or not conn.client:
            return

        logger.debug("Received text message for user {}: {}", username, str(frame)[:500])

        msg = normalize_wecom_frame(frame)
        if not msg:
            logger.warning("Failed to normalize frame for user {}, skipping", username)
            return

        logger.info(
            "Message from wecom_user={} chat_id={} text={!r}",
            msg.sender_id, msg.chat_id, msg.text[:100],
        )

        # --- Pending user-feedback interception (must come before the queue) ---
        # If this chat has an in-flight question / confirm, the asker's next
        # text reply IS the answer — route it to the state machine and never
        # enqueue it as a new prompt. Non-askers are ignored (decision 11).
        chat_key = msg.chat_id or msg.sender_id
        pending = conn.pending.get(chat_key)
        if pending is not None:
            if msg.sender_id != pending.asker_id:
                logger.info(
                    "Ignoring text from non-asker {} during pending feedback (chat_key={})",
                    msg.sender_id, chat_key,
                )
                return
            if msg.text.strip().lower() == "/reset":
                # Universal escape hatch: abandon the pending request.
                if pending.kind == "ask_user":
                    await self._resolve_pending(conn, chat_key, "deny", message="user did not answer")
                    await self._send_text(conn, pending.chatid, "已跳过本次询问。", pending.frame)
                else:
                    await self._resolve_pending(conn, chat_key, "deny", message="user declined")
                    await self._send_text(conn, pending.chatid, "已取消该操作。", pending.frame)
                return
            if pending.kind == "ask_user":
                await self._handle_ask_user_answer(conn, chat_key, pending, msg.text)
            else:
                await self._handle_permission_answer(conn, chat_key, pending, msg.text)
            return

        # Handle /reset command — clear session for this user
        if msg.text.strip().lower() == "/reset":
            wecom_user_key = msg.chat_id or msg.sender_id
            removed = conn.sessions.pop(wecom_user_key, None)
            if removed:
                self._save_sessions(username, conn.sessions)
            logger.info("Session reset for wecom_user_key={}", wecom_user_key)
            try:
                await _quick_reply(conn.client, frame, "✅ 会话已重置，下一条消息将开始新对话。")
            except Exception as e:
                logger.error("Failed to send reset reply: {}", e)
            return

        # Access control gate. Group chats are open; single chats follow the
        # configured mode (all / allowed_user_ids / private).
        if not wecom_access_allowed(
            chat_type=msg.chat_type,
            mode=conn.config.single_chat_access_mode,
            sender_id=msg.sender_id,
            owner_username=username,
            allowed_user_ids=conn.config.allowed_user_ids,
        ):
            logger.info(
                "Rejecting message from unauthorized user {} (mode={}, chat_type={})",
                msg.sender_id, conn.config.single_chat_access_mode, msg.chat_type,
            )
            try:
                await _quick_reply(conn.client, frame, conn.config.reject_message)
            except Exception as e:
                logger.error("Failed to send rejection reply: {}", e)
            return

        wecom_user_key = msg.chat_id or msg.sender_id
        queue = conn.queues.setdefault(wecom_user_key, [])

        # Queue full?
        if len(queue) >= conn.config.max_queue_size:
            try:
                await _quick_reply(conn.client, frame, "⚠️ 队列已满，请稍后再试")
            except Exception:
                pass
            return

        # Acknowledge if something is already running
        if queue or wecom_user_key in conn.active_runs:
            try:
                await _quick_reply(conn.client, frame, f"⏳ 收到，排队中 ({len(queue) + 1}/{conn.config.max_queue_size})")
            except Exception:
                pass

        item = MessageQueueItem(
            frame=frame,
            text=msg.text,
            wecom_user_id=msg.sender_id,
            chat_id=msg.chat_id,
        )
        queue.append(item)

        # Start processing if not already running
        if wecom_user_key not in conn.active_runs:
            task = asyncio.create_task(self._process_queue(username, wecom_user_key))
            conn.active_runs[wecom_user_key] = task

    async def _process_queue(self, username: str, wecom_user_key: str) -> None:
        conn = self._connections.get(username)
        if not conn:
            return

        try:
            while conn.queues.get(wecom_user_key):
                item = conn.queues[wecom_user_key].pop(0)
                await self._run_agent_for_message(username, wecom_user_key, item)
        except asyncio.CancelledError:
            logger.info("Queue processing cancelled for {}/{}", username, wecom_user_key)
        except Exception as e:
            logger.exception("Queue processing error for {}/{}: {}", username, wecom_user_key, e)
        finally:
            conn.active_runs.pop(wecom_user_key, None)

    async def _run_agent_for_message(
        self, username: str, wecom_user_key: str, item: MessageQueueItem
    ) -> None:
        conn = self._connections.get(username)
        if not conn or not conn.client:
            return

        # Get or create session
        session = conn.sessions.get(wecom_user_key)
        if session:
            session.last_activity = time.monotonic()
        else:
            session = UserSession(
                session_id=None,
                wecom_user_id=item.wecom_user_id,
                last_activity=time.monotonic(),
            )
            conn.sessions[wecom_user_key] = session

        # Stream lifecycle: one stream_id for progress + final result
        stream_id = generate_req_id("stream")
        result_text = ""
        result_session_id = None
        cancelled = asyncio.Event()
        started_at = time.monotonic()
        progress_sent = False

        # coordinator_out[0] is populated by agent_run_events at start-up so a
        # WeCom reply can resolve the in-flight permission in-process. feedback
        # is on per config (decision 9/10); when off the run is unattended (as
        # before) and no card / pending state is ever created.
        coordinator_out: list = [None]
        enable_feedback = bool(conn.config.enable_permission_feedback)
        feedback_used = False

        async def emit(event_type: str, data: dict) -> None:
            nonlocal result_text, result_session_id, progress_sent, feedback_used

            # Send "processing" progress after 5s (once). Skip once a feedback
            # exchange is under way — the original frame's stream cannot survive
            # a multi-minute human wait, so we deliver proactively instead.
            elapsed = time.monotonic() - started_at
            if elapsed >= 5 and not progress_sent and not feedback_used and conn.client:
                progress_sent = True
                try:
                    await conn.client.reply_stream(
                        item.frame, stream_id, "⏳ 处理中...", finish=False
                    )
                except Exception:
                    pass

            if event_type == "stream_init":
                # Raise the coordinator's own backstop so the daemon's
                # per-question timer is the sole timeout authority — a slow but
                # answering user across several questions could otherwise exceed
                # the 600s default and fire a spurious permission_timeout.
                coord = coordinator_out[0]
                if coord is not None:
                    coord.timeout = 86400

            elif event_type == "permission_request":
                feedback_used = True
                await self._on_permission_request(
                    conn, wecom_user_key, item, coordinator_out[0], data
                )

            elif event_type == "permission_timeout":
                # Defensive only — rarely reached now the backstop is raised.
                await self._on_permission_timeout_event(conn, wecom_user_key, data)

            if event_type == "result":
                result_text = data.get("result", "")
                result_session_id = data.get("session_id")

        try:
            from api.services.claude_sdk.service import agent_run_events

            cwd = os.path.join(
                os.path.expanduser(self._settings.server.work_dir),
                username,
            )

            async def _do_agent_run(sid: str | None) -> None:
                await agent_run_events(
                    prompt=item.text,
                    session_id=sid,
                    permission_mode="bypassPermissions",
                    cwd=cwd,
                    username=username,
                    model_override=conn.config.model,
                    emit=emit,
                    cancelled=cancelled,
                    coordinator_out=coordinator_out,
                    enable_permission_feedback=enable_feedback,
                )

            try:
                await _do_agent_run(session.session_id)
            except Exception as first_err:
                if session.session_id:
                    # Resume with stale session may fail — clear and retry
                    logger.warning(
                        "Agent run failed with session {}, retrying without resume: {}",
                        session.session_id, first_err,
                    )
                    session.session_id = None
                    self._save_sessions(username, conn.sessions)
                    await _do_agent_run(None)
                else:
                    raise

            # Update session_id for continuity
            if result_session_id:
                session.session_id = result_session_id
                self._save_sessions(username, conn.sessions)

            # Send reply
            chatid = item.chat_id or item.wecom_user_id
            if result_text:
                if feedback_used:
                    # A human exchange happened — the original frame's stream is
                    # likely stale, so push the result proactively (own req_id).
                    await self._deliver_proactive(conn, chatid, result_text, item.frame)
                elif progress_sent:
                    # Continue the existing stream with final result
                    await conn.client.reply_stream(
                        item.frame, stream_id, result_text, finish=True
                    )
                elif len(result_text) > 4000:
                    # Long result — use streaming
                    await self._send_streamed_reply(conn, item.frame, stream_id, result_text)
                else:
                    # Short result — use stream reply
                    await conn.client.reply_stream(
                        item.frame, stream_id, result_text, finish=True
                    )
            else:
                if feedback_used:
                    await self._deliver_proactive(conn, chatid, "处理完成，但没有返回结果。", item.frame)
                else:
                    await _quick_reply(conn.client, item.frame, "处理完成，但没有返回结果。")

            conn.messages_handled += 1

            audit = get_audit_logger()
            audit.append(AuditEntry(
                actor=f"channel:wecom:{username}",
                action="channel.message_handled",
                target=wecom_user_key,
                details={"prompt_preview": item.text[:100]},
            ))

        except Exception as e:
            logger.exception("Agent run failed for {}/{}: {}", username, wecom_user_key, e)
            try:
                await _quick_reply(conn.client, item.frame, f"❌ 处理出错: {str(e)[:200]}")
            except Exception:
                pass
        finally:
            # Clear any pending feedback this run left behind (run ended,
            # errored, or was cancelled mid-question). agent_run_events already
            # cancels its coordinator futures in its own finally; here we drop
            # the daemon-side state + timer and, defensively, release any future
            # still waiting so the SDK callback never hangs.
            pending = conn.pending.pop(wecom_user_key, None)
            if pending is not None:
                if pending.timer is not None:
                    try:
                        pending.timer.cancel()
                    except Exception:
                        pass
                    pending.timer = None
                coord = coordinator_out[0]
                if coord is not None:
                    try:
                        coord.cancel_all()
                    except Exception:
                        pass

    # --- User-feedback: cards, state machine, timers --------------------

    async def _on_permission_request(
        self, conn: UserConnection, chat_key: str, item: MessageQueueItem,
        coordinator: Any, data: dict,
    ) -> None:
        """Turn a ``permission_request`` event into a pending feedback exchange."""
        if coordinator is None:
            logger.warning(
                "permission_request with no coordinator; cannot collect feedback (chat_key={})",
                chat_key,
            )
            return

        request_id = data.get("request_id")
        kind = data.get("kind") or "permission"
        chatid = item.chat_id or item.wecom_user_id
        asker_id = item.wecom_user_id

        # Invariant: at most one pending request per chat. Drop any stale one.
        old = conn.pending.pop(chat_key, None)
        if old is not None and old.timer is not None:
            try:
                old.timer.cancel()
            except Exception:
                pass

        if kind == "ask_user":
            inp = data.get("input")
            questions = inp.get("questions") if isinstance(inp, dict) else None
            questions = list(questions) if questions else []
            if not questions:
                # Nothing to ask — deny so the run does not hang.
                try:
                    coordinator.resolve(request_id, "deny", "user did not answer")
                except Exception as e:
                    logger.warning("resolve(empty ask_user) failed: {}", e)
                return
            pending = PendingFeedback(
                coordinator=coordinator, request_id=request_id, kind="ask_user",
                asker_id=asker_id, chatid=chatid, frame=item.frame,
                questions=questions, q_idx=0,
            )
            conn.pending[chat_key] = pending
            logger.info(
                "[FEEDBACK] ask_user pending request_id={} questions={} chat_key={}",
                request_id, len(questions), chat_key,
            )
            await self._send_question(conn, pending)
        else:
            pending = PendingFeedback(
                coordinator=coordinator, request_id=request_id, kind="permission",
                asker_id=asker_id, chatid=chatid, frame=item.frame,
            )
            conn.pending[chat_key] = pending
            logger.info(
                "[FEEDBACK] permission pending request_id={} tool={} chat_key={}",
                request_id, data.get("tool_name"), chat_key,
            )
            # Card shows the confirm buttons + a one-line command preview; the
            # companion text carries the full command + reason + rule so the
            # user always sees exactly what they are approving. On card
            # rejection, the full self-contained render stands on its own.
            ok = await self._send_card(conn, chatid, build_permission_card(request_id, data), item.frame)
            if ok:
                await self._send_text(conn, chatid, render_permission_detail(data), item.frame)
            else:
                await self._send_text(conn, chatid, render_permission_text(data), item.frame)

        self._arm_timer(conn, chat_key)

    async def _on_permission_timeout_event(
        self, conn: UserConnection, chat_key: str, data: dict
    ) -> None:
        """Defensive cleanup if the coordinator's own backstop fired anyway.

        The coordinator already denied the future before emitting this event,
        so we only clear daemon-side state and notify the user — never resolve.
        """
        pending = conn.pending.pop(chat_key, None)
        if pending is None:
            return
        if pending.timer is not None:
            try:
                pending.timer.cancel()
            except Exception:
                pass
            pending.timer = None
        await self._send_text(conn, pending.chatid, "这次确认已超时失效，无需再回复。", pending.frame)

    async def _send_question(self, conn: UserConnection, pending: PendingFeedback) -> None:
        """Send the interactive card + a companion text with full descriptions.

        WeCom truncates each card option to one short line, so the card shows
        only the labels; the companion text carries the full ``label —
        description`` list (decision: "short labels + full-text msg"). If the
        card itself is rejected, send the full self-contained render instead so
        the question still stands on its own.
        """
        q = pending.questions[pending.q_idx]
        card = build_question_card(pending.request_id, pending.q_idx, q)
        ok = await self._send_card(conn, pending.chatid, card, pending.frame)
        if ok:
            await self._send_text(conn, pending.chatid, render_options_detail(q), pending.frame)
        else:
            text = render_question_text(q, pending.q_idx, len(pending.questions))
            await self._send_text(conn, pending.chatid, text, pending.frame)

    async def _send_card(
        self, conn: UserConnection, chatid: str, card: dict, frame: dict | None = None
    ) -> bool:
        """Proactively push a template card. Cards have no text fallback transport."""
        if not conn.client:
            return False
        try:
            await conn.client.send_message(
                chatid, {"msgtype": "template_card", "template_card": card}
            )
            return True
        except Exception as e:
            logger.warning("send_message(template_card) failed chatid={}: {}", chatid, e)
            return False

    async def _send_text(
        self, conn: UserConnection, chatid: str, text: str,
        frame: dict | None = None, allow_quick_reply_fallback: bool = True,
    ) -> bool:
        """Proactively push a short text/markdown message.

        Decoupled from any inbound frame (so it survives a long human wait). If
        the proactive send is rejected, optionally fall back to the original
        frame's reply stream (which may be stale).
        """
        if not conn.client:
            return False
        try:
            await conn.client.send_message(
                chatid, {"msgtype": "markdown", "markdown": {"content": text}}
            )
            return True
        except Exception as e:
            logger.warning("send_message(markdown) failed chatid={}: {}", chatid, e)
        if allow_quick_reply_fallback and frame is not None:
            try:
                await _quick_reply(conn.client, frame, text)
                return True
            except Exception as e:
                logger.warning("quick_reply fallback failed: {}", e)
        return False

    async def _deliver_proactive(
        self, conn: UserConnection, chatid: str, text: str, frame: dict | None
    ) -> None:
        """Deliver a (possibly long) final result via proactive send, chunked."""
        CHUNK = 3500
        chunks = [text[i:i + CHUNK] for i in range(0, len(text), CHUNK)] or [""]
        for idx, chunk in enumerate(chunks):
            ok = await self._send_text(
                conn, chatid, chunk, frame=None, allow_quick_reply_fallback=False
            )
            if not ok and frame is not None:
                try:
                    await _quick_reply(conn.client, frame, chunk)
                except Exception:
                    logger.warning("proactive delivery chunk {} failed chatid={}", idx, chatid)

    async def _handle_ask_user_answer(
        self, conn: UserConnection, chat_key: str, pending: PendingFeedback, text: str
    ) -> None:
        """Apply a text reply to the current ask_user question."""
        q = pending.questions[pending.q_idx]
        value = parse_question_answer(q, text)
        if value is None:  # skip word / blank -> abandon the whole request
            await self._resolve_pending(conn, chat_key, "deny", message="user did not answer")
            await self._send_text(conn, pending.chatid, "已跳过本次询问。", pending.frame)
            return
        await self._record_ask_user_value(conn, chat_key, pending, value)

    async def _record_ask_user_value(
        self, conn: UserConnection, chat_key: str, pending: PendingFeedback, value: str
    ) -> None:
        """Record an answer value (from text or card) and advance / resolve."""
        q = pending.questions[pending.q_idx]
        head = q.get("header") or q.get("question") or "answer"
        pending.collected.append(answer_line(head, value))

        if pending.q_idx < len(pending.questions) - 1:
            # More questions: echo, send the next card, reset the timer.
            await self._send_text(conn, pending.chatid, f"已记录：{value}", pending.frame)
            pending.q_idx += 1
            await self._send_question(conn, pending)
            self._rearm_timer(conn, chat_key)
        else:
            # Last question: resolve once with the full {questions, answer}.
            questions = pending.questions
            answer = "\n".join(pending.collected)
            await self._resolve_pending(
                conn, chat_key, "allow",
                updated_input={"questions": questions, "answer": answer},
            )
            if len(questions) > 1:
                await self._send_text(
                    conn, pending.chatid,
                    f"已记录：{value}\n已收到你的全部选择，正在继续…", pending.frame,
                )
            else:
                await self._send_text(conn, pending.chatid, f"已记录：{value}", pending.frame)

    async def _handle_permission_answer(
        self, conn: UserConnection, chat_key: str, pending: PendingFeedback, text: str
    ) -> None:
        """Apply a text reply to a permission confirm (y/n, lenient CN+EN)."""
        decision = parse_permission_text(text)
        if decision == "allow":
            await self._resolve_pending(conn, chat_key, "allow")
            await self._send_text(conn, pending.chatid, "已确认，正在执行…", pending.frame)
        elif decision == "deny":
            await self._resolve_pending(conn, chat_key, "deny", message="user declined")
            await self._send_text(conn, pending.chatid, "已取消该操作。", pending.frame)
        else:
            pending.reprompts += 1
            if pending.reprompts >= 2:
                # Conservative: a second unrecognised reply defaults to deny.
                await self._resolve_pending(conn, chat_key, "deny", message="user declined")
                await self._send_text(conn, pending.chatid, "无法识别，已保守取消该操作。", pending.frame)
            else:
                await self._send_text(
                    conn, pending.chatid,
                    "请根据指引回复「确认 / y」执行，回复「取消 / n」拒绝；也可点击上方卡片选项。",
                    pending.frame,
                )

    async def _resolve_pending(
        self, conn: UserConnection, chat_key: str, decision: str,
        message: str = "", updated_input: dict | None = None,
    ) -> None:
        """Resolve the chat's pending request in-process, clear it, cancel timer."""
        pending = conn.pending.pop(chat_key, None)
        if pending is None:
            return
        if pending.timer is not None:
            try:
                pending.timer.cancel()
            except Exception:
                pass
            pending.timer = None
        try:
            pending.coordinator.resolve(pending.request_id, decision, message, updated_input)
            logger.info(
                "[FEEDBACK] resolved request_id={} decision={} chat_key={}",
                pending.request_id, decision, chat_key,
            )
        except ValueError:
            logger.info(
                "[FEEDBACK] request_id={} already gone (timed out/cancelled)",
                pending.request_id,
            )
        except Exception as e:
            logger.warning("[FEEDBACK] resolve failed request_id={}: {}", pending.request_id, e)

    def _arm_timer(self, conn: UserConnection, chat_key: str) -> None:
        """Start the per-question timeout for the chat's pending request."""
        pending = conn.pending.get(chat_key)
        if pending is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        try:
            timeout = max(1, int(conn.config.feedback_timeout_seconds))
        except (TypeError, ValueError):
            timeout = 180
        pending.timer_gen += 1
        gen = pending.timer_gen
        pending.timer = loop.call_later(
            timeout, self._on_feedback_timeout, conn.username, chat_key, gen
        )

    def _rearm_timer(self, conn: UserConnection, chat_key: str) -> None:
        """Cancel and restart the timer (answering resets the window)."""
        pending = conn.pending.get(chat_key)
        if pending is not None and pending.timer is not None:
            try:
                pending.timer.cancel()
            except Exception:
                pass
            pending.timer = None
        self._arm_timer(conn, chat_key)

    def _on_feedback_timeout(self, username: str, chat_key: str, gen: int) -> None:
        """Sync ``call_later`` callback — schedule the async timeout handler."""
        task = asyncio.create_task(self._handle_feedback_timeout(username, chat_key, gen))
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)

    async def _handle_feedback_timeout(self, username: str, chat_key: str, gen: int) -> None:
        """No answer in the window: default-deny and hint (drops remaining questions)."""
        conn = self._connections.get(username)
        if conn is None:
            return
        pending = conn.pending.get(chat_key)
        # Stale fire: the timer was reset (answered) or already resolved/cleared.
        if pending is None or pending.timer_gen != gen:
            return
        try:
            minutes = max(1, int(conn.config.feedback_timeout_seconds) // 60)
        except (TypeError, ValueError):
            minutes = 3
        request_id, kind = pending.request_id, pending.kind
        if kind == "ask_user":
            await self._resolve_pending(conn, chat_key, "deny", message="user did not answer")
            await self._send_text(
                conn, pending.chatid,
                f"⏱️ 超过 {minutes} 分钟未回复，已自动跳过本次询问。", pending.frame,
            )
        else:
            await self._resolve_pending(conn, chat_key, "deny", message="user declined")
            await self._send_text(
                conn, pending.chatid,
                f"⏱️ 超过 {minutes} 分钟未回复，已默认拒绝该操作。", pending.frame,
            )
        logger.info(
            "[FEEDBACK] timeout default-deny request_id={} kind={} chat_key={}",
            request_id, kind, chat_key,
        )

    async def _handle_card_event(self, username: str, frame: dict) -> None:
        """Handle a ``template_card_event`` (button tap / vote submit)."""
        conn = self._connections.get(username)
        if not conn or not conn.client:
            return

        # Step-0: log the entire raw frame once so the live test reveals the
        # true callback shape (parse_card_event's field names are unverified).
        if not self._card_event_logged:
            self._card_event_logged = True
            try:
                logger.info(
                    "[CARD-EVENT] first raw frame: {}",
                    json.dumps(frame, ensure_ascii=False)[:2000],
                )
            except Exception:
                logger.info("[CARD-EVENT] first raw frame (repr): {}", str(frame)[:2000])

        body = frame.get("body", {}) if isinstance(frame, dict) else {}
        body = body if isinstance(body, dict) else {}
        from_field = body.get("from", {})
        sender_id = None
        if isinstance(from_field, dict):
            sender_id = from_field.get("userid") or from_field.get("user_id")
        sender_id = sender_id or body.get("from_userid") or body.get("sender")
        chat_id = body.get("chatid") or body.get("chat_id") or None
        chat_key = chat_id or sender_id
        if not chat_key:
            logger.warning("[CARD-EVENT] cannot determine chat_key; ignoring")
            return

        pending = conn.pending.get(chat_key)
        if pending is None:
            logger.info("[CARD-EVENT] no pending for chat_key={}; stale tap ignored", chat_key)
            return
        # Decision 11: only the original asker may answer.
        if sender_id and pending.asker_id and sender_id != pending.asker_id:
            logger.info("[CARD-EVENT] non-asker {} tapped; ignored", sender_id)
            return

        parsed = parse_card_event(frame)
        if parsed.rid and parsed.rid != pending.request_id:
            logger.info(
                "[CARD-EVENT] rid {} != pending {}; using single-pending fallback",
                parsed.rid, pending.request_id,
            )

        try:
            if pending.kind == "permission":
                if parsed.action == "allow":
                    await self._resolve_pending(conn, chat_key, "allow")
                    await self._send_text(conn, pending.chatid, "已确认，正在执行…", pending.frame)
                elif parsed.action == "deny":
                    await self._resolve_pending(conn, chat_key, "deny", message="user declined")
                    await self._send_text(conn, pending.chatid, "已取消该操作。", pending.frame)
                else:
                    logger.info(
                        "[CARD-EVENT] permission card action={} unrecognised; ignoring",
                        parsed.action,
                    )
            else:  # ask_user
                q_idx = parsed.q_idx if parsed.q_idx is not None else pending.q_idx
                if q_idx != pending.q_idx:
                    logger.info(
                        "[CARD-EVENT] tapped q_idx={} but current={}; stale card ignored",
                        q_idx, pending.q_idx,
                    )
                    return
                q = pending.questions[pending.q_idx]
                value = value_from_card_selection(q, parsed.opt_idxs)
                if value is None:
                    logger.info(
                        "[CARD-EVENT] could not derive value (opt_idxs={}); ignoring",
                        parsed.opt_idxs,
                    )
                    return
                await self._record_ask_user_value(conn, chat_key, pending, value)
        except Exception as e:
            logger.exception("[CARD-EVENT] handler error: {}", e)

    async def _send_streamed_reply(
        self, conn: UserConnection, frame: dict, stream_id: str, text: str
    ) -> None:
        CHUNK_SIZE = 3500
        chunks = [text[i:i + CHUNK_SIZE] for i in range(0, len(text), CHUNK_SIZE)]
        accumulated = ""
        for i, chunk in enumerate(chunks):
            accumulated += chunk
            is_last = (i == len(chunks) - 1)
            await conn.client.reply_stream(
                frame, stream_id, accumulated, finish=is_last
            )

    # --- Session persistence ---

    def _load_sessions(self, username: str) -> dict:
        path = get_sessions_path(username)
        if not path.exists():
            return {}
        try:
            with open(path, "r") as f:
                data = json.load(f)
            sessions = {}
            for key, val in data.items():
                sessions[key] = UserSession(
                    session_id=val.get("session_id"),
                    wecom_user_id=val.get("wecom_user_id", key),
                    last_activity=time.monotonic(),
                )
            return sessions
        except Exception as e:
            logger.warning("Failed to load sessions for {}: {}", username, e)
            return {}

    def _save_sessions(self, username: str, sessions: dict) -> None:
        path = get_sessions_path(username)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {}
        for key, session in sessions.items():
            data[key] = {
                "session_id": session.session_id,
                "wecom_user_id": session.wecom_user_id,
                "last_activity": datetime.now(timezone.utc).isoformat(),
            }
        _atomic_write(path, json.dumps(data, indent=2))

    def _cleanup_idle_sessions(self) -> None:
        now = time.monotonic()
        for username, conn in self._connections.items():
            timeout_s = conn.config.idle_session_timeout_minutes * 60
            expired = [
                key for key, session in conn.sessions.items()
                if now - session.last_activity > timeout_s
                and key not in conn.active_runs
            ]
            for key in expired:
                del conn.sessions[key]
            if expired:
                self._save_sessions(username, conn.sessions)
                logger.info("Cleaned up {} idle sessions for user {}", len(expired), username)

    # --- Command processing ---

    async def _process_pending_commands(self) -> None:
        commands_dir = get_commands_dir()
        if not commands_dir.exists():
            return

        failed_dir = commands_dir / "failed"
        failed_dir.mkdir(parents=True, exist_ok=True)

        cmd_files = sorted(
            [f for f in commands_dir.iterdir() if f.is_file() and f.suffix == ".json"],
            key=lambda f: f.name,
        )

        for cmd_file in cmd_files:
            try:
                with open(cmd_file, "r") as f:
                    data = json.load(f)

                cmd_type = data.get("type")
                payload = data.get("payload", {})

                if cmd_type == "connect":
                    await self._handle_connect_cmd(payload.get("username"))
                elif cmd_type == "disconnect":
                    await self._handle_disconnect_cmd(payload.get("username"))
                elif cmd_type == "reconnect":
                    await self._handle_reconnect_cmd(payload.get("username"))
                elif cmd_type == "update_config":
                    await self._handle_update_config_cmd(payload.get("username"))
                elif cmd_type == "openclaw_connect":
                    await self._handle_openclaw_connect_cmd(payload.get("username"))
                elif cmd_type == "openclaw_disconnect":
                    await self._handle_openclaw_disconnect_cmd(payload.get("username"))
                elif cmd_type == "openclaw_reconnect":
                    await self._handle_openclaw_reconnect_cmd(payload.get("username"))
                elif cmd_type == "openclaw_update_config":
                    await self._handle_openclaw_update_config_cmd(payload.get("username"))
                elif cmd_type == "shutdown":
                    self._shutdown_requested = True
                else:
                    logger.warning("Unknown command type: {}", cmd_type)

                cmd_file.unlink()

            except Exception as e:
                logger.error("Failed to process command {}: {}", cmd_file.name, e)
                try:
                    cmd_file.rename(failed_dir / cmd_file.name)
                except Exception:
                    pass

    async def _handle_connect_cmd(self, username: str | None) -> None:
        if not username:
            return
        logger.info("Connect command for user: {}", username)
        config = self._config_store.get_config(username)
        if not config.enabled:
            logger.info("User {} config not enabled, skipping connect", username)
            return
        # Disconnect first if already connected
        if username in self._connections:
            await self._disconnect_user(username)
        await self._connect_user(username, config)

    async def _handle_disconnect_cmd(self, username: str | None) -> None:
        if not username:
            return
        logger.info("Disconnect command for user: {}", username)
        await self._disconnect_user(username)

    async def _handle_reconnect_cmd(self, username: str | None) -> None:
        if not username:
            return
        logger.info("Reconnect command for user: {}", username)
        await self._disconnect_user(username)
        config = self._config_store.get_config(username)
        if config.enabled:
            await self._connect_user(username, config)

    async def _handle_update_config_cmd(self, username: str | None) -> None:
        if not username:
            return
        logger.info("Update config command for user: {}", username)
        new_config = self._config_store.get_config(username)
        conn = self._connections.get(username)

        if conn:
            old_config = conn.config
            # If credentials or proxy changed, reconnect
            if (old_config.bot_id != new_config.bot_id
                    or old_config.secret != new_config.secret
                    or old_config.ws_proxy_url != new_config.ws_proxy_url):
                logger.info("Credentials changed for user {}, reconnecting", username)
                await self._disconnect_user(username)
                if new_config.enabled:
                    await self._connect_user(username, new_config)
            else:
                # Just update in-memory config
                conn.config = new_config
        elif new_config.enabled:
            # Was not connected, now enabled
            await self._connect_user(username, new_config)

    # --- OpenClaw bridge lifecycle ---

    async def _connect_openclaw_user(self, username: str, config: OpenClawChannelConfig) -> None:
        from api.services.channels.openclaw_bridge import (
            OpenClawBridge,
            register_bridge,
        )

        if not config.gateway_url:
            logger.warning("Cannot connect OpenClaw for user {} — no gateway URL", username)
            return

        bridge = OpenClawBridge(config, username)
        await bridge.connect()
        self._oc_bridges[username] = bridge
        register_bridge(username, bridge)
        logger.info("OpenClaw bridge started for user {}", username)

    async def _disconnect_openclaw_user(self, username: str) -> None:
        from api.services.channels.openclaw_bridge import unregister_bridge

        bridge = self._oc_bridges.pop(username, None)
        if bridge:
            await bridge.disconnect()
            unregister_bridge(username)
            logger.info("OpenClaw bridge stopped for user {}", username)

    async def _handle_openclaw_connect_cmd(self, username: str | None) -> None:
        if not username:
            return
        logger.info("OpenClaw connect command for user: {}", username)
        config = self._config_store.get_openclaw_config(username)
        if not config.enabled:
            logger.info("User {} openclaw config not enabled, skipping", username)
            return
        if username in self._oc_bridges:
            await self._disconnect_openclaw_user(username)
        await self._connect_openclaw_user(username, config)

    async def _handle_openclaw_disconnect_cmd(self, username: str | None) -> None:
        if not username:
            return
        logger.info("OpenClaw disconnect command for user: {}", username)
        await self._disconnect_openclaw_user(username)

    async def _handle_openclaw_reconnect_cmd(self, username: str | None) -> None:
        if not username:
            return
        logger.info("OpenClaw reconnect command for user: {}", username)
        await self._disconnect_openclaw_user(username)
        config = self._config_store.get_openclaw_config(username)
        if config.enabled:
            await self._connect_openclaw_user(username, config)

    async def _handle_openclaw_update_config_cmd(self, username: str | None) -> None:
        if not username:
            return
        logger.info("OpenClaw update config command for user: {}", username)
        new_config = self._config_store.get_openclaw_config(username)
        bridge = self._oc_bridges.get(username)

        if bridge:
            old_config = bridge.config
            if (old_config.gateway_url != new_config.gateway_url
                    or old_config.auth_token != new_config.auth_token):
                logger.info("OpenClaw credentials changed for user {}, reconnecting", username)
                await self._disconnect_openclaw_user(username)
                if new_config.enabled:
                    await self._connect_openclaw_user(username, new_config)
            else:
                bridge.config = new_config
        elif new_config.enabled:
            await self._connect_openclaw_user(username, new_config)

    # --- State files ---

    def _write_heartbeat(self) -> None:
        path = get_heartbeat_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(path, str(time.time()))

    def _update_state_file(self) -> None:
        connections = {}
        for username, conn in self._connections.items():
            connections[username] = {
                "status": conn.status,
                "connected_at": conn.connected_at.isoformat() if conn.connected_at else None,
                "error_message": conn.error_message,
                "active_sessions": len(conn.sessions),
                "messages_handled": conn.messages_handled,
            }

        # OpenClaw bridge status
        openclaw = {}
        for username, bridge in self._oc_bridges.items():
            openclaw[username] = {
                "status": bridge.status,
                "connected_at": bridge.connected_at.isoformat() if bridge.connected_at else None,
                "error_message": bridge.error_message,
                "active_delegations": bridge.active_delegations,
            }

        state = {
            "connections": connections,
            "openclaw": openclaw,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        _atomic_write(get_state_path(), json.dumps(state, indent=2))

    # --- Shutdown ---

    async def _shutdown(self) -> None:
        logger.info("Shutting down channel daemon...")
        timeout = self._settings.channels.shutdown_timeout

        # Cancel all active runs
        all_tasks = []
        for conn in self._connections.values():
            for task in conn.active_runs.values():
                task.cancel()
                all_tasks.append(task)

        if all_tasks:
            logger.info("Waiting up to {}s for {} active tasks...", timeout, len(all_tasks))
            await asyncio.wait(all_tasks, timeout=timeout)

        # Disconnect all WeCom clients and save sessions
        for username, conn in list(self._connections.items()):
            self._save_sessions(username, conn.sessions)
            if conn.client:
                try:
                    conn.client.disconnect()
                except Exception:
                    pass

        # Disconnect all OpenClaw bridges
        for username in list(self._oc_bridges.keys()):
            try:
                await self._disconnect_openclaw_user(username)
            except Exception:
                pass

        self._update_state_file()
        logger.info("Channel daemon shutdown complete")


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


async def main() -> None:
    daemon = ChannelDaemon()
    await daemon.start()


if __name__ == "__main__":
    asyncio.run(main())
