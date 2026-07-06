from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


PermissionMode = Literal[
    "default",
    "acceptEdits",
    "plan",
    "bypassPermissions",
    "ask",
    "deny",
]
MemoryMode = Literal["none", "user", "project", "local"]


class SubAgentSummary(BaseModel):
    name: str
    description: str | None = None
    model: str | None = None
    tools_count: int = 0


class SubAgentListResponse(BaseModel):
    agents: list[SubAgentSummary]


class SubAgentDetail(BaseModel):
    name: str
    description: str
    prompt: str = ""
    tools: list[str] = Field(default_factory=list)
    disallowedTools: list[str] = Field(default_factory=list)
    model: str | None = None
    permissionMode: PermissionMode | None = None
    maxTurns: int | None = None
    skills: list[str] = Field(default_factory=list)
    mcpServers: list[Any] = Field(default_factory=list)
    memory: MemoryMode | None = None
    background: bool | None = None


class SubAgentCreateRequest(BaseModel):
    name: str
    description: str
    prompt: str = ""
    tools: list[str] = Field(default_factory=list)
    disallowedTools: list[str] = Field(default_factory=list)
    model: str | None = None
    permissionMode: PermissionMode | None = None
    maxTurns: int | None = None
    skills: list[str] = Field(default_factory=list)
    mcpServers: list[Any] = Field(default_factory=list)
    memory: MemoryMode | None = None
    background: bool | None = None


class SubAgentUpdateRequest(BaseModel):
    new_name: str | None = None
    description: str | None = None
    prompt: str | None = None
    tools: list[str] | None = None
    disallowedTools: list[str] | None = None
    model: str | None = None
    permissionMode: PermissionMode | None = None
    maxTurns: int | None = None
    skills: list[str] | None = None
    mcpServers: list[Any] | None = None
    memory: MemoryMode | None = None
    background: bool | None = None


class SubAgentTestRequest(BaseModel):
    prompt: str = Field(min_length=1)


class SubAgentCatalogSkill(BaseModel):
    name: str
    enabled: bool = True


class SubAgentCatalogResponse(BaseModel):
    tools: list[str]
    skills: list[SubAgentCatalogSkill]
    mcp_servers: list[str]
    reserved_names: list[str]
