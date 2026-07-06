from __future__ import annotations

import asyncio
import uuid
from typing import Any

from claude_agent_sdk.types import PermissionResultAllow, PermissionResultDeny

from ...middleware.logging import get_app_logger

logger = get_app_logger(__name__)


class PermissionCoordinator:
    """Bridges SDK can_use_tool callbacks to the SSE stream for frontend approval."""

    def __init__(
        self,
        session_id: str,
        event_queue: asyncio.Queue[dict[str, Any] | None],
        *,
        owner_username: str | None = None,
    ):
        self.session_id = session_id
        self.event_queue = event_queue
        self.owner_username = owner_username
        self.pending: dict[str, asyncio.Future[PermissionResultAllow | PermissionResultDeny]] = {}
        try:
            from ..config import get_settings
            self.timeout = get_settings().agent.permission_timeout_seconds
        except Exception:
            self.timeout = 600

    async def request_permission(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        context: Any,
        *,
        risky: bool = False,
        matched_rule: str | None = None,
        reason: str | None = None,
        kind: str = "permission",
    ) -> PermissionResultAllow | PermissionResultDeny:
        request_id = str(uuid.uuid4())
        logger.info("[PERM] request_permission request_id={} session_id={} tool={} risky={} queue_id={}",
                    request_id, self.session_id, tool_name, risky, id(self.event_queue))
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.pending[request_id] = future

        await self.event_queue.put({
            "event": "permission_request",
            "data": {
                "request_id": request_id,
                "tool_name": tool_name,
                "input": tool_input,
                "session_id": self.session_id,
                "risky": risky,
                "matched_rule": matched_rule,
                "reason": reason,
                "kind": kind,
            },
        })

        try:
            return await asyncio.wait_for(future, timeout=self.timeout)
        except asyncio.TimeoutError:
            await self.event_queue.put({
                "event": "permission_timeout",
                "data": {
                    "request_id": request_id,
                    "tool_name": tool_name,
                    "session_id": self.session_id,
                },
            })
            return PermissionResultDeny(message="user did not answer")
        finally:
            self.pending.pop(request_id, None)

    async def can_use_tool(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        context: Any,
    ) -> PermissionResultAllow | PermissionResultDeny:
        return await self.request_permission(tool_name, tool_input, context)

    def resolve(
        self,
        request_id: str,
        decision: str,
        message: str = "",
        updated_input: dict[str, Any] | None = None,
    ) -> None:
        logger.info("[PERM] resolve request_id={} decision={} session_id={}",
                    request_id, decision, self.session_id)
        future = self.pending.get(request_id)
        if not future or future.done():
            raise ValueError(f"No pending permission request: {request_id}")
        if decision == "allow":
            future.set_result(PermissionResultAllow(updated_input=updated_input or None))
        else:
            future.set_result(PermissionResultDeny(message=message))

    def cancel_all(self):
        for future in list(self.pending.values()):
            if not future.done():
                future.set_result(PermissionResultDeny(message="Stream cancelled"))
        self.pending.clear()


class PermissionCoordinatorRegistry:
    def __init__(self) -> None:
        self._coordinators: dict[str, PermissionCoordinator] = {}

    def register(self, session_id: str, coordinator: PermissionCoordinator) -> None:
        self._coordinators[session_id] = coordinator

    def unregister(self, session_id: str) -> None:
        self._coordinators.pop(session_id, None)

    def get(self, session_id: str) -> PermissionCoordinator | None:
        return self._coordinators.get(session_id)

    def remap_session(self, old_session_id: str, new_session_id: str, coordinator: PermissionCoordinator) -> None:
        if old_session_id != new_session_id:
            self.unregister(old_session_id)
        coordinator.session_id = new_session_id
        self.register(new_session_id, coordinator)


registry = PermissionCoordinatorRegistry()
