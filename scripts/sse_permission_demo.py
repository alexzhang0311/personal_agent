#!/usr/bin/env python3
"""基于 SSE 的同步权限 / AskUserQuestion 流程演示客户端。

这是「IM 渠道客户端契约」（见方案文档）的一个可运行参考实现：它通过
``POST /api/agent/run/stream`` 驱动一次 agent 运行，读取 SSE 事件流，
每当 agent 循环因 ``permission_request`` 而阻塞时，就提示操作者，并在
原始流保持打开的同时，用*第二个*请求调用
``POST /api/agent/permission/respond`` 来解决它。后端协调器的 future
随即 resolve，运行在同一连接上继续。

两种提示类型（``data.kind``）：

  * ``ask_user``    — AskUserQuestion。渲染问题/选项，收集自由文本答案，
                      用 ``decision="allow", updated_input={questions, answer}``
                      解决。后端会把它规范化为 CLI 真正的 ``answers``
                      映射。空答案 / Ctrl-D => 跳过 =>
                      ``decision="deny", message="user did not answer"``。
  * ``permission``  — 风险工具 / 显式模式的拦截。确认 y/n =>
                      ``allow`` / ``deny (message="user declined")``。

``permission_timeout`` 会清除待处理的提示（不要再响应——那个 id
已失效，后端已用 "user did not answer" 拒绝）。

用法：
    python scripts/sse_permission_demo.py "use the AskUserQuestion tool to ask me 2 questions" \\
        --base-url http://localhost:8081 \\
        --api-key  "$VIVIAN_API_KEY" \\
        --user     derekdeng

鉴权：传入 ``--api-key``（按用户的 key 或全局 key）。``--user`` 设置
``x-user-name`` 请求头，使用*全局* key 时必填，后端用它把
/permission/respond 绑定到运行的所有者。仅在启用匿名访问的服务器上
才可两者都省略。

非交互式冒烟测试：``--answer "..."`` 为每个 ask_user 提示预填答案；
``--yes`` 自动允许每个 permission 提示。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any

import httpx


def _log(tag: str, msg: str) -> None:
    print(f"\033[2m[{tag}]\033[0m {msg}", file=sys.stderr, flush=True)


def _headers(api_key: str | None, user: str | None) -> dict[str, str]:
    h: dict[str, str] = {"Accept": "text/event-stream"}
    if api_key:
        h["Authorization"] = f"Bearer {api_key}"
    if user:
        h["x-user-name"] = user
    return h


# --- IM 渠道风格的答案处理（仅纯文本）-------------------------------------
# IM 用户只能输入纯文本，所以：给选项编号（回复数字），同时也接受选项
# 标签或任意自由文本，并且多问题提示一次只显示一个。对应
# docs/im-channel-permission-zh.md。

_SKIP_WORDS = {"", "skip", "跳过", "不答", "q", "quit", "exit"}
_ALLOW_WORDS = {"y", "yes", "是", "好", "确认", "同意", "允许", "执行", "ok", "1"}
_DENY_WORDS = {"n", "no", "否", "不", "取消", "拒绝", "算了", "0"}


def _render_one_question(q: dict[str, Any], qi: int, total: int) -> None:
    header = q.get("header") or ""
    tag = f"[{header}] " if header else ""
    pos = f" ({qi + 1}/{total})" if total > 1 else ""
    print(f"\n\033[36m┌─ 请确认{pos} ───────────────────────────\033[0m")
    print(f"\033[36m│\033[0m {tag}{q.get('question', '')}")
    for oi, opt in enumerate(q.get("options") or []):
        desc = f" — {opt['description']}" if opt.get("description") else ""
        print(f"\033[36m│\033[0m   {oi + 1}. {opt.get('label', '')}{desc}")
    hint = ("回复序号，多选用逗号如 1,3" if q.get("multiSelect") else "回复序号如 2")
    print(f"\033[36m└─ {hint}；或直接输入答案；回复「跳过」放弃\033[0m")


def _resolve_question_answer(q: dict[str, Any], reply: str) -> str | None:
    """把一条原始 IM 文本回复映射为该问题的答案值。

    返回解析出的标签 / 自由文本，或 None 表示跳过（放弃整个
    AskUserQuestion）。接受选项序号、精确/包含匹配的标签，或任意
    自由文本（自定义答案）。多选用 ", " 连接。
    """
    s = (reply or "").strip()
    if s.lower() in _SKIP_WORDS:
        return None

    labels = [str(o.get("label", "")) for o in (q.get("options") or [])]
    multi = bool(q.get("multiSelect"))

    # 1) 选项序号："2" / "1,3" / "1 3" / "1、3"
    tokens = [t for t in re.split(r"[\s,，、;；]+", s) if t]
    if tokens and all(t.isdigit() for t in tokens):
        idxs = [int(t) - 1 for t in tokens if 0 <= int(t) - 1 < len(labels)]
        if idxs:
            if not multi:
                idxs = idxs[:1]
            return ", ".join(labels[i] for i in idxs)

    # 2) 精确 / 包含匹配的选项标签，忽略大小写
    sl = s.lower()
    hit = [lab for lab in labels if lab and (lab.lower() == sl or lab.lower() in sl)]
    if hit:
        return ", ".join(hit) if multi else hit[0]

    # 3) 其它一切 → 自定义自由文本答案
    return s


def _render_permission(data: dict[str, Any]) -> None:
    reason = data.get("reason") or f"{data.get('tool_name')} {json.dumps(data.get('input'), ensure_ascii=False)}"
    print("\n\033[33m┌─ 需要授权 ────────────────────────────────────\033[0m")
    print(f"\033[33m│\033[0m {reason}")
    if data.get("risky"):
        print(f"\033[33m│\033[0m 风险：命中规则 {data.get('matched_rule')!r}")
    print("\033[33m└───────────────────────────────────────────────\033[0m")


def _respond(
    base_url: str,
    api_key: str | None,
    user: str | None,
    session_id: str,
    fallback_session_id: str,
    request_id: str,
    payload: dict[str, Any],
) -> bool:
    """POST /api/agent/permission/respond。遇到 404（session id 过期/已重映射）
    时刷新到最新 id 并重试一次（契约第 6 步）。成功返回 True。"""
    url = f"{base_url.rstrip('/')}/api/agent/permission/respond"
    headers = {k: v for k, v in _headers(api_key, user).items() if k != "Accept"}
    for attempt, sid in enumerate((session_id, fallback_session_id)):
        body = {"session_id": sid, "request_id": request_id, **payload}
        try:
            r = httpx.post(url, json=body, headers=headers, timeout=30)
        except httpx.HTTPError as exc:
            _log("respond", f"传输错误：{exc}")
            return False
        if r.status_code == 200:
            _log("respond", f"已解决 request_id={request_id} -> {payload.get('decision')}")
            return True
        if r.status_code == 401:
            _log("respond", "401 — API key 错误/缺失；中止")
            return False
        if r.status_code == 403:
            _log("respond", "403 — 你的身份不是运行所有者；中止")
            return False
        if r.status_code == 404 and attempt == 0 and fallback_session_id != session_id:
            _log("respond", f"session_id={sid} 返回 404；用最新 id={fallback_session_id} 重试")
            continue
        _log("respond", f"{r.status_code} {r.text[:200]} — 放弃 request_id={request_id}")
        return False
    return False


def _handle_permission_request(
    data: dict[str, Any],
    base_url: str,
    api_key: str | None,
    user: str | None,
    latest_sid: str,
    auto_answer: str | None,
    auto_yes: bool,
) -> None:
    kind = data.get("kind") or "permission"
    request_id = data["request_id"]
    # 后端给协调器加键所用的 session id 在事件本身里；latest_sid 是我们
    # 对重试路径的最佳运行时猜测。
    event_sid = data.get("session_id") or latest_sid

    if kind == "ask_user":
        # 一次一个问题；构造后端 _askuser_answers_map 期望的
        # "- <header> -> <value>" 行。任意问题处跳过（或没有任何答案）
        # 都会放弃整个请求 -> deny "user did not answer"。
        questions = (data.get("input") or {}).get("questions") or []
        total = len(questions)
        lines: list[str] = []
        skipped = False
        for qi, q in enumerate(questions):
            _render_one_question(q, qi, total)
            if auto_answer is not None:
                reply = auto_answer
                print(f"\033[2m（自动答案）\033[0m {reply}")
            else:
                try:
                    reply = input("> ").strip()
                except EOFError:
                    reply = ""
            value = _resolve_question_answer(q, reply)
            if value is None:
                skipped = True
                break
            head = q.get("header") or q.get("question") or "answer"
            lines.append(f"- {head} -> {value}")
            print(f"\033[2m已记录：{value}\033[0m")
        if skipped or not lines:
            payload = {"decision": "deny", "message": "user did not answer"}
        else:
            original_questions = (data.get("input") or {}).get("questions")
            payload = {
                "decision": "allow",
                "updated_input": {"questions": original_questions, "answer": "\n".join(lines)},
            }
            if total > 1:
                print("\033[2m已收到你的所有选择，正在继续…\033[0m")
    else:  # "permission"
        _render_permission(data)
        if auto_yes:
            allow = True
            print("\033[2m（自动允许）\033[0m y")
        else:
            allow = None
            for _ in range(2):  # 询问，无法识别时再问一次
                try:
                    c = input("确认执行？回复 确认/y 或 取消/n： ").strip().lower()
                except EOFError:
                    c = "n"
                if c in _ALLOW_WORDS:
                    allow = True
                    break
                if c in _DENY_WORDS:
                    allow = False
                    break
                print("\033[2m没听清，请回复 确认 或 取消\033[0m")
            if allow is None:  # 仍无法识别 → 保守拒绝
                allow = False
        payload = {"decision": "allow"} if allow else {
            "decision": "deny", "message": "user declined"}

    _respond(base_url, api_key, user, event_sid, latest_sid, request_id, payload)


def run(args: argparse.Namespace) -> int:
    url = f"{args.base_url.rstrip('/')}/api/agent/run/stream"
    body = {
        "message": args.message,
        "session_id": args.session_id,
        "permission_mode": args.permission_mode,
        "mcp_servers": "auto",
        # 本客户端会解决提示，所以它选择开启。API 默认为 false：
        # AskUserQuestion 被移除，风险/受控工具自动拒绝（对无法做同步
        # 往返的 IM 渠道是安全的）。
        "enable_permission_feedback": not args.no_permission_feedback,
    }
    latest_sid: str = args.session_id or ""
    final_result: dict[str, Any] | None = None

    _log("run", f"POST {url}  mode={args.permission_mode}")
    with httpx.Client(timeout=None) as client:
        with client.stream("POST", url, json=body, headers=_headers(args.api_key, args.user)) as resp:
            if resp.status_code != 200:
                resp.read()
                _log("run", f"{resp.status_code} {resp.text[:300]}")
                return 1

            event: str | None = None
            data_buf: list[str] = []
            for line in resp.iter_lines():
                if line == "":  # 空行终结一个 SSE 事件
                    if event and data_buf:
                        try:
                            data = json.loads("\n".join(data_buf))
                        except json.JSONDecodeError:
                            data = {"_raw": "\n".join(data_buf)}

                        # 契约第 2 步：跟踪并刷新 session id
                        if event == "stream_init" and data.get("stream_id"):
                            latest_sid = data["stream_id"]
                        sid = data.get("session_id") if isinstance(data, dict) else None
                        if sid:
                            latest_sid = sid

                        if event == "permission_request":
                            _handle_permission_request(
                                data, args.base_url, args.api_key, args.user,
                                latest_sid, args.answer, args.yes,
                            )
                        elif event == "permission_timeout":
                            _log("timeout", f"request_id={data.get('request_id')} 已过期"
                                             "（后端已拒绝；不再响应）")
                        elif event == "result":
                            final_result = data
                            _log("run", "已收到 result —— 关闭流")
                            break
                        elif event in ("stream_error", "retry_exhausted"):
                            _log(event, json.dumps(data, ensure_ascii=False)[:300])
                        elif event in ("retry_attempt",):
                            _log(event, json.dumps(data, ensure_ascii=False)[:200])
                        # assistant/tool/等事件：取消注释以追踪
                        elif args.verbose:
                            _log(event, json.dumps(data, ensure_ascii=False)[:200])

                    event, data_buf = None, []
                    continue
                if line.startswith(":"):  # ": keepalive" 注释 —— 忽略
                    continue
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data_buf.append(line[5:].strip())

    print("\n\033[32m═══ 最终结果 ═══\033[0m")
    if final_result is None:
        print("（流结束但没有 result 块）")
        return 1
    print(final_result.get("result") or json.dumps(final_result, ensure_ascii=False, indent=2))
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("message", help="给 agent 的提示词（例如让它使用 AskUserQuestion）")
    p.add_argument("--base-url", default=os.environ.get("VIVIAN_BASE_URL", "http://localhost:8081"))
    p.add_argument("--api-key", default=os.environ.get("VIVIAN_API_KEY"))
    p.add_argument("--user", default=os.environ.get("VIVIAN_USER"),
                   help="x-user-name（使用全局 key 时必填；设置运行所有者）")
    p.add_argument("--session-id", default=None, help="恢复一个已存在的会话")
    p.add_argument("--permission-mode", default="bypassPermissions",
                   help="bypassPermissions（默认；AskUserQuestion 仍会阻塞）/ default / acceptEdits / plan")
    p.add_argument("--answer", default=None,
                   help="非交互式：对每个问题都用这段文本回复"
                        "（要做真正的一次一问测试，请改为在 stdin 上每个问题"
                        "一行，例如 printf '1\\n2,3\\n' | ...）")
    p.add_argument("--yes", action="store_true",
                   help="非交互式：自动允许每个 permission 提示")
    p.add_argument("--no-permission-feedback", action="store_true",
                   help="发送 enable_permission_feedback=false：服务器移除 "
                        "AskUserQuestion 并自动拒绝风险/受控工具"
                        "（演示非交互式默认行为）")
    p.add_argument("--verbose", action="store_true", help="记录每个 SSE 事件")
    args = p.parse_args()
    sys.exit(run(args))


if __name__ == "__main__":
    main()
