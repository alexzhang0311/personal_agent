from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..middleware.logging import get_app_logger
from ..models.auth import UserRecord
from ..models.mcp import (
    McpHeaderItem,
    McpLevel,
    McpServerCapabilities,
    McpServerCreateRequest,
    McpServerDetail,
    McpServerListResponse,
    McpServerSummary,
    McpServerUpdateRequest,
    McpValidateRequest,
    McpValidateResponse,
    McpValidateToolRequest,
    McpValidateToolResponse,
)
from ..services.audit_log import AuditEntry, get_audit_logger
from ..services.auth import require_user
from ..services.mcp.config_manager import McpConfigManager
from ..services.mcp.validator import test_mcp_tool, validate_mcp_server

logger = get_app_logger(__name__)

router = APIRouter(prefix="/api/resource/mcp", tags=["mcp"])


def _require_admin_for_global(level: str, user: UserRecord) -> None:
    if level == "global" and user.role != "admin":
        raise HTTPException(403, "Admin access required for global MCP servers")


def _config_to_detail(name: str, config: dict, level: str) -> McpServerDetail:
    headers_dict = config.get("headers", {})
    headers = [McpHeaderItem(key=k, value=v) for k, v in headers_dict.items()]
    return McpServerDetail(
        name=name,
        type=config.get("type", "http"),
        url=config.get("url", ""),
        level=level,
        headers=headers,
        timeout=config.get("timeout", 60),
    )


def _config_to_summary(name: str, config: dict, level: str) -> McpServerSummary:
    return McpServerSummary(
        name=name,
        type=config.get("type", "http"),
        url=config.get("url", ""),
        level=level,
        header_count=len(config.get("headers", {})),
        timeout=config.get("timeout", 60),
    )


@router.get("/", response_model=McpServerListResponse)
async def list_mcp_servers(user: UserRecord = Depends(require_user)):
    mgr = McpConfigManager(user.username)
    all_servers = mgr.read_all_servers()
    return McpServerListResponse(
        servers=[_config_to_summary(name, config, level) for name, config, level in all_servers]
    )


@router.get("/{level}/{name}", response_model=McpServerDetail)
async def get_mcp_server(
    level: McpLevel,
    name: str,
    user: UserRecord = Depends(require_user),
):
    mgr = McpConfigManager(user.username)
    if level == "project":
        servers = mgr.read_project_servers()
    else:
        servers = mgr.read_global_servers()

    if name not in servers:
        raise HTTPException(404, f"MCP server '{name}' not found at {level} level")
    return _config_to_detail(name, servers[name], level)


@router.get("/{level}/{name}/capabilities", response_model=McpServerCapabilities)
async def get_mcp_server_capabilities(
    level: McpLevel,
    name: str,
    user: UserRecord = Depends(require_user),
):
    mgr = McpConfigManager(user.username)
    if level == "project":
        servers = mgr.read_project_servers()
    else:
        servers = mgr.read_global_servers()

    if name not in servers:
        raise HTTPException(404, f"MCP server '{name}' not found at {level} level")

    config = servers[name]
    result = await validate_mcp_server(
        server_type=config.get("type", "http"),
        url=config.get("url", ""),
        headers=config.get("headers"),
        timeout=config.get("timeout", 30),
    )
    if not result.success:
        raise HTTPException(502, f"Failed to connect to MCP server: {result.error}")

    return McpServerCapabilities(
        tools=result.tools,
        prompts=result.prompts,
        resources=result.resources,
        server_name=result.server_name,
        server_version=result.server_version,
    )


@router.post("/", response_model=McpServerDetail)
async def create_mcp_server(
    request: McpServerCreateRequest,
    user: UserRecord = Depends(require_user),
):
    _require_admin_for_global(request.level, user)

    mgr = McpConfigManager(user.username)
    headers_dict = {h.key: h.value for h in request.headers}
    config = {
        "type": request.type,
        "url": request.url,
        "headers": headers_dict,
        "timeout": request.timeout,
    }

    if request.level == "project":
        mgr.add_project_server(request.name, config)
    else:
        mgr.add_global_server(request.name, config)

    audit = get_audit_logger()
    audit.append(
        AuditEntry(
            actor=user.username,
            action="mcp.created",
            target=request.name,
            details={"level": request.level, "type": request.type},
        )
    )

    return _config_to_detail(request.name, config, request.level)


@router.put("/{level}/{name}", response_model=McpServerDetail)
async def update_mcp_server(
    level: McpLevel,
    name: str,
    request: McpServerUpdateRequest,
    user: UserRecord = Depends(require_user),
):
    _require_admin_for_global(level, user)

    mgr = McpConfigManager(user.username)
    updates: dict = {}
    if request.type is not None:
        updates["type"] = request.type
    if request.url is not None:
        updates["url"] = request.url
    if request.headers is not None:
        updates["headers"] = {h.key: h.value for h in request.headers}
    if request.timeout is not None:
        updates["timeout"] = request.timeout

    if level == "project":
        updated = mgr.update_project_server(name, updates)
    else:
        updated = mgr.update_global_server(name, updates)

    if updated is None:
        raise HTTPException(404, f"MCP server '{name}' not found at {level} level")

    audit = get_audit_logger()
    audit.append(
        AuditEntry(
            actor=user.username,
            action="mcp.updated",
            target=name,
            details={"level": level, "fields": list(updates.keys())},
        )
    )

    return _config_to_detail(name, updated, level)


@router.delete("/{level}/{name}")
async def delete_mcp_server(
    level: McpLevel,
    name: str,
    user: UserRecord = Depends(require_user),
):
    _require_admin_for_global(level, user)

    mgr = McpConfigManager(user.username)
    if level == "project":
        deleted = mgr.delete_project_server(name)
    else:
        deleted = mgr.delete_global_server(name)

    if not deleted:
        raise HTTPException(404, f"MCP server '{name}' not found at {level} level")

    audit = get_audit_logger()
    audit.append(
        AuditEntry(
            actor=user.username,
            action="mcp.deleted",
            target=name,
            details={"level": level},
        )
    )

    return {"message": f"MCP server '{name}' deleted successfully"}


@router.post("/validate", response_model=McpValidateResponse)
async def validate_mcp_server_endpoint(
    request: McpValidateRequest,
    user: UserRecord = Depends(require_user),
):
    headers_dict = {h.key: h.value for h in request.headers}
    return await validate_mcp_server(
        server_type=request.type,
        url=request.url,
        headers=headers_dict,
        timeout=request.timeout,
    )


@router.post("/validate/tool", response_model=McpValidateToolResponse)
async def validate_mcp_tool_endpoint(
    request: McpValidateToolRequest,
    user: UserRecord = Depends(require_user),
):
    headers_dict = {h.key: h.value for h in request.headers}
    return await test_mcp_tool(
        server_type=request.type,
        url=request.url,
        headers=headers_dict,
        timeout=request.timeout,
        tool_name=request.tool_name,
        tool_arguments=request.tool_arguments,
    )
