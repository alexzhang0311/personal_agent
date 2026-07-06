from __future__ import annotations

from typing import Any

import httpx

from ...middleware.logging import get_app_logger
from ...models.mcp import (
    McpPromptSummary,
    McpResourceSummary,
    McpToolSummary,
    McpValidateResponse,
    McpValidateToolResponse,
)

logger = get_app_logger(__name__)


async def validate_mcp_server(
    server_type: str,
    url: str,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
) -> McpValidateResponse:
    """Connect to an MCP server, initialize, and list tools/prompts/resources."""
    try:
        from mcp.client.session import ClientSession
        from mcp.client.sse import sse_client
        from mcp.client.streamable_http import streamable_http_client

        if server_type == "sse":
            async with sse_client(url, headers=headers, timeout=timeout) as (
                read_stream,
                write_stream,
            ):
                return await _query_capabilities(
                    ClientSession, read_stream, write_stream
                )
        else:
            # HTTP (streamable HTTP)
            http_client = httpx.AsyncClient(
                headers=headers or {},
                timeout=httpx.Timeout(timeout, read=timeout * 5),
                follow_redirects=True,
            )
            async with http_client:
                async with streamable_http_client(
                    url, http_client=http_client
                ) as (read_stream, write_stream, _get_session_id):
                    return await _query_capabilities(
                        ClientSession, read_stream, write_stream
                    )
    except BaseException as e:
        error_msg = _extract_error(e)
        logger.warning("MCP validate failed for {} {}: {}", server_type, url, error_msg)
        return McpValidateResponse(success=False, error=error_msg)


def _extract_error(exc: BaseException) -> str:
    """Unwrap ExceptionGroup / BaseExceptionGroup to surface the real error."""
    if isinstance(exc, BaseExceptionGroup):
        leaves: list[BaseException] = []
        for sub in exc.exceptions:
            leaves.append(sub)
        if len(leaves) == 1:
            return _extract_error(leaves[0])
        return "; ".join(_extract_error(e) for e in leaves)
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}: {exc.response.text or exc.response.reason_phrase}"
    return str(exc)


async def _query_capabilities(
    session_cls: Any,
    read_stream: Any,
    write_stream: Any,
) -> McpValidateResponse:
    """Run initialize + list operations on an open MCP session."""
    async with session_cls(read_stream, write_stream) as session:
        init_result = await session.initialize()

        server_name = None
        server_version = None
        if init_result and getattr(init_result, "serverInfo", None):
            server_name = init_result.serverInfo.name
            server_version = init_result.serverInfo.version

        tools: list[McpToolSummary] = []
        prompts: list[McpPromptSummary] = []
        resources: list[McpResourceSummary] = []

        # List tools
        try:
            tools_result = await session.list_tools()
            tools = [
                McpToolSummary(
                    name=t.name,
                    description=getattr(t, "description", None),
                    input_schema=(
                        t.inputSchema if hasattr(t, "inputSchema") else None
                    ),
                )
                for t in tools_result.tools
            ]
        except Exception as e:
            logger.debug("list_tools not supported: {}", e)

        # List prompts
        try:
            prompts_result = await session.list_prompts()
            prompts = [
                McpPromptSummary(
                    name=p.name,
                    description=getattr(p, "description", None),
                    arguments=(
                        [a.model_dump() for a in p.arguments]
                        if getattr(p, "arguments", None)
                        else None
                    ),
                )
                for p in prompts_result.prompts
            ]
        except Exception as e:
            logger.debug("list_prompts not supported: {}", e)

        # List resources
        try:
            resources_result = await session.list_resources()
            resources = [
                McpResourceSummary(
                    name=r.name,
                    uri=str(r.uri),
                    description=getattr(r, "description", None),
                    mime_type=getattr(r, "mimeType", None),
                )
                for r in resources_result.resources
            ]
        except Exception as e:
            logger.debug("list_resources not supported: {}", e)

        return McpValidateResponse(
            success=True,
            server_name=server_name,
            server_version=server_version,
            tools=tools,
            prompts=prompts,
            resources=resources,
        )


async def test_mcp_tool(
    server_type: str,
    url: str,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
    tool_name: str = "",
    tool_arguments: dict[str, Any] | None = None,
) -> McpValidateToolResponse:
    """Connect to an MCP server and call a specific tool."""
    try:
        from mcp.client.session import ClientSession
        from mcp.client.sse import sse_client
        from mcp.client.streamable_http import streamable_http_client

        if server_type == "sse":
            async with sse_client(url, headers=headers, timeout=timeout) as (
                read_stream,
                write_stream,
            ):
                return await _call_tool(
                    ClientSession, read_stream, write_stream, tool_name, tool_arguments
                )
        else:
            http_client = httpx.AsyncClient(
                headers=headers or {},
                timeout=httpx.Timeout(timeout, read=timeout * 5),
                follow_redirects=True,
            )
            async with http_client:
                async with streamable_http_client(
                    url, http_client=http_client
                ) as (read_stream, write_stream, _get_session_id):
                    return await _call_tool(
                        ClientSession,
                        read_stream,
                        write_stream,
                        tool_name,
                        tool_arguments,
                    )
    except BaseException as e:
        error_msg = _extract_error(e)
        logger.warning("MCP tool test failed: {}", error_msg)
        return McpValidateToolResponse(success=False, error=error_msg)


def _format_text(text: str) -> str:
    """Try to pretty-format text as JSON. Handles both JSON strings and Python repr."""
    import ast
    import json as _json

    stripped = text.strip()
    # Try JSON first
    if (stripped.startswith("{") and stripped.endswith("}")) or (
        stripped.startswith("[") and stripped.endswith("]")
    ):
        try:
            return _json.dumps(_json.loads(stripped), indent=2, ensure_ascii=False)
        except (ValueError, TypeError):
            pass
        # Try Python literal (single quotes, None, True, False)
        try:
            obj = ast.literal_eval(stripped)
            return _json.dumps(obj, indent=2, ensure_ascii=False, default=str)
        except (ValueError, SyntaxError):
            pass
    return text


async def _call_tool(
    session_cls: Any,
    read_stream: Any,
    write_stream: Any,
    tool_name: str,
    tool_arguments: dict[str, Any] | None,
) -> McpValidateToolResponse:
    """Initialize session and call a tool."""
    import json as _json

    async with session_cls(read_stream, write_stream) as session:
        await session.initialize()
        result = await session.call_tool(tool_name, tool_arguments or {})

        content = []
        for item in result.content:
            block = (
                item.model_dump()
                if hasattr(item, "model_dump")
                else {"type": "text", "text": str(item)}
            )
            # Format text content
            if block.get("type") == "text":
                text_val = block.get("text")
                if isinstance(text_val, str):
                    block["text"] = _format_text(text_val)
                elif isinstance(text_val, (dict, list)):
                    # model_dump() may produce a dict/list in text field
                    block["text"] = _json.dumps(
                        text_val, indent=2, ensure_ascii=False, default=str
                    )
            content.append(block)

        return McpValidateToolResponse(
            success=not result.isError if hasattr(result, "isError") else True,
            content=content,
            is_error=bool(getattr(result, "isError", False)),
        )
