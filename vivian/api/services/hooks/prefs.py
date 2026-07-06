"""Shared helpers for resolving which built-in hooks are enabled for a user.

These live outside the routers so both the user-facing hooks router and the
admin router can share the same enable-resolution logic without drifting.
"""

from __future__ import annotations

from typing import Any

from ..user_store import get_user_store


def get_enabled_hook_ids(username: str) -> set[str]:
    """Return the set of built-in hook IDs currently enabled for ``username``."""
    from . import built_in_hooks as _  # noqa: F401 — trigger registration
    from .registry import get_all_hooks

    runtime = get_user_store().get_runtime_config()
    admin_enforced = set(runtime.get("enforced_hook_ids", []))
    user_prefs = runtime.get("user_hook_prefs", {}).get(username, {})

    enabled: set[str] = set()
    for meta in get_all_hooks():
        if meta.id in admin_enforced:
            enabled.add(meta.id)
        elif meta.id in user_prefs:
            if user_prefs[meta.id]:
                enabled.add(meta.id)
        elif meta.enabled_by_default:
            enabled.add(meta.id)
    return enabled


def get_enabled_builtin_hooks(username: str) -> list[dict[str, Any]]:
    """Return built-in hooks currently enabled for ``username`` as dict rows.

    Each entry contains ``id``, ``name``, ``events`` (list[str]) and
    ``enforced`` (bool).
    """
    from . import built_in_hooks as _  # noqa: F401 — trigger registration
    from .registry import get_all_hooks

    runtime = get_user_store().get_runtime_config()
    admin_enforced = set(runtime.get("enforced_hook_ids", []))
    enabled_ids = get_enabled_hook_ids(username)

    rows: list[dict[str, Any]] = []
    for meta in get_all_hooks():
        if meta.id not in enabled_ids:
            continue
        rows.append({
            "kind": "builtin",
            "id": meta.id,
            "name": meta.name,
            "events": list(meta.events or []),
            "enforced": meta.id in admin_enforced,
        })
    return rows
