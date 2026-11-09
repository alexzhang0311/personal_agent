from __future__ import annotations

import fcntl
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_BINDINGS_FILE = ".vivian.agent-bindings.json"
_LOCK_FILE = ".vivian.agent-bindings.lock"


def _bindings_path(workspace: str | Path) -> Path:
    return Path(workspace).expanduser() / _BINDINGS_FILE


def _lock_path(workspace: str | Path) -> Path:
    return Path(workspace).expanduser() / _LOCK_FILE


def _load(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError):
        # Corrupt or unreadable file — treat as empty rather than crashing
        # every agent run. The next successful write replaces the file.
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        username: entry
        for username, entry in raw.items()
        if isinstance(username, str)
        and isinstance(entry, dict)
        and isinstance(entry.get("session_id"), str)
        and entry["session_id"]
    }


def _save(path: Path, data: dict[str, dict[str, Any]]) -> None:
    # Atomic replace: write to a temp file in the same directory, fsync,
    # then os.replace so a crash never leaves a truncated bindings file.
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=".vivian.agent-bindings.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def get_binding(workspace: str | Path, username: str) -> str | None:
    """Return the bound session id for ``username`` or None."""
    if not username:
        return None
    entry = _load(_bindings_path(workspace)).get(username)
    if entry is None:
        return None
    session_id = entry.get("session_id")
    return session_id if isinstance(session_id, str) and session_id else None


def set_binding(workspace: str | Path, username: str, session_id: str) -> None:
    """Bind ``username`` to ``session_id`` (last writer wins).

    The whole read-modify-write runs under an exclusive flock on a sidecar
    lock file so concurrent processes cannot lose updates.
    """
    if not username or not session_id:
        return
    lock_path = _lock_path(workspace)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "a+", encoding="utf-8") as lock_handle:
        fcntl.flock(lock_handle, fcntl.LOCK_EX)
        try:
            path = _bindings_path(workspace)
            path.parent.mkdir(parents=True, exist_ok=True)
            data = _load(path)
            data[username] = {
                "session_id": session_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            _save(path, data)
        finally:
            fcntl.flock(lock_handle, fcntl.LOCK_UN)


def clear_binding(workspace: str | Path, username: str) -> None:
    """Remove the binding for ``username`` (no-op if absent)."""
    if not username:
        return
    lock_path = _lock_path(workspace)
    if not _bindings_path(workspace).exists():
        return
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "a+", encoding="utf-8") as lock_handle:
        fcntl.flock(lock_handle, fcntl.LOCK_EX)
        try:
            path = _bindings_path(workspace)
            data = _load(path)
            if username in data:
                del data[username]
                _save(path, data)
        finally:
            fcntl.flock(lock_handle, fcntl.LOCK_UN)
