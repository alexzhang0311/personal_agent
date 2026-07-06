from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..middleware.logging import get_app_logger
from ..models.auth import UserRecord
from ..models.subagents import (
    SubAgentCatalogResponse,
    SubAgentCreateRequest,
    SubAgentDetail,
    SubAgentListResponse,
    SubAgentTestRequest,
    SubAgentUpdateRequest,
)
from ..services.audit_log import AuditEntry, get_audit_logger
from ..services.auth import get_user_workspace, require_user
from ..services.claude_sdk.service import _format_sse_event, agent_run_events
from ..services.subagents import (
    create_agent,
    delete_agent,
    get_agent,
    get_catalog,
    list_agents,
    update_agent,
)

logger = get_app_logger(__name__)

router = APIRouter(prefix="/api/subagents", tags=["subagents"])


@router.get("/catalog", response_model=SubAgentCatalogResponse)
async def get_subagent_catalog(user: UserRecord = Depends(require_user)):
    return get_catalog(user.username)


@router.get("/list", response_model=SubAgentListResponse)
async def list_subagents(user: UserRecord = Depends(require_user)):
    return list_agents(user.username)


@router.get("/{name}", response_model=SubAgentDetail)
async def get_subagent(name: str, user: UserRecord = Depends(require_user)):
    return get_agent(user.username, name)


@router.post("/", response_model=SubAgentDetail)
async def create_subagent(
    request: SubAgentCreateRequest,
    user: UserRecord = Depends(require_user),
):
    detail = create_agent(user.username, request)
    get_audit_logger().append(
        AuditEntry(
            actor=user.username,
            action="agents.create",
            target=detail.name,
            details={"model": detail.model, "tools_count": len(detail.tools)},
        )
    )
    return detail


@router.put("/{name}", response_model=SubAgentDetail)
async def update_subagent(
    name: str,
    request: SubAgentUpdateRequest,
    user: UserRecord = Depends(require_user),
):
    detail = update_agent(user.username, name, request)
    audit = get_audit_logger()

    if request.new_name and request.new_name != name:
        audit.append(
            AuditEntry(
                actor=user.username,
                action="agents.rename",
                target=detail.name,
                details={"old": name, "new": detail.name},
            )
        )

    audit.append(
        AuditEntry(
            actor=user.username,
            action="agents.update",
            target=detail.name,
            details={"model": detail.model, "tools_count": len(detail.tools)},
        )
    )
    return detail


@router.delete("/{name}")
async def delete_subagent(name: str, user: UserRecord = Depends(require_user)):
    delete_agent(user.username, name)
    get_audit_logger().append(
        AuditEntry(
            actor=user.username,
            action="agents.delete",
            target=name,
        )
    )
    return {"message": f"Agent '{name}' deleted successfully"}


@router.post("/{name}/test/stream")
async def test_subagent_stream(
    name: str,
    request: SubAgentTestRequest,
    user: UserRecord = Depends(require_user),
):
    """Spawn a fresh agent run that delegates to the named subagent."""
    # Ensure the agent exists before opening the stream so 404s land cleanly.
    get_agent(user.username, name)

    cwd = get_user_workspace(user)
    wrapped_prompt = f"Use the {name} agent to: {request.prompt}"

    get_audit_logger().append(
        AuditEntry(
            actor=user.username,
            action="agents.test_run",
            target=name,
            details={"prompt": request.prompt[:200]},
        )
    )

    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def emit(event_type: str, data: dict[str, Any]) -> None:
        if event_type == "keepalive":
            await queue.put(": keepalive\n\n")
        else:
            await queue.put(_format_sse_event(event_type, data))

    async def run() -> None:
        try:
            await agent_run_events(
                wrapped_prompt,
                session_id=None,
                permission_mode="bypassPermissions",
                cwd=cwd,
                username=user.username,
                emit=emit,
                extra_allowed_tools=["Agent", "Task"],
                inject_openclaw_tools=False,
            )
        except Exception as exc:
            logger.exception("subagent test run failed")
            await queue.put(_format_sse_event("error", {"message": str(exc)}))
        finally:
            await queue.put(None)

    run_task = asyncio.create_task(run())

    async def gen():
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            run_task.cancel()
            try:
                await run_task
            except asyncio.CancelledError:
                pass

    return StreamingResponse(gen(), media_type="text/event-stream")
