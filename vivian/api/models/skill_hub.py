from __future__ import annotations

from pydantic import BaseModel

from .skills import FileTreeNode


class HubSkillSummary(BaseModel):
    name: str
    description: str | None = None
    icon: str | None = None
    icon_color: str | None = None
    file_count: int = 0
    installed: bool = False


class HubSkillListResponse(BaseModel):
    skills: list[HubSkillSummary]


class HubSkillDetailResponse(BaseModel):
    name: str
    description: str | None = None
    icon: str | None = None
    icon_color: str | None = None
    frontmatter: dict | None = None
    tree: list[FileTreeNode]
    installed: bool = False


class HubDeliverResponse(BaseModel):
    name: str
    message: str
