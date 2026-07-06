"""Read/write hook configuration in .claude/settings.json and .claude/settings.local.json.

These files use Claude Code's native JSON format so both Vivian and the CLI
read the same hook definitions.
"""

from __future__ import annotations

import fcntl
import json
import threading
from pathlib import Path

from ...middleware.logging import get_app_logger

logger = get_app_logger(__name__)

_VIVIAN_ENFORCED_KEY = "__vivian_enforced"
_lock = threading.Lock()


class HookConfigManager:
    """Manage hook entries inside Claude Code settings files for a given cwd."""

    def __init__(self, cwd: str):
        self.cwd = Path(cwd)
        self.project_settings = self.cwd / ".claude" / "settings.json"
        self.local_settings = self.cwd / ".claude" / "settings.local.json"

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    def read_project_hooks(self) -> dict:
        """Read hooks from .claude/settings.json (shared / admin-enforced)."""
        return self._read_hooks(self.project_settings)

    def read_local_hooks(self) -> dict:
        """Read hooks from .claude/settings.local.json (user-managed)."""
        return self._read_hooks(self.local_settings)

    def read_merged(self) -> dict:
        """Merge project + local hooks.  Project hooks appear first per event."""
        project = self.read_project_hooks()
        local = self.read_local_hooks()
        merged: dict = {}
        all_events = set(project.keys()) | set(local.keys())
        for event in sorted(all_events):
            merged[event] = project.get(event, []) + local.get(event, [])
        return merged

    # ------------------------------------------------------------------
    # Writes — user hooks go to settings.local.json
    # ------------------------------------------------------------------

    def write_local_hooks(self, hooks: dict) -> None:
        """Write user hooks to .claude/settings.local.json.

        Preserves all non-hooks keys already in the file (e.g. ``env``).
        """
        self._write_hooks(self.local_settings, hooks)

    # ------------------------------------------------------------------
    # Admin enforcement — settings.json
    # ------------------------------------------------------------------

    def ensure_admin_hooks(self, admin_hooks: dict) -> None:
        """Ensure admin-enforced hooks exist in .claude/settings.json.

        Each injected entry is tagged with ``__vivian_enforced: true`` so we
        can distinguish admin entries from manually-added project entries.
        Re-injects any missing/tampered admin entries.
        """
        existing = self._read_file(self.project_settings)
        current_hooks: dict = existing.get("hooks", {})

        for event, entries in admin_hooks.items():
            current_list: list = current_hooks.get(event, [])

            # Remove stale enforced entries so we can re-inject cleanly
            current_list = [
                e for e in current_list if not (isinstance(e, dict) and e.get(_VIVIAN_ENFORCED_KEY))
            ]

            # Inject admin entries
            for entry in entries:
                tagged = dict(entry) if isinstance(entry, dict) else entry
                tagged[_VIVIAN_ENFORCED_KEY] = True
                current_list.insert(0, tagged)

            current_hooks[event] = current_list

        existing["hooks"] = current_hooks
        self._write_file(self.project_settings, existing)

    def read_admin_hooks(self) -> dict:
        """Return only the admin-enforced hooks from .claude/settings.json."""
        all_hooks = self._read_hooks(self.project_settings)
        admin: dict = {}
        for event, entries in all_hooks.items():
            enforced = [e for e in entries if isinstance(e, dict) and e.get(_VIVIAN_ENFORCED_KEY)]
            if enforced:
                admin[event] = enforced
        return admin

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _read_file(path: Path) -> dict:
        if not path.exists():
            return {}
        try:
            with open(path, "r") as f:
                fcntl.flock(f, fcntl.LOCK_SH)
                try:
                    return json.load(f)
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to read {}: {}", path, exc)
            return {}

    @staticmethod
    def _read_hooks(path: Path) -> dict:
        data = HookConfigManager._read_file(path)
        hooks = data.get("hooks", {})
        return hooks if isinstance(hooks, dict) else {}

    @staticmethod
    def _write_file(path: Path, data: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with _lock:
            with open(path, "w") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    json.dump(data, f, indent=2)
                    f.write("\n")
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)

    def _write_hooks(self, path: Path, hooks: dict) -> None:
        """Merge *hooks* into the target file, preserving other keys."""
        existing = self._read_file(path)
        existing["hooks"] = hooks
        self._write_file(path, existing)
