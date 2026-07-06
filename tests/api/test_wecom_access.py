"""Unit tests for WeCom bot access control.

Covers the pure ``wecom_access_allowed`` policy function and that
``normalize_wecom_frame`` surfaces ``chat_type`` from the frame.

Access model (decision: group = open; single = per-mode):
  - chattype == "group"  → always allowed (anyone in the group @-triggers)
  - chattype == "single" → mode in {all, allowed_user_ids, private}
"""

import os
import sys
import unittest

# The daemon imports under the ``api.*`` root (it puts vivian/ on sys.path);
# mirror that here so importing daemon.py resolves its ``from api...`` imports.
_VIVIAN_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "vivian",
)
if _VIVIAN_ROOT not in sys.path:
    sys.path.insert(0, _VIVIAN_ROOT)
os.environ.pop("CLAUDECODE", None)

from api.services.channels.daemon import (  # noqa: E402
    normalize_wecom_frame,
    wecom_access_allowed,
)


def _allow(chat_type, mode, sender, owner="alice", allowed=None):
    return wecom_access_allowed(
        chat_type=chat_type,
        mode=mode,
        sender_id=sender,
        owner_username=owner,
        allowed_user_ids=allowed or [],
    )


class GroupChatTests(unittest.TestCase):
    def test_group_is_open_regardless_of_mode(self):
        for mode in ("all", "allowed_user_ids", "private"):
            self.assertTrue(_allow("group", mode, "anyone"))

    def test_group_open_even_with_nonmatching_whitelist(self):
        self.assertTrue(
            _allow("group", "allowed_user_ids", "stranger", allowed=["alice"])
        )

    def test_group_case_insensitive_value(self):
        self.assertTrue(_allow("GROUP", "private", "stranger"))


class SingleAllModeTests(unittest.TestCase):
    def test_all_allows_anyone(self):
        self.assertTrue(_allow("single", "all", "stranger"))
        self.assertTrue(_allow("single", "all", "alice"))


class SinglePrivateModeTests(unittest.TestCase):
    def test_private_allows_owner_only(self):
        self.assertTrue(_allow("single", "private", "alice", owner="alice"))
        self.assertFalse(_allow("single", "private", "bob", owner="alice"))

    def test_private_is_case_insensitive(self):
        self.assertTrue(_allow("single", "private", "Alice", owner="alice"))
        self.assertTrue(_allow("single", "private", "ALICE", owner="alice"))

    def test_private_trims_whitespace(self):
        self.assertTrue(_allow("single", "private", "  alice  ", owner="alice"))

    def test_private_empty_sender_denied(self):
        self.assertFalse(_allow("single", "private", "", owner="alice"))


class SingleAllowedUserIdsModeTests(unittest.TestCase):
    def test_whitelist_admits_listed_sender(self):
        self.assertTrue(
            _allow("single", "allowed_user_ids", "bob", allowed=["bob", "carol"])
        )

    def test_whitelist_rejects_unlisted_sender(self):
        self.assertFalse(
            _allow("single", "allowed_user_ids", "dave", allowed=["bob", "carol"])
        )

    def test_empty_whitelist_allows_all(self):
        # Empty list = discovery mode (allow all) — preserves legacy behavior.
        self.assertTrue(_allow("single", "allowed_user_ids", "anyone", allowed=[]))


class DefaultAndUnknownChatTypeTests(unittest.TestCase):
    def test_missing_chat_type_treated_as_single(self):
        # No chattype in frame → not group → falls through to the single rules.
        self.assertFalse(_allow(None, "private", "bob", owner="alice"))
        self.assertTrue(_allow(None, "private", "alice", owner="alice"))

    def test_unknown_mode_falls_back_to_whitelist(self):
        self.assertFalse(_allow("single", "bogus", "bob", allowed=["alice"]))
        self.assertTrue(_allow("single", "bogus", "bob", allowed=["bob"]))
        self.assertTrue(_allow("single", "bogus", "anyone", allowed=[]))


class NormalizeChatTypeTests(unittest.TestCase):
    def _frame(self, **body):
        base = {
            "from": {"userid": "bob"},
            "chatid": "chatX",
            "text": {"content": "hello"},
        }
        base.update(body)
        return {"body": base}

    def test_extracts_chattype(self):
        msg = normalize_wecom_frame(self._frame(chattype="group"))
        self.assertIsNotNone(msg)
        self.assertEqual(msg.chat_type, "group")

    def test_extracts_chat_type_alias(self):
        msg = normalize_wecom_frame(self._frame(chat_type="single"))
        self.assertEqual(msg.chat_type, "single")

    def test_chat_type_absent_is_none(self):
        msg = normalize_wecom_frame(self._frame())
        self.assertIsNone(msg.chat_type)


if __name__ == "__main__":
    unittest.main()
