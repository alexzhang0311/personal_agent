from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .claude_sdk.permission_coordinator import PermissionCoordinator


TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
TERMINAL_RETENTION_SECONDS = 300


@dataclass(eq=False)
class ActiveRun:
    """A live agent turn whose lifetime is independent from any transport."""

    run_id: str
    owner_username: str | None
    first_prompt: str
    session_id: str | None = None
    status: str = "running"
    seq: int = 0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    events: list[dict[str, Any]] = field(default_factory=list)
    pending_requests: dict[str, dict[str, Any]] = field(default_factory=dict)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    coordinator_out: list["PermissionCoordinator | None"] = field(default_factory=lambda: [None])
    queue_out: list[asyncio.Queue | None] = field(default_factory=lambda: [None])
    cancelled: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None

    def public_state(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "session_id": self.session_id,
            "status": self.status,
            "seq": self.seq,
            "first_prompt": self.first_prompt,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "pending_requests": list(self.pending_requests.values()),
        }


class ActiveRunManager:
    """Owns in-process agent runs and fans their events out to subscribers.

    Runs are intentionally process-local. A websocket disconnect removes only
    a subscriber; the SDK task is cancelled exclusively through ``abort`` or
    application shutdown.
    """

    def __init__(self) -> None:
        self._runs: dict[str, ActiveRun] = {}

    def get(self, run_id: str) -> ActiveRun | None:
        return self._runs.get(run_id)

    def find_legacy_identifier(self, identifier: str) -> ActiveRun | None:
        """Compatibility lookup for pre-run_id permission clients."""
        direct = self.get(identifier)
        if direct:
            return direct
        matches = []
        for run in self._runs.values():
            coordinator = run.coordinator_out[0]
            if run.session_id == identifier or getattr(coordinator, "session_id", None) == identifier:
                matches.append(run)
        if not matches:
            return None
        return max(matches, key=lambda run: run.updated_at)

    def list_for_owner(self, username: str | None, *, include_terminal: bool = False) -> list[dict[str, Any]]:
        rows = []
        for run in self._runs.values():
            if run.owner_username != username:
                continue
            if not include_terminal and run.status in TERMINAL_STATUSES:
                continue
            rows.append(run.public_state())
        rows.sort(key=lambda row: row["updated_at"], reverse=True)
        return rows

    async def start(self, *, owner_username: str | None, prompt: str, session_id: str | None, kwargs: dict[str, Any]) -> ActiveRun:
        from ..metrics import AGENT_RUNS_STARTED

        run = ActiveRun(
            run_id=str(uuid.uuid4()),
            owner_username=owner_username,
            first_prompt=prompt,
            session_id=session_id,
        )
        self._runs[run.run_id] = run
        AGENT_RUNS_STARTED.inc()
        await self._publish(run, "run_started", run.public_state())
        run.task = asyncio.create_task(self._execute(run, kwargs), name=f"agent-run:{run.run_id}")
        return run

    async def _execute(self, run: ActiveRun, kwargs: dict[str, Any]) -> None:
        # Import lazily: service imports PermissionCoordinator and must not form
        # a module-import cycle with this manager.
        from .claude_sdk.service import agent_run_events

        try:
            await agent_run_events(
                run.first_prompt,
                run.session_id,
                emit=lambda event, data: self._publish(run, event, data),
                cancelled=run.cancelled,
                coordinator_out=run.coordinator_out,
                queue_out=run.queue_out,
                **kwargs,
            )
            if run.cancelled.is_set():
                await self._set_terminal(run, "cancelled")
            elif run.status not in TERMINAL_STATUSES:
                await self._set_terminal(run, "completed")
        except asyncio.CancelledError:
            run.cancelled.set()
            await self._set_terminal(run, "cancelled")
            raise
        except Exception as exc:
            await self._publish(run, "stream_error", {
                "code": type(exc).__name__,
                "message": str(exc) or repr(exc),
                "fatal": True,
                "api_error_status": getattr(exc, "api_error_status", None),
            })
            await self._set_terminal(run, "failed")
        finally:
            from ..metrics import AGENT_RUNS_FINISHED

            outcome = "success" if run.status == "completed" else "cancelled" if run.status == "cancelled" else "error"
            AGENT_RUNS_FINISHED.labels(outcome=outcome).inc()

    async def _set_terminal(self, run: ActiveRun, status: str) -> None:
        if run.status in TERMINAL_STATUSES:
            return
        run.status = status
        run.updated_at = time.time()
        await self._publish(run, "run_state", run.public_state())
        asyncio.create_task(self._remove_after_retention(run))

    async def _remove_after_retention(self, run: ActiveRun) -> None:
        await asyncio.sleep(TERMINAL_RETENTION_SECONDS)
        if self._runs.get(run.run_id) is run and run.status in TERMINAL_STATUSES:
            self._runs.pop(run.run_id, None)

    async def _publish(self, run: ActiveRun, event: str, data: dict[str, Any]) -> None:
        if event == "system" and data.get("subtype") == "init":
            nested = data.get("data") if isinstance(data.get("data"), dict) else {}
            if nested.get("session_id"):
                run.session_id = nested["session_id"]
        elif event == "result" and data.get("session_id"):
            run.session_id = data["session_id"]

        if event == "permission_request":
            request_id = data.get("request_id")
            if request_id:
                run.pending_requests[request_id] = data
            run.status = "waiting_user"
        elif event == "permission_timeout":
            request_id = data.get("request_id")
            if request_id:
                run.pending_requests.pop(request_id, None)
            run.status = "running"
        elif event == "result":
            run.pending_requests.clear()
        elif event in {"assistant", "tool_use", "tool_result", "retry_attempt"}:
            if not run.pending_requests:
                run.status = "running"

        run.seq += 1
        run.updated_at = time.time()
        envelope = {
            "run_id": run.run_id,
            "session_id": run.session_id,
            "seq": run.seq,
            "event": event,
            "data": data,
        }
        run.events.append(envelope)
        for queue in tuple(run.subscribers):
            queue.put_nowait(envelope)

    def subscribe(self, run: ActiveRun, *, after_seq: int = 0) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        replayed = False
        for event in run.events:
            if event["seq"] > after_seq:
                queue.put_nowait(event)
                replayed = True
        if not replayed:
            # Always send a current snapshot. This restores pending prompts and
            # also lets a subscriber close cleanly when it races run completion.
            queue.put_nowait({
                "run_id": run.run_id,
                "session_id": run.session_id,
                "seq": run.seq,
                "event": "run_state",
                "data": run.public_state(),
            })
        run.subscribers.add(queue)
        return queue

    def unsubscribe(self, run: ActiveRun, queue: asyncio.Queue) -> None:
        run.subscribers.discard(queue)

    async def resolve_permission(
        self,
        run: ActiveRun,
        request_id: str,
        decision: str,
        message: str = "",
        updated_input: dict[str, Any] | None = None,
    ) -> None:
        coordinator = run.coordinator_out[0]
        if coordinator is None:
            raise ValueError("No permission coordinator active")
        coordinator.resolve(request_id, decision, message, updated_input)
        run.pending_requests.pop(request_id, None)
        run.status = "running"
        await self._publish(run, "permission_resolved", {
            "request_id": request_id,
            "decision": decision,
        })

    async def enqueue(self, run: ActiveRun, entry: tuple[str, str, list, list]) -> None:
        queue = run.queue_out[0]
        if queue is None:
            raise ValueError("No active stream to queue into")
        await queue.put(entry)
        await self._publish(run, "queued", {"id": entry[0]})

    async def cancel_queued(self, run: ActiveRun, item_id: str) -> bool:
        queue = run.queue_out[0]
        if queue is None:
            raise ValueError("No active stream to cancel from")
        remaining = []
        removed = False
        while not queue.empty():
            try:
                entry = queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if entry[0] == item_id and not removed:
                removed = True
            else:
                remaining.append(entry)
        for entry in remaining:
            queue.put_nowait(entry)
        if removed:
            await self._publish(run, "queue_cancelled", {"id": item_id})
        return removed

    async def abort(self, run: ActiveRun) -> None:
        if run.status in TERMINAL_STATUSES:
            return
        run.cancelled.set()
        coordinator = run.coordinator_out[0]
        if coordinator:
            coordinator.cancel_all()
        if run.task and not run.task.done():
            run.task.cancel()


active_run_manager = ActiveRunManager()
