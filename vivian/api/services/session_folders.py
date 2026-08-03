from __future__ import annotations

import fcntl
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TextIO


_FOLDER_FILE = ".vivian.session-folders.jsonl"
_MAX_FOLDER_NAME_LENGTH = 64


class SessionFolderError(ValueError):
    """Base error for session folder operations."""


class SessionFolderNotFoundError(SessionFolderError):
    """Raised when a requested folder does not exist."""


class SessionFolderConflictError(SessionFolderError):
    """Raised when a folder name is already in use."""


@dataclass(frozen=True)
class SessionFolderRecord:
    folder_id: str
    name: str
    created_at: str


@dataclass
class SessionFolderState:
    folders: dict[str, SessionFolderRecord] = field(default_factory=dict)
    assignments: dict[str, str] = field(default_factory=dict)


def _folder_path(workspace: str | Path) -> Path:
    return Path(workspace).expanduser() / _FOLDER_FILE


def _normalize_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise SessionFolderError("Folder name cannot be empty")
    if len(normalized) > _MAX_FOLDER_NAME_LENGTH:
        raise SessionFolderError(
            f"Folder name cannot exceed {_MAX_FOLDER_NAME_LENGTH} characters"
        )
    if "/" in normalized:
        raise SessionFolderError("Folder name cannot contain '/'")
    if any(ord(char) < 32 for char in normalized):
        raise SessionFolderError("Folder name cannot contain control characters")
    return normalized


def _apply_event(state: SessionFolderState, raw: dict[str, Any]) -> None:
    op = raw.get("op")
    if op == "folder_upsert":
        folder_id = raw.get("folder_id")
        name = raw.get("name")
        created_at = raw.get("created_at")
        if not all(
            isinstance(value, str) and value
            for value in (folder_id, name, created_at)
        ):
            return
        state.folders[folder_id] = SessionFolderRecord(
            folder_id=folder_id,
            name=name,
            created_at=created_at,
        )
        return

    if op == "folder_delete":
        folder_id = raw.get("folder_id")
        if not isinstance(folder_id, str) or not folder_id:
            return
        state.folders.pop(folder_id, None)
        state.assignments = {
            session_id: assigned_folder
            for session_id, assigned_folder in state.assignments.items()
            if assigned_folder != folder_id
        }
        return

    if op == "session_move":
        session_id = raw.get("session_id")
        folder_id = raw.get("folder_id")
        if not isinstance(session_id, str) or not session_id:
            return
        if folder_id is None:
            state.assignments.pop(session_id, None)
        elif isinstance(folder_id, str) and folder_id:
            state.assignments[session_id] = folder_id


def _read_state(handle: TextIO) -> SessionFolderState:
    state = SessionFolderState()
    handle.seek(0)
    for line in handle:
        try:
            raw = json.loads(line)
        except (TypeError, ValueError):
            continue
        if isinstance(raw, dict):
            _apply_event(state, raw)
    return state


def _append_locked(handle: TextIO, payload: dict[str, Any]) -> None:
    handle.seek(0, os.SEEK_END)
    handle.write(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    handle.flush()
    os.fsync(handle.fileno())


def load_session_folders(workspace: str | Path) -> SessionFolderState:
    path = _folder_path(workspace)
    if not path.exists():
        return SessionFolderState()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            fcntl.flock(handle, fcntl.LOCK_SH)
            try:
                return _read_state(handle)
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)
    except FileNotFoundError:
        return SessionFolderState()


def create_session_folder(
    workspace: str | Path,
    name: str,
) -> SessionFolderRecord:
    normalized = _normalize_name(name)
    path = _folder_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            state = _read_state(handle)
            if any(
                folder.name.casefold() == normalized.casefold()
                for folder in state.folders.values()
            ):
                raise SessionFolderConflictError(
                    "A folder with this name already exists"
                )
            record = SessionFolderRecord(
                folder_id=str(uuid.uuid4()),
                name=normalized,
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            _append_locked(handle, {
                "op": "folder_upsert",
                "folder_id": record.folder_id,
                "name": record.name,
                "created_at": record.created_at,
            })
            return record
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def rename_session_folder(
    workspace: str | Path,
    folder_id: str,
    name: str,
) -> SessionFolderRecord:
    normalized = _normalize_name(name)
    path = _folder_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            state = _read_state(handle)
            current = state.folders.get(folder_id)
            if current is None:
                raise SessionFolderNotFoundError("Session folder not found")
            if any(
                other.folder_id != folder_id
                and other.name.casefold() == normalized.casefold()
                for other in state.folders.values()
            ):
                raise SessionFolderConflictError(
                    "A folder with this name already exists"
                )
            record = SessionFolderRecord(
                folder_id=folder_id,
                name=normalized,
                created_at=current.created_at,
            )
            _append_locked(handle, {
                "op": "folder_upsert",
                "folder_id": record.folder_id,
                "name": record.name,
                "created_at": record.created_at,
            })
            return record
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def delete_session_folder(workspace: str | Path, folder_id: str) -> int:
    path = _folder_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            state = _read_state(handle)
            if folder_id not in state.folders:
                raise SessionFolderNotFoundError("Session folder not found")
            unfiled_count = sum(
                assigned_folder == folder_id
                for assigned_folder in state.assignments.values()
            )
            _append_locked(handle, {
                "op": "folder_delete",
                "folder_id": folder_id,
            })
            return unfiled_count
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def move_session_to_folder(
    workspace: str | Path,
    session_id: str,
    folder_id: str | None,
) -> None:
    path = _folder_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            state = _read_state(handle)
            if folder_id is not None and folder_id not in state.folders:
                raise SessionFolderNotFoundError("Session folder not found")
            _append_locked(handle, {
                "op": "session_move",
                "session_id": session_id,
                "folder_id": folder_id,
            })
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def clear_session_folder_assignment(
    workspace: str | Path,
    session_id: str,
) -> None:
    if not _folder_path(workspace).exists():
        return
    move_session_to_folder(workspace, session_id, None)
