"""
Scheduler Daemon — standalone async process.

Run with: python -m api.services.scheduler.daemon
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger

# Ensure project root is on sys.path so relative imports work
_daemon_file = Path(__file__).resolve()
_project_root = _daemon_file.parent.parent.parent.parent  # vivian/api/services/scheduler -> vivian
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

# Remove CLAUDECODE env var to prevent "nested session" error from Claude SDK
os.environ.pop("CLAUDECODE", None)

from api.middleware.logging import configure_logging, get_scheduler_logger
from api.models.scheduler import AgentRunConfig, HttpCallConfig, JobRunRecord, ScheduledJobDefinition, ToolRetryConfig, UserScriptConfig
from api.services.audit_log import AuditEntry, get_audit_logger
from api.services.config import get_settings
from api.services.scheduler.job_store import JobStore
from api.services.scheduler.run_history import RunHistoryStore
from api.services.scheduler.shared import (
    build_trigger,
    get_commands_dir,
    get_heartbeat_path,
    get_jobs_state_path,
    get_scheduler_dir,
    get_state_path,
    get_user_runs_dir,
)
from api.services.user_env import read_user_env
from api.services.user_store import get_user_store

logger = get_scheduler_logger("daemon")


@dataclass
class ActiveRun:
    run_id: str
    job_key: str
    username: str
    job_def: ScheduledJobDefinition
    cancelled: asyncio.Event
    started_at: datetime
    task: asyncio.Task | None = None


class SchedulerDaemon:
    def __init__(self):
        self._settings = get_settings()
        self._scheduler = AsyncIOScheduler()
        self._active_runs: dict[str, ActiveRun] = {}
        self._job_locks: dict[str, asyncio.Lock] = {}
        self._job_store = JobStore()
        self._run_history = RunHistoryStore()
        self._shutdown_requested = False

    async def start(self) -> None:
        configure_logging(self._settings)
        logger.info("Scheduler daemon starting...")

        # Create directories
        for d in (get_scheduler_dir(), get_commands_dir()):
            d.mkdir(parents=True, exist_ok=True)
        failed_dir = get_commands_dir() / "failed"
        failed_dir.mkdir(parents=True, exist_ok=True)

        # Register signal handlers
        loop = asyncio.get_event_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, self._signal_handler)

        # Load all users' jobs
        self._load_all_jobs()

        # Run initial history cleanup
        await self._run_initial_cleanup()

        # Process any leftover commands (crash recovery)
        await self._process_pending_commands()

        # Start APScheduler
        self._scheduler.start()
        logger.info("APScheduler started")

        # Register daily cleanup job (always register — _daily_cleanup checks retention at runtime)
        self._scheduler.add_job(
            self._daily_cleanup,
            trigger=IntervalTrigger(hours=24),
            id="__internal__cleanup",
            replace_existing=True,
        )

        # Write initial heartbeat + state
        await self._write_heartbeat()
        await self._update_state_file()
        await self._update_jobs_state_file()

        # Main loop
        poll_interval = self._settings.scheduler.command_poll_interval
        heartbeat_interval = self._settings.scheduler.heartbeat_interval
        last_heartbeat = time.monotonic()

        while not self._shutdown_requested:
            await self._process_pending_commands()

            now = time.monotonic()
            if now - last_heartbeat >= heartbeat_interval:
                await self._write_heartbeat()
                await self._update_state_file()
                await self._update_jobs_state_file()
                last_heartbeat = now

            await asyncio.sleep(poll_interval)

        # Graceful shutdown
        await self._shutdown()

    def _signal_handler(self) -> None:
        logger.info("Received shutdown signal")
        self._shutdown_requested = True

    def _load_all_jobs(self) -> None:
        all_jobs = self._job_store.list_all_user_jobs()
        total = 0
        for username, jobs in all_jobs.items():
            for job_def in jobs:
                if job_def.status == "active":
                    self._register_job(username, job_def)
                    total += 1
        logger.info("Loaded {} active jobs across {} users", total, len(all_jobs))

    def _register_job(self, username: str, job_def: ScheduledJobDefinition) -> None:
        job_key = f"{username}::{job_def.id}"
        try:
            trigger = build_trigger(job_def.trigger, job_def.timezone)
        except Exception as e:
            logger.error("Failed to build trigger for job {}: {}", job_key, e)
            return

        # Remove existing job if any
        self._remove_aps_job(job_key)

        self._scheduler.add_job(
            self._schedule_execution,
            trigger=trigger,
            id=job_key,
            args=[username, job_def],
            replace_existing=True,
            misfire_grace_time=60,
            max_instances=1,
        )
        logger.info("Registered job: {}", job_key)

    def _remove_aps_job(self, job_key: str) -> None:
        try:
            self._scheduler.remove_job(job_key)
        except Exception:
            pass  # Job may not exist

    async def _schedule_execution(self, username: str, job_def: ScheduledJobDefinition) -> None:
        """APScheduler calls this. Wraps _execute_job in a tracked task."""
        logger.info("APScheduler fired job: {}::{}", username, job_def.id)
        task = asyncio.get_event_loop().create_task(self._execute_job(username, job_def))
        task.add_done_callback(self._task_done_callback)

    def _task_done_callback(self, task: asyncio.Task) -> None:
        """Log unhandled exceptions from fire-and-forget job tasks."""
        if task.cancelled():
            return
        exc = task.exception()
        if exc:
            logger.error("Unhandled exception in job task: {}", exc)

    def _get_job_type(self, job_def: ScheduledJobDefinition) -> str:
        """Determine the effective job type from config."""
        if job_def.job_config:
            return job_def.job_config.job_type
        return "scheduled_agent"

    async def _execute_job(self, username: str, job_def: ScheduledJobDefinition) -> None:
        job_key = f"{username}::{job_def.id}"
        job_type = self._get_job_type(job_def)
        logger.info("Executing job: {} (type={}, prompt={!r})", job_key, job_type, (job_def.prompt or "")[:50])
        lock = self._job_locks.setdefault(job_key, asyncio.Lock())

        if lock.locked():
            # Already running — skip
            self._run_history.append(JobRunRecord(
                run_id=str(uuid4()),
                job_id=job_def.id,
                job_name=job_def.name,
                username=username,
                status="skipped",
                error_message="Previous run still in progress",
            ))
            logger.info("Skipping job {} — previous run still in progress", job_key)
            return

        async with lock:
            run_id = str(uuid4())
            cancelled = asyncio.Event()
            run_output_dir = get_user_runs_dir(username)
            run_output_dir.mkdir(parents=True, exist_ok=True)
            run_output_path = run_output_dir / f"{run_id}.jsonl"
            result_payload: dict = {}
            started_at = datetime.now(timezone.utc)

            active_run = ActiveRun(
                run_id=run_id,
                job_key=job_key,
                username=username,
                job_def=job_def,
                cancelled=cancelled,
                started_at=started_at,
                task=asyncio.current_task(),
            )
            self._active_runs[run_id] = active_run

            try:
                # 1. Verify user still exists
                user_store = get_user_store()
                if not user_store.get_user(username):
                    logger.warning("User {} no longer exists, removing job {}", username, job_key)
                    self._remove_aps_job(job_key)
                    return

                # 2. Verify API credentials (only for scheduled_agent jobs)
                if job_type == "scheduled_agent":
                    env = read_user_env(username)
                    if not env or not env.get("ANTHROPIC_BASE_URL") or not env.get("ANTHROPIC_AUTH_TOKEN"):
                        self._run_history.append(JobRunRecord(
                            run_id=run_id,
                            job_id=job_def.id,
                            job_name=job_def.name,
                            username=username,
                            status="error",
                            error_message="API credentials not configured",
                        ))
                        logger.warning("No API credentials for user {}, job {}", username, job_key)
                        return

                # 3. Record "running" in history FIRST (P2 race fix)
                self._run_history.append(JobRunRecord(
                    run_id=run_id,
                    job_id=job_def.id,
                    job_name=job_def.name,
                    username=username,
                    started_at=started_at,
                    status="running",
                ))

                audit = get_audit_logger()
                audit.append(AuditEntry(
                    actor=f"scheduler:{username}",
                    action="scheduler.job_started",
                    target=job_def.id,
                    details={"run_id": run_id, "job_name": job_def.name, "job_type": job_type},
                ))

                # 4. NOW expose in state.json
                await self._update_state_file()

                # 5. Build emit callback
                def _write_event(path, line):
                    with open(path, "a") as f:
                        f.write(line)

                async def emit(event_type: str, data: dict) -> None:
                    nonlocal result_payload
                    await asyncio.to_thread(_write_event, run_output_path, json.dumps({"event": event_type, "data": data}) + "\n")
                    if event_type == "result":
                        result_payload = data

                cwd = os.path.join(
                    os.path.expanduser(self._settings.server.work_dir),
                    username,
                )

                # 6. Execute by job type
                if job_type == "scheduled_agent":
                    from api.services.claude_sdk.service import agent_run_events

                    config = job_def.job_config
                    prompt = config.prompt if isinstance(config, AgentRunConfig) else job_def.prompt
                    model = (config.model if isinstance(config, AgentRunConfig) else None) or job_def.model

                    await agent_run_events(
                        prompt=prompt,
                        session_id=None,
                        permission_mode="bypassPermissions",
                        cwd=cwd,
                        username=username,
                        model_override=model,
                        emit=emit,
                        cancelled=cancelled,
                        inject_scheduler_tools=False,
                    )

                elif job_type == "http_call":
                    from api.services.scheduler.builtin_tasks import execute_http_call
                    result_payload = await execute_http_call(
                        config=job_def.job_config,
                        username=username,
                        cwd=cwd,
                        emit=emit,
                        cancelled=cancelled,
                    )

                elif job_type == "user_script":
                    from api.services.scheduler.builtin_tasks import execute_user_script
                    result_payload = await execute_user_script(
                        config=job_def.job_config,
                        username=username,
                        cwd=cwd,
                        emit=emit,
                        cancelled=cancelled,
                    )

                elif job_type == "tool_retry":
                    from api.services.scheduler.tool_retry import execute_tool_retry
                    result_payload = await execute_tool_retry(
                        config=job_def.job_config,
                        username=username,
                        cwd=cwd,
                        emit=emit,
                        cancelled=cancelled,
                    )

                else:
                    raise ValueError(f"Unknown job type: {job_type}")

                # 7. Record outcome
                finished_at = datetime.now(timezone.utc)
                elapsed_ms = int((finished_at - started_at).total_seconds() * 1000)
                is_error = result_payload.get("is_error", False)

                self._run_history.append(JobRunRecord(
                    run_id=run_id,
                    job_id=job_def.id,
                    job_name=job_def.name,
                    username=username,
                    started_at=started_at,
                    finished_at=finished_at,
                    status="error" if is_error else "success",
                    duration_ms=result_payload.get("duration_ms", elapsed_ms),
                    num_turns=result_payload.get("num_turns", 0),
                    total_cost_usd=result_payload.get("total_cost_usd"),
                    result_summary=(result_payload.get("result") or "")[:500],
                    is_error=is_error,
                    error_message=(result_payload.get("result") or "")[:500] if is_error else None,
                    session_id=result_payload.get("session_id"),
                ))

                audit.append(AuditEntry(
                    actor=f"scheduler:{username}",
                    action="scheduler.job_finished",
                    target=job_def.id,
                    details={
                        "run_id": run_id,
                        "status": "error" if is_error else "success",
                        "duration_ms": elapsed_ms,
                        "job_type": job_type,
                    },
                ))

            except asyncio.CancelledError:
                self._run_history.append(JobRunRecord(
                    run_id=run_id,
                    job_id=job_def.id,
                    job_name=job_def.name,
                    username=username,
                    started_at=started_at,
                    finished_at=datetime.now(timezone.utc),
                    status="cancelled",
                ))
            except Exception as e:
                logger.exception("Job {} failed: {}", job_key, e)
                self._run_history.append(JobRunRecord(
                    run_id=run_id,
                    job_id=job_def.id,
                    job_name=job_def.name,
                    username=username,
                    started_at=started_at,
                    finished_at=datetime.now(timezone.utc),
                    status="error",
                    is_error=True,
                    error_message=str(e)[:500],
                ))
            finally:
                self._active_runs.pop(run_id, None)
                await self._update_state_file()

    # --- History cleanup ---

    def _get_retention_days(self) -> int:
        """Read the up-to-date retention config from runtime config (default 7)."""
        try:
            store = get_user_store()
            runtime = store.get_runtime_config()
            return runtime.get("history_retention_days", 7)
        except Exception:
            return 7

    async def _run_initial_cleanup(self) -> None:
        retention_days = self._get_retention_days()
        if retention_days <= 0:
            return
        logger.info("Running initial history cleanup (retention={}d)", retention_days)
        await asyncio.to_thread(self._run_history.purge_all_users, retention_days)

    async def _daily_cleanup(self) -> None:
        retention_days = self._get_retention_days()
        if retention_days <= 0:
            return
        logger.info("Running daily history cleanup (retention={}d)", retention_days)
        await asyncio.to_thread(self._run_history.purge_all_users, retention_days)

    # --- Command processing ---

    async def _process_pending_commands(self) -> None:
        commands_dir = get_commands_dir()
        if not commands_dir.exists():
            return

        failed_dir = commands_dir / "failed"
        failed_dir.mkdir(parents=True, exist_ok=True)

        # Process files sorted by name (timestamp order)
        cmd_files = sorted(
            [f for f in commands_dir.iterdir() if f.is_file() and f.suffix == ".json"],
            key=lambda f: f.name,
        )

        for cmd_file in cmd_files:
            try:
                with open(cmd_file, "r") as f:
                    data = json.load(f)

                cmd_type = data.get("type")
                payload = data.get("payload", {})

                if cmd_type == "reload_user":
                    await self._handle_reload_user(payload.get("username"))
                elif cmd_type == "trigger_now":
                    self._handle_trigger_now(payload.get("username"), payload.get("job_id"))
                elif cmd_type == "remove_user":
                    await self._handle_remove_user(payload.get("username"))
                elif cmd_type == "cancel_run":
                    self._handle_cancel_run(payload.get("run_id"))
                elif cmd_type == "tool_retry":
                    await self._handle_tool_retry(payload)
                else:
                    logger.warning("Unknown command type: {}", cmd_type)

                # Delete after successful processing
                cmd_file.unlink()

            except Exception as e:
                logger.error("Failed to process command {}: {}", cmd_file.name, e)
                # Move to failed/
                try:
                    cmd_file.rename(failed_dir / cmd_file.name)
                except Exception:
                    pass

    async def _handle_reload_user(self, username: str | None) -> None:
        if not username:
            return
        logger.info("Reloading jobs for user: {}", username)

        # Remove all existing jobs for this user
        prefix = f"{username}::"
        job_ids = [j.id for j in self._scheduler.get_jobs() if j.id.startswith(prefix)]
        for jid in job_ids:
            self._remove_aps_job(jid)

        # Re-register from YAML
        jobs = self._job_store.list_jobs(username)
        for job_def in jobs:
            if job_def.status == "active":
                self._register_job(username, job_def)

        await self._update_jobs_state_file()

    def _handle_trigger_now(self, username: str | None, job_id: str | None) -> None:
        if not username or not job_id:
            return
        job_def = self._job_store.get_job(username, job_id)
        if not job_def:
            logger.warning("Job not found for trigger_now: {}::{}", username, job_id)
            return

        # One-shot DateTrigger
        trigger_id = f"{username}::{job_id}::trigger_{uuid4().hex[:8]}"
        self._scheduler.add_job(
            self._schedule_execution,
            trigger=DateTrigger(run_date=datetime.now(timezone.utc)),
            id=trigger_id,
            args=[username, job_def],
            replace_existing=False,
        )
        logger.info("Triggered immediate run for {}::{}", username, job_id)

    async def _handle_remove_user(self, username: str | None) -> None:
        if not username:
            return
        logger.info("Removing all jobs for user: {}", username)
        prefix = f"{username}::"
        job_ids = [j.id for j in self._scheduler.get_jobs() if j.id.startswith(prefix)]
        for jid in job_ids:
            self._remove_aps_job(jid)
        await self._update_jobs_state_file()

    def _handle_cancel_run(self, run_id: str | None) -> None:
        if not run_id:
            return
        active = self._active_runs.get(run_id)
        if active:
            logger.info("Cancelling run: {}", run_id)
            active.cancelled.set()
        else:
            logger.warning("Run {} not found in active runs", run_id)

    async def _handle_tool_retry(self, payload: dict) -> None:
        """Handle a tool_retry command: fire ephemeral retry task immediately."""
        from api.models.scheduler import IntervalTriggerConfig

        username = payload.get("username", "system")
        job_def = ScheduledJobDefinition(
            id=f"retry_{uuid4().hex[:8]}",
            name=f"Retry: {payload['tool_name']}",
            trigger=IntervalTriggerConfig(),  # dummy, not scheduled
            timezone="UTC",
            status="active",
            job_config=ToolRetryConfig(
                tool_name=payload["tool_name"],
                tool_input=payload.get("tool_input", {}),
                session_id=payload.get("session_id", ""),
                max_retries=payload.get("max_retries", 3),
                interval_seconds=payload.get("interval_seconds", 30),
                original_error=payload.get("original_error", ""),
            ),
        )
        # Fire as one-shot via DateTrigger (same pattern as _handle_trigger_now)
        trigger_id = f"{username}::{job_def.id}::retry"
        self._scheduler.add_job(
            self._schedule_execution,
            trigger=DateTrigger(run_date=datetime.now(timezone.utc)),
            id=trigger_id,
            args=[username, job_def],
            replace_existing=False,
        )
        logger.info("Queued tool retry for {}::{}", username, payload["tool_name"])

    # --- State files (all async to avoid blocking the event loop) ---

    async def _write_heartbeat(self) -> None:
        path = get_heartbeat_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(_atomic_write, path, datetime.now(timezone.utc).isoformat())

    async def _update_state_file(self) -> None:
        now = datetime.now(timezone.utc)
        running = []
        for run in self._active_runs.values():
            elapsed_ms = int((now - run.started_at).total_seconds() * 1000)
            running.append({
                "run_id": run.run_id,
                "job_id": run.job_def.id,
                "job_name": run.job_def.name,
                "username": run.username,
                "started_at": run.started_at.isoformat(),
                "elapsed_ms": elapsed_ms,
            })

        state = {
            "running": running,
            "updated_at": now.isoformat(),
        }
        await asyncio.to_thread(_atomic_write, get_state_path(), json.dumps(state, indent=2))

    async def _update_jobs_state_file(self) -> None:
        jobs_info = {}
        for job in self._scheduler.get_jobs():
            # Skip one-shot trigger jobs
            if "::trigger_" in job.id:
                continue
            parts = job.id.split("::", 1)
            if len(parts) != 2:
                continue
            username, job_id = parts
            next_run = job.next_run_time.isoformat() if job.next_run_time else None
            jobs_info[job.id] = {
                "username": username,
                "job_id": job_id,
                "next_run_time": next_run,
                "status": "active",
            }

        state = {
            "jobs": jobs_info,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await asyncio.to_thread(_atomic_write, get_jobs_state_path(), json.dumps(state, indent=2))

    # --- Shutdown ---

    async def _shutdown(self) -> None:
        logger.info("Shutting down scheduler daemon...")
        self._scheduler.shutdown(wait=False)

        timeout = self._settings.scheduler.shutdown_timeout

        if self._active_runs:
            logger.info(
                "Waiting up to {}s for {} running jobs...",
                timeout,
                len(self._active_runs),
            )

            tasks = [r.task for r in self._active_runs.values() if r.task]
            if tasks:
                done, pending = await asyncio.wait(tasks, timeout=timeout)

                # Cancel remaining
                for task in pending:
                    # Find the matching run and signal cancel
                    for run in self._active_runs.values():
                        if run.task == task:
                            run.cancelled.set()
                            break
                    task.cancel()

                # Record cancelled runs
                for run in list(self._active_runs.values()):
                    if run.task in pending:
                        self._run_history.append(JobRunRecord(
                            run_id=run.run_id,
                            job_id=run.job_def.id,
                            job_name=run.job_def.name,
                            username=run.username,
                            started_at=run.started_at,
                            finished_at=datetime.now(timezone.utc),
                            status="cancelled",
                            error_message=f"Cancelled during shutdown (timeout={timeout}s)",
                        ))

                # Wait briefly for cancellation
                if pending:
                    await asyncio.wait(pending, timeout=5)

        await self._update_state_file()
        logger.info("Scheduler daemon shutdown complete")


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


async def main() -> None:
    daemon = SchedulerDaemon()
    await daemon.start()


if __name__ == "__main__":
    asyncio.run(main())
