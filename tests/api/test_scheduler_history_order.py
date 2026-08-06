import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from vivian.api.models.scheduler import JobRunRecord


class RunHistoryOrderingTests(unittest.TestCase):
    def test_query_orders_by_started_at_not_append_order(self) -> None:
        """Later writes for older runs must not hide a newer running run."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch(
                "vivian.api.services.scheduler.run_history._get_work_dir",
                return_value=Path(tmpdir),
            ):
                from vivian.api.services.scheduler.run_history import RunHistoryStore

                store = RunHistoryStore()
                (Path(tmpdir) / "alice").mkdir()
                base = datetime(2026, 8, 5, 20, 0, 0, tzinfo=timezone.utc)

                # A newer run is written first and remains running. Older runs
                # finish afterwards, so their final records are later on disk.
                store.append(JobRunRecord(
                    run_id="new-running", job_id="j1", job_name="T1", username="alice",
                    status="running", started_at=base + timedelta(minutes=37),
                ))
                for minute in (27, 32, 36):
                    store.append(JobRunRecord(
                        run_id=f"older-{minute}", job_id="j1", job_name="T1", username="alice",
                        status="success", started_at=base + timedelta(minutes=minute),
                    ))

                runs, _, _, _ = store.query_cursor("alice", job_id="j1", limit=2)
                self.assertEqual([run.run_id for run in runs], ["new-running", "older-36"])
