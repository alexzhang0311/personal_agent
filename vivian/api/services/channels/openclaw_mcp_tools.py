"""
In-process MCP server providing OpenClaw delegation tools for the Claude agent.

Uses Claude Agent SDK custom tools API: @tool decorator + create_sdk_mcp_server().
Each tool calls OpenClawBridge directly (no HTTP, no auth).
"""
from __future__ import annotations

import os

from claude_agent_sdk import create_sdk_mcp_server, tool

from .openclaw_bridge import get_bridge


def _build_prompt(task: str, context: str, file_paths: list[str]) -> str:
    """Build the full prompt text including optional file contents."""
    parts = [task]
    if context:
        parts.append(f"\n\nAdditional context:\n{context}")
    if file_paths:
        for fp in file_paths:
            fp = os.path.expanduser(fp)
            if os.path.isfile(fp):
                try:
                    with open(fp, "r", errors="replace") as f:
                        content = f.read(100_000)  # cap at 100KB per file
                    parts.append(f"\n\n--- File: {fp} ---\n{content}")
                except Exception:
                    parts.append(f"\n\n--- File: {fp} (read error) ---")
            else:
                parts.append(f"\n\n--- File: {fp} (not found) ---")
    return "".join(parts)


def build_openclaw_mcp_server(username: str, agents_description: str):
    """Build an in-process MCP server with OpenClaw delegation tools scoped to username."""
    bridge = get_bridge(username)
    if not bridge or not bridge.is_connected:
        return None

    config = bridge.config

    @tool(
        "delegate_to_openclaw",
        (
            "Delegate a task to an OpenClaw-managed specialist agent.\n"
            "\n"
            f"Available agents:\n{agents_description}\n"
            "\n"
            "Each call is one delegation turn. You may call again with follow-up "
            "instructions if needed. Max turns are enforced by the system.\n"
            "\n"
            "Use this when you need specialist capabilities that are managed by "
            "the OpenClaw gateway — e.g., code review, data analysis, or domain-specific tasks."
        ),
        {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "Task description for the specialist agent",
                },
                "agent_id": {
                    "type": "string",
                    "description": "Target agent ID. Omit to use the default agent.",
                },
                "context": {
                    "type": "string",
                    "description": "Additional context to include with the task (optional)",
                },
                "file_paths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "File paths whose contents should be included (optional)",
                },
                "timeout_seconds": {
                    "type": "number",
                    "description": "Override the default timeout in seconds (optional)",
                },
            },
            "required": ["task"],
        },
    )
    async def delegate_to_openclaw(args):
        current_bridge = get_bridge(username)
        if not current_bridge or not current_bridge.is_connected:
            return {
                "content": [{"type": "text", "text": "Error: OpenClaw bridge is not connected."}],
                "is_error": True,
            }

        agent_id = args.get("agent_id") or config.default_agent
        task = args["task"]
        context = args.get("context", "")
        file_paths = args.get("file_paths", [])
        timeout = int(args.get("timeout_seconds") or config.timeout_seconds)

        full_text = _build_prompt(task, context, file_paths)

        try:
            result = await current_bridge.send_and_wait(agent_id, full_text, timeout)
            return {"content": [{"type": "text", "text": result}]}
        except TimeoutError:
            return {
                "content": [{"type": "text", "text": f"Delegation timed out after {timeout}s. The agent may still be processing."}],
                "is_error": True,
            }
        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"Delegation failed: {e}"}],
                "is_error": True,
            }

    return create_sdk_mcp_server(
        name="vivian_openclaw",
        version="1.0.0",
        tools=[delegate_to_openclaw],
    )
