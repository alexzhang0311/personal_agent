from __future__ import annotations

from pydantic import BaseModel, Field


class ModelInfo(BaseModel):
    id: str


class ModelListResponse(BaseModel):
    models: list[ModelInfo] = Field(default_factory=list)


class QuickAction(BaseModel):
    name: str
    prompt: str
    icon: str | None = None


class QuickActionListResponse(BaseModel):
    quickactions: list[QuickAction] = Field(default_factory=list)


class QuickActionUpdateRequest(BaseModel):
    quickactions: list[QuickAction]


class VisionModelResponse(BaseModel):
    vision_model: str | None = None


class VisionModelUpdateRequest(BaseModel):
    vision_model: str | None = None
