"""
Built-in task execution handlers for non-agent job types.

Each handler follows the interface:
    async def execute_*(config, username, cwd, emit, cancelled) -> dict
    Returns: {"is_error": bool, "result": str, "duration_ms": int}

Event types emitted per job type:

  http_call:
    http_request  — {method, url, headers}
    http_response — {status_code, reason, body, elapsed_ms, is_error}
    http_error    — {error, elapsed_ms}

  user_script:
    script_start  — {language, source, file_path}
    script_output — {line}
    script_exit   — {exit_code, elapsed_ms, timed_out}
    script_error  — {error, elapsed_ms}
"""
from __future__ import annotations

import asyncio
import os
import tempfile
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from ...models.scheduler import HttpCallConfig, UserScriptConfig


async def execute_http_call(
    config: HttpCallConfig,
    username: str,
    cwd: str,
    emit: Callable[[str, dict[str, Any]], Awaitable[None]],
    cancelled: asyncio.Event | None = None,
) -> dict:
    """Execute an HTTP call job."""
    start = time.monotonic()

    await emit("http_request", {
        "method": config.method,
        "url": config.url,
        "headers": config.headers or {},
    })

    try:
        async with httpx.AsyncClient(timeout=config.timeout_seconds) as client:
            response = await client.request(
                method=config.method,
                url=config.url,
                headers=config.headers or {},
                content=config.body if config.body else None,
            )

        elapsed_ms = int((time.monotonic() - start) * 1000)
        is_error = response.status_code >= 400
        body_text = response.text[:2000]

        await emit("http_response", {
            "status_code": response.status_code,
            "reason": response.reason_phrase,
            "body": body_text,
            "elapsed_ms": elapsed_ms,
            "is_error": is_error,
        })

        result_text = f"HTTP {response.status_code} {response.reason_phrase}\n\n{body_text}"
        return {
            "is_error": is_error,
            "result": result_text,
            "duration_ms": elapsed_ms,
        }

    except httpx.TimeoutException:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        msg = f"HTTP request timed out after {config.timeout_seconds}s"
        await emit("http_error", {"error": msg, "elapsed_ms": elapsed_ms})
        return {"is_error": True, "result": msg, "duration_ms": elapsed_ms}

    except httpx.ConnectError as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        msg = f"Connection error: {e}"
        await emit("http_error", {"error": msg, "elapsed_ms": elapsed_ms})
        return {"is_error": True, "result": msg, "duration_ms": elapsed_ms}

    except Exception as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        msg = f"HTTP call failed: {e}"
        await emit("http_error", {"error": msg, "elapsed_ms": elapsed_ms})
        return {"is_error": True, "result": msg, "duration_ms": elapsed_ms}


async def execute_user_script(
    config: UserScriptConfig,
    username: str,
    cwd: str,
    emit: Callable[[str, dict[str, Any]], Awaitable[None]],
    cancelled: asyncio.Event | None = None,
) -> dict:
    """Execute a user script (python or shell)."""
    start = time.monotonic()
    tmp_file = None

    try:
        # Determine script path
        if config.source == "file":
            if not config.file_path:
                return {"is_error": True, "result": "No file_path specified", "duration_ms": 0}

            # Expand ~ and resolve path
            expanded = os.path.expanduser(config.file_path)
            script_path = expanded if os.path.isabs(expanded) else os.path.join(cwd, expanded)
            script_path = os.path.realpath(script_path)

            if not os.path.isfile(script_path):
                return {"is_error": True, "result": f"Script file not found: {config.file_path}", "duration_ms": 0}

            if not os.access(script_path, os.R_OK):
                return {"is_error": True, "result": f"Script file not readable: {config.file_path}", "duration_ms": 0}

        elif config.source == "inline":
            if not config.script:
                return {"is_error": True, "result": "No inline script content", "duration_ms": 0}

            suffix = ".py" if config.language == "python" else ".sh"
            tmp_fd, tmp_path = tempfile.mkstemp(suffix=suffix, dir=cwd, prefix=".scheduler_")
            tmp_file = tmp_path
            with os.fdopen(tmp_fd, "w") as f:
                f.write(config.script)
            script_path = tmp_path
        else:
            return {"is_error": True, "result": f"Unknown source: {config.source}", "duration_ms": 0}

        # Choose interpreter
        interpreter = "python3" if config.language == "python" else "/bin/bash"

        await emit("script_start", {
            "language": config.language,
            "source": config.source,
            "file_path": config.file_path or "(inline)",
            "command": f"{interpreter} {script_path}",
            "cwd": cwd,
        })

        # Execute
        proc = await asyncio.create_subprocess_exec(
            interpreter, script_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )

        output_lines = []
        stdout_task = None
        stderr_task = None

        try:
            async def read_stream(stream, stream_name):
                while True:
                    line = await stream.readline()
                    if not line:
                        break
                    text = line.decode("utf-8", errors="replace").rstrip("\n")
                    output_lines.append(text)
                    await emit("script_output", {"line": text, "stream": stream_name})

            stdout_task = asyncio.create_task(read_stream(proc.stdout, "stdout"))
            stderr_task = asyncio.create_task(read_stream(proc.stderr, "stderr"))

            # Wait for process with timeout, also check cancellation
            timed_out = False
            try:
                if cancelled is not None:
                    # Race between process completion, timeout, and cancellation
                    cancel_task = asyncio.create_task(cancelled.wait())
                    wait_task = asyncio.create_task(asyncio.wait_for(proc.wait(), timeout=config.timeout_seconds))
                    done, pending = await asyncio.wait(
                        [cancel_task, wait_task], return_when=asyncio.FIRST_COMPLETED,
                    )
                    for t in pending:
                        t.cancel()
                        try:
                            await t
                        except (asyncio.CancelledError, asyncio.TimeoutError):
                            pass
                    if cancel_task in done:
                        proc.kill()
                        await proc.wait()
                        elapsed_ms = int((time.monotonic() - start) * 1000)
                        await emit("script_exit", {"exit_code": -1, "elapsed_ms": elapsed_ms, "timed_out": False})
                        return {"is_error": True, "result": "Cancelled by user", "duration_ms": elapsed_ms}
                    # Check if wait_task raised TimeoutError
                    if wait_task in done:
                        exc = wait_task.exception()
                        if isinstance(exc, asyncio.TimeoutError):
                            timed_out = True
                else:
                    await asyncio.wait_for(proc.wait(), timeout=config.timeout_seconds)
            except asyncio.TimeoutError:
                timed_out = True

            if timed_out:
                proc.kill()
                await proc.wait()
                elapsed_ms = int((time.monotonic() - start) * 1000)
                await emit("script_exit", {"exit_code": -1, "elapsed_ms": elapsed_ms, "timed_out": True})
                msg = f"Script timed out after {config.timeout_seconds}s"
                return {"is_error": True, "result": msg, "duration_ms": elapsed_ms}

            # Drain remaining output
            await stdout_task
            await stderr_task

            elapsed_ms = int((time.monotonic() - start) * 1000)
            output_text = "\n".join(output_lines)[:5000]
            is_error = proc.returncode != 0

            await emit("script_exit", {
                "exit_code": proc.returncode,
                "elapsed_ms": elapsed_ms,
                "timed_out": False,
            })

            if is_error:
                result_text = f"Script exited with code {proc.returncode}\n\n{output_text}"
            else:
                result_text = output_text or "(no output)"

            return {
                "is_error": is_error,
                "result": result_text,
                "duration_ms": elapsed_ms,
            }

        except (asyncio.CancelledError, Exception):
            # Ensure subprocess is killed on any unexpected error or cancellation
            if proc.returncode is None:
                proc.kill()
                try:
                    await proc.wait()
                except Exception:
                    pass
            raise

        finally:
            # Always clean up stream reader tasks
            for t in (stdout_task, stderr_task):
                if t is not None and not t.done():
                    t.cancel()
                    try:
                        await t
                    except (asyncio.CancelledError, Exception):
                        pass

    except asyncio.CancelledError:
        raise
    except Exception as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        msg = f"Script execution failed: {e}"
        await emit("script_error", {"error": msg, "elapsed_ms": elapsed_ms})
        return {"is_error": True, "result": msg, "duration_ms": elapsed_ms}

    finally:
        if tmp_file and os.path.exists(tmp_file):
            try:
                os.unlink(tmp_file)
            except OSError:
                pass
