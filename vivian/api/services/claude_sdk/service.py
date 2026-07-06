from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from claude_agent_sdk import AssistantMessage, ClaudeSDKClient, ResultMessage, SystemMessage, TextBlock, ToolUseBlock
from claude_agent_sdk.types import PermissionResultAllow, PermissionResultDeny

from ...models.agent import PermissionMode
from ...services.audit_log import AuditEntry, get_audit_logger
from ...services.skills import _get_skills_dir
from . import retry
from .options import build_agent_options
from ...middleware.logging import get_app_logger
from .permission_coordinator import PermissionCoordinator, registry
from .serialization import get_event_label, serialize_assistant_message, serialize_message, serialize_result_message
from .session_heal import heal_orphan_tool_uses

logger = get_app_logger(__name__)

StreamQueue = asyncio.Queue[dict[str, Any] | None]


def _build_prompt_with_attachments(prompt: str, attachments: list[dict] | None) -> str:
    """Inject uploaded file paths into the prompt via XML tags.

    Each attachment is a dict with 'path' (UUID-based on disk) and optional 'name' (original filename).
    """
    if not attachments:
        return prompt
    lines = []
    for att in attachments:
        path = att["path"]
        name = att.get("name")
        if name:
            lines.append(f"- {name}: {path}")
        else:
            lines.append(f"- {path}")
    file_lines = "\n".join(lines)
    return (
        f"{prompt}\n\n<uploaded-files>\n"
        f"Use the EXACT file path on each line to read the file:\n"
        f"Do NOT directly read non-plain-text binary files as plaintext. "
        f"For files such as pdf, docx, xlsx, pptx, images, archives, or other binary formats, "
        f"use an appropriate tool or processing method instead of treating them as plain text.\n"
        f"If you create, convert, render, export, modify, or even just read a non-plain-text file "
        f"(such as pdf, docx, xlsx, pptx, html, images, or similar rich-preview files) — "
        f"including when Bash invokes a python, node, or shell script that opens such a file "
        f"(e.g. `python parse.py data.xlsx`, `node read.js report.pdf`, `bash analyze.sh file.docx`) — "
        f"always call `mcp__vivian_File__FileCanvas` with that file's path so Vivian can register it to the frontend Canvas panel.\n"
        f"{file_lines}\n</uploaded-files>"
    )


def _build_prompt_with_images(
    prompt: str,
    images: list[dict] | None,
    attachments: list[dict] | None,
) -> str | list[dict]:
    """Build prompt content. Returns string for text-only, or list of content blocks for image messages."""
    if not images:
        return _build_prompt_with_attachments(prompt, attachments)

    content_blocks: list[dict] = []
    for img in images:
        content_blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": img["media_type"],
                "data": img["data"],
            },
        })

    text_prompt = _build_prompt_with_attachments(prompt, attachments)
    if text_prompt.strip():
        content_blocks.append({"type": "text", "text": text_prompt})

    return content_blocks


async def _make_image_prompt(content_blocks: list[dict]):
    """Async generator yielding a single user message dict with image content blocks for the SDK."""
    yield {
        "type": "user",
        "message": {"role": "user", "content": content_blocks},
        "parent_tool_use_id": None,
        "session_id": "",
    }


def _resolve_vision_model(username: str | None, images: list[dict] | None) -> str | None:
    """Read vision_model from user config if images are present."""
    if not images or not username:
        return None
    from ...routers.resource import _read_vision_model
    return _read_vision_model(username)


# Vision session tracking: session_id -> vision_model_id
_vision_sessions: dict[str, str] = {}
_VISION_SESSIONS_MAX = 1000


def _track_vision_session(session_id: str | None, vision_model: str | None) -> None:
    if not session_id or not vision_model:
        return
    if len(_vision_sessions) >= _VISION_SESSIONS_MAX:
        # Evict oldest entry
        oldest = next(iter(_vision_sessions))
        del _vision_sessions[oldest]
    _vision_sessions[session_id] = vision_model


def _get_sticky_vision_model(session_id: str | None) -> str | None:
    if not session_id:
        return None
    return _vision_sessions.get(session_id)


def _risky_list_enabled() -> list[str]:
    """Return the admin-configured risky-tool pattern list (or empty)."""
    try:
        from ..user_store import get_user_store
        return list(get_user_store().get_runtime_config().get("risky_tool_list") or [])
    except Exception:
        return []


def _uses_permission_coordinator(permission_mode: PermissionMode | None) -> bool:
    """Decide whether a PermissionCoordinator should be created for this run.

    For explicit permission modes (acceptEdits / default / plan) we always
    need the coordinator. For bypassPermissions we only need it when the
    admin has configured a non-empty risky_tool_list -- that list forces
    user approval for specific tools even in bypass mode.
    """
    if permission_mode not in (None, "bypassPermissions"):
        return True
    return bool(_risky_list_enabled())


def _make_risky_aware_can_use_tool(
    coordinator: PermissionCoordinator,
    risky_list: list[str],
):
    """Build a can_use_tool callback that pauses for user approval on
    matched risky tools and auto-allows everything else.

    Delegates the decision to require_permission_risky_tools so the hook
    function is the single source of truth for both the match logic and
    the user-facing reason text. The no-match branch returns
    PermissionResultAllow(updated_input=None) -- identical to
    _auto_approve_tool -- so the CLI's built-in protection for
    .claude/{skills,commands,agents}/** continues to work as before.
    """
    from ..hooks.built_in_hooks import require_permission_risky_tools
    from ..hooks.risky_matcher import matches_any

    async def wrapped(tool_name, tool_input, context):
        hook_out = await require_permission_risky_tools(
            {"tool_name": tool_name, "tool_input": tool_input}, None, None,
        )
        spec = (hook_out or {}).get("hookSpecificOutput") or {}
        if spec.get("permissionDecision") == "ask":
            _, rule = matches_any(risky_list, tool_name, tool_input)
            return await coordinator.request_permission(
                tool_name, tool_input, context,
                risky=True,
                matched_rule=rule,
                reason=spec.get("permissionDecisionReason"),
            )
        return PermissionResultAllow(updated_input=None)

    return wrapped


def _askuser_answers_map(questions: list | None, answer_text: str) -> dict[str, str]:
    """Normalise the permission UI / IM channel free-text answer into the
    AskUserQuestion ``answers`` map the Claude Code CLI actually expects.

    The CLI's AskUserQuestion reads ``answers`` as
    ``{question_text: answer_string}`` (multi-select comma-separated, keyed
    by question text). A free-text ``answer`` field is *not* in its schema,
    so it is silently ignored — ``answers`` stays ``{}`` and the model sees
    an empty "User has answered your questions: ." then hallucinates a
    choice. The WS frontend (AskUserQuestionCard.buildAnswerText) and the IM
    channel both send the locked ``updated_input={questions, answer}`` shape,
    where ``answer`` is one line per answered question:
    ``- {header|question} -> {values}``. We rebuild the real map here, the
    single boundary that hands updated_input to the CLI.
    """
    qs = [q for q in (questions or []) if isinstance(q, dict)]
    text = (answer_text or "").strip()

    parsed: dict[str, str] = {}
    for raw in text.split("\n"):
        line = raw.strip()
        if line.startswith("-"):
            line = line[1:].strip()
        if " -> " in line:
            head, val = line.split(" -> ", 1)
            parsed[head.strip()] = val.strip()

    answers: dict[str, str] = {}
    for q in qs:
        qtext = str(q.get("question") or "")
        if not qtext:
            continue
        header = str(q.get("header") or "")
        val = parsed.get(header) or parsed.get(qtext)
        if val is None:
            if len(qs) == 1:
                # Single question: the whole blob is its answer.
                val = next(iter(parsed.values())) if parsed else text
            else:
                continue
        answers[qtext] = val

    if not answers and qs:
        # Last resort: the user's words still reach the model.
        answers[str(qs[0].get("question") or "answer")] = text
    return answers


def _make_unified_can_use_tool(
    coordinator: PermissionCoordinator,
    effective_mode: str,
    risky_list: list[str],
    enable_feedback: bool = True,
):
    """Build the single can_use_tool callback used by every streaming run.

    AskUserQuestion is *always* routed through the coordinator so the
    agent loop blocks until the user answers or it times out — in every
    permission mode and both transports (WS + SSE). For other tools:

    - explicit permission modes (default / acceptEdits / plan) -> route
      every tool through the coordinator (preserves the prior
      coordinator.can_use_tool behaviour);
    - bypassPermissions + non-empty risky list -> delegate to
      require_permission_risky_tools; matched tools block for approval,
      everything else auto-allows;
    - bypassPermissions + empty risky list -> auto-allow with
      PermissionResultAllow(updated_input=None), identical to
      _auto_approve_tool, so the CLI's built-in protection for
      .claude/{skills,commands,agents}/** keeps working.

    When enable_feedback is False the run is non-interactive: the caller
    cannot answer prompts, so AskUserQuestion is already stripped from the
    toolset upstream (build_agent_options disallows it) and anything that
    would otherwise block for a prompt is denied with a default message
    instead of hanging the connection. Non-gated tools are unaffected.
    """
    from ..hooks.built_in_hooks import require_permission_risky_tools
    from ..hooks.risky_matcher import matches_any

    _disabled = PermissionResultDeny(message="permission feedback disabled")

    async def wrapped(tool_name, tool_input, context):
        if tool_name == "AskUserQuestion":
            if not enable_feedback:
                return _disabled  # defensive: tool is also disallowed upstream
            result = await coordinator.request_permission(
                tool_name, tool_input, context, kind="ask_user",
            )
            # Rewrite the locked {questions, answer} resolve shape into the
            # CLI's real {questions, answers:{question_text: str}} schema.
            # Deny (skip / timeout) passes through untouched.
            if isinstance(result, PermissionResultAllow):
                ui = result.updated_input
                if isinstance(ui, dict) and "answer" in ui and "answers" not in ui:
                    questions = ui.get("questions") or (
                        tool_input.get("questions") if isinstance(tool_input, dict) else None
                    )
                    return PermissionResultAllow(updated_input={
                        "questions": questions,
                        "answers": _askuser_answers_map(questions, ui.get("answer") or ""),
                    })
            return result

        if effective_mode != "bypassPermissions":
            if not enable_feedback:
                return _disabled
            return await coordinator.request_permission(
                tool_name, tool_input, context, kind="permission",
            )

        if risky_list:
            hook_out = await require_permission_risky_tools(
                {"tool_name": tool_name, "tool_input": tool_input}, None, None,
            )
            spec = (hook_out or {}).get("hookSpecificOutput") or {}
            if spec.get("permissionDecision") == "ask":
                if not enable_feedback:
                    return _disabled
                _, rule = matches_any(risky_list, tool_name, tool_input)
                return await coordinator.request_permission(
                    tool_name, tool_input, context,
                    risky=True,
                    matched_rule=rule,
                    reason=spec.get("permissionDecisionReason"),
                    kind="permission",
                )
            return PermissionResultAllow(updated_input=None)

        return PermissionResultAllow(updated_input=None)

    return wrapped


def _audit_tool_uses(message: AssistantMessage, username: str | None, session_id: str | None) -> None:
    """Log an audit entry for each tool_use block in an assistant message."""
    audit = get_audit_logger()
    actor = username or "anonymous"
    for block in message.content:
        if isinstance(block, ToolUseBlock):
            # Summarize input — truncate large values to keep log manageable
            input_summary = {}
            if isinstance(block.input, dict):
                for k, v in block.input.items():
                    s = str(v)
                    input_summary[k] = s[:200] + "..." if len(s) > 200 else s

            # Detect Skill tool invocations and log as skill.invoked
            if block.name == "Skill":
                skill_name = input_summary.get("skill", "unknown")
                audit.append(AuditEntry(
                    actor=actor,
                    action="skill.invoked",
                    target=skill_name,
                    details={
                        "tool_use_id": block.id,
                        "session_id": session_id,
                        "input": input_summary,
                    },
                ))
            else:
                audit.append(AuditEntry(
                    actor=actor,
                    action="tool.invoke",
                    target=block.name,
                    details={
                        "tool_use_id": block.id,
                        "session_id": session_id,
                        "input": input_summary,
                    },
                ))


def _audit_skill_prompt(prompt: str, username: str | None, session_id: str | None) -> None:
    """Log an audit entry when a user triggers a skill via /{skill_name} prompt."""
    if not prompt or not prompt.startswith('/'):
        return
    text = prompt[1:]
    if not text:
        return

    # Extract candidate skill name: valid chars are [a-z0-9-] (ASCII only)
    end = 0
    for ch in text:
        if ('a' <= ch <= 'z') or ('A' <= ch <= 'Z') or ('0' <= ch <= '9') or ch == '-':
            end += 1
        else:
            break
    if end == 0:
        return
    candidate = text[:end].lower()
    args = text[end:].lstrip()

    # Check if skill directory exists — global first (no username needed),
    # then project (requires username). Each wrapped separately so one
    # failure doesn't block the other.
    actor = username or 'anonymous'
    found = False
    try:
        global_dir = _get_skills_dir('global') / candidate
        if global_dir.is_dir():
            found = True
    except Exception:
        pass
    if not found and username:
        try:
            project_dir = _get_skills_dir('project', username) / candidate
            if project_dir.is_dir():
                found = True
        except Exception:
            pass
    if not found:
        return

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=actor,
        action='skill.invoked',
        target=candidate,
        details={
            'session_id': session_id or '',
            'input': {'skill': candidate, 'args': args[:200] + '...' if len(args) > 200 else args},
        },
    ))


def _audit_run_completed(
    username: str | None,
    session_id: str | None,
    usage: dict[str, Any] | None,
    model: str | None,
) -> None:
    """Log an audit entry when an agent run completes successfully."""
    if not usage:
        return
    input_tokens = usage.get("input_tokens", 0) or 0
    output_tokens = usage.get("output_tokens", 0) or 0
    if input_tokens == 0 and output_tokens == 0:
        return
    get_audit_logger().append(AuditEntry(
        actor=username or "anonymous",
        action="agent.run_completed",
        target=session_id or "",
        details={
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "model": model or "",
        },
    ))


def _format_sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


async def agent_run(
    prompt: str,
    session_id: str | None = None,
    permission_mode: PermissionMode | None = None,
    cwd: str | None = None,
    username: str | None = None,
    model_override: str | None = None,
    auth_method: Literal["jwt", "api_key", "anonymous"] = "jwt",
    attachments: list[str] | None = None,
    images: list[dict] | None = None,
    mcp_servers: str | list[str] | None = "auto",
    inject_scheduler_tools: bool = True,
    enable_file_checkpointing: bool = False,
    fork_session: bool = False,
) -> dict[str, Any]:
    # Vision model: check sticky session first, then resolve from config
    vision_model = _get_sticky_vision_model(session_id) or _resolve_vision_model(username, images)
    if vision_model:
        model_override = vision_model

    options = await build_agent_options(
        session_id, permission_mode, cwd=cwd, username=username,
        auth_method=auth_method,
        model_override=model_override, mcp_servers=mcp_servers,
        inject_scheduler_tools=inject_scheduler_tools,
        enable_file_checkpointing=enable_file_checkpointing,
        fork_session=fork_session,
    )
    messages: list[dict[str, Any]] = []
    result_data: dict[str, Any] = {}
    last_model: str | None = model_override
    # Track the CLI-assigned session id across retries — same role as in
    # agent_run_events. See the explanation there.
    current_resume_id: str | None = session_id
    effective_prompt = _build_prompt_with_images(prompt, images, attachments)

    if session_id:
        healed = heal_orphan_tool_uses(session_id, options.cwd)
        if healed:
            logger.info("[RESUME-GUARD] healed %d orphan tool_use(s) in %s", healed, session_id)

    async def _run_one_attempt() -> None:
        nonlocal last_model, current_resume_id
        async with ClaudeSDKClient(options=options) as client:
            _audit_skill_prompt(prompt, username, session_id)
            if isinstance(effective_prompt, list):
                await client.query(_make_image_prompt(effective_prompt))
            else:
                await client.query(effective_prompt)
            async for message in client.receive_response():
                if isinstance(message, SystemMessage) and message.subtype == "init":
                    sid = (message.data or {}).get("session_id")
                    if isinstance(sid, str) and sid:
                        current_resume_id = sid
                    continue
                if isinstance(message, AssistantMessage):
                    if retry.should_retry(message):
                        text_parts = [
                            getattr(b, "text", "") for b in message.content if isinstance(b, TextBlock)
                        ]
                        error_text = " ".join(t for t in text_parts if t).strip() or message.error or "synthetic error"
                        raise retry.RetryableSyntheticError({
                            "code": message.error or "unknown",
                            "message": error_text,
                        })
                    _audit_tool_uses(message, username, session_id)
                    if message.model:
                        last_model = message.model
                    messages.append(serialize_assistant_message(message))
                elif isinstance(message, ResultMessage):
                    result_data.clear()
                    result_data.update(serialize_result_message(message))
                    new_sid = result_data.get("session_id")
                    if isinstance(new_sid, str) and new_sid:
                        current_resume_id = new_sid

            # Grace period for CLI subprocess to flush session JSONL writes
            await asyncio.sleep(1)

    last_error: dict | None = None
    final_attempts = 1
    for attempt in range(1, retry.MAX_ATTEMPTS + 1):
        if attempt > 1:
            delay = retry.backoff(attempt)
            if delay:
                await asyncio.sleep(delay)
            if current_resume_id:
                options.resume = current_resume_id
                try:
                    healed = heal_orphan_tool_uses(current_resume_id, options.cwd)
                    if healed:
                        logger.info(
                            "[RETRY] healed %d orphan tool_use(s) in %s before attempt %d",
                            healed, current_resume_id, attempt,
                        )
                except Exception:
                    logger.exception("[RETRY] heal_orphan_tool_uses failed")
                try:
                    retry.strip_synthetic_records(current_resume_id, options.cwd)
                except Exception:
                    logger.exception("[RETRY] strip_synthetic_records failed")
            messages.clear()
        final_attempts = attempt
        try:
            await _run_one_attempt()
            break
        except retry.RetryableSyntheticError as e:
            last_error = e.payload
            logger.info(
                "[RETRY] agent_run attempt %d/%d failed: %s",
                attempt, retry.MAX_ATTEMPTS, e.payload.get("message"),
            )
            if attempt == retry.MAX_ATTEMPTS:
                break
            continue
        except Exception as e:
            if not retry.should_retry_exception(e):
                raise
            last_error = {
                "code": type(e).__name__,
                "message": str(e) or repr(e),
                "api_error_status": getattr(e, "api_error_status", None),
            }
            logger.exception("[RETRY] agent_run attempt %d raised", attempt)
            if attempt == retry.MAX_ATTEMPTS:
                break
            continue

    # Track vision session for stickiness
    new_sid = result_data.get("session_id")
    _track_vision_session(new_sid, vision_model)

    if last_error and not result_data:
        # All retries failed — return an error result so callers can
        # see a final outcome instead of a silent empty payload.
        result_data = {
            "session_id": session_id,
            "is_error": True,
            "result": last_error.get("message") or "Retries exhausted",
            "api_error_status": last_error.get("api_error_status"),
        }
    else:
        _audit_run_completed(username, new_sid or session_id, result_data.get("usage"), last_model)

    response = {"messages": messages, **result_data, "attempts": final_attempts}
    if last_error:
        response["retried_due_to"] = last_error.get("code")
    return response


async def _pump_stream_messages(
    client: ClaudeSDKClient,
    output_queue: StreamQueue,
    username: str | None = None,
    session_id: str | None = None,
    model_tracker: list[str | None] | None = None,
) -> None:
    try:
        async for message in client.receive_response():
            # Detect synthetic-error messages (CLI exhausted its own retries).
            # Push an internal retry sentinel so the outer loop can decide.
            if isinstance(message, AssistantMessage) and retry.should_retry(message):
                text_parts = [
                    getattr(b, "text", "") for b in message.content if isinstance(b, TextBlock)
                ]
                error_text = " ".join(t for t in text_parts if t).strip() or message.error or "synthetic error"
                await output_queue.put({
                    "_retry_signal": "synthetic",
                    "payload": {
                        "code": message.error or "unknown",
                        "message": error_text,
                    },
                })
                return

            event_label = get_event_label(message)
            if event_label is None:
                continue
            if isinstance(message, AssistantMessage):
                _audit_tool_uses(message, username, session_id)
                if model_tracker is not None and message.model:
                    model_tracker[0] = message.model
            await output_queue.put(
                {
                    "event": event_label,
                    "data": serialize_message(message),
                }
            )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        kind = "exception" if retry.should_retry_exception(exc) else "fatal"
        logger.exception("[PUMP] error during stream (%s)", kind)
        await output_queue.put({
            "_retry_signal": kind,
            "payload": {
                "code": type(exc).__name__,
                "message": str(exc) or repr(exc),
                "api_error_status": getattr(exc, "api_error_status", None),
            },
        })
    finally:
        await output_queue.put(None)


async def agent_run_events(
    prompt: str,
    session_id: str | None = None,
    permission_mode: PermissionMode | None = None,
    cwd: str | None = None,
    username: str | None = None,
    model_override: str | None = None,
    auth_method: Literal["jwt", "api_key", "anonymous"] = "jwt",
    *,
    emit: Callable[[str, dict[str, Any]], Awaitable[None]],
    cancelled: asyncio.Event | None = None,
    coordinator_out: list[PermissionCoordinator | None] | None = None,
    queue_out: list["asyncio.Queue[tuple[str, str, list, list]] | None"] | None = None,
    attachments: list[str] | None = None,
    images: list[dict] | None = None,
    mcp_servers: str | list[str] | None = "auto",
    inject_scheduler_tools: bool = True,
    enable_file_checkpointing: bool = False,
    fork_session: bool = False,
    extra_allowed_tools: list[str] | None = None,
    inject_openclaw_tools: bool = False,
    enable_permission_feedback: bool = False,
) -> None:
    """Run agent and push events to emit callback.

    Args:
        emit: called with (event_type, payload_dict) for each event
        cancelled: set this event to abort the run
        coordinator_out: if provided, coordinator_out[0] is set to the
            PermissionCoordinator instance so the caller can resolve
            permissions externally (WebSocket reader task)
        queue_out: if provided, queue_out[0] is set to an asyncio.Queue
            where callers can enqueue (id, text, attachments, images)
            tuples. Each queued entry is delivered to the model at the
            next tool-result boundary (mid-turn via interrupt) or
            end-of-turn (no interrupt needed).
    """
    # Vision model: check sticky session first, then resolve from config
    vision_model = _get_sticky_vision_model(session_id) or _resolve_vision_model(username, images)
    if vision_model:
        model_override = vision_model

    needs_permissions = True  # streaming runs always need a coordinator
    stream_id = session_id or str(uuid.uuid4())
    # The CLI assigns its own session UUID on every spawn and writes the
    # turn's JSONL under that id. We capture it from the first `system.init`
    # event (or fall back to `result.session_id`) so retries can point
    # options.resume at the same on-disk file — without this, every retry
    # gets a fresh session and the prior attempt's tool history is lost.
    current_resume_id: str | None = session_id
    logger.info("[STREAM] agent_run_events stream_id=%s session_id=%s", stream_id, session_id)
    output_queue: StreamQueue = asyncio.Queue()

    # Mid-stream user-message queue: each entry becomes its own turn, injected
    # at the next tool-result boundary (mid-turn, via interrupt) or at end-of-turn.
    pending_user_msgs: asyncio.Queue[tuple[str, str, list, list]] = asyncio.Queue()
    if queue_out is not None:
        queue_out[0] = pending_user_msgs

    # Use pre-existing coordinator if provided, otherwise create one
    coordinator: PermissionCoordinator | None = (
        coordinator_out[0] if coordinator_out and coordinator_out[0] else None
    )
    if needs_permissions and coordinator is None:
        coordinator = PermissionCoordinator(stream_id, output_queue, owner_username=username)
        if coordinator_out is not None:
            coordinator_out[0] = coordinator
    elif coordinator is not None:
        # Re-wire the existing coordinator to use our output queue
        coordinator.event_queue = output_queue
        coordinator.owner_username = username

    # AskUserQuestion always blocks on the coordinator; other tools follow
    # the mode/risky rules — see _make_unified_can_use_tool. The coordinator
    # is always present now (streaming runs always create one).
    effective_mode = permission_mode or "bypassPermissions"
    risky_list = _risky_list_enabled() if effective_mode == "bypassPermissions" else []
    cut_cb = _make_unified_can_use_tool(
        coordinator, effective_mode, risky_list, enable_permission_feedback
    )

    options = await build_agent_options(
        session_id,
        permission_mode,
        can_use_tool=cut_cb,
        cwd=cwd,
        username=username,
        auth_method=auth_method,
        model_override=model_override,
        mcp_servers=mcp_servers,
        inject_scheduler_tools=inject_scheduler_tools,
        enable_file_checkpointing=enable_file_checkpointing,
        fork_session=fork_session,
        extra_allowed_tools=extra_allowed_tools,
        inject_openclaw_tools=inject_openclaw_tools,
        enable_permission_feedback=enable_permission_feedback,
    )

    if coordinator:
        await emit("stream_init", {"stream_id": stream_id})

    effective_prompt = _build_prompt_with_images(prompt, images, attachments)
    model_tracker: list[str | None] = [model_override]

    if session_id:
        healed = heal_orphan_tool_uses(session_id, options.cwd)
        if healed:
            logger.info("[RESUME-GUARD] healed %d orphan tool_use(s) in %s", healed, session_id)

    async def _run_one_attempt() -> None:
        """Open SDK, query, pump until end-of-turn.

        Raises ``retry.RetryableSyntheticError`` when the pump pushes a
        synthetic-error sentinel or a retryable exception. Returns normally
        on a clean turn (or on a fatal pump exception, which is surfaced
        via a ``stream_error`` emit and not retried).
        """
        nonlocal stream_id, current_resume_id
        retry_signal: dict | None = None

        async with ClaudeSDKClient(options=options) as client:
            _audit_skill_prompt(prompt, username, stream_id)
            if isinstance(effective_prompt, list):
                await client.query(_make_image_prompt(effective_prompt))
            else:
                await client.query(effective_prompt)

            pump_task = asyncio.create_task(
                _pump_stream_messages(client, output_queue, username, stream_id, model_tracker)
            )

            outstanding_tool_uses: set[str] = set()

            async def _flush_next_queued() -> bool:
                """Pop one queued user message and submit it as a new turn."""
                nonlocal pump_task
                try:
                    entry = pending_user_msgs.get_nowait()
                except asyncio.QueueEmpty:
                    return False
                popped_id, popped_text, popped_atts, popped_imgs = entry
                queued_prompt = _build_prompt_with_images(
                    popped_text, popped_imgs or None, popped_atts or None
                )
                if isinstance(queued_prompt, list):
                    await client.query(_make_image_prompt(queued_prompt))
                else:
                    await client.query(queued_prompt)
                await emit("queue_flush", {"id": popped_id, "text": popped_text})
                pump_task = asyncio.create_task(
                    _pump_stream_messages(client, output_queue, username, stream_id, model_tracker)
                )
                return True

            try:
                while not (cancelled and cancelled.is_set()):
                    try:
                        item = await asyncio.wait_for(output_queue.get(), timeout=2.0)
                    except asyncio.TimeoutError:
                        await emit("keepalive", {})
                        continue

                    if item is None:
                        if retry_signal is not None:
                            break
                        if await _flush_next_queued():
                            continue
                        break

                    # Internal retry sentinel — capture and keep draining
                    # until the matching None ends the pump.
                    if isinstance(item, dict) and "_retry_signal" in item:
                        retry_signal = item
                        continue

                    # Capture the CLI-assigned session id from the very first
                    # event that carries it (system.init). This is the file
                    # the CLI is appending to right now — retries must point
                    # options.resume here, not at the original parameter.
                    if item["event"] == "system":
                        sdata = item.get("data") or {}
                        if sdata.get("subtype") == "init":
                            inner = sdata.get("data") if isinstance(sdata.get("data"), dict) else None
                            new_sid = inner.get("session_id") if inner else None
                            if isinstance(new_sid, str) and new_sid and new_sid != current_resume_id:
                                current_resume_id = new_sid
                                if coordinator and new_sid != stream_id:
                                    coordinator.session_id = new_sid
                                    stream_id = new_sid

                    await emit(item["event"], item["data"])

                    # Track tool_use lifecycle so we only interrupt at a
                    # clean boundary (no in-flight parallel tools).
                    evt_data = item.get("data") or {}
                    evt_content = evt_data.get("content")
                    if isinstance(evt_content, list):
                        for block in evt_content:
                            if not isinstance(block, dict):
                                continue
                            btype = block.get("type")
                            if btype == "tool_use" and block.get("id"):
                                outstanding_tool_uses.add(block["id"])
                            elif btype == "tool_result" and block.get("tool_use_id"):
                                outstanding_tool_uses.discard(block["tool_use_id"])

                    if item["event"] == "result":
                        new_sid = item["data"].get("session_id")
                        if new_sid:
                            _track_vision_session(new_sid, vision_model)
                            if new_sid != current_resume_id:
                                current_resume_id = new_sid
                        if coordinator and new_sid and new_sid != stream_id:
                            coordinator.session_id = new_sid
                            stream_id = new_sid
                        _audit_run_completed(
                            username,
                            new_sid or stream_id,
                            item["data"].get("usage"),
                            model_tracker[0],
                        )

                    elif (
                        item["event"] == "tool_result"
                        and not outstanding_tool_uses
                        and not pending_user_msgs.empty()
                    ):
                        await client.interrupt()
            finally:
                pump_task.cancel()
                try:
                    await pump_task
                except asyncio.CancelledError:
                    pass

            await asyncio.sleep(1)

        if retry_signal is not None:
            kind = retry_signal.get("_retry_signal")
            payload = retry_signal.get("payload") or {}
            if kind in ("synthetic", "exception"):
                raise retry.RetryableSyntheticError(payload)
            # Fatal — surface and stop without retry.
            await emit("stream_error", {
                "code": payload.get("code", "unknown"),
                "message": payload.get("message", "Stream error"),
                "fatal": True,
                "api_error_status": payload.get("api_error_status"),
            })

    try:
        last_error: dict | None = None
        for attempt in range(1, retry.MAX_ATTEMPTS + 1):
            if cancelled and cancelled.is_set():
                return
            if attempt > 1:
                delay = retry.backoff(attempt)
                await emit("retry_attempt", {
                    "attempt": attempt,
                    "max_attempts": retry.MAX_ATTEMPTS,
                    "delay_seconds": delay,
                    "error_code": (last_error or {}).get("code"),
                    "message": (last_error or {}).get("message"),
                })
                if delay:
                    try:
                        await asyncio.sleep(delay)
                    except asyncio.CancelledError:
                        raise
                if cancelled and cancelled.is_set():
                    return
                # Resume from the prior attempt's CLI session so its
                # in-flight tool history carries over. Heal any orphan
                # tool_use the failed attempt left behind, then strip the
                # synthetic error rows so the model never sees them in
                # context. Without rotating options.resume here, every
                # retry spawns a fresh CLI session and the work done in
                # the previous attempt is lost.
                if current_resume_id:
                    options.resume = current_resume_id
                    try:
                        healed = heal_orphan_tool_uses(current_resume_id, options.cwd)
                        if healed:
                            logger.info(
                                "[RETRY] healed %d orphan tool_use(s) in %s before attempt %d",
                                healed, current_resume_id, attempt,
                            )
                    except Exception:
                        logger.exception("[RETRY] heal_orphan_tool_uses failed")
                    try:
                        stripped = retry.strip_synthetic_records(current_resume_id, options.cwd)
                        if stripped:
                            logger.info(
                                "[RETRY] stripped %d synthetic record(s) from %s before attempt %d",
                                stripped, current_resume_id, attempt,
                            )
                    except Exception:
                        logger.exception("[RETRY] strip_synthetic_records failed")

            try:
                await _run_one_attempt()
                return
            except retry.RetryableSyntheticError as e:
                last_error = e.payload
                logger.info(
                    "[RETRY] attempt %d/%d failed: %s — %s",
                    attempt, retry.MAX_ATTEMPTS,
                    e.payload.get("code"), e.payload.get("message"),
                )
                continue
            except asyncio.CancelledError:
                raise
            except Exception as e:
                if not retry.should_retry_exception(e):
                    raise
                last_error = {
                    "code": type(e).__name__,
                    "message": str(e) or repr(e),
                    "api_error_status": getattr(e, "api_error_status", None),
                }
                logger.exception("[RETRY] attempt %d/%d raised", attempt, retry.MAX_ATTEMPTS)
                continue

        # Exhausted retries
        await emit("retry_exhausted", {
            "attempts": retry.MAX_ATTEMPTS,
            "error_code": (last_error or {}).get("code"),
            "message": (last_error or {}).get("message") or "Retries exhausted",
            "raw_detail": (last_error or {}).get("message"),
            "api_error_status": (last_error or {}).get("api_error_status"),
        })
    finally:
        if coordinator:
            coordinator.cancel_all()


async def agent_run_stream(
    prompt: str,
    session_id: str | None = None,
    permission_mode: PermissionMode | None = None,
    cwd: str | None = None,
    username: str | None = None,
    model_override: str | None = None,
    auth_method: Literal["jwt", "api_key", "anonymous"] = "jwt",
    attachments: list[str] | None = None,
    images: list[dict] | None = None,
    mcp_servers: str | list[str] | None = "auto",
    inject_scheduler_tools: bool = True,
    mask_output: bool = False,
    enable_file_checkpointing: bool = False,
    fork_session: bool = False,
    enable_permission_feedback: bool = False,
):
    needs_permissions = True  # streaming runs always need a coordinator
    stream_id = session_id or str(uuid.uuid4())
    logger.info("[STREAM] agent_run_stream stream_id=%s session_id=%s", stream_id, session_id)
    coordinator_out: list[PermissionCoordinator | None] = [None]

    if needs_permissions:
        output_queue: StreamQueue = asyncio.Queue()
        coordinator = PermissionCoordinator(stream_id, output_queue, owner_username=username)
        coordinator_out[0] = coordinator
        registry.register(stream_id, coordinator)

    q: asyncio.Queue[str | None] = asyncio.Queue()

    # Read masking patterns once at stream start.
    # Only applies when admin has explicitly saved patterns.
    _mask_patterns: list[dict] = []
    if mask_output:
        try:
            from ..user_store import get_user_store
            runtime = get_user_store().get_runtime_config()
            pii_cfg = runtime.get("pii_masking") or {}
            _mask_patterns = list(pii_cfg.get("patterns") or [])
        except Exception:
            pass

    async def emit_to_queue(event_type: str, data: dict[str, Any]) -> None:
        nonlocal stream_id
        if event_type == "result" and coordinator_out[0]:
            new_sid = data.get("session_id")
            if new_sid and new_sid != stream_id:
                registry.remap_session(stream_id, new_sid, coordinator_out[0])
                stream_id = new_sid
        if event_type == "keepalive":
            await q.put(": keepalive\n\n")
        else:
            out_data = data
            if _mask_patterns and event_type not in ("keepalive", "stream_init", "permission_request", "permission_timeout"):
                from ...utils.sensitive_mask import mask_sensitive
                out_data, _ = mask_sensitive(_mask_patterns, data)
            await q.put(_format_sse_event(event_type, out_data))

    async def run_agent() -> None:
        try:
            try:
                await agent_run_events(
                    prompt, session_id, permission_mode, cwd, username,
                    model_override, auth_method=auth_method,
                    emit=emit_to_queue, coordinator_out=coordinator_out,
                    attachments=attachments, images=images, mcp_servers=mcp_servers,
                    inject_scheduler_tools=inject_scheduler_tools,
                    enable_file_checkpointing=enable_file_checkpointing,
                    fork_session=fork_session,
                    enable_permission_feedback=enable_permission_feedback,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("agent_run_stream: unhandled exception")
                try:
                    await emit_to_queue("stream_error", {
                        "code": type(exc).__name__,
                        "message": str(exc) or repr(exc),
                        "fatal": True,
                        "api_error_status": getattr(exc, "api_error_status", None),
                    })
                except Exception:
                    pass
        finally:
            await q.put(None)

    run_task = asyncio.create_task(run_agent())
    try:
        while True:
            item = await q.get()
            if item is None:
                break
            yield item
    finally:
        run_task.cancel()
        try:
            await run_task
        except asyncio.CancelledError:
            pass
        if coordinator_out[0]:
            coordinator_out[0].cancel_all()
        registry.unregister(stream_id)
