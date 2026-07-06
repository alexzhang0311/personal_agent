from __future__ import annotations

import asyncio
import fcntl
import os
import pty
import resource
import signal
import struct
import termios
import time
import uuid
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from ..middleware.logging import get_app_logger
from .config import PtySettings, get_settings
from .user_store import get_user_store

logger = get_app_logger(__name__)


def get_pty_config() -> PtySettings:
    """Merge PtySettings defaults with admin-saved runtime overrides."""
    settings = get_settings()
    base = settings.pty.model_dump()
    runtime = get_user_store().get_runtime_config().get("pty") or {}
    if isinstance(runtime, dict):
        for k, v in runtime.items():
            if k in base and v is not None:
                base[k] = v
    return PtySettings(**base)


def update_pty_config(updates: dict) -> PtySettings:
    """Persist admin-provided overrides for PtySettings."""
    current = get_pty_config().model_dump()
    for k, v in updates.items():
        if k in current and v is not None:
            current[k] = v
    PtySettings(**current)  # validate
    get_user_store().update_runtime_config("pty", current)
    return PtySettings(**current)


def _resolve_shell(configured: str) -> str:
    if configured:
        return configured
    return os.environ.get("SHELL") or "/bin/bash"


def _build_preexec(cfg: PtySettings) -> Callable[[], None]:
    cpu = cfg.rlimit_cpu_seconds
    asize = cfg.rlimit_as_bytes
    fsize = cfg.rlimit_fsize_bytes
    nofile = cfg.rlimit_nofile

    def _preexec() -> None:
        # By the time preexec runs, subprocess has already:
        #   - setsid()  (because we pass start_new_session=True)
        #   - dup2 slave_fd onto fd 0/1/2
        # so the child is the new session's leader, but the slave PTY isn't
        # yet its controlling terminal. Make it so. Without this, the shell's
        # tcsetpgrp() fails, the foreground pg is empty, and Ctrl+C is echoed
        # but never delivered as SIGINT to the running command.
        ctty_status = "ok"
        try:
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        except OSError as e:
            ctty_status = f"failed: {e}"
        # One-shot log so we can verify TIOCSCTTY in case the shell's job
        # control is misbehaving. Best-effort only; child can't touch the
        # parent's logger.
        try:
            with open("/tmp/vivian_pty_preexec.log", "a") as f:
                f.write(f"pid={os.getpid()} TIOCSCTTY={ctty_status}\n")
        except Exception:
            pass
        try:
            resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
        except (ValueError, OSError):
            pass
        try:
            resource.setrlimit(resource.RLIMIT_AS, (asize, asize))
        except (ValueError, OSError):
            pass
        try:
            resource.setrlimit(resource.RLIMIT_FSIZE, (fsize, fsize))
        except (ValueError, OSError):
            pass
        try:
            resource.setrlimit(resource.RLIMIT_NOFILE, (nofile, nofile))
        except (ValueError, OSError):
            pass

    return _preexec


def _set_winsize(fd: int, cols: int, rows: int) -> None:
    try:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass


@dataclass
class PtySession:
    username: str
    cwd: str
    cfg: PtySettings
    cols: int
    rows: int
    on_output: Callable[[bytes], Awaitable[None]]
    on_closed: Callable[[str, int | None], Awaitable[None]]

    session_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    master_fd: int = -1
    proc_pid: int = -1
    pgid: int | None = None
    started_at: float = 0.0
    last_input_ts: float = 0.0
    closed: bool = False
    _bucket_tokens: float = 0.0
    _bucket_last_refill: float = 0.0
    _stop_event: asyncio.Event = field(default_factory=asyncio.Event)
    _close_reason: str | None = None
    _exit_code: int | None = None

    async def start(self) -> None:
        cols = max(20, min(self.cfg.max_cols, self.cols))
        rows = max(5, min(self.cfg.max_rows, self.rows))
        self.cols = cols
        self.rows = rows

        shell = _resolve_shell(self.cfg.shell)
        env_overrides = {"TERM": "xterm-256color"}
        cfg = self.cfg
        cwd = self.cwd

        # pty.fork() is the canonical Unix way to spawn a PTY child:
        #   * fork
        #   * child calls setsid()
        #   * child opens the slave by name — on BSD/macOS this open
        #     auto-claims the slave as the new session's controlling
        #     terminal (no TIOCSCTTY needed)
        #   * child dups slave to fd 0/1/2
        # That gets the controlling-tty wiring right so Ctrl+C delivers
        # SIGINT to the foreground process group as expected.
        loop = asyncio.get_running_loop()

        def _fork_and_exec() -> tuple[int, int]:
            pid, master_fd = pty.fork()
            if pid == 0:
                # In the child. Apply rlimits, env, cwd, then exec.
                try:
                    try:
                        resource.setrlimit(resource.RLIMIT_CPU, (cfg.rlimit_cpu_seconds, cfg.rlimit_cpu_seconds))
                    except (ValueError, OSError):
                        pass
                    try:
                        resource.setrlimit(resource.RLIMIT_AS, (cfg.rlimit_as_bytes, cfg.rlimit_as_bytes))
                    except (ValueError, OSError):
                        pass
                    try:
                        resource.setrlimit(resource.RLIMIT_FSIZE, (cfg.rlimit_fsize_bytes, cfg.rlimit_fsize_bytes))
                    except (ValueError, OSError):
                        pass
                    try:
                        resource.setrlimit(resource.RLIMIT_NOFILE, (cfg.rlimit_nofile, cfg.rlimit_nofile))
                    except (ValueError, OSError):
                        pass
                    for k, v in env_overrides.items():
                        os.environ[k] = v
                    try:
                        os.chdir(cwd)
                    except OSError:
                        pass
                    os.execvp(shell, [shell, "-l"])
                except Exception:
                    pass
                # Fallthrough: exec failed. Exit hard so the parent sees an EOF.
                os._exit(127)
            return pid, master_fd

        pid, master_fd = await loop.run_in_executor(None, _fork_and_exec)
        self.master_fd = master_fd
        self.proc_pid = pid
        _set_winsize(master_fd, cols, rows)

        try:
            self.pgid = os.getpgid(pid)
        except OSError:
            self.pgid = pid

        self.started_at = time.time()
        self.last_input_ts = self.started_at
        self._bucket_last_refill = self.started_at
        self._bucket_tokens = float(self.cfg.output_rate_limit_bytes_per_sec)

    def write(self, data: bytes) -> None:
        if self.master_fd < 0:
            return
        try:
            os.write(self.master_fd, data)
            self.last_input_ts = time.time()
        except OSError:
            self._stop_event.set()

    def resize(self, cols: int, rows: int) -> tuple[int, int]:
        cols = max(20, min(self.cfg.max_cols, int(cols)))
        rows = max(5, min(self.cfg.max_rows, int(rows)))
        self.cols = cols
        self.rows = rows
        if self.master_fd >= 0:
            _set_winsize(self.master_fd, cols, rows)
        return cols, rows

    def request_close(self, reason: str = "client_close") -> None:
        if self._close_reason is None:
            self._close_reason = reason
        self._stop_event.set()

    async def _read_loop(self) -> None:
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        def _on_readable() -> None:
            try:
                chunk = os.read(self.master_fd, 4096)
            except OSError:
                queue.put_nowait(None)
                return
            if not chunk:
                queue.put_nowait(None)
                return
            queue.put_nowait(chunk)

        try:
            loop.add_reader(self.master_fd, _on_readable)
        except (OSError, ValueError):
            return

        try:
            while not self._stop_event.is_set():
                try:
                    chunk = await asyncio.wait_for(queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                if chunk is None:
                    if self._close_reason is None:
                        self._close_reason = "process_exit"
                    self._stop_event.set()
                    break
                # Token-bucket throttle.
                now = time.time()
                elapsed = now - self._bucket_last_refill
                if elapsed > 0:
                    self._bucket_tokens = min(
                        float(self.cfg.output_rate_limit_bytes_per_sec),
                        self._bucket_tokens + elapsed * float(self.cfg.output_rate_limit_bytes_per_sec),
                    )
                    self._bucket_last_refill = now
                if self._bucket_tokens < len(chunk):
                    deficit = len(chunk) - self._bucket_tokens
                    rate = max(1.0, float(self.cfg.output_rate_limit_bytes_per_sec))
                    await asyncio.sleep(deficit / rate)
                    self._bucket_tokens = 0.0
                    self._bucket_last_refill = time.time()
                else:
                    self._bucket_tokens -= len(chunk)
                try:
                    await self.on_output(chunk)
                except Exception:
                    self._stop_event.set()
                    break
        finally:
            try:
                loop.remove_reader(self.master_fd)
            except (OSError, ValueError):
                pass

    async def _watchdog(self) -> None:
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=5.0)
                return
            except asyncio.TimeoutError:
                pass
            now = time.time()
            if now - self.last_input_ts > self.cfg.idle_timeout_seconds:
                self._close_reason = "idle_timeout"
                self._stop_event.set()
                return
            if now - self.started_at > self.cfg.absolute_timeout_seconds:
                self._close_reason = "absolute_timeout"
                self._stop_event.set()
                return

    def _try_reap(self) -> bool:
        """Non-blocking waitpid. Returns True if the child exited."""
        if self.proc_pid <= 0:
            return False
        try:
            pid, status = os.waitpid(self.proc_pid, os.WNOHANG)
        except ChildProcessError:
            self._exit_code = -1
            return True
        except OSError:
            return False
        if pid == 0:
            return False
        if os.WIFEXITED(status):
            self._exit_code = os.WEXITSTATUS(status)
        elif os.WIFSIGNALED(status):
            self._exit_code = -os.WTERMSIG(status)
        else:
            self._exit_code = -1
        return True

    async def _wait_proc(self) -> None:
        if self.proc_pid <= 0:
            return
        loop = asyncio.get_running_loop()
        # Block in an executor thread so we don't tie up the event loop.
        try:
            pid, status = await loop.run_in_executor(None, os.waitpid, self.proc_pid, 0)
            if os.WIFEXITED(status):
                self._exit_code = os.WEXITSTATUS(status)
            elif os.WIFSIGNALED(status):
                self._exit_code = -os.WTERMSIG(status)
            else:
                self._exit_code = -1
        except (ChildProcessError, OSError):
            self._exit_code = -1
        if self._close_reason is None:
            self._close_reason = "process_exit"
        self._stop_event.set()

    async def run(self) -> None:
        if self.proc_pid <= 0:
            raise RuntimeError("PtySession.start() must be called before run()")
        reader_task = asyncio.create_task(self._read_loop())
        watchdog_task = asyncio.create_task(self._watchdog())
        proc_task = asyncio.create_task(self._wait_proc())
        try:
            await self._stop_event.wait()
        finally:
            for t in (reader_task, watchdog_task, proc_task):
                t.cancel()
            for t in (reader_task, watchdog_task, proc_task):
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass

    async def teardown(self) -> tuple[str, int | None]:
        if self.closed:
            return self._close_reason or "client_close", self._exit_code
        self.closed = True
        reason = self._close_reason or "client_close"

        if self.pgid is not None:
            try:
                os.killpg(self.pgid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError, OSError):
                pass
            # Brief grace for the shell to flush, then SIGKILL.
            for _ in range(3):
                if self._try_reap():
                    break
                await asyncio.sleep(0.1)
            try:
                os.killpg(self.pgid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass

        if self.proc_pid > 0 and self._exit_code is None:
            # Final blocking reap with a 1s budget.
            for _ in range(10):
                if self._try_reap():
                    break
                await asyncio.sleep(0.1)

        if self.master_fd >= 0:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = -1

        try:
            await self.on_closed(reason, self._exit_code)
        except Exception:
            pass
        return reason, self._exit_code


_active_sessions: dict[str, list[PtySession]] = {}
_registry_lock = asyncio.Lock()


async def register_session(
    username: str,
    session: PtySession,
    max_sessions: int,
) -> list[PtySession]:
    """Register `session` for `username`. If adding it would exceed
    `max_sessions`, evict the oldest sessions until we fit (FIFO).

    Returns the list of evicted sessions so the caller can audit-log them.
    The new session always wins.
    """
    cap = max(1, int(max_sessions or 1))
    evicted: list[PtySession] = []
    async with _registry_lock:
        bucket = _active_sessions.setdefault(username, [])
        # Drop any zombie entries (sessions already closed).
        bucket[:] = [s for s in bucket if not s.closed]
        # Evict from the oldest end until we have room for one more.
        while len(bucket) >= cap:
            old = bucket.pop(0)
            old.request_close("superseded")
            evicted.append(old)
        bucket.append(session)
    return evicted


async def unregister_session(username: str, session: PtySession) -> None:
    async with _registry_lock:
        bucket = _active_sessions.get(username)
        if not bucket:
            return
        try:
            bucket.remove(session)
        except ValueError:
            pass
        if not bucket:
            _active_sessions.pop(username, None)


async def list_active_sessions() -> list[PtySession]:
    async with _registry_lock:
        out: list[PtySession] = []
        for bucket in _active_sessions.values():
            out.extend(bucket)
        return out


async def kill_all_sessions(reason: str) -> list[PtySession]:
    async with _registry_lock:
        sessions: list[PtySession] = []
        for bucket in _active_sessions.values():
            sessions.extend(bucket)
    for s in sessions:
        s.request_close(reason)
    return sessions
