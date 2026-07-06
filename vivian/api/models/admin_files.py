from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class FileEntry(BaseModel):
    name: str
    type: Literal["file", "directory"]
    size: int | None = None
    modified: float | None = None
    permissions: str | None = None


class DirectoryListResponse(BaseModel):
    path: str
    parent: str | None = None
    entries: list[FileEntry]


class FilePreviewResponse(BaseModel):
    path: str
    name: str
    mime_type: str
    size: int
    content: str | None = None
    is_binary: bool = False
    preview_url: str | None = None
