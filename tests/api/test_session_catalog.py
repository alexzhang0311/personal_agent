from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from claude_agent_sdk._internal.sessions import _get_project_dir

from vivian.api.models.auth import UsageStats, UserRecord
from vivian.api.routers.auth import get_me
from vivian.api.services.scheduler.session_retention import SchedulerSessionRetention
from vivian.api.services.session_catalog import SessionCatalog
from vivian.api.services.session_origins import (
    load_session_origins,
    record_scheduler_session,
)


def _write_session(project_dir: Path, session_id: str, prompt: str, mtime: int) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / f"{session_id}.jsonl"
    path.write_text(
        json.dumps(
            {
                "type": "user",
                "sessionId": session_id,
                "timestamp": datetime.fromtimestamp(mtime, timezone.utc).isoformat(),
                "message": {"role": "user", "content": prompt},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    os.utime(path, (mtime, mtime))


class SessionCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_page_parses_at_most_fifty_candidates(self) -> None:
        with (
            tempfile.TemporaryDirectory() as config_dir,
            tempfile.TemporaryDirectory() as workspace,
        ):
            with patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": config_dir}):
                project_dir = _get_project_dir(str(Path(workspace).resolve()))
                for index in range(80):
                    _write_session(
                        project_dir, f"session-{index}", f"Prompt {index}", 1000 + index
                    )
                catalog = SessionCatalog()
                snapshot = await catalog.snapshot(workspace, required=50)
                self.assertEqual(len(snapshot.sessions), 50)
                self.assertEqual(snapshot.status.discovered, 80)
                self.assertEqual(snapshot.status.processed, 50)
                self.assertFalse(snapshot.status.total_exact)
                self.assertEqual(snapshot.sessions[0].session_id, "session-79")
                await catalog.reset()

    async def test_inventory_can_skip_background_parsing(self) -> None:
        with (
            tempfile.TemporaryDirectory() as config_dir,
            tempfile.TemporaryDirectory() as workspace,
        ):
            with patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": config_dir}):
                project_dir = _get_project_dir(str(Path(workspace).resolve()))
                _write_session(project_dir, "session-1", "Prompt", 1000)
                catalog = SessionCatalog()
                with patch(
                    "vivian.api.services.session_catalog._parse_candidate"
                ) as parse_candidate:
                    snapshot = await catalog.inventory(
                        workspace, build_background=False
                    )
                    await asyncio.sleep(0)
                self.assertEqual(snapshot.status.discovered, 1)
                self.assertEqual(snapshot.status.processed, 0)
                parse_candidate.assert_not_called()

    async def test_invalidated_catalog_parses_a_new_top_candidate(self) -> None:
        with (
            tempfile.TemporaryDirectory() as config_dir,
            tempfile.TemporaryDirectory() as workspace,
        ):
            with patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": config_dir}):
                project_dir = _get_project_dir(str(Path(workspace).resolve()))
                for index in range(60):
                    _write_session(
                        project_dir, f"session-{index}", f"Prompt {index}", 1000 + index
                    )
                catalog = SessionCatalog()
                with patch.object(catalog, "_start_background_build"):
                    await catalog.snapshot(workspace, required=50)
                    _write_session(project_dir, "session-new", "Newest", 2000)
                    catalog.invalidate(workspace)
                    refreshed = await catalog.snapshot(workspace, required=50)
                self.assertIn(
                    "session-new", {row.session_id for row in refreshed.sessions}
                )
                await catalog.reset()

    async def test_concurrent_requests_share_one_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            catalog = SessionCatalog()
            with patch(
                "vivian.api.services.session_catalog._scan_candidates", return_value=[]
            ) as scan:
                await asyncio.gather(
                    catalog.inventory(workspace),
                    catalog.inventory(workspace),
                    catalog.inventory(workspace),
                )
            self.assertEqual(scan.call_count, 1)


class LoginSessionInventoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_me_defaults_to_exact_legacy_stats(self) -> None:
        stats = SimpleNamespace(
            stats=UsageStats(),
            heatmap=[],
            model_usage=[],
            daily_model_tokens=[],
            favorite_model=None,
            current_streak=0,
            longest_streak=0,
            peak_hour=None,
            tagline=None,
        )
        user = UserRecord(username="alice", password_hash="hash")
        with (
            patch(
                "vivian.api.routers.auth.get_user_workspace", return_value="/workspace"
            ),
            patch("vivian.api.routers.auth.get_session_catalog") as catalog,
            patch(
                "vivian.api.routers.auth.compute_user_stats", return_value=stats
            ) as compute,
        ):
            await get_me(lazy_session_stats=False, user=user)

        catalog.assert_not_called()
        compute.assert_called_once_with("alice")

    async def test_get_me_uses_metadata_inventory_without_background_parse(
        self,
    ) -> None:
        candidates = [SimpleNamespace(session_id="session-1", last_modified=1000)]
        catalog = SimpleNamespace(
            inventory=AsyncMock(return_value=SimpleNamespace(candidates=candidates))
        )
        stats = SimpleNamespace(
            stats=UsageStats(),
            heatmap=[],
            model_usage=[],
            daily_model_tokens=[],
            favorite_model=None,
            current_streak=0,
            longest_streak=0,
            peak_hour=None,
            tagline=None,
        )
        user = UserRecord(username="alice", password_hash="hash")
        with (
            patch(
                "vivian.api.routers.auth.get_user_workspace", return_value="/workspace"
            ),
            patch("vivian.api.routers.auth.get_session_catalog", return_value=catalog),
            patch(
                "vivian.api.routers.auth.compute_user_stats", return_value=stats
            ) as compute,
        ):
            response = await get_me(lazy_session_stats=True, user=user)

        self.assertEqual(response.workspace, "/workspace")
        catalog.inventory.assert_awaited_once_with("/workspace", build_background=False)
        compute.assert_called_once_with("alice", candidates)


class SchedulerSessionRetentionTests(unittest.TestCase):
    def _fixture(self, work_dir: str, session_id: str, run_id: str):
        alice = Path(work_dir) / "alice"
        alice.mkdir()
        project_dir = _get_project_dir(str(alice.resolve()))
        old = int((datetime.now(timezone.utc) - timedelta(days=10)).timestamp())
        _write_session(project_dir, session_id, "scheduled", old)
        record_scheduler_session(
            alice,
            session_id=session_id,
            job_id="job-1",
            job_name="Minute job",
            run_id=run_id,
        )
        origin_path = alice / ".vivian.session-origins.jsonl"
        row = json.loads(origin_path.read_text())
        row["recorded_at"] = (
            datetime.now(timezone.utc) - timedelta(days=10)
        ).isoformat()
        origin_path.write_text(json.dumps(row) + "\n")
        return alice, project_dir

    def test_quarantines_only_expired_scheduler_sessions(self) -> None:
        with (
            tempfile.TemporaryDirectory() as config_dir,
            tempfile.TemporaryDirectory() as work_dir,
        ):
            with (
                patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": config_dir}),
                patch(
                    "vivian.api.services.scheduler.session_retention._work_dir",
                    return_value=Path(work_dir),
                ),
            ):
                alice, project_dir = self._fixture(work_dir, "scheduler-old", "run-1")
                old = int((datetime.now(timezone.utc) - timedelta(days=10)).timestamp())
                _write_session(project_dir, "chat-old", "chat", old)
                result = SchedulerSessionRetention().purge_all_users(7)
                self.assertEqual(result["quarantined"], 1)
                self.assertFalse((project_dir / "scheduler-old.jsonl").exists())
                self.assertTrue((project_dir / "chat-old.jsonl").exists())
                self.assertNotIn("scheduler-old", load_session_origins(alice))
                quarantine = (
                    Path(config_dir)
                    / ".vivian-session-quarantine"
                    / "alice"
                    / "scheduler-old"
                )
                self.assertTrue((quarantine / "manifest.json").exists())

    def test_quarantine_rolls_back_partial_move(self) -> None:
        with (
            tempfile.TemporaryDirectory() as config_dir,
            tempfile.TemporaryDirectory() as work_dir,
        ):
            with (
                patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": config_dir}),
                patch(
                    "vivian.api.services.scheduler.session_retention._work_dir",
                    return_value=Path(work_dir),
                ),
            ):
                alice, project_dir = self._fixture(work_dir, "scheduler-old", "run-1")
                session_file = project_dir / "scheduler-old.jsonl"
                subagents = session_file.with_suffix("")
                subagents.mkdir()
                (subagents / "agent-a.jsonl").write_text("{}\n", encoding="utf-8")
                real_move = shutil.move
                call_count = 0

                def fail_second_move(source, destination):
                    nonlocal call_count
                    call_count += 1
                    if call_count == 2:
                        raise OSError("simulated move failure")
                    return real_move(source, destination)

                service = SchedulerSessionRetention()
                with patch(
                    "vivian.api.services.scheduler.session_retention.shutil.move",
                    side_effect=fail_second_move,
                ):
                    with self.assertRaises(OSError):
                        service._quarantine(
                            alice,
                            session_file,
                            "scheduler-old",
                            {"run_id": "run-1"},
                            datetime.now(timezone.utc),
                        )
                self.assertTrue(session_file.exists())
                self.assertTrue(subagents.exists())
                quarantine = (
                    Path(config_dir)
                    / ".vivian-session-quarantine"
                    / "alice"
                    / "scheduler-old"
                )
                self.assertFalse(quarantine.exists())

    def test_deletes_quarantine_after_grace_period(self) -> None:
        with (
            tempfile.TemporaryDirectory() as config_dir,
            tempfile.TemporaryDirectory() as work_dir,
        ):
            with (
                patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": config_dir}),
                patch(
                    "vivian.api.services.scheduler.session_retention._work_dir",
                    return_value=Path(work_dir),
                ),
            ):
                self._fixture(work_dir, "scheduler-old", "run-1")
                service = SchedulerSessionRetention()
                service.purge_all_users(7)
                quarantine = (
                    Path(config_dir)
                    / ".vivian-session-quarantine"
                    / "alice"
                    / "scheduler-old"
                )
                manifest_path = quarantine / "manifest.json"
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                manifest["delete_after"] = (
                    datetime.now(timezone.utc) - timedelta(seconds=1)
                ).isoformat()
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

                result = service.purge_all_users(7)

                self.assertEqual(result["deleted"], 1)
                self.assertFalse(quarantine.exists())

    def test_active_run_is_not_quarantined(self) -> None:
        with (
            tempfile.TemporaryDirectory() as config_dir,
            tempfile.TemporaryDirectory() as work_dir,
        ):
            with (
                patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": config_dir}),
                patch(
                    "vivian.api.services.scheduler.session_retention._work_dir",
                    return_value=Path(work_dir),
                ),
            ):
                _, project_dir = self._fixture(
                    work_dir, "scheduler-active", "run-active"
                )
                result = SchedulerSessionRetention().purge_all_users(7, {"run-active"})
                self.assertEqual(result["quarantined"], 0)
                self.assertTrue((project_dir / "scheduler-active.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
