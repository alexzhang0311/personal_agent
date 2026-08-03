from __future__ import annotations

import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from vivian.api.routers.agent import list_agent_sessions
from vivian.api.services.session_origins import (
    delete_session_origin,
    load_session_origins,
    record_scheduler_session,
    session_id_from_event,
)


def _session(
    session_id: str,
    *,
    title: str | None = None,
    prompt: str | None = None,
    summary: str = "",
    tag: str | None = None,
    modified: int = 1,
):
    return SimpleNamespace(
        session_id=session_id,
        summary=summary,
        last_modified=modified,
        file_size=10,
        custom_title=title,
        first_prompt=prompt,
        git_branch=None,
        cwd="/workspace",
        tag=tag,
    )


class SessionOriginStoreTests(unittest.TestCase):
    def test_round_trip_and_delete(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            record_scheduler_session(
                tmpdir,
                session_id="session-a",
                job_id="job-a",
                job_name="Daily report",
                run_id="run-a",
            )
            self.assertEqual(
                load_session_origins(tmpdir)["session-a"],
                {"job_id": "job-a", "job_name": "Daily report", "run_id": "run-a"},
            )

            delete_session_origin(tmpdir, "session-a")
            self.assertEqual(load_session_origins(tmpdir), {})

    def test_concurrent_appends_remain_readable(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            def write(index: int) -> None:
                record_scheduler_session(
                    tmpdir,
                    session_id=f"session-{index}",
                    job_id=f"job-{index}",
                    job_name=f"Job {index}",
                    run_id=f"run-{index}",
                )

            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(write, range(24)))

            self.assertEqual(len(load_session_origins(tmpdir)), 24)

    def test_ignores_corrupt_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".vivian.session-origins.jsonl"
            path.write_text("{not-json}\n", encoding="utf-8")
            record_scheduler_session(
                tmpdir,
                session_id="session-a",
                job_id="job-a",
                job_name="Daily report",
                run_id="run-a",
            )
            self.assertEqual(list(load_session_origins(tmpdir)), ["session-a"])


class SessionOriginEventTests(unittest.TestCase):
    def test_extracts_init_and_result_session_ids(self) -> None:
        self.assertEqual(
            session_id_from_event(
                "system",
                {"subtype": "init", "data": {"session_id": "session-init"}},
            ),
            "session-init",
        )
        self.assertEqual(
            session_id_from_event("result", {"session_id": "session-result"}),
            "session-result",
        )
        self.assertIsNone(session_id_from_event("assistant", {"session_id": "ignored"}))


class SessionListContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_searches_before_kind_filter_and_pagination(self) -> None:
        sessions = [
            _session("chat-1", title="Database repair", modified=30),
            _session("scheduled-1", prompt="Generate metrics", modified=20),
            _session("chat-2", tag="metrics", modified=10),
        ]
        origins = {
            "scheduled-1": {
                "job_id": "job-1",
                "job_name": "Nightly metrics",
                "run_id": "run-1",
            },
        }
        with (
            patch("vivian.api.routers.agent.get_user_workspace", return_value="/workspace"),
            patch("vivian.api.routers.agent.list_sessions", return_value=sessions),
            patch("vivian.api.routers.agent.load_session_origins", return_value=origins),
        ):
            response = await list_agent_sessions(
                limit=1,
                offset=0,
                source="project",
                kind="scheduler",
                q="nightly",
                user=None,
            )

        self.assertEqual(response.total, 1)
        self.assertEqual(response.counts.chat, 0)
        self.assertEqual(response.counts.scheduler, 1)
        self.assertEqual(response.counts.all, 1)
        self.assertEqual(response.sessions[0].session_id, "scheduled-1")
        self.assertEqual(response.sessions[0].session_kind, "scheduler")
        self.assertEqual(response.sessions[0].scheduler_context.job_name, "Nightly metrics")

    async def test_default_all_contract_remains_compatible(self) -> None:
        sessions = [
            _session("chat-1", title="Chat"),
            _session("scheduled-1", title="Scheduled"),
        ]
        origins = {
            "scheduled-1": {
                "job_id": "job-1",
                "job_name": "Daily",
                "run_id": "run-1",
            },
        }
        with (
            patch("vivian.api.routers.agent.get_user_workspace", return_value="/workspace"),
            patch("vivian.api.routers.agent.list_sessions", return_value=sessions),
            patch("vivian.api.routers.agent.load_session_origins", return_value=origins),
        ):
            response = await list_agent_sessions(
                limit=20,
                offset=0,
                source="all",
                kind="all",
                q=None,
                user=None,
            )

        self.assertEqual(response.total, 2)
        self.assertEqual(response.counts.model_dump(), {"chat": 1, "scheduler": 1, "all": 2})
        self.assertEqual([row.session_kind for row in response.sessions], ["chat", "scheduler"])

    async def test_paginates_after_filtering(self) -> None:
        sessions = [
            _session("scheduled-1"),
            _session("chat-1"),
            _session("chat-2"),
        ]
        origins = {
            "scheduled-1": {
                "job_id": "job-1",
                "job_name": "Daily",
                "run_id": "run-1",
            },
        }
        with (
            patch("vivian.api.routers.agent.get_user_workspace", return_value="/workspace"),
            patch("vivian.api.routers.agent.list_sessions", return_value=sessions),
            patch("vivian.api.routers.agent.load_session_origins", return_value=origins),
        ):
            response = await list_agent_sessions(
                limit=1,
                offset=1,
                source="all",
                kind="chat",
                q=None,
                user=None,
            )

        self.assertEqual(response.total, 2)
        self.assertEqual([row.session_id for row in response.sessions], ["chat-2"])


if __name__ == "__main__":
    unittest.main()
