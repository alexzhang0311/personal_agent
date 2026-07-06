"""Append-only JSONL log of hook executions per user.

Daily-partitioned files: ``.vivian.hooks.log.YYYY-MM-DD.jsonl`` (per user).
Cursor-paginated reads stay O(limit) regardless of total record count;
unfiltered total comes from a counts sidecar updated under the data lock.
"""

from __future__ import annotations

import fcntl
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from ..config import get_settings
from .._pagination import (
    compute_cursors,
    decode_cursor,
    increment_counts_sidecar,
    list_daily_files,
    read_counts_sidecar,
    read_records_page,
    rebuild_counts,
    write_counts_sidecar,
)
from ...middleware.logging import get_app_logger
from ...models.hooks import HookLogEntry

logger = get_app_logger(__name__)

_DATE_PATTERN = re.compile(r"\.vivian\.hooks\.log\.(\d{4}-\d{2}-\d{2})\.jsonl$")


def _get_work_dir() -> Path:
    settings = get_settings()
    return Path(settings.server.work_dir).expanduser()


def _legacy_path(username: str) -> Path:
    return _get_work_dir() / username / ".vivian.hooks.log.jsonl"


def _daily_path(username: str, date_str: str) -> Path:
    return _get_work_dir() / username / f".vivian.hooks.log.{date_str}.jsonl"


def _counts_path(username: str) -> Path:
    return _get_work_dir() / username / ".vivian.hooks.log.counts.json"


def _entry_date_str(entry: HookLogEntry) -> str:
    """Extract YYYY-MM-DD from the entry's ISO-8601 timestamp string."""
    ts = entry.timestamp or ""
    if len(ts) >= 10 and ts[4] == "-" and ts[7] == "-":
        return ts[:10]
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _extract_ts_id(raw: dict) -> tuple[str, str]:
    return raw.get("timestamp") or "", raw.get("id") or ""


def _extract_id(raw: dict) -> str:
    return raw.get("id") or ""


class HookLogStore:
    """Per-user daily-partitioned JSONL log of hook executions."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._migrated: set[str] = set()

    # --- Migration --------------------------------------------------------

    def _migrate(self, username: str) -> None:
        legacy = _legacy_path(username)
        if not legacy.exists():
            return

        with self._lock:
            if not legacy.exists():
                return

            logger.info("Migrating legacy hooks log for user {}", username)

            entries: list[HookLogEntry] = []
            try:
                with open(legacy, "r") as f:
                    fcntl.flock(f, fcntl.LOCK_SH)
                    try:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                entries.append(HookLogEntry.model_validate(json.loads(line)))
                            except Exception:
                                continue
                    finally:
                        fcntl.flock(f, fcntl.LOCK_UN)
            except Exception:
                logger.warning("Failed to read legacy hooks log for {}", username)
                return

            by_date: dict[str, list[HookLogEntry]] = {}
            for e in entries:
                by_date.setdefault(_entry_date_str(e), []).append(e)

            for date_str, group in by_date.items():
                path = _daily_path(username, date_str)
                path.parent.mkdir(parents=True, exist_ok=True)
                with open(path, "a") as f:
                    fcntl.flock(f, fcntl.LOCK_EX)
                    try:
                        for e in group:
                            f.write(e.model_dump_json() + "\n")
                    finally:
                        fcntl.flock(f, fcntl.LOCK_UN)

            legacy.unlink()
            logger.info(
                "Hooks log migration complete for user {} — {} entries across {} days",
                username, len(entries), len(by_date),
            )

    def _ensure_migrated(self, username: str) -> None:
        if username in self._migrated:
            return
        if _legacy_path(username).exists():
            self._migrate(username)
        self._migrated.add(username)

    # --- Write ------------------------------------------------------------

    def append(self, username: str, entry: HookLogEntry) -> None:
        date_str = _entry_date_str(entry)
        path = _daily_path(username, date_str)
        path.parent.mkdir(parents=True, exist_ok=True)
        counts_path = _counts_path(username)

        with self._lock:
            with open(path, "a") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    f.write(entry.model_dump_json() + "\n")
                    f.flush()
                    increment_counts_sidecar(counts_path, date_str, entry.id)
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)

    # --- Counts -----------------------------------------------------------

    def _list_daily(self, username: str) -> list[tuple[str, Path]]:
        return list_daily_files(_get_work_dir() / username, _DATE_PATTERN)

    def _get_total(self, username: str) -> int:
        counts_path = _counts_path(username)
        counts = read_counts_sidecar(counts_path)
        daily_files = self._list_daily(username)
        if counts is not None and self._sidecar_matches(counts, daily_files):
            return int(counts["total"])
        return self._rebuild_counts(username, daily_files)

    @staticmethod
    def _sidecar_matches(counts: dict, daily_files: list[tuple[str, Path]]) -> bool:
        if not isinstance(counts.get("total"), int):
            return False
        if not daily_files:
            return counts["total"] == 0

        latest_date_str, latest_path = daily_files[0]
        if counts.get("last_file") != latest_date_str:
            return False

        try:
            with open(latest_path, "rb") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    f.seek(0, 2)
                    size = f.tell()
                    if size == 0:
                        return counts.get("last_line_id") == ""
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
        return raw.get("id") == counts.get("last_line_id")

    def _rebuild_counts(self, username: str, daily_files: list[tuple[str, Path]]) -> int:
        counts = rebuild_counts(daily_files, _extract_id)
        write_counts_sidecar(_counts_path(username), counts)
        return int(counts["total"])

    # --- Read -------------------------------------------------------------

    def query_cursor(
        self,
        username: str,
        event_type: str | None = None,
        limit: int = 50,
        before: str | None = None,
        after: str | None = None,
    ) -> tuple[list[HookLogEntry], str | None, str | None, int | None]:
        self._ensure_migrated(username)
        daily_files = self._list_daily(username)

        before_cursor = decode_cursor(before) if before else None
        after_cursor = decode_cursor(after) if after else None

        prefilter = f'"event_type":"{event_type}"' if event_type else None

        def matches(raw: dict) -> bool:
            if event_type and raw.get("event_type") != event_type:
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

        entries = [HookLogEntry.model_validate(r) for r in records_raw]

        next_cursor, prev_cursor = compute_cursors(
            entries, before_cursor, after_cursor, has_more,
            iso=lambda e: e.timestamp,
            rid=lambda e: e.id,
        )

        total = None if event_type else self._get_total(username)

        return entries, next_cursor, prev_cursor, total


_store: HookLogStore | None = None


def get_hook_log_store() -> HookLogStore:
    global _store
    if _store is None:
        _store = HookLogStore()
    return _store
