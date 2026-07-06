from __future__ import annotations

import dataclasses
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from claude_agent_sdk.types import (
    HookEventMessage,
    RateLimitEvent,
    StreamEvent,
    TaskNotificationMessage,
    TaskProgressMessage,
    TaskStartedMessage,
)

_HOOK_EVENTS_FORWARDED = frozenset({"PreToolUse", "PostToolUse"})

from .retry import SYNTHETIC_MODEL

from ...models.agent import (
    AssistantMessagePayload,
    TextContentBlock,
    ThinkingContentBlock,
    ToolResultContentBlock,
    ToolUseContentBlock,
)


def serialize_block(block: Any) -> dict[str, Any]:
    if isinstance(block, TextBlock):
        return TextContentBlock(text=block.text).model_dump()
    if isinstance(block, ThinkingBlock):
        return ThinkingContentBlock(
            thinking=block.thinking,
            signature=block.signature,
        ).model_dump(exclude_none=True)
    if isinstance(block, ToolUseBlock):
        return ToolUseContentBlock(
            id=block.id,
            name=block.name,
            input=block.input,
        ).model_dump()
    if isinstance(block, ToolResultBlock):
        return ToolResultContentBlock(
            tool_use_id=block.tool_use_id,
            content=block.content,
            is_error=block.is_error or False,
        ).model_dump()
    return dataclasses.asdict(block)


def serialize_assistant_message(message: AssistantMessage) -> dict[str, Any]:
    is_synthetic = message.model == SYNTHETIC_MODEL
    payload = AssistantMessagePayload(
        model=message.model,
        content=[serialize_block(block) for block in message.content],
        parent_tool_use_id=message.parent_tool_use_id,
        error=message.error,
        is_synthetic=True if is_synthetic else None,
    )
    return payload.model_dump(exclude_none=True)


def serialize_rate_limit_event(event: RateLimitEvent) -> dict[str, Any]:
    info = event.rate_limit_info
    return {
        "type": "rate_limit_status",
        "status": getattr(info, "status", None),
        "resets_at": getattr(info, "resets_at", None),
        "utilization": getattr(info, "utilization", None),
        "rate_limit_type": getattr(info, "rate_limit_type", None),
    }


def serialize_result_message(message: ResultMessage) -> dict[str, Any]:
    return {
        "type": "result",
        "session_id": message.session_id,
        "is_error": message.is_error,
        "num_turns": message.num_turns,
        "duration_ms": message.duration_ms,
        "duration_api_ms": message.duration_api_ms,
        "stop_reason": message.stop_reason,
        "total_cost_usd": message.total_cost_usd,
        "usage": message.usage,
        "result": message.result,
        "api_error_status": getattr(message, "api_error_status", None),
    }


def serialize_user_message(message: UserMessage) -> dict[str, Any]:
    content: str | list[dict[str, Any]]
    if isinstance(message.content, str):
        content = message.content
    else:
        content = [serialize_block(block) for block in message.content]
    return {
        "type": "user",
        "content": content,
        "uuid": message.uuid,
        "parent_tool_use_id": message.parent_tool_use_id,
        "tool_use_result": message.tool_use_result,
    }


def serialize_system_message(message: SystemMessage) -> dict[str, Any]:
    return {
        "type": "system",
        "subtype": message.subtype,
        "data": message.data,
    }


def serialize_hook_event(message: HookEventMessage) -> dict[str, Any]:
    return {
        "type": "hook_event",
        "subtype": message.subtype,
        "hook_event_name": message.hook_event_name,
        "session_id": message.session_id,
        "uuid": message.uuid,
        "data": message.data,
    }


def get_assistant_event_label(message: AssistantMessage) -> str:
    for block in message.content:
        if isinstance(block, ToolUseBlock):
            return "tool_use"
        if isinstance(block, ToolResultBlock):
            return "tool_result"
    return "assistant"


def get_event_label(message: Any) -> str | None:
    if isinstance(message, AssistantMessage):
        return get_assistant_event_label(message)
    if isinstance(message, ResultMessage):
        return "result"
    if isinstance(message, UserMessage):
        if message.parent_tool_use_id is None and not getattr(message, "tool_use_result", None):
            return "user_message"
        return "tool_result"
    # HookEventMessage is a SystemMessage subclass — match it first.
    if isinstance(message, HookEventMessage):
        if message.hook_event_name in _HOOK_EVENTS_FORWARDED:
            return "hook_event"
        return None
    if isinstance(message, SystemMessage):
        return "system"
    if isinstance(message, TaskStartedMessage):
        return "task_started"
    if isinstance(message, TaskProgressMessage):
        return "task_progress"
    if isinstance(message, TaskNotificationMessage):
        return "task_notification"
    if isinstance(message, RateLimitEvent):
        return "rate_limit_status"
    if isinstance(message, StreamEvent):
        return None
    return None


def serialize_message(message: Any) -> dict[str, Any]:
    if isinstance(message, AssistantMessage):
        return serialize_assistant_message(message)
    if isinstance(message, ResultMessage):
        return serialize_result_message(message)
    if isinstance(message, UserMessage):
        return serialize_user_message(message)
    # HookEventMessage is a SystemMessage subclass — match it before SystemMessage.
    if isinstance(message, HookEventMessage):
        return serialize_hook_event(message)
    if isinstance(message, SystemMessage):
        return serialize_system_message(message)
    if isinstance(message, RateLimitEvent):
        return serialize_rate_limit_event(message)
    if isinstance(message, (TaskStartedMessage, TaskProgressMessage, TaskNotificationMessage)):
        return {"type": message.subtype, **dataclasses.asdict(message)}
    return dataclasses.asdict(message)
