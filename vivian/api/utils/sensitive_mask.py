"""Pure utility for masking sensitive data in arbitrary JSON-serializable values.

Zero service-layer imports — caller supplies compiled patterns.
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Any


@lru_cache(maxsize=128)
def _compile(pattern: str) -> re.Pattern:
    return re.compile(pattern)


def mask_sensitive(
    patterns: list[dict],
    value: Any,
) -> tuple[Any, int]:
    """Apply regex patterns to recursively mask strings in *value*.

    Args:
        patterns: list of ``{"name": str, "pattern": str, "mask": str}``
        value: any JSON-serializable value (str, dict, list, scalar)

    Returns:
        ``(masked_value, hit_count)`` — caller can skip replacement when
        *hit_count* is 0.
    """
    if not patterns:
        return value, 0

    compiled = []
    for entry in patterns:
        try:
            compiled.append((_compile(entry["pattern"]), entry["mask"]))
        except (re.error, KeyError):
            continue

    if not compiled:
        return value, 0

    hits = 0

    def _walk(v: Any) -> Any:
        nonlocal hits
        if isinstance(v, str):
            result = v
            for regex, mask in compiled:
                new, n = regex.subn(mask, result)
                hits += n
                result = new
            return result
        if isinstance(v, dict):
            return {k: _walk(val) for k, val in v.items()}
        if isinstance(v, list):
            return [_walk(item) for item in v]
        if isinstance(v, tuple):
            return tuple(_walk(item) for item in v)
        return v

    masked = _walk(value)
    return masked, hits


def parse_pattern_strict(entry: dict) -> None:
    """Validate a single pattern entry.  Raises ``ValueError`` on bad input."""
    if not isinstance(entry, dict):
        raise ValueError("Pattern entry must be a dict")
    for key in ("name", "pattern", "mask"):
        if key not in entry or not isinstance(entry[key], str):
            raise ValueError(f"Missing or invalid field: '{key}'")
        if not entry[key].strip():
            raise ValueError(f"Field '{key}' must not be empty")
    try:
        re.compile(entry["pattern"])
    except re.error as exc:
        raise ValueError(f"Invalid regex in pattern '{entry['name']}': {exc}") from exc
