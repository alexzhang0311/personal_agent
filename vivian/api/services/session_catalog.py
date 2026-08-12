from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from claude_agent_sdk._internal.sessions import (
    _canonicalize_path,
    _get_project_dir,
    _get_worktree_paths,
    _parse_session_info_from_lite,
    _read_session_lite,
)


INITIAL_SESSION_COUNT = 50
BACKGROUND_BATCH_SIZE = 25
BACKGROUND_BATCH_DELAY_SECONDS = 0.25
INVENTORY_REFRESH_SECONDS = 60


@dataclass
class CatalogCandidate:
    session_id: str
    path: Path
    project_path: str
    mtime_ms: int
    size: int

    @property
    def last_modified(self) -> int:
        return self.mtime_ms

    @property
    def file_size(self) -> int:
        return self.size


@dataclass
class SessionCatalogStatus:
    state: str
    discovered: int
    processed: int
    total_exact: bool
    last_error: str | None = None


@dataclass
class SessionCatalogSnapshot:
    sessions: list[object]
    candidate_ids: list[str]
    candidates: list[CatalogCandidate]
    status: SessionCatalogStatus


@dataclass
class _CatalogState:
    workspace: str
    candidates: list[CatalogCandidate]
    candidate_ids: list[str]
    valid_sessions: list[object] = field(default_factory=list)
    processed_ids: set[str] = field(default_factory=set)
    last_inventory_at: float = field(default_factory=time.monotonic)
    invalidated: bool = False
    last_error: str | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    background_task: asyncio.Task | None = None


def _scan_candidates(workspace: str) -> list[CatalogCandidate]:
    canonical = _canonicalize_path(workspace)
    project_paths = [canonical]
    try:
        project_paths.extend(_get_worktree_paths(canonical))
    except Exception:
        pass

    by_session_id: dict[str, CatalogCandidate] = {}
    seen_dirs: set[Path] = set()
    for project_path in dict.fromkeys(project_paths):
        project_dir = _get_project_dir(project_path)
        if project_dir in seen_dirs:
            continue
        seen_dirs.add(project_dir)
        try:
            entries = os.scandir(project_dir)
        except OSError:
            continue
        with entries:
            for entry in entries:
                if not entry.name.endswith(".jsonl") or not entry.is_file(
                    follow_symlinks=False
                ):
                    continue
                try:
                    stat = entry.stat(follow_symlinks=False)
                except OSError:
                    continue
                session_id = entry.name[:-6]
                candidate = CatalogCandidate(
                    session_id=session_id,
                    path=Path(entry.path),
                    project_path=project_path,
                    mtime_ms=int(stat.st_mtime * 1000),
                    size=stat.st_size,
                )
                previous = by_session_id.get(session_id)
                if previous is None or candidate.mtime_ms > previous.mtime_ms:
                    by_session_id[session_id] = candidate

    return sorted(by_session_id.values(), key=lambda row: row.mtime_ms, reverse=True)


def _parse_candidate(candidate: CatalogCandidate):
    lite = _read_session_lite(candidate.path)
    if lite is None:
        return None
    return _parse_session_info_from_lite(
        candidate.session_id,
        lite,
        candidate.project_path,
    )


def _parse_batch(candidates: list[CatalogCandidate]) -> list[object | None]:
    return [_parse_candidate(candidate) for candidate in candidates]


class SessionCatalog:
    """Process-local lazy session metadata catalog.

    The filesystem remains the source of truth. Only lightweight inventory
    and parsed SDK metadata are retained in memory; no persistent index is
    introduced.
    """

    def __init__(self) -> None:
        self._states: dict[str, _CatalogState] = {}
        self._states_lock = asyncio.Lock()
        self._background_gate = asyncio.Lock()

    def invalidate(self, workspace: str | None) -> None:
        if not workspace:
            return
        state = self._states.get(_canonicalize_path(workspace))
        if state is not None:
            state.invalidated = True

    async def reset(self) -> None:
        async with self._states_lock:
            states = list(self._states.values())
            self._states = {}
        tasks = [
            state.background_task
            for state in states
            if state.background_task and not state.background_task.done()
        ]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def snapshot(
        self,
        workspace: str,
        *,
        required: int = INITIAL_SESSION_COUNT,
    ) -> SessionCatalogSnapshot:
        state = await self._get_state(workspace)
        await self._process_until(state, max(0, required))
        self._start_background_build(state)
        return self._snapshot(state)

    async def inventory(
        self, workspace: str, *, build_background: bool = True
    ) -> SessionCatalogSnapshot:
        state = await self._get_state(workspace)
        if build_background:
            self._start_background_build(state)
        return self._snapshot(state)

    async def _get_state(self, workspace: str) -> _CatalogState:
        canonical = _canonicalize_path(workspace)
        async with self._states_lock:
            state = self._states.get(canonical)
            stale = (
                state is None
                or state.invalidated
                or time.monotonic() - state.last_inventory_at
                >= INVENTORY_REFRESH_SECONDS
            )
            if not stale:
                return state
            if state and state.background_task and not state.background_task.done():
                state.background_task.cancel()
            candidates = await asyncio.to_thread(_scan_candidates, canonical)
            if state is None:
                state = _CatalogState(
                    workspace=canonical,
                    candidates=candidates,
                    candidate_ids=[row.session_id for row in candidates],
                )
                self._states[canonical] = state
                return state

            previous = {row.session_id: row for row in state.candidates}
            current = {row.session_id: row for row in candidates}
            unchanged_ids = {
                session_id
                for session_id in state.processed_ids
                if session_id in current
                and session_id in previous
                and current[session_id].mtime_ms == previous[session_id].mtime_ms
                and current[session_id].size == previous[session_id].size
            }
            state.candidates = candidates
            state.candidate_ids = [row.session_id for row in candidates]
            state.valid_sessions = [
                row for row in state.valid_sessions if row.session_id in unchanged_ids
            ]
            state.processed_ids = unchanged_ids
            state.last_inventory_at = time.monotonic()
            state.invalidated = False
            state.last_error = None
            return state

    async def _process_until(self, state: _CatalogState, required: int) -> None:
        async with state.lock:
            target = min(required, len(state.candidates))
            required_ids = {
                candidate.session_id for candidate in state.candidates[:target]
            }
            while not required_ids.issubset(state.processed_ids):
                remaining = len(required_ids - state.processed_ids)
                await self._process_batch_locked(
                    state, min(BACKGROUND_BATCH_SIZE, remaining)
                )
                if state.last_error:
                    return

    async def _process_batch_locked(
        self, state: _CatalogState, batch_size: int
    ) -> None:
        batch = [
            candidate
            for candidate in state.candidates
            if candidate.session_id not in state.processed_ids
        ][:batch_size]
        if not batch:
            return
        try:
            parsed = await asyncio.to_thread(_parse_batch, batch)
        except Exception as exc:
            state.last_error = str(exc) or type(exc).__name__
            return
        state.processed_ids.update(candidate.session_id for candidate in batch)
        state.valid_sessions.extend(
            session for session in parsed if session is not None
        )
        state.valid_sessions.sort(key=lambda row: row.last_modified, reverse=True)
        state.last_error = None

    def _start_background_build(self, state: _CatalogState) -> None:
        if len(state.processed_ids) >= len(state.candidates):
            return
        if state.background_task is None or state.background_task.done():
            state.background_task = asyncio.create_task(self._build_remaining(state))

    async def _build_remaining(self, state: _CatalogState) -> None:
        try:
            while (
                len(state.processed_ids) < len(state.candidates)
                and not state.invalidated
            ):
                async with state.lock:
                    await self._process_batch_locked(state, BACKGROUND_BATCH_SIZE)
                    if state.last_error:
                        return
                await asyncio.sleep(BACKGROUND_BATCH_DELAY_SECONDS)
        except asyncio.CancelledError:
            raise

    @staticmethod
    def _snapshot(state: _CatalogState) -> SessionCatalogSnapshot:
        complete = len(state.processed_ids) >= len(state.candidates)
        status = SessionCatalogStatus(
            state="error" if state.last_error else "ready" if complete else "building",
            discovered=len(state.candidates),
            processed=len(state.processed_ids),
            total_exact=complete,
            last_error=state.last_error,
        )
        return SessionCatalogSnapshot(
            sessions=list(state.valid_sessions),
            candidate_ids=list(state.candidate_ids),
            candidates=list(state.candidates),
            status=status,
        )


_catalog: SessionCatalog | None = None


def get_session_catalog() -> SessionCatalog:
    global _catalog
    if _catalog is None:
        _catalog = SessionCatalog()
    return _catalog
