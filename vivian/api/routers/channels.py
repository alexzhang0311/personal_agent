from __future__ import annotations

import json
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..middleware.logging import get_app_logger
from ..models.channels import (
    ActiveSessionInfo,
    ChannelHealthResponse,
    ConnectionStatusResponse,
    OpenClawConfigResponse,
    OpenClawConnectionStatusResponse,
    UpdateOpenClawConfigRequest,
    UpdateWeComConfigRequest,
    WeComConfigResponse,
)
from ..services.auth import require_user
from ..services.channels.config_store import get_channel_config_store
from ..services.channels.openclaw_bridge import (
    OpenClawBridge,
    get_bridge as get_oc_bridge,
    register_bridge as register_oc_bridge,
    unregister_bridge as unregister_oc_bridge,
)
from ..services.channels.shared import (
    get_heartbeat_path,
    get_sessions_path,
    get_state_path,
    write_command,
)


async def _apply_openclaw_config_in_process(username: str, config) -> None:
    """Reflect config changes in the API-process bridge registry."""
    existing = get_oc_bridge(username)
    if existing:
        try:
            await existing.disconnect()
        except Exception:
            pass
        unregister_oc_bridge(username)

    if config.enabled and config.gateway_url:
        bridge = OpenClawBridge(config, username)
        try:
            await bridge.connect()
            register_oc_bridge(username, bridge)
        except Exception as e:
            logger.warning("Failed to start OpenClaw bridge in API process for {}: {}", username, e)
from ..services.user_env import mask_token
from ..services.user_store import UserRecord

logger = get_app_logger(__name__)

router = APIRouter(
    prefix="/api/channels",
    tags=["channels"],
    dependencies=[Depends(require_user)],
)


def _read_json_file(path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def _config_to_response(config) -> WeComConfigResponse:
    return WeComConfigResponse(
        enabled=config.enabled,
        bot_id=config.bot_id,
        secret_masked=mask_token(config.secret) or "",
        ws_proxy_url=config.ws_proxy_url,
        allowed_user_ids=config.allowed_user_ids,
        single_chat_access_mode=config.single_chat_access_mode,
        welcome_message=config.welcome_message,
        reject_message=config.reject_message,
        model=config.model,
        max_queue_size=config.max_queue_size,
        idle_session_timeout_minutes=config.idle_session_timeout_minutes,
        enable_permission_feedback=config.enable_permission_feedback,
        feedback_timeout_seconds=config.feedback_timeout_seconds,
    )


# --- Config CRUD ---


@router.get("/wecom/config", response_model=WeComConfigResponse)
async def get_wecom_config(user: UserRecord = Depends(require_user)):
    store = get_channel_config_store()
    config = store.get_config(user.username)
    return _config_to_response(config)


@router.put("/wecom/config", response_model=WeComConfigResponse)
async def update_wecom_config(
    req: UpdateWeComConfigRequest,
    user: UserRecord = Depends(require_user),
):
    store = get_channel_config_store()
    config = store.get_config(user.username)

    # Apply partial updates
    update_data = req.model_dump(exclude_none=True)

    # Handle masked secret: if it contains "****", preserve existing
    if "secret" in update_data and "****" in update_data["secret"]:
        del update_data["secret"]

    for key, value in update_data.items():
        setattr(config, key, value)

    # Validate bot_id uniqueness if bot_id changed and enabled
    if config.enabled and config.bot_id:
        owner = store.find_bot_id_owner(config.bot_id, exclude_username=user.username)
        if owner:
            raise HTTPException(
                409,
                f"Bot ID '{config.bot_id}' is already in use by user '{owner}'",
            )

    store.save_config(user.username, config)

    # Notify daemon of config change
    write_command("update_config", {"username": user.username})

    return _config_to_response(config)


# --- Connection controls ---


@router.post("/wecom/connect")
async def connect_wecom(user: UserRecord = Depends(require_user)):
    store = get_channel_config_store()
    config = store.get_config(user.username)

    if not config.bot_id or not config.secret:
        raise HTTPException(400, "Bot ID and Secret must be configured before connecting")

    # Validate bot_id uniqueness
    if config.bot_id:
        owner = store.find_bot_id_owner(config.bot_id, exclude_username=user.username)
        if owner:
            raise HTTPException(
                409,
                f"Bot ID '{config.bot_id}' is already in use by user '{owner}'",
            )

    # Set enabled=true and save
    config.enabled = True
    store.save_config(user.username, config)
    write_command("connect", {"username": user.username})

    return {"status": "accepted", "message": "Connect command sent to channel daemon"}


@router.post("/wecom/disconnect")
async def disconnect_wecom(user: UserRecord = Depends(require_user)):
    store = get_channel_config_store()
    config = store.get_config(user.username)

    # Set enabled=false and save
    config.enabled = False
    store.save_config(user.username, config)
    write_command("disconnect", {"username": user.username})

    return {"status": "accepted", "message": "Disconnect command sent to channel daemon"}


@router.post("/wecom/reconnect")
async def reconnect_wecom(user: UserRecord = Depends(require_user)):
    store = get_channel_config_store()
    config = store.get_config(user.username)

    if not config.enabled:
        raise HTTPException(400, "Channel is not enabled. Use connect first.")

    write_command("reconnect", {"username": user.username})

    return {"status": "accepted", "message": "Reconnect command sent to channel daemon"}


# --- Status ---


@router.get("/wecom/status", response_model=ConnectionStatusResponse)
async def get_wecom_status(user: UserRecord = Depends(require_user)):
    state = _read_json_file(get_state_path())
    connections = state.get("connections", {})
    user_state = connections.get(user.username, {})

    # Read active session details from the per-user sessions file
    session_details: list[ActiveSessionInfo] = []
    sessions_data = _read_json_file(get_sessions_path(user.username))
    for _key, sess in sessions_data.items():
        sid = sess.get("session_id")
        if sid:
            session_details.append(ActiveSessionInfo(
                session_id=sid,
                wecom_user_id=sess.get("wecom_user_id", ""),
                last_activity=sess.get("last_activity"),
            ))

    return ConnectionStatusResponse(
        status=user_state.get("status", "disconnected"),
        connected_at=user_state.get("connected_at"),
        error_message=user_state.get("error_message"),
        active_sessions=user_state.get("active_sessions", 0),
        messages_handled=user_state.get("messages_handled", 0),
        session_details=session_details,
    )


# --- OpenClaw Config CRUD ---


def _oc_config_to_response(config) -> OpenClawConfigResponse:
    return OpenClawConfigResponse(
        enabled=config.enabled,
        gateway_url=config.gateway_url,
        auth_token_masked=mask_token(config.auth_token) or "",
        default_agent=config.default_agent,
        max_turns=config.max_turns,
        timeout_seconds=config.timeout_seconds,
        agents=config.agents,
    )


@router.get("/openclaw/config", response_model=OpenClawConfigResponse)
async def get_openclaw_config(user: UserRecord = Depends(require_user)):
    store = get_channel_config_store()
    config = store.get_openclaw_config(user.username)
    return _oc_config_to_response(config)


@router.put("/openclaw/config", response_model=OpenClawConfigResponse)
async def update_openclaw_config(
    req: UpdateOpenClawConfigRequest,
    user: UserRecord = Depends(require_user),
):
    store = get_channel_config_store()
    config = store.get_openclaw_config(user.username)

    update_data = req.model_dump(exclude_none=True)

    # Handle masked auth_token: if it contains "****", preserve existing
    if "auth_token" in update_data and "****" in update_data["auth_token"]:
        del update_data["auth_token"]

    for key, value in update_data.items():
        setattr(config, key, value)

    store.save_openclaw_config(user.username, config)
    write_command("openclaw_update_config", {"username": user.username})
    await _apply_openclaw_config_in_process(user.username, config)

    return _oc_config_to_response(config)


# --- OpenClaw Connection controls ---


@router.post("/openclaw/connect")
async def connect_openclaw(user: UserRecord = Depends(require_user)):
    store = get_channel_config_store()
    config = store.get_openclaw_config(user.username)

    if not config.gateway_url:
        raise HTTPException(400, "Gateway URL must be configured before connecting")

    config.enabled = True
    store.save_openclaw_config(user.username, config)
    write_command("openclaw_connect", {"username": user.username})
    await _apply_openclaw_config_in_process(user.username, config)

    return {"status": "accepted", "message": "OpenClaw connect command sent"}


@router.post("/openclaw/disconnect")
async def disconnect_openclaw(user: UserRecord = Depends(require_user)):
    store = get_channel_config_store()
    config = store.get_openclaw_config(user.username)

    config.enabled = False
    store.save_openclaw_config(user.username, config)
    write_command("openclaw_disconnect", {"username": user.username})
    await _apply_openclaw_config_in_process(user.username, config)

    return {"status": "accepted", "message": "OpenClaw disconnect command sent"}


@router.post("/openclaw/reconnect")
async def reconnect_openclaw(user: UserRecord = Depends(require_user)):
    store = get_channel_config_store()
    config = store.get_openclaw_config(user.username)

    if not config.enabled:
        raise HTTPException(400, "OpenClaw is not enabled. Use connect first.")

    write_command("openclaw_reconnect", {"username": user.username})
    await _apply_openclaw_config_in_process(user.username, config)

    return {"status": "accepted", "message": "OpenClaw reconnect command sent"}


# --- OpenClaw Status ---


@router.get("/openclaw/status", response_model=OpenClawConnectionStatusResponse)
async def get_openclaw_status(user: UserRecord = Depends(require_user)):
    # Prefer the live in-process bridge; fall back to daemon state file
    bridge = get_oc_bridge(user.username)
    if bridge:
        return OpenClawConnectionStatusResponse(
            status=bridge.status,
            connected_at=bridge.connected_at.isoformat() if bridge.connected_at else None,
            error_message=bridge.error_message,
            active_delegations=bridge.active_delegations,
        )

    state = _read_json_file(get_state_path())
    oc_states = state.get("openclaw", {})
    user_state = oc_states.get(user.username, {})

    return OpenClawConnectionStatusResponse(
        status=user_state.get("status", "disconnected"),
        connected_at=user_state.get("connected_at"),
        error_message=user_state.get("error_message"),
        active_delegations=user_state.get("active_delegations", 0),
    )


# --- Health ---


@router.get("/health", response_model=ChannelHealthResponse)
async def get_channels_health():
    heartbeat_path = get_heartbeat_path()
    if not heartbeat_path.exists():
        return ChannelHealthResponse(healthy=False)

    try:
        raw = heartbeat_path.read_text().strip()
        last_beat = float(raw)
        age = time.time() - last_beat
        healthy = age < 30  # Stale if no heartbeat for 30s

        state = _read_json_file(get_state_path())
        connections = {}
        for username, conn_state in state.get("connections", {}).items():
            connections[username] = ConnectionStatusResponse(
                status=conn_state.get("status", "disconnected"),
                connected_at=conn_state.get("connected_at"),
                error_message=conn_state.get("error_message"),
                active_sessions=conn_state.get("active_sessions", 0),
                messages_handled=conn_state.get("messages_handled", 0),
            )

        return ChannelHealthResponse(
            healthy=healthy,
            last_heartbeat=datetime.fromtimestamp(last_beat, tz=timezone.utc).isoformat(),
            connections=connections,
        )
    except Exception:
        return ChannelHealthResponse(healthy=False)
