from __future__ import annotations

import fcntl
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_ORIGIN_FILE = ".vivian.session-origins.jsonl"


def _origin_path(workspace: str | Path) -> Path:
    return Path(workspace).expanduser() / _ORIGIN_FILE


def _append_event(workspace: str | Path, payload: dict[str, Any]) -> None:
    path = _origin_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    with open(path, "a", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            handle.write(line)
            handle.flush()
            os.fsync(handle.fileno())
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def record_scheduler_session(
    workspace: str | Path,
    *,
    session_id: str,
    job_id: str,
    job_name: str,
    run_id: str,
) -> None:
    if not session_id:
        return
    _append_event(
        workspace,
        {
            "op": "upsert",
            "session_id": session_id,
            "session_kind": "scheduler",
            "job_id": job_id,
            "job_name": job_name,
            "run_id": run_id,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        },
    )


def delete_session_origin(workspace: str | Path, session_id: str) -> None:
    if not session_id:
        return
    _append_event(
        workspace,
        {
            "op": "delete",
            "session_id": session_id,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        },
    )


def load_session_origins(workspace: str | Path) -> dict[str, dict[str, str]]:
    path = _origin_path(workspace)
    if not path.exists():
        return {}

    origins: dict[str, dict[str, str]] = {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            fcntl.flock(handle, fcntl.LOCK_SH)
            try:
                for line in handle:
                    try:
                        raw = json.loads(line)
                    except (TypeError, ValueError):
                        continue
                    session_id = raw.get("session_id")
                    if not isinstance(session_id, str) or not session_id:
                        continue
                    if raw.get("op") == "delete":
                        origins.pop(session_id, None)
                        continue
                    if raw.get("session_kind") != "scheduler":
                        continue
                    fields = ("job_id", "job_name", "run_id")
                    if not all(isinstance(raw.get(field), str) for field in fields):
                        continue
                    origins[session_id] = {
                        "job_id": raw["job_id"],
                        "job_name": raw["job_name"],
                        "run_id": raw["run_id"],
                    }
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)
    except FileNotFoundError:
        return {}
    return origins


def session_id_from_event(event_type: str, data: dict[str, Any]) -> str | None:
    if event_type == "result":
        session_id = data.get("session_id")
        return session_id if isinstance(session_id, str) and session_id else None
    if event_type != "system" or data.get("subtype") != "init":
        return None
    inner = data.get("data")
    if not isinstance(inner, dict):
        return None
    session_id = inner.get("session_id")
    return session_id if isinstance(session_id, str) and session_id else None
