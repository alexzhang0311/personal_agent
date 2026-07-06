from __future__ import annotations

import fcntl
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, Field

from ..middleware.logging import get_app_logger
from ._pagination import (
    compute_cursors,
    decode_cursor,
    increment_counts_sidecar,
    list_daily_files,
    read_counts_sidecar,
    read_records_page,
    rebuild_counts,
    write_counts_sidecar,
)
from .paths import vivian_home

logger = get_app_logger(__name__)

_DATE_PATTERN = re.compile(r"\.vivian\.audit\.(\d{4}-\d{2}-\d{2})\.jsonl$")


def _legacy_path() -> Path:
    return vivian_home() / ".vivian.audit.jsonl"


def _daily_path(date_str: str) -> Path:
    return vivian_home() / f".vivian.audit.{date_str}.jsonl"


def _counts_path() -> Path:
    return vivian_home() / ".vivian.audit.counts.json"


def _entry_date_str(entry: AuditEntry) -> str:
    ts = entry.timestamp
    if ts.tzinfo is None:
        # Treat naive timestamps as UTC for partitioning
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%d")


def _extract_ts_id(raw: dict) -> tuple[str, str]:
    return raw.get("timestamp") or "", raw.get("id") or ""


def _extract_id(raw: dict) -> str:
    return raw.get("id") or ""


class AuditEntry(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    timestamp: datetime = Field(default_factory=datetime.now)
    actor: str
    action: str
    target: str | None = None
    details: dict = Field(default_factory=dict)


class AuditLogger:
    def __init__(self, base_dir: Path | None = None):
        # Allow tests to override the base directory.
        self._base_dir = base_dir
        self._lock = threading.Lock()
        self._migrated = False

    # --- Paths (respect base_dir override) --------------------------------

    def _legacy(self) -> Path:
        return (self._base_dir or vivian_home()) / ".vivian.audit.jsonl"

    def _daily(self, date_str: str) -> Path:
        return (self._base_dir or vivian_home()) / f".vivian.audit.{date_str}.jsonl"

    def _counts(self) -> Path:
        return (self._base_dir or vivian_home()) / ".vivian.audit.counts.json"

    def _list_daily(self) -> list[tuple[str, Path]]:
        return list_daily_files(self._base_dir or vivian_home(), _DATE_PATTERN)

    # --- Migration --------------------------------------------------------

    def _migrate(self) -> None:
        legacy = self._legacy()
        if not legacy.exists():
            return

        with self._lock:
            if not legacy.exists():
                return

            logger.info("Migrating legacy audit log file")

            entries: list[AuditEntry] = []
            try:
                with open(legacy, "r") as f:
                    fcntl.flock(f, fcntl.LOCK_SH)
                    try:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                entries.append(AuditEntry.model_validate(json.loads(line)))
                            except Exception:
                                continue
                    finally:
                        fcntl.flock(f, fcntl.LOCK_UN)
            except Exception:
                logger.warning("Failed to read legacy audit file")
                return

            by_date: dict[str, list[AuditEntry]] = {}
            for e in entries:
                by_date.setdefault(_entry_date_str(e), []).append(e)

            for date_str, group in by_date.items():
                path = self._daily(date_str)
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
                "Audit migration complete — {} entries across {} days",
                len(entries), len(by_date),
            )

    def _ensure_migrated(self) -> None:
        if self._migrated:
            return
        if self._legacy().exists():
            self._migrate()
        self._migrated = True

    # --- Write ------------------------------------------------------------

    def append(self, entry: AuditEntry) -> None:
        date_str = _entry_date_str(entry)
        path = self._daily(date_str)
        path.parent.mkdir(parents=True, exist_ok=True)
        counts_path = self._counts()

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

    def _get_total(self) -> int:
        counts_path = self._counts()
        counts = read_counts_sidecar(counts_path)
        daily_files = self._list_daily()
        if counts is not None and self._sidecar_matches(counts, daily_files):
            return int(counts["total"])
        return self._rebuild_counts(daily_files)

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

    def _rebuild_counts(self, daily_files: list[tuple[str, Path]]) -> int:
        counts = rebuild_counts(daily_files, _extract_id)
        write_counts_sidecar(self._counts(), counts)
        return int(counts["total"])

    # --- Read -------------------------------------------------------------

    def query_cursor(
        self,
        limit: int = 50,
        before: str | None = None,
        after: str | None = None,
        action_filter: str | None = None,
        actor_filter: str | None = None,
        target_filter: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        session_id_filter: str | None = None,
    ) -> tuple[list[AuditEntry], str | None, str | None, int | None]:
        self._ensure_migrated()
        daily_files = self._list_daily()

        before_cursor = decode_cursor(before) if before else None
        after_cursor = decode_cursor(after) if after else None

        # Prefilter substring: pick the most specific exact-match filter
        prefilter: str | None = None
        if actor_filter and not any(c.isupper() for c in actor_filter):
            # actor filter is case-insensitive contains; only safe to substring
            # match if exact form. Fall through unless we treat it as exact.
            pass
        # No safe exact filters here (all are contains/startswith); skip prefilter.

        def matches(raw: dict) -> bool:
            action = raw.get("action") or ""
            actor = raw.get("actor") or ""
            target = raw.get("target") or ""
            details = raw.get("details") or {}
            ts_str = raw.get("timestamp") or ""

            if action_filter and not action.startswith(action_filter):
                return False
            if actor_filter and actor_filter.lower() not in actor.lower():
                return False
            if target_filter and (not target or target_filter.lower() not in target.lower()):
                return False
            if session_id_filter:
                sid = str(details.get("session_id") or "")
                if not sid or session_id_filter.lower() not in sid.lower():
                    return False
            if start_time and ts_str:
                # Compare lexicographically — ISO strings sort chronologically
                # when both have same tz format. Fall back to parse on mismatch.
                try:
                    ts = datetime.fromisoformat(ts_str)
                    if ts < start_time:
                        return False
                except ValueError:
                    pass
            if end_time and ts_str:
                try:
                    ts = datetime.fromisoformat(ts_str)
                    if ts > end_time:
                        return False
                except ValueError:
                    pass
            return True

        has_filters = bool(
            action_filter or actor_filter or target_filter
            or start_time or end_time or session_id_filter
        )

        records_raw, has_more = read_records_page(
            daily_files,
            limit=limit,
            extract_ts_id=_extract_ts_id,
            matches_filters=matches,
            prefilter_substr=prefilter,
            before_cursor=before_cursor,
            after_cursor=after_cursor,
        )

        entries = [AuditEntry.model_validate(r) for r in records_raw]

        next_cursor, prev_cursor = compute_cursors(
            entries, before_cursor, after_cursor, has_more,
            iso=lambda e: e.timestamp.isoformat(),
            rid=lambda e: e.id,
        )

        total = None if has_filters else self._get_total()

        return entries, next_cursor, prev_cursor, total


_logger: AuditLogger | None = None


def get_audit_logger() -> AuditLogger:
    global _logger
    if _logger is None:
        _logger = AuditLogger()
    return _logger
