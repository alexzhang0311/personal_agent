"""Build the hooks payload for a Vivian agent run.

Key insight: the Claude Agent SDK CLI auto-reads file-based hooks from
``.claude/settings.json`` and ``.claude/settings.local.json`` when
``setting_sources=["user", "project"]`` is set.  However, in practice
the CLI may not reliably execute file-based command hooks (e.g. when the
settings file contains non-standard keys like ``env``).

To guarantee hook execution, this module now:
1. Ensures admin-enforced hooks are present in ``.claude/settings.json``
2. Reads all configured command hooks from both settings files
3. Wraps them as in-process Python callbacks that execute the commands
4. Injects built-in hooks from the registry based on user preferences
5. Returns Vivian-only in-process callbacks (logging)

This makes hook execution independent of CLI behavior.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any

from claude_agent_sdk.types import HookMatcher, SyncHookJSONOutput

from ...middleware.logging import get_app_logger
from ..user_store import get_user_store
from .callbacks import make_hook_execution_logger
from .config_manager import HookConfigManager

logger = get_app_logger(__name__)


def _make_command_hook_callback(
    command: str,
    timeout: int,
    cwd: str,
):
    """Create an in-process async callback that executes a command hook.

    The callback runs the command as a subprocess with the hook input as
    JSON on stdin.  Exit code 2 signals a block (continue=False).
    """

    async def callback(
        input_data: Any,
        tool_use_id: str,
        context: Any,
    ) -> SyncHookJSONOutput:
        start = time.monotonic()
        try:
            stdin_data = json.dumps(input_data if isinstance(input_data, dict) else {}).encode()

            import os
            env_vars = {
                **dict(os.environ),
                "CLAUDE_HOOK_EVENT_NAME": input_data.get("hook_event_name", "") if isinstance(input_data, dict) else "",
            }

            proc = await asyncio.create_subprocess_shell(
                command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env_vars,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=stdin_data),
                timeout=timeout,
            )
            elapsed_ms = int((time.monotonic() - start) * 1000)

            exit_code = proc.returncode or 0
            stdout_str = stdout.decode(errors="replace")[:10_000]
            stderr_str = stderr.decode(errors="replace")[:10_000]

            # Log execution
            _log_hook_execution(
                input_data, command, exit_code, elapsed_ms,
                stdout_str, stderr_str, cwd,
            )

            # Exit code 2 = block
            if exit_code == 2:
                # Try to parse JSON output for block reason
                reason = f"Blocked by hook: {command}"
                try:
                    output = json.loads(stdout_str.strip())
                    if isinstance(output, dict) and output.get("reason"):
                        reason = output["reason"]
                except (json.JSONDecodeError, ValueError):
                    # Script may output non-JSON or JSON with invalid escapes;
                    # try to extract reason with a regex fallback
                    import re
                    m = re.search(r'"reason"\s*:\s*"([^"]*(?:\\"[^"]*)*)"', stdout_str)
                    if m:
                        reason = m.group(1).replace('\\"', '"')
                    elif stdout_str.strip():
                        reason = stdout_str.strip()[:200]

                return SyncHookJSONOutput(
                    continue_=False,
                    decision="block",
                    reason=reason,
                )

            return SyncHookJSONOutput(continue_=True)

        except asyncio.TimeoutError:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("Hook command timed out after {}s: {}", timeout, command)
            _log_hook_execution(
                input_data, command, -1, elapsed_ms,
                "", f"Timed out after {timeout}s", cwd,
            )
            return SyncHookJSONOutput(continue_=True)

        except Exception as exc:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.warning("Hook command failed: {} — {}", command, exc)
            _log_hook_execution(
                input_data, command, -1, elapsed_ms,
                "", str(exc), cwd,
            )
            return SyncHookJSONOutput(continue_=True)

    return callback


def _log_hook_execution(
    input_data: Any,
    command: str,
    exit_code: int,
    duration_ms: int,
    stdout: str,
    stderr: str,
    cwd: str,
):
    """Record hook execution to the per-user log store."""
    try:
        from .log_store import get_hook_log_store
        from ...models.hooks import HookLogEntry
        from datetime import datetime, timezone

        data = input_data if isinstance(input_data, dict) else {}
        tool_name = data.get("tool_name")
        event_type = data.get("hook_event_name", "PreToolUse")

        entry = HookLogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            event_type=event_type,
            matcher=None,
            handler_type="command",
            exit_code=exit_code,
            duration_ms=duration_ms,
            tool_name=tool_name,
            error=stderr.strip() if exit_code != 0 and stderr.strip() else None,
        )

        # Derive username from cwd (workspace path is {work_dir}/{username})
        import os
        username = os.path.basename(cwd) or "system"

        store = get_hook_log_store()
        store.append(username, entry)
    except Exception as exc:
        logger.warning("Failed to log hook execution: {}", exc)


def _build_command_hooks(cwd: str) -> dict[str, list[HookMatcher]]:
    """Read configured hooks from settings files and convert command hooks
    into programmatic HookMatcher entries with in-process callbacks."""
    result: dict[str, list[HookMatcher]] = {}

    try:
        config_mgr = HookConfigManager(cwd)
        merged = config_mgr.read_merged()

        for event_type, entries in merged.items():
            for entry in entries:
                if not isinstance(entry, dict):
                    continue

                matcher = entry.get("matcher")
                hooks_list = entry.get("hooks", [])

                for handler in hooks_list:
                    if not isinstance(handler, dict):
                        continue

                    handler_type = handler.get("type", "command")
                    if handler_type != "command":
                        continue

                    command = handler.get("command")
                    if not command:
                        continue

                    timeout = handler.get("timeout", 30)

                    callback = _make_command_hook_callback(command, timeout, cwd)

                    hook_matcher = HookMatcher(
                        matcher=matcher,
                        hooks=[callback],
                    )

                    result.setdefault(event_type, []).append(hook_matcher)

    except Exception as exc:
        logger.warning("Failed to read command hooks from settings: {}", exc)

    return result


def _get_enabled_hook_ids(username: str) -> set[str]:
    """Determine which built-in hooks are enabled for a user.

    Sources (highest priority first):
    1. Admin-enforced hooks (always enabled)
    2. User per-hook preferences (stored in runtime config)
    3. Hook's enabled_by_default flag
    """
    from .registry import get_all_hooks

    runtime = get_user_store().get_runtime_config()
    admin_enforced = set(runtime.get("enforced_hook_ids", []))
    user_prefs = runtime.get("user_hook_prefs", {}).get(username, {})
    # user_prefs = { "hook-id": true/false, ... }

    enabled = set()
    for meta in get_all_hooks():
        if meta.id in admin_enforced:
            enabled.add(meta.id)
        elif meta.id in user_prefs:
            if user_prefs[meta.id]:
                enabled.add(meta.id)
        elif meta.enabled_by_default:
            enabled.add(meta.id)
    return enabled


def build_hooks(username: str, cwd: str, auth_method: str = "jwt") -> dict[str, list[HookMatcher]]:
    """Return programmatic hooks to inject into ``ClaudeAgentOptions.hooks``.

    Side-effect: ensures admin-enforced hooks are mirrored in
    ``{cwd}/.claude/settings.json``.
    """
    # Step 1: admin enforcement sync
    try:
        runtime = get_user_store().get_runtime_config()
        admin_hooks = runtime.get("hooks", {})
        if admin_hooks:
            config_mgr = HookConfigManager(cwd)
            config_mgr.ensure_admin_hooks(admin_hooks)
    except Exception as exc:
        logger.warning("Failed to enforce admin hooks for user '{}': {}", username, exc)

    # Step 2: read user-configured command hooks and convert to callbacks
    hooks = _build_command_hooks(cwd)

    # Step 3: built-in hooks from registry
    from . import built_in_hooks as _  # noqa: F401 — trigger registration
    from .registry import get_all_hooks

    enabled_ids = _get_enabled_hook_ids(username)

    for meta in get_all_hooks():
        if meta.id not in enabled_ids:
            continue
        for event in meta.events:
            hooks.setdefault(event, []).append(
                HookMatcher(matcher=meta.matcher, hooks=[meta.callback])
            )

    # Step 4: system callbacks (hook_execution_logger only)
    enable_file_canvas_reminder = auth_method == "jwt"
    hooks.setdefault("PostToolUse", []).append(
        HookMatcher(matcher=None, hooks=[make_hook_execution_logger(enable_file_canvas_reminder)]),
    )

    # Step 5: PII masking (programmatic-only — not exposed in the Hooks tab).
    # Replaces tool output via PostToolUseHookSpecificOutput.updatedToolOutput
    # before it reaches the model, when admin has enabled the toggle in
    # Settings → Sensitive patterns AND configured at least one pattern.
    try:
        runtime = get_user_store().get_runtime_config()
        pii_cfg = runtime.get("pii_masking") or {}
        if pii_cfg.get("enable") and pii_cfg.get("patterns"):
            from .built_in_hooks import make_pii_masking_hook

            hooks.setdefault("PostToolUse", []).append(
                HookMatcher(matcher=None, hooks=[make_pii_masking_hook(list(pii_cfg["patterns"]))]),
            )
    except Exception as exc:
        logger.warning("Failed to enable PII masking hook for user '{}': {}", username, exc)

    return hooks
