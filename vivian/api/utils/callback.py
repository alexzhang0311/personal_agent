"""Callback utility for tool retry completion notifications."""
from __future__ import annotations

import asyncio
import datetime
import json
import os

from ..middleware.logging import get_app_logger

logger = get_app_logger(__name__)


def _default_retry_callback(
    tool_name: str,
    tool_input: dict,
    tool_output: str,
    session_id: str,
) -> None:
    """Default internal callback — logs the retry outcome."""
    logger.info(
        "Tool retry completed: tool={} session={} output_preview={}",
        tool_name,
        session_id,
        tool_output[:200],
    )


async def _wecom_retry_callback(
    tool_name: str,
    tool_input: dict,
    tool_output: str,
    session_id: str,
    username: str,
    config: dict,
) -> None:
    """Send a WeCom enterprise notification for a tool retry result."""
    import httpx

    api_url = config.get("api_url", "")
    key = config.get("key", "")
    service_name = config.get("service_name", "")

    if not api_url or not key or not username:
        logger.warning("WeCom callback misconfigured — skipping (url={}, username={})", api_url, username)
        return

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    content = (
        f"[Tool Retry Result]\n"
        f"Tool: {tool_name}\n"
        f"Session: {session_id}\n"
        f"Output: {tool_output[:500]}"
        f"\n\n---\n"
        f"Sent by: `{username}` via Agent\n"
        f"Time: {now}"
    )

    payload = {
        "keyid": key,
        "type": "text",
        "content": content,
        "serviceName": service_name,
        "userName": username,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(api_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            if data.get("Code") != 0:
                logger.warning("WeCom send to {} failed: {}", username, data)
        except Exception as exc:
            logger.warning("WeCom send to {} error: {}", username, exc)


async def invoke_retry_callbacks(
    tool_name: str,
    tool_input: dict,
    tool_output: str,
    session_id: str,
    username: str = "",
) -> None:
    """Invoke all retry callbacks (internal + optional external script/wecom).

    All exceptions are caught internally — callbacks never crash the caller.
    """
    # 1. Always call the internal callback
    try:
        _default_retry_callback(tool_name, tool_input, tool_output, session_id)
    except Exception as exc:
        logger.warning("Default retry callback failed: {}", exc)

    # 2. Determine callback type from runtime config
    try:
        from ..services.user_store import get_user_store

        runtime = get_user_store().get_runtime_config()
        callback_type = runtime.get("retry_callback_type", "none")

        if callback_type == "script":
            await _invoke_script_callback(runtime, tool_name, tool_input, tool_output, session_id)
        elif callback_type == "wecom":
            wecom_cfg = runtime.get("retry_callback_wecom")
            if wecom_cfg:
                await _wecom_retry_callback(tool_name, tool_input, tool_output, session_id, username, wecom_cfg)
            else:
                logger.warning("WeCom callback type selected but no config found")
    except Exception as exc:
        logger.warning("Retry callback dispatch failed: {}", exc)


async def _invoke_script_callback(
    runtime: dict,
    tool_name: str,
    tool_input: dict,
    tool_output: str,
    session_id: str,
) -> None:
    """Run an external script callback."""
    script_path = runtime.get("retry_callback_script")
    if not script_path:
        return

    if not os.path.isfile(script_path):
        logger.warning("Retry callback script not found: {}", script_path)
        return

    if not os.access(script_path, os.X_OK):
        logger.warning("Retry callback script not executable: {}", script_path)
        return

    proc = await asyncio.create_subprocess_exec(
        script_path,
        tool_name,
        json.dumps(tool_input, default=str),
        tool_output,
        session_id,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
    if proc.returncode != 0:
        logger.warning(
            "Retry callback script exited {}: {}",
            proc.returncode,
            stderr.decode("utf-8", errors="replace")[:500],
        )
