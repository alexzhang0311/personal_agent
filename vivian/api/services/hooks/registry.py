"""Built-in hook registry — @vivian_hook decorator and lookup functions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass
class BuiltInHookMeta:
    """Metadata for a built-in hook, populated by @vivian_hook decorator."""

    id: str
    name: str
    description: str  # from docstring
    events: list[str]  # e.g. ["PreToolUse"]
    callback: Callable[..., Awaitable[dict[str, Any]]] = field(repr=False)
    matcher: str | None = None  # regex for tool name
    can_block: bool = False  # can this hook deny/block?
    enabled_by_default: bool = False  # active without user action?


_REGISTRY: list[BuiltInHookMeta] = []


def vivian_hook(
    *,
    id: str,
    name: str,
    events: list[str],
    matcher: str | None = None,
    can_block: bool = False,
    enabled_by_default: bool = False,
):
    """Decorator that registers an async function as a built-in Vivian hook."""

    def decorator(fn):
        meta = BuiltInHookMeta(
            id=id,
            name=name,
            description=(fn.__doc__ or "").strip(),
            events=events,
            matcher=matcher,
            can_block=can_block,
            enabled_by_default=enabled_by_default,
            callback=fn,
        )
        _REGISTRY.append(meta)
        return fn

    return decorator


def get_all_hooks() -> list[BuiltInHookMeta]:
    """Return all registered built-in hooks."""
    return list(_REGISTRY)


def get_hook_by_id(hook_id: str) -> BuiltInHookMeta | None:
    """Look up a built-in hook by ID."""
    for meta in _REGISTRY:
        if meta.id == hook_id:
            return meta
    return None
