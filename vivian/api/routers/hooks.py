"""Hooks API — catalog, config, testing, logs, and admin enforcement."""

from __future__ import annotations

import asyncio
import inspect
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models.hooks import (
    BuiltInHookInfo,
    BuiltInHookTestResponse,
    HookConfig,
    HookLogEntry,
    HookLogsResponse,
    HookTestByIdRequest,
    HookTestRequest,
    HookTestResponse,
)
from ..services.auth import get_user_workspace, require_admin, require_user
from ..services.hooks.config_manager import HookConfigManager
from ..services.hooks.executor import test_builtin_hook, test_hook
from ..services.hooks.log_store import get_hook_log_store
from ..services.hooks.prefs import get_enabled_hook_ids as _shared_get_enabled_hook_ids
from ..services.audit_log import AuditEntry, get_audit_logger
from ..services.user_store import UserRecord, get_user_store

router = APIRouter(prefix="/api/hooks", tags=["hooks"])


# -- Helpers ----------------------------------------------------------------


def _get_config_manager(user: UserRecord) -> HookConfigManager:
    cwd = get_user_workspace(user)
    return HookConfigManager(cwd)


def _get_enforced_hook_ids() -> set[str]:
    """Return the set of admin-enforced built-in hook IDs."""
    runtime = get_user_store().get_runtime_config()
    return set(runtime.get("enforced_hook_ids", []))


def _get_enabled_hook_ids(username: str) -> set[str]:
    """Determine which built-in hooks are enabled for a user."""
    return _shared_get_enabled_hook_ids(username)


# -- Built-in hook catalog --------------------------------------------------


@router.get("/catalog", response_model=list[BuiltInHookInfo])
async def list_catalog(user: UserRecord = Depends(require_user)):
    """List all built-in hooks with metadata, enable status, enforcement."""
    from ..services.hooks import built_in_hooks as _  # noqa: F401 — trigger registration
    from ..services.hooks.registry import get_all_hooks

    all_hooks = get_all_hooks()
    enabled_ids = _get_enabled_hook_ids(user.username)
    enforced_ids = _get_enforced_hook_ids()

    result = []
    for meta in all_hooks:
        try:
            raw = inspect.getsource(meta.callback)
            # Strip the @vivian_hook(...) decorator block, keep only the function
            lines = raw.split("\n")
            func_start = 0
            for i, line in enumerate(lines):
                if line.lstrip().startswith("async def ") or line.lstrip().startswith("def "):
                    func_start = i
                    break
            source = "\n".join(lines[func_start:])
        except (OSError, TypeError):
            source = None
        result.append(BuiltInHookInfo(
            id=meta.id,
            name=meta.name,
            description=meta.description,
            supported_events=meta.events,
            default_matcher=meta.matcher,
            can_block=meta.can_block,
            enabled_by_default=meta.enabled_by_default,
            enforced=meta.id in enforced_ids,
            enabled=meta.id in enabled_ids,
            source_code=source,
        ))
    return result


# -- Enable / disable built-in hooks ----------------------------------------


@router.post("/catalog/{hook_id}/enable")
async def enable_hook(hook_id: str, user: UserRecord = Depends(require_user)):
    """Enable a built-in hook for this user."""
    from ..services.hooks import built_in_hooks as _  # noqa: F401
    from ..services.hooks.registry import get_hook_by_id

    meta = get_hook_by_id(hook_id)
    if meta is None:
        raise HTTPException(404, f"Built-in hook '{hook_id}' not found")

    store = get_user_store()
    runtime = store.get_runtime_config()
    user_prefs = runtime.get("user_hook_prefs", {})
    user_prefs.setdefault(user.username, {})[hook_id] = True
    store.update_runtime_config("user_hook_prefs", user_prefs)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=user.username,
        action="hooks.builtin_enabled",
        target=hook_id,
    ))

    return {"status": "ok", "hook_id": hook_id, "enabled": True}


@router.post("/catalog/{hook_id}/disable")
async def disable_hook(hook_id: str, user: UserRecord = Depends(require_user)):
    """Disable a built-in hook for this user (unless admin-enforced)."""
    from ..services.hooks import built_in_hooks as _  # noqa: F401
    from ..services.hooks.registry import get_hook_by_id

    meta = get_hook_by_id(hook_id)
    if meta is None:
        raise HTTPException(404, f"Built-in hook '{hook_id}' not found")

    # Check if admin-enforced
    enforced_ids = _get_enforced_hook_ids()
    if hook_id in enforced_ids:
        raise HTTPException(403, f"Hook '{hook_id}' is admin-enforced and cannot be disabled")

    store = get_user_store()
    runtime = store.get_runtime_config()
    user_prefs = runtime.get("user_hook_prefs", {})
    user_prefs.setdefault(user.username, {})[hook_id] = False
    store.update_runtime_config("user_hook_prefs", user_prefs)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=user.username,
        action="hooks.builtin_disabled",
        target=hook_id,
    ))

    return {"status": "ok", "hook_id": hook_id, "enabled": False}


# -- User hook config -------------------------------------------------------


@router.get("/config")
async def get_config(user: UserRecord = Depends(require_user)):
    """Merged view: admin-enforced + project + local hooks."""
    mgr = _get_config_manager(user)
    merged = mgr.read_merged()
    return {"hooks": merged}


@router.put("/config")
async def update_config(
    config: HookConfig,
    user: UserRecord = Depends(require_user),
):
    """Update user's hook bindings.  Writes to .claude/settings.local.json."""
    mgr = _get_config_manager(user)
    mgr.write_local_hooks(config.hooks)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=user.username,
        action="hooks.config_updated",
        details={"events": list(config.hooks.keys())},
    ))

    return {"status": "ok", "hooks": config.hooks}


# -- Testing ----------------------------------------------------------------


@router.post("/test", response_model=HookTestResponse)
async def test_hook_endpoint(
    request: HookTestRequest,
    user: UserRecord = Depends(require_user),
):
    """Dry-run a user custom command hook with sample JSON input."""
    cwd = get_user_workspace(user)
    result = await test_hook(
        event_type=request.event_type,
        handler=request.handler,
        input_json=request.input_json,
        cwd=cwd,
    )
    return result


@router.post("/test/builtin", response_model=BuiltInHookTestResponse)
async def test_builtin_hook_endpoint(
    request: HookTestByIdRequest,
    user: UserRecord = Depends(require_user),
):
    """Test a built-in hook by calling its Python callback directly."""
    from ..services.hooks import built_in_hooks as _  # noqa: F401
    result = await test_builtin_hook(
        hook_id=request.hook_id,
        event_type=request.event_type,
        input_json=request.input_json,
    )
    return result


# -- Script content ---------------------------------------------------------


@router.get("/script/content")
async def get_script_content(
    path: str = Query(..., description="Script path relative to user work dir"),
    user: UserRecord = Depends(require_user),
):
    """Read the content of a hook script file within the user's work directory.

    The path must resolve to a file inside the user's workspace. Path traversal
    (e.g. ``../``) is rejected for safety.
    """
    cwd = get_user_workspace(user)
    cwd_resolved = Path(cwd).resolve()

    # Resolve the requested path relative to the user's work dir
    target = (cwd_resolved / path).resolve()

    # Safety: ensure the resolved path is within the user's work dir
    if not str(target).startswith(str(cwd_resolved) + os.sep) and target != cwd_resolved:
        raise HTTPException(403, "Access denied: path is outside the work directory")

    if not target.is_file():
        raise HTTPException(404, f"File not found: {path}")

    # Limit file size to prevent reading huge files
    file_size = target.stat().st_size
    if file_size > 512 * 1024:  # 512 KB
        raise HTTPException(413, "File too large to read (max 512 KB)")

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(500, f"Failed to read file: {exc}")

    # Detect language from extension
    suffix = target.suffix.lower()
    lang_map = {
        ".py": "python", ".sh": "bash", ".bash": "bash",
        ".js": "javascript", ".ts": "typescript",
        ".rb": "ruby", ".go": "go", ".rs": "rust",
    }
    language = lang_map.get(suffix, "text")

    return {
        "path": str(target.relative_to(cwd_resolved)),
        "content": content,
        "language": language,
        "size": file_size,
    }


# -- Execution logs ---------------------------------------------------------


@router.get("/logs", response_model=HookLogsResponse)
async def get_logs(
    event_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    before: str | None = Query(default=None),
    after: str | None = Query(default=None),
    user: UserRecord = Depends(require_user),
):
    """Hook execution history for this user."""
    store = get_hook_log_store()
    entries, next_cursor, prev_cursor, total = await asyncio.to_thread(
        store.query_cursor,
        username=user.username,
        event_type=event_type,
        limit=limit,
        before=before,
        after=after,
    )
    return HookLogsResponse(
        entries=entries,
        next_cursor=next_cursor,
        prev_cursor=prev_cursor,
        total=total,
        limit=limit,
    )


# -- Admin hook endpoints ---------------------------------------------------


@router.get("/admin", dependencies=[Depends(require_admin)])
async def list_admin_hooks():
    """List admin-enforced hooks from runtime.hooks."""
    runtime = get_user_store().get_runtime_config()
    return {"hooks": runtime.get("hooks", {})}


@router.post("/admin")
async def add_admin_hook(
    event_type: str,
    entry: dict,
    admin: UserRecord = Depends(require_admin),
):
    """Add an enforced hook to runtime.hooks in .vivian.settings.yml.

    This also mirrors to each user's {cwd}/.claude/settings.json on the
    next agent run via ``build_hooks()``.
    """
    store = get_user_store()
    runtime = store.get_runtime_config()
    hooks = runtime.get("hooks", {})
    hooks.setdefault(event_type, []).append(entry)
    store.update_runtime_config("hooks", hooks)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=admin.username,
        action="hooks.admin_added",
        details={"event_type": event_type},
    ))

    return {"status": "ok", "hooks": hooks}


@router.delete("/admin/{event_type}/{index}")
async def remove_admin_hook(
    event_type: str,
    index: int,
    admin: UserRecord = Depends(require_admin),
):
    """Remove an enforced hook by event type and index."""
    store = get_user_store()
    runtime = store.get_runtime_config()
    hooks = runtime.get("hooks", {})

    entries = hooks.get(event_type, [])
    if index < 0 or index >= len(entries):
        raise HTTPException(404, "Hook entry not found at that index")

    entries.pop(index)
    if not entries:
        hooks.pop(event_type, None)
    else:
        hooks[event_type] = entries
    store.update_runtime_config("hooks", hooks)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=admin.username,
        action="hooks.admin_removed",
        details={"event_type": event_type, "index": index},
    ))

    return {"status": "ok", "hooks": hooks}
