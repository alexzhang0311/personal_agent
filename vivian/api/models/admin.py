from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AuditEntryResponse(BaseModel):
    id: str | None = None
    timestamp: datetime
    actor: str
    action: str
    target: str | None = None
    details: dict = Field(default_factory=dict)


class AuditLogResponse(BaseModel):
    entries: list[AuditEntryResponse]
    next_cursor: str | None = None
    prev_cursor: str | None = None
    total: int | None = None
    limit: int


class UserStatsEntry(BaseModel):
    username: str
    role: str
    session_count: int
    storage_bytes: int
    last_active: datetime | None = None


class AdminStatsResponse(BaseModel):
    total_users: int
    total_sessions: int
    total_storage_bytes: int
    users: list[UserStatsEntry]


class PresetPromptResponse(BaseModel):
    enable: bool = False
    content: str | None = None


class PresetPromptUpdate(BaseModel):
    enable: bool
    content: str | None = None


class CliPathResponse(BaseModel):
    cli_path: str | None = None


class CliPathUpdate(BaseModel):
    cli_path: str | None = None


class HistoryRetentionResponse(BaseModel):
    history_retention_days: int = 7


class HistoryRetentionUpdate(BaseModel):
    history_retention_days: int = 7


class RetryableToolEntry(BaseModel):
    name: str
    max_retries: int = 3
    interval_seconds: int = 30


class RetryCallbackWeComConfig(BaseModel):
    api_url: str = ""
    key: str = ""
    service_name: str = ""


class RetryableToolsResponse(BaseModel):
    retryable_tools: list[RetryableToolEntry] = []
    retry_callback_type: str = "none"
    retry_callback_script: str | None = None
    retry_callback_wecom: RetryCallbackWeComConfig | None = None


class RetryableToolsUpdate(BaseModel):
    retryable_tools: list[RetryableToolEntry] = []
    retry_callback_type: str = "none"
    retry_callback_script: str | None = None
    retry_callback_wecom: RetryCallbackWeComConfig | None = None


class RiskyToolsResponse(BaseModel):
    risky_tool_list: list[str] = []


class RiskyToolsUpdate(BaseModel):
    risky_tool_list: list[str] = []


class SensitivePatternEntry(BaseModel):
    name: str
    pattern: str
    mask: str


class SensitivePatternsResponse(BaseModel):
    enable: bool = False
    patterns: list[SensitivePatternEntry] = []


class SensitivePatternsUpdate(BaseModel):
    enable: bool = False
    patterns: list[SensitivePatternEntry] = []
