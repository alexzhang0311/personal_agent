from __future__ import annotations

import json
import logging

import httpx

logger = logging.getLogger(__name__)


async def get_user_info_via_mcp(
    url: str,
    username: str,
    tool_name: str = "get_user_info",
    headers: dict | None = None,
    timeout: int = 10,
) -> dict[str, str]:
    """Call an MCP server over Streamable HTTP to retrieve user info.

    Performs the full MCP handshake:
      initialize -> notifications/initialized -> tools/call
    Returns flat dict of user info fields.
    """
    req_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if headers:
        req_headers.update(headers)

    session_id: str | None = None

    async with httpx.AsyncClient(timeout=timeout) as client:
        # 1. Initialize
        init_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "vivian-plugin", "version": "1.0.0"},
            },
        }
        resp = await client.post(url, json=init_payload, headers=req_headers)
        resp.raise_for_status()

        # Capture Mcp-Session-Id
        if "mcp-session-id" in resp.headers:
            session_id = resp.headers["mcp-session-id"]

        # Parse SSE or JSON response
        init_result = _parse_response(resp)
        if "error" in init_result:
            raise RuntimeError(f"MCP initialize error: {init_result['error']}")

        # 2. Send initialized notification
        if session_id:
            req_headers["Mcp-Session-Id"] = session_id

        notif_payload = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {},
        }
        await client.post(url, json=notif_payload, headers=req_headers)

        # 3. Call tool
        call_payload = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": {"username": username},
            },
        }
        resp = await client.post(url, json=call_payload, headers=req_headers)
        resp.raise_for_status()
        call_result = _parse_response(resp)

        if "error" in call_result:
            raise RuntimeError(f"MCP tools/call error: {call_result['error']}")

        # Extract text content from result
        result = call_result.get("result", {})
        content_list = result.get("content", [])
        if not content_list:
            raise RuntimeError("MCP tools/call returned empty content")

        text = content_list[0].get("text", "")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # If not JSON, return as single field
            return {"info": text}


def _parse_response(resp: httpx.Response) -> dict:
    """Parse MCP response - handles both JSON and SSE formats."""
    content_type = resp.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        # Parse SSE: find the last JSON-RPC message
        for line in resp.text.split("\n"):
            line = line.strip()
            if line.startswith("data:"):
                data_str = line[5:].strip()
                if data_str:
                    try:
                        return json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
        raise RuntimeError("No valid JSON-RPC message in SSE response")
    else:
        return resp.json()
