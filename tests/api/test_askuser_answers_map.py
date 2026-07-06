import asyncio
import unittest

from claude_agent_sdk.types import PermissionResultAllow, PermissionResultDeny

from vivian.api.services.claude_sdk.permission_coordinator import PermissionCoordinator
from vivian.api.services.claude_sdk.service import (
    _askuser_answers_map,
    _make_unified_can_use_tool,
)


class AskUserAnswersMapTests(unittest.TestCase):
    """The locked {questions, answer} resolve shape must normalise into the
    CLI's real {question_text: answer_string} `answers` map. Regression for
    the model receiving an empty answer (then hallucinating a choice)."""

    def test_single_select_keyed_by_question_text(self) -> None:
        qs = [{"question": "Where to invest?", "header": "Investing", "multiSelect": False}]
        out = _askuser_answers_map(qs, "- Investing -> Funds/Stocks - higher return")
        self.assertEqual(out, {"Where to invest?": "Funds/Stocks - higher return"})

    def test_multi_select_value_preserved(self) -> None:
        qs = [{"question": "After work?", "header": "Hobby", "multiSelect": True}]
        out = _askuser_answers_map(qs, "- Hobby -> Sport - run; Rest - chill")
        self.assertEqual(out, {"After work?": "Sport - run; Rest - chill"})

    def test_multiple_questions_mapped_per_line(self) -> None:
        qs = [{"question": "Q1?", "header": "H1"}, {"question": "Q2?", "header": "H2"}]
        out = _askuser_answers_map(qs, "- H1 -> A1\n- H2 -> A2")
        self.assertEqual(out, {"Q1?": "A1", "Q2?": "A2"})

    def test_single_question_raw_text_fallback(self) -> None:
        qs = [{"question": "Q?", "header": "H"}]
        self.assertEqual(_askuser_answers_map(qs, "just my answer"), {"Q?": "just my answer"})

    def test_no_questions_is_empty(self) -> None:
        self.assertEqual(_askuser_answers_map([], "anything"), {})
        self.assertEqual(_askuser_answers_map(None, "anything"), {})


class UnifiedAskUserRewriteTests(unittest.IsolatedAsyncioTestCase):
    """End-to-end backend path: AskUserQuestion routed through the
    coordinator, resolved with the locked {questions, answer} shape, must
    reach the CLI as {questions, answers:{question_text: str}}."""

    async def test_allow_rewrites_to_cli_answers_schema(self) -> None:
        queue: asyncio.Queue = asyncio.Queue()
        coordinator = PermissionCoordinator("s", queue)
        cut = _make_unified_can_use_tool(coordinator, "bypassPermissions", [])

        tool_input = {"questions": [{"question": "Where to invest?", "header": "Investing"}]}
        task = asyncio.create_task(cut("AskUserQuestion", tool_input, None))
        req = await queue.get()
        self.assertEqual(req["data"]["kind"], "ask_user")

        coordinator.resolve(
            req["data"]["request_id"], "allow", "",
            {"questions": tool_input["questions"], "answer": "- Investing -> Funds"},
        )
        result = await task

        self.assertIsInstance(result, PermissionResultAllow)
        self.assertEqual(result.updated_input["answers"], {"Where to invest?": "Funds"})
        self.assertNotIn("answer", result.updated_input)

    async def test_deny_passes_through_untouched(self) -> None:
        queue: asyncio.Queue = asyncio.Queue()
        coordinator = PermissionCoordinator("s", queue)
        cut = _make_unified_can_use_tool(coordinator, "bypassPermissions", [])

        task = asyncio.create_task(cut("AskUserQuestion", {"questions": []}, None))
        req = await queue.get()
        coordinator.resolve(req["data"]["request_id"], "deny", "user did not answer")
        result = await task

        self.assertIsInstance(result, PermissionResultDeny)
        self.assertEqual(result.message, "user did not answer")


if __name__ == "__main__":
    unittest.main()
