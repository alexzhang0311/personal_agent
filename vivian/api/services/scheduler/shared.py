from __future__ import annotations

import json
import os
import tempfile
import time
import uuid
from pathlib import Path

from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from ..config import get_settings
from ...models.scheduler import CronTriggerConfig, IntervalTriggerConfig, TriggerConfig


def _get_work_dir() -> Path:
    settings = get_settings()
    return Path(settings.server.work_dir).expanduser()


def get_scheduler_dir() -> Path:
    return _get_work_dir() / ".scheduler"


def get_commands_dir() -> Path:
    return get_scheduler_dir() / "commands"


def get_user_runs_dir(username: str) -> Path:
    return get_scheduler_dir() / "runs" / username


def get_state_path() -> Path:
    return get_scheduler_dir() / "state.json"


def get_jobs_state_path() -> Path:
    return get_scheduler_dir() / "jobs_state.json"


def get_heartbeat_path() -> Path:
    return get_scheduler_dir() / "heartbeat"


def write_command(cmd_type: str, payload: dict) -> None:
    """Atomically write a command file for the daemon to consume."""
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


def build_trigger(config: TriggerConfig, timezone: str):
    """Build an APScheduler trigger from config + timezone."""
    if isinstance(config, CronTriggerConfig):
        return CronTrigger.from_crontab(config.expr, timezone=timezone)

    if isinstance(config, IntervalTriggerConfig):
        return IntervalTrigger(
            weeks=config.weeks,
            days=config.days,
            hours=config.hours,
            minutes=config.minutes,
            seconds=config.seconds,
        )

    raise ValueError(f"Unknown trigger type: {config}")
