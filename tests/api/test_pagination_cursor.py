"""Tests for cursor-paginated stores: scheduler run_history, audit_log, hooks log_store."""
from __future__ import annotations

import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from vivian.api.models.scheduler import JobRunRecord
from vivian.api.models.hooks import HookLogEntry
from vivian.api.services._pagination import decode_cursor, encode_cursor


class CursorEncodingTests(unittest.TestCase):
    def test_roundtrip(self):
        ts = "2026-05-15T12:00:00+00:00"
        rid = "abc-123"
        c = encode_cursor(ts, rid)
        ts2, rid2 = decode_cursor(c)
        self.assertEqual(ts2, ts)
        self.assertEqual(rid2, rid)

    def test_id_with_pipe(self):
        # Should still decode cleanly: split only on first '|'
        ts = "2026-05-15T12:00:00+00:00"
        rid = "a|b|c"
        c = encode_cursor(ts, rid)
        ts2, rid2 = decode_cursor(c)
        self.assertEqual(ts2, ts)
        self.assertEqual(rid2, rid)


class SchedulerCursorTests(unittest.TestCase):
    """Cursor pagination for RunHistoryStore."""

    def _store(self, tmpdir):
        from vivian.api.services.scheduler.run_history import RunHistoryStore
        return RunHistoryStore()

    def test_first_page_returns_newest_first(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                store = self._store(tmpdir)
                (Path(tmpdir) / "alice").mkdir()

                # 5 records on the same day, distinct times
                base = datetime(2026, 5, 15, 10, 0, 0, tzinfo=timezone.utc)
                for i in range(5):
                    store.append(JobRunRecord(
                        run_id=f"r{i}", job_id="j1", job_name="T", username="alice",
                        status="success", started_at=base + timedelta(minutes=i),
                    ))

                runs, next_cursor, prev_cursor, total = store.query_cursor("alice", limit=3)
                self.assertEqual(len(runs), 3)
                self.assertEqual(runs[0].run_id, "r4")  # newest
                self.assertEqual(runs[1].run_id, "r3")
                self.assertEqual(runs[2].run_id, "r2")
                self.assertIsNotNone(next_cursor)
                self.assertIsNone(prev_cursor)  # initial page
                self.assertEqual(total, 5)

    def test_paging_with_before_cursor(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                store = self._store(tmpdir)
                (Path(tmpdir) / "alice").mkdir()

                base = datetime(2026, 5, 15, 10, 0, 0, tzinfo=timezone.utc)
                for i in range(7):
                    store.append(JobRunRecord(
                        run_id=f"r{i}", job_id="j1", job_name="T", username="alice",
                        status="success", started_at=base + timedelta(minutes=i),
                    ))

                runs1, c1, _, _ = store.query_cursor("alice", limit=3)
                self.assertEqual([r.run_id for r in runs1], ["r6", "r5", "r4"])

                runs2, c2, p2, _ = store.query_cursor("alice", limit=3, before=c1)
                self.assertEqual([r.run_id for r in runs2], ["r3", "r2", "r1"])
                self.assertIsNotNone(c2)
                self.assertIsNotNone(p2)

                runs3, c3, p3, _ = store.query_cursor("alice", limit=3, before=c2)
                self.assertEqual([r.run_id for r in runs3], ["r0"])
                self.assertIsNone(c3)  # exhausted
                self.assertIsNotNone(p3)

    def test_paging_across_daily_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                store = self._store(tmpdir)
                (Path(tmpdir) / "alice").mkdir()

                # 2 records per day, 5 days
                for day in range(5):
                    for slot in range(2):
                        t = datetime(2026, 5, 10 + day, 8 + slot, 0, 0, tzinfo=timezone.utc)
                        rid = f"d{day}-s{slot}"
                        store.append(JobRunRecord(
                            run_id=rid, job_id="j1", job_name="T", username="alice",
                            status="success", started_at=t,
                        ))

                runs1, c1, _, total = store.query_cursor("alice", limit=4)
                self.assertEqual(len(runs1), 4)
                self.assertEqual(total, 10)
                # newest first
                self.assertEqual(runs1[0].run_id, "d4-s1")

                # Page across day boundary
                runs2, _, _, _ = store.query_cursor("alice", limit=4, before=c1)
                self.assertEqual(len(runs2), 4)
                # No duplicates between pages
                ids1 = {r.run_id for r in runs1}
                ids2 = {r.run_id for r in runs2}
                self.assertEqual(len(ids1 & ids2), 0)

    def test_filter_returns_null_total(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                store = self._store(tmpdir)
                (Path(tmpdir) / "alice").mkdir()

                store.append(JobRunRecord(run_id="r1", job_id="j1", job_name="T", username="alice", status="success"))
                store.append(JobRunRecord(run_id="r2", job_id="j2", job_name="T", username="alice", status="success"))

                runs, _, _, total = store.query_cursor("alice", limit=10, job_id="j1")
                self.assertEqual(len(runs), 1)
                self.assertIsNone(total)

                runs, _, _, total = store.query_cursor("alice", limit=10)
                self.assertEqual(total, 2)

    def test_counts_sidecar_rebuilt_when_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                store = self._store(tmpdir)
                (Path(tmpdir) / "alice").mkdir()

                for i in range(5):
                    store.append(JobRunRecord(
                        run_id=f"r{i}", job_id="j1", job_name="T", username="alice",
                        status="success",
                    ))

                # Delete the sidecar — next read should rebuild it
                counts_path = Path(tmpdir) / "alice" / ".vivian.scheduler.history.counts.json"
                if counts_path.exists():
                    counts_path.unlink()

                _, _, _, total = store.query_cursor("alice", limit=10)
                self.assertEqual(total, 5)
                self.assertTrue(counts_path.exists())

    def test_migration_creates_daily_files_and_works_with_cursor(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                store = self._store(tmpdir)

                user_dir = Path(tmpdir) / "alice"
                user_dir.mkdir()

                # Pre-populate legacy file
                legacy = user_dir / ".vivian.scheduler.history.jsonl"
                day1 = datetime(2026, 3, 30, 10, 0, 0, tzinfo=timezone.utc)
                day2 = datetime(2026, 3, 31, 14, 0, 0, tzinfo=timezone.utc)
                r1 = JobRunRecord(run_id="r1", job_id="j1", job_name="T", username="alice", status="success", started_at=day1)
                r2 = JobRunRecord(run_id="r2", job_id="j1", job_name="T", username="alice", status="error", started_at=day2)
                with open(legacy, "w") as f:
                    f.write(r1.model_dump_json() + "\n")
                    f.write(r2.model_dump_json() + "\n")

                runs, _, _, total = store.query_cursor("alice", limit=10)
                self.assertEqual(len(runs), 2)
                self.assertEqual(total, 2)
                self.assertFalse(legacy.exists())
                self.assertTrue((user_dir / ".vivian.scheduler.history.2026-03-30.jsonl").exists())


class AuditCursorTests(unittest.TestCase):
    def _logger(self, tmpdir):
        from vivian.api.services.audit_log import AuditLogger
        return AuditLogger(base_dir=Path(tmpdir))

    def test_append_and_page(self):
        from vivian.api.services.audit_log import AuditEntry
        with tempfile.TemporaryDirectory() as tmpdir:
            log = self._logger(tmpdir)

            base = datetime(2026, 5, 15, 10, 0, 0)
            for i in range(5):
                log.append(AuditEntry(
                    timestamp=base + timedelta(minutes=i),
                    actor="alice",
                    action="user.created",
                    target=f"u{i}",
                ))

            entries, next_cursor, prev_cursor, total = log.query_cursor(limit=3)
            self.assertEqual(len(entries), 3)
            self.assertEqual(total, 5)
            self.assertIsNotNone(next_cursor)
            self.assertIsNone(prev_cursor)

            entries2, c2, p2, _ = log.query_cursor(limit=3, before=next_cursor)
            self.assertEqual(len(entries2), 2)
            self.assertIsNone(c2)
            self.assertIsNotNone(p2)
            ids = {e.id for e in entries + entries2}
            self.assertEqual(len(ids), 5)

    def test_filter_returns_null_total(self):
        from vivian.api.services.audit_log import AuditEntry
        with tempfile.TemporaryDirectory() as tmpdir:
            log = self._logger(tmpdir)
            log.append(AuditEntry(actor="alice", action="login.success"))
            log.append(AuditEntry(actor="bob", action="user.created", target="alice"))

            _, _, _, total = log.query_cursor(limit=10, actor_filter="alice")
            self.assertIsNone(total)

            _, _, _, total = log.query_cursor(limit=10)
            self.assertEqual(total, 2)

    def test_migration_from_legacy(self):
        from vivian.api.services.audit_log import AuditEntry, AuditLogger
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            # Write a legacy file directly
            legacy = base / ".vivian.audit.jsonl"
            with open(legacy, "w") as f:
                e1 = AuditEntry(
                    timestamp=datetime(2026, 3, 30, 10, 0, 0),
                    actor="alice", action="login.success",
                )
                e2 = AuditEntry(
                    timestamp=datetime(2026, 3, 31, 10, 0, 0),
                    actor="bob", action="user.created", target="charlie",
                )
                f.write(e1.model_dump_json() + "\n")
                f.write(e2.model_dump_json() + "\n")

            log = AuditLogger(base_dir=base)
            entries, _, _, total = log.query_cursor(limit=10)
            self.assertEqual(len(entries), 2)
            self.assertEqual(total, 2)
            self.assertFalse(legacy.exists())
            self.assertTrue((base / ".vivian.audit.2026-03-30.jsonl").exists())
            self.assertTrue((base / ".vivian.audit.2026-03-31.jsonl").exists())


class HookLogCursorTests(unittest.TestCase):
    def test_append_and_page(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.hooks.log_store._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.hooks.log_store import HookLogStore
                store = HookLogStore()
                (Path(tmpdir) / "alice").mkdir()

                base = datetime(2026, 5, 15, 10, 0, 0, tzinfo=timezone.utc)
                for i in range(5):
                    store.append("alice", HookLogEntry(
                        timestamp=(base + timedelta(minutes=i)).isoformat(),
                        event_type="PreToolUse",
                        handler_type="command",
                        exit_code=0,
                        duration_ms=10,
                    ))

                entries, c, p, total = store.query_cursor("alice", limit=3)
                self.assertEqual(len(entries), 3)
                self.assertEqual(total, 5)
                self.assertIsNotNone(c)
                self.assertIsNone(p)

                entries2, c2, _, _ = store.query_cursor("alice", limit=3, before=c)
                self.assertEqual(len(entries2), 2)
                self.assertIsNone(c2)

    def test_event_type_filter(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.hooks.log_store._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.hooks.log_store import HookLogStore
                store = HookLogStore()
                (Path(tmpdir) / "alice").mkdir()

                base = datetime(2026, 5, 15, 10, 0, 0, tzinfo=timezone.utc)
                for i, et in enumerate(["A", "B", "A", "B", "A"]):
                    store.append("alice", HookLogEntry(
                        timestamp=(base + timedelta(minutes=i)).isoformat(),
                        event_type=et, handler_type="command",
                        exit_code=0, duration_ms=10,
                    ))

                entries, _, _, total = store.query_cursor("alice", limit=10, event_type="A")
                self.assertEqual(len(entries), 3)
                self.assertIsNone(total)  # filter active

    def test_migration_from_legacy(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.hooks.log_store._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.hooks.log_store import HookLogStore

                user_dir = Path(tmpdir) / "alice"
                user_dir.mkdir()
                legacy = user_dir / ".vivian.hooks.log.jsonl"

                with open(legacy, "w") as f:
                    e1 = HookLogEntry(
                        timestamp="2026-03-30T10:00:00+00:00",
                        event_type="PreToolUse", handler_type="command",
                        exit_code=0, duration_ms=10,
                    )
                    e2 = HookLogEntry(
                        timestamp="2026-03-31T14:00:00+00:00",
                        event_type="PostToolUse", handler_type="command",
                        exit_code=0, duration_ms=10,
                    )
                    f.write(e1.model_dump_json() + "\n")
                    f.write(e2.model_dump_json() + "\n")

                store = HookLogStore()
                entries, _, _, total = store.query_cursor("alice", limit=10)
                self.assertEqual(len(entries), 2)
                self.assertEqual(total, 2)
                self.assertFalse(legacy.exists())
                self.assertTrue((user_dir / ".vivian.hooks.log.2026-03-30.jsonl").exists())
                self.assertTrue((user_dir / ".vivian.hooks.log.2026-03-31.jsonl").exists())


class CountsSidecarRebuildTests(unittest.TestCase):
    def test_counts_rebuild_on_corruption(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()
                (Path(tmpdir) / "alice").mkdir()

                for i in range(7):
                    store.append(JobRunRecord(
                        run_id=f"r{i}", job_id="j1", job_name="T", username="alice",
                        status="success",
                    ))

                counts_path = Path(tmpdir) / "alice" / ".vivian.scheduler.history.counts.json"
                # Corrupt the sidecar
                counts_path.write_text("not json")

                _, _, _, total = store.query_cursor("alice", limit=10)
                self.assertEqual(total, 7)


class LargeScaleTimingTest(unittest.TestCase):
    """Ensures the request path stays cheap at ~10k records.

    Asserts first-page latency, not throughput. Skipped if the timer is too
    coarse to be meaningful.
    """

    def test_first_page_is_fast(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("vivian.api.services.scheduler.run_history._get_work_dir", return_value=Path(tmpdir)):
                from vivian.api.services.scheduler.run_history import RunHistoryStore
                store = RunHistoryStore()
                (Path(tmpdir) / "alice").mkdir()

                # Seed 10k records across ~5 days
                base = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
                for i in range(10000):
                    store.append(JobRunRecord(
                        run_id=f"r{i:05d}", job_id="j1", job_name="T", username="alice",
                        status="success", started_at=base + timedelta(minutes=i),
                    ))

                # Warm sidecar
                store._get_total("alice")

                t0 = time.perf_counter()
                runs, _, _, total = store.query_cursor("alice", limit=50)
                elapsed = time.perf_counter() - t0

                self.assertEqual(len(runs), 50)
                self.assertEqual(total, 10000)
                # Must be well under 500ms; the request path should not scan
                # all 10k records.
                self.assertLess(elapsed, 0.5, f"query_cursor took {elapsed*1000:.0f}ms")


if __name__ == "__main__":
    unittest.main()
