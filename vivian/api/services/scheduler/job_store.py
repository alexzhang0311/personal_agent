from __future__ import annotations

import fcntl
import os
import tempfile
import threading
from datetime import datetime
from pathlib import Path

import yaml

from ..config import get_settings
from ..user_store import get_user_store
from ...models.scheduler import ScheduledJobDefinition, TriggerConfig
from ...middleware.logging import get_scheduler_logger

logger = get_scheduler_logger(__name__)


def _get_work_dir() -> Path:
    settings = get_settings()
    return Path(settings.server.work_dir).expanduser()


def _get_user_config_path(username: str) -> Path:
    return _get_work_dir() / username / ".vivian.user.yml"


class JobStore:
    def __init__(self):
        self._lock = threading.Lock()

    def list_jobs(self, username: str) -> list[ScheduledJobDefinition]:
        path = _get_user_config_path(username)
        if not path.exists():
            return []

        try:
            with open(path, "r") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    data = yaml.safe_load(f) or {}
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            logger.warning("Failed to read jobs for user {}", username)
            return []

        raw_jobs = data.get("scheduled_jobs", [])
        if not isinstance(raw_jobs, list):
            return []

        jobs = []
        for item in raw_jobs:
            if not isinstance(item, dict):
                continue
            try:
                jobs.append(ScheduledJobDefinition.model_validate(item))
            except Exception:
                logger.warning("Skipping invalid job definition for user {}: {}", username, item.get("id", "?"))
                continue
        return jobs

    def get_job(self, username: str, job_id: str) -> ScheduledJobDefinition | None:
        for job in self.list_jobs(username):
            if job.id == job_id:
                return job
        return None

    def save_jobs(self, username: str, jobs: list[ScheduledJobDefinition]) -> None:
        path = _get_user_config_path(username)
        path.parent.mkdir(parents=True, exist_ok=True)

        with self._lock:
            # Read existing data to preserve sibling keys
            existing = {}
            if path.exists():
                try:
                    with open(path, "r") as f:
                        fcntl.flock(f, fcntl.LOCK_SH)
                        try:
                            existing = yaml.safe_load(f) or {}
                        finally:
                            fcntl.flock(f, fcntl.LOCK_UN)
                except Exception:
                    existing = {}

            # Serialize jobs
            existing["scheduled_jobs"] = [
                job.model_dump(mode="json") for job in jobs
            ]

            # Atomic write: temp file + os.replace()
            fd, tmp_path = tempfile.mkstemp(
                dir=path.parent, suffix=".tmp", prefix=".vivian.user."
            )
            try:
                with os.fdopen(fd, "w") as f:
                    fcntl.flock(f, fcntl.LOCK_EX)
                    try:
                        yaml.dump(existing, f, default_flow_style=False, allow_unicode=True)
                    finally:
                        fcntl.flock(f, fcntl.LOCK_UN)
                os.replace(tmp_path, path)
            except Exception:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise

    def list_all_user_jobs(self) -> dict[str, list[ScheduledJobDefinition]]:
        """List all jobs for all users. Uses UserStore.list_users() as sole source of truth."""
        store = get_user_store()
        users = store.list_users()
        result = {}
        for user in users:
            jobs = self.list_jobs(user.username)
            if jobs:
                result[user.username] = jobs
        return result


_store: JobStore | None = None


def get_job_store() -> JobStore:
    global _store
    if _store is None:
        _store = JobStore()
    return _store
