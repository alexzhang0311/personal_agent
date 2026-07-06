#!/usr/bin/env python3
"""prod_call.py — 通过 vivian 网关调用生产环境 Agent（SSE 流式接口）。

用法:
    python3 prod_call.py --prompt "用户的指令" \
        [--session-id "上一轮的session_id"] \
        [--verbose]

退出码:
    0 — 成功（result 事件的 data JSON 写到 stdout）
    1 — 参数错误或 ./.prod-agent-gateway/auth 文件缺失/为空
    2 — 网络错误（连接、超时、SSE 读取中断）
    3 — API 返回非 2xx，或流结束未收到 result，或 stream_error
    4 — 并发冲突：同一 session_id 已有进行中的调用（fail-fast）
"""

import argparse
import atexit
import datetime
import fcntl
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import IO

DEFAULT_API_URL = "http://10.32.20.41:1377/pros-chatbot/third/gateway/tctp-cc/api/agent/run/stream"
API_URL = os.environ.get("PROD_AGENT_GATEWAY_URL", DEFAULT_API_URL)
TIMEOUT_SECONDS = 300

SKILL_NAME = "prod-agent-gateway"
STATE_DIR = Path.cwd() / f".{SKILL_NAME}"
AUTH_FILE = STATE_DIR / "auth"


def load_bearer_token() -> str:
    if not AUTH_FILE.is_file():
        sys.stderr.write(
            f"错误：未找到 auth 文件 {AUTH_FILE}\n"
            f"请向用户索取生产环境 Bearer token，并以明文单行形式写入该文件。\n"
        )
        sys.exit(1)
    token = AUTH_FILE.read_text(encoding="utf-8").strip()
    if not token:
        sys.stderr.write(f"错误：auth 文件 {AUTH_FILE} 为空\n")
        sys.exit(1)
    return token


def iter_sse_events(resp):
    """Parse an SSE stream from a urlopen response, yielding (event, data_str)."""
    event: str | None = None
    data_lines: list[str] = []
    for raw in resp:
        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        if line == "":
            if event is not None or data_lines:
                yield (event or "message"), "\n".join(data_lines)
            event = None
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip(" "))
    if event is not None or data_lines:
        yield (event or "message"), "\n".join(data_lines)


def acquire_session_lock(session_id: str) -> tuple["IO", Path]:
    """Take a non-blocking exclusive flock on <session_id>.lock.

    Concurrent calls with the same session_id corrupt the remote agent's
    on-disk conversation state. We fail-fast (exit 4) so the caller can
    retry serially.

    Returns (handle, lock_path). The caller must keep handle open for the
    duration of the API call. On exit the lock is released and the file
    is deleted automatically via atexit.
    """
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    lock_path = STATE_DIR / f"{session_id}.lock"
    handle = lock_path.open("w")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        sys.stderr.write(
            f"错误：session {session_id} 已有进行中的调用（lock: {lock_path}）。\n"
            f"同一 session_id 的并发调用会损坏远端 agent 状态，"
            f"请等上一次调用返回后再试。\n"
        )
        sys.exit(4)
    return handle, lock_path


def _release_session_lock(handle: "IO", lock_path: Path) -> None:
    try:
        handle.close()
    except OSError:
        pass
    try:
        lock_path.unlink(missing_ok=True)
    except OSError:
        pass


def _now_iso() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _open_verbose_log(session_id: str) -> tuple[IO, Path, bool]:
    """Open the verbose log file. Returns (handle, path, is_temp).

    When session_id is known upfront, write directly to <session_id>.jsonl
    (append mode — continuing sessions extend the same file). Otherwise
    write to a per-PID temp file that gets renamed once we learn the
    session_id from the result event.
    """
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if session_id:
        path = STATE_DIR / f"{session_id}.jsonl"
        return path.open("a", encoding="utf-8"), path, False
    temp = STATE_DIR / f"_pending.{os.getpid()}.jsonl"
    return temp.open("a", encoding="utf-8"), temp, True


def _write_event(handle: IO, event: str, data) -> None:
    record = {"ts": _now_iso(), "event": event, "data": data}
    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    handle.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="生产环境 Agent 调用器（SSE 网关）")
    parser.add_argument("--prompt", required=True, help="用户的指令内容（对应 vivian message 字段）")
    parser.add_argument("--session-id", default="", help="上一轮会话 ID，留空表示新会话")
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="把所有中间 SSE 事件写入 ./.prod-agent-gateway/<session_id>.jsonl",
    )
    args = parser.parse_args()

    token = load_bearer_token()

    # Fail-fast concurrency guard: only continuation calls (with an
    # explicit session_id) need a lock — new sessions are independent.
    # Lock is held for the entire process lifetime and released on
    # process exit (atexit + OS-level fd cleanup).
    if args.session_id:
        lock_handle, lock_path = acquire_session_lock(args.session_id)
        atexit.register(_release_session_lock, lock_handle, lock_path)

    body: dict = {"message": args.prompt}
    if args.session_id:
        body["session_id"] = args.session_id

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )

    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS)
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"错误：API 返回 HTTP {e.code}\n")
        sys.stderr.write(e.read().decode("utf-8", errors="replace"))
        return 3
    except urllib.error.URLError as e:
        sys.stderr.write(f"错误：网络异常 — {e.reason}\n")
        return 2
    except (TimeoutError, OSError) as e:
        sys.stderr.write(f"错误：连接异常 — {type(e).__name__}: {e}\n")
        return 2

    log_handle: IO | None = None
    log_path: Path | None = None
    log_is_temp = False
    if args.verbose:
        try:
            log_handle, log_path, log_is_temp = _open_verbose_log(args.session_id)
        except OSError as e:
            sys.stderr.write(f"错误：无法打开 verbose 日志文件 — {e}\n")
            return 1

    result_payload: dict | None = None
    stream_error: dict | None = None
    timed_out = False
    # Real wall-clock deadline: urlopen(timeout=) is only a per-socket-op
    # timeout, so a stream that keeps sending keepalives could otherwise
    # run unbounded. We check elapsed time on every SSE event (keepalives
    # included) and abort once the total exceeds TIMEOUT_SECONDS.
    deadline = time.monotonic() + TIMEOUT_SECONDS
    try:
        with resp:
            for event, data_str in iter_sse_events(resp):
                if not data_str:
                    if time.monotonic() > deadline:
                        timed_out = True
                        break
                    continue
                try:
                    payload = json.loads(data_str)
                except json.JSONDecodeError:
                    if time.monotonic() > deadline:
                        timed_out = True
                        break
                    continue
                if log_handle is not None and event != "keepalive":
                    _write_event(log_handle, event, payload)
                if event == "result":
                    result_payload = payload
                    break
                if event in ("stream_error", "retry_exhausted"):
                    stream_error = {"event": event, **payload}
                    break
                if time.monotonic() > deadline:
                    timed_out = True
                    break
    except (TimeoutError, OSError) as e:
        sys.stderr.write(f"错误：SSE 流读取异常 — {type(e).__name__}: {e}\n")
        if log_handle is not None:
            log_handle.close()
        return 2
    finally:
        if log_handle is not None:
            log_handle.close()

    # If verbose+new-session, rename temp log file to final <session_id>.jsonl
    if log_is_temp and log_path is not None:
        final_sid = (result_payload or {}).get("session_id") if result_payload else None
        if final_sid:
            final_path = STATE_DIR / f"{final_sid}.jsonl"
            try:
                if final_path.exists():
                    with final_path.open("ab") as dst, log_path.open("rb") as src:
                        dst.write(src.read())
                    log_path.unlink()
                else:
                    log_path.replace(final_path)
            except OSError as e:
                sys.stderr.write(
                    f"警告：无法把临时日志 {log_path} 重命名为 {final_path} — {e}\n"
                )
        else:
            sys.stderr.write(
                f"警告：verbose 临时日志保留在 {log_path}（未获取到 session_id）\n"
            )

    if timed_out and result_payload is None:
        sys.stderr.write(
            f"错误：整体调用超过 {TIMEOUT_SECONDS} 秒仍未收到 result 事件，已中止。\n"
            f"建议把任务拆分为更小的步骤后重试。\n"
        )
        return 2

    if result_payload is None:
        if stream_error is not None:
            sys.stderr.write("错误：远端 stream 返回错误：\n")
            sys.stderr.write(json.dumps(stream_error, ensure_ascii=False))
            return 3
        sys.stderr.write("错误：SSE 流结束但未收到 result 事件\n")
        return 3

    sys.stdout.write(json.dumps(result_payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
