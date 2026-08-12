from __future__ import annotations

import json
import os
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from claude_agent_sdk._internal.sessions import _canonicalize_path, _get_project_dir

from ..config import get_settings
from ..session_origins import _origin_path, delete_session_origin, session_origin_lock


QUARANTINE_HOURS = 24


def _work_dir() -> Path:
    return Path(get_settings().server.work_dir).expanduser()


def _parse_timestamp(value: Any, fallback: float | None = None) -> datetime | None:
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if fallback is not None:
        return datetime.fromtimestamp(fallback, tz=timezone.utc)
    return None


def _load_scheduler_origins_unlocked(path: Path) -> dict[str, dict[str, Any]]:
    origins: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return origins
    with path.open("r", encoding="utf-8") as handle:
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
            elif raw.get("session_kind") == "scheduler":
                origins[session_id] = raw
    return origins


def load_scheduler_origins_with_time(
    workspace: str | Path,
) -> dict[str, dict[str, Any]]:
    with session_origin_lock(workspace, exclusive=False):
        return _load_scheduler_origins_unlocked(_origin_path(workspace))


def compact_session_origins(workspace: str | Path) -> None:
    path = _origin_path(workspace)
    if not path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with session_origin_lock(workspace, exclusive=True):
        origins = _load_scheduler_origins_unlocked(path)
        fd, temp_path = tempfile.mkstemp(
            dir=path.parent, prefix=path.name, suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                for payload in origins.values():
                    handle.write(
                        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                        + "\n"
                    )
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, path)
        except Exception:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise


class SchedulerSessionRetention:
    def __init__(self, quarantine_hours: int = QUARANTINE_HOURS) -> None:
        self._quarantine_hours = quarantine_hours

    def purge_all_users(
        self, retention_days: int, active_run_ids: set[str] | None = None
    ) -> dict[str, int]:
        retention_days = max(1, int(retention_days))
        active_run_ids = active_run_ids or set()
        now = datetime.now(timezone.utc)
        result = {"quarantined": 0, "deleted": 0, "bytes": 0, "failed": 0}
        work_dir = _work_dir()
        if not work_dir.exists():
            return result
        for user_dir in work_dir.iterdir():
            if (
                not user_dir.is_dir()
                or user_dir.is_symlink()
                or user_dir.name.startswith(".")
            ):
                continue
            workspace = user_dir.resolve()
            origins = load_scheduler_origins_with_time(workspace)
            project_dir = _get_project_dir(_canonicalize_path(str(workspace)))
            cutoff = now - timedelta(days=retention_days)
            for session_id, origin in origins.items():
                if origin.get("run_id") in active_run_ids:
                    continue
                session_file = project_dir / f"{session_id}.jsonl"
                try:
                    stat = session_file.stat()
                except FileNotFoundError:
                    continue
                recorded_at = _parse_timestamp(origin.get("recorded_at"), stat.st_mtime)
                if recorded_at is None or recorded_at > cutoff:
                    continue
                try:
                    self._quarantine(workspace, session_file, session_id, origin, now)
                    delete_session_origin(workspace, session_id)
                    result["quarantined"] += 1
                    result["bytes"] += stat.st_size
                except Exception:
                    result["failed"] += 1
            if origins:
                compact_session_origins(workspace)
        self._delete_expired_quarantine(now, result)
        return result

    def _quarantine(
        self,
        workspace: Path,
        session_file: Path,
        session_id: str,
        origin: dict[str, Any],
        now: datetime,
    ) -> None:
        quarantine_root = session_file.parents[2] / ".vivian-session-quarantine"
        destination = quarantine_root / workspace.name / session_id
        destination.mkdir(parents=True, exist_ok=False)
        subagents = session_file.with_suffix("")
        moved: list[tuple[Path, Path]] = []
        manifest = {
            "workspace": str(workspace),
            "session_id": session_id,
            "quarantined_at": now.isoformat(),
            "delete_after": (now + timedelta(hours=self._quarantine_hours)).isoformat(),
            "origin": origin,
        }
        try:
            # Write recovery metadata before moving source data. A crash at
            # any later point leaves enough information for operators to
            # identify the quarantined session.
            (destination / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            session_target = destination / session_file.name
            shutil.move(str(session_file), session_target)
            moved.append((session_target, session_file))
            if subagents.exists():
                subagents_target = destination / subagents.name
                shutil.move(str(subagents), subagents_target)
                moved.append((subagents_target, subagents))
        except Exception:
            for quarantined, original in reversed(moved):
                try:
                    if quarantined.exists() and not original.exists():
                        shutil.move(str(quarantined), original)
                except Exception:
                    pass
            shutil.rmtree(destination, ignore_errors=True)
            raise

    @staticmethod
    def _delete_expired_quarantine(now: datetime, result: dict[str, int]) -> None:
        config_dir = Path(
            os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude"
        )
        root = config_dir / ".vivian-session-quarantine"
        if not root.exists():
            return
        for manifest_path in root.glob("*/*/manifest.json"):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                delete_after = _parse_timestamp(manifest.get("delete_after"))
                if delete_after is not None and delete_after <= now:
                    shutil.rmtree(manifest_path.parent)
                    result["deleted"] += 1
            except Exception:
                result["failed"] += 1
