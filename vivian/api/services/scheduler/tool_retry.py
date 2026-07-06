"""
Tool retry executor — direct MCP client calls, bypassing the LLM.

Interface matches builtin_tasks.py:
    async def execute_tool_retry(config, username, cwd, emit, cancelled) -> dict
    Returns: {"is_error": bool, "result": str, "duration_ms": int, "attempts": int}

Event types emitted:
    tool_retry_attempt   — {attempt, tool_name, max_retries, error}
    tool_retry_success   — {attempt, tool_name, result}
    tool_retry_exhausted — {attempts, tool_name, last_error}
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from ...middleware.logging import get_app_logger
from ...models.scheduler import ToolRetryConfig
from ..mcp.config_manager import McpConfigManager

logger = get_app_logger(__name__)


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


def resolve_mcp_tool(
    full_tool_name: str,
    known_servers: list[str],
) -> tuple[str, str]:
    """Parse an MCP tool name into (server_name, bare_tool_name).

    The full name format is: mcp__{server_name}__{tool_name}
    Server names may contain underscores, so we match against known server
    names using longest-match-first to resolve ambiguity.

    Raises ValueError if no matching server is found.
    """
    prefix = "mcp__"
    if not full_tool_name.startswith(prefix):
        raise ValueError(f"Not an MCP tool name: {full_tool_name}")

    remainder = full_tool_name[len(prefix):]  # e.g. "slack__send_message"

    # Sort by length descending for longest-match-first
    for server in sorted(known_servers, key=len, reverse=True):
        separator = f"{server}__"
        if remainder.startswith(separator):
            bare_tool = remainder[len(separator):]
            if bare_tool:
                return (server, bare_tool)

    raise ValueError(
        f"Cannot resolve MCP server from tool name '{full_tool_name}'. "
        f"Known servers: {known_servers}"
    )


async def _call_mcp_tool(
    server_type: str,
    url: str,
    headers: dict[str, str] | None,
    tool_name: str,
    tool_input: dict,
    timeout: float = 30.0,
) -> tuple[bool, str]:
    """Connect to an MCP server and call a tool. Returns (is_error, result_text)."""
    from mcp.client.session import ClientSession
    from mcp.client.sse import sse_client
    from mcp.client.streamable_http import streamable_http_client

    async def _do_call(read_stream: Any, write_stream: Any) -> tuple[bool, str]:
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, tool_input)

            # Extract text from result content
            texts = []
            for item in result.content:
                if hasattr(item, "text"):
                    texts.append(item.text)
                elif hasattr(item, "model_dump"):
                    texts.append(str(item.model_dump()))
                else:
                    texts.append(str(item))

            result_text = "\n".join(texts) if texts else "(no output)"
            is_error = bool(getattr(result, "isError", False))
            return (is_error, result_text)

    if server_type == "sse":
        async with sse_client(url, headers=headers, timeout=timeout) as (
            read_stream,
            write_stream,
        ):
            return await _do_call(read_stream, write_stream)
    else:
        http_client = httpx.AsyncClient(
            headers=headers or {},
            timeout=httpx.Timeout(timeout, read=timeout * 5),
            follow_redirects=True,
        )
        async with http_client:
            async with streamable_http_client(url, http_client=http_client) as (
                read_stream,
                write_stream,
                _get_session_id,
            ):
                return await _do_call(read_stream, write_stream)


async def execute_tool_retry(
    config: ToolRetryConfig,
    username: str,
    cwd: str,
    emit: Callable[[str, dict[str, Any]], Awaitable[None]],
    cancelled: asyncio.Event | None = None,
) -> dict:
    """Retry an MCP tool call with fixed intervals.

    Returns: {"is_error": bool, "result": str, "duration_ms": int, "attempts": int}
    """
    start = time.monotonic()

    # 1. Resolve MCP server from tool name
    mgr = McpConfigManager(username)
    all_servers = mgr.read_all_servers()  # [(name, config, level), ...]
    known_names = [name for name, _cfg, _lvl in all_servers]
    server_configs = {name: cfg for name, cfg, _lvl in all_servers}

    try:
        server_name, bare_tool_name = resolve_mcp_tool(config.tool_name, known_names)
    except ValueError as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        msg = f"Cannot resolve MCP server: {e}"
        await emit("tool_retry_exhausted", {
            "attempts": 0,
            "tool_name": config.tool_name,
            "last_error": msg,
        })
        return {"is_error": True, "result": msg, "duration_ms": elapsed_ms, "attempts": 0}

    srv_cfg = server_configs[server_name]
    server_type = srv_cfg.get("type", "http")
    server_url = srv_cfg.get("url", "")
    server_headers = srv_cfg.get("headers")

    if not server_url:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        msg = f"MCP server '{server_name}' has no URL configured"
        await emit("tool_retry_exhausted", {
            "attempts": 0,
            "tool_name": config.tool_name,
            "last_error": msg,
        })
        return {"is_error": True, "result": msg, "duration_ms": elapsed_ms, "attempts": 0}

    # 2. Retry loop
    last_error = config.original_error or "initial failure"

    for attempt in range(1, config.max_retries + 1):
        # Check cancellation before each attempt
        if cancelled is not None and cancelled.is_set():
            elapsed_ms = int((time.monotonic() - start) * 1000)
            return {
                "is_error": True,
                "result": "Cancelled",
                "duration_ms": elapsed_ms,
                "attempts": attempt - 1,
            }

        await emit("tool_retry_attempt", {
            "attempt": attempt,
            "tool_name": config.tool_name,
            "max_retries": config.max_retries,
            "error": last_error,
        })

        try:
            is_error, result_text = await _call_mcp_tool(
                server_type=server_type,
                url=server_url,
                headers=server_headers,
                tool_name=bare_tool_name,
                tool_input=config.tool_input,
            )

            if not is_error:
                # Success
                elapsed_ms = int((time.monotonic() - start) * 1000)
                await emit("tool_retry_success", {
                    "attempt": attempt,
                    "tool_name": config.tool_name,
                    "result": result_text[:500],
                })

                from ...utils.callback import invoke_retry_callbacks
                await invoke_retry_callbacks(
                    tool_name=config.tool_name,
                    tool_input=config.tool_input,
                    tool_output=result_text,
                    session_id=config.session_id,
                    username=username,
                )

                return {
                    "is_error": False,
                    "result": result_text,
                    "duration_ms": elapsed_ms,
                    "attempts": attempt,
                }

            # Tool returned is_error — treat as retryable failure
            last_error = result_text

        except BaseException as e:
            last_error = _extract_error(e)

            # If tool not found on server, abort early
            if "tool" in last_error.lower() and "not found" in last_error.lower():
                elapsed_ms = int((time.monotonic() - start) * 1000)
                await emit("tool_retry_exhausted", {
                    "attempts": attempt,
                    "tool_name": config.tool_name,
                    "last_error": last_error,
                })

                from ...utils.callback import invoke_retry_callbacks
                await invoke_retry_callbacks(
                    tool_name=config.tool_name,
                    tool_input=config.tool_input,
                    tool_output=last_error,
                    session_id=config.session_id,
                    username=username,
                )

                return {
                    "is_error": True,
                    "result": last_error,
                    "duration_ms": elapsed_ms,
                    "attempts": attempt,
                }

        # Sleep before next attempt, racing against cancellation
        if attempt < config.max_retries:
            if cancelled is not None:
                cancel_task = asyncio.create_task(cancelled.wait())
                sleep_task = asyncio.create_task(asyncio.sleep(config.interval_seconds))
                done, pending = await asyncio.wait(
                    [cancel_task, sleep_task], return_when=asyncio.FIRST_COMPLETED,
                )
                for t in pending:
                    t.cancel()
                    try:
                        await t
                    except (asyncio.CancelledError, Exception):
                        pass
                if cancel_task in done:
                    elapsed_ms = int((time.monotonic() - start) * 1000)
                    return {
                        "is_error": True,
                        "result": "Cancelled",
                        "duration_ms": elapsed_ms,
                        "attempts": attempt,
                    }
            else:
                await asyncio.sleep(config.interval_seconds)

    # 3. Exhausted all retries
    elapsed_ms = int((time.monotonic() - start) * 1000)
    await emit("tool_retry_exhausted", {
        "attempts": config.max_retries,
        "tool_name": config.tool_name,
        "last_error": last_error,
    })

    from ...utils.callback import invoke_retry_callbacks
    await invoke_retry_callbacks(
        tool_name=config.tool_name,
        tool_input=config.tool_input,
        tool_output=last_error,
        session_id=config.session_id,
        username=username,
    )

    return {
        "is_error": True,
        "result": f"Exhausted {config.max_retries} retries. Last error: {last_error}",
        "duration_ms": elapsed_ms,
        "attempts": config.max_retries,
    }
