"""Tests for scheduler components: models, job store, run history, shared utilities."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import yaml

from vivian.api.models.scheduler import (
    CreateJobRequest,
    CronTriggerConfig,
    IntervalTriggerConfig,
    JobRunRecord,
    ScheduledJobDefinition,
    UpdateJobRequest,
)
from vivian.api.services.scheduler.shared import build_trigger, write_command


class TriggerConfigTests(unittest.TestCase):
    def test_cron_trigger_config(self) -> None:
        config = CronTriggerConfig(expr="0 9 * * mon-fri")
        self.assertEqual(config.type, "cron")
        self.assertEqual(config.expr, "0 9 * * mon-fri")

    def test_interval_trigger_config(self) -> None:
        config = IntervalTriggerConfig(hours=1, minutes=30)
        self.assertEqual(config.type, "interval")
        self.assertEqual(config.hours, 1)
        self.assertEqual(config.minutes, 30)

    def test_build_cron_trigger(self) -> None:
        config = CronTriggerConfig(expr="0 9 * * *")
        trigger = build_trigger(config, "Asia/Shanghai")
        self.assertIsNotNone(trigger)

    def test_build_interval_trigger(self) -> None:
        config = IntervalTriggerConfig(hours=2)
        trigger = build_trigger(config, "UTC")
        self.assertIsNotNone(trigger)


class ScheduledJobDefinitionTests(unittest.TestCase):
    def test_create_job_definition(self) -> None:
        job = ScheduledJobDefinition(
            id="test-1",
            name="Test Job",
            prompt="Do something",
            trigger=CronTriggerConfig(expr="0 9 * * *"),
            timezone="Asia/Shanghai",
        )
        self.assertEqual(job.id, "test-1")
        self.assertEqual(job.status, "active")
        self.assertIsNone(job.model)

    def test_job_definition_json_roundtrip(self) -> None:
        job = ScheduledJobDefinition(
            id="test-2",
            name="Test Job 2",
            prompt="Do something else",
            trigger=IntervalTriggerConfig(minutes=10),
            timezone="UTC",
            model="claude-sonnet-4-6",
        )
        data = job.model_dump(mode="json")
        restored = ScheduledJobDefinition.model_validate(data)
        self.assertEqual(restored.id, job.id)
        self.assertEqual(restored.trigger.type, "interval")
        self.assertEqual(restored.model, "claude-sonnet-4-6")


class JobRunRecordTests(unittest.TestCase):
    def test_create_run_record(self) -> None:
        record = JobRunRecord(
            run_id="run-1",
            job_id="job-1",
            job_name="Test",
            username="alice",
            status="running",
        )
        self.assertEqual(record.status, "running")
        self.assertFalse(record.is_error)

    def test_run_record_success(self) -> None:
        record = JobRunRecord(
            run_id="run-2",
            job_id="job-1",
            job_name="Test",
            username="alice",
            status="success",
            duration_ms=5000,
            num_turns=3,
            total_cost_usd=0.05,
            result_summary="Completed successfully",
        )
        self.assertEqual(record.duration_ms, 5000)
        self.assertFalse(record.is_error)

    def test_run_record_error(self) -> None:
        record = JobRunRecord(
            run_id="run-3",
            job_id="job-1",
            job_name="Test",
            username="alice",
            status="error",
            is_error=True,
            error_message="API credentials not configured",
        )
        self.assertTrue(record.is_error)


class CreateJobRequestTests(unittest.TestCase):
    def test_create_request(self) -> None:
        req = CreateJobRequest(
            name="Daily Report",
            prompt="Generate a report",
            trigger=CronTriggerConfig(expr="0 9 * * *"),
            timezone="Asia/Shanghai",
        )
        self.assertEqual(req.status, "active")

    def test_update_request_all_optional(self) -> None:
        req = UpdateJobRequest()
        self.assertIsNone(req.name)
        self.assertIsNone(req.prompt)


class WriteCommandTests(unittest.TestCase):
    def test_write_command_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.shared.get_commands_dir") as mock:
                cmd_dir = Path(tmpdir) / "commands"
                cmd_dir.mkdir()
                mock.return_value = cmd_dir

                write_command("reload_user", {"username": "alice"})

                files = list(cmd_dir.glob("*.json"))
                self.assertEqual(len(files), 1)

                with open(files[0]) as f:
                    data = json.load(f)
                self.assertEqual(data["type"], "reload_user")
                self.assertEqual(data["payload"]["username"], "alice")

    def test_write_multiple_commands_ordered(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.shared.get_commands_dir") as mock:
                cmd_dir = Path(tmpdir) / "commands"
                cmd_dir.mkdir()
                mock.return_value = cmd_dir

                write_command("reload_user", {"username": "alice"})
                write_command("trigger_now", {"username": "alice", "job_id": "j1"})

                files = sorted(cmd_dir.glob("*.json"), key=lambda f: f.name)
                self.assertEqual(len(files), 2)

                with open(files[0]) as f:
                    self.assertEqual(json.load(f)["type"], "reload_user")
                with open(files[1]) as f:
                    self.assertEqual(json.load(f)["type"], "trigger_now")


class JobStoreTests(unittest.TestCase):
    def test_save_and_load_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.job_store._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.job_store import JobStore
                store = JobStore()

                # Create user dir
                (Path(tmpdir) / "alice").mkdir()

                jobs = [
                    ScheduledJobDefinition(
                        id="job-1",
                        name="Test Job",
                        prompt="Do something",
                        trigger=CronTriggerConfig(expr="0 9 * * *"),
                        timezone="UTC",
                    )
                ]
                store.save_jobs("alice", jobs)

                loaded = store.list_jobs("alice")
                self.assertEqual(len(loaded), 1)
                self.assertEqual(loaded[0].id, "job-1")
                self.assertEqual(loaded[0].name, "Test Job")

    def test_preserves_sibling_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.job_store._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.job_store import JobStore
                store = JobStore()

                user_dir = Path(tmpdir) / "alice"
                user_dir.mkdir()
                config_path = user_dir / ".vivian.user.yml"

                # Pre-populate with quickactions
                with open(config_path, "w") as f:
                    yaml.dump({"quickactions": [{"name": "Review PR", "prompt": "Review"}]}, f)

                jobs = [
                    ScheduledJobDefinition(
                        id="job-1",
                        name="Test",
                        prompt="Do it",
                        trigger=IntervalTriggerConfig(hours=1),
                        timezone="UTC",
                    )
                ]
                store.save_jobs("alice", jobs)

                with open(config_path) as f:
                    data = yaml.safe_load(f)

                self.assertIn("quickactions", data)
                self.assertEqual(len(data["quickactions"]), 1)
                self.assertIn("scheduled_jobs", data)
                self.assertEqual(len(data["scheduled_jobs"]), 1)

    def test_get_job(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.job_store._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.job_store import JobStore
                store = JobStore()

                (Path(tmpdir) / "alice").mkdir()

                jobs = [
                    ScheduledJobDefinition(id="j1", name="Job 1", prompt="p1", trigger=CronTriggerConfig(expr="0 9 * * *"), timezone="UTC"),
                    ScheduledJobDefinition(id="j2", name="Job 2", prompt="p2", trigger=CronTriggerConfig(expr="0 10 * * *"), timezone="UTC"),
                ]
                store.save_jobs("alice", jobs)

                found = store.get_job("alice", "j2")
                self.assertIsNotNone(found)
                self.assertEqual(found.name, "Job 2")

                not_found = store.get_job("alice", "nonexistent")
                self.assertIsNone(not_found)

    def test_empty_user(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.job_store._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.job_store import JobStore
                store = JobStore()

                jobs = store.list_jobs("nonexistent")
                self.assertEqual(jobs, [])


class RunHistoryStoreTests(unittest.TestCase):
    def test_append_and_query(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()

                (Path(tmpdir) / "alice").mkdir()

                record1 = JobRunRecord(run_id="r1", job_id="j1", job_name="Test", username="alice", status="success")
                record2 = JobRunRecord(run_id="r2", job_id="j1", job_name="Test", username="alice", status="error", is_error=True)
                store.append(record1)
                store.append(record2)

                runs, total = store.query("alice")
                self.assertEqual(total, 2)
                # Newest first
                self.assertEqual(runs[0].run_id, "r2")

    def test_query_filter_by_job_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()

                (Path(tmpdir) / "alice").mkdir()

                store.append(JobRunRecord(run_id="r1", job_id="j1", job_name="T1", username="alice"))
                store.append(JobRunRecord(run_id="r2", job_id="j2", job_name="T2", username="alice"))

                runs, total = store.query("alice", job_id="j1")
                self.assertEqual(total, 1)
                self.assertEqual(runs[0].job_id, "j1")

    def test_get_run_ownership(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()

                (Path(tmpdir) / "alice").mkdir()
                (Path(tmpdir) / "bob").mkdir()

                store.append(JobRunRecord(run_id="r1", job_id="j1", job_name="T1", username="alice"))

                # Alice can see her own run
                found = store.get_run("alice", "r1")
                self.assertIsNotNone(found)

                # Bob cannot see Alice's run
                not_found = store.get_run("bob", "r1")
                self.assertIsNone(not_found)

    def test_dedup_by_run_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()

                (Path(tmpdir) / "alice").mkdir()

                # Append "running" then update to "success"
                store.append(JobRunRecord(run_id="r1", job_id="j1", job_name="T1", username="alice", status="running"))
                store.append(JobRunRecord(run_id="r1", job_id="j1", job_name="T1", username="alice", status="success", duration_ms=5000))

                runs, total = store.query("alice")
                self.assertEqual(total, 1)
                self.assertEqual(runs[0].status, "success")
                self.assertEqual(runs[0].duration_ms, 5000)


class DailyPartitionTests(unittest.TestCase):
    def test_daily_partition_write_and_read(self) -> None:
        """Records with different started_at dates land in separate daily files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()

                (Path(tmpdir) / "alice").mkdir()

                day1 = datetime(2026, 3, 30, 10, 0, 0, tzinfo=timezone.utc)
                day2 = datetime(2026, 3, 31, 14, 0, 0, tzinfo=timezone.utc)
                day3 = datetime(2026, 4, 1, 8, 0, 0, tzinfo=timezone.utc)

                store.append(JobRunRecord(run_id="r1", job_id="j1", job_name="T", username="alice", status="success", started_at=day1))
                store.append(JobRunRecord(run_id="r2", job_id="j1", job_name="T", username="alice", status="success", started_at=day2))
                store.append(JobRunRecord(run_id="r3", job_id="j1", job_name="T", username="alice", status="success", started_at=day3))

                # Verify separate daily files exist
                user_dir = Path(tmpdir) / "alice"
                self.assertTrue((user_dir / ".vivian.scheduler.history.2026-03-30.jsonl").exists())
                self.assertTrue((user_dir / ".vivian.scheduler.history.2026-03-31.jsonl").exists())
                self.assertTrue((user_dir / ".vivian.scheduler.history.2026-04-01.jsonl").exists())

                # Verify query merges them correctly (newest first)
                runs, total = store.query("alice")
                self.assertEqual(total, 3)
                self.assertEqual(runs[0].run_id, "r3")
                self.assertEqual(runs[1].run_id, "r2")
                self.assertEqual(runs[2].run_id, "r1")

    def test_migration_from_legacy(self) -> None:
        """Legacy single file is automatically migrated to daily files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()

                user_dir = Path(tmpdir) / "alice"
                user_dir.mkdir()

                # Create a legacy single file with records from different days
                legacy_path = user_dir / ".vivian.scheduler.history.jsonl"
                day1 = datetime(2026, 3, 30, 10, 0, 0, tzinfo=timezone.utc)
                day2 = datetime(2026, 3, 31, 14, 0, 0, tzinfo=timezone.utc)

                r1 = JobRunRecord(run_id="r1", job_id="j1", job_name="T", username="alice", status="success", started_at=day1)
                r2 = JobRunRecord(run_id="r2", job_id="j1", job_name="T", username="alice", status="error", started_at=day2)

                with open(legacy_path, "w") as f:
                    f.write(r1.model_dump_json() + "\n")
                    f.write(r2.model_dump_json() + "\n")

                # Access triggers migration
                runs, total = store.query("alice")
                self.assertEqual(total, 2)

                # Legacy file should be gone
                self.assertFalse(legacy_path.exists())

                # Daily files should exist
                self.assertTrue((user_dir / ".vivian.scheduler.history.2026-03-30.jsonl").exists())
                self.assertTrue((user_dir / ".vivian.scheduler.history.2026-03-31.jsonl").exists())

    def test_purge_old_records(self) -> None:
        """Purge deletes files older than retention_days."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()

                user_dir = Path(tmpdir) / "alice"
                user_dir.mkdir()

                today = datetime.now(timezone.utc).date()
                # Create daily files for 10 days
                for i in range(10):
                    d = today - timedelta(days=i)
                    date_str = d.isoformat()
                    record = JobRunRecord(
                        run_id=f"r{i}", job_id="j1", job_name="T", username="alice",
                        status="success", started_at=datetime(d.year, d.month, d.day, 12, 0, 0, tzinfo=timezone.utc),
                    )
                    path = user_dir / f".vivian.scheduler.history.{date_str}.jsonl"
                    with open(path, "w") as f:
                        f.write(record.model_dump_json() + "\n")

                # Purge with retention=7
                deleted = store.purge_old_records("alice", 7)
                self.assertEqual(deleted, 3)

                # 7 newest files remain
                remaining = list(user_dir.glob(".vivian.scheduler.history.*.jsonl"))
                self.assertEqual(len(remaining), 7)

    def test_purge_cleans_run_outputs(self) -> None:
        """Purge also removes corresponding run output files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)), \
                 patch("vivian.api.services.scheduler.run_history.get_user_runs_dir") as mock_runs_dir:

                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()

                user_dir = Path(tmpdir) / "alice"
                user_dir.mkdir()

                # Set up runs dir
                runs_dir = Path(tmpdir) / "runs" / "alice"
                runs_dir.mkdir(parents=True)
                mock_runs_dir.return_value = runs_dir

                today = datetime.now(timezone.utc).date()
                old_date = today - timedelta(days=10)
                date_str = old_date.isoformat()

                # Create an old daily file with a run_id
                record = JobRunRecord(
                    run_id="old-run-1", job_id="j1", job_name="T", username="alice",
                    status="success", started_at=datetime(old_date.year, old_date.month, old_date.day, 12, 0, 0, tzinfo=timezone.utc),
                )
                path = user_dir / f".vivian.scheduler.history.{date_str}.jsonl"
                with open(path, "w") as f:
                    f.write(record.model_dump_json() + "\n")

                # Create corresponding run output file
                output_file = runs_dir / "old-run-1.jsonl"
                output_file.write_text('{"event":"result","data":{}}\n')

                # Purge
                store.purge_old_records("alice", 7)

                # Both history and output files should be gone
                self.assertFalse(path.exists())
                self.assertFalse(output_file.exists())

    def test_cross_midnight_dedup(self) -> None:
        """Running + final status records for the same run go to started_at's date file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()

                (Path(tmpdir) / "alice").mkdir()

                # Run starts at 23:55 UTC
                started = datetime(2026, 3, 31, 23, 55, 0, tzinfo=timezone.utc)
                finished = datetime(2026, 4, 1, 0, 10, 0, tzinfo=timezone.utc)  # next day

                store.append(JobRunRecord(
                    run_id="r1", job_id="j1", job_name="T", username="alice",
                    status="running", started_at=started,
                ))
                store.append(JobRunRecord(
                    run_id="r1", job_id="j1", job_name="T", username="alice",
                    status="success", started_at=started, finished_at=finished, duration_ms=900000,
                ))

                # Both records should be in March 31 file (started_at date)
                user_dir = Path(tmpdir) / "alice"
                self.assertTrue((user_dir / ".vivian.scheduler.history.2026-03-31.jsonl").exists())
                self.assertFalse((user_dir / ".vivian.scheduler.history.2026-04-01.jsonl").exists())

                # Dedup should give us the final status
                runs, total = store.query("alice")
                self.assertEqual(total, 1)
                self.assertEqual(runs[0].status, "success")
                self.assertEqual(runs[0].duration_ms, 900000)

    def test_purge_disabled_when_zero(self) -> None:
        """Setting retention_days=0 disables purge."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()

                user_dir = Path(tmpdir) / "alice"
                user_dir.mkdir()

                today = datetime.now(timezone.utc).date()
                old_date = today - timedelta(days=30)
                date_str = old_date.isoformat()

                record = JobRunRecord(
                    run_id="r1", job_id="j1", job_name="T", username="alice",
                    status="success", started_at=datetime(old_date.year, old_date.month, old_date.day, tzinfo=timezone.utc),
                )
                path = user_dir / f".vivian.scheduler.history.{date_str}.jsonl"
                with open(path, "w") as f:
                    f.write(record.model_dump_json() + "\n")

                # retention_days=0 means disabled
                deleted = store.purge_old_records("alice", 0)
                self.assertEqual(deleted, 0)
                self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()
