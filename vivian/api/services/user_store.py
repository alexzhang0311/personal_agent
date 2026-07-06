from __future__ import annotations

import fcntl
import threading
from datetime import datetime
from pathlib import Path

import bcrypt
import yaml

from ..middleware.logging import get_app_logger
from ..models.auth import UserRecord
from ..utils.crypto import decrypt_value, encrypt_value
from .paths import vivian_home

logger = get_app_logger(__name__)


def _settings_path() -> Path:
    return vivian_home() / ".vivian.settings.yml"


class UserStore:
    def __init__(self, path: Path | None = None):
        self._path = path if path is not None else _settings_path()
        self._lock = threading.Lock()

    def _load(self) -> dict:
        if not self._path.exists():
            return {"users": {}}
        with open(self._path, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                data = yaml.safe_load(f) or {}
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
        if "users" not in data:
            data["users"] = {}
        return data

    def _save(self, data: dict) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)

    def has_users(self) -> bool:
        data = self._load()
        return len(data["users"]) > 0

    def get_user(self, username: str) -> UserRecord | None:
        data = self._load()
        user_data = data["users"].get(username)
        if user_data is None:
            return None
        return UserRecord(
            username=username,
            **{**user_data, "api_key": decrypt_value(user_data.get("api_key"))},
        )

    def list_users(self) -> list[UserRecord]:
        data = self._load()
        return [
            UserRecord(
                username=name,
                **{**info, "api_key": decrypt_value(info.get("api_key"))},
            )
            for name, info in data["users"].items()
        ]

    def create_user(self, username: str, password: str, role: str = "user") -> UserRecord:
        with self._lock:
            data = self._load()
            if username in data["users"]:
                raise ValueError(f"User '{username}' already exists")
            now = datetime.utcnow().isoformat()
            password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            data["users"][username] = {
                "password_hash": password_hash,
                "role": role,
                "api_key": None,
                "created_at": now,
                "updated_at": now,
            }
            self._save(data)
            return self.get_user(username)

    def update_user(self, username: str, password: str | None = None, role: str | None = None, api_key: str | None = ...) -> UserRecord:
        with self._lock:
            data = self._load()
            if username not in data["users"]:
                raise ValueError(f"User '{username}' not found")
            user = data["users"][username]
            if password is not None:
                user["password_hash"] = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            if role is not None:
                user["role"] = role
            if api_key is not ...:
                user["api_key"] = encrypt_value(api_key)
            user["updated_at"] = datetime.utcnow().isoformat()
            self._save(data)
            return self.get_user(username)

    def delete_user(self, username: str) -> None:
        with self._lock:
            data = self._load()
            if username not in data["users"]:
                raise ValueError(f"User '{username}' not found")
            del data["users"][username]
            self._save(data)

    def verify_password(self, username: str, password: str) -> bool:
        user = self.get_user(username)
        if user is None:
            return False
        return bcrypt.checkpw(password.encode(), user.password_hash.encode())

    def find_by_api_key(self, key: str) -> UserRecord | None:
        data = self._load()
        for name, info in data["users"].items():
            stored = info.get("api_key")
            if not stored:
                continue
            if decrypt_value(stored) == key:
                return UserRecord(username=name, **{**info, "api_key": key})
        return None

    def count_admins(self) -> int:
        data = self._load()
        return sum(1 for info in data["users"].values() if info.get("role") == "admin")

    def get_runtime_config(self) -> dict:
        data = self._load()
        runtime = data.get("runtime", {})
        # Lazy migration: sensitive_data_patterns -> pii_masking.{enable,patterns}.
        # Default enable=False so existing users keep the SSE-only mask behavior
        # they already see (patterns still feed the outbound mask path).
        if (
            isinstance(runtime, dict)
            and "sensitive_data_patterns" in runtime
            and "pii_masking" not in runtime
        ):
            patterns = runtime.get("sensitive_data_patterns") or []
            with self._lock:
                disk = self._load()
                disk_runtime = disk.setdefault("runtime", {})
                if (
                    "sensitive_data_patterns" in disk_runtime
                    and "pii_masking" not in disk_runtime
                ):
                    disk_runtime["pii_masking"] = {
                        "enable": False,
                        "patterns": patterns,
                    }
                    disk_runtime.pop("sensitive_data_patterns", None)
                    self._save(disk)
                runtime = disk.get("runtime", {})
        return runtime

    def update_runtime_config(self, key: str, value: dict | None) -> dict:
        # Known runtime keys (schemaless dict; each feature owns its own schema):
        #   cli_path               : str | None
        #   append_systemprompt    : dict {enable, content}
        #   history_retention_days : int
        #   retryable_tools        : list[dict]
        #   risky_tool_list        : list[str] -- Claude Code permission DSL
        #                            patterns forcing user approval in
        #                            bypassPermissions mode.
        #   pii_masking            : dict {enable, patterns}
        # Passing value=None removes the key.
        with self._lock:
            data = self._load()
            runtime = data.setdefault("runtime", {})
            if value is None:
                runtime.pop(key, None)
            else:
                runtime[key] = value
            self._save(data)
            return data["runtime"]


_store: UserStore | None = None


def get_user_store() -> UserStore:
    global _store
    if _store is None:
        _store = UserStore()
    return _store
