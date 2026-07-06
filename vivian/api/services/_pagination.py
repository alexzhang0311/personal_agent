"""Shared utilities for cursor-paginated, daily-partitioned JSONL stores.

Three append-only stores share this implementation:
- scheduler/run_history.py
- audit_log.py
- hooks/log_store.py

All three:
- Partition records into per-day JSONL files.
- Encode pagination cursors as base64("<ts_iso>|<record_id>").
- Stream files newest-first with substring prefilter + dict-level filters
  so the request path stays O(limit) regardless of total record count.
- Maintain a sidecar JSON file tracking the unfiltered total; updated
  inside append() under the same exclusive lock.
"""

from __future__ import annotations

import base64
import fcntl
import json
import os
import re
from pathlib import Path
from typing import Callable

from ..middleware.logging import get_app_logger

logger = get_app_logger(__name__)


# ---------------------------------------------------------------------------
# Cursor encode / decode
# ---------------------------------------------------------------------------

def encode_cursor(ts_iso: str, rid: str) -> str:
    """Encode (timestamp ISO string, record id) as an opaque cursor."""
    raw = f"{ts_iso}|{rid}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(s: str) -> tuple[str, str]:
    """Decode cursor into (timestamp ISO string, record id).

    ISO 8601 strings sort lexicographically, so comparing the (ts, id)
    tuple matches chronological order.
    """
    s += "=" * (-len(s) % 4)
    try:
        decoded = base64.urlsafe_b64decode(s).decode()
    except Exception as e:
        raise ValueError(f"Invalid cursor: {s!r}") from e
    ts_str, _, rid = decoded.partition("|")
    if not rid:
        raise ValueError(f"Malformed cursor: {decoded!r}")
    return ts_str, rid


# ---------------------------------------------------------------------------
# Daily-partition file listing
# ---------------------------------------------------------------------------

def list_daily_files(dir_path: Path, pattern: re.Pattern) -> list[tuple[str, Path]]:
    """Return (date_str, path) pairs sorted newest-first.

    `pattern` must have a single group capturing the YYYY-MM-DD date string.
    """
    if not dir_path.exists():
        return []
    results: list[tuple[str, Path]] = []
    for p in dir_path.iterdir():
        m = pattern.search(p.name)
        if m:
            results.append((m.group(1), p))
    results.sort(key=lambda x: x[0], reverse=True)
    return results


# ---------------------------------------------------------------------------
# Counts sidecar
# ---------------------------------------------------------------------------

def read_counts_sidecar(counts_path: Path) -> dict | None:
    """Read the counts sidecar. Returns None if missing or unreadable."""
    if not counts_path.exists():
        return None
    try:
        with open(counts_path, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                return json.load(f)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
    except Exception:
        return None


def write_counts_sidecar(counts_path: Path, counts: dict) -> None:
    """Atomic write of the counts sidecar via tmp+replace."""
    counts_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = counts_path.with_suffix(counts_path.suffix + ".tmp")
    with open(tmp_path, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            json.dump(counts, f)
            f.flush()
            os.fsync(f.fileno())
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
    os.replace(tmp_path, counts_path)


def increment_counts_sidecar(counts_path: Path, last_file: str, last_line_id: str) -> None:
    """Increment the total in counts sidecar by 1.

    Caller must hold the data file's exclusive lock. If the sidecar is missing
    or corrupt, this no-ops — a later read will trigger a lazy full rebuild.
    """
    current = read_counts_sidecar(counts_path)
    if current is None or not isinstance(current.get("total"), int):
        # Sidecar missing/corrupt — leave it; lazy rebuild will fix.
        return
    write_counts_sidecar(counts_path, {
        "total": current["total"] + 1,
        "last_file": last_file,
        "last_line_id": last_line_id,
    })


# ---------------------------------------------------------------------------
# Streamed read with cursor
# ---------------------------------------------------------------------------

def _date_prefix(ts_iso: str) -> str:
    """Extract YYYY-MM-DD from an ISO timestamp string."""
    return ts_iso[:10] if len(ts_iso) >= 10 else ts_iso


def read_records_page(
    daily_files: list[tuple[str, Path]],
    limit: int,
    extract_ts_id: Callable[[dict], tuple[str, str]],
    matches_filters: Callable[[dict], bool],
    prefilter_substr: str | None,
    before_cursor: tuple[str, str] | None,
    after_cursor: tuple[str, str] | None,
) -> tuple[list[dict], bool]:
    """Stream daily files newest-first, returning a page of raw dicts.

    Returns (records, has_more):
      - records: newest-first, up to `limit` matching the filters & cursor.
      - has_more: True iff there exists at least one additional matching
        record on the older side (for `before`/no-cursor) or newer side
        (for `after`).

    Cursor semantics:
      - before (default for "next" / older page): records with key strictly
        less than cursor.
      - after (for "prev" / newer page): records with key strictly greater
        than cursor.

    `prefilter_substr` is a cheap line-level substring check applied before
    json.loads(). Use None if no equality filter is active.
    """
    if before_cursor and after_cursor:
        raise ValueError("Cannot pass both before_cursor and after_cursor")

    if after_cursor is not None:
        return _read_records_after(
            daily_files, limit, extract_ts_id, matches_filters,
            prefilter_substr, after_cursor,
        )

    # before_cursor or no cursor — iterate newest-first, early-exit.
    return _read_records_before(
        daily_files, limit, extract_ts_id, matches_filters,
        prefilter_substr, before_cursor,
    )


def _read_records_before(
    daily_files: list[tuple[str, Path]],
    limit: int,
    extract_ts_id: Callable[[dict], tuple[str, str]],
    matches_filters: Callable[[dict], bool],
    prefilter_substr: str | None,
    before_cursor: tuple[str, str] | None,
) -> tuple[list[dict], bool]:
    cursor_date = _date_prefix(before_cursor[0]) if before_cursor else None

    seen: dict[str, dict] = {}
    has_more = False

    for date_str, path in daily_files:
        # Skip files strictly newer than cursor's date — no records there
        # can be older-than-cursor (cursor is within or before that date).
        if cursor_date is not None and date_str > cursor_date:
            continue

        try:
            with open(path, "r") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    lines = f.read().splitlines()
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            logger.warning("Failed to read daily file {}", path)
            continue

        # Newest-first within file
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            if prefilter_substr and prefilter_substr not in line:
                continue
            try:
                raw = json.loads(line)
            except Exception:
                continue
            if not matches_filters(raw):
                continue
            ts, rid = extract_ts_id(raw)
            key = (ts, rid)
            if before_cursor is not None and key >= before_cursor:
                continue
            # Dedup: last write wins (we go newest-first, so first occurrence wins;
            # but on disk older records may have the same id — we want the latest
            # write, which is the last occurrence on disk. Within reversed(lines),
            # that's the FIRST one we encounter.)
            if rid in seen:
                continue
            seen[rid] = raw
            if len(seen) > limit:
                has_more = True
                break

        if len(seen) > limit:
            break

    # Sort newest-first and cap to limit
    items = sorted(seen.values(), key=extract_ts_id, reverse=True)
    if len(items) > limit:
        has_more = True
        items = items[:limit]
    return items, has_more


def _read_records_after(
    daily_files: list[tuple[str, Path]],
    limit: int,
    extract_ts_id: Callable[[dict], tuple[str, str]],
    matches_filters: Callable[[dict], bool],
    prefilter_substr: str | None,
    after_cursor: tuple[str, str],
) -> tuple[list[dict], bool]:
    """Page newer than cursor. Returns the `limit` records immediately newer
    than the cursor (i.e. closest to cursor on the newer side), newest-first.
    """
    cursor_date = _date_prefix(after_cursor[0])

    seen: dict[str, dict] = {}

    for date_str, path in daily_files:
        # Files strictly older than cursor's date can't have newer records.
        if date_str < cursor_date:
            break  # daily_files is newest-first, so all remaining are older

        try:
            with open(path, "r") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    lines = f.read().splitlines()
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            logger.warning("Failed to read daily file {}", path)
            continue

        for line in lines:
            line = line.strip()
            if not line:
                continue
            if prefilter_substr and prefilter_substr not in line:
                continue
            try:
                raw = json.loads(line)
            except Exception:
                continue
            if not matches_filters(raw):
                continue
            ts, rid = extract_ts_id(raw)
            key = (ts, rid)
            if key <= after_cursor:
                continue
            seen[rid] = raw  # last write wins

    # Sort ascending, take `limit` records nearest to cursor (smallest keys
    # among those > cursor), then reverse for newest-first display.
    items_asc = sorted(seen.values(), key=extract_ts_id)
    has_more = len(items_asc) > limit
    page_asc = items_asc[:limit]
    page = list(reversed(page_asc))
    return page, has_more


# ---------------------------------------------------------------------------
# Counts rebuild
# ---------------------------------------------------------------------------

def compute_cursors(
    records: list,
    before_cursor: tuple[str, str] | None,
    after_cursor: tuple[str, str] | None,
    has_more: bool,
    iso: Callable[[object], str],
    rid: Callable[[object], str],
) -> tuple[str | None, str | None]:
    """Compute next_cursor (older page) and prev_cursor (newer page).

    Semantics:
      - Initial page (no cursor):
          next = key(oldest) if has_more else None
          prev = None
      - `before` page (paged older):
          next = key(oldest) if has_more else None
          prev = key(newest) — the user can return to the page they came from
      - `after` page (paged newer):
          next = key(oldest) — older records always exist (at least the prior page)
          prev = key(newest) if has_more else None
    """
    if not records:
        return None, None

    first = records[0]
    last = records[-1]
    last_key = encode_cursor(iso(last), rid(last))
    first_key = encode_cursor(iso(first), rid(first))

    if after_cursor is not None:
        next_cursor = last_key
        prev_cursor = first_key if has_more else None
    elif before_cursor is not None:
        next_cursor = last_key if has_more else None
        prev_cursor = first_key
    else:
        next_cursor = last_key if has_more else None
        prev_cursor = None

    return next_cursor, prev_cursor


def rebuild_counts(
    daily_files: list[tuple[str, Path]],
    extract_id: Callable[[dict], str],
) -> dict:
    """One-shot full scan to rebuild the counts sidecar.

    Deduplicates by id across all files (last write wins).
    Returns the counts dict ready for write_counts_sidecar.
    """
    seen: set[str] = set()
    last_file: str = ""
    last_line_id: str = ""

    # Read oldest-first so dedup keeps the latest id in `seen`
    for date_str, path in reversed(daily_files):
        try:
            with open(path, "r") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            raw = json.loads(line)
                        except Exception:
                            continue
                        try:
                            rid = extract_id(raw)
                        except Exception:
                            continue
                        seen.add(rid)
                        last_file = date_str
                        last_line_id = rid
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            logger.warning("Failed to scan {} during counts rebuild", path)
            continue

    return {
        "total": len(seen),
        "last_file": last_file,
        "last_line_id": last_line_id,
    }
