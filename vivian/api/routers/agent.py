from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Literal

from claude_agent_sdk import (
    ClaudeSDKClient,
    fork_session as sdk_fork_session,
    get_session_messages,
    list_sessions,
    rename_session as sdk_rename_session,
    tag_session as sdk_tag_session,
)
from claude_agent_sdk._internal.sessions import _canonicalize_path, _get_project_dir
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter, ValidationError

from ..middleware.logging import get_app_logger
from ..models.agent import (
    AgentRunRequest,
    AgentRunResponse,
    ForkRequest,
    ForkResponse,
    ImageItem,
    PermissionRespondRequest,
    RenameRequest,
    RewindRequest,
    RewindResponse,
    SessionInfoResponse,
    SessionListResponse,
    SessionMessageResponse,
    SessionMessagesResponse,
    TagRequest,
    WsClientFrame,
    WsInitFrame,
    WsPermissionFrame,
    WsQueueCancelFrame,
    WsQueueFrame,
    WsSubscribeFrame,
)
from ..services.audit_log import AuditEntry, get_audit_logger
from ..services.active_runs import active_run_manager
from ..services.auth import authenticate_raw_token, decode_jwt, get_current_user, get_user_workspace
from ..services.claude_sdk.client import agent_run
from ..services.claude_sdk.options import build_agent_options
from ..services.claude_sdk.permission_coordinator import registry
from ..services.user_store import UserRecord
from ..metrics import AGENT_RUNS_FINISHED, AGENT_RUNS_STARTED

_ws_frame_adapter = TypeAdapter(WsClientFrame)


_ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
_MAX_IMAGE_SIZE = 3 * 1024 * 1024  # 3MB decoded
_MAX_IMAGES = 5


def _is_within_directory(path: str, directory: str) -> bool:
    try:
        return os.path.commonpath([path, directory]) == directory
    except ValueError:
        return False


def _validate_images(images: list[ImageItem] | None) -> list[dict] | None:
    if not images:
        return None
    if len(images) > _MAX_IMAGES:
        raise HTTPException(400, f"Maximum {_MAX_IMAGES} images per message")
    validated = []
    for img in images:
        if img.media_type not in _ALLOWED_IMAGE_TYPES:
            raise HTTPException(400, f"Unsupported image type: {img.media_type}")
        # base64 is ~4/3 of original, estimate decoded size
        decoded_size = len(img.data) * 3 // 4
        if decoded_size > _MAX_IMAGE_SIZE:
            raise HTTPException(413, f"Image exceeds {_MAX_IMAGE_SIZE // (1024*1024)}MB limit")
        validated.append({"data": img.data, "media_type": img.media_type})
    return validated


def _validate_attachments(attachments, cwd: str) -> list[dict] | None:
    """Validate attachment paths and return list of {path, name} dicts."""
    if not attachments:
        return None
    real_cwd = os.path.realpath(cwd)
    validated = []
    for att in attachments:
        path = att.path if hasattr(att, "path") else att
        name = getattr(att, "name", None)
        # Resolve to canonical path to prevent traversal
        real_path = os.path.realpath(path)
        if not _is_within_directory(real_path, real_cwd):
            raise HTTPException(400, f"Attachment path outside workspace: {path}")
        if not os.path.isfile(real_path):
            raise HTTPException(400, f"Attachment file not found: {path}")
        validated.append({"path": real_path, "name": name})
    return validated


def _session_jsonl_path(cwd: str, session_id: str) -> Path:
    canonical = _canonicalize_path(cwd)
    project_dir = _get_project_dir(canonical)
    return project_dir / f"{session_id}.jsonl"


def _iter_jsonl_dicts(path: Path):
    if not path.exists():
        return

    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                item = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Skipping invalid JSONL row %s:%s", path, line_number)
                continue
            if isinstance(item, dict):
                yield item


def _message_content_blocks(raw: dict) -> list[dict]:
    message = raw.get("message")
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    if not isinstance(content, list):
        return []
    return [block for block in content if isinstance(block, dict)]


def _tool_use_result(raw: dict) -> dict | None:
    result = raw.get("toolUseResult") or raw.get("tool_use_result")
    return result if isinstance(result, dict) else None


def _build_subagent_parent_map(cwd: str, session_id: str) -> dict[str, str]:
    """Map sidechain agent ids back to the top-level Agent/Task tool_use id."""
    parent_by_agent_id: dict[str, str] = {}
    for raw in _iter_jsonl_dicts(_session_jsonl_path(cwd, session_id)):
        if raw.get("type") != "user":
            continue

        result = _tool_use_result(raw)
        if not result:
            continue

        agent_id = result.get("agentId") or result.get("agent_id")
        if not agent_id:
            continue

        for block in _message_content_blocks(raw):
            if block.get("type") == "tool_result" and block.get("tool_use_id"):
                parent_by_agent_id.setdefault(str(agent_id), str(block["tool_use_id"]))
                break

    return parent_by_agent_id


def _has_tool_result(raw: dict) -> bool:
    return any(block.get("type") == "tool_result" for block in _message_content_blocks(raw))


def _with_inline_tool_use_result(raw: dict):
    """Attach raw toolUseResult to tool_result blocks for replay consumers."""
    tool_result = _tool_use_result(raw)
    if not tool_result:
        return raw.get("message")

    message = raw.get("message")
    if not isinstance(message, dict):
        return message

    content = message.get("content")
    if not isinstance(content, list):
        return message

    next_content = []
    changed = False
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_result":
            next_content.append({**block, "tool_use_result": tool_result})
            changed = True
        else:
            next_content.append(block)

    return {**message, "content": next_content} if changed else message


def _load_subagent_session_messages(cwd: str, session_id: str) -> list[SessionMessageResponse]:
    """Hydrate historical subagent sidechain messages.

    Claude stores live subagent turns under
    `<project>/<session_id>/subagents/agent-<agentId>.jsonl`. The normal SDK
    history reader only returns the main session JSONL, so replay needs to load
    these sidechains and pin them to the parent Agent/Task tool_use id.
    """
    parent_by_agent_id = _build_subagent_parent_map(cwd, session_id)
    if not parent_by_agent_id:
        return []

    session_dir = _session_jsonl_path(cwd, session_id).with_suffix("")
    subagents_dir = session_dir / "subagents"
    if not subagents_dir.exists():
        return []

    hydrated: list[SessionMessageResponse] = []
    for path in sorted(subagents_dir.glob("agent-*.jsonl")):
        filename_agent_id = path.stem.removeprefix("agent-")
        parent_tool_use_id = parent_by_agent_id.get(filename_agent_id)

        for raw in _iter_jsonl_dicts(path):
            msg_type = raw.get("type")
            if msg_type not in {"user", "assistant"}:
                continue

            raw_agent_id = raw.get("agentId") or raw.get("agent_id")
            if not parent_tool_use_id and raw_agent_id:
                parent_tool_use_id = parent_by_agent_id.get(str(raw_agent_id))
            if not parent_tool_use_id:
                continue

            # Sidechain user prompt rows are internal scaffolding. Keep only
            # user rows that contain tool_result blocks so replay can attach
            # outputs to the corresponding subagent tool_use blocks.
            if msg_type == "user" and not _has_tool_result(raw):
                continue

            uuid = raw.get("uuid")
            message = _with_inline_tool_use_result(raw)
            if not uuid or message is None:
                continue

            hydrated.append(SessionMessageResponse(
                type=msg_type,
                uuid=str(uuid),
                session_id=str(raw.get("sessionId") or raw.get("session_id") or session_id),
                message=message,
                parent_tool_use_id=parent_tool_use_id,
                metadata={
                    "timestamp": raw["timestamp"],
                } if isinstance(raw.get("timestamp"), str) else None,
            ))

    return hydrated


def _build_message_replay_metadata(cwd: str, session_id: str) -> dict[str, dict]:
    """Collect per-message timestamps plus assistant usage/duration for replay.

    The SDK history reader returns user/assistant turns only. Claude's JSONL
    keeps token usage on assistant rows and writes the final elapsed time as a
    following system ``turn_duration`` row keyed by the assistant UUID. Stitch
    those back together so the Web UI can render the same action metadata after
    loading a past session.
    """
    metadata_by_uuid: dict[str, dict] = {}
    assistant_count_in_turn = 0

    for raw in _iter_jsonl_dicts(_session_jsonl_path(cwd, session_id)):
        if raw.get("isSidechain") is True:
            continue

        uuid = raw.get("uuid")
        if uuid and isinstance(raw.get("timestamp"), str):
            metadata_by_uuid.setdefault(str(uuid), {})["timestamp"] = raw["timestamp"]

        msg_type = raw.get("type")
        if msg_type == "user" and not _has_tool_result(raw):
            assistant_count_in_turn = 0
            continue

        if msg_type == "assistant":
            if not uuid:
                continue
            assistant_count_in_turn += 1
            message = raw.get("message")
            if isinstance(message, dict):
                usage = message.get("usage")
                if isinstance(usage, dict):
                    metadata_by_uuid.setdefault(str(uuid), {})["usage"] = usage
            continue

        if msg_type == "system" and raw.get("subtype") == "turn_duration":
            parent_uuid = raw.get("parentUuid")
            if not parent_uuid:
                continue
            meta = metadata_by_uuid.setdefault(str(parent_uuid), {})
            duration_ms = raw.get("durationMs")
            if isinstance(duration_ms, (int, float)):
                meta["duration_ms"] = int(duration_ms)
            usage = meta.get("usage")
            iterations = usage.get("iterations") if isinstance(usage, dict) else None
            if isinstance(iterations, list) and iterations:
                meta["agent_loops"] = len(iterations)
            elif assistant_count_in_turn > 0:
                meta["agent_loops"] = assistant_count_in_turn

    return metadata_by_uuid


logger = get_app_logger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/run", response_model=AgentRunResponse)
async def run_agent(
    http_request: Request,
    request: AgentRunRequest,
    user: UserRecord | None = Depends(get_current_user),
):
    cwd = get_user_workspace(user)
    username = user.username if user else None
    attachments = _validate_attachments(request.attachments, cwd)
    images = _validate_images(request.images)
    auth_method = getattr(http_request.state, "auth_method", "jwt")
    AGENT_RUNS_STARTED.inc()
    outcome = "success"
    try:
        result = await agent_run(
            request.message, request.session_id, request.permission_mode,
            cwd=cwd, username=username, model_override=request.model,
            auth_method=auth_method,
            attachments=attachments, images=images, mcp_servers=request.mcp_servers,
            enable_file_checkpointing=request.enable_file_checkpointing,
            fork_session=request.fork_session,
        )
    except asyncio.CancelledError:
        outcome = "cancelled"
        raise
    except Exception:
        outcome = "error"
        raise
    finally:
        AGENT_RUNS_FINISHED.labels(outcome=outcome).inc()
    return AgentRunResponse(**result)


@router.post("/run/stream")
async def run_agent_stream(
    http_request: Request,
    request: AgentRunRequest,
    user: UserRecord | None = Depends(get_current_user),
):
    cwd = get_user_workspace(user)
    username = user.username if user else None
    attachments = _validate_attachments(request.attachments, cwd)
    images = _validate_images(request.images)
    auth_method = getattr(http_request.state, "auth_method", "jwt")
    run = await active_run_manager.start(
        owner_username=username,
        prompt=request.message,
        session_id=request.session_id,
        kwargs={
            "permission_mode": request.permission_mode,
            "cwd": cwd,
            "username": username,
            "model_override": request.model,
            "auth_method": auth_method,
            "attachments": attachments,
            "images": images,
            "mcp_servers": request.mcp_servers,
            "enable_file_checkpointing": request.enable_file_checkpointing,
            "fork_session": request.fork_session,
            "enable_permission_feedback": request.enable_permission_feedback,
        },
    )

    async def managed_stream():
        subscription = active_run_manager.subscribe(run)
        try:
            while True:
                envelope = await subscription.get()
                yield f"event: {envelope['event']}\ndata: {json.dumps(envelope)}\n\n"
                if envelope["event"] == "run_state" and envelope["data"].get("status") in {"completed", "failed", "cancelled"}:
                    break
        finally:
            active_run_manager.unsubscribe(run, subscription)

    return StreamingResponse(managed_stream(), media_type="text/event-stream")


@router.get("/sessions", response_model=SessionListResponse)
async def list_agent_sessions(
    limit: int = 20,
    offset: int = 0,
    source: Literal["all", "project", "global"] = "all",  # deprecated — ignored
    user: UserRecord | None = Depends(get_current_user),
):
    """List past sessions from this project workspace (paginated).

    The ``source`` query parameter is accepted for backwards compatibility
    but ignored — every response now contains only ``<work_dir>/<username>``
    sessions, tagged as ``"project"``.
    """
    del source  # legacy parameter, kept for client compat
    cwd = get_user_workspace(user)
    raw = list_sessions(directory=cwd)

    total = len(raw)
    page = raw[offset : offset + limit]
    return SessionListResponse(
        sessions=[
            SessionInfoResponse(
                session_id=s.session_id,
                summary=s.summary,
                last_modified=s.last_modified,
                file_size=s.file_size,
                custom_title=s.custom_title,
                first_prompt=s.first_prompt,
                git_branch=s.git_branch,
                cwd=s.cwd,
                session_source="project",
                tag=getattr(s, "tag", None),
            )
            for s in page
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/runs/active")
async def list_active_runs(user: UserRecord | None = Depends(get_current_user)):
    """List reconnectable runs owned by the current user."""
    username = user.username if user else None
    # Terminal runs remain in the manager briefly for direct replay by run_id,
    # but they must not be returned as active sidebar rows. A completed turn
    # and a later turn can share one Claude session_id; returning both here
    # makes one Chat appear multiple times while the newer turn is active.
    return {"runs": active_run_manager.list_for_owner(username)}


def _owned_active_run(run_id: str, user: UserRecord | None):
    run = active_run_manager.get(run_id)
    username = user.username if user else None
    if run is None:
        raise HTTPException(404, "Active run not found")
    if run.owner_username != username:
        raise HTTPException(403, "Not authorized for this run")
    return run


@router.get("/runs/{run_id}/events")
async def subscribe_active_run_events(
    run_id: str,
    after_seq: int = 0,
    user: UserRecord | None = Depends(get_current_user),
):
    run = _owned_active_run(run_id, user)

    async def stream():
        subscription = active_run_manager.subscribe(run, after_seq=max(0, after_seq))
        try:
            while True:
                envelope = await subscription.get()
                yield f"event: {envelope['event']}\ndata: {json.dumps(envelope)}\n\n"
                if envelope["event"] == "run_state" and envelope["data"].get("status") in {"completed", "failed", "cancelled"}:
                    break
        finally:
            active_run_manager.unsubscribe(run, subscription)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/runs/{run_id}/abort")
async def abort_active_run(run_id: str, user: UserRecord | None = Depends(get_current_user)):
    run = _owned_active_run(run_id, user)
    await active_run_manager.abort(run)
    return {"status": "ok"}


@router.get("/sessions/{session_id}/messages", response_model=SessionMessagesResponse)
async def get_agent_session_messages(
    session_id: str,
    limit: int | None = None,
    offset: int = 0,
    user: UserRecord | None = Depends(get_current_user),
):
    """Retrieve messages from a specific past session."""
    cwd = get_user_workspace(user)
    messages = get_session_messages(
        session_id=session_id, directory=cwd, limit=limit, offset=offset
    )
    replay_metadata = _build_message_replay_metadata(cwd, session_id)
    sidechain_messages: list[SessionMessageResponse] = []
    if limit is None and offset == 0:
        try:
            sidechain_messages = _load_subagent_session_messages(cwd, session_id)
        except Exception:
            logger.exception("Failed to hydrate subagent messages for session %s", session_id)

    return SessionMessagesResponse(
        messages=[
            SessionMessageResponse(
                type=m.type,
                uuid=m.uuid,
                session_id=m.session_id,
                message=m.message,
                parent_tool_use_id=m.parent_tool_use_id,
                metadata=replay_metadata.get(m.uuid),
            )
            for m in messages
        ] + sidechain_messages
    )


@router.delete("/sessions/{session_id}")
async def delete_agent_session(session_id: str, user: UserRecord | None = Depends(get_current_user)):
    """Delete a project-level session file. Only project sessions can be deleted."""
    cwd = get_user_workspace(user)

    # Verify this session belongs to the current project
    project_ids = {s.session_id for s in list_sessions(directory=cwd)}
    if session_id not in project_ids:
        raise HTTPException(403, "Only project-level sessions can be deleted")

    # Resolve the session file path
    canonical = _canonicalize_path(cwd)
    project_dir = _get_project_dir(canonical)
    session_file = project_dir / f"{session_id}.jsonl"

    if not session_file.exists():
        raise HTTPException(404, "Session file not found")

    session_file.unlink()

    actor = user.username if user else "anonymous"
    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=actor,
        action="session.deleted",
        target=session_id,
    ))

    return {"status": "ok"}


@router.post("/permission/respond")
async def respond_permission(
    http_request: Request,
    request: PermissionRespondRequest,
    user: UserRecord | None = Depends(get_current_user),
):
    run = active_run_manager.get(request.run_id) if request.run_id else active_run_manager.find_legacy_identifier(request.session_id)
    if run:
        owner = run.owner_username
        if owner is not None and (user is None or user.username != owner):
            raise HTTPException(403, "Not authorized for this permission request")
        try:
            await active_run_manager.resolve_permission(
                run,
                request.request_id,
                request.decision,
                request.message or "",
                request.updated_input,
            )
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc
        return {"status": "ok"}

    # Compatibility path for legacy SSE streams created before ActiveRunManager.
    coordinator = registry.get(request.session_id)
    if not coordinator:
        raise HTTPException(404, "No active session for this stream")
    owner = coordinator.owner_username
    if owner is not None and (user is None or user.username != owner):
        raise HTTPException(403, "Not authorized for this permission request")
    try:
        coordinator.resolve(
            request.request_id,
            request.decision,
            request.message or "",
            request.updated_input,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"status": "ok"}


@router.post("/rewind", response_model=RewindResponse)
async def rewind_session(
    http_request: Request,
    req: RewindRequest,
    user: UserRecord | None = Depends(get_current_user),
):
    """Rewind files on disk to the snapshot taken before a given user message.

    Requires the session to have been run with `enable_file_checkpointing=True`.
    Refuses to run while a live stream is in flight for the same session.
    """
    cwd = get_user_workspace(user)
    username = user.username if user else None
    auth_method = getattr(http_request.state, "auth_method", "jwt")
    if registry.get(req.session_id):
        raise HTTPException(409, "Finish the current run before rewinding")
    opts = await build_agent_options(
        session_id=req.session_id,
        permission_mode="bypassPermissions",
        cwd=cwd, username=username,
        auth_method=auth_method,
        enable_file_checkpointing=True,
    )
    try:
        async with ClaudeSDKClient(options=opts) as client:
            await client.query("")
            async for _ in client.receive_response():
                await client.rewind_files(req.checkpoint_uuid)
                break
        get_audit_logger().append(AuditEntry(
            actor=username or "anonymous",
            action="session.rewound",
            target=req.session_id,
            details={"checkpoint_uuid": req.checkpoint_uuid},
        ))
        return RewindResponse(status="ok")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("rewind failed")
        raise HTTPException(400, f"Rewind failed: {exc}") from exc


@router.post("/fork", response_model=ForkResponse)
async def fork_agent_session(
    req: ForkRequest,
    user: UserRecord | None = Depends(get_current_user),
):
    """Fork a session — either mid-session (up_to_message_uuid) or tail fork."""
    cwd = get_user_workspace(user)
    try:
        result = sdk_fork_session(
            session_id=req.session_id,
            directory=cwd,
            up_to_message_id=req.up_to_message_uuid,
            title=req.title,
        )
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc)) from exc
    get_audit_logger().append(AuditEntry(
        actor=user.username if user else "anonymous",
        action="session.forked",
        target=req.session_id,
        details={"new_session_id": result.session_id, "up_to": req.up_to_message_uuid},
    ))
    return ForkResponse(
        new_session_id=result.session_id,
        parent_session_id=req.session_id,
        title=req.title,
    )


@router.patch("/sessions/{session_id}")
async def rename_agent_session(
    session_id: str,
    req: RenameRequest,
    user: UserRecord | None = Depends(get_current_user),
):
    """Rename a session by appending a custom-title entry."""
    cwd = get_user_workspace(user)
    try:
        sdk_rename_session(
            session_id=session_id, title=req.title.strip(), directory=cwd,
        )
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc)) from exc
    get_audit_logger().append(AuditEntry(
        actor=user.username if user else "anonymous",
        action="session.renamed",
        target=session_id,
        details={"title": req.title.strip()},
    ))
    return {"status": "ok"}


@router.put("/sessions/{session_id}/tag")
async def tag_agent_session(
    session_id: str,
    req: TagRequest,
    user: UserRecord | None = Depends(get_current_user),
):
    """Set or clear a session's tag (pass tag=None to clear)."""
    cwd = get_user_workspace(user)
    try:
        sdk_tag_session(session_id=session_id, tag=req.tag, directory=cwd)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc)) from exc
    get_audit_logger().append(AuditEntry(
        actor=user.username if user else "anonymous",
        action="session.tagged",
        target=session_id,
        details={"tag": req.tag},
    ))
    return {"status": "ok"}


@router.websocket("/ws/run")
async def ws_run(websocket: WebSocket):
    import uuid as _uuid
    ws_id = str(_uuid.uuid4())[:8]  # short connection tag
    logger.info("[WS:%s] Connection accepted", ws_id)
    await websocket.accept()

    # The first frame either starts a new run or re-subscribes to an existing
    # one. In both cases the websocket is only a subscriber: disconnecting it
    # must never cancel the SDK task.
    try:
        raw_text = await websocket.receive_text()
        raw = json.loads(raw_text)
        client_tab_id = str(raw.get("client_tab_id") or "")[:32]
        frame = _ws_frame_adapter.validate_python(raw)
    except (json.JSONDecodeError, ValidationError) as exc:
        await websocket.send_json({"event": "error", "data": {"message": f"Invalid init frame: {exc}"}})
        await websocket.close(code=4000)
        return

    if not isinstance(frame, (WsInitFrame, WsSubscribeFrame)):
        await websocket.send_json({"event": "error", "data": {"message": "First message must start or subscribe to a run"}})
        await websocket.close(code=4000)
        return

    try:
        user = await authenticate_raw_token(frame.token, frame.x_user_name)
    except HTTPException:
        await websocket.send_json({"event": "error", "data": {"message": "Authentication failed"}})
        await websocket.close(code=4001)
        return

    cwd = get_user_workspace(user)
    username = user.username if user else None
    auth_method = "api_key"
    if frame.token:
        try:
            decode_jwt(frame.token)
            auth_method = "jwt"
        except HTTPException:
            pass
    after_seq = 0
    if isinstance(frame, WsSubscribeFrame):
        run = active_run_manager.get(frame.run_id)
        if run is None:
            await websocket.send_json({"event": "error", "data": {"message": "Active run not found"}})
            await websocket.close(code=4004)
            return
        if run.owner_username != username:
            await websocket.send_json({"event": "error", "data": {"message": "Not authorized for this run"}})
            await websocket.close(code=4003)
            return
        after_seq = frame.after_seq
        prompt_preview = " ".join(run.first_prompt.split())[:160]
        logger.info("[WS:%s] SUBSCRIBE run_id=%s after_seq=%s tab=%s", ws_id, run.run_id, after_seq, client_tab_id)
    else:
        prompt_preview = " ".join(frame.message.split())[:160]
        try:
            attachments = _validate_attachments(frame.attachments, cwd) if frame.attachments else None
            images = _validate_images(frame.images)
        except HTTPException as exc:
            await websocket.send_json({"event": "error", "data": {"message": f"Validation failed: {exc.detail}"}})
            await websocket.close(code=4000)
            return
        run = await active_run_manager.start(
            owner_username=username,
            prompt=frame.message,
            session_id=frame.session_id,
            kwargs={
                "permission_mode": frame.permission_mode,
                "cwd": cwd,
                "username": username,
                "model_override": frame.model,
                "auth_method": auth_method,
                "attachments": attachments,
                "images": images,
                "mcp_servers": frame.mcp_servers,
                "enable_file_checkpointing": frame.enable_file_checkpointing,
                "fork_session": frame.fork_session,
                "enable_permission_feedback": frame.enable_permission_feedback,
            },
        )
        logger.info("[WS:%s] START run_id=%s session_id=%s tab=%s prompt=%s", ws_id, run.run_id, frame.session_id, client_tab_id, prompt_preview)

    _ws_mask_patterns: list[dict] = []
    if auth_method == "api_key":
        try:
            from ..services.user_store import get_user_store as _get_store
            runtime = _get_store().get_runtime_config()
            pii_cfg = runtime.get("pii_masking") or {}
            _ws_mask_patterns = list(pii_cfg.get("patterns") or [])
        except Exception:
            pass
    subscription = active_run_manager.subscribe(run, after_seq=after_seq)

    async def sender() -> None:
        while True:
            envelope = await subscription.get()
            outgoing = envelope
            if _ws_mask_patterns and envelope["event"] not in ("keepalive", "stream_init", "permission_request", "permission_timeout"):
                from ..utils.sensitive_mask import mask_sensitive
                masked, _ = mask_sensitive(_ws_mask_patterns, envelope["data"])
                outgoing = {**envelope, "data": masked}
            await websocket.send_json(outgoing)
            if envelope["event"] == "run_state" and envelope["data"].get("status") in {"completed", "failed", "cancelled"}:
                return

    async def reader() -> None:
        try:
            while True:
                text = await websocket.receive_text()
                try:
                    raw_msg = json.loads(text)
                    msg = _ws_frame_adapter.validate_python(raw_msg)
                except (json.JSONDecodeError, ValidationError) as exc:
                    await websocket.send_json({"event": "error", "data": {"message": f"Invalid frame: {exc}"}})
                    continue

                if isinstance(msg, WsPermissionFrame):
                    target = active_run_manager.get(msg.run_id or run.run_id)
                    if not target or target.owner_username != username:
                        await websocket.send_json({"event": "error", "data": {"message": "Run not found or unauthorized"}})
                        continue
                    try:
                        await active_run_manager.resolve_permission(target, msg.request_id, msg.decision, msg.message or "", msg.updated_input)
                    except ValueError as exc:
                        await websocket.send_json({
                            "run_id": target.run_id,
                            "session_id": target.session_id,
                            "seq": target.seq,
                            "event": "permission_conflict",
                            "data": {"request_id": msg.request_id, "message": str(exc)},
                        })
                elif isinstance(msg, (WsInitFrame, WsSubscribeFrame)):
                    await websocket.send_json({"event": "error", "data": {"message": "Already initialized"}})
                elif isinstance(msg, WsQueueFrame):
                    target = active_run_manager.get(msg.run_id or run.run_id)
                    if not target or target.owner_username != username:
                        await websocket.send_json({"event": "error", "data": {"message": "Run not found or unauthorized"}})
                        continue
                    try:
                        q_attachments = _validate_attachments(msg.attachments, cwd) if msg.attachments else []
                        q_images = _validate_images(msg.images) if msg.images else []
                    except HTTPException as exc:
                        await websocket.send_json({"event": "error", "data": {"message": f"Queue validation failed: {exc.detail}"}})
                        continue
                    try:
                        await active_run_manager.enqueue(target, (msg.id, msg.text, q_attachments or [], q_images or []))
                    except ValueError as exc:
                        await websocket.send_json({"event": "error", "data": {"message": str(exc)}})
                elif isinstance(msg, WsQueueCancelFrame):
                    target = active_run_manager.get(msg.run_id or run.run_id)
                    if not target or target.owner_username != username:
                        await websocket.send_json({"event": "error", "data": {"message": "Run not found or unauthorized"}})
                        continue
                    if not await active_run_manager.cancel_queued(target, msg.id):
                        await websocket.send_json({"event": "error", "data": {"message": f"Queued id not found: {msg.id}"}})
                else:
                    target = active_run_manager.get(msg.run_id or run.run_id)
                    if target and target.owner_username == username:
                        await active_run_manager.abort(target)
                    return
        except WebSocketDisconnect:
            return

    sender_task = asyncio.create_task(sender())
    reader_task = asyncio.create_task(reader())
    try:
        done, pending = await asyncio.wait({sender_task, reader_task}, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            try:
                await task
            except WebSocketDisconnect:
                pass
    finally:
        active_run_manager.unsubscribe(run, subscription)
        for task in (sender_task, reader_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(sender_task, reader_task, return_exceptions=True)
        try:
            await websocket.close(code=1000)
        except Exception:
            pass
