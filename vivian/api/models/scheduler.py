from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator


# --- Trigger configs ---

class IntervalTriggerConfig(BaseModel):
    type: Literal["interval"] = "interval"
    weeks: int = 0
    days: int = 0
    hours: int = 0
    minutes: int = 0
    seconds: int = 0


class CronTriggerConfig(BaseModel):
    type: Literal["cron"] = "cron"
    expr: str  # Standard 5-field cron: "minute hour day month day_of_week"


TriggerConfig = IntervalTriggerConfig | CronTriggerConfig


# --- Job config types (discriminated union on job_type) ---

class AgentRunConfig(BaseModel):
    job_type: Literal["scheduled_agent"] = "scheduled_agent"
    prompt: str
    model: str | None = None


class HttpCallConfig(BaseModel):
    job_type: Literal["http_call"] = "http_call"
    method: Literal["GET", "POST", "PUT", "DELETE"] = "GET"
    url: str
    headers: dict[str, str] = {}
    body: str | None = None
    timeout_seconds: int = 30


class UserScriptConfig(BaseModel):
    job_type: Literal["user_script"] = "user_script"
    language: Literal["python", "shell"] = "python"
    source: Literal["file", "inline"] = "file"
    file_path: str | None = None
    script: str | None = None
    timeout_seconds: int = 300


class ToolRetryConfig(BaseModel):
    job_type: Literal["tool_retry"] = "tool_retry"
    tool_name: str          # Full MCP tool name: "mcp__slack__send_message"
    tool_input: dict        # Original tool arguments
    session_id: str = ""    # Original agent session for traceability
    max_retries: int = 3
    interval_seconds: int = 30
    original_error: str = ""


JobConfig = Annotated[
    AgentRunConfig | HttpCallConfig | UserScriptConfig | ToolRetryConfig,
    Field(discriminator="job_type"),
]


# --- Job definition (stored in YAML) ---

class ScheduledJobDefinition(BaseModel):
    id: str
    name: str
    prompt: str = ""
    trigger: TriggerConfig
    timezone: str  # IANA timezone, e.g. "Asia/Shanghai"
    status: Literal["active", "paused"] = "active"
    model: str | None = None
    job_config: AgentRunConfig | HttpCallConfig | UserScriptConfig | ToolRetryConfig | None = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

    @model_validator(mode="before")
    @classmethod
    def _backcompat_prompt_to_config(cls, data):
        """If no job_config but prompt present, synthesize AgentRunConfig."""
        if isinstance(data, dict):
            # Rewrite legacy job_type "agent_run" -> "scheduled_agent" so
            # existing YAML keeps loading after the rename.
            jc = data.get("job_config")
            if isinstance(jc, dict) and jc.get("job_type") == "agent_run":
                jc["job_type"] = "scheduled_agent"

            if not data.get("job_config") and data.get("prompt"):
                data["job_config"] = {
                    "job_type": "scheduled_agent",
                    "prompt": data["prompt"],
                    "model": data.get("model"),
                }
            jc = data.get("job_config")
            if isinstance(jc, dict) and jc.get("job_type") == "scheduled_agent" and not data.get("prompt"):
                data["prompt"] = jc.get("prompt", "")
        return data


# --- API request/response models ---

class CreateJobRequest(BaseModel):
    name: str
    prompt: str = ""
    trigger: TriggerConfig
    timezone: str  # Required — frontend defaults to browser TZ
    status: Literal["active", "paused"] = "active"
    model: str | None = None
    job_config: AgentRunConfig | HttpCallConfig | UserScriptConfig | None = None

    @model_validator(mode="before")
    @classmethod
    def _backcompat(cls, data):
        if isinstance(data, dict):
            jc = data.get("job_config")
            if isinstance(jc, dict) and jc.get("job_type") == "agent_run":
                jc["job_type"] = "scheduled_agent"

            if not data.get("job_config") and data.get("prompt"):
                data["job_config"] = {
                    "job_type": "scheduled_agent",
                    "prompt": data["prompt"],
                    "model": data.get("model"),
                }
        return data


class UpdateJobRequest(BaseModel):
    name: str | None = None
    prompt: str | None = None
    trigger: TriggerConfig | None = None
    timezone: str | None = None
    status: Literal["active", "paused"] | None = None
    model: str | None = None
    job_config: AgentRunConfig | HttpCallConfig | UserScriptConfig | None = None


class ScheduledJobResponse(BaseModel):
    id: str
    name: str
    prompt: str = ""
    trigger: TriggerConfig
    timezone: str
    status: Literal["active", "paused"]
    model: str | None = None
    job_config: AgentRunConfig | HttpCallConfig | UserScriptConfig | None = None
    created_at: datetime
    updated_at: datetime
    next_run_time: str | None = None
    username: str


class ScheduledJobListResponse(BaseModel):
    jobs: list[ScheduledJobResponse]
    total: int


# --- Run history ---

class JobRunRecord(BaseModel):
    run_id: str
    job_id: str
    job_name: str
    username: str
    started_at: datetime = Field(default_factory=datetime.now)
    finished_at: datetime | None = None
    status: Literal["running", "success", "error", "cancelled", "skipped"] = "running"
    duration_ms: int | None = None
    is_error: bool = False
    error_message: str | None = None
    num_turns: int | None = None
    total_cost_usd: float | None = None
    result_summary: str | None = None
    session_id: str | None = None


class JobRunHistoryResponse(BaseModel):
    runs: list[JobRunRecord]
    next_cursor: str | None = None
    prev_cursor: str | None = None
    total: int | None = None
    limit: int


# --- Running tasks ---

class RunningTaskInfo(BaseModel):
    run_id: str
    job_id: str
    job_name: str
    username: str
    started_at: datetime
    elapsed_ms: int


class RunningTasksResponse(BaseModel):
    running: list[RunningTaskInfo]
    total: int


# --- Health ---

class SchedulerHealthResponse(BaseModel):
    healthy: bool
    last_heartbeat: str | None = None
    running_count: int = 0
    history_retention_days: int = 7
