from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from ..middleware.logging import get_app_logger
from ..models.subagents import (
    SubAgentCatalogResponse,
    SubAgentCatalogSkill,
    SubAgentCreateRequest,
    SubAgentDetail,
    SubAgentListResponse,
    SubAgentSummary,
    SubAgentUpdateRequest,
)
from .auth import get_user_workspace
from .user_store import get_user_store

logger = get_app_logger(__name__)

AGENT_NAME_RE = re.compile(r"^[a-z0-9-]+$")
MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 2048

RESERVED_NAMES = {
    "general-purpose",
    "default",
    "main",
    "system",
    "explore",
    "plan",
    "statusline-setup",
    "claude-code-guide",
}

BUILTIN_TOOL_CATALOG = [
    "Read",
    "Write",
    "Edit",
    "Grep",
    "Glob",
    "Bash",
    "TodoWrite",
]

FORBIDDEN_TOOLS = {"Agent", "Task"}

MCP_TOOL_RE = re.compile(r"^mcp__[a-zA-Z0-9_]+__[a-zA-Z0-9_*]+$")

VALID_PERMISSION_MODES = {
    "default",
    "acceptEdits",
    "plan",
    "bypassPermissions",
    "ask",
    "deny",
}
VALID_MEMORY_MODES = {"none", "user", "project", "local"}


def _agents_dir(username: str) -> Path:
    """Return the per-user .claude/agents/ directory, creating on demand."""
    base = get_user_workspace(_fake_user_record(username))
    path = Path(base) / ".claude" / "agents"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _fake_user_record(username: str):
    """Wrap a username so get_user_workspace can resolve the per-user path."""
    from ..models.auth import UserRecord
    return UserRecord(username=username, password_hash="", role="user")


def _safe_resolve(base: Path, relative: str) -> Path:
    """Resolve path and verify it's inside base directory."""
    resolved = (base / relative).resolve()
    if not str(resolved).startswith(str(base.resolve())):
        raise HTTPException(400, "Path traversal detected")
    return resolved


def _validate_agent_name(name: str) -> None:
    if not name:
        raise HTTPException(422, "Agent name is required")
    if len(name) > MAX_NAME_LENGTH:
        raise HTTPException(422, f"Agent name must be at most {MAX_NAME_LENGTH} characters")
    if not AGENT_NAME_RE.match(name):
        raise HTTPException(422, "Agent name must contain only lowercase letters, numbers, and hyphens")
    if name.lower() in RESERVED_NAMES:
        raise HTTPException(422, f"Agent name '{name}' is reserved")


def _validate_description(desc: str | None) -> None:
    if not desc:
        raise HTTPException(422, "Agent description is required")
    if len(desc) > MAX_DESCRIPTION_LENGTH:
        raise HTTPException(422, f"Agent description must be at most {MAX_DESCRIPTION_LENGTH} characters")


def _validate_tool(tool: str) -> None:
    if tool in FORBIDDEN_TOOLS:
        raise HTTPException(422, f"Tool '{tool}' is forbidden in subagents")
    if tool in BUILTIN_TOOL_CATALOG:
        return
    if MCP_TOOL_RE.match(tool):
        return
    raise HTTPException(422, f"Tool '{tool}' is not a recognized built-in or MCP tool reference")


def _validate_tools(tools: list[str] | None) -> None:
    if not tools:
        return
    for t in tools:
        _validate_tool(t)


def _validate_permission_mode(mode: str | None) -> None:
    if mode is None:
        return
    if mode not in VALID_PERMISSION_MODES:
        raise HTTPException(422, f"Invalid permissionMode: {mode}")


def _validate_memory(mode: str | None) -> None:
    if mode is None:
        return
    if mode not in VALID_MEMORY_MODES:
        raise HTTPException(422, f"Invalid memory mode: {mode}")


def _validate_max_turns(value: int | None) -> None:
    if value is None:
        return
    if not isinstance(value, int) or value < 1 or value > 100:
        raise HTTPException(422, "maxTurns must be an integer between 1 and 100")


def _normalize_list_value(value: Any) -> list[str]:
    """Accept either ``[a, b]`` or ``"a, b"`` CSV form, return a list."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return []


def _parse_agent_md(path: Path) -> SubAgentDetail:
    if not path.exists() or not path.is_file():
        raise HTTPException(404, f"Agent file not found: {path.name}")
    text = path.read_text(encoding="utf-8")

    body = ""
    fm: dict[str, Any] = {}
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError as exc:
                raise HTTPException(500, f"Invalid YAML frontmatter in {path.name}: {exc}")
            body = parts[2].lstrip("\n")

    if not isinstance(fm, dict):
        fm = {}

    name = fm.get("name") or path.stem
    description = fm.get("description") or ""

    # SDK 0.1.81 deprecated listing "Skill" in tools — it's auto-injected via
    # ``options.skills``. Strip it on read so the picker reflects the new
    # model; the next save writes the migrated frontmatter back to disk.
    raw_tools = [t for t in _normalize_list_value(fm.get("tools")) if t != "Skill"]
    raw_disallowed = [t for t in _normalize_list_value(fm.get("disallowedTools")) if t != "Skill"]

    return SubAgentDetail(
        name=str(name),
        description=str(description),
        prompt=body,
        tools=raw_tools,
        disallowedTools=raw_disallowed,
        model=fm.get("model"),
        permissionMode=fm.get("permissionMode"),
        maxTurns=fm.get("maxTurns"),
        skills=_normalize_list_value(fm.get("skills")),
        mcpServers=fm.get("mcpServers") if isinstance(fm.get("mcpServers"), list) else [],
        memory=fm.get("memory"),
        background=fm.get("background"),
    )


def _serialize_agent_md(detail: SubAgentDetail) -> str:
    fm: dict[str, Any] = {
        "name": detail.name,
        "description": detail.description,
    }

    if detail.tools:
        fm["tools"] = list(detail.tools)
    if detail.disallowedTools:
        fm["disallowedTools"] = list(detail.disallowedTools)
    if detail.model:
        fm["model"] = detail.model
    if detail.permissionMode:
        fm["permissionMode"] = detail.permissionMode
    if detail.maxTurns is not None:
        fm["maxTurns"] = detail.maxTurns
    if detail.skills:
        fm["skills"] = list(detail.skills)
    if detail.mcpServers:
        fm["mcpServers"] = list(detail.mcpServers)
    if detail.memory:
        fm["memory"] = detail.memory
    if detail.background is not None:
        fm["background"] = detail.background

    fm_text = yaml.safe_dump(fm, sort_keys=False, allow_unicode=True).rstrip()
    body = (detail.prompt or "").lstrip("\n")
    return f"---\n{fm_text}\n---\n\n{body}\n"


def _detail_path(username: str, name: str) -> Path:
    base = _agents_dir(username)
    return _safe_resolve(base, f"{name}.md")


def list_agents(username: str) -> SubAgentListResponse:
    base = _agents_dir(username)
    items: list[SubAgentSummary] = []
    if not base.exists():
        return SubAgentListResponse(agents=items)

    for entry in sorted(base.iterdir()):
        if not entry.is_file() or entry.suffix != ".md":
            continue
        try:
            detail = _parse_agent_md(entry)
        except HTTPException:
            logger.warning("Failed to parse agent file: {}", entry)
            continue

        items.append(
            SubAgentSummary(
                name=detail.name,
                description=detail.description,
                model=detail.model,
                tools_count=len(detail.tools or []),
            )
        )
    return SubAgentListResponse(agents=items)


def get_agent(username: str, name: str) -> SubAgentDetail:
    _validate_agent_name(name)
    path = _detail_path(username, name)
    if not path.exists():
        raise HTTPException(404, f"Agent '{name}' not found")
    return _parse_agent_md(path)


def _validate_full(detail: SubAgentDetail) -> None:
    _validate_agent_name(detail.name)
    _validate_description(detail.description)
    _validate_tools(detail.tools)
    _validate_tools(detail.disallowedTools)
    _validate_permission_mode(detail.permissionMode)
    _validate_memory(detail.memory)
    _validate_max_turns(detail.maxTurns)


def create_agent(username: str, req: SubAgentCreateRequest) -> SubAgentDetail:
    detail = SubAgentDetail(
        name=req.name,
        description=req.description,
        prompt=req.prompt or "",
        tools=req.tools or [],
        disallowedTools=req.disallowedTools or [],
        model=req.model,
        permissionMode=req.permissionMode,
        maxTurns=req.maxTurns,
        skills=req.skills or [],
        mcpServers=req.mcpServers or [],
        memory=req.memory,
        background=req.background,
    )
    _validate_full(detail)

    path = _detail_path(username, detail.name)
    if path.exists():
        raise HTTPException(409, f"Agent '{detail.name}' already exists")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_serialize_agent_md(detail), encoding="utf-8")
    return detail


def update_agent(username: str, name: str, req: SubAgentUpdateRequest) -> SubAgentDetail:
    _validate_agent_name(name)
    existing = get_agent(username, name)

    new_name = req.new_name or existing.name
    if new_name != existing.name:
        _validate_agent_name(new_name)

    merged = SubAgentDetail(
        name=new_name,
        description=req.description if req.description is not None else existing.description,
        prompt=req.prompt if req.prompt is not None else existing.prompt,
        tools=req.tools if req.tools is not None else existing.tools,
        disallowedTools=req.disallowedTools if req.disallowedTools is not None else existing.disallowedTools,
        model=req.model if req.model is not None else existing.model,
        permissionMode=req.permissionMode if req.permissionMode is not None else existing.permissionMode,
        maxTurns=req.maxTurns if req.maxTurns is not None else existing.maxTurns,
        skills=req.skills if req.skills is not None else existing.skills,
        mcpServers=req.mcpServers if req.mcpServers is not None else existing.mcpServers,
        memory=req.memory if req.memory is not None else existing.memory,
        background=req.background if req.background is not None else existing.background,
    )
    _validate_full(merged)

    old_path = _detail_path(username, name)
    new_path = _detail_path(username, new_name)
    if new_name != existing.name:
        if new_path.exists():
            raise HTTPException(409, f"Agent '{new_name}' already exists")
        os.rename(old_path, new_path)

    new_path.write_text(_serialize_agent_md(merged), encoding="utf-8")
    return merged


def delete_agent(username: str, name: str) -> None:
    _validate_agent_name(name)
    path = _detail_path(username, name)
    if not path.exists():
        raise HTTPException(404, f"Agent '{name}' not found")
    path.unlink()


def get_catalog(username: str) -> SubAgentCatalogResponse:
    """Build the picker catalog: tools (filtered), skills, mcp servers, reserved names."""
    # Tools — start from built-in catalog, filter against deployment-disallowed list
    from .claude_sdk.options import BUILTIN_DISALLOWED_TOOLS
    disallowed = set(BUILTIN_DISALLOWED_TOOLS)
    tools = [t for t in BUILTIN_TOOL_CATALOG if t not in disallowed]

    # Skills — read from existing service. ``enabled`` mirrors the per-user
    # ``skill_exclude`` denylist so the picker can render disabled entries dim
    # and prevent silent runtime no-ops.
    skill_entries: list[SubAgentCatalogSkill] = []
    try:
        from .skills import list_skills
        resp = list_skills(username)
        # Dedup across project/global, prefer the enabled state if either side is on.
        by_name: dict[str, bool] = {}
        for s in resp.skills:
            by_name[s.name] = by_name.get(s.name, False) or bool(s.enabled)
        skill_entries = [
            SubAgentCatalogSkill(name=name, enabled=enabled)
            for name, enabled in sorted(by_name.items())
        ]
    except Exception:
        logger.warning("Failed to load skills for subagent catalog", exc_info=True)

    # MCP servers — read from existing config
    mcp_names: list[str] = []
    try:
        from .mcp.config_manager import McpConfigManager
        mgr = McpConfigManager(username)
        mcp_names = sorted({name for name, _cfg, _level in mgr.read_all_servers()})
    except Exception:
        logger.warning("Failed to load MCP servers for subagent catalog", exc_info=True)

    return SubAgentCatalogResponse(
        tools=tools,
        skills=skill_entries,
        mcp_servers=mcp_names,
        reserved_names=sorted(RESERVED_NAMES),
    )
