from __future__ import annotations

import os
import shutil
import stat
from typing import Any, Literal

from claude_agent_sdk import ClaudeAgentOptions
from claude_agent_sdk.types import (
    HookMatcher,
    PermissionResultAllow,
    SyncHookJSONOutput,
)
from fastapi import HTTPException

from ...models.agent import PermissionMode
from ..config import get_settings
from ..user_env import read_user_env

_logger = None


def _get_logger():
    global _logger
    if _logger is None:
        from ...middleware.logging import get_app_logger
        _logger = get_app_logger(__name__)
    return _logger


_memfd_cache: int | None = None  # keep fd open for process lifetime (Linux)


BUILTIN_DISALLOWED_TOOLS = [
    "CronCreate",
    "CronDelete",
    "CronList",
    "EnterWorktree",
    "ExitWorktree",
    "NotebookEdit",
    "RemoteTrigger",
    "WebFetch",
    "WebSearch",
]


def _ensure_executable(cli_path: str) -> str:
    """Resolve symlinks, chmod +x, and wrap Node.js scripts without shebang.

    Uses Linux memfd_create for the wrapper — no file left on disk.
    """
    real_path = os.path.realpath(cli_path)
    if not os.path.isfile(real_path):
        return cli_path

    # Try chmod +x
    if not os.access(real_path, os.X_OK):
        try:
            os.chmod(real_path, os.stat(real_path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            _get_logger().info("Added execute permission to: {}", real_path)
        except OSError:
            pass

    # Check for shebang or native binary magic bytes
    try:
        with open(real_path, "rb") as f:
            magic = f.read(4)
    except OSError:
        return cli_path

    if magic[:2] == b"#!":
        return cli_path

    # Native binaries (ELF, Mach-O) are directly executable — no wrapper needed
    _native_magics = {
        b"\x7fELF",          # ELF (Linux)
        b"\xcf\xfa\xed\xfe", # Mach-O 64-bit
        b"\xce\xfa\xed\xfe", # Mach-O 32-bit
        b"\xca\xfe\xba\xbe", # Mach-O fat/universal
    }
    if magic in _native_magics:
        return cli_path

    # Non-native script without shebang — need a wrapper to exec via node
    node_path = shutil.which("node")
    if not node_path:
        _get_logger().warning("No shebang in {} and node not found in PATH", real_path)
        return cli_path

    global _memfd_cache
    if _memfd_cache is not None:
        return f"/proc/self/fd/{_memfd_cache}"

    wrapper = f"#!/bin/sh\nexec {node_path} {real_path} \"$@\"\n".encode()
    try:
        import ctypes, ctypes.util
        libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
        fd = libc.memfd_create(b"claude-wrapper", 0)
        if fd < 0:
            raise OSError("memfd_create failed")
        os.write(fd, wrapper)
        os.fchmod(fd, 0o755)
        _memfd_cache = fd
        _get_logger().info("In-memory CLI wrapper (fd={}) -> node {}", fd, real_path)
        return f"/proc/self/fd/{fd}"
    except Exception:
        _get_logger().warning("memfd_create unavailable, falling back to direct path")
        return cli_path


async def _noop_pre_tool_hook(input_data: Any, tool_use_id: str, context: Any) -> SyncHookJSONOutput:
    """Required by the SDK when can_use_tool is configured."""
    return SyncHookJSONOutput(continue_=True)


async def _auto_approve_tool(tool_name: str, tool_input: dict[str, Any], context: Any) -> PermissionResultAllow:
    # Even in bypassPermissions mode the CLI asks for approval when writing
    # under .claude/{skills,commands,agents}/** (built-in protection in the
    # Claude Code CLI — see wf5 in the bundled binary). Without a can_use_tool
    # callback the SDK raises "canUseTool callback is not provided" and the
    # tool call fails. An auto-approve callback lets these writes through.
    return PermissionResultAllow(updated_input=None)


async def build_agent_options(
    session_id: str | None = None,
    permission_mode: PermissionMode | None = None,
    *,
    can_use_tool: Any = None,
    cwd: str | None = None,
    username: str | None = None,
    model_override: str | None = None,
    auth_method: Literal["jwt", "api_key", "anonymous"] = "jwt",
    mcp_servers: str | list[str] | None = "auto",
    inject_scheduler_tools: bool = True,
    enable_file_checkpointing: bool = False,
    fork_session: bool = False,
    extra_allowed_tools: list[str] | None = None,
    inject_openclaw_tools: bool = False,
    enable_permission_feedback: bool = True,
) -> ClaudeAgentOptions:
    settings = get_settings()
    if cwd is None:
        cwd = os.path.expanduser(settings.server.work_dir)
    os.makedirs(cwd, exist_ok=True)

    # Read per-user env
    if username is None:
        raise HTTPException(400, "Authentication required for agent runs")

    user_env = read_user_env(username)
    if user_env is None:
        raise HTTPException(400, "API credentials not configured. Please set up your API connection in Settings.")

    # Check minimum required fields
    if not user_env.get("ANTHROPIC_BASE_URL") or not user_env.get("ANTHROPIC_AUTH_TOKEN"):
        raise HTTPException(400, "API credentials not configured. Please set up your API connection in Settings.")

    # Apply model override if provided
    env_dict = dict(user_env)
    model = env_dict.get("ANTHROPIC_MODEL", "")
    if model_override:
        env_dict["ANTHROPIC_MODEL"] = model_override
        model = model_override

    # One-time cleanup of legacy global-skill symlinks created by the old
    # sync_global_skill_symlinks path; enable/disable is now driven by
    # ``options.skills`` below.
    from ..skills import _cleanup_legacy_skill_symlinks
    _cleanup_legacy_skill_symlinks(username)

    def _stderr_logger(line: str) -> None:
        stripped = line.rstrip()
        if stripped:
            _stderr_logger.lines.append(stripped)  # type: ignore[attr-defined]
            if "[ERROR]" in stripped or "error" in stripped.lower():
                _get_logger().warning("CLI stderr: {}", stripped)

    _stderr_logger.lines = []  # type: ignore[attr-defined]

    # ``options.skills`` is the explicit allowlist (denylist-derived) of
    # discovered skills. The SDK auto-adds ``"Skill"`` to allowed_tools when
    # this is set, so we no longer pass it here. If computation fails (e.g.
    # a long-running daemon still has the pre-migration ChannelConfigStore in
    # memory), we leave ``skills=None`` so the CLI's own defaults apply —
    # better to over-expose than to crash the agent run.
    try:
        from ..skills import compute_enabled_skill_names
        enabled_skill_names: list[str] | None = compute_enabled_skill_names(username)
    except Exception:
        _get_logger().warning(
            "compute_enabled_skill_names failed; leaving options.skills unset",
            exc_info=True,
        )
        enabled_skill_names = None

    disallowed_tools = list(BUILTIN_DISALLOWED_TOOLS)
    if not enable_permission_feedback:
        # Caller cannot answer prompts — strip AskUserQuestion so the model
        # can't call it and stall the run waiting on a human.
        disallowed_tools.append("AskUserQuestion")

    options = ClaudeAgentOptions(
        model=model,
        env=env_dict,
        cwd=cwd,
        permission_mode=permission_mode or "bypassPermissions",
        setting_sources=["project","user"],
        allowed_tools=[],
        disallowed_tools=disallowed_tools,
        stderr=_stderr_logger,
        include_hook_events=True,
        skills=enabled_skill_names,
    )

    if extra_allowed_tools:
        existing = list(options.allowed_tools or [])
        for tool in extra_allowed_tools:
            if tool not in existing:
                existing.append(tool)
        options.allowed_tools = existing
    # Apply runtime configuration
    from ..user_store import get_user_store as _get_user_store
    runtime = _get_user_store().get_runtime_config()

    # Apply CLI path if configured.
    # If the target is a Node.js script (no shebang / not a native binary),
    # the OS will refuse to exec it directly.  Detect that case and create a
    # thin wrapper script so subprocess can launch it.
    cli_path = runtime.get("cli_path")
    if cli_path:
        cli_path = _ensure_executable(str(cli_path))
        options.cli_path = cli_path
    preset_cfg = runtime.get("append_systemprompt", {})
    if preset_cfg.get("enable") and preset_cfg.get("content"):
        options.system_prompt = {
            "type": "preset",
            "preset": "claude_code",
            "append": preset_cfg["content"],
        }

    # --- Plugin system: execute all enabled plugins ---
    try:
        from ..vivian_plugin import get_plugin_manager
        manager = get_plugin_manager()
        plugin_result = await manager.execute_all(username, runtime)
        if plugin_result.system_prompt_append:
            if options.system_prompt and isinstance(options.system_prompt, dict):
                existing_append = options.system_prompt.get("append", "")
                options.system_prompt["append"] = (existing_append + "\n\n" + plugin_result.system_prompt_append).strip()
            else:
                options.system_prompt = {
                    "type": "preset",
                    "preset": "claude_code",
                    "append": plugin_result.system_prompt_append,
                }
    except Exception:
        _get_logger().warning("Plugin system execution failed", exc_info=True)

    if session_id:
        options.resume = session_id
    if enable_file_checkpointing:
        options.enable_file_checkpointing = True
        options.extra_args["replay-user-messages"] = None
    if fork_session and session_id:
        options.fork_session = True
    effective_mode = permission_mode or "bypassPermissions"
    # In bypass mode with no explicit callback, fall back to the plain
    # auto-approve. When the admin has configured a non-empty risky_tool_list,
    # service.agent_run_events installs a risky-aware wrapper upstream and
    # passes it in via can_use_tool, so this fallback is skipped.
    if can_use_tool is None and effective_mode == "bypassPermissions":
        can_use_tool = _auto_approve_tool
    if can_use_tool is not None:
        options.can_use_tool = can_use_tool
        options.hooks = {"PreToolUse": [HookMatcher(matcher=None, hooks=[_noop_pre_tool_hook])]}

    # Ensure admin hooks are in .claude/settings.json and add in-process callbacks
    from ..hooks.builder import build_hooks
    programmatic_hooks = build_hooks(username, cwd, auth_method=auth_method)
    if programmatic_hooks:
        existing = options.hooks or {}
        for event, matchers in programmatic_hooks.items():
            existing.setdefault(event, []).extend(matchers)
        options.hooks = existing

    # MCP server injection
    # The CLI discovers MCP servers from .mcp.json via setting_sources. To
    # override that discovery we must pass --strict-mcp-config so the CLI
    # only uses servers explicitly provided via --mcp-config.
    from ..mcp.config_manager import McpConfigManager
    _should_inject = True
    _filter_names: list[str] | None = None  # None = all servers

    if mcp_servers is None or mcp_servers == "disable" or mcp_servers == []:
        _should_inject = False
    elif isinstance(mcp_servers, list):
        _filter_names = mcp_servers
    # else: 'auto' or omitted -> use all servers (_filter_names stays None)

    if _should_inject:
        mcp_mgr = McpConfigManager(username)
        mcp_dict = mcp_mgr.build_mcp_dict(filter_names=_filter_names)
        if mcp_dict:
            options.mcp_servers = mcp_dict
            # When a specific subset is requested, enforce strict mode so the
            # CLI does not merge in additional servers from .mcp.json.
            if _filter_names is not None:
                options.extra_args["strict-mcp-config"] = None
    else:
        # Use --strict-mcp-config with no --mcp-config so the CLI ignores
        # all MCP servers discovered from .mcp.json / settings.
        options.extra_args["strict-mcp-config"] = None

    # --- Inject scheduler MCP tools (platform feature, always available) ---
    if inject_scheduler_tools and username:
        try:
            from ..scheduler.mcp_tools import build_scheduler_mcp_server
            scheduler_server = build_scheduler_mcp_server(username)
            existing = options.mcp_servers or {}
            if not isinstance(existing, dict):
                existing = {}
            existing["vivian_scheduler"] = scheduler_server
            options.mcp_servers = existing
            # Ensure allowed_tools includes scheduler tools
            allowed = list(options.allowed_tools or [])
            if not any("vivian_scheduler" in t for t in allowed):
                allowed.append("mcp__vivian_scheduler__*")
            options.allowed_tools = allowed
        except Exception:
            _get_logger().warning("Failed to inject scheduler MCP tools")

    # --- Inject FileCanvas file-registration tool for JWT-backed login sessions only ---
    if username and auth_method == "jwt":
        try:
            from ..mcp.built_in import build_file_canvas_mcp_server

            generated_server = build_file_canvas_mcp_server(cwd)
            existing = options.mcp_servers or {}
            if not isinstance(existing, dict):
                existing = {}
            existing["vivian_File"] = generated_server
            options.mcp_servers = existing

            allowed = list(options.allowed_tools or [])
            if not any("vivian_File" in t for t in allowed):
                allowed.append("mcp__vivian_File__*")
            options.allowed_tools = allowed
        except Exception:
            _get_logger().warning("Failed to inject FileCanvas MCP tools")

    # --- Inject OpenClaw delegation tools (when bridge is connected) ---
    if username and inject_openclaw_tools:
        try:
            from ..channels.openclaw_bridge import get_bridge
            bridge = get_bridge(username)
            if bridge and bridge.is_connected:
                agents = bridge.config.agents
                if agents:
                    agents_desc = "\n".join(f"- {a.id}: {a.description}" for a in agents)
                else:
                    agents_desc = f"- {bridge.config.default_agent} (default)"

                from ..channels.openclaw_mcp_tools import build_openclaw_mcp_server
                oc_server = build_openclaw_mcp_server(username, agents_desc)
                if oc_server:
                    existing = options.mcp_servers or {}
                    if not isinstance(existing, dict):
                        existing = {}
                    existing["vivian_openclaw"] = oc_server
                    options.mcp_servers = existing
                    allowed = list(options.allowed_tools or [])
                    if not any("vivian_openclaw" in t for t in allowed):
                        allowed.append("mcp__vivian_openclaw__*")
                    options.allowed_tools = allowed
        except Exception:
            _get_logger().warning("Failed to inject OpenClaw MCP tools")

    return options
