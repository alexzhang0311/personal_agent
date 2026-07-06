"""Dry-run hook test runner.

Executes a single hook handler with sample JSON input and captures
exit code, stdout, stderr, and duration.  Also supports testing
built-in hooks by calling their Python callback directly.
"""

from __future__ import annotations

import asyncio
import json
import time

from ...middleware.logging import get_app_logger
from ...models.hooks import BuiltInHookTestResponse, HookHandler, HookTestResponse

logger = get_app_logger(__name__)


async def test_hook(
    event_type: str,
    handler: HookHandler,
    input_json: dict,
    cwd: str | None = None,
) -> HookTestResponse:
    """Execute a hook handler in a subprocess with sample input.

    Only ``type=command`` is supported for dry-run testing.  HTTP, prompt,
    and agent hooks are validated structurally but not executed.
    """
    if handler.type != "command":
        return HookTestResponse(
            exit_code=-1,
            stdout="",
            stderr=f"Dry-run is only supported for command hooks (got type={handler.type!r})",
            duration_ms=0,
        )

    if not handler.command:
        return HookTestResponse(
            exit_code=-1,
            stdout="",
            stderr="No command specified",
            duration_ms=0,
        )

    env_vars = {
        "CLAUDE_HOOK_EVENT_NAME": event_type,
    }

    stdin_data = json.dumps(input_json).encode()
    timeout = handler.timeout or 30

    start = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_shell(
            handler.command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env={**dict(__import__("os").environ), **env_vars},
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=stdin_data),
            timeout=timeout,
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        return HookTestResponse(
            exit_code=proc.returncode or 0,
            stdout=stdout.decode(errors="replace")[:10_000],
            stderr=stderr.decode(errors="replace")[:10_000],
            duration_ms=elapsed_ms,
        )
    except asyncio.TimeoutError:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return HookTestResponse(
            exit_code=-1,
            stdout="",
            stderr=f"Hook timed out after {timeout}s",
            duration_ms=elapsed_ms,
        )
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return HookTestResponse(
            exit_code=-1,
            stdout="",
            stderr=str(exc),
            duration_ms=elapsed_ms,
        )


async def test_builtin_hook(
    hook_id: str,
    event_type: str,
    input_json: dict,
) -> BuiltInHookTestResponse:
    """Call a built-in hook's callback directly with sample input."""
    from .registry import get_hook_by_id

    meta = get_hook_by_id(hook_id)
    if meta is None:
        return BuiltInHookTestResponse(
            hook_id=hook_id,
            duration_ms=0,
            error=f"Built-in hook '{hook_id}' not found",
        )

    # Inject hook_event_name into input
    test_input = {**input_json, "hook_event_name": event_type}

    start = time.monotonic()
    try:
        result = await meta.callback(test_input, None, None)
        elapsed_ms = int((time.monotonic() - start) * 1000)

        # Extract decision from hookSpecificOutput
        hso = result.get("hookSpecificOutput", {}) if isinstance(result, dict) else {}
        decision = hso.get("permissionDecision")
        reason = hso.get("permissionDecisionReason")

        return BuiltInHookTestResponse(
            hook_id=hook_id,
            decision=decision,
            reason=reason,
            output=result if isinstance(result, dict) else {},
            duration_ms=elapsed_ms,
        )
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return BuiltInHookTestResponse(
            hook_id=hook_id,
            duration_ms=elapsed_ms,
            error=str(exc),
        )
