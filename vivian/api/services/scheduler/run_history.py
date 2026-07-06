from __future__ import annotations

import fcntl
import json
import re
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from ..config import get_settings
from .._pagination import (
    compute_cursors as _compute_cursors,
    decode_cursor,
    encode_cursor,
    increment_counts_sidecar,
    list_daily_files,
    read_counts_sidecar,
    read_records_page,
    rebuild_counts,
    write_counts_sidecar,
)
from ...models.scheduler import JobRunRecord
from ...middleware.logging import get_scheduler_logger
from .shared import get_user_runs_dir

logger = get_scheduler_logger(__name__)

_DATE_PATTERN = re.compile(r"\.vivian\.scheduler\.history\.(\d{4}-\d{2}-\d{2})\.jsonl$")


def _get_work_dir() -> Path:
    settings = get_settings()
    return Path(settings.server.work_dir).expanduser()


def _get_legacy_path(username: str) -> Path:
    return _get_work_dir() / username / ".vivian.scheduler.history.jsonl"


def _get_daily_path(username: str, date_str: str) -> Path:
    return _get_work_dir() / username / f".vivian.scheduler.history.{date_str}.jsonl"


def _get_counts_path(username: str) -> Path:
    return _get_work_dir() / username / ".vivian.scheduler.history.counts.json"


def _list_daily_files(username: str) -> list[tuple[str, Path]]:
    """Return (date_str, path) pairs sorted newest-first."""
    return list_daily_files(_get_work_dir() / username, _DATE_PATTERN)


def _record_date_str(record: JobRunRecord) -> str:
    if record.started_at:
        return record.started_at.strftime("%Y-%m-%d")
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _extract_ts_id(raw: dict) -> tuple[str, str]:
    """Extract (started_at_iso, run_id) from a raw record dict."""
    ts = raw.get("started_at") or ""
    rid = raw.get("run_id") or ""
    return ts, rid


def _extract_id(raw: dict) -> str:
    return raw.get("run_id") or ""


class RunHistoryStore:
    def __init__(self):
        self._lock = threading.Lock()
        # Tracks usernames already migrated this process to avoid the legacy
        # existence check on every read.
        self._migrated: set[str] = set()

    # --- Write path -------------------------------------------------------

    def append(self, record: JobRunRecord) -> None:
        date_str = _record_date_str(record)
        path = _get_daily_path(record.username, date_str)
        path.parent.mkdir(parents=True, exist_ok=True)
        counts_path = _get_counts_path(record.username)

        with self._lock:
            with open(path, "a") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    f.write(record.model_dump_json() + "\n")
                    f.flush()
                    # Update counts under the same lock. If sidecar is
                    # missing/corrupt, leave it for lazy rebuild.
                    increment_counts_sidecar(counts_path, date_str, record.run_id)
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)

    # --- Migration --------------------------------------------------------

    def _read_daily_file(self, path: Path) -> list[JobRunRecord]:
        """Read one daily file, deduplicating by run_id (last write wins).

        Kept for purge/migration; not on the request path.
        """
        if not path.exists():
            return []

        entries: list[JobRunRecord] = []
        seen_ids: set[str] = set()

        try:
            with open(path, "r") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            record = JobRunRecord.model_validate(json.loads(line))
                        except Exception:
                            continue
                        if record.run_id in seen_ids:
                            entries = [e for e in entries if e.run_id != record.run_id]
                        seen_ids.add(record.run_id)
                        entries.append(record)
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            logger.warning("Failed to read daily history file {}", path)
            return []

        return entries

    def _migrate(self, username: str) -> None:
        """Migrate legacy single file to daily partitioned files."""
        legacy = _get_legacy_path(username)
        if not legacy.exists():
            return

        with self._lock:
            if not legacy.exists():
                return

            logger.info("Migrating legacy history file for user {}", username)
            records = self._read_daily_file(legacy)

            by_date: dict[str, list[JobRunRecord]] = {}
            for r in records:
                d = _record_date_str(r)
                by_date.setdefault(d, []).append(r)

            for date_str, group in by_date.items():
                path = _get_daily_path(username, date_str)
                with open(path, "a") as f:
                    fcntl.flock(f, fcntl.LOCK_EX)
                    try:
                        for r in group:
                            f.write(r.model_dump_json() + "\n")
                    finally:
                        fcntl.flock(f, fcntl.LOCK_UN)

            legacy.unlink()
            logger.info(
                "Migration complete for user {} — {} records across {} days",
                username, len(records), len(by_date),
            )

    def _ensure_migrated(self, username: str) -> None:
        if username in self._migrated:
            return
        legacy = _get_legacy_path(username)
        if legacy.exists():
            self._migrate(username)
        self._migrated.add(username)

    # --- Counts -----------------------------------------------------------

    def _get_total(self, username: str) -> int:
        """Read total from sidecar, lazily rebuilding if missing/stale."""
        counts_path = _get_counts_path(username)
        counts = read_counts_sidecar(counts_path)
        daily_files = _list_daily_files(username)

        if counts is not None and self._sidecar_matches(counts, daily_files):
            return int(counts["total"])

        # Rebuild from scratch
        return self._rebuild_counts(username, daily_files)

    @staticmethod
    def _sidecar_matches(counts: dict, daily_files: list[tuple[str, Path]]) -> bool:
        """Cheap consistency check: latest daily file's last line id matches."""
        if not isinstance(counts.get("total"), int):
            return False
        if not daily_files:
            return counts["total"] == 0

        # last_file is the most-recent date_str the sidecar saw
        latest_date_str, latest_path = daily_files[0]
        if counts.get("last_file") != latest_date_str:
            return False

        # Verify last line id matches (cheap: read last line)
        try:
            with open(latest_path, "rb") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    f.seek(0, 2)  # end
                    size = f.tell()
                    if size == 0:
                        return counts.get("last_line_id") == ""
                    # Read tail (up to 8KB)
                    read_size = min(size, 8192)
                    f.seek(size - read_size)
                    tail = f.read().decode("utf-8", errors="replace")
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            return False

        last_line = tail.strip().split("\n")[-1] if tail.strip() else ""
        if not last_line:
            return False
        try:
            raw = json.loads(last_line)
        except Exception:
            return False
        return raw.get("run_id") == counts.get("last_line_id")

    def _rebuild_counts(self, username: str, daily_files: list[tuple[str, Path]]) -> int:
        counts = rebuild_counts(daily_files, _extract_id)
        write_counts_sidecar(_get_counts_path(username), counts)
        return int(counts["total"])

    # --- Read paths -------------------------------------------------------

    def _read_all(self, username: str) -> list[JobRunRecord]:
        """Full materialization. Kept for purge/get_run/get_latest_run.

        NOT used on the request path — query_cursor is O(limit).
        """
        self._ensure_migrated(username)

        daily_files = _list_daily_files(username)
        if not daily_files:
            return []

        all_entries: list[JobRunRecord] = []
        seen_ids: set[str] = set()

        for date_str, path in reversed(daily_files):
            records = self._read_daily_file(path)
            for r in records:
                if r.run_id in seen_ids:
                    all_entries = [e for e in all_entries if e.run_id != r.run_id]
                seen_ids.add(r.run_id)
                all_entries.append(r)

        return all_entries

    def query_cursor(
        self,
        username: str,
        limit: int = 50,
        before: str | None = None,
        after: str | None = None,
        job_id: str | None = None,
        status: str | None = None,
    ) -> tuple[list[JobRunRecord], str | None, str | None, int | None]:
        """O(limit) cursor-paginated query.

        Returns (records, next_cursor, prev_cursor, total):
          - records: newest-first, up to `limit` entries.
          - next_cursor: cursor for the next (older) page; None if no more.
          - prev_cursor: cursor for the previous (newer) page; None if at start.
          - total: unfiltered total from the counts sidecar; None when any
            filter is active.
        """
        self._ensure_migrated(username)
        daily_files = _list_daily_files(username)

        before_cursor = decode_cursor(before) if before else None
        after_cursor = decode_cursor(after) if after else None

        # Cheap substring prefilter for the most common equality filter
        prefilter = None
        if job_id:
            prefilter = f'"job_id":"{job_id}"'

        has_filters = bool(job_id or status)

        def matches(raw: dict) -> bool:
            if job_id and raw.get("job_id") != job_id:
                return False
            if status and raw.get("status") != status:
                return False
            return True

        records_raw, has_more = read_records_page(
            daily_files,
            limit=limit,
            extract_ts_id=_extract_ts_id,
            matches_filters=matches,
            prefilter_substr=prefilter,
            before_cursor=before_cursor,
            after_cursor=after_cursor,
        )

        records = [JobRunRecord.model_validate(r) for r in records_raw]

        next_cursor, prev_cursor = _compute_cursors(
            records, before_cursor, after_cursor, has_more,
            iso=lambda r: r.started_at.isoformat() if r.started_at else "",
            rid=lambda r: r.run_id,
        )

        total = None if has_filters else self._get_total(username)

        return records, next_cursor, prev_cursor, total

    def query(
        self,
        username: str,
        limit: int = 50,
        offset: int = 0,
        job_id: str | None = None,
        status: str | None = None,
    ) -> tuple[list[JobRunRecord], int]:
        """Legacy wrapper for tests. New callers must use query_cursor.

        Returns the on-page record count (post-dedup), not the sidecar total —
        preserving pre-cursor semantics where small datasets returned
        ``(records, len(records))``.
        """
        if offset != 0:
            raise ValueError("query(offset=...) is no longer supported; use query_cursor")
        records, _, _, _ = self.query_cursor(
            username, limit=limit, job_id=job_id, status=status,
        )
        return records, len(records)

    def get_run(self, username: str, run_id: str) -> JobRunRecord | None:
        """Ownership-safe lookup."""
        for record in self._read_all(username):
            if record.run_id == run_id:
                return record
        return None

    def get_latest_run(self, username: str, job_id: str) -> JobRunRecord | None:
        entries = self._read_all(username)
        entries = [e for e in entries if e.job_id == job_id]
        if not entries:
            return None
        return entries[-1]

    # --- Maintenance ------------------------------------------------------

    def purge_old_records(self, username: str, retention_days: int) -> int:
        if retention_days <= 0:
            return 0

        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=retention_days))
        daily_files = _list_daily_files(username)
        deleted = 0
        purged_run_ids: list[str] = []

        for date_str, path in daily_files:
            try:
                file_date = date.fromisoformat(date_str)
            except ValueError:
                continue

            if file_date <= cutoff:
                records = self._read_daily_file(path)
                purged_run_ids.extend(r.run_id for r in records)

                path.unlink()
                deleted += 1
                logger.info("Purged history file {} for user {}", path.name, username)

        if purged_run_ids:
            runs_dir = get_user_runs_dir(username)
            if runs_dir.exists():
                for run_id in purged_run_ids:
                    output_file = runs_dir / f"{run_id}.jsonl"
                    if output_file.exists():
                        output_file.unlink()
                        logger.debug("Purged run output file {}", output_file.name)

        if deleted > 0:
            # Counts sidecar is now stale; rebuild lazily on next read.
            counts_path = _get_counts_path(username)
            if counts_path.exists():
                try:
                    counts_path.unlink()
                except OSError:
                    pass

        return deleted

    def purge_all_users(self, retention_days: int) -> None:
        if retention_days <= 0:
            return

        work_dir = _get_work_dir()
        if not work_dir.exists():
            return

        total_deleted = 0
        for user_dir in work_dir.iterdir():
            if not user_dir.is_dir():
                continue
            username = user_dir.name
            if username.startswith("."):
                continue
            deleted = self.purge_old_records(username, retention_days)
            total_deleted += deleted

        if total_deleted > 0:
            logger.info("Purged {} old history files across all users", total_deleted)


_store: RunHistoryStore | None = None


def get_run_history_store() -> RunHistoryStore:
    global _store
    if _store is None:
        _store = RunHistoryStore()
    return _store
