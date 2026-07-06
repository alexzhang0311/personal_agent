"""Compute per-user usage overview for the /api/auth/me endpoint."""

from __future__ import annotations

import os
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from claude_agent_sdk import list_sessions
from claude_agent_sdk._internal.sessions import _canonicalize_path, _get_project_dir

from ..models.auth import (
    DailyModelTokens,
    HeatmapBucket,
    ModelUsage,
    UsageCounts,
    UsageStats,
)
from .audit_log import get_audit_logger
from .config import get_settings


HEATMAP_DAYS = 183

# Approximate reference scales for the playful tagline comparison.
# Tokens are order-of-magnitude estimates; good-enough for flavor text.
_TAGLINE_SCALES: list[tuple[int, str]] = [
    (1_200_000_000, "the collected works of Shakespeare"),
    (3_000_000_000, "the entire Harry Potter series"),
    (100_000, "Harry Potter and the Philosopher's Stone"),
    (45_000, "The Great Gatsby"),
    (30_000, "Animal Farm"),
    (5_000, "a short story"),
]


@dataclass
class UserStatsBlock:
    stats: UsageStats
    heatmap: list[HeatmapBucket]
    model_usage: list[ModelUsage]
    daily_model_tokens: list[DailyModelTokens]
    favorite_model: str | None
    current_streak: int
    longest_streak: int
    peak_hour: int | None
    tagline: str | None


def _read_all_audit_entries(username: str) -> list[dict]:
    """Return all audit entries for the user. Reads the daily JSONL partitions directly."""
    import json

    audit = get_audit_logger()
    # Trigger one-shot migration of any pre-cursor-patch legacy file
    audit._ensure_migrated()  # type: ignore[attr-defined]

    daily_files = audit._list_daily()  # type: ignore[attr-defined]
    user_prefilter = f'"actor":"{username}"'

    out: list[dict] = []
    for _date_str, path in daily_files:
        try:
            with open(path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    # Cheap substring prefilter on the actor field
                    if user_prefilter not in line:
                        continue
                    try:
                        entry = json.loads(line)
                    except Exception:
                        continue
                    if entry.get("actor") != username:
                        continue
                    out.append(entry)
        except Exception:
            continue
    return out


def _parse_ts(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _session_count_messages(session_file: Path) -> int:
    """Cheap message count — line count of JSONL minus non-message entries."""
    try:
        count = 0
        with open(session_file, "rb") as f:
            for line in f:
                if not line.strip():
                    continue
                # Coarse filter: only lines that look like user/assistant messages
                if b'"type":"user"' in line or b'"type":"assistant"' in line:
                    count += 1
        return count
    except Exception:
        return 0


def _user_sessions(user_workspace: Path) -> list:
    if not user_workspace.exists():
        return []
    try:
        return list_sessions(directory=str(user_workspace))
    except Exception:
        return []


def _session_file_path(session_id: str, user_workspace: Path) -> Path | None:
    try:
        canonical = _canonicalize_path(str(user_workspace))
        project_dir = _get_project_dir(canonical)
        path = project_dir / f"{session_id}.jsonl"
        return path if path.exists() else None
    except Exception:
        return None


def _empty_counts() -> UsageCounts:
    return UsageCounts()


def _compute_counts(
    sessions: list,
    session_msg_counts: dict[str, int],
    token_buckets: dict[date, tuple[int, int]],
    start: datetime | None,
) -> UsageCounts:
    """Aggregate counts, optionally restricted to dates >= start."""
    start_date = start.date() if start else None

    session_count = 0
    message_count = 0
    for s in sessions:
        ts_ms = getattr(s, "last_modified", None)
        if ts_ms is None:
            continue
        session_dt = datetime.fromtimestamp(ts_ms / 1000.0)
        if start_date and session_dt.date() < start_date:
            continue
        session_count += 1
        message_count += session_msg_counts.get(s.session_id, 0)

    input_tokens = 0
    output_tokens = 0
    active_days: set[date] = set()
    for day, (ins, outs) in token_buckets.items():
        if start_date and day < start_date:
            continue
        input_tokens += ins
        output_tokens += outs
        if ins + outs > 0:
            active_days.add(day)

    return UsageCounts(
        sessions=session_count,
        messages=message_count,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        active_days=len(active_days),
    )


def _compute_streaks(active_dates: set[date]) -> tuple[int, int]:
    """Return (current_streak, longest_streak)."""
    if not active_dates:
        return 0, 0
    sorted_dates = sorted(active_dates)

    longest = 1
    run = 1
    for i in range(1, len(sorted_dates)):
        if (sorted_dates[i] - sorted_dates[i - 1]).days == 1:
            run += 1
            longest = max(longest, run)
        else:
            run = 1

    # Current streak: walk back from today/yesterday
    today = date.today()
    yesterday = today - timedelta(days=1)
    if today not in active_dates and yesterday not in active_dates:
        return 0, longest

    anchor = today if today in active_dates else yesterday
    current = 0
    cursor = anchor
    while cursor in active_dates:
        current += 1
        cursor = cursor - timedelta(days=1)
    return current, longest


def _compute_heatmap(active_counts: dict[date, int]) -> list[HeatmapBucket]:
    today = date.today()
    start = today - timedelta(days=HEATMAP_DAYS - 1)
    buckets: list[HeatmapBucket] = []
    cursor = start
    while cursor <= today:
        buckets.append(
            HeatmapBucket(date=cursor.isoformat(), count=active_counts.get(cursor, 0))
        )
        cursor = cursor + timedelta(days=1)
    return buckets


def _compute_tagline(total_tokens: int) -> str | None:
    if total_tokens <= 0:
        return None
    for scale, label in _TAGLINE_SCALES:
        if total_tokens < scale:
            continue
        ratio = total_tokens / scale
        if ratio >= 1.0:
            pretty = f"{ratio:.1f}".rstrip("0").rstrip(".")
            if pretty == "" or pretty == "1":
                return f"You've written about as many tokens as {label}."
            return f"You've used ~{pretty}× more tokens than {label}."
    return None


def compute_user_stats(username: str) -> UserStatsBlock:
    settings = get_settings()
    work_dir = Path(os.path.expanduser(settings.server.work_dir))
    user_workspace = work_dir / username

    # --- Load sessions for this user ---
    sessions = _user_sessions(user_workspace)
    session_msg_counts: dict[str, int] = {}
    for s in sessions:
        path = _session_file_path(s.session_id, user_workspace)
        if path is not None:
            session_msg_counts[s.session_id] = _session_count_messages(path)

    # --- Aggregate audit entries ---
    entries = _read_all_audit_entries(username)

    # Per-day token buckets
    token_buckets: dict[date, tuple[int, int]] = {}
    # Per-day, per-model token buckets
    daily_model: dict[date, dict[str, int]] = {}
    # Per-model aggregate
    model_runs: Counter[str] = Counter()
    model_input: Counter[str] = Counter()
    model_output: Counter[str] = Counter()
    # Day -> total event count (for streaks / heatmap)
    day_events: Counter[date] = Counter()
    # Hour of day distribution
    hour_counts: Counter[int] = Counter()

    for entry in entries:
        ts = _parse_ts(entry.get("timestamp"))
        if ts is None:
            continue
        day = ts.date()
        day_events[day] += 1
        hour_counts[ts.hour] += 1

        action = entry.get("action") or ""
        details = entry.get("details") or {}
        if action == "agent.run_completed":
            ins = int(details.get("input_tokens") or 0)
            outs = int(details.get("output_tokens") or 0)
            model = (details.get("model") or "").strip() or "unknown"

            cur = token_buckets.get(day, (0, 0))
            token_buckets[day] = (cur[0] + ins, cur[1] + outs)

            # Skip <synthetic> — Claude Code stamps this on locally-generated
            # assistant messages (API errors, interrupts) that aren't real model calls.
            if model == "<synthetic>":
                continue

            dm = daily_model.setdefault(day, {})
            dm[model] = dm.get(model, 0) + ins + outs

            model_runs[model] += 1
            model_input[model] += ins
            model_output[model] += outs

    # Also count session creation days as active (even if no tokens logged)
    for s in sessions:
        ts_ms = getattr(s, "last_modified", None)
        if ts_ms is None:
            continue
        day = datetime.fromtimestamp(ts_ms / 1000.0).date()
        if day not in day_events:
            day_events[day] = 0  # ensure day is tracked in heatmap / streak
        day_events[day] += 1

    # --- Ranges ---
    now = datetime.now()
    stats = UsageStats(
        all=_compute_counts(sessions, session_msg_counts, token_buckets, None),
        last_30d=_compute_counts(sessions, session_msg_counts, token_buckets, now - timedelta(days=30)),
        last_7d=_compute_counts(sessions, session_msg_counts, token_buckets, now - timedelta(days=7)),
    )

    # --- Heatmap (rolling half-year, by event count) ---
    heatmap_counts: dict[date, int] = {d: c for d, c in day_events.items()}
    heatmap = _compute_heatmap(heatmap_counts)

    # --- Streaks (based on days with any activity) ---
    active_dates: set[date] = {d for d, c in day_events.items() if c > 0}
    current_streak, longest_streak = _compute_streaks(active_dates)

    # --- Model usage ---
    total_tokens = sum(model_input.values()) + sum(model_output.values())
    model_usage: list[ModelUsage] = []
    if total_tokens > 0:
        for model, runs in model_runs.most_common():
            ins = model_input.get(model, 0)
            outs = model_output.get(model, 0)
            pct = ((ins + outs) / total_tokens) * 100.0
            model_usage.append(
                ModelUsage(
                    model=model,
                    runs=runs,
                    input_tokens=ins,
                    output_tokens=outs,
                    percentage=round(pct, 2),
                )
            )
    # Sort by percentage desc so legend order matches chart share
    model_usage.sort(key=lambda m: m.percentage, reverse=True)
    favorite_model = model_usage[0].model if model_usage else None

    # --- Daily model tokens for stacked chart ---
    daily_model_tokens: list[DailyModelTokens] = [
        DailyModelTokens(date=d.isoformat(), by_model=dict(sorted(by_model.items())))
        for d, by_model in sorted(daily_model.items())
    ]

    # --- Peak hour (mode of audit entry hours) ---
    peak_hour = hour_counts.most_common(1)[0][0] if hour_counts else None

    # --- Tagline ---
    tagline = _compute_tagline(stats.all.total_tokens)

    return UserStatsBlock(
        stats=stats,
        heatmap=heatmap,
        model_usage=model_usage,
        daily_model_tokens=daily_model_tokens,
        favorite_model=favorite_model,
        current_streak=current_streak,
        longest_streak=longest_streak,
        peak_hour=peak_hour,
        tagline=tagline,
    )
