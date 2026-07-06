from __future__ import annotations

import asyncio
import secrets
from pathlib import Path

from claude_agent_sdk import list_sessions
from fastapi import APIRouter, Depends, HTTPException, Query

from ..models.admin import (
    AdminStatsResponse,
    AuditEntryResponse,
    AuditLogResponse,
    CliPathResponse,
    CliPathUpdate,
    HistoryRetentionResponse,
    HistoryRetentionUpdate,
    PresetPromptResponse,
    PresetPromptUpdate,
    RetryableToolEntry,
    RetryCallbackWeComConfig,
    RetryableToolsResponse,
    RetryableToolsUpdate,
    RiskyToolsResponse,
    RiskyToolsUpdate,
    SensitivePatternEntry,
    SensitivePatternsResponse,
    SensitivePatternsUpdate,
    UserStatsEntry,
)
from ..models.plugin import PluginConfigUpdate, PluginInfo, PluginListResponse
from ..models.auth import UserCreate, UserPublic, UserUpdate
from ..models.mcp import McpLevel, McpServerListResponse, McpServerSummary
from ..models.skills import SkillLevel, SkillListResponse
from ..services.audit_log import AuditEntry, get_audit_logger
from ..services.auth import require_admin, user_record_to_public
from ..services.config import get_settings
from ..services.scheduler.job_store import get_job_store
from ..services.scheduler.shared import get_state_path, write_command
from ..services.skills import delete_skill as service_delete_skill
from ..services.skills import list_skills as service_list_skills
from ..services.user_env import write_user_env
from ..services.user_store import UserRecord, get_user_store

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get("/users", response_model=list[UserPublic])
async def list_users():
    store = get_user_store()
    return [user_record_to_public(u) for u in store.list_users()]


@router.post("/users", response_model=UserPublic)
async def create_user(
    request: UserCreate,
    current_user: UserRecord = Depends(require_admin),
):
    store = get_user_store()
    settings = get_settings()
    password = request.password or settings.auth.default_password
    try:
        user = store.create_user(request.username, password, request.role)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    # Write env if provided
    if request.env:
        env_dict = request.env.model_dump(exclude_none=True)
        if env_dict:
            write_user_env(request.username, env_dict)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="user.created",
        target=request.username,
        details={"role": request.role},
    ))

    return user_record_to_public(user)


@router.put("/users/{username}", response_model=UserPublic)
async def update_user(
    username: str,
    request: UserUpdate,
    current_user: UserRecord = Depends(require_admin),
):
    store = get_user_store()
    existing = store.get_user(username)
    if existing is None:
        raise HTTPException(404, f"User '{username}' not found")

    # Last admin protection on role demotion
    if request.role and request.role != "admin" and existing.role == "admin":
        if store.count_admins() <= 1:
            raise HTTPException(400, "Cannot remove the last admin")

    kwargs = {}
    audit = get_audit_logger()

    if request.password is not None:
        kwargs["password"] = request.password
        audit.append(AuditEntry(
            actor=current_user.username,
            action="user.password_reset",
            target=username,
        ))

    if request.role is not None and request.role != existing.role:
        kwargs["role"] = request.role
        audit.append(AuditEntry(
            actor=current_user.username,
            action="user.role_changed",
            target=username,
            details={"old_role": existing.role, "new_role": request.role},
        ))
    elif request.role is not None:
        kwargs["role"] = request.role

    if request.api_key is not None:
        if request.api_key == "__generate__":
            kwargs["api_key"] = "sk-" + secrets.token_hex(24)
            audit.append(AuditEntry(
                actor=current_user.username,
                action="user.apikey_generated",
                target=username,
            ))
        elif request.api_key == "__revoke__":
            kwargs["api_key"] = None
            audit.append(AuditEntry(
                actor=current_user.username,
                action="user.apikey_revoked",
                target=username,
            ))
        else:
            kwargs["api_key"] = request.api_key

    # Write env if provided
    if request.env:
        env_dict = request.env.model_dump(exclude_none=True)
        if env_dict:
            write_user_env(username, env_dict)

    try:
        user = store.update_user(username, **kwargs)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return user_record_to_public(user)


@router.delete("/users/{username}")
async def delete_user(
    username: str,
    current_user: UserRecord = Depends(require_admin),
):
    store = get_user_store()
    if username == current_user.username:
        raise HTTPException(400, "Cannot delete your own account")

    existing = store.get_user(username)
    if existing is None:
        raise HTTPException(404, f"User '{username}' not found")

    # Last admin protection
    if existing.role == "admin" and store.count_admins() <= 1:
        raise HTTPException(400, "Cannot remove the last admin")

    try:
        store.delete_user(username)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    # Clean up scheduler jobs for deleted user
    write_command("remove_user", {"username": username})

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="user.deleted",
        target=username,
        details={"role": existing.role},
    ))

    return {"status": "ok"}


@router.get("/stats", response_model=AdminStatsResponse)
async def get_admin_stats():
    store = get_user_store()
    settings = get_settings()
    work_dir = Path(settings.server.work_dir).expanduser()

    users = store.list_users()
    user_stats: list[UserStatsEntry] = []
    total_sessions = 0
    total_storage = 0

    for u in users:
        user_workspace = work_dir / u.username
        session_count = 0
        storage_bytes = 0
        last_active = None

        if user_workspace.exists():
            try:
                sessions = list_sessions(directory=str(user_workspace))
                session_count = len(sessions)
                for s in sessions:
                    storage_bytes += s.file_size or 0
                    if s.last_modified:
                        if last_active is None or s.last_modified > last_active:
                            last_active = s.last_modified
            except Exception:
                pass

        total_sessions += session_count
        total_storage += storage_bytes
        user_stats.append(UserStatsEntry(
            username=u.username,
            role=u.role,
            session_count=session_count,
            storage_bytes=storage_bytes,
            last_active=last_active,
        ))

    user_stats.sort(key=lambda x: x.session_count, reverse=True)

    return AdminStatsResponse(
        total_users=len(users),
        total_sessions=total_sessions,
        total_storage_bytes=total_storage,
        users=user_stats,
    )


@router.get("/audit", response_model=AuditLogResponse)
async def get_audit_log(
    limit: int = Query(default=50, ge=1, le=200),
    before: str | None = Query(default=None),
    after: str | None = Query(default=None),
    action: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    target: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
):
    from datetime import datetime

    start_time = datetime.fromisoformat(start) if start else None
    end_time = datetime.fromisoformat(end) if end else None

    audit = get_audit_logger()
    entries, next_cursor, prev_cursor, total = await asyncio.to_thread(
        audit.query_cursor,
        limit=limit,
        before=before,
        after=after,
        action_filter=action,
        actor_filter=actor,
        target_filter=target,
        start_time=start_time,
        end_time=end_time,
        session_id_filter=session_id,
    )
    return AuditLogResponse(
        entries=[
            AuditEntryResponse(
                id=e.id,
                timestamp=e.timestamp,
                actor=e.actor,
                action=e.action,
                target=e.target,
                details=e.details,
            )
            for e in entries
        ],
        next_cursor=next_cursor,
        prev_cursor=prev_cursor,
        total=total,
        limit=limit,
    )


# --- Admin scheduler endpoints ---

@router.get("/scheduler/jobs")
async def admin_list_scheduler_jobs():
    """List all users' scheduled jobs."""
    store = get_job_store()
    all_jobs = store.list_all_user_jobs()
    result = []
    for username, jobs in all_jobs.items():
        for job in jobs:
            result.append({
                "username": username,
                **job.model_dump(mode="json"),
            })
    return {"jobs": result, "total": len(result)}


@router.get("/scheduler/running")
async def admin_list_running_tasks():
    """List all running scheduler tasks across users."""
    import json
    state_path = get_state_path()
    if not state_path.exists():
        return {"running": [], "total": 0}
    try:
        with open(state_path, "r") as f:
            state = json.load(f)
    except Exception:
        return {"running": [], "total": 0}
    running = state.get("running", [])
    return {"running": running, "total": len(running)}


# --- Admin per-user skills endpoints ---

@router.get("/users/{username}/skills", response_model=SkillListResponse)
async def get_user_skills(username: str):
    """List all skills for a specific user."""
    store = get_user_store()
    if store.get_user(username) is None:
        raise HTTPException(404, f"User '{username}' not found")
    return service_list_skills(username)


@router.delete("/users/{username}/skills/{level}/{name}")
async def delete_user_skill(
    username: str,
    level: SkillLevel,
    name: str,
    current_user: UserRecord = Depends(require_admin),
):
    """Delete a skill for a specific user."""
    store = get_user_store()
    if store.get_user(username) is None:
        raise HTTPException(404, f"User '{username}' not found")

    service_delete_skill(level, name, username)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="skill.deleted",
        target=name,
        details={"level": level, "username": username},
    ))

    return {"message": f"Skill '{name}' deleted successfully"}


# --- Admin per-user MCP endpoints ---

@router.get("/users/{username}/mcp", response_model=McpServerListResponse)
async def get_user_mcp_servers(username: str):
    """List all MCP servers for a specific user."""
    store = get_user_store()
    if store.get_user(username) is None:
        raise HTTPException(404, f"User '{username}' not found")
    from ..services.mcp.config_manager import McpConfigManager
    mgr = McpConfigManager(username)
    all_servers = mgr.read_all_servers()
    return McpServerListResponse(
        servers=[
            McpServerSummary(
                name=name, type=config.get("type", "http"), url=config.get("url", ""),
                level=level, header_count=len(config.get("headers", {})),
                timeout=config.get("timeout", 60),
            )
            for name, config, level in all_servers
        ]
    )


@router.delete("/users/{username}/mcp/{level}/{name}")
async def delete_user_mcp_server(
    username: str,
    level: McpLevel,
    name: str,
    current_user: UserRecord = Depends(require_admin),
):
    """Delete an MCP server for a specific user."""
    store = get_user_store()
    if store.get_user(username) is None:
        raise HTTPException(404, f"User '{username}' not found")

    from ..services.mcp.config_manager import McpConfigManager
    mgr = McpConfigManager(username)
    if level == "project":
        deleted = mgr.delete_project_server(name)
    else:
        deleted = mgr.delete_global_server(name)
    if not deleted:
        raise HTTPException(404, f"MCP server '{name}' not found at {level} level")

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="mcp.deleted",
        target=name,
        details={"level": level, "username": username},
    ))

    return {"message": f"MCP server '{name}' deleted successfully"}


# --- Admin per-user scheduler endpoints ---


@router.get("/users/{username}/scheduler/jobs")
async def get_user_scheduler_jobs(username: str):
    """List scheduled jobs for a specific user (read-only)."""
    store = get_user_store()
    if store.get_user(username) is None:
        raise HTTPException(404, f"User '{username}' not found")
    job_store = get_job_store()
    jobs = job_store.list_jobs(username)
    return {
        "jobs": [j.model_dump(mode="json") for j in jobs],
        "total": len(jobs),
    }


# --- Admin per-user hooks endpoints ---


@router.get("/users/{username}/hooks/active")
async def get_user_active_hooks(username: str):
    """List only the hooks currently active/enabled for a specific user."""
    from ..services.auth import get_user_workspace
    from ..services.hooks.config_manager import HookConfigManager
    from ..services.hooks.prefs import get_enabled_builtin_hooks

    store = get_user_store()
    user = store.get_user(username)
    if user is None:
        raise HTTPException(404, f"User '{username}' not found")

    # 1. Built-in hooks currently enabled for this user.
    enabled_builtins = get_enabled_builtin_hooks(username)

    # 2. Custom hook handlers from the user's settings files.
    cwd = get_user_workspace(user)
    merged = HookConfigManager(cwd).read_merged()
    custom: list[dict] = []
    for event, entries in merged.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            matcher = entry.get("matcher", "*")
            for handler in entry.get("hooks", []) or []:
                if not isinstance(handler, dict):
                    continue
                custom.append({
                    "kind": "custom",
                    "event": event,
                    "matcher": matcher,
                    "type": handler.get("type", "command"),
                    "command": handler.get("command"),
                    "url": handler.get("url"),
                })

    return {
        "builtins": enabled_builtins,
        "custom": custom,
        "total": len(enabled_builtins) + len(custom),
    }


@router.get("/presetprompt", response_model=PresetPromptResponse)
async def get_preset_prompt():
    store = get_user_store()
    runtime = store.get_runtime_config()
    cfg = runtime.get("append_systemprompt", {})
    return PresetPromptResponse(enable=cfg.get("enable", False), content=cfg.get("content"))


@router.put("/presetprompt", response_model=PresetPromptResponse)
async def update_preset_prompt(
    request: PresetPromptUpdate,
    current_user: UserRecord = Depends(require_admin),
):
    store = get_user_store()
    store.update_runtime_config("append_systemprompt", {
        "enable": request.enable,
        "content": request.content,
    })
    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="runtime.presetprompt_updated",
        target="append_systemprompt",
        details={"enable": request.enable, "content_length": len(request.content or "")},
    ))
    return PresetPromptResponse(enable=request.enable, content=request.content)


@router.get("/clipath", response_model=CliPathResponse)
async def get_cli_path():
    store = get_user_store()
    runtime = store.get_runtime_config()
    return CliPathResponse(cli_path=runtime.get("cli_path"))


@router.put("/clipath", response_model=CliPathResponse)
async def update_cli_path(
    request: CliPathUpdate,
    current_user: UserRecord = Depends(require_admin),
):
    store = get_user_store()
    store.update_runtime_config("cli_path", request.cli_path)
    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="runtime.cli_path_updated",
        target="cli_path",
        details={"cli_path": request.cli_path},
    ))
    return CliPathResponse(cli_path=request.cli_path)


@router.get("/history-retention", response_model=HistoryRetentionResponse)
async def get_history_retention():
    store = get_user_store()
    runtime = store.get_runtime_config()
    days = runtime.get("history_retention_days", 7)
    return HistoryRetentionResponse(history_retention_days=days)


@router.put("/history-retention", response_model=HistoryRetentionResponse)
async def update_history_retention(
    request: HistoryRetentionUpdate,
    current_user: UserRecord = Depends(require_admin),
):
    store = get_user_store()
    store.update_runtime_config("history_retention_days", request.history_retention_days)
    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="runtime.history_retention_updated",
        target="history_retention_days",
        details={"history_retention_days": request.history_retention_days},
    ))
    return HistoryRetentionResponse(history_retention_days=request.history_retention_days)


@router.get("/retryable-tools", response_model=RetryableToolsResponse)
async def get_retryable_tools():
    store = get_user_store()
    runtime = store.get_runtime_config()
    raw_tools = runtime.get("retryable_tools", [])
    tools = [RetryableToolEntry(**t) if isinstance(t, dict) else t for t in raw_tools]
    raw_wecom = runtime.get("retry_callback_wecom")
    wecom_cfg = RetryCallbackWeComConfig(**raw_wecom) if isinstance(raw_wecom, dict) else None
    return RetryableToolsResponse(
        retryable_tools=tools,
        retry_callback_type=runtime.get("retry_callback_type", "none"),
        retry_callback_script=runtime.get("retry_callback_script"),
        retry_callback_wecom=wecom_cfg,
    )


@router.put("/retryable-tools", response_model=RetryableToolsResponse)
async def update_retryable_tools(
    request: RetryableToolsUpdate,
    current_user: UserRecord = Depends(require_admin),
):
    store = get_user_store()
    store.update_runtime_config(
        "retryable_tools",
        [t.model_dump() for t in request.retryable_tools],
    )
    store.update_runtime_config("retry_callback_type", request.retry_callback_type)
    store.update_runtime_config("retry_callback_script", request.retry_callback_script)
    store.update_runtime_config(
        "retry_callback_wecom",
        request.retry_callback_wecom.model_dump() if request.retry_callback_wecom else None,
    )
    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="runtime.retryable_tools_updated",
        target="retryable_tools",
        details={
            "tool_count": len(request.retryable_tools),
            "callback_type": request.retry_callback_type,
        },
    ))
    return RetryableToolsResponse(
        retryable_tools=request.retryable_tools,
        retry_callback_type=request.retry_callback_type,
        retry_callback_script=request.retry_callback_script,
        retry_callback_wecom=request.retry_callback_wecom,
    )


@router.get("/risky-tools", response_model=RiskyToolsResponse)
async def get_risky_tools():
    """List the admin-configured risky-tool patterns that force user
    approval even in bypassPermissions mode."""
    store = get_user_store()
    runtime = store.get_runtime_config()
    return RiskyToolsResponse(
        risky_tool_list=list(runtime.get("risky_tool_list") or [])
    )


@router.put("/risky-tools", response_model=RiskyToolsResponse)
async def update_risky_tools(
    request: RiskyToolsUpdate,
    current_user: UserRecord = Depends(require_admin),
):
    """Update the risky-tool patterns. Each pattern must be a valid
    Claude Code native permission-grammar string (e.g. 'Bash(rm:*)',
    'Write(/etc/**)', 'WebFetch(domain:github.com)', 'mcp__*__delete_*').
    Malformed patterns are rejected with HTTP 422."""
    from ..services.hooks.risky_matcher import parse_rule_strict

    # Validate all patterns before committing any change.
    for raw in request.risky_tool_list:
        try:
            parse_rule_strict(raw)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

    store = get_user_store()
    store.update_runtime_config("risky_tool_list", list(request.risky_tool_list))

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="runtime.risky_tool_list_updated",
        target="risky_tool_list",
        details={"count": len(request.risky_tool_list)},
    ))
    return RiskyToolsResponse(risky_tool_list=list(request.risky_tool_list))


@router.get("/sensitive-patterns", response_model=SensitivePatternsResponse)
async def get_sensitive_patterns():
    """Return the PII masking config: ``enable`` toggle + ``patterns`` list."""
    store = get_user_store()
    cfg = store.get_runtime_config().get("pii_masking") or {}
    raw = cfg.get("patterns") or []
    patterns = [SensitivePatternEntry(**p) if isinstance(p, dict) else p for p in raw]
    return SensitivePatternsResponse(enable=bool(cfg.get("enable", False)), patterns=patterns)


@router.put("/sensitive-patterns", response_model=SensitivePatternsResponse)
async def update_sensitive_patterns(
    request: SensitivePatternsUpdate,
    current_user: UserRecord = Depends(require_admin),
):
    """Update PII masking config. Each pattern must compile as a regex.

    ``enable=True`` activates the PostToolUse hook that replaces matched
    substrings before the model sees tool output. The outbound SSE mask path
    runs whenever patterns are non-empty regardless of this flag."""
    from ..utils.sensitive_mask import parse_pattern_strict

    for entry in request.patterns:
        try:
            parse_pattern_strict(entry.model_dump())
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

    store = get_user_store()
    store.update_runtime_config(
        "pii_masking",
        {
            "enable": bool(request.enable),
            "patterns": [p.model_dump() for p in request.patterns],
        },
    )

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="runtime.pii_masking_updated",
        target="pii_masking",
        details={"enable": bool(request.enable), "count": len(request.patterns)},
    ))
    return SensitivePatternsResponse(
        enable=bool(request.enable),
        patterns=list(request.patterns),
    )


# --- Plugin management endpoints ---

@router.get("/system/plugin", response_model=PluginListResponse)
async def list_plugins():
    from ..services.vivian_plugin import get_plugin_manager
    store = get_user_store()
    runtime = store.get_runtime_config()
    mgr = get_plugin_manager()
    plugins = mgr.list_plugins(runtime)
    return PluginListResponse(plugins=[PluginInfo(**p) for p in plugins])


@router.put("/system/plugin/{plugin_id}", response_model=PluginInfo)
async def update_plugin(
    plugin_id: str,
    request: PluginConfigUpdate,
    current_user: UserRecord = Depends(require_admin),
):
    from ..services.vivian_plugin import get_plugin_manager
    mgr = get_plugin_manager()
    plugin = mgr.get_plugin(plugin_id)
    if plugin is None:
        raise HTTPException(404, f"Plugin '{plugin_id}' not found")

    store = get_user_store()
    plugin_data = {"enable": request.enable, **request.config}
    store.update_runtime_config("plugins", {
        **store.get_runtime_config().get("plugins", {}),
        plugin_id: plugin_data,
    })

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=current_user.username,
        action="runtime.plugin_updated",
        target=plugin_id,
        details={"enable": request.enable},
    ))

    merged = {**plugin.default_config, **request.config}
    return PluginInfo(
        id=plugin.id,
        name=plugin.name,
        description=plugin.description,
        enabled=request.enable,
        config=merged,
    )
