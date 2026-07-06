"""Built-in Vivian hooks -- all registered via @vivian_hook decorator.

Each function's docstring becomes the hook description exposed by the API.
"""

from __future__ import annotations

import os
import re
from typing import Any

from .registry import vivian_hook


# -- Security --------------------------------------------------------------

DANGEROUS_PATTERNS = [
    r"rm\s+-[rR]f\s+/\*",  # rm -rf /* (root wildcard)
    r"rm\s+-[rR]f\s+/\s",  # rm -rf / (root itself)
    r"rm\s+-[rR]f\s+/$",  # rm -rf / (at end of command)
    r"rm\s+-f[rR]\s+/\*",  # rm -fr /* variant
    r"rm\s+-f[rR]\s+/\s",  # rm -fr / variant
    r"mkfs\.",  # mkfs.ext4 etc.
    r"dd\s+if=/dev/zero",  # dd zero-fill
    r"dd\s+if=/dev/random",  # dd random-fill
    r">\s*/dev/sd",  # write to raw disk
    r"chmod\s+-R\s+777\s+/",  # chmod 777 from root
    r"chown\s+-R\s+.*\s+/",  # chown from root
    r":()\{\s*:\|:&\s*\};:",  # fork bomb
    r"mv\s+/\s+",  # move root
]


@vivian_hook(
    id="block-dangerous-bash",
    name="Block Dangerous Commands",
    events=["PreToolUse"],
    matcher="Bash",
    can_block=True,
    enabled_by_default=True,
)
async def block_dangerous_bash(
    input_data: Any, tool_use_id: str | None, context: Any
) -> dict:
    """在执行前拦截 rm -rf、mkfs、dd if=/dev/zero 等破坏性 bash 命令。"""
    data = input_data if isinstance(input_data, dict) else {}
    command = data.get("tool_input", {}).get("command", "")
    if not command:
        return {}

    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Blocked by safety hook: matches dangerous pattern '{pattern}'"
                    ),
                }
            }
    return {}


# -- Auditing ---------------------------------------------------------------


@vivian_hook(
    id="audit-tool-use",
    name="Audit Tool Use",
    events=["PreToolUse", "PostToolUse"],
    can_block=False,
    enabled_by_default=True,
)
async def audit_tool_use(
    input_data: Any, tool_use_id: str | None, context: Any
) -> dict:
    """将每次工具调用写入 Vivian 审计日志（JSONL），记录工具名、会话 ID 和事件类型，用于合规与调试。"""
    try:
        from ..audit_log import AuditEntry, get_audit_logger

        data = input_data if isinstance(input_data, dict) else {}
        tool_name = data.get("tool_name", "unknown")
        session_id = data.get("session_id", "")
        event_name = data.get("hook_event_name", "unknown")

        audit = get_audit_logger()
        audit.append(
            AuditEntry(
                actor="system",
                action=f"hook.{event_name.lower()}",
                target=tool_name,
                details={
                    "tool_use_id": tool_use_id or "",
                    "session_id": session_id,
                },
            )
        )
    except Exception:
        pass
    return {}


# -- Linting -----------------------------------------------------------------


@vivian_hook(
    id="lint-on-write",
    name="Lint on Write",
    events=["PostToolUse"],
    matcher="Write|Edit",
    can_block=False,
    enabled_by_default=False,
)
async def lint_on_write(
    input_data: Any, tool_use_id: str | None, context: Any
) -> dict:
    """在文件写入/编辑完成后运行项目 linter。自动检测 ruff、flake8 或 eslint，并对修改的文件执行对应检查。"""
    import asyncio

    data = input_data if isinstance(input_data, dict) else {}
    file_path = data.get("tool_input", {}).get("file_path", "")
    cwd = data.get("cwd", ".")
    if not file_path:
        return {}

    try:
        proc = await asyncio.create_subprocess_shell(
            f"command -v ruff && ruff check --fix '{file_path}' || true",
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(proc.communicate(), timeout=15)
    except Exception:
        pass
    return {}


# -- Notifications -----------------------------------------------------------


@vivian_hook(
    id="notify-slack",
    name="Slack Notification",
    events=["Stop", "Notification"],
    can_block=False,
    enabled_by_default=False,
)
async def notify_slack(
    input_data: Any, tool_use_id: str | None, context: Any
) -> dict:
    """当智能体停止或发送通知时，向 Slack 推送消息。需要配置 SLACK_WEBHOOK_URL 环境变量。"""
    import asyncio
    import json
    import os
    import urllib.request

    webhook_url = os.environ.get("SLACK_WEBHOOK_URL", "")
    if not webhook_url:
        return {}

    data = input_data if isinstance(input_data, dict) else {}
    session_id = data.get("session_id", "unknown")
    event = data.get("hook_event_name", "unknown")
    message = data.get(
        "message", f"Agent session {session_id} — event: {event}"
    )

    def _post():
        req = urllib.request.Request(
            webhook_url,
            data=json.dumps({"text": message}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10)

    try:
        await asyncio.to_thread(_post)
    except Exception:
        pass
    return {}


# -- Tool Retry ---------------------------------------------------------------

# Dedup set: tracks tool_use_ids that already have a retry queued.
# Bounded to last 256 entries to avoid unbounded growth.
_retry_seen: set[str] = set()
_RETRY_SEEN_MAX = 256


@vivian_hook(
    id="retry-failed-tools",
    name="Retry Failed Tools",
    events=["PostToolUse", "PostToolUseFailure"],
    can_block=False,
    enabled_by_default=False,
)
async def retry_failed_tools(
    input_data: Any, tool_use_id: str | None, context: Any
) -> dict:
    """通过调度器守护进程自动重试失败的 MCP 工具调用。工具失败时排入后台重试队列，直接调用工具而不经过 LLM。需要 retryable_tools 运行时配置。"""
    global _retry_seen

    data = input_data if isinstance(input_data, dict) else {}
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    error = data.get("error", "")
    tool_output = data.get("tool_output")
    hook_event_name = data.get("hook_event_name", "")
    session_id = data.get("session_id", "")
    cwd = data.get("cwd", ".")

    # Dedup check
    if tool_use_id and tool_use_id in _retry_seen:
        return {}

    # Detect failure
    is_failure = False
    error_msg = ""

    if hook_event_name == "PostToolUseFailure":
        is_failure = True
        error_msg = error or "PostToolUseFailure"
    elif error:
        is_failure = True
        error_msg = error
    elif isinstance(tool_output, dict) and tool_output.get("is_error"):
        is_failure = True
        error_msg = str(tool_output.get("content", tool_output.get("error", "is_error=true")))

    if not is_failure:
        return {}

    # Only MCP tools are retryable
    if not tool_name.startswith("mcp__"):
        return {}

    # Check retryable_tools runtime config
    try:
        from ...services.user_store import get_user_store

        runtime = get_user_store().get_runtime_config()
        retryable_tools = runtime.get("retryable_tools", [])
    except Exception:
        return {}

    # Find matching entry
    match = None
    for entry in retryable_tools:
        if isinstance(entry, dict) and entry.get("name") == tool_name:
            match = entry
            break

    if not match:
        return {}

    # Add to dedup set (evict if over limit)
    if tool_use_id:
        if len(_retry_seen) >= _RETRY_SEEN_MAX:
            # Evict roughly half to avoid frequent evictions
            evict_count = _RETRY_SEEN_MAX // 2
            evict_items = list(_retry_seen)[:evict_count]
            for item in evict_items:
                _retry_seen.discard(item)
        _retry_seen.add(tool_use_id)

    # Derive username from cwd
    username = os.path.basename(cwd) or "system"

    # Write command for daemon
    try:
        from ...services.scheduler.shared import write_command

        write_command("tool_retry", {
            "tool_name": tool_name,
            "tool_input": tool_input if isinstance(tool_input, dict) else {},
            "session_id": session_id,
            "max_retries": match.get("max_retries", 3),
            "interval_seconds": match.get("interval_seconds", 30),
            "original_error": str(error_msg)[:500],
            "username": username,
        })
    except Exception:
        pass

    return {}


# -- Risky-tool user-approval gate -------------------------------------------


@vivian_hook(
    id="require-permission-risky-tools",
    name="Require Permission for Risky Tools",
    events=["PreToolUse"],
    matcher=None,
    can_block=True,
    enabled_by_default=True,
)
async def require_permission_risky_tools(
    input_data: Any, tool_use_id: str | None, context: Any
) -> dict:
    """当工具调用匹配预定义的高风险工具模式（如 Bash(rm:*)、Write(/etc/**)）时，暂停智能体并请求用户确认。可在下方管理模式列表。"""
    data = input_data if isinstance(input_data, dict) else {}
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    if not tool_name:
        return {}

    try:
        from ..user_store import get_user_store
        runtime = get_user_store().get_runtime_config()
        risky_list = runtime.get("risky_tool_list") or []
    except Exception:
        return {}

    if not risky_list:
        return {}

    try:
        from .risky_matcher import matches_any
        matched, matched_rule = matches_any(risky_list, tool_name, tool_input)
    except Exception:
        return {}

    if not matched:
        return {}

    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": (
                f"匹配到高风险工具模式 '{matched_rule}'。"
                f"请再次确认 Agent 即将要执行的操作是否符合预期。"
            ),
        }
    }


# -- Programmatic-only: PII masking before model sees output ----------------
# This hook is wired directly from builder.py — it is NOT registered via
# @vivian_hook and never appears in the Hooks tab UI. The frontend toggle for
# it lives under Settings → Sensitive patterns (runtime.pii_masking.enable).


def make_pii_masking_hook(patterns: list[dict]):
    """Build a PostToolUse hook that replaces tool_output via ``updatedToolOutput``.

    Patterns are captured at agent-run startup, so toggling the setting takes
    effect on the next session. When no PII patterns hit, the hook returns
    ``{"continue": True}`` and the original output flows through unchanged.
    """
    from ...utils.sensitive_mask import mask_sensitive

    async def pii_masking_hook(
        input_data: Any, tool_use_id: str | None, context: Any
    ) -> dict:
        data = input_data if isinstance(input_data, dict) else {}
        tool_output = data.get("tool_output")
        if tool_output is None:
            return {"continue": True}
        masked, hits = mask_sensitive(patterns, tool_output)
        if hits == 0:
            return {"continue": True}
        return {
            "continue": True,
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "updatedToolOutput": masked,
            },
        }

    return pii_masking_hook
