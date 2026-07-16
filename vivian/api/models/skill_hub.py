from __future__ import annotations

from pydantic import BaseModel, Field

from .skills import FileTreeNode


class HubSkillSummary(BaseModel):
    name: str
    description: str | None = None
    icon: str | None = None
    icon_color: str | None = None
    file_count: int = 0
    installed: bool = False
    publisher: str | None = None


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
    publisher: str | None = None


class HubDeliverResponse(BaseModel):
    name: str
    message: str


class HubSubmissionCreateRequest(BaseModel):
    skill_name: str


class HubSubmissionRejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=1024)


class HubSubmissionSummary(BaseModel):
    id: str
    name: str
    submitter: str
    submitted_at: str
    is_update: bool = False
    description: str | None = None
    file_count: int = 0


class HubSubmissionListResponse(BaseModel):
    submissions: list[HubSubmissionSummary]


class HubSubmissionDetailResponse(HubSubmissionSummary):
    frontmatter: dict | None = None
    tree: list[FileTreeNode]
