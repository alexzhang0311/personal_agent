import unittest

from claude_agent_sdk.types import HookEventMessage

from vivian.api.services.claude_sdk.serialization import (
    get_event_label,
    serialize_hook_event,
    serialize_message,
)


class SerializeHookEventTests(unittest.TestCase):
    """HookEventMessage is a SystemMessage subclass — isinstance ordering in
    get_event_label / serialize_message must hit the hook branch first."""

    def _make(self, hook_event_name: str, subtype: str = "hook_response") -> HookEventMessage:
        return HookEventMessage(
            subtype=subtype,
            data={"tool_use_id": "toolu_42", "tool_name": "Bash"},
            hook_event_name=hook_event_name,
            session_id="sess-1",
            uuid="evt-1",
        )

    def test_pre_tool_use_hook_event_routes_to_hook_event_label(self) -> None:
        msg = self._make("PreToolUse")
        self.assertEqual(get_event_label(msg), "hook_event")

    def test_post_tool_use_hook_event_routes_to_hook_event_label(self) -> None:
        msg = self._make("PostToolUse")
        self.assertEqual(get_event_label(msg), "hook_event")

    def test_non_forwarded_hook_event_drops(self) -> None:
        msg = self._make("Stop")
        # Plan: other hook events stay log-only — get_event_label returns None
        # so the pump skips emitting them.
        self.assertIsNone(get_event_label(msg))

    def test_serialize_hook_event_shape(self) -> None:
        msg = self._make("PreToolUse", subtype="hook_started")
        payload = serialize_hook_event(msg)
        self.assertEqual(payload["type"], "hook_event")
        self.assertEqual(payload["subtype"], "hook_started")
        self.assertEqual(payload["hook_event_name"], "PreToolUse")
        self.assertEqual(payload["session_id"], "sess-1")
        self.assertEqual(payload["uuid"], "evt-1")
        self.assertEqual(payload["data"], {"tool_use_id": "toolu_42", "tool_name": "Bash"})

    def test_dispatch_hook_event_before_system_message(self) -> None:
        msg = self._make("PreToolUse")
        out = serialize_message(msg)
        # Confirm we got the hook-event shape, not the generic system shape.
        self.assertEqual(out["type"], "hook_event")
        self.assertEqual(out["hook_event_name"], "PreToolUse")
        self.assertNotIn(
            "data",
            {k: None for k in out if k == "data" and isinstance(out[k], dict)
             and set(out[k].keys()) - {"tool_use_id", "tool_name"} == {"subtype"}},
        )


if __name__ == "__main__":
    unittest.main()
