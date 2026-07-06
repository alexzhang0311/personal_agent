import unittest

from pydantic import ValidationError

from vivian.api.models.agent import AgentRunRequest, AgentRunResponse


class AgentModelTests(unittest.TestCase):
    def test_request_requires_non_empty_message(self) -> None:
        with self.assertRaises(ValidationError):
            AgentRunRequest(message="")

    def test_response_uses_independent_message_lists(self) -> None:
        first = AgentRunResponse()
        second = AgentRunResponse()

        first.messages.append(
            {
                "type": "assistant",
                "content": [{"type": "text", "text": "hello"}],
            }
        )

        self.assertEqual(len(second.messages), 0)


if __name__ == "__main__":
    unittest.main()
