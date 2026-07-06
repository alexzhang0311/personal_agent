"""Pure helpers for the WeCom user-feedback channel.

This module is intentionally side-effect free and depends only on the
standard library so it imports cleanly under both package roots used in this
repo (``vivian.api.services.channels.wecom_feedback`` from tests, and
``api.services.channels.wecom_feedback`` from the channel daemon, which puts
``vivian/`` on ``sys.path``).

It turns a ``permission_request`` payload (emitted by the
``PermissionCoordinator``; see services/claude_sdk/permission_coordinator.py)
into:

- **WeCom interactive template cards** — ``button_interaction`` for
  permission confirms and single-select questions, ``vote_interaction`` for
  multi-select questions (decisions 4 & 5 of the plan).
- **Plain-text fallbacks** — IM-friendly renders (no box-drawing) following
  ``docs/im-channel-permission-zh.md`` §4.3, so a user whose client cannot
  render or tap the card can still answer by typing.

And turns the user's reply back into an answer value:

- ``parse_question_answer`` / ``parse_permission_text`` — text replies
  (number / label / free-text / skip), ported verbatim from
  ``scripts/sse_permission_demo.py`` (``_resolve_question_answer`` +
  the ``_ALLOW_WORDS`` / ``_DENY_WORDS`` / ``_SKIP_WORDS`` sets).
- ``parse_card_event`` — a button tap / vote submit, parsed *defensively*
  against several candidate field names because the inbound callback shape is
  not fully documented (plan decision 12); the daemon always keeps a
  "single pending request per chat" fallback on top of this.

``answer_line`` produces the locked ``"- {header} -> {value}"`` shape that
``service.py:_askuser_answers_map`` already parses into the CLI's real
``answers`` map — do not change the format without updating that parser.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

# --- Word sets (ported verbatim from scripts/sse_permission_demo.py) --------
# IM users can only type, so we accept option numbers, option labels, or free
# text, and recognise a small set of skip / yes / no words in CN + EN.
_SKIP_WORDS = {"", "skip", "跳过", "不答", "q", "quit", "exit"}
_ALLOW_WORDS = {"y", "yes", "是", "好", "确认", "同意", "允许", "执行", "ok", "1"}
_DENY_WORDS = {"n", "no", "否", "不", "取消", "拒绝", "算了", "0"}

# Truncation budgets for IM-friendly text + card fields.
_DESC_MAX = 200          # description in the companion text (markdown, shows full)
_CARD_TITLE_MAX = 100
_CARD_LABEL_MAX = 30     # vote option label (WeCom recommends <=11 chars, one line)
_CMD_MAX = 400           # actual command/input shown in the permission text


# --- Text reply parsing -----------------------------------------------------

def parse_question_answer(q: dict[str, Any], reply: str) -> str | None:
    """Map one raw IM text reply to this question's answer value.

    Returns the resolved label / free text, or ``None`` to skip (which the
    caller treats as abandoning the whole AskUserQuestion). Accepts option
    numbers, exact/contains label matches, or arbitrary free text. Multi-select
    values are joined with ``", "``.

    Ported from ``scripts/sse_permission_demo.py:_resolve_question_answer``.
    """
    s = (reply or "").strip()
    if s.lower() in _SKIP_WORDS:
        return None

    labels = [str(o.get("label", "")) for o in (q.get("options") or [])]
    multi = bool(q.get("multiSelect"))

    # 1) Option numbers: "2" / "1,3" / "1 3" / "1、3"
    tokens = [t for t in re.split(r"[\s,，、;；]+", s) if t]
    if tokens and all(t.isdigit() for t in tokens):
        idxs = [int(t) - 1 for t in tokens if 0 <= int(t) - 1 < len(labels)]
        if idxs:
            if not multi:
                idxs = idxs[:1]
            return ", ".join(labels[i] for i in idxs)

    # 2) Exact / contains label match, case-insensitive
    sl = s.lower()
    hit = [lab for lab in labels if lab and (lab.lower() == sl or lab.lower() in sl)]
    if hit:
        return ", ".join(hit) if multi else hit[0]

    # 3) Anything else -> custom free-text answer
    return s


def parse_permission_text(reply: str) -> str | None:
    """Map an IM text reply to ``"allow"`` / ``"deny"`` / ``None`` (unrecognised).

    Lenient CN + EN matching mirroring the sse demo's ``_ALLOW_WORDS`` /
    ``_DENY_WORDS``. ``None`` signals the caller to re-prompt (then default-deny).
    """
    c = (reply or "").strip().lower()
    if c in _ALLOW_WORDS:
        return "allow"
    if c in _DENY_WORDS:
        return "deny"
    return None


def answer_line(header_or_question: str, value: str) -> str:
    """Build one ``"- {header} -> {value}"`` line.

    Joining these with ``"\\n"`` produces the locked ``answer`` blob that
    ``service.py:_askuser_answers_map`` parses back into the CLI's
    ``{question_text: answer}`` map. The left side must be the question's
    ``header`` (or ``question`` when there is no header) so multi-question
    answers align by key.
    """
    return f"- {header_or_question} -> {value}"


# --- Text rendering (IM-friendly fallback; see docs §4.3) -------------------

def _truncate(text: str, limit: int) -> str:
    text = "" if text is None else str(text)
    return text if len(text) <= limit else text[:limit] + "…"


def _md_escape(text: str) -> str:
    """Escape markdown emphasis chars so dynamic text renders literally.

    WeCom renders ``markdown`` messages, so an unescaped ``*`` / ``_`` in
    e.g. ``Bash(rm:*)`` would pair up and italicise a span (eating the chars).
    """
    return re.sub(r"([\\`*_~])", r"\\\1", str(text))


def _format_option_line(idx: int, opt: dict[str, Any]) -> str:
    label = str(opt.get("label", ""))
    desc = opt.get("description") or ""
    if desc:
        return f"{idx}. {label} — {_truncate(str(desc), _DESC_MAX)}"
    return f"{idx}. {label}"


def render_question_text(q: dict[str, Any], i: int, n: int) -> str:
    """Render question ``i`` (0-based) of ``n`` as IM-friendly plain text.

    Mirrors templates A/B in ``docs/im-channel-permission-zh.md`` §4.3 and
    serves as the text fallback that always accompanies the interactive card.
    """
    header = q.get("header") or ""
    multi = bool(q.get("multiSelect"))
    pos = f" ({i + 1}/{n})" if n > 1 else ""
    title = f"「请确认{pos}」{header}" if header else f"「请确认{pos}」"
    if multi:
        title += "（可多选）"

    lines = [title, str(q.get("question") or ""), ""]
    for oi, opt in enumerate(q.get("options") or []):
        lines.append(_format_option_line(oi + 1, opt))
    lines.append("")
    if multi:
        lines.append("可多选，序号用英文逗号分隔（如 1,3）；也可点击上方卡片；或直接输入答案；回复「跳过」放弃。")
    else:
        lines.append("回复序号即可（如 2）；也可点击上方卡片；或直接输入你的答案；回复「跳过」放弃。")
    return "\n".join(lines)


def render_options_detail(q: dict[str, Any]) -> str:
    """Companion text for a card whose options are label-only.

    Lists every option's full ``label — description`` (the card can only show
    short labels) plus a reply hint. The card already shows the title +
    question, so those are not repeated here.
    """
    multi = bool(q.get("multiSelect"))
    lines = [_format_option_line(oi + 1, opt) for oi, opt in enumerate(q.get("options") or [])]
    lines.append("")
    if multi:
        lines.append("可多选，序号用英文逗号分隔（如 1,3）；也可点击上方卡片；回复「跳过」放弃。")
    else:
        lines.append("回复序号即可（如 2）；也可点击上方卡片；回复「跳过」放弃。")
    return "\n".join(lines)


def permission_command_line(data: dict[str, Any]) -> str:
    """The concrete action being approved.

    ``$ <command>`` for Bash-like tools, otherwise ``「<tool>」<key input>`` —
    so the user sees exactly what will run (e.g. ``$ rm /path/to/file``),
    matching the WebUI's command preview.
    """
    inp = data.get("input")
    tool = data.get("tool_name") or "操作"
    if isinstance(inp, dict):
        cmd = inp.get("command")
        if cmd:
            return _truncate(f"$ {cmd}", _CMD_MAX)
        for key in ("file_path", "path", "url", "pattern", "query"):
            if inp.get(key):
                return _truncate(f"「{tool}」{inp[key]}", _CMD_MAX)
        try:
            blob = json.dumps(inp, ensure_ascii=False)
        except Exception:
            blob = str(inp)
        return _truncate(f"「{tool}」{blob}", _CMD_MAX)
    return f"「{tool}」"


def _permission_detail_lines(data: dict[str, Any]) -> list[str]:
    """Command + reason + matched-rule lines shared by the detail/full renders.

    The command goes in a fenced code block (monospace, and immune to markdown
    mangling of paths/asterisks); the matched rule is inline code; the free-text
    reason is markdown-escaped.
    """
    lines = ["即将执行：", f"```\n{permission_command_line(data)}\n```"]
    reason = data.get("reason")
    if reason:
        lines.append(_md_escape(str(reason)))
    if data.get("risky") and data.get("matched_rule"):
        lines.append(f"命中风险规则：`{data.get('matched_rule')}`")
    return lines


def render_permission_detail(data: dict[str, Any]) -> str:
    """Companion text for a permission card: the actual command + reason + rule.

    The card already shows the 🚨/⚠️ title, so it is not repeated here.
    """
    lines = _permission_detail_lines(data)
    lines.append("")
    lines.append("回复「确认 / y」执行，回复「取消 / n」拒绝；也可点击上方卡片。")
    return "\n".join(lines)


def render_permission_text(data: dict[str, Any]) -> str:
    """Full, self-contained permission confirm (used when the card is rejected)."""
    title = "🚨 高危操作，请确认" if data.get("risky") else "⚠️ 需要你确认"
    lines = [title, *_permission_detail_lines(data), ""]
    lines.append("回复「确认 / y」执行，回复「取消 / n」拒绝；也可点击上方卡片。")
    return "\n".join(lines)


# --- WeCom template_card builders -------------------------------------------
#
# The outbound card bodies below follow developer.work.weixin.qq.com template
# card schemas, confirmed against a live bot (plan decision 12); the text
# fallback covers any gap. Button styles follow the plan: confirm=1, cancel=4,
# options=1.
#
# WeCom rejects an interactive card (errcode 42014) unless ``task_id`` uses only
# ``[0-9A-Za-z_-@]`` and is unique. The request_id is a UUID (hyphens are fine)
# but we strip to alphanumerics and append the question index for a guaranteed
# safe, unique id. Button ``key`` values are likewise colon-free; they carry no
# request id because the daemon correlates a tap to the single pending request
# for that chat (it never relies on a rid parsed from the callback).

def _safe_task_id(rid: str, q_idx: int) -> str:
    """A charset-safe, unique task_id: alphanumerics of rid + ``_<q_idx>``."""
    base = re.sub(r"[^0-9A-Za-z]", "", str(rid))[:110] or "card"
    return f"{base}_{q_idx}"


def _card_option_text(opt: dict[str, Any]) -> str:
    """A vote option's row text — the label only.

    WeCom renders each interactive option on one truncated line (recommended
    <=11 chars), so descriptions cannot fit here; they go in the companion text
    (``render_options_detail``) instead.
    """
    return _truncate(str(opt.get("label", "")), _CARD_LABEL_MAX)


def build_permission_card(rid: str, data: dict[str, Any]) -> dict[str, Any]:
    """A two-button confirm card (``button_interaction``): 确认 / 取消.

    The card's subtitle shows the actual command being approved (truncated to
    one line); the full command + reason + rule go in the companion text.
    """
    risky = bool(data.get("risky"))
    title = "🚨 高危操作，请确认" if risky else "⚠️ 需要你确认"
    card: dict[str, Any] = {
        "card_type": "button_interaction",
        "main_title": {"title": title, "desc": _truncate(permission_command_line(data), _CARD_TITLE_MAX)},
        "task_id": _safe_task_id(rid, 0),
        "button_list": [
            {"text": "✅ 确认", "style": 1, "key": "allow"},
            {"text": "✖️ 取消", "style": 4, "key": "deny"},
        ],
    }
    if risky and data.get("matched_rule"):
        card["sub_title_text"] = f"命中风险规则：{data.get('matched_rule')}"
    return card


def build_question_card(rid: str, q_idx: int, q: dict[str, Any]) -> dict[str, Any]:
    """A question card as a ``vote_interaction`` (vertical option rows + submit).

    Options render as a stacked radio (``mode=0``, single-select) or checkbox
    (``mode=1``, multi-select) list, each row showing ``label - description``;
    the user picks then taps 提交. Submit key is ``submit_<qIdx>`` and option
    ``id = str(optIdx)``. Single and multi share this layout so the experience
    is consistent.
    """
    header = q.get("header") or ""
    question = str(q.get("question") or "")
    multi = bool(q.get("multiSelect"))
    options = list(q.get("options") or [])
    title = f"「{header}」" if header else "请选择"

    return {
        "card_type": "vote_interaction",
        "main_title": {"title": title, "desc": _truncate(question, _CARD_TITLE_MAX)},
        "task_id": _safe_task_id(rid, q_idx),
        "checkbox": {
            "question_key": f"q{q_idx}",
            "mode": 1 if multi else 0,
            "option_list": [
                {"id": str(oi), "text": _card_option_text(o), "is_checked": False}
                for oi, o in enumerate(options)
            ],
        },
        "submit_button": {"text": "提交", "key": f"submit_{q_idx}"},
    }


# --- Card-callback parsing (defensive; see plan decision 12) ----------------

@dataclass
class ParsedCardEvent:
    """Best-effort interpretation of a ``template_card_event`` callback frame.

    ``action`` is one of ``"allow" | "deny" | "opt" | "submit"`` (or ``None``
    if the button ``key`` could not be parsed). ``q_idx`` may be ``None`` for a
    sparse payload. ``rid`` is intentionally never populated — request ids are
    not encoded in card keys; the daemon correlates a tap to the single pending
    request for the chat. The field is kept only for forward-compat.
    """
    rid: str | None = None
    action: str | None = None
    q_idx: int | None = None
    opt_idxs: list[int] = field(default_factory=list)
    raw_key: str = ""
    task_id: str | None = None


def _safe_int(value: Any) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _coerce_option_ids(value: Any) -> list[int]:
    """Flatten a selected-options payload into int indices.

    The real WeCom vote-submit shape (confirmed from a live callback) is::

        {"selected_item": [{"question_key": "q0",
                            "option_ids": {"option_id": ["2"]}}]}

    Also tolerates simpler shapes: ``["0","2"]``, ``[{"id":"0"}]``,
    ``{"option_ids":[...]}``, a comma string ``"0,2"``, or a single id.
    """
    out: list[int] = []
    if value is None:
        return out
    if isinstance(value, dict):
        # WeCom nests one entry per question under ``selected_item``.
        if "selected_item" in value:
            for item in value.get("selected_item") or []:
                out.extend(_coerce_option_ids(item))
            return out
        for k in ("option_id", "option_ids", "ids", "selected", "selected_items", "id"):
            if k in value:
                return _coerce_option_ids(value[k])
        return out
    if isinstance(value, str):
        for tok in re.split(r"[\s,，、;；]+", value):
            iv = _safe_int(tok)
            if iv is not None:
                out.append(iv)
        return out
    if isinstance(value, (list, tuple)):
        for item in value:
            if isinstance(item, dict):
                out.extend(_coerce_option_ids(item))
            else:
                iv = _safe_int(item)
                if iv is not None:
                    out.append(iv)
        return out
    iv = _safe_int(value)
    return [iv] if iv is not None else out


def parse_card_event(frame: dict[str, Any]) -> ParsedCardEvent:
    """Parse a WeCom ``template_card_event`` frame defensively.

    The official docs confirm ``body.from.userid`` and
    ``body.event.eventtype == "template_card_event"`` but not exactly where the
    clicked button's ``key`` / ``task_id`` / selected option ids live. We probe
    several candidate names; the daemon's single-pending fallback covers any
    remaining gap.
    """
    body = frame.get("body") if isinstance(frame, dict) else None
    body = body if isinstance(body, dict) else {}
    event = body.get("event")
    event = event if isinstance(event, dict) else {}

    inner: dict[str, Any] = {}
    for k in ("template_card_event", "template_card", "card"):
        v = event.get(k)
        if isinstance(v, dict):
            inner = v
            break

    def pick(*keys: str) -> Any:
        for src in (inner, event, body):
            for kk in keys:
                val = src.get(kk)
                if val:
                    return val
        return None

    key = str(pick("event_key", "eventkey", "key", "button_key") or "")
    task_id_val = pick("task_id", "taskid")
    task_id = str(task_id_val) if task_id_val else None

    parsed = ParsedCardEvent(raw_key=key, task_id=task_id)

    # Keys are colon-free and carry no request id (see the builders): the daemon
    # correlates a tap to the single pending request for the chat. Formats:
    #   allow | deny | opt_<qIdx>_<optIdx> | submit_<qIdx>
    parts = key.split("_") if key else []
    action = parts[0] if parts else None

    if action in ("allow", "deny"):
        parsed.action = action
    elif action == "opt" and len(parts) >= 3:
        parsed.action = "opt"
        parsed.q_idx = _safe_int(parts[1])
        oi = _safe_int(parts[2])
        if oi is not None:
            parsed.opt_idxs = [oi]
    elif action == "submit" and len(parts) >= 2:
        parsed.action = "submit"
        parsed.q_idx = _safe_int(parts[1])
        selected = pick(
            "selected_items", "option_ids", "selected_options",
            "selected_id_list", "selected_list", "checkbox",
        )
        parsed.opt_idxs = _coerce_option_ids(selected)

    # If the key was sparse, recover q_idx from the "<safe-rid>_<qIdx>" task_id.
    if parsed.q_idx is None and task_id and "_" in task_id:
        parsed.q_idx = _safe_int(task_id.rsplit("_", 1)[1])

    return parsed


def value_from_card_selection(q: dict[str, Any], opt_idxs: list[int]) -> str | None:
    """Resolve tapped option indices to a label string for ``q``.

    Honours single vs multi-select (single keeps only the first index). Returns
    ``None`` when no index is in range.
    """
    labels = [str(o.get("label", "")) for o in (q.get("options") or [])]
    idxs = [i for i in opt_idxs if 0 <= i < len(labels)]
    if not idxs:
        return None
    if not bool(q.get("multiSelect")):
        idxs = idxs[:1]
    return ", ".join(labels[i] for i in idxs)
