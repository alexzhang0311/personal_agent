from __future__ import annotations

import asyncio
import json
from pathlib import Path

from claude_agent_sdk import AssistantMessage
from claude_agent_sdk._internal.sessions import _canonicalize_path, _get_project_dir

from ...middleware.logging import get_app_logger

logger = get_app_logger(__name__)

MAX_ATTEMPTS = 10
BACKOFF_SCHEDULE = [0, 2, 4, 8, 16, 30, 30, 30, 30, 30]
RETRYABLE_ERRORS = frozenset({"server_error", "unknown"})
SYNTHETIC_MODEL = "<synthetic>"


def should_retry(message: AssistantMessage) -> bool:
    """True if an AssistantMessage represents a synthetic CLI error worth retrying."""
    return getattr(message, "model", None) == SYNTHETIC_MODEL and (
        getattr(message, "error", None) in RETRYABLE_ERRORS
    )


def should_retry_exception(exc: BaseException) -> bool:
    """True for SDK process / transport errors. Cancellation is never retried."""
    return not isinstance(exc, (asyncio.CancelledError, KeyboardInterrupt))


def backoff(attempt: int) -> float:
    """Backoff seconds for the given 1-indexed attempt number."""
    if attempt <= 0:
        return 0.0
    return float(BACKOFF_SCHEDULE[min(attempt - 1, len(BACKOFF_SCHEDULE) - 1)])


def _resolve_session_path(session_id: str, cwd: str | None) -> Path | None:
    if not session_id or not cwd:
        return None
    try:
        project_dir = _get_project_dir(_canonicalize_path(cwd))
    except Exception:
        return None
    return project_dir / f"{session_id}.jsonl"


def _is_synthetic_record(rec: dict) -> bool:
    if not isinstance(rec, dict):
        return False
    msg = rec.get("message")
    if not isinstance(msg, dict):
        return False
    return msg.get("model") == SYNTHETIC_MODEL


def strip_synthetic_records(session_id: str | None, cwd: str | None) -> int:
    """Rewrite the session JSONL with all synthetic-error records filtered out.

    Returns the number of records removed (0 if the file is missing or has no
    synthetic rows). Run this before each retry attempt so the model never
    sees its own error message in context.
    """
    path = _resolve_session_path(session_id or "", cwd)
    if path is None or not path.exists():
        return 0

    kept: list[str] = []
    removed = 0
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                raw = line.rstrip("\n")
                if not raw.strip():
                    continue
                try:
                    rec = json.loads(raw)
                except Exception:
                    kept.append(raw)
                    continue
                if _is_synthetic_record(rec):
                    removed += 1
                    continue
                kept.append(raw)
    except Exception:
        logger.exception("[RETRY] failed to read %s", path)
        return 0

    if removed == 0:
        return 0

    try:
        with path.open("w", encoding="utf-8") as handle:
            for raw in kept:
                handle.write(raw + "\n")
    except Exception:
        logger.exception("[RETRY] failed to rewrite %s", path)
        return 0

    return removed


class RetryableSyntheticError(Exception):
    """Raised internally to break out of an attempt when a synthetic error arrives."""

    def __init__(self, payload: dict):
        super().__init__(payload.get("message") or "synthetic error")
        self.payload = payload
