"""
Built-in in-process MCP servers exposed by Vivian itself.

These tools are injected directly into Claude Agent SDK runs and are not backed
by user-configured remote MCP endpoints.
"""
from __future__ import annotations

import mimetypes
import os

from claude_agent_sdk import create_sdk_mcp_server, tool


FILE_CANVAS_TOOL_DESCRIPTION = (
    "注册由 Read、Write、Edit 之外的工具生成的文件。\n"
    "\n"
    "重要：如果某个非 Read / Write / Edit 工具创建、导出、渲染、下载、转换或保存了文件，"
    "你必须在最终回复用户之前立即调用 FileCanvas，不能只在文字里口头告诉用户文件已生成。\n"
    "如果文件属于 `non-plain-text`，或者需要在前端 Canvas 面板中预览，"
    "你都应当总是调用 `mcp__vivian_File__FileCanvas` 把最终文件路径注册给前端。\n"
    "\n"
    "尤其是 Bash 场景：如果 Bash 执行 python、node、shell script、办公文档库、"
    "报表生成器或其他会写出文件的命令，在文件成功落盘后，必须调用 FileCanvas。\n"
    "同理，如果 Bash 通过 python、node 或 shell 子命令去**读取、解析或分析**已存在的"
    "`non-plain-text` 文件（例如 `python parse.py data.xlsx`、`node read.js report.pdf`、"
    "`bash analyze.sh file.docx` 等），即使没有生成任何新文件，也必须把被读取的"
    "`non-plain-text` 文件路径调用 FileCanvas 注册到前端，方便用户在 Canvas 中预览这些被处理过的文件。\n"
    "\n"
    "不要对 Write 或 Edit 调用此工具，因为 Vivian 已经自动追踪它们。\n"
    "应当对 Bash、python 脚本、MCP 工具、编译器、转换器、导出器、渲染器等"
    "生成的文件调用此工具。\n"
    "\n"
    "如果你刚刚使用 Bash、Python、Node、转换工具、导出工具或任意 MCP 工具生成了 xlsx、docx、pptx、pdf、html、图片、压缩包或其他文件，"
    "下一步就应该调用 FileCanvas。\n"
    "对于 xlsx、docx、pptx、pdf、html、图片等 `non-plain-text` 文件，"
    "无论它们是新生成的、转换得到的，还是基于现有文件修改后的结果，都要用 FileCanvas 注册到前端 Canvas。\n"
    "\n"
    "推荐流程：\n"
    "1. 先创建文件。\n"
    "2. 再用 FileCanvas 注册最终落盘路径。\n"
    "3. 最后再告诉用户文件保存在哪里，并提示其已同步到 Canvas。\n"
    "\n"
    "请传入文件创建完成后的真实最终路径。\n"
    "同一批产物可以一次传多个路径。\n"
    "如果工具返回路径无效，请修正路径后再次调用 FileCanvas。"
)


def _dedupe_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for raw in paths:
        if not isinstance(raw, str):
            continue
        candidate = raw.strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def _workspace_root(cwd: str | None) -> str:
    return os.path.realpath(os.path.expanduser(cwd or os.getcwd()))


def _resolve_path(path: str, cwd: str) -> str:
    expanded = os.path.expanduser(path)
    if os.path.isabs(expanded):
        return os.path.realpath(expanded)
    return os.path.realpath(os.path.join(cwd, expanded))


def _ensure_in_workspace(real_path: str, workspace_root: str) -> None:
    try:
        common = os.path.commonpath([workspace_root, real_path])
    except ValueError as exc:
        raise ValueError(f"Path is outside the workspace: {real_path}") from exc
    if common != workspace_root:
        raise ValueError(f"Path is outside the workspace: {real_path}")


def resolve_file_canvas_files(paths: list[str], cwd: str | None) -> list[dict[str, object]]:
    workspace_root = _workspace_root(cwd)
    deduped = _dedupe_paths(paths)
    if not deduped:
        raise ValueError("No file paths were provided for FileCanvas.")

    resolved: list[dict[str, object]] = []
    seen_real_paths: set[str] = set()
    for raw_path in deduped:
        real_path = _resolve_path(raw_path, workspace_root)
        if real_path in seen_real_paths:
            continue
        seen_real_paths.add(real_path)
        _ensure_in_workspace(real_path, workspace_root)
        if not os.path.exists(real_path):
            raise ValueError(f"FileCanvas file not found: {raw_path}")
        if not os.path.isfile(real_path):
            raise ValueError(f"FileCanvas path is not a file: {raw_path}")

        stat_result = os.stat(real_path)
        mime_type = mimetypes.guess_type(real_path)[0] or "application/octet-stream"
        _, extension = os.path.splitext(real_path)
        resolved.append(
            {
                "path": real_path,
                "relative_path": os.path.relpath(real_path, workspace_root),
                "name": os.path.basename(real_path),
                "mime_type": mime_type,
                "size": stat_result.st_size,
                "extension": extension.lower(),
            }
        )

    return resolved


def build_file_canvas_mcp_server(cwd: str | None):
    """Build an in-process MCP server exposing the FileCanvas tool."""
    workspace_root = _workspace_root(cwd)

    @tool(
        "FileCanvas",
        FILE_CANVAS_TOOL_DESCRIPTION,
        {
            "type": "object",
            "properties": {
                "paths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "由非 Read / Write / Edit 工具生成的文件最终落盘路径。",
                },
                "summary": {
                    "type": "string",
                    "description": "可选的简短说明，描述这批生成文件是什么。",
                },
            },
            "required": ["paths"],
        },
    )
    async def generated(args):
        try:
            files = resolve_file_canvas_files(args.get("paths") or [], workspace_root)
        except ValueError as exc:
            return {
                "content": [{"type": "text", "text": str(exc)}],
                "is_error": True,
            }

        summary = str(args.get("summary") or "").strip()
        lines: list[str] = []
        if summary:
            lines.append(summary)
        lines.append("已登记文件到 Canvas：")
        lines.extend(f"- {item['path']}" for item in files)

        return {
            "content": [{"type": "text", "text": "\n".join(lines)}],
            "files": files,
        }

    return create_sdk_mcp_server(
        name="vivian_File",
        version="1.0.0",
        tools=[generated],
    )
