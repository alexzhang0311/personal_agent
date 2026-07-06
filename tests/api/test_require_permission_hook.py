import asyncio
import unittest
from types import SimpleNamespace

from vivian.api.services.hooks.built_in_hooks import require_permission_risky_tools


class _FakeStore:
    def __init__(self, runtime: dict) -> None:
        self._runtime = runtime

    def get_runtime_config(self) -> dict:
        return self._runtime


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class RequirePermissionRiskyHookTests(unittest.TestCase):
    """The hook is part of the observability layer; enforcement happens in
    service.py via the can_use_tool wrapper. These tests lock in the hook's
    emit shape so future CLIs that respect permissionDecision='ask' work."""

    def setUp(self) -> None:
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

    def tearDown(self) -> None:
        self.loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())

    def _invoke(self, *, risky_list, tool_name, tool_input):
        # Patch get_user_store via monkeypatching the module attribute the
        # hook looks up at runtime.
        from vivian.api.services import user_store as user_store_mod
        original = user_store_mod.get_user_store
        user_store_mod.get_user_store = lambda: _FakeStore({"risky_tool_list": risky_list})
        try:
            input_data = {"tool_name": tool_name, "tool_input": tool_input}
            return self.loop.run_until_complete(
                require_permission_risky_tools(input_data, None, SimpleNamespace())
            )
        finally:
            user_store_mod.get_user_store = original

    def test_empty_list_returns_noop(self) -> None:
        result = self._invoke(risky_list=[], tool_name="Bash", tool_input={"command": "rm -rf /tmp"})
        self.assertEqual(result, {})

    def test_match_returns_ask(self) -> None:
        result = self._invoke(
            risky_list=["Bash(rm:*)"],
            tool_name="Bash",
            tool_input={"command": "rm -rf /tmp"},
        )
        self.assertIn("hookSpecificOutput", result)
        out = result["hookSpecificOutput"]
        self.assertEqual(out["hookEventName"], "PreToolUse")
        self.assertEqual(out["permissionDecision"], "ask")
        reason = out["permissionDecisionReason"]
        self.assertIn("Bash(rm:*)", reason)
        # Reason is hardcoded Chinese inside the hook.
        self.assertIn("高风险", reason)
        self.assertIn("请再次确认", reason)

    def test_miss_returns_noop(self) -> None:
        result = self._invoke(
            risky_list=["Bash(rm:*)"],
            tool_name="Bash",
            tool_input={"command": "ls /tmp"},
        )
        self.assertEqual(result, {})

    def test_missing_tool_name_returns_noop(self) -> None:
        result = self._invoke(
            risky_list=["Bash(rm:*)"],
            tool_name="",
            tool_input={"command": "rm"},
        )
        self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()
