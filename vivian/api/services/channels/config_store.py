from __future__ import annotations

import fcntl
import os
import tempfile
import threading
from typing import Any
from pathlib import Path

import yaml

from ..config import get_settings
from ..user_store import get_user_store
from ...models.channels import OpenClawChannelConfig, WeComChannelConfig
from ...middleware.logging import get_channels_logger

logger = get_channels_logger(__name__)


def _get_work_dir() -> Path:
    settings = get_settings()
    return Path(settings.server.work_dir).expanduser()


def _get_user_config_path(username: str) -> Path:
    return _get_work_dir() / username / ".vivian.user.yml"


class ChannelConfigStore:
    def __init__(self):
        self._lock = threading.Lock()

    def get_config(self, username: str) -> WeComChannelConfig:
        path = _get_user_config_path(username)
        if not path.exists():
            return WeComChannelConfig()

        try:
            with open(path, "r") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    data = yaml.safe_load(f) or {}
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            logger.warning("Failed to read channel config for user {}", username)
            return WeComChannelConfig()

        channels = data.get("channels", {})
        if not isinstance(channels, dict):
            return WeComChannelConfig()

        wecom = channels.get("wecom", {})
        if not isinstance(wecom, dict):
            return WeComChannelConfig()

        try:
            return WeComChannelConfig.model_validate(wecom)
        except Exception:
            logger.warning("Invalid channel config for user {}, using defaults", username)
            return WeComChannelConfig()

    def save_config(self, username: str, config: WeComChannelConfig) -> None:
        path = _get_user_config_path(username)
        path.parent.mkdir(parents=True, exist_ok=True)

        with self._lock:
            # Read existing data to preserve sibling keys
            existing = {}
            if path.exists():
                try:
                    with open(path, "r") as f:
                        fcntl.flock(f, fcntl.LOCK_SH)
                        try:
                            existing = yaml.safe_load(f) or {}
                        finally:
                            fcntl.flock(f, fcntl.LOCK_UN)
                except Exception:
                    existing = {}

            # Ensure channels dict exists, preserve siblings
            if "channels" not in existing or not isinstance(existing["channels"], dict):
                existing["channels"] = {}

            existing["channels"]["wecom"] = config.model_dump(mode="json")

            # Atomic write: temp file + os.replace()
            fd, tmp_path = tempfile.mkstemp(
                dir=path.parent, suffix=".tmp", prefix=".vivian.user."
            )
            try:
                with os.fdopen(fd, "w") as f:
                    fcntl.flock(f, fcntl.LOCK_EX)
                    try:
                        yaml.dump(existing, f, default_flow_style=False, allow_unicode=True)
                    finally:
                        fcntl.flock(f, fcntl.LOCK_UN)
                os.replace(tmp_path, path)
            except Exception:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise

    # -- Generic .vivian.user.yml key accessors --

    def _read_user_yaml(self, username: str) -> dict:
        """Read full .vivian.user.yml as a dict."""
        path = _get_user_config_path(username)
        if not path.exists():
            return {}
        try:
            with open(path, "r") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    return yaml.safe_load(f) or {}
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            logger.warning("Failed to read user yaml for {}", username)
            return {}

    def get_user_yaml_key(self, username: str, key: str, default: Any = None) -> Any:
        """Read a top-level key from .vivian.user.yml."""
        return self._read_user_yaml(username).get(key, default)

    def save_user_yaml_key(self, username: str, key: str, value: Any) -> None:
        """Atomically set (or delete, when ``value`` is ``None``) a top-level
        key in .vivian.user.yml. Passing ``None`` pops the key entirely."""
        path = _get_user_config_path(username)
        path.parent.mkdir(parents=True, exist_ok=True)

        with self._lock:
            existing = self._read_user_yaml(username)
            if value is None:
                existing.pop(key, None)
            else:
                existing[key] = value

            fd, tmp_path = tempfile.mkstemp(
                dir=path.parent, suffix=".tmp", prefix=".vivian.user."
            )
            try:
                with os.fdopen(fd, "w") as f:
                    fcntl.flock(f, fcntl.LOCK_EX)
                    try:
                        yaml.dump(existing, f, default_flow_style=False, allow_unicode=True)
                    finally:
                        fcntl.flock(f, fcntl.LOCK_UN)
                os.replace(tmp_path, path)
            except Exception:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise

    def _list_global_skill_names(self) -> list[str]:
        """Filesystem walk of ~/.claude/skills/ — used by migration only."""
        global_dir = Path.home() / ".claude" / "skills"
        if not global_dir.exists():
            return []
        names: list[str] = []
        try:
            for entry in global_dir.iterdir():
                if entry.is_dir() and (entry / "SKILL.md").exists():
                    names.append(entry.name)
        except OSError:
            return []
        return names

    def get_skill_exclude(self, username: str) -> list[str]:
        """Return the skill_exclude denylist for ``username``.

        Lazily migrates legacy ``enable_global_skills`` into ``skill_exclude``
        on first read:
        - ``'auto'`` / unset → ``[]`` (nothing excluded)
        - ``['a', 'b']`` (allowlist) → exclude every currently-discovered
          global skill not in the list
        - ``null`` / ``[]`` → exclude every currently-discovered global skill
        """
        raw = self._read_user_yaml(username)
        if "skill_exclude" in raw:
            value = raw.get("skill_exclude")
            return list(value) if isinstance(value, list) else []

        if "enable_global_skills" not in raw:
            return []

        legacy = raw.get("enable_global_skills")
        discovered = self._list_global_skill_names()
        if legacy == "auto":
            migrated: list[str] = []
        elif legacy is None or legacy == [] or legacy == "":
            migrated = list(discovered)
        elif isinstance(legacy, list):
            allowed = set(legacy)
            migrated = [n for n in discovered if n not in allowed]
        else:
            migrated = []

        self.save_user_yaml_key(username, "skill_exclude", migrated)
        self.save_user_yaml_key(username, "enable_global_skills", None)
        return migrated

    def save_skill_exclude(self, username: str, value: list[str]) -> None:
        """Write the explicit skill_exclude denylist."""
        self.save_user_yaml_key(username, "skill_exclude", list(value or []))

    # -- OpenClaw config (stored under channels.openclaw) --

    def get_openclaw_config(self, username: str) -> OpenClawChannelConfig:
        path = _get_user_config_path(username)
        if not path.exists():
            return OpenClawChannelConfig()

        try:
            with open(path, "r") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    data = yaml.safe_load(f) or {}
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            logger.warning("Failed to read openclaw config for user {}", username)
            return OpenClawChannelConfig()

        channels = data.get("channels", {})
        if not isinstance(channels, dict):
            return OpenClawChannelConfig()

        openclaw = channels.get("openclaw", {})
        if not isinstance(openclaw, dict):
            return OpenClawChannelConfig()

        try:
            return OpenClawChannelConfig.model_validate(openclaw)
        except Exception:
            logger.warning("Invalid openclaw config for user {}, using defaults", username)
            return OpenClawChannelConfig()

    def save_openclaw_config(self, username: str, config: OpenClawChannelConfig) -> None:
        path = _get_user_config_path(username)
        path.parent.mkdir(parents=True, exist_ok=True)

        with self._lock:
            existing = {}
            if path.exists():
                try:
                    with open(path, "r") as f:
                        fcntl.flock(f, fcntl.LOCK_SH)
                        try:
                            existing = yaml.safe_load(f) or {}
                        finally:
                            fcntl.flock(f, fcntl.LOCK_UN)
                except Exception:
                    existing = {}

            if "channels" not in existing or not isinstance(existing["channels"], dict):
                existing["channels"] = {}

            existing["channels"]["openclaw"] = config.model_dump(mode="json")

            fd, tmp_path = tempfile.mkstemp(
                dir=path.parent, suffix=".tmp", prefix=".vivian.user."
            )
            try:
                with os.fdopen(fd, "w") as f:
                    fcntl.flock(f, fcntl.LOCK_EX)
                    try:
                        yaml.dump(existing, f, default_flow_style=False, allow_unicode=True)
                    finally:
                        fcntl.flock(f, fcntl.LOCK_UN)
                os.replace(tmp_path, path)
            except Exception:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise

    def list_enabled_openclaw_configs(self) -> dict[str, OpenClawChannelConfig]:
        """Return {username: config} for all users with openclaw enabled=True."""
        store = get_user_store()
        users = store.list_users()
        result = {}
        for user in users:
            config = self.get_openclaw_config(user.username)
            if config.enabled:
                result[user.username] = config
        return result

    def list_enabled_configs(self) -> dict[str, WeComChannelConfig]:
        """Return {username: config} for all users with enabled=True."""
        store = get_user_store()
        users = store.list_users()
        result = {}
        for user in users:
            config = self.get_config(user.username)
            if config.enabled:
                result[user.username] = config
        return result

    def find_bot_id_owner(self, bot_id: str, exclude_username: str | None = None) -> str | None:
        """Check if any user already has this bot_id with enabled=True. Returns username or None."""
        if not bot_id:
            return None
        store = get_user_store()
        users = store.list_users()
        for user in users:
            if exclude_username and user.username == exclude_username:
                continue
            config = self.get_config(user.username)
            if config.enabled and config.bot_id == bot_id:
                return user.username
        return None


_store: ChannelConfigStore | None = None


def get_channel_config_store() -> ChannelConfigStore:
    global _store
    if _store is None:
        _store = ChannelConfigStore()
    return _store
