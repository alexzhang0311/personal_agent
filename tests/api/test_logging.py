from __future__ import annotations

import gzip
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from vivian.api.middleware.logging import (
    _HourlyRotation,
    _build_archive_path,
    _make_hourly_archive_compression,
)


class _FakeMessage:
    def __init__(self, when: datetime) -> None:
        self.record = {"time": when}


class LoggingRotationTests(unittest.TestCase):
    def test_hourly_rotation_rolls_existing_log_after_hour_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "server.log"
            log_path.write_text("existing log line\n", encoding="utf-8")

            tz = datetime.now().astimezone().tzinfo
            previous_hour = datetime(2026, 3, 25, 10, 55, tzinfo=tz)
            current_hour = previous_hour + timedelta(minutes=10)
            os.utime(log_path, (previous_hour.timestamp(), previous_hour.timestamp()))

            rotation = _HourlyRotation("00:00")
            with log_path.open("a", encoding="utf-8") as log_file:
                self.assertTrue(rotation(_FakeMessage(current_hour), log_file))

    def test_hourly_rotation_does_not_roll_within_same_hour(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "server.log"
            log_path.write_text("existing log line\n", encoding="utf-8")

            tz = datetime.now().astimezone().tzinfo
            current_hour = datetime(2026, 3, 25, 10, 55, tzinfo=tz)
            earlier_same_hour = current_hour - timedelta(minutes=25)
            os.utime(log_path, (earlier_same_hour.timestamp(), earlier_same_hour.timestamp()))

            rotation = _HourlyRotation("00:00")
            with log_path.open("a", encoding="utf-8") as log_file:
                self.assertFalse(rotation(_FakeMessage(current_hour), log_file))

    def test_hourly_archive_compression_uses_hour_named_gzip(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "server.log"
            rotated_path = Path(tmpdir) / "server.2026-03-25_10-06-35_653600.log"
            rotated_path.write_text("compressed payload\n", encoding="utf-8")

            compress = _make_hourly_archive_compression(log_path)
            compress(str(rotated_path))

            archive_path = Path(tmpdir) / "server.2026-03-25_10.log.gz"
            self.assertFalse(rotated_path.exists())
            self.assertTrue(archive_path.exists())

            with gzip.open(archive_path, "rt", encoding="utf-8") as archived_file:
                self.assertEqual(archived_file.read(), "compressed payload\n")

    def test_hourly_archive_path_avoids_overwriting_existing_archive(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "server.log"
            first_archive = Path(tmpdir) / "server.2026-03-25_10.log.gz"
            first_archive.write_text("keep me", encoding="utf-8")

            second_archive = _build_archive_path(log_path, "2026-03-25_10")
            self.assertEqual(second_archive.name, "server.2026-03-25_10.2.log.gz")


if __name__ == "__main__":
    unittest.main()
