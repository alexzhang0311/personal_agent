from __future__ import annotations

from pydantic import BaseModel, Field


class PluginInfo(BaseModel):
    id: str
    name: str
    description: str
    enabled: bool = False
    config: dict = Field(default_factory=dict)


class PluginListResponse(BaseModel):
    plugins: list[PluginInfo]


class PluginConfigUpdate(BaseModel):
    enable: bool
    config: dict = Field(default_factory=dict)
