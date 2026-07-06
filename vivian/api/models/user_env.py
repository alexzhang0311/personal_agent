from __future__ import annotations

from pydantic import BaseModel


class UserEnvSettings(BaseModel):
    ANTHROPIC_BASE_URL: str | None = None
    ANTHROPIC_AUTH_TOKEN: str | None = None
    ANTHROPIC_MODEL: str | None = None
    ANTHROPIC_DEFAULT_OPUS_MODEL: str | None = None
    ANTHROPIC_DEFAULT_SONNET_MODEL: str | None = None
    ANTHROPIC_DEFAULT_HAIKU_MODEL: str | None = None


class UserEnvResponse(BaseModel):
    has_env: bool
    env: UserEnvSettings | None = None


class UserEnvUpdateRequest(BaseModel):
    ANTHROPIC_BASE_URL: str | None = None
    ANTHROPIC_AUTH_TOKEN: str | None = None
    ANTHROPIC_MODEL: str | None = None
    ANTHROPIC_DEFAULT_OPUS_MODEL: str | None = None
    ANTHROPIC_DEFAULT_SONNET_MODEL: str | None = None
    ANTHROPIC_DEFAULT_HAIKU_MODEL: str | None = None
