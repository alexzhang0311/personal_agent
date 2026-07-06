"""
In-process MCP server providing scheduler tools for the Claude agent.

Uses Claude Agent SDK custom tools API: @tool decorator + create_sdk_mcp_server().
Each tool calls JobStore directly (no HTTP, no auth).
After mutations, writes a "reload_user" command so the daemon picks up changes.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from claude_agent_sdk import create_sdk_mcp_server, tool

from ...models.scheduler import (
    AgentRunConfig,
    CronTriggerConfig,
    HttpCallConfig,
    IntervalTriggerConfig,
    ScheduledJobDefinition,
    UserScriptConfig,
)
from .job_store import get_job_store
from .shared import write_command


SCHEDULER_TOOL_SCOPE = (
    "Vivian scheduler tools manage durable scheduled automations only: cron jobs "
    "and recurring interval jobs saved in the scheduler. They are not sub-agent "
    "delegation tools and are not a way to run an agent for the current request. "
    "If the user asks to use/ask/run/delegate to an agent or sub-agent now, such "
    "as 'ask the research agent to do X', 'let xxx agent finish X', "
    "'让 xxx agent 完成 xxx', or '派一个 sub agent 做 xxx', do not use scheduler tools; "
    "use the built-in Agent/sub-agent mechanism instead."
)


def build_scheduler_mcp_server(username: str):
    """Build an in-process MCP server with scheduler tools scoped to username."""

    @tool(
        "scheduler_list_jobs",
        (
            f"{SCHEDULER_TOOL_SCOPE}\n\n"
            "List existing scheduled automation jobs for the current user. Use only when "
            "the user explicitly asks to list/show scheduled jobs, cron jobs, recurring "
            "automations, or scheduler entries. Returns job names, types, triggers, and status."
        ),
        {},
    )
    async def list_jobs(args):
        store = get_job_store()
        jobs = store.list_jobs(username)
        if not jobs:
            return {"content": [{"type": "text", "text": "No scheduled jobs found."}]}

        lines = []
        for j in jobs:
            jt = j.job_config.job_type if j.job_config else "scheduled_agent"
            trigger_str = _format_trigger(j.trigger)
            lines.append(
                f"- **{j.name}** (id: `{j.id}`, type: {jt}, status: {j.status})\n"
                f"  Schedule: {trigger_str} | TZ: {j.timezone}"
            )
        return {"content": [{"type": "text", "text": "\n".join(lines)}]}

    @tool(
        "scheduler_view_job",
        (
            f"{SCHEDULER_TOOL_SCOPE}\n\n"
            "View detailed information about an existing scheduled automation job by its "
            "ID or name. Use only when the user is asking about a saved scheduler job, "
            "not when they ask an agent or sub-agent to perform work now."
        ),
        {
            "type": "object",
            "properties": {
                "job_id": {"type": "string", "description": "Job ID (8-char UUID prefix). Can also pass the job name — will be matched."},
            },
            "required": ["job_id"],
        },
    )
    async def view_job(args):
        store = get_job_store()
        job_id = args.get("job_id", "")

        # Try direct ID lookup first
        job = store.get_job(username, job_id)

        # If not found, try matching by name
        if not job:
            jobs = store.list_jobs(username)
            matches = [j for j in jobs if j.name.lower() == job_id.lower()]
            if not matches:
                matches = [j for j in jobs if job_id.lower() in j.name.lower()]
            if matches:
                job = matches[0]

        if not job:
            return {"content": [{"type": "text", "text": f"Job not found: {job_id}"}], "is_error": True}

        jc = job.job_config
        jt = jc.job_type if jc else "scheduled_agent"
        trigger_str = _format_trigger(job.trigger)

        detail = (
            f"**{job.name}** (id: `{job.id}`)\n"
            f"- Type: {jt}\n"
            f"- Status: {job.status}\n"
            f"- Schedule: {trigger_str}\n"
            f"- Timezone: {job.timezone}\n"
            f"- Created: {job.created_at.isoformat()}\n"
        )

        if jt == "scheduled_agent":
            prompt = jc.prompt if jc else job.prompt
            model = (jc.model if jc else job.model) or "default"
            detail += f"- Model: {model}\n- Prompt: {prompt}\n"
        elif jt == "http_call" and jc:
            detail += f"- Method: {jc.method}\n- URL: {jc.url}\n- Timeout: {jc.timeout_seconds}s\n"
        elif jt == "user_script" and jc:
            detail += f"- Language: {jc.language}\n- Source: {jc.source}\n"
            if jc.source == "file":
                detail += f"- File: {jc.file_path}\n"
            detail += f"- Timeout: {jc.timeout_seconds}s\n"

        return {"content": [{"type": "text", "text": detail}]}

    @tool(
        "scheduler_create_job",
        (
            f"{SCHEDULER_TOOL_SCOPE}\n\n"
            "Create a new SAVED SCHEDULED AUTOMATION job. Cron / interval only — this "
            "tool does NOT run anything immediately and does NOT delegate the current "
            "conversation task to an agent.\n"
            "\n"
            "STRICT ROUTING RULE: only use this tool when the user explicitly asks for a "
            "saved schedule, cron job, recurring automation, or repeated interval. The "
            "word 'agent' is never enough by itself. Look for schedule phrases like "
            "'every day', 'every N minutes', 'weekdays at 9am', 'cron', 'schedule', "
            "'recurring', 'periodically', '定时', '每天', '每周', '每隔 N 分钟', or '周期性'.\n"
            "\n"
            "WHEN NOT TO USE: do NOT use for one-shot or current-turn requests like "
            "'run X', 'test X', 'try X', 'execute X now', 'ask the coding agent to do X', "
            "'use a sub agent for X', '让 xxx agent 完成 xxx', or '派一个 agent 处理 xxx'. "
            "Those should use the built-in Agent/sub-agent mechanism or directly call "
            "the relevant tool. The `scheduled_agent` job type below is an internal "
            "scheduler enum for cron/interval automation; it is not the Agent/sub-agent tool.\n"
            "\n"
            "IMPORTANT: Before calling this tool, you MUST use the AskUserQuestion tool to confirm the job configuration with the user. "
            "Present the job name, type, schedule, and type-specific parameters for the user to review and approve.\n"
            "\n"
            "## Job types\n"
            "\n"
            "### scheduled_agent — Internal scheduler enum for recurring agent automation\n"
            "Required params: prompt\n"
            "Optional params: model (override the default model)\n"
            "Use only when the user wants a saved cron/interval automation that launches "
            "an agent later or repeatedly. Do not select this just because the user said "
            "'agent'; current agent/sub-agent work must not be routed here. The scheduled "
            "agent session runs with bypassPermissions mode in the user's workspace, "
            "fired by cron/interval — NOT immediately.\n"
            "\n"
            "### http_call — Make an HTTP request to an endpoint\n"
            "Required params: url\n"
            "Optional params: method (default GET), headers (dict), body (string), timeout_seconds (default 30)\n"
            "Use for health checks, webhooks, API polling, etc.\n"
            "\n"
            "### user_script — Execute a Python or shell script\n"
            "Required params: language (python or shell), and either file_path (relative to workspace) or script (inline content)\n"
            "Optional params: timeout_seconds (default 300)\n"
            "If script param is provided, source is 'inline'. If file_path is provided, source is 'file'.\n"
            "Scripts run in the user's workspace directory.\n"
            "\n"
            "## Schedule\n"
            "\n"
            "trigger_type=cron: Use cron_expr with standard 5-field format: 'minute hour day month day_of_week'\n"
            "  Examples: '0 9 * * *' (daily 9am), '*/30 * * * *' (every 30min), '0 9 * * 1-5' (weekdays 9am)\n"
            "\n"
            "trigger_type=interval: Use interval_minutes for the repeat period.\n"
            "  Examples: 5 (every 5 min), 60 (hourly), 1440 (daily)\n"
            "\n"
            "## Workflow\n"
            "\n"
            "1. Gather requirements from the user (what to run, how often)\n"
            "2. Use AskUserQuestion to present the full job config for confirmation\n"
            "3. Only call this tool after the user approves\n"
            "4. If there is no explicit schedule/recurrence requirement, do not call this tool\n"
        ),
        {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Human-readable job name. Keep it short and descriptive."},
                "job_type": {"type": "string", "enum": ["scheduled_agent", "http_call", "user_script"], "description": "The scheduled automation kind. `scheduled_agent` means a saved cron/interval automation that launches an agent later or repeatedly; it must not be used for current sub-agent delegation."},
                "trigger_type": {"type": "string", "enum": ["cron", "interval"], "description": "Schedule type: 'cron' for cron expressions, 'interval' for fixed repeat intervals."},
                "cron_expr": {"type": "string", "description": "5-field cron expression. Required when trigger_type=cron. Format: 'minute hour day month day_of_week'. Examples: '0 9 * * *', '*/15 * * * *', '0 0 1 * *'."},
                "interval_minutes": {"type": "number", "description": "Repeat interval in minutes. Required when trigger_type=interval. Examples: 5, 30, 60, 1440."},
                "prompt": {"type": "string", "description": "[scheduled_agent] The prompt saved for the recurring scheduled agent automation. Should be a complete, self-contained instruction for future cron/interval runs. Do not use this to ask a sub-agent to perform the current user request."},
                "model": {"type": "string", "description": "[scheduled_agent] Optional model override. Leave empty to use the system default."},
                "url": {"type": "string", "description": "[http_call] The full URL to call. Must include protocol (http:// or https://)."},
                "method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"], "description": "[http_call] HTTP method. Defaults to GET."},
                "headers": {"type": "object", "description": "[http_call] HTTP headers as key-value pairs. Example: {\"Authorization\": \"Bearer xxx\", \"Content-Type\": \"application/json\"}"},
                "body": {"type": "string", "description": "[http_call] Request body string. Typically JSON for POST/PUT requests."},
                "script": {"type": "string", "description": "[user_script] Inline script content. Provide this OR file_path, not both. If provided, source is set to 'inline'."},
                "file_path": {"type": "string", "description": "[user_script] Path to script file, relative to the user's workspace. Provide this OR script, not both. If provided, source is set to 'file'."},
                "language": {"type": "string", "enum": ["python", "shell"], "description": "[user_script] Script language. Determines the interpreter (python3 or /bin/bash)."},
                "timeout_seconds": {"type": "number", "description": "[http_call/user_script] Execution timeout. Defaults: 30s for http_call, 300s for user_script."},
            },
            "required": ["name", "job_type", "trigger_type"],
        },
    )
    async def create_job(args):
        store = get_job_store()
        jobs = store.list_jobs(username)

        # Build trigger
        trigger_type = args["trigger_type"]
        if trigger_type == "cron":
            cron_expr = args.get("cron_expr", "0 9 * * *")
            trigger = CronTriggerConfig(expr=cron_expr)
        else:
            mins = args.get("interval_minutes", 60)
            hours = int(mins // 60)
            remaining = int(mins % 60)
            trigger = IntervalTriggerConfig(hours=hours, minutes=remaining)

        # Build job_config
        jt = args["job_type"]
        if jt == "scheduled_agent":
            job_config = AgentRunConfig(
                prompt=args.get("prompt", ""),
                model=args.get("model"),
            )
        elif jt == "http_call":
            job_config = HttpCallConfig(
                method=args.get("method", "GET"),
                url=args.get("url", ""),
                headers=args.get("headers", {}),
                body=args.get("body"),
                timeout_seconds=int(args.get("timeout_seconds", 30)),
            )
        elif jt == "user_script":
            source = "inline" if args.get("script") else "file"
            job_config = UserScriptConfig(
                language=args.get("language", "python"),
                source=source,
                file_path=args.get("file_path"),
                script=args.get("script"),
                timeout_seconds=int(args.get("timeout_seconds", 300)),
            )
        else:
            return {"content": [{"type": "text", "text": f"Unknown job type: {jt}"}], "is_error": True}

        now = datetime.now(timezone.utc)
        new_job = ScheduledJobDefinition(
            id=str(uuid4())[:8],
            name=args["name"],
            prompt=job_config.prompt if hasattr(job_config, "prompt") else "",
            trigger=trigger,
            timezone="Asia/Shanghai",
            status="active",
            job_config=job_config,
            created_at=now,
            updated_at=now,
        )

        jobs.append(new_job)
        store.save_jobs(username, jobs)
        write_command("reload_user", {"username": username})

        return {"content": [{"type": "text", "text": f"Created job **{new_job.name}** (id: `{new_job.id}`, type: {jt}, status: active)"}]}

    @tool(
        "scheduler_delete_job",
        (
            f"{SCHEDULER_TOOL_SCOPE}\n\n"
            "Delete an existing scheduled automation job by its ID or name. Use only "
            "for saved scheduler jobs, not for stopping or cancelling a current "
            "Agent/sub-agent task. IMPORTANT: Use AskUserQuestion to confirm with the "
            "user before deleting."
        ),
        {
            "type": "object",
            "properties": {
                "job_id": {"type": "string", "description": "Job ID or name to delete"},
            },
            "required": ["job_id"],
        },
    )
    async def delete_job(args):
        store = get_job_store()
        job_id = args.get("job_id", "")
        jobs = store.list_jobs(username)

        # Find job by ID or name
        target = None
        for j in jobs:
            if j.id == job_id or j.name.lower() == job_id.lower():
                target = j
                break
        if not target:
            # Partial name match
            for j in jobs:
                if job_id.lower() in j.name.lower():
                    target = j
                    break

        if not target:
            return {"content": [{"type": "text", "text": f"Job not found: {job_id}"}], "is_error": True}

        new_jobs = [j for j in jobs if j.id != target.id]
        store.save_jobs(username, new_jobs)
        write_command("reload_user", {"username": username})

        return {"content": [{"type": "text", "text": f"Deleted job **{target.name}** (id: `{target.id}`)"}]}

    @tool(
        "scheduler_trigger_job",
        (
            f"{SCHEDULER_TOOL_SCOPE}\n\n"
            "Manually trigger an EXISTING saved scheduled job by ID or name. This is "
            "only for retrying/testing a scheduler entry that already exists; it is not "
            "a general one-shot execution tool. Do not use this to start a new agent or "
            "sub-agent for the current request. Use AskUserQuestion to confirm before "
            "triggering if the job has side effects."
        ),
        {
            "type": "object",
            "properties": {
                "job_id": {"type": "string", "description": "Job ID or name to trigger"},
            },
            "required": ["job_id"],
        },
    )
    async def trigger_job(args):
        store = get_job_store()
        job_id = args.get("job_id", "")

        job = _find_job(store, username, job_id)
        if not job:
            return {"content": [{"type": "text", "text": f"Job not found: {job_id}"}], "is_error": True}

        write_command("trigger_now", {"username": username, "job_id": job.id})
        return {"content": [{"type": "text", "text": f"Triggered immediate run for **{job.name}** (id: `{job.id}`)"}]}

    @tool(
        "scheduler_pause_job",
        (
            f"{SCHEDULER_TOOL_SCOPE}\n\n"
            "Pause an existing scheduled automation job so it stops running on its "
            "saved schedule. Use only for scheduler entries, not for current agent or "
            "sub-agent work."
        ),
        {
            "type": "object",
            "properties": {
                "job_id": {"type": "string", "description": "Job ID or name to pause"},
            },
            "required": ["job_id"],
        },
    )
    async def pause_job(args):
        store = get_job_store()
        job_id = args.get("job_id", "")
        jobs = store.list_jobs(username)

        target = None
        for j in jobs:
            if j.id == job_id or j.name.lower() == job_id.lower():
                target = j
                break
        if not target:
            for j in jobs:
                if job_id.lower() in j.name.lower():
                    target = j
                    break

        if not target:
            return {"content": [{"type": "text", "text": f"Job not found: {job_id}"}], "is_error": True}

        target.status = "paused"
        target.updated_at = datetime.now(timezone.utc)
        store.save_jobs(username, jobs)
        write_command("reload_user", {"username": username})

        return {"content": [{"type": "text", "text": f"Paused job **{target.name}** (id: `{target.id}`)"}]}

    @tool(
        "scheduler_resume_job",
        (
            f"{SCHEDULER_TOOL_SCOPE}\n\n"
            "Resume an existing paused scheduled automation job. Use only for saved "
            "scheduler entries, not for current agent or sub-agent work."
        ),
        {
            "type": "object",
            "properties": {
                "job_id": {"type": "string", "description": "Job ID or name to resume"},
            },
            "required": ["job_id"],
        },
    )
    async def resume_job(args):
        store = get_job_store()
        job_id = args.get("job_id", "")
        jobs = store.list_jobs(username)

        target = None
        for j in jobs:
            if j.id == job_id or j.name.lower() == job_id.lower():
                target = j
                break
        if not target:
            for j in jobs:
                if job_id.lower() in j.name.lower():
                    target = j
                    break

        if not target:
            return {"content": [{"type": "text", "text": f"Job not found: {job_id}"}], "is_error": True}

        target.status = "active"
        target.updated_at = datetime.now(timezone.utc)
        store.save_jobs(username, jobs)
        write_command("reload_user", {"username": username})

        return {"content": [{"type": "text", "text": f"Resumed job **{target.name}** (id: `{target.id}`)"}]}

    return create_sdk_mcp_server(
        name="vivian_scheduler",
        version="1.0.0",
        tools=[list_jobs, view_job, create_job, delete_job, trigger_job, pause_job, resume_job],
    )


def _find_job(store, username: str, job_id: str):
    """Find a job by ID or name (exact then partial)."""
    job = store.get_job(username, job_id)
    if job:
        return job
    jobs = store.list_jobs(username)
    for j in jobs:
        if j.name.lower() == job_id.lower():
            return j
    for j in jobs:
        if job_id.lower() in j.name.lower():
            return j
    return None


def _format_trigger(trigger) -> str:
    """Format a trigger config for display."""
    if hasattr(trigger, "expr"):
        return f"cron {trigger.expr}"
    parts = []
    if getattr(trigger, "weeks", 0):
        parts.append(f"{trigger.weeks}w")
    if getattr(trigger, "days", 0):
        parts.append(f"{trigger.days}d")
    if getattr(trigger, "hours", 0):
        parts.append(f"{trigger.hours}h")
    if getattr(trigger, "minutes", 0):
        parts.append(f"{trigger.minutes}m")
    if getattr(trigger, "seconds", 0):
        parts.append(f"{trigger.seconds}s")
    return f"every {' '.join(parts)}" if parts else "interval (default)"
