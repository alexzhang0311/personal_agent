from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from ..middleware.logging import get_app_logger
from ..services.audit_log import AuditEntry, get_audit_logger
from ..services.auth import authenticate_raw_token, get_user_workspace, require_admin, require_user
from ..services.config import PtySettings
from ..services.pty_session import (
    PtySession,
    get_pty_config,
    kill_all_sessions,
    list_active_sessions,
    register_session,
    unregister_session,
    update_pty_config,
)
from ..services.user_store import UserRecord

logger = get_app_logger(__name__)

router = APIRouter(tags=["pty"])


class PtyFeatureResponse(BaseModel):
    enabled: bool


class PtyConfigUpdate(BaseModel):
    enabled: bool | None = None
    max_sessions_per_user: int | None = Field(default=None, ge=1, le=20)
    idle_timeout_seconds: int | None = Field(default=None, ge=10, le=86400)
    absolute_timeout_seconds: int | None = Field(default=None, ge=60, le=24 * 3600)
    output_rate_limit_bytes_per_sec: int | None = Field(default=None, ge=1024)
    max_cols: int | None = Field(default=None, ge=20, le=2000)
    max_rows: int | None = Field(default=None, ge=5, le=1000)
    rlimit_cpu_seconds: int | None = Field(default=None, ge=1)
    rlimit_as_bytes: int | None = Field(default=None, ge=1024 * 1024)
    rlimit_fsize_bytes: int | None = Field(default=None, ge=1024)
    rlimit_nofile: int | None = Field(default=None, ge=16)
    shell: str | None = None


@router.get("/api/pty/feature", response_model=PtyFeatureResponse)
async def get_pty_feature(_: UserRecord = Depends(require_user)):
    cfg = get_pty_config()
    return PtyFeatureResponse(enabled=cfg.enabled)


@router.get("/api/admin/pty/config", response_model=PtySettings)
async def get_admin_pty_config(_: UserRecord = Depends(require_admin)):
    return get_pty_config()


@router.put("/api/admin/pty/config", response_model=PtySettings)
async def update_admin_pty_config(
    request: PtyConfigUpdate,
    current_user: UserRecord = Depends(require_admin),
):
    updates = request.model_dump(exclude_none=True)
    previous = get_pty_config()
    new_cfg = update_pty_config(updates)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="runtime.pty_config_updated",
        target="pty",
        details=updates,
    ))

    # Mid-session admin disable: nuke active sessions.
    if previous.enabled and not new_cfg.enabled:
        sessions = await kill_all_sessions("admin_disabled")
        for s in sessions:
            audit.append(AuditEntry(
                actor=current_user.username,
                action="pty.session_killed_admin",
                target=s.session_id,
                details={"username": s.username},
            ))

    return new_cfg


async def _send_close(websocket: WebSocket, reason: str, code: int) -> None:
    try:
        await websocket.send_json({"type": "closed", "reason": reason})
    except Exception:
        pass
    try:
        await websocket.close(code=code)
    except Exception:
        pass


@router.websocket("/api/pty/ws")
async def pty_ws(websocket: WebSocket):
    await websocket.accept()

    # 1) Read init frame.
    try:
        raw_text = await websocket.receive_text()
        raw = json.loads(raw_text)
    except (json.JSONDecodeError, WebSocketDisconnect, Exception):
        try:
            await websocket.close(code=4000)
        except Exception:
            pass
        return

    if not isinstance(raw, dict) or raw.get("type") != "init":
        try:
            await websocket.send_json({"type": "error", "data": {"message": "First frame must be type 'init'"}})
        except Exception:
            pass
        try:
            await websocket.close(code=4000)
        except Exception:
            pass
        return

    token = raw.get("token")
    x_user_name = raw.get("x_user_name")
    try:
        cols = int(raw.get("cols") or 80)
        rows = int(raw.get("rows") or 24)
    except (TypeError, ValueError):
        cols, rows = 80, 24

    audit = get_audit_logger()

    # 2) Authenticate.
    try:
        user = await authenticate_raw_token(token, x_user_name)
    except HTTPException:
        audit.append(AuditEntry(
            actor=x_user_name or "unknown",
            action="pty.session_rejected_auth",
            target="-",
        ))
        await _send_close(websocket, "auth", 4001)
        return

    if user is None:
        audit.append(AuditEntry(
            actor=x_user_name or "anonymous",
            action="pty.session_rejected_auth",
            target="-",
        ))
        await _send_close(websocket, "auth", 4001)
        return

    username = user.username

    # 3) Feature gate.
    cfg = get_pty_config()
    if not cfg.enabled:
        audit.append(AuditEntry(
            actor=username,
            action="pty.session_rejected_disabled",
            target="-",
        ))
        await _send_close(websocket, "feature_disabled", 4002)
        return

    cwd = get_user_workspace(user)

    send_lock = asyncio.Lock()

    async def safe_send(message: dict) -> None:
        async with send_lock:
            try:
                await websocket.send_json(message)
            except Exception:
                raise

    async def on_output(data: bytes) -> None:
        await safe_send({"type": "output", "data": data.decode("utf-8", errors="replace")})

    async def on_closed(reason: str, exit_code: int | None) -> None:
        payload = {"type": "closed", "reason": reason}
        if exit_code is not None:
            payload["exit_code"] = exit_code
        try:
            await safe_send(payload)
        except Exception:
            pass

    session = PtySession(
        username=username,
        cwd=cwd,
        cfg=cfg,
        cols=cols,
        rows=rows,
        on_output=on_output,
        on_closed=on_closed,
    )

    # 4) Register — new connection wins. If the user already has max_sessions
    # open, the oldest get evicted to make room.
    evicted_list = await register_session(username, session, cfg.max_sessions_per_user)
    for evicted in evicted_list:
        audit.append(AuditEntry(
            actor=username,
            action="pty.session_superseded",
            target=evicted.session_id,
            details={"new_session_id": session.session_id},
        ))

    started_at = time.time()
    try:
        # 5) Spawn the PTY.
        try:
            await session.start()
        except Exception as exc:
            logger.exception("PTY spawn failed")
            audit.append(AuditEntry(
                actor=username,
                action="pty.session_open_failed",
                target=session.session_id,
                details={"error": str(exc)},
            ))
            try:
                await safe_send({"type": "error", "code": "spawn_failed", "message": str(exc)})
            except Exception:
                pass
            await _send_close(websocket, "spawn_failed", 4500)
            return

        audit.append(AuditEntry(
            actor=username,
            action="pty.session_open",
            target=session.session_id,
            details={"cwd": cwd},
        ))

        await safe_send({
            "type": "ready",
            "session_id": session.session_id,
            "cwd": cwd,
            "idle_timeout": cfg.idle_timeout_seconds,
            "absolute_timeout": cfg.absolute_timeout_seconds,
            "max_cols": cfg.max_cols,
            "max_rows": cfg.max_rows,
            "cols": session.cols,
            "rows": session.rows,
        })

        async def writer() -> None:
            try:
                while True:
                    text = await websocket.receive_text()
                    try:
                        msg = json.loads(text)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(msg, dict):
                        continue
                    mtype = msg.get("type")
                    if mtype == "input":
                        data = msg.get("data") or ""
                        if isinstance(data, str):
                            session.write(data.encode("utf-8", errors="replace"))
                    elif mtype == "resize":
                        try:
                            new_cols = int(msg.get("cols") or session.cols)
                            new_rows = int(msg.get("rows") or session.rows)
                        except (TypeError, ValueError):
                            continue
                        session.resize(new_cols, new_rows)
                    elif mtype == "ping":
                        try:
                            await safe_send({"type": "pong"})
                        except Exception:
                            return
            except WebSocketDisconnect:
                session.request_close("client_close")
            except Exception:
                session.request_close("client_close")

        writer_task = asyncio.create_task(writer())

        try:
            await session.run()
        finally:
            writer_task.cancel()
            try:
                await writer_task
            except (asyncio.CancelledError, Exception):
                pass

        # Free the user's slot immediately — the next reconnect should not
        # have to wait for the shell process group to be reaped.
        await unregister_session(username, session)

        reason, exit_code = await session.teardown()

        action = "pty.session_close"
        if reason == "idle_timeout":
            action = "pty.session_killed_idle"
        elif reason == "absolute_timeout":
            action = "pty.session_killed_absolute"
        elif reason == "admin_disabled":
            action = "pty.session_killed_admin"

        audit.append(AuditEntry(
            actor=username,
            action=action,
            target=session.session_id,
            details={
                "duration_seconds": int(time.time() - started_at),
                "reason": reason,
                "exit_code": exit_code,
            },
        ))

        close_code = 1000
        if reason == "idle_timeout":
            close_code = 4010
        elif reason == "absolute_timeout":
            close_code = 4011
        elif reason == "admin_disabled":
            close_code = 4012

        try:
            await websocket.close(code=close_code)
        except Exception:
            pass
    finally:
        await unregister_session(username, session)
        try:
            await session.teardown()
        except Exception:
            pass
