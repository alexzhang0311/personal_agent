from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


SkillLevel = Literal["project", "global"]


class SkillSummary(BaseModel):
    name: str
    level: SkillLevel
    description: str | None = None
    file_count: int = 0
    enabled: bool = True


class SkillListResponse(BaseModel):
    skills: list[SkillSummary]


class FileTreeNode(BaseModel):
    name: str
    type: Literal["file", "directory"]
    children: list["FileTreeNode"] | None = None
    size: int | None = None


class SkillDetailResponse(BaseModel):
    name: str
    level: SkillLevel
    description: str | None = None
    frontmatter: dict | None = None
    tree: list[FileTreeNode]
    base_path: str | None = None


class SkillFileResponse(BaseModel):
    path: str
    content: str
    language: str | None = None
    is_binary: bool = False


class SkillUploadResponse(BaseModel):
    name: str
    level: SkillLevel
    message: str


class SkillsConfigRequest(BaseModel):
    skill_exclude: list[str] = Field(
        default_factory=list,
        description="Skill names to exclude from agent runs (denylist).",
    )


class SkillsConfigResponse(BaseModel):
    skill_exclude: list[str] = Field(default_factory=list)
