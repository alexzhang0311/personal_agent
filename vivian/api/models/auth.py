from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .user_env import UserEnvSettings


class UserRecord(BaseModel):
    username: str
    password_hash: str
    role: str = "user"
    api_key: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class UsageCounts(BaseModel):
    sessions: int = 0
    messages: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    active_days: int = 0


class UsageStats(BaseModel):
    all: UsageCounts = Field(default_factory=UsageCounts)
    last_30d: UsageCounts = Field(default_factory=UsageCounts)
    last_7d: UsageCounts = Field(default_factory=UsageCounts)


class HeatmapBucket(BaseModel):
    date: str
    count: int


class ModelUsage(BaseModel):
    model: str
    runs: int
    input_tokens: int
    output_tokens: int
    percentage: float


class DailyModelTokens(BaseModel):
    date: str
    by_model: dict[str, int]


class UserPublic(BaseModel):
    username: str
    role: str
    api_key: str | None = None
    workspace: str | None = None
    created_at: datetime
    updated_at: datetime
    stats: UsageStats | None = None
    heatmap: list[HeatmapBucket] | None = None
    model_usage: list[ModelUsage] | None = None
    daily_model_tokens: list[DailyModelTokens] | None = None
    favorite_model: str | None = None
    current_streak: int = 0
    longest_streak: int = 0
    peak_hour: int | None = None
    tagline: str | None = None


class UserCreate(BaseModel):
    username: str
    password: str | None = None
    role: str = "user"
    env: UserEnvSettings | None = None


class UserUpdate(BaseModel):
    password: str | None = None
    role: str | None = None
    api_key: str | None = None
    env: UserEnvSettings | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class SetupRequest(BaseModel):
    username: str
    password: str
    env: UserEnvSettings | None = None


class SetupStatus(BaseModel):
    needs_setup: bool


class TokenPayload(BaseModel):
    sub: str
    role: str
    exp: float


class ApiKeyResponse(BaseModel):
    has_key: bool
    api_key: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)
