from __future__ import annotations

import gzip
import io
import logging
import os
import re
import shutil
import sys
import threading
from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta
from pathlib import Path
from typing import TextIO

from fastapi import Request
from loguru import logger

from ..services.config import LoggingTargetSettings, Settings

APP_LOGGER_PREFIXES = ("api.", "vivian.api.")
ROTATED_LOG_RE = re.compile(
    r"\.(?P<stamp>\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d{6})(?:\.\d+)?(?P<suffix>\.[^.]+)$"
)


def get_app_logger(name: str | None = None):
    extra = {"channel": "app"}
    if name:
        extra["component"] = name
    return logger.bind(**extra)


def get_server_logger(name: str | None = None):
    extra = {"channel": "server"}
    if name:
        extra["component"] = name
    return logger.bind(**extra)


def get_access_logger():
    return logger.bind(channel="access")


def get_scheduler_logger(name: str | None = None):
    extra = {"channel": "scheduler"}
    if name:
        extra["component"] = name
    return logger.bind(**extra)


def get_channels_logger(name: str | None = None):
    extra = {"channel": "channels"}
    if name:
        extra["component"] = name
    return logger.bind(**extra)


class _InterceptHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        if record.name == "uvicorn.access":
            return

        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame = logging.currentframe()
        depth = 2
        while frame and frame.f_code.co_filename in {logging.__file__, __file__}:
            frame = frame.f_back
            depth += 1

        channel = "app" if record.name.startswith(APP_LOGGER_PREFIXES) else "server"
        logger.bind(channel=channel).opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


class _StreamToLogger(io.TextIOBase):
    def __init__(self, level: str, wrapped: TextIO):
        self._level = level
        self._wrapped = wrapped
        self._buffer = ""
        self._encoding = getattr(wrapped, "encoding", "utf-8")

    @property
    def encoding(self) -> str:
        return self._encoding

    def write(self, text: str) -> int:
        if not text:
            return 0

        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._emit_line(line)
        return len(text)

    def flush(self) -> None:
        if self._buffer:
            self._emit_line(self._buffer)
            self._buffer = ""

    def isatty(self) -> bool:
        return False

    def fileno(self) -> int:
        return self._wrapped.fileno()

    def writable(self) -> bool:
        return True

    def _emit_line(self, line: str) -> None:
        message = line.rstrip()
        if not message:
            return
        logger.bind(channel="server").opt(depth=1).log(self._level, message)


class _HourlyRotation:
    def __init__(self, rotation_time: str | None):
        self._rotation_time = _parse_rotation_time(rotation_time) if rotation_time else dt_time(hour=0, minute=0)
        self._active_slot: datetime | None = None

    def __call__(self, message, file) -> bool:
        record_time = message.record["time"].astimezone()
        record_slot = self._slot_start(record_time)
        active_slot = self._active_slot or self._infer_file_slot(file, record_slot)

        if record_slot > active_slot:
            self._active_slot = record_slot
            return True

        self._active_slot = active_slot
        return False

    def _infer_file_slot(self, file, fallback: datetime) -> datetime:
        try:
            stat = os.stat(file.name)
        except OSError:
            return fallback

        if stat.st_size == 0:
            return fallback

        return self._slot_start(datetime.fromtimestamp(stat.st_mtime).astimezone())

    def _slot_start(self, current: datetime) -> datetime:
        candidate = current.replace(
            minute=self._rotation_time.minute,
            second=0,
            microsecond=0,
        )
        if current < candidate:
            candidate -= timedelta(hours=1)
        return candidate


@dataclass
class _LoggingState:
    original_stdout: TextIO
    original_stderr: TextIO
    stdout_proxy: _StreamToLogger
    stderr_proxy: _StreamToLogger


_lock = threading.Lock()
_state: _LoggingState | None = None


def configure_logging(settings) -> None:
    global _state

    with _lock:
        if _state is not None:
            return

        logger.remove()
        logger.configure(extra={"channel": "server"})

        _add_sink("server", settings.logging.server)
        _add_sink("app", settings.logging.app)
        _add_sink("access", settings.logging.access)
        _add_sink("scheduler", settings.logging.scheduler)
        _add_sink("channels", settings.logging.channels)

        intercept_handler = _InterceptHandler()
        root_logger = logging.getLogger()
        root_logger.handlers = [intercept_handler]
        root_logger.setLevel(logging.NOTSET)

        for name in list(logging.root.manager.loggerDict.keys()):
            std_logger = logging.getLogger(name)
            std_logger.handlers = []
            std_logger.propagate = True

        access_logger = logging.getLogger("uvicorn.access")
        access_logger.handlers = []
        access_logger.propagate = False
        access_logger.disabled = True

        logging.captureWarnings(True)

        original_stdout = sys.stdout
        original_stderr = sys.stderr
        stdout_proxy = _StreamToLogger("INFO", original_stdout)
        stderr_proxy = _StreamToLogger("ERROR", original_stderr)
        sys.stdout = stdout_proxy
        sys.stderr = stderr_proxy

        _state = _LoggingState(
            original_stdout=original_stdout,
            original_stderr=original_stderr,
            stdout_proxy=stdout_proxy,
            stderr_proxy=stderr_proxy,
        )


def shutdown_logging() -> None:
    global _state

    with _lock:
        if _state is None:
            return

        _state.stdout_proxy.flush()
        _state.stderr_proxy.flush()
        sys.stdout = _state.original_stdout
        sys.stderr = _state.original_stderr
        logging.captureWarnings(False)
        logger.complete()
        logger.remove()
        _state = None


class AccessLogMiddleware:
    def __init__(self, app):
        self.app = app
        self.logger = get_access_logger()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        started_at = datetime.now()
        status_code = 500

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            duration_ms = _duration_ms(started_at)
            self._log_request(request, scope, status_code, duration_ms)
            raise

        duration_ms = _duration_ms(started_at)
        self._log_request(request, scope, status_code, duration_ms)

    def _log_request(self, request: Request, scope, status_code: int, duration_ms: int) -> None:
        user = getattr(request.state, "user", None)
        route = scope.get("route")
        route_path = getattr(route, "path", None)
        path = route_path or request.url.path
        user_name = getattr(user, "username", None) or request.headers.get("x-user-name") or "anonymous"

        # Record HTTP metrics here: this method already has the resolved route
        # template, method, status and duration, so no duplicate route lookup.
        # The /metrics scrape itself is excluded from both metrics and the
        # access log (self-instrumentation noise + scrape flood).
        handler = route_path or "__unmatched__"
        if handler != "/metrics":
            from ..metrics import HTTP_DURATION, HTTP_REQUESTS

            HTTP_REQUESTS.labels(handler, request.method, str(status_code)).inc()
            HTTP_DURATION.labels(handler, request.method).observe(duration_ms / 1000.0)
        else:
            return

        self.logger.bind(
            client_ip=_extract_client_ip(request),
            method=request.method,
            path=path,
            status_code=status_code,
            duration_ms=duration_ms,
            user_name=user_name,
        ).info("")


def _add_sink(channel: str, config: LoggingTargetSettings) -> None:
    log_path = _resolve_log_path(config.path)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    logger.add(
        log_path,
        level=config.level,
        format=config.format,
        rotation=_HourlyRotation(config.rotation_time),
        retention=config.retention,
        compression=_make_hourly_archive_compression(log_path),
        enqueue=True,
        encoding="utf-8",
        catch=True,
        filter=lambda record, target_channel=channel: record["extra"].get("channel", "server") == target_channel,
    )


def _resolve_log_path(raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return path
    return Settings.yaml_file.parent.parent / path


def _parse_rotation_time(value: str) -> dt_time:
    try:
        hour_text, minute_text = value.split(":", 1)
        return dt_time(hour=int(hour_text), minute=int(minute_text))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid rotation time '{value}'") from exc


def _make_hourly_archive_compression(log_path: Path):
    def _compress(path_in: str) -> None:
        source = Path(path_in)
        archive_slot = _parse_archive_slot(source) or datetime.fromtimestamp(source.stat().st_mtime).astimezone().strftime(
            "%Y-%m-%d_%H"
        )
        target = _build_archive_path(log_path, archive_slot)

        with source.open("rb") as source_file:
            with gzip.open(target, "wb") as target_file:
                shutil.copyfileobj(source_file, target_file)

        source.unlink()

    return _compress


def _parse_archive_slot(path: Path) -> str | None:
    match = ROTATED_LOG_RE.search(path.name)
    if not match:
        return None

    try:
        archived_at = datetime.strptime(match.group("stamp"), "%Y-%m-%d_%H-%M-%S_%f")
    except ValueError:
        return None

    return archived_at.strftime("%Y-%m-%d_%H")


def _build_archive_path(log_path: Path, archive_slot: str) -> Path:
    base_name = f"{log_path.stem}.{archive_slot}{log_path.suffix}.gz"
    candidate = log_path.with_name(base_name)
    counter = 2

    while candidate.exists():
        candidate = log_path.with_name(f"{log_path.stem}.{archive_slot}.{counter}{log_path.suffix}.gz")
        counter += 1

    return candidate


def _duration_ms(started_at: datetime) -> int:
    return int((datetime.now() - started_at).total_seconds() * 1000)


def _extract_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "-"
