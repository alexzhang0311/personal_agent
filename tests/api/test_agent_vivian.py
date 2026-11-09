import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from vivian.api.routers import agent as router_agent
from vivian.api.services import vivian_agent_bindings as bindings


def _make_state(auth_method="api_key", authorization="Bearer whitelisted-key"):
    state = SimpleNamespace(auth_method=auth_method)
    headers = {"authorization": authorization} if authorization else {}
    request = SimpleNamespace(state=state, headers=headers)
    return request


def _make_request(**overrides):
    payload = {
        "username": "target-user",
        "message": "hello",
        "session_id": None,
        "permission_mode": None,
        "model": None,
        "attachments": None,
        "images": None,
        "mcp_servers": "auto",
        "enable_file_checkpointing": False,
        "fork_session": False,
        "enable_permission_feedback": False,
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


def _run_result(session_id="new-sess-1", is_error=False):
    return {
        "session_id": session_id,
        "is_error": is_error,
        "num_turns": 1,
        "duration_ms": 5,
        "duration_api_ms": 2,
        "result": "done",
    }


class RunVivianAgentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.cwd = Path(self._tmp.name)
        self.user = SimpleNamespace(username="caller", role="admin")
        # Target user exists in the account store by default
        self.store = mock.MagicMock()
        self.store.get_user.return_value = SimpleNamespace(username="target-user")
        self.store.get_runtime_config.return_value = {
            "api_key_whitelist": {"enable": True, "keys": ["whitelisted-key"]}
        }

    def tearDown(self) -> None:
        self._tmp.cleanup()

    async def _run(self, http_request=None, request=None, agent_run_result=None):
        http_request = http_request or _make_state()
        request = request or _make_request()
        if agent_run_result is None:
            agent_run_result = _run_result()
        with mock.patch.object(router_agent, "get_user_workspace", return_value=str(self.cwd)), \
             mock.patch.object(router_agent, "get_user_store", return_value=self.store), \
             mock.patch.object(router_agent, "agent_run", return_value=agent_run_result) as run_mock, \
             mock.patch.object(router_agent, "_validate_attachments", return_value=[]), \
             mock.patch.object(router_agent, "_validate_images", return_value=[]):
            response = await router_agent.run_vivian_agent(
                http_request, request, self.user
            )
        return response, run_mock

    # --- whitelist ---

    async def test_whitelist_disabled_returns_403(self) -> None:
        self.store.get_runtime_config.return_value = {"api_key_whitelist": {"enable": False, "keys": ["whitelisted-key"]}}
        with self.assertRaises(HTTPException) as ctx:
            await self._run()
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_whitelist_absent_returns_403(self) -> None:
        self.store.get_runtime_config.return_value = {}
        with self.assertRaises(HTTPException) as ctx:
            await self._run()
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_token_not_in_whitelist_returns_403(self) -> None:
        http_request = _make_state(authorization="Bearer other-key")
        with self.assertRaises(HTTPException) as ctx:
            await self._run(http_request=http_request)
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_jwt_auth_returns_403(self) -> None:
        http_request = _make_state(auth_method="jwt")
        with self.assertRaises(HTTPException) as ctx:
            await self._run(http_request=http_request)
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_missing_authorization_header_returns_403(self) -> None:
        http_request = _make_state(authorization=None)
        with self.assertRaises(HTTPException) as ctx:
            await self._run(http_request=http_request)
        self.assertEqual(ctx.exception.status_code, 403)

    # --- target user existence ---

    async def test_user_not_exist_returns_404(self) -> None:
        self.store.get_user.return_value = None
        with self.assertRaises(HTTPException) as ctx:
            await self._run()
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertIn("user not exist", ctx.exception.detail)

    # --- session routing ---

    async def test_no_binding_creates_new_session_and_records_it(self) -> None:
        response, run_mock = await self._run()
        run_mock.assert_awaited_once()
        self.assertIsNone(run_mock.call_args.args[1])  # session_id=None
        self.assertEqual(response.session_id, "new-sess-1")
        self.assertEqual(
            bindings.get_binding(self.cwd, "target-user"), "new-sess-1"
        )

    async def test_existing_binding_is_reused(self) -> None:
        bindings.set_binding(self.cwd, "target-user", "bound-sess")
        # Bound session's JSONL must exist on disk
        jsonl = self.cwd / "projects" / "p" / "bound-sess.jsonl"
        jsonl.parent.mkdir(parents=True, exist_ok=True)
        jsonl.write_text("{}", encoding="utf-8")
        with mock.patch.object(
            router_agent, "_session_jsonl_path", return_value=jsonl
        ):
            response, run_mock = await self._run()
        self.assertEqual(run_mock.call_args.args[1], "bound-sess")
        self.assertEqual(
            bindings.get_binding(self.cwd, "target-user"), "new-sess-1"
        )

    async def test_binding_with_missing_jsonl_starts_new_session(self) -> None:
        bindings.set_binding(self.cwd, "target-user", "ghost-sess")
        with mock.patch.object(
            router_agent,
            "_session_jsonl_path",
            return_value=self.cwd / "does-not-exist.jsonl",
        ):
            response, run_mock = await self._run()
        self.assertIsNone(run_mock.call_args.args[1])

    async def test_reset_token_forces_new_session_and_strips_token(self) -> None:
        bindings.set_binding(self.cwd, "target-user", "old-sess")
        jsonl = self.cwd / "old-sess.jsonl"
        jsonl.write_text("{}", encoding="utf-8")
        with mock.patch.object(
            router_agent, "_session_jsonl_path", return_value=jsonl
        ):
            response, run_mock = await self._run(
                request=_make_request(message="/reset what is the weather")
            )
        self.assertIsNone(run_mock.call_args.args[1])  # new session
        self.assertEqual(
            run_mock.call_args.args[0], "我是target-user。what is the weather"
        )
        self.assertTrue(response.reset)
        self.assertEqual(
            bindings.get_binding(self.cwd, "target-user"), "new-sess-1"
        )

    async def test_message_of_only_reset_uses_fallback_prompt(self) -> None:
        response, run_mock = await self._run(request=_make_request(message="/reset"))
        self.assertIsNone(run_mock.call_args.args[1])
        self.assertEqual(
            run_mock.call_args.args[0], router_agent._RESET_FALLBACK_PROMPT
        )
        self.assertTrue(response.reset)

    async def test_reset_substring_does_not_trigger(self) -> None:
        for message in ("/reset2 please", "xx/reset go", "check /resetting now"):
            with self.subTest(message=message):
                response, run_mock = await self._run(
                    request=_make_request(message=message)
                )
                self.assertFalse(response.reset)
                self.assertEqual(
                    run_mock.call_args.args[0], f"我是target-user。{message}"
                )

    async def test_failed_run_without_session_keeps_old_binding(self) -> None:
        bindings.set_binding(self.cwd, "target-user", "old-sess")
        jsonl = self.cwd / "old-sess.jsonl"
        jsonl.write_text("{}", encoding="utf-8")
        with mock.patch.object(
            router_agent, "_session_jsonl_path", return_value=jsonl
        ):
            await self._run(agent_run_result=_run_result(session_id=None))
        self.assertEqual(
            bindings.get_binding(self.cwd, "target-user"), "old-sess"
        )

    async def test_error_run_with_session_still_updates_binding(self) -> None:
        await self._run(agent_run_result=_run_result(session_id="partial-sess", is_error=True))
        self.assertEqual(
            bindings.get_binding(self.cwd, "target-user"), "partial-sess"
        )

    async def test_response_carries_username(self) -> None:
        response, _ = await self._run()
        self.assertEqual(response.username, "target-user")
        self.assertFalse(response.reset)


class IdentityPrefixTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.cwd = Path(self._tmp.name)
        self.user = SimpleNamespace(username="caller", role="admin")
        self.store = mock.MagicMock()
        self.store.get_user.return_value = SimpleNamespace(username="target-user")
        self.store.get_runtime_config.return_value = {
            "api_key_whitelist": {"enable": True, "keys": ["whitelisted-key"]}
        }

    def tearDown(self) -> None:
        self._tmp.cleanup()

    async def _run(self, message):
        http_request = _make_state()
        request = _make_request(message=message)
        with mock.patch.object(router_agent, "get_user_workspace", return_value=str(self.cwd)), \
             mock.patch.object(router_agent, "get_user_store", return_value=self.store), \
             mock.patch.object(router_agent, "agent_run", return_value=_run_result()) as run_mock, \
             mock.patch.object(router_agent, "_validate_attachments", return_value=[]), \
             mock.patch.object(router_agent, "_validate_images", return_value=[]):
            await router_agent.run_vivian_agent(http_request, request, self.user)
        return run_mock.call_args.args[0]

    async def test_identity_prefix_prepended(self) -> None:
        prompt = await self._run("wake me up")
        self.assertEqual(prompt, "我是target-user。wake me up")

    async def test_reset_with_content_gets_prefix_on_remainder(self) -> None:
        prompt = await self._run("/reset what is the weather")
        self.assertEqual(prompt, "我是target-user。what is the weather")

    async def test_pure_reset_no_prefix(self) -> None:
        prompt = await self._run("/reset")
        self.assertEqual(prompt, router_agent._RESET_FALLBACK_PROMPT)
        self.assertNotIn("我是", prompt)


class FolderArchiveTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.cwd = Path(self._tmp.name)
        self.user = SimpleNamespace(username="caller", role="admin")
        self.store = mock.MagicMock()
        self.store.get_user.return_value = SimpleNamespace(username="target-user")
        self.store.get_runtime_config.return_value = {
            "api_key_whitelist": {"enable": True, "keys": ["whitelisted-key"]}
        }

    def tearDown(self) -> None:
        self._tmp.cleanup()

    async def _run(self):
        from vivian.api.services.session_folders import load_session_folders
        http_request = _make_state()
        request = _make_request()
        with mock.patch.object(router_agent, "get_user_workspace", return_value=str(self.cwd)), \
             mock.patch.object(router_agent, "get_user_store", return_value=self.store), \
             mock.patch.object(router_agent, "agent_run", return_value=_run_result()) as run_mock, \
             mock.patch.object(router_agent, "_validate_attachments", return_value=[]), \
             mock.patch.object(router_agent, "_validate_images", return_value=[]):
            await router_agent.run_vivian_agent(http_request, request, self.user)
        return load_session_folders(self.cwd), run_mock

    async def test_session_archived_to_username_folder(self) -> None:
        state, run_mock = await self._run()
        folders = [f for f in state.folders.values() if f.name == "target-user"]
        self.assertEqual(len(folders), 1)
        self.assertEqual(state.assignments.get("new-sess-1"), folders[0].folder_id)

    async def test_existing_folder_reused_not_duplicated(self) -> None:
        from vivian.api.services.session_folders import create_session_folder
        existing = create_session_folder(self.cwd, "Target-User")  # different case
        state, _ = await self._run()
        matching = [f for f in state.folders.values() if f.name.casefold() == "target-user"]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0].folder_id, existing.folder_id)
        self.assertEqual(state.assignments.get("new-sess-1"), existing.folder_id)

    async def test_folder_failure_does_not_fail_api(self) -> None:
        with mock.patch.object(
            router_agent, "move_session_to_folder", side_effect=RuntimeError("boom")
        ), mock.patch.object(router_agent, "create_session_folder", side_effect=RuntimeError("boom")):
            http_request = _make_state()
            request = _make_request()
            with mock.patch.object(router_agent, "get_user_workspace", return_value=str(self.cwd)), \
                 mock.patch.object(router_agent, "get_user_store", return_value=self.store), \
                 mock.patch.object(router_agent, "agent_run", return_value=_run_result()), \
                 mock.patch.object(router_agent, "_validate_attachments", return_value=[]), \
                 mock.patch.object(router_agent, "_validate_images", return_value=[]):
                response = await router_agent.run_vivian_agent(
                    http_request, request, self.user
                )
        # API still succeeds; binding was recorded even though archiving failed
        self.assertEqual(response.session_id, "new-sess-1")
        self.assertEqual(
            bindings.get_binding(self.cwd, "target-user"), "new-sess-1"
        )


if __name__ == "__main__":
    unittest.main()


class ApiKeyWhitelistAdminTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_returns_config(self) -> None:
        from vivian.api.models.admin import ApiKeyWhitelistUpdate
        from vivian.api.routers import admin as admin_router

        store = mock.MagicMock()
        store.get_runtime_config.return_value = {
            "api_key_whitelist": {"enable": True, "keys": ["k1"]}
        }
        with mock.patch.object(admin_router, "get_user_store", return_value=store):
            response = await admin_router.get_api_key_whitelist()
        self.assertTrue(response.enable)
        self.assertEqual(response.keys, ["k1"])

    async def test_get_absent_config_defaults_off(self) -> None:
        from vivian.api.routers import admin as admin_router

        store = mock.MagicMock()
        store.get_runtime_config.return_value = {}
        with mock.patch.object(admin_router, "get_user_store", return_value=store):
            response = await admin_router.get_api_key_whitelist()
        self.assertFalse(response.enable)
        self.assertEqual(response.keys, [])

    async def test_put_validates_trims_dedups_and_persists(self) -> None:
        from vivian.api.models.admin import ApiKeyWhitelistUpdate
        from vivian.api.routers import admin as admin_router

        store = mock.MagicMock()
        audit = mock.MagicMock()
        admin_user = SimpleNamespace(username="admin", role="admin")
        request = ApiKeyWhitelistUpdate(enable=True, keys=[" k2 ", "k1", "k2", ""])
        with mock.patch.object(admin_router, "get_user_store", return_value=store), \
             mock.patch.object(admin_router, "get_audit_logger", return_value=audit):
            with self.assertRaises(HTTPException) as ctx:
                await admin_router.update_api_key_whitelist(request, admin_user)
            # Empty (whitespace-only) entry rejected
            self.assertEqual(ctx.exception.status_code, 422)

            request = ApiKeyWhitelistUpdate(enable=True, keys=[" k2 ", "k1", "k2"])
            response = await admin_router.update_api_key_whitelist(request, admin_user)

        self.assertEqual(response.keys, ["k2", "k1"])  # trimmed + deduped
        store.update_runtime_config.assert_called_once_with(
            "api_key_whitelist", {"enable": True, "keys": ["k2", "k1"]}
        )
        audit.append.assert_called_once()
        entry = audit.append.call_args.args[0]
        self.assertEqual(entry.action, "runtime.api_key_whitelist_updated")
        self.assertEqual(entry.details, {"enable": True, "key_count": 2})

    async def test_put_rejects_too_many_keys(self) -> None:
        from vivian.api.models.admin import ApiKeyWhitelistUpdate
        from vivian.api.routers import admin as admin_router

        store = mock.MagicMock()
        admin_user = SimpleNamespace(username="admin", role="admin")
        request = ApiKeyWhitelistUpdate(
            enable=True, keys=[f"key-{i}" for i in range(101)]
        )
        with mock.patch.object(admin_router, "get_user_store", return_value=store):
            with self.assertRaises(HTTPException) as ctx:
                await admin_router.update_api_key_whitelist(request, admin_user)
        self.assertEqual(ctx.exception.status_code, 422)
