from __future__ import annotations

import fcntl
import json
import threading
from pathlib import Path

from ..middleware.logging import get_app_logger
from .config import get_settings

logger = get_app_logger(__name__)

_lock = threading.Lock()

ENV_KEYS = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
]


def _get_work_dir() -> Path:
    settings = get_settings()
    return Path(settings.server.work_dir).expanduser()


def get_user_env_path(username: str) -> Path:
    return _get_work_dir() / username / ".claude" / "settings.local.json"


def read_user_env(username: str) -> dict | None:
    path = get_user_env_path(username)
    if not path.exists():
        return None
    try:
        with open(path, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                data = json.load(f)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
        env = data.get("env")
        if not isinstance(env, dict):
            return None
        return env
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to read user env for {}: {}", username, e)
        return None


def write_user_env(username: str, env: dict) -> None:
    path = get_user_env_path(username)
    path.parent.mkdir(parents=True, exist_ok=True)

    # Read existing data to preserve non-env fields
    existing = {}
    if path.exists():
        try:
            with open(path, "r") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    existing = json.load(f)
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except (json.JSONDecodeError, OSError):
            existing = {}

    # Merge env: only update provided keys
    current_env = existing.get("env", {}) if isinstance(existing.get("env"), dict) else {}
    for key in ENV_KEYS:
        if key in env and env[key] is not None:
            current_env[key] = env[key]
        elif key not in current_env:
            current_env[key] = ""

    existing["env"] = current_env

    with _lock:
        with open(path, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                json.dump(existing, f, indent=2)
                f.write("\n")
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)


def has_user_env(username: str) -> bool:
    env = read_user_env(username)
    if env is None:
        return False
    # Must have at least base_url and auth_token
    return bool(env.get("ANTHROPIC_BASE_URL")) and bool(env.get("ANTHROPIC_AUTH_TOKEN"))


def mask_token(token: str | None) -> str | None:
    if not token:
        return token
    if len(token) <= 8:
        return "****"
    return token[:3] + "****" + token[-4:]
