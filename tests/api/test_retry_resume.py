"""Tests for the retry/resume helpers used by service.agent_run_events.

Covers the on-disk session JSONL transformations that run between retry
attempts: stripping synthetic-error rows so the model never sees its own
error, and healing orphan tool_use blocks so the resumed conversation
remains structurally valid for the Anthropic API.
"""
import json
import os
import tempfile
import unittest
from pathlib import Path

from claude_agent_sdk._internal.sessions import _canonicalize_path, _get_project_dir

from vivian.api.services.claude_sdk.retry import strip_synthetic_records
from vivian.api.services.claude_sdk.session_heal import heal_orphan_tool_uses


SESSION_ID = "11111111-2222-3333-4444-555555555555"


def _session_path(config_dir: Path, cwd: str) -> Path:
    project_dir = _get_project_dir(_canonicalize_path(cwd))
    project_dir.mkdir(parents=True, exist_ok=True)
    return project_dir / f"{SESSION_ID}.jsonl"


def _write_jsonl(path: Path, records: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec) + "\n")


def _read_jsonl(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


class StripSyntheticRecordsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._prev_config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
        os.environ["CLAUDE_CONFIG_DIR"] = self._tmp.name
        self.addCleanup(self._restore_env)
        # cwd must point at a real, canonicalisable directory.
        self._cwd_obj = tempfile.TemporaryDirectory()
        self.addCleanup(self._cwd_obj.cleanup)
        self.cwd = self._cwd_obj.name

    def _restore_env(self) -> None:
        if self._prev_config_dir is None:
            os.environ.pop("CLAUDE_CONFIG_DIR", None)
        else:
            os.environ["CLAUDE_CONFIG_DIR"] = self._prev_config_dir

    def test_removes_synthetic_keeps_real(self) -> None:
        path = _session_path(Path(self._tmp.name), self.cwd)
        _write_jsonl(path, [
            {"type": "user", "message": {"role": "user", "content": "hi"}},
            {"type": "assistant", "message": {"model": "claude-sonnet-4-5", "content": [{"type": "text", "text": "hello"}]}},
            {"type": "assistant", "message": {"model": "<synthetic>", "content": [{"type": "text", "text": "API Error"}]}},
            {"type": "assistant", "message": {"model": "claude-sonnet-4-5", "content": [{"type": "text", "text": "bye"}]}},
        ])

        removed = strip_synthetic_records(SESSION_ID, self.cwd)

        self.assertEqual(removed, 1)
        remaining = _read_jsonl(path)
        self.assertEqual(len(remaining), 3)
        models = [r.get("message", {}).get("model") for r in remaining]
        self.assertNotIn("<synthetic>", models)

    def test_noop_when_no_synthetic(self) -> None:
        path = _session_path(Path(self._tmp.name), self.cwd)
        _write_jsonl(path, [
            {"type": "user", "message": {"role": "user", "content": "hi"}},
            {"type": "assistant", "message": {"model": "claude-sonnet-4-5", "content": []}},
        ])
        before = path.read_bytes()

        removed = strip_synthetic_records(SESSION_ID, self.cwd)

        self.assertEqual(removed, 0)
        # File untouched — no rewrite when nothing to remove.
        self.assertEqual(path.read_bytes(), before)

    def test_missing_file_returns_zero(self) -> None:
        removed = strip_synthetic_records(SESSION_ID, self.cwd)
        self.assertEqual(removed, 0)

    def test_missing_session_id_returns_zero(self) -> None:
        # Path-less call (defensive — service code skips this branch but the
        # helper should not crash if invoked with empty inputs).
        self.assertEqual(strip_synthetic_records(None, self.cwd), 0)
        self.assertEqual(strip_synthetic_records(SESSION_ID, None), 0)


class HealOrphanToolUsesTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._prev_config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
        os.environ["CLAUDE_CONFIG_DIR"] = self._tmp.name
        self.addCleanup(self._restore_env)
        self._cwd_obj = tempfile.TemporaryDirectory()
        self.addCleanup(self._cwd_obj.cleanup)
        self.cwd = self._cwd_obj.name

    def _restore_env(self) -> None:
        if self._prev_config_dir is None:
            os.environ.pop("CLAUDE_CONFIG_DIR", None)
        else:
            os.environ["CLAUDE_CONFIG_DIR"] = self._prev_config_dir

    def test_appends_synthetic_tool_result_for_orphan(self) -> None:
        path = _session_path(Path(self._tmp.name), self.cwd)
        _write_jsonl(path, [
            {"type": "user", "message": {"role": "user", "content": "read file"}},
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "tu_paired", "name": "Read"},
                {"type": "tool_use", "id": "tu_orphan", "name": "Bash"},
            ]}},
            {"type": "user", "message": {"content": [
                {"type": "tool_result", "tool_use_id": "tu_paired", "content": "ok"},
            ]}},
        ])

        healed = heal_orphan_tool_uses(SESSION_ID, self.cwd)

        self.assertEqual(healed, 1)
        records = _read_jsonl(path)
        last = records[-1]
        self.assertEqual(last["type"], "user")
        blocks = last["message"]["content"]
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["type"], "tool_result")
        self.assertEqual(blocks[0]["tool_use_id"], "tu_orphan")
        self.assertTrue(blocks[0]["is_error"])
        self.assertIn("Bash", blocks[0]["content"])

    def test_noop_when_all_paired(self) -> None:
        path = _session_path(Path(self._tmp.name), self.cwd)
        _write_jsonl(path, [
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "tu_1", "name": "Read"},
            ]}},
            {"type": "user", "message": {"content": [
                {"type": "tool_result", "tool_use_id": "tu_1", "content": "ok"},
            ]}},
        ])
        before = path.read_bytes()

        healed = heal_orphan_tool_uses(SESSION_ID, self.cwd)

        self.assertEqual(healed, 0)
        self.assertEqual(path.read_bytes(), before)

    def test_missing_file_returns_zero(self) -> None:
        self.assertEqual(heal_orphan_tool_uses(SESSION_ID, self.cwd), 0)

    def test_missing_session_id_returns_zero(self) -> None:
        self.assertEqual(heal_orphan_tool_uses(None, self.cwd), 0)


if __name__ == "__main__":
    unittest.main()
