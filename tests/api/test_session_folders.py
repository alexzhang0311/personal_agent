from __future__ import annotations

import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from vivian.api.models.agent import SessionFolderMoveRequest
from vivian.api.routers.agent import (
    list_agent_session_folder_sessions,
    list_agent_session_folders,
    list_agent_sessions,
    move_agent_session_to_folder,
)
from vivian.api.services.session_folders import (
    SessionFolderConflictError,
    SessionFolderError,
    SessionFolderNotFoundError,
    create_session_folder,
    delete_session_folder,
    load_session_folders,
    move_session_to_folder,
    rename_session_folder,
)


def _session(session_id: str, modified: int = 1):
    return SimpleNamespace(
        session_id=session_id,
        summary=session_id,
        last_modified=modified,
        file_size=10,
        custom_title=None,
        first_prompt=None,
        git_branch=None,
        cwd="/workspace",
        tag=None,
    )


class SessionFolderStoreTests(unittest.TestCase):
    def test_crud_move_and_delete_unfiles_without_removing_session(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            folder = create_session_folder(tmpdir, "  Project A  ")
            self.assertEqual(folder.name, "Project A")

            move_session_to_folder(tmpdir, "session-a", folder.folder_id)
            state = load_session_folders(tmpdir)
            self.assertEqual(state.assignments["session-a"], folder.folder_id)

            renamed = rename_session_folder(tmpdir, folder.folder_id, "Incidents")
            self.assertEqual(renamed.name, "Incidents")
            self.assertEqual(delete_session_folder(tmpdir, folder.folder_id), 1)

            state = load_session_folders(tmpdir)
            self.assertEqual(state.folders, {})
            self.assertEqual(state.assignments, {})

    def test_names_are_unique_case_insensitively(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            create_session_folder(tmpdir, "Project A")
            with self.assertRaises(SessionFolderConflictError):
                create_session_folder(tmpdir, " project a ")

    def test_concurrent_duplicate_creation_has_one_winner(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            def create(index: int) -> str:
                try:
                    return create_session_folder(tmpdir, f"Folder {index % 2}").name
                except SessionFolderConflictError:
                    return "conflict"

            with ThreadPoolExecutor(max_workers=12) as pool:
                results = list(pool.map(create, range(24)))

            self.assertEqual(len(load_session_folders(tmpdir).folders), 2)
            self.assertEqual(results.count("conflict"), 22)

    def test_validates_name_and_unknown_move_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            for invalid in ("", "   ", "a/b", "bad\nname", "x" * 65):
                with self.subTest(invalid=invalid):
                    with self.assertRaises(SessionFolderError):
                        create_session_folder(tmpdir, invalid)
            self.assertEqual(create_session_folder(tmpdir, "x" * 64).name, "x" * 64)
            with self.assertRaises(SessionFolderNotFoundError):
                move_session_to_folder(tmpdir, "session-a", "missing")

    def test_corrupt_lines_are_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / ".vivian.session-folders.jsonl"
            path.write_text("{not-json}\n", encoding="utf-8")
            folder = create_session_folder(tmpdir, "Valid")
            path.write_text(
                path.read_text(encoding="utf-8") + "[]\n{\"op\":42}\n",
                encoding="utf-8",
            )

            state = load_session_folders(tmpdir)
            self.assertEqual(list(state.folders), [folder.folder_id])


class SessionFolderContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_folder_list_counts_only_current_chat_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            folder = create_session_folder(tmpdir, "Project")
            move_session_to_folder(tmpdir, "chat-1", folder.folder_id)
            move_session_to_folder(tmpdir, "scheduled-1", folder.folder_id)
            move_session_to_folder(tmpdir, "deleted-chat", folder.folder_id)
            sessions = [_session("chat-1"), _session("chat-2"), _session("scheduled-1")]
            origins = {
                "scheduled-1": {
                    "job_id": "job-1", "job_name": "Daily", "run_id": "run-1",
                }
            }
            with (
                patch("vivian.api.routers.agent.get_user_workspace", return_value=tmpdir),
                patch("vivian.api.routers.agent.list_sessions", return_value=sessions),
                patch("vivian.api.routers.agent.load_session_origins", return_value=origins),
            ):
                response = await list_agent_session_folders(user=None)

            self.assertEqual(response.folders[0].session_count, 1)
            self.assertEqual(response.unfiled_count, 1)

    async def test_session_list_exposes_folder_id_only_for_chat(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            folder = create_session_folder(tmpdir, "Project")
            move_session_to_folder(tmpdir, "chat-1", folder.folder_id)
            move_session_to_folder(tmpdir, "scheduled-1", folder.folder_id)
            sessions = [_session("chat-1", 2), _session("scheduled-1", 1)]
            origins = {
                "scheduled-1": {
                    "job_id": "job-1",
                    "job_name": "Daily",
                    "run_id": "run-1",
                }
            }
            with (
                patch(
                    "vivian.api.routers.agent.get_user_workspace",
                    return_value=tmpdir,
                ),
                patch(
                    "vivian.api.routers.agent.list_sessions",
                    return_value=sessions,
                ),
                patch(
                    "vivian.api.routers.agent.load_session_origins",
                    return_value=origins,
                ),
            ):
                response = await list_agent_sessions(
                    limit=20,
                    offset=0,
                    source="all",
                    kind="all",
                    q=None,
                    user=None,
                )

            self.assertEqual(response.sessions[0].folder_id, folder.folder_id)
            self.assertIsNone(response.sessions[1].folder_id)

    async def test_folder_session_pagination_and_unfiled(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            folder = create_session_folder(tmpdir, "Project")
            move_session_to_folder(tmpdir, "chat-1", folder.folder_id)
            move_session_to_folder(tmpdir, "chat-2", folder.folder_id)
            sessions = [
                _session("chat-1", 4),
                _session("chat-2", 3),
                _session("chat-3", 2),
                _session("scheduled-1", 1),
            ]
            origins = {
                "scheduled-1": {
                    "job_id": "job-1",
                    "job_name": "Daily",
                    "run_id": "run-1",
                }
            }
            with (
                patch(
                    "vivian.api.routers.agent.get_user_workspace",
                    return_value=tmpdir,
                ),
                patch(
                    "vivian.api.routers.agent.list_sessions",
                    return_value=sessions,
                ),
                patch(
                    "vivian.api.routers.agent.load_session_origins",
                    return_value=origins,
                ),
            ):
                page = await list_agent_session_folder_sessions(
                    folder_id=folder.folder_id,
                    limit=1,
                    offset=1,
                    user=None,
                )
                unfiled = await list_agent_session_folder_sessions(
                    folder_id="unfiled",
                    limit=20,
                    offset=0,
                    user=None,
                )

            self.assertEqual(page.total, 2)
            self.assertEqual([row.session_id for row in page.sessions], ["chat-2"])
            self.assertEqual([row.session_id for row in unfiled.sessions], ["chat-3"])

    async def test_move_rejects_scheduled_and_missing_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            folder = create_session_folder(tmpdir, "Project")
            origins = {
                "scheduled-1": {
                    "job_id": "job-1",
                    "job_name": "Daily",
                    "run_id": "run-1",
                }
            }
            with (
                patch(
                    "vivian.api.routers.agent.get_user_workspace",
                    return_value=tmpdir,
                ),
                patch(
                    "vivian.api.routers.agent.list_sessions",
                    return_value=[_session("scheduled-1")],
                ),
                patch(
                    "vivian.api.routers.agent.load_session_origins",
                    return_value=origins,
                ),
            ):
                with self.assertRaises(HTTPException) as scheduled:
                    await move_agent_session_to_folder(
                        "scheduled-1",
                        SessionFolderMoveRequest(folder_id=folder.folder_id),
                        user=None,
                    )
                with self.assertRaises(HTTPException) as missing:
                    await move_agent_session_to_folder(
                        "missing",
                        SessionFolderMoveRequest(folder_id=folder.folder_id),
                        user=None,
                    )

            self.assertEqual(scheduled.exception.status_code, 400)
            self.assertEqual(missing.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
