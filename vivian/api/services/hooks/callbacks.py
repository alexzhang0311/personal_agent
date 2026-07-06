"""In-process Python hook callbacks (Vivian-only, no subprocess overhead).

These callbacks are injected by ``build_hooks()`` at runtime and do NOT
appear in ``.claude/settings.json``.  They only fire when the agent is
run through Vivian, not when the user runs ``claude`` directly.

Note: audit_pre_tool and audit_post_tool have been replaced by the
``audit-tool-use`` built-in hook in ``built_in_hooks.py``.
"""

from __future__ import annotations

from typing import Any

from ...middleware.logging import get_app_logger

logger = get_app_logger(__name__)


_BASH_GENERATED_FILE_REMINDER = (
    "提醒：如果这次 Bash 命令读取、分析、转换、渲染、导出、创建或修改了任何需要在前端展示的文件，"
    "你必须调用 `mcp__vivian_File__FileCanvas` 工具传入这些文件的最终落盘路径，"
    "让 Vivian 注册文件并同步到前端 Canvas。"
    "即使只是读取了文件、并没有改写文件内容，只要这个文件需要出现在前端 Canvas，"
    "也仍然要调用 `mcp__vivian_File__FileCanvas` 注册它。"
    "如果涉及 xlsx、docx、pptx、pdf、html、图片或其他 `non-plain-text` 文件，"
    "无论是新建、转换生成，还是基于原文件修改后的最终结果，都应总是通过这个工具注册到 Canvas。"
    "这同样适用于仅被 Bash 读取或分析过的 `non-plain-text` 文件。"
    "这包括用户上传后又被 Bash 读取、修改、转换或处理的文档、表格、幻灯片、PDF、HTML、图片或其他文件。"
    "这条规则同样涵盖 Bash 通过 python、node 或 shell 子命令去读取已存在文件的场景"
    "——例如 `python script.py data.xlsx`、`node parse.js report.pdf`、`bash run.sh file.docx`，"
    "即使脚本只是读取并没有改写文件，也要把被读取的 `non-plain-text` 文件路径调用 FileCanvas 注册。"
    "如果同一批处理中涉及多个文件，可以一次性传入多个路径。"
    "只有当 Bash 没有处理任何需要展示给用户的文件时，才可以跳过。"
)


def make_hook_execution_logger(enable_file_canvas_reminder: bool = True):
    async def hook_execution_logger(
        input_data: Any,
        tool_use_id: str,
        context: Any,
    ) -> dict:
        """Record hook execution metadata for the web UI Logs tab.

        This is a lightweight post-tool callback that records timing data
        into the per-user hook log store. When enabled, it also injects a
        default reminder after every Bash tool call instructing the agent
        to register any generated or updated Canvas files via
        ``mcp__vivian_File__FileCanvas``.
        """
        data = input_data if isinstance(input_data, dict) else {}
        tool_name = data.get("tool_name", "unknown")

        try:
            from .log_store import get_hook_log_store
            from ...models.hooks import HookLogEntry
            from datetime import datetime, timezone

            entry = HookLogEntry(
                timestamp=datetime.now(timezone.utc).isoformat(),
                event_type="PostToolUse",
                matcher=None,
                handler_type="in_process",
                exit_code=0,
                duration_ms=0,
                tool_name=tool_name,
                error=None,
            )

            # Use "system" as username for in-process callbacks
            store = get_hook_log_store()
            store.append("system", entry)
        except Exception as exc:
            logger.warning("hook_execution_logger callback error: {}", exc)

        if enable_file_canvas_reminder and tool_name == "Bash":
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": _BASH_GENERATED_FILE_REMINDER,
                },
            }

        return {}

    return hook_execution_logger


hook_execution_logger = make_hook_execution_logger()
