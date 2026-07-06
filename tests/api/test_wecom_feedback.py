"""Tests for the WeCom user-feedback channel.

Two layers:

1. Pure helpers in ``wecom_feedback`` — text parsers, ``answer_line``
   round-tripping through the CLI answer map, card builders, ``parse_card_event``.
2. The daemon state machine — feed a synthetic ``permission_request`` and a
   synthetic text / card frame to the handlers (no live bot), then assert the
   in-process ``coordinator.resolve`` is called with the right decision /
   updated_input and that nothing is enqueued as a new prompt.
"""
import json
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

from vivian.api.models.channels import WeComChannelConfig  # noqa: E402
from vivian.api.services.claude_sdk.service import _askuser_answers_map  # noqa: E402
from vivian.api.services.channels.wecom_feedback import (  # noqa: E402
    answer_line,
    build_permission_card,
    build_question_card,
    parse_card_event,
    parse_permission_text,
    parse_question_answer,
    render_options_detail,
    render_permission_detail,
    render_permission_text,
    render_question_text,
    value_from_card_selection,
)


# --------------------------------------------------------------------------
# Layer 1 — pure helpers
# --------------------------------------------------------------------------

SINGLE_Q = {
    "question": "Which language?",
    "header": "Lang",
    "multiSelect": False,
    "options": [
        {"label": "Python", "description": "data / AI"},
        {"label": "Rust", "description": "memory safe"},
        {"label": "Go", "description": "cloud native"},
    ],
}
MULTI_Q = {
    "question": "Pick hobbies",
    "header": "Hobby",
    "multiSelect": True,
    "options": [{"label": "Read"}, {"label": "Run"}, {"label": "Chess"}],
}


class ParseQuestionAnswerTests(unittest.TestCase):
    def test_number(self) -> None:
        self.assertEqual(parse_question_answer(SINGLE_Q, "2"), "Rust")

    def test_number_out_of_range_falls_through_to_freetext(self) -> None:
        # "9" is not a valid index -> treated as free text
        self.assertEqual(parse_question_answer(SINGLE_Q, "9"), "9")

    def test_label_case_insensitive(self) -> None:
        self.assertEqual(parse_question_answer(SINGLE_Q, "rust"), "Rust")

    def test_free_text(self) -> None:
        self.assertEqual(parse_question_answer(SINGLE_Q, "something else"), "something else")

    def test_skip_returns_none(self) -> None:
        for word in ("跳过", "skip", "", "  ", "quit"):
            self.assertIsNone(parse_question_answer(SINGLE_Q, word))

    def test_single_select_keeps_first_of_multiple_numbers(self) -> None:
        self.assertEqual(parse_question_answer(SINGLE_Q, "1,3"), "Python")

    def test_multi_select_numbers(self) -> None:
        self.assertEqual(parse_question_answer(MULTI_Q, "1,3"), "Read, Chess")

    def test_multi_select_separators(self) -> None:
        self.assertEqual(parse_question_answer(MULTI_Q, "1、2 3"), "Read, Run, Chess")


class ParsePermissionTextTests(unittest.TestCase):
    def test_allow_words(self) -> None:
        for w in ("y", "yes", "确认", "同意", "ok", "1", "好"):
            self.assertEqual(parse_permission_text(w), "allow", w)

    def test_deny_words(self) -> None:
        for w in ("n", "no", "取消", "拒绝", "0", "算了"):
            self.assertEqual(parse_permission_text(w), "deny", w)

    def test_unrecognized(self) -> None:
        for w in ("maybe", "什么", "", "huh?"):
            self.assertIsNone(parse_permission_text(w))


class AnswerLineRoundTripTests(unittest.TestCase):
    """answer_line() output must parse back through the CLI answer map."""

    def test_single_question(self) -> None:
        line = answer_line(SINGLE_Q["header"], "Rust")
        out = _askuser_answers_map([SINGLE_Q], line)
        self.assertEqual(out, {"Which language?": "Rust"})

    def test_multi_value(self) -> None:
        line = answer_line(MULTI_Q["header"], "Read, Chess")
        out = _askuser_answers_map([MULTI_Q], line)
        self.assertEqual(out, {"Pick hobbies": "Read, Chess"})

    def test_multiple_questions(self) -> None:
        q2 = {"question": "City?", "header": "City"}
        blob = "\n".join([answer_line("Lang", "Rust"), answer_line("City", "Beijing")])
        out = _askuser_answers_map([SINGLE_Q, q2], blob)
        self.assertEqual(out, {"Which language?": "Rust", "City?": "Beijing"})

    def test_header_falls_back_to_question(self) -> None:
        q = {"question": "No header here", "header": "", "multiSelect": False}
        line = answer_line(q["question"], "answer-value")
        out = _askuser_answers_map([q], line)
        self.assertEqual(out, {"No header here": "answer-value"})


# WeCom rejects task_id (errcode 42014) unless it matches this charset.
import re as _re  # noqa: E402

_TASK_ID_RE = _re.compile(r"^[0-9A-Za-z_\-@]+$")


class CardBuilderTests(unittest.TestCase):
    def test_permission_card_button_interaction(self) -> None:
        card = build_permission_card("rid9", {
            "tool_name": "Bash", "input": {"command": "rm -rf dist"},
            "risky": True, "matched_rule": "Bash(rm:*)",
        })
        # JSON-serializable, correct type, and routable (colon-free) button keys.
        json.dumps(card)
        self.assertEqual(card["card_type"], "button_interaction")
        keys = [b["key"] for b in card["button_list"]]
        self.assertEqual(keys, ["allow", "deny"])
        self.assertEqual(card["task_id"], "rid9_0")
        self.assertIn("Bash(rm:*)", card["sub_title_text"])

    def test_single_select_card_is_vote_interaction_radio(self) -> None:
        card = build_question_card("rid9", 0, SINGLE_Q)
        json.dumps(card)
        self.assertEqual(card["card_type"], "vote_interaction")
        self.assertEqual(card["checkbox"]["mode"], 0)  # radio (single-select)
        self.assertEqual(card["submit_button"]["key"], "submit_0")
        rows = card["checkbox"]["option_list"]
        self.assertEqual([o["id"] for o in rows], ["0", "1", "2"])
        # Card rows are label-only (WeCom truncates long option text).
        self.assertEqual(rows[0]["text"], "Python")

    def test_options_detail_shows_full_descriptions(self) -> None:
        # The companion text carries the full label - description list + hint.
        text = render_options_detail(SINGLE_Q)
        self.assertIn("1. Python — data / AI", text)
        self.assertIn("2. Rust — memory safe", text)
        self.assertIn("跳过", text)
        # It does NOT repeat the title/question (the card shows those).
        self.assertNotIn("请确认", text)

    def test_multi_select_card_vote_interaction(self) -> None:
        card = build_question_card("rid9", 1, MULTI_Q)
        json.dumps(card)
        self.assertEqual(card["card_type"], "vote_interaction")
        self.assertEqual(card["checkbox"]["mode"], 1)  # checkbox (multi-select)
        ids = [o["id"] for o in card["checkbox"]["option_list"]]
        self.assertEqual(ids, ["0", "1", "2"])
        self.assertEqual(card["submit_button"]["key"], "submit_1")

    def test_task_id_is_charset_safe_for_uuid_rid(self) -> None:
        # Regression for errcode 42014: a UUID request_id must yield a task_id
        # with no colon (the old "rid:q" form was rejected by WeCom).
        uuid_rid = "7e802c3c-0c42-423f-841c-14da86bbedfb"
        for card in (
            build_permission_card(uuid_rid, {"reason": "x"}),
            build_question_card(uuid_rid, 0, SINGLE_Q),
            build_question_card(uuid_rid, 2, MULTI_Q),
        ):
            tid = card["task_id"]
            self.assertNotIn(":", tid)
            self.assertTrue(_TASK_ID_RE.match(tid), tid)
            self.assertLessEqual(len(tid), 128)

    def test_render_text_has_options_and_hint(self) -> None:
        text = render_question_text(SINGLE_Q, 0, 1)
        self.assertIn("1. Python", text)
        self.assertIn("跳过", text)
        perm = render_permission_text({"reason": "delete dist/", "risky": True, "matched_rule": "Bash(rm:*)"})
        self.assertIn("高危", perm)
        self.assertIn("Bash(rm:*)", perm)

    def test_permission_shows_actual_command(self) -> None:
        # The user must see the real command on the card and in the text.
        data = {
            "tool_name": "Bash",
            "input": {"command": "rm /Users/derekdeng/vivian_workspace/x/diagram.mmd"},
            "risky": True,
            "matched_rule": "Bash(rm:*)",
            "reason": "匹配到高风险工具模式 'Bash(rm:*)'。",
        }
        card = build_permission_card("7e802c3c-0c42-423f", data)
        self.assertIn("rm /Users/derekdeng/vivian_workspace/x/diagram.mmd", card["main_title"]["desc"])
        self.assertEqual(card["sub_title_text"], "命中风险规则：Bash(rm:*)")

        detail = render_permission_detail(data)
        # Command rendered inside a fenced code block.
        self.assertIn("```\n$ rm /Users/derekdeng/vivian_workspace/x/diagram.mmd\n```", detail)
        # Matched rule as inline code (so the '*' is not eaten by markdown).
        self.assertIn("命中风险规则：`Bash(rm:*)`", detail)
        # The free-text reason's '*' is markdown-escaped.
        self.assertIn(r"Bash(rm:\*)", detail)
        self.assertIn("匹配到高风险工具模式", detail)

        full = render_permission_text(data)
        self.assertIn("```\n$ rm /Users/derekdeng/vivian_workspace/x/diagram.mmd\n```", full)
        self.assertIn("高危", full)

    def test_permission_command_for_non_bash_tool(self) -> None:
        data = {"tool_name": "Write", "input": {"file_path": "/tmp/secret.txt"}}
        detail = render_permission_detail(data)
        self.assertIn("/tmp/secret.txt", detail)
        self.assertIn("Write", detail)


class ParseCardEventTests(unittest.TestCase):
    def test_allow_nested_payload(self) -> None:
        frame = {"body": {"from": {"userid": "u"}, "event": {
            "eventtype": "template_card_event",
            "template_card_event": {"event_key": "allow", "task_id": "rid1_0"},
        }}}
        p = parse_card_event(frame)
        self.assertEqual((p.action, p.task_id), ("allow", "rid1_0"))

    def test_deny_flat_payload(self) -> None:
        frame = {"body": {"event": {"eventtype": "template_card_event", "eventkey": "deny"}}}
        p = parse_card_event(frame)
        self.assertEqual(p.action, "deny")

    def test_opt(self) -> None:
        frame = {"body": {"event": {"eventtype": "template_card_event", "key": "opt_0_2"}}}
        p = parse_card_event(frame)
        self.assertEqual((p.action, p.q_idx, p.opt_idxs), ("opt", 0, [2]))

    def test_submit_real_wecom_shape(self) -> None:
        # The exact nested shape WeCom sends for a vote submit (from live logs).
        frame = {"body": {"event": {"eventtype": "template_card_event",
                 "template_card_event": {"card_type": "vote_interaction", "event_key": "submit_0",
                    "task_id": "abc_0",
                    "selected_items": {"selected_item": [
                        {"question_key": "q0", "option_ids": {"option_id": ["2"]}}]}}}}}
        p = parse_card_event(frame)
        self.assertEqual((p.action, p.q_idx, p.opt_idxs), ("submit", 0, [2]))

    def test_submit_multi_real_wecom_shape(self) -> None:
        frame = {"body": {"event": {"eventtype": "template_card_event",
                 "template_card_event": {"event_key": "submit_1",
                    "selected_items": {"selected_item": [
                        {"question_key": "q1", "option_ids": {"option_id": ["0", "2"]}}]}}}}}
        p = parse_card_event(frame)
        self.assertEqual((p.action, p.q_idx, p.opt_idxs), ("submit", 1, [0, 2]))

    def test_submit_tolerates_flat_shape(self) -> None:
        # Defensive: also handle a simpler flat list payload.
        frame = {"body": {"event": {"eventtype": "template_card_event",
                 "template_card_event": {"key": "submit_1", "selected_items": [{"id": "0"}, {"id": "2"}]}}}}
        p = parse_card_event(frame)
        self.assertEqual((p.action, p.q_idx, p.opt_idxs), ("submit", 1, [0, 2]))

    def test_sparse_key_recovers_q_idx_from_task_id(self) -> None:
        frame = {"body": {"event": {"eventtype": "template_card_event", "task_id": "abc123def_3"}}}
        p = parse_card_event(frame)
        self.assertEqual(p.q_idx, 3)

    def test_value_from_card_selection(self) -> None:
        self.assertEqual(value_from_card_selection(SINGLE_Q, [1]), "Rust")
        self.assertEqual(value_from_card_selection(MULTI_Q, [0, 2]), "Read, Chess")
        self.assertIsNone(value_from_card_selection(SINGLE_Q, [99]))


# --------------------------------------------------------------------------
# Layer 2 — daemon state machine (no live bot)
# --------------------------------------------------------------------------

from api.services.channels.daemon import (  # noqa: E402
    ChannelDaemon,
    MessageQueueItem,
    UserConnection,
)


class FakeClient:
    """Captures outbound traffic instead of touching the network."""

    def __init__(self, reject_cards: bool = False) -> None:
        self.sent: list = []           # (chatid, body)
        self.streams: list = []        # (stream_id, content, finish)
        self.card_updates: list = []   # (card, userids)
        self.reject_cards = reject_cards  # simulate WeCom errcode 42014 etc.

    async def send_message(self, chatid, body):
        if self.reject_cards and body.get("msgtype") == "template_card":
            raise RuntimeError("Reply ack error: errcode=42014, errmsg=taskid ...")
        self.sent.append((chatid, body))
        return {}

    async def reply_stream(self, frame, stream_id, content, finish=False, **kw):
        self.streams.append((stream_id, content, finish))
        return {}

    async def update_template_card(self, frame, card, userids=None):
        self.card_updates.append((card, userids))
        return {}

    # Card msgs sent (helper)
    def cards(self) -> list:
        return [b["template_card"] for _, b in self.sent if b.get("msgtype") == "template_card"]

    def texts(self) -> list:
        return [b["markdown"]["content"] for _, b in self.sent if b.get("msgtype") == "markdown"]


class FakeCoordinator:
    def __init__(self) -> None:
        self.resolved: list = []   # (request_id, decision, message, updated_input)
        self.cancelled = 0

    def resolve(self, request_id, decision, message="", updated_input=None):
        self.resolved.append((request_id, decision, message, updated_input))

    def cancel_all(self):
        self.cancelled += 1


def _text_frame(sender, chat_id, text):
    return {"body": {"msgtype": "text", "from": {"userid": sender},
                     "chatid": chat_id, "text": {"content": text}}}


def _card_frame(sender, chat_id, key, task_id=None, option_ids=None):
    """Mirror the real WeCom template_card_event frame shape (from live logs)."""
    tce = {"card_type": "vote_interaction", "event_key": key}
    if task_id:
        tce["task_id"] = task_id
    if option_ids is not None:
        tce["selected_items"] = {
            "selected_item": [
                {"question_key": "q0", "option_ids": {"option_id": [str(i) for i in option_ids]}}
            ]
        }
    return {"cmd": "aibot_event_callback", "body": {
        "msgtype": "event", "from": {"userid": sender}, "chatid": chat_id,
        "event": {"eventtype": "template_card_event", "template_card_event": tce},
    }}


def card_option_texts(card):
    return [o["text"] for o in card.get("checkbox", {}).get("option_list", [])]


ASK_DATA_SINGLE = {
    "request_id": "rid-a",
    "tool_name": "AskUserQuestion",
    "input": {"questions": [SINGLE_Q]},
    "kind": "ask_user",
}
ASK_DATA_MULTI_Q = {
    "request_id": "rid-b",
    "tool_name": "AskUserQuestion",
    "input": {"questions": [SINGLE_Q, {"question": "City?", "header": "City", "multiSelect": False,
                                       "options": [{"label": "Beijing"}, {"label": "Shanghai"}]}]},
    "kind": "ask_user",
}
ASK_DATA_MULTISELECT = {
    "request_id": "rid-m",
    "tool_name": "AskUserQuestion",
    "input": {"questions": [MULTI_Q]},
    "kind": "ask_user",
}
PERM_DATA = {
    "request_id": "rid-p",
    "tool_name": "Bash",
    "input": {"command": "rm -rf dist"},
    "risky": True,
    "matched_rule": "Bash(rm:*)",
    "kind": "permission",
}


class DaemonStateMachineTests(unittest.IsolatedAsyncioTestCase):
    def _make(self, timeout=180, reject_cards=False):
        daemon = ChannelDaemon()
        client = FakeClient(reject_cards=reject_cards)
        conn = UserConnection(
            username="alice",
            config=WeComChannelConfig(enable_permission_feedback=True, feedback_timeout_seconds=timeout),
            client=client,
        )
        daemon._connections["alice"] = conn
        return daemon, conn, client

    def _item(self, asker="asker1", chat="chatX", text="do it"):
        return MessageQueueItem(frame={"headers": {"req_id": "x"}}, text=text,
                                wecom_user_id=asker, chat_id=chat)

    def _clear_timers(self, conn):
        for p in conn.pending.values():
            if p.timer is not None:
                p.timer.cancel()

    async def test_ask_user_single_text_answer_resolves_allow(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, ASK_DATA_SINGLE)

        # The card (short labels) plus a companion text with full descriptions.
        self.assertEqual(len(client.cards()), 1)
        self.assertEqual(card_option_texts(client.cards()[0]), ["Python", "Rust", "Go"])
        self.assertTrue(any("data / AI" in t for t in client.texts()))
        self.assertIn("chatX", conn.pending)

        # The asker types "2" -> Rust.
        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "2"))

        self.assertEqual(len(coord.resolved), 1)
        rid, decision, _msg, updated = coord.resolved[0]
        self.assertEqual((rid, decision), ("rid-a", "allow"))
        self.assertEqual(updated["answer"], "- Lang -> Rust")
        self.assertEqual(updated["questions"], [SINGLE_Q])
        # Pending cleared, nothing enqueued, no new run started.
        self.assertNotIn("chatX", conn.pending)
        self.assertFalse(conn.queues.get("chatX"))
        self.assertNotIn("chatX", conn.active_runs)

    async def test_ask_user_card_rejected_falls_back_to_text(self):
        # When WeCom rejects the card, the full numbered-options text appears.
        daemon, conn, client = self._make(reject_cards=True)
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, ASK_DATA_SINGLE)

        self.assertEqual(client.cards(), [])        # card never landed
        texts = client.texts()
        self.assertTrue(texts)                       # text fallback was sent
        self.assertIn("1. Python", texts[0])
        # The fallback is fully answerable by typing.
        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "2"))
        self.assertEqual(coord.resolved[0][1], "allow")
        self.assertEqual(coord.resolved[0][3]["answer"], "- Lang -> Rust")

    async def test_permission_card_rejected_falls_back_to_text(self):
        daemon, conn, client = self._make(reject_cards=True)
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, PERM_DATA)

        self.assertEqual(client.cards(), [])
        self.assertTrue(any("需要你确认" in t or "高危" in t for t in client.texts()))
        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "y"))
        self.assertEqual(coord.resolved, [("rid-p", "allow", "", None)])

    async def test_ask_user_multi_question_sequential(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, ASK_DATA_MULTI_Q)
        self.assertEqual(conn.pending["chatX"].q_idx, 0)

        # Answer Q1 -> advances, no resolve yet, second card sent.
        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "Rust"))
        self.assertEqual(coord.resolved, [])
        self.assertEqual(conn.pending["chatX"].q_idx, 1)
        self.assertEqual(len(client.cards()), 2)

        # Answer Q2 -> single resolve with both lines.
        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "Beijing"))
        self.assertEqual(len(coord.resolved), 1)
        _rid, decision, _m, updated = coord.resolved[0]
        self.assertEqual(decision, "allow")
        self.assertEqual(updated["answer"], "- Lang -> Rust\n- City -> Beijing")
        self.assertNotIn("chatX", conn.pending)

    async def test_ask_user_multiselect_via_card_submit(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, ASK_DATA_MULTISELECT)
        self.assertEqual(client.cards()[0]["card_type"], "vote_interaction")

        frame = _card_frame("asker1", "chatX", "submit_0", option_ids=[0, 2])
        await daemon._handle_card_event("alice", frame)

        self.assertEqual(len(coord.resolved), 1)
        _rid, decision, _m, updated = coord.resolved[0]
        self.assertEqual(decision, "allow")
        self.assertEqual(updated["answer"], "- Hobby -> Read, Chess")

    async def test_ask_user_single_via_card_submit(self):
        # Single-select is now a vote card (mode=0): one selection + submit.
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, ASK_DATA_SINGLE)
        self.assertEqual(client.cards()[0]["card_type"], "vote_interaction")
        self.assertEqual(client.cards()[0]["checkbox"]["mode"], 0)

        frame = _card_frame("asker1", "chatX", "submit_0", option_ids=[1])
        await daemon._handle_card_event("alice", frame)

        self.assertEqual(len(coord.resolved), 1)
        _rid, decision, _m, updated = coord.resolved[0]
        self.assertEqual(decision, "allow")
        self.assertEqual(updated["answer"], "- Lang -> Rust")

    async def test_ask_user_skip_denies(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, ASK_DATA_SINGLE)

        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "跳过"))
        self.assertEqual(len(coord.resolved), 1)
        rid, decision, msg, updated = coord.resolved[0]
        self.assertEqual((rid, decision, msg), ("rid-a", "deny", "user did not answer"))
        self.assertIsNone(updated)
        self.assertNotIn("chatX", conn.pending)

    async def test_non_asker_text_ignored(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(asker="asker1"), coord, ASK_DATA_SINGLE)

        # A different user in the same group chat replies -> ignored.
        await daemon._handle_text_message("alice", _text_frame("intruder", "chatX", "1"))
        self.assertEqual(coord.resolved, [])
        self.assertIn("chatX", conn.pending)
        self._clear_timers(conn)

    async def test_non_asker_card_ignored(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(asker="asker1"), coord, PERM_DATA)

        await daemon._handle_card_event("alice", _card_frame("intruder", "chatX", "allow"))
        self.assertEqual(coord.resolved, [])
        self.assertIn("chatX", conn.pending)
        self._clear_timers(conn)

    async def test_permission_allow_via_text(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, PERM_DATA)
        self.assertEqual(client.cards()[0]["card_type"], "button_interaction")

        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "确认"))
        self.assertEqual(coord.resolved, [("rid-p", "allow", "", None)])
        self.assertNotIn("chatX", conn.pending)

    async def test_permission_deny_via_card(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, PERM_DATA)

        await daemon._handle_card_event("alice", _card_frame("asker1", "chatX", "deny", task_id="ridp_0"))
        self.assertEqual(len(coord.resolved), 1)
        rid, decision, msg, _u = coord.resolved[0]
        self.assertEqual((rid, decision, msg), ("rid-p", "deny", "user declined"))
        self.assertNotIn("chatX", conn.pending)

    async def test_permission_unrecognized_reprompts_then_denies(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, PERM_DATA)

        # First unrecognized -> re-prompt, still pending.
        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "huh"))
        self.assertEqual(coord.resolved, [])
        self.assertIn("chatX", conn.pending)
        # Second unrecognized -> conservative deny.
        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "still huh"))
        self.assertEqual(len(coord.resolved), 1)
        self.assertEqual(coord.resolved[0][1], "deny")
        self.assertNotIn("chatX", conn.pending)

    async def test_timeout_denies_ask_user(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, ASK_DATA_SINGLE)
        gen = conn.pending["chatX"].timer_gen

        # Simulate the per-question timer firing.
        await daemon._handle_feedback_timeout("alice", "chatX", gen)
        self.assertEqual(len(coord.resolved), 1)
        self.assertEqual(coord.resolved[0][1:3], ("deny", "user did not answer"))
        self.assertNotIn("chatX", conn.pending)
        self.assertTrue(any("分钟未回复" in t for t in client.texts()))

    async def test_answer_resets_timer_stale_fire_noops(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, ASK_DATA_MULTI_Q)
        gen1 = conn.pending["chatX"].timer_gen

        # Answer Q1 -> timer is re-armed (gen bumped); Q2 still pending.
        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "Rust"))
        self.assertIn("chatX", conn.pending)
        self.assertGreater(conn.pending["chatX"].timer_gen, gen1)

        # A stale fire for the *old* generation must be ignored.
        await daemon._handle_feedback_timeout("alice", "chatX", gen1)
        self.assertEqual(coord.resolved, [])
        self.assertIn("chatX", conn.pending)

        # Answering Q2 still resolves normally.
        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "Beijing"))
        self.assertEqual(len(coord.resolved), 1)
        self.assertEqual(coord.resolved[0][1], "allow")

    async def test_timeout_on_q1_drops_remaining_questions(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, ASK_DATA_MULTI_Q)
        gen = conn.pending["chatX"].timer_gen

        await daemon._handle_feedback_timeout("alice", "chatX", gen)
        self.assertEqual(len(coord.resolved), 1)
        self.assertEqual(coord.resolved[0][1:3], ("deny", "user did not answer"))
        self.assertNotIn("chatX", conn.pending)

    async def test_reset_command_during_pending_abandons(self):
        daemon, conn, client = self._make()
        coord = FakeCoordinator()
        await daemon._on_permission_request(conn, "chatX", self._item(), coord, ASK_DATA_SINGLE)

        await daemon._handle_text_message("alice", _text_frame("asker1", "chatX", "/reset"))
        self.assertEqual(len(coord.resolved), 1)
        self.assertEqual(coord.resolved[0][1:3], ("deny", "user did not answer"))
        self.assertNotIn("chatX", conn.pending)
        # The normal /reset session-clear path must not also have run.
        self.assertNotIn("chatX", conn.sessions)


if __name__ == "__main__":
    unittest.main()
