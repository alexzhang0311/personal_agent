from __future__ import annotations

from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class HookHandler(BaseModel):
    """A single hook handler definition, matching Claude Code's native format."""

    type: Literal["command", "http", "prompt", "agent"]
    command: str | None = None
    url: str | None = None
    prompt: str | None = None
    timeout: int = 30
    model: str | None = None
    headers: dict[str, str] | None = None
    allowedEnvVars: list[str] | None = None


class HookEntry(BaseModel):
    """A hook entry binding a matcher pattern to one or more handlers."""

    matcher: str | None = None
    hooks: list[HookHandler]


class HookConfig(BaseModel):
    """Full hooks config matching Claude Code's .claude/settings.json format."""

    hooks: dict[str, list[HookEntry]]


class BuiltInHookInfo(BaseModel):
    """Metadata for a built-in hook exposed by the API."""

    id: str
    name: str
    description: str
    supported_events: list[str]
    default_matcher: str | None = None
    can_block: bool = False
    enabled_by_default: bool = False
    enforced: bool = False  # admin has enforced this
    enabled: bool = False  # user has enabled this
    source_code: str | None = None  # Python function source


class HookTestRequest(BaseModel):
    """Request to dry-run a hook handler with sample input."""

    event_type: str
    handler: HookHandler
    input_json: dict = Field(default_factory=dict)


class HookTestResponse(BaseModel):
    """Result of a hook dry-run."""

    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int


class HookTestByIdRequest(BaseModel):
    """Test a built-in hook by its ID with sample input."""

    hook_id: str
    event_type: str
    input_json: dict = Field(default_factory=dict)


class BuiltInHookTestResponse(BaseModel):
    """Result of testing a built-in hook."""

    hook_id: str
    decision: str | None = None  # "allow", "deny", "ask", or None
    reason: str | None = None
    output: dict = Field(default_factory=dict)  # full hook return value
    duration_ms: int
    error: str | None = None


class HookLogEntry(BaseModel):
    """A single hook execution log record."""

    id: str = Field(default_factory=lambda: uuid4().hex)
    timestamp: str
    event_type: str
    matcher: str | None = None
    handler_type: str
    exit_code: int
    duration_ms: int
    tool_name: str | None = None
    error: str | None = None


class HookLogsResponse(BaseModel):
    """Cursor-paginated response for hook execution logs."""

    entries: list[HookLogEntry]
    next_cursor: str | None = None
    prev_cursor: str | None = None
    total: int | None = None
    limit: int
