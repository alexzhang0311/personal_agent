from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, ClassVar

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, YamlConfigSettingsSource


class ServerSettings(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8001
    debug: bool = False
    work_dir: str = "~/vivian_workspace"


class AuthSettings(BaseModel):
    jwt_secret: str = "sk-vivian"
    jwt_expire_hours: int = 24
    default_password: str = "vivian"
    admins: list[str] = Field(default_factory=lambda: ["admin"])
    global_api_key: str | None = None
    enable_anonymous: bool = False


class LoggingTargetSettings(BaseModel):
    path: str
    rotation_time: str
    rotation_size: str
    retention: str
    format: str
    level: str
    compression: str


class LoggingSettings(BaseModel):
    access: LoggingTargetSettings = Field(
        default_factory=lambda: LoggingTargetSettings(
            path="logs/access.log",
            rotation_time="00:00",
            rotation_size="50 MB",
            retention="7 days",
            format="{time:YYYY-MM-DD HH:mm:ss:SSS} | {level: <8} | {extra[client_ip]} | {extra[method]} | {extra[path]} | {extra[status_code]} | {extra[duration_ms]}ms | {extra[user_name]}",
            level="INFO",
            compression="gz",
        )
    )
    server: LoggingTargetSettings = Field(
        default_factory=lambda: LoggingTargetSettings(
            path="logs/server.log",
            rotation_time="00:00",
            rotation_size="50 MB",
            retention="7 days",
            format="{time:YYYY-MM-DD HH:mm:ss:SSS} | {level: <8} | PID:{process} | {name}:{function}:{line} | {message}",
            level="DEBUG",
            compression="gz",
        )
    )
    app: LoggingTargetSettings = Field(
        default_factory=lambda: LoggingTargetSettings(
            path="logs/app.log",
            rotation_time="00:00",
            rotation_size="50 MB",
            retention="30 days",
            format="{time:YYYY-MM-DD HH:mm:ss:SSS} | {message}",
            level="INFO",
            compression="gz",
        )
    )
    scheduler: LoggingTargetSettings = Field(
        default_factory=lambda: LoggingTargetSettings(
            path="logs/scheduler.log",
            rotation_time="00:00",
            rotation_size="50 MB",
            retention="30 days",
            format="{time:YYYY-MM-DD HH:mm:ss:SSS} | {level: <8} | {name}:{function}:{line} | {message}",
            level="INFO",
            compression="gz",
        )
    )
    channels: LoggingTargetSettings = Field(
        default_factory=lambda: LoggingTargetSettings(
            path="logs/channels.log",
            rotation_time="00:00",
            rotation_size="50 MB",
            retention="30 days",
            format="{time:YYYY-MM-DD HH:mm:ss:SSS} | {level: <8} | {name}:{function}:{line} | {message}",
            level="INFO",
            compression="gz",
        )
    )


class SchedulerSettings(BaseModel):
    shutdown_timeout: int = 60
    command_poll_interval: float = 1.0
    heartbeat_interval: float = 5.0


class ChannelsSettings(BaseModel):
    command_poll_interval: float = 1.0
    heartbeat_interval: float = 5.0
    shutdown_timeout: int = 30


class PtySettings(BaseModel):
    enabled: bool = False
    max_sessions_per_user: int = 3
    idle_timeout_seconds: int = 600
    absolute_timeout_seconds: int = 7200
    output_rate_limit_bytes_per_sec: int = 1_000_000
    max_cols: int = 500
    max_rows: int = 200
    rlimit_cpu_seconds: int = 600
    rlimit_as_bytes: int = 2 * 1024 * 1024 * 1024
    rlimit_fsize_bytes: int = 100 * 1024 * 1024
    rlimit_nofile: int = 1024
    shell: str = ""


class AgentSettings(BaseModel):
    permission_timeout_seconds: int = 600


class Settings(BaseSettings):
    app_name: str = "TCTP vivian API Server"
    # Backward-compatible input only: preserved production config files may
    # still contain app_version. Runtime code must read the root VERSION file.
    legacy_app_version: str | None = Field(
        default=None,
        validation_alias="app_version",
        exclude=True,
        repr=False,
    )
    server: ServerSettings = Field(default_factory=ServerSettings)
    auth: AuthSettings = Field(default_factory=AuthSettings)
    logging: LoggingSettings = Field(default_factory=LoggingSettings)
    scheduler: SchedulerSettings = Field(default_factory=SchedulerSettings)
    channels: ChannelsSettings = Field(default_factory=ChannelsSettings)
    pty: PtySettings = Field(default_factory=PtySettings)
    agent: AgentSettings = Field(default_factory=AgentSettings)

    yaml_file: ClassVar[Path] = Path(__file__).parent.parent / "config.yaml"

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            YamlConfigSettingsSource(settings_cls, yaml_file=cls.yaml_file),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
