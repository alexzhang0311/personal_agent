from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

McpServerType = Literal["http", "sse"]
McpLevel = Literal["project", "global"]


class McpHeaderItem(BaseModel):
    key: str
    value: str


class McpServerCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_\-\.]+$")
    type: McpServerType
    url: str = Field(min_length=1)
    headers: list[McpHeaderItem] = Field(default_factory=list)
    timeout: int = Field(default=60, ge=5, le=600)
    level: McpLevel = "project"


class McpServerUpdateRequest(BaseModel):
    type: McpServerType | None = None
    url: str | None = None
    headers: list[McpHeaderItem] | None = None
    timeout: int | None = Field(default=None, ge=5, le=600)


class McpServerSummary(BaseModel):
    name: str
    type: McpServerType
    url: str
    level: McpLevel
    header_count: int = 0
    timeout: int = 60


class McpServerDetail(BaseModel):
    name: str
    type: McpServerType
    url: str
    level: McpLevel
    headers: list[McpHeaderItem] = Field(default_factory=list)
    timeout: int = 60


class McpServerListResponse(BaseModel):
    servers: list[McpServerSummary]


class McpToolSummary(BaseModel):
    name: str
    description: str | None = None
    input_schema: dict[str, Any] | None = None


class McpPromptSummary(BaseModel):
    name: str
    description: str | None = None
    arguments: list[dict[str, Any]] | None = None


class McpResourceSummary(BaseModel):
    name: str
    uri: str
    description: str | None = None
    mime_type: str | None = None


class McpValidateRequest(BaseModel):
    type: McpServerType
    url: str
    headers: list[McpHeaderItem] = Field(default_factory=list)
    timeout: int = Field(default=30, ge=5, le=120)


class McpValidateResponse(BaseModel):
    success: bool
    server_name: str | None = None
    server_version: str | None = None
    tools: list[McpToolSummary] = Field(default_factory=list)
    prompts: list[McpPromptSummary] = Field(default_factory=list)
    resources: list[McpResourceSummary] = Field(default_factory=list)
    error: str | None = None


class McpValidateToolRequest(BaseModel):
    type: McpServerType
    url: str
    headers: list[McpHeaderItem] = Field(default_factory=list)
    timeout: int = Field(default=30, ge=5, le=120)
    tool_name: str
    tool_arguments: dict[str, Any] = Field(default_factory=dict)


class McpValidateToolResponse(BaseModel):
    success: bool
    content: list[dict[str, Any]] = Field(default_factory=list)
    is_error: bool = False
    error: str | None = None


class McpServerCapabilities(BaseModel):
    tools: list[McpToolSummary] = Field(default_factory=list)
    prompts: list[McpPromptSummary] = Field(default_factory=list)
    resources: list[McpResourceSummary] = Field(default_factory=list)
    server_name: str | None = None
    server_version: str | None = None
