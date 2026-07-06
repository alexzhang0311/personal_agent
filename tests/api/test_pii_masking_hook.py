import asyncio
import unittest
from types import SimpleNamespace

from vivian.api.services.hooks.built_in_hooks import make_pii_masking_hook


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class PiiMaskingHookTests(unittest.TestCase):
    """The PII masking hook is wired programmatically from builder.py and
    replaces tool_output via PostToolUseHookSpecificOutput.updatedToolOutput
    only when patterns actually match."""

    def setUp(self) -> None:
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        # 11-digit Chinese phone number; mask keeps prefix + suffix.
        self.patterns = [
            {"name": "phone", "pattern": r"1(\d{2})\d{4}(\d{4})", "mask": r"1\1****\2"},
        ]

    def tearDown(self) -> None:
        self.loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())

    def test_no_tool_output_passthrough(self) -> None:
        hook = make_pii_masking_hook(self.patterns)
        out = self.loop.run_until_complete(hook({}, None, SimpleNamespace()))
        self.assertEqual(out, {"continue": True})

    def test_no_match_returns_continue_only(self) -> None:
        hook = make_pii_masking_hook(self.patterns)
        input_data = {
            "tool_name": "Bash",
            "tool_output": {"stdout": "hello world", "stderr": "", "interrupted": False},
        }
        out = self.loop.run_until_complete(hook(input_data, None, SimpleNamespace()))
        self.assertEqual(out, {"continue": True})

    def test_bash_shape_preserved_on_match(self) -> None:
        hook = make_pii_masking_hook(self.patterns)
        original = {
            "stdout": "User phone: 13912345678 done",
            "stderr": "",
            "interrupted": False,
        }
        input_data = {"tool_name": "Bash", "tool_output": dict(original)}
        out = self.loop.run_until_complete(hook(input_data, None, SimpleNamespace()))

        self.assertTrue(out["continue"])
        spec = out["hookSpecificOutput"]
        self.assertEqual(spec["hookEventName"], "PostToolUse")
        masked = spec["updatedToolOutput"]
        # Same dict shape as Bash's expected output schema.
        self.assertEqual(set(masked.keys()), {"stdout", "stderr", "interrupted"})
        self.assertEqual(masked["stderr"], "")
        self.assertIs(masked["interrupted"], False)
        # Number is masked; surrounding text intact.
        self.assertIn("139****5678", masked["stdout"])
        self.assertNotIn("13912345678", masked["stdout"])


if __name__ == "__main__":
    unittest.main()
