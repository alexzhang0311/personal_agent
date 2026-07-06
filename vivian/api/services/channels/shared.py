from __future__ import annotations

import json
import os
import tempfile
import time
import uuid
from pathlib import Path

from ..config import get_settings


def _get_work_dir() -> Path:
    settings = get_settings()
    return Path(settings.server.work_dir).expanduser()


def get_channels_dir() -> Path:
    return _get_work_dir() / ".channels"


def get_commands_dir() -> Path:
    return get_channels_dir() / "commands"


def get_state_path() -> Path:
    return get_channels_dir() / "state.json"


def get_heartbeat_path() -> Path:
    return get_channels_dir() / "heartbeat"


def get_sessions_path(username: str) -> Path:
    return _get_work_dir() / username / ".vivian.wecom.sessions.json"


def write_command(cmd_type: str, payload: dict) -> None:
    """Atomically write a command file for the channel daemon to consume."""
    commands_dir = get_commands_dir()
    commands_dir.mkdir(parents=True, exist_ok=True)

    ts = int(time.time() * 1000)
    uid = uuid.uuid4().hex[:8]
    filename = f"{cmd_type}_{ts}_{uid}.json"

    data = {"type": cmd_type, "payload": payload}

    # Atomic write: temp file + rename
    fd, tmp_path = tempfile.mkstemp(dir=commands_dir, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f)
        os.replace(tmp_path, commands_dir / filename)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
