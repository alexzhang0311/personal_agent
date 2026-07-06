from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from ..middleware.logging import get_app_logger
from ..models.scheduler import (
    CreateJobRequest,
    JobRunHistoryResponse,
    RunningTaskInfo,
    RunningTasksResponse,
    ScheduledJobDefinition,
    ScheduledJobListResponse,
    ScheduledJobResponse,
    SchedulerHealthResponse,
    UpdateJobRequest,
)
from ..services.auth import require_user
from ..services.config import get_settings
from ..services.scheduler.job_store import get_job_store
from ..services.scheduler.run_history import get_run_history_store
from ..services.scheduler.shared import (
    get_heartbeat_path,
    get_jobs_state_path,
    get_state_path,
    get_user_runs_dir,
    write_command,
)
from ..services.user_store import UserRecord
from ..utils.script_lint import lint_script as run_lint

logger = get_app_logger(__name__)

router = APIRouter(
    prefix="/api/scheduler",
    tags=["scheduler"],
    dependencies=[Depends(require_user)],
)


@router.post("/lint-script")
async def lint_script(
    code: str = Body(..., embed=True),
    language: str = Body(..., embed=True),
):
    """Syntax-check a Python or Shell script and return diagnostics."""
    if language not in ("python", "shell"):
        raise HTTPException(400, f"Unsupported language: {language}")
    diagnostics = await run_lint(code, language)
    return {"diagnostics": diagnostics}


def _read_json_file(path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def _job_to_response(job: ScheduledJobDefinition, username: str, jobs_state: dict) -> ScheduledJobResponse:
    job_key = f"{username}::{job.id}"
    job_info = jobs_state.get("jobs", {}).get(job_key, {})
    return ScheduledJobResponse(
        id=job.id,
        name=job.name,
        prompt=job.prompt,
        trigger=job.trigger,
        timezone=job.timezone,
        status=job.status,
        model=job.model,
        job_config=job.job_config,
        created_at=job.created_at,
        updated_at=job.updated_at,
        next_run_time=job_info.get("next_run_time"),
        username=username,
    )


# --- Job CRUD ---


@router.get("/jobs", response_model=ScheduledJobListResponse)
async def list_jobs(user: UserRecord = Depends(require_user)):
    store = get_job_store()
    jobs = store.list_jobs(user.username)
    jobs_state = _read_json_file(get_jobs_state_path())
    return ScheduledJobListResponse(
        jobs=[_job_to_response(j, user.username, jobs_state) for j in jobs],
        total=len(jobs),
    )


@router.post("/jobs", response_model=ScheduledJobResponse)
async def create_job(
    request: CreateJobRequest,
    user: UserRecord = Depends(require_user),
):
    store = get_job_store()
    jobs = store.list_jobs(user.username)

    job_id = str(uuid4())[:8]
    now = datetime.now(timezone.utc)
    new_job = ScheduledJobDefinition(
        id=job_id,
        name=request.name,
        prompt=request.prompt,
        trigger=request.trigger,
        timezone=request.timezone,
        status=request.status,
        model=request.model,
        job_config=request.job_config,
        created_at=now,
        updated_at=now,
    )

    jobs.append(new_job)
    store.save_jobs(user.username, jobs)
    write_command("reload_user", {"username": user.username})

    jobs_state = _read_json_file(get_jobs_state_path())
    return _job_to_response(new_job, user.username, jobs_state)


@router.get("/jobs/{job_id}", response_model=ScheduledJobResponse)
async def get_job(job_id: str, user: UserRecord = Depends(require_user)):
    store = get_job_store()
    job = store.get_job(user.username, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    jobs_state = _read_json_file(get_jobs_state_path())
    return _job_to_response(job, user.username, jobs_state)


@router.put("/jobs/{job_id}", response_model=ScheduledJobResponse)
async def update_job(
    job_id: str,
    request: UpdateJobRequest,
    user: UserRecord = Depends(require_user),
):
    store = get_job_store()
    jobs = store.list_jobs(user.username)
    job = next((j for j in jobs if j.id == job_id), None)
    if not job:
        raise HTTPException(404, "Job not found")

    if request.name is not None:
        job.name = request.name
    if request.prompt is not None:
        job.prompt = request.prompt
    if request.trigger is not None:
        job.trigger = request.trigger
    if request.timezone is not None:
        job.timezone = request.timezone
    if request.status is not None:
        job.status = request.status
    if request.model is not None:
        job.model = request.model
    if request.job_config is not None:
        job.job_config = request.job_config
    job.updated_at = datetime.now(timezone.utc)

    store.save_jobs(user.username, jobs)
    write_command("reload_user", {"username": user.username})

    jobs_state = _read_json_file(get_jobs_state_path())
    return _job_to_response(job, user.username, jobs_state)


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, user: UserRecord = Depends(require_user)):
    store = get_job_store()
    jobs = store.list_jobs(user.username)
    new_jobs = [j for j in jobs if j.id != job_id]
    if len(new_jobs) == len(jobs):
        raise HTTPException(404, "Job not found")

    store.save_jobs(user.username, new_jobs)
    write_command("reload_user", {"username": user.username})
    return {"status": "ok"}


@router.post("/jobs/{job_id}/pause", response_model=ScheduledJobResponse)
async def pause_job(job_id: str, user: UserRecord = Depends(require_user)):
    store = get_job_store()
    jobs = store.list_jobs(user.username)
    job = next((j for j in jobs if j.id == job_id), None)
    if not job:
        raise HTTPException(404, "Job not found")

    job.status = "paused"
    job.updated_at = datetime.now(timezone.utc)
    store.save_jobs(user.username, jobs)
    write_command("reload_user", {"username": user.username})

    jobs_state = _read_json_file(get_jobs_state_path())
    return _job_to_response(job, user.username, jobs_state)


@router.post("/jobs/{job_id}/resume", response_model=ScheduledJobResponse)
async def resume_job(job_id: str, user: UserRecord = Depends(require_user)):
    store = get_job_store()
    jobs = store.list_jobs(user.username)
    job = next((j for j in jobs if j.id == job_id), None)
    if not job:
        raise HTTPException(404, "Job not found")

    job.status = "active"
    job.updated_at = datetime.now(timezone.utc)
    store.save_jobs(user.username, jobs)
    write_command("reload_user", {"username": user.username})

    jobs_state = _read_json_file(get_jobs_state_path())
    return _job_to_response(job, user.username, jobs_state)


@router.post("/jobs/{job_id}/trigger")
async def trigger_job(job_id: str, user: UserRecord = Depends(require_user)):
    store = get_job_store()
    job = store.get_job(user.username, job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    write_command("trigger_now", {"username": user.username, "job_id": job_id})
    return {"status": "accepted"}


# --- History ---


@router.get("/jobs/{job_id}/history", response_model=JobRunHistoryResponse)
async def get_job_history(
    job_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    before: str | None = Query(default=None),
    after: str | None = Query(default=None),
    user: UserRecord = Depends(require_user),
):
    history = get_run_history_store()
    runs, next_cursor, prev_cursor, total = await asyncio.to_thread(
        history.query_cursor,
        user.username, limit=limit, before=before, after=after, job_id=job_id,
    )
    return JobRunHistoryResponse(
        runs=runs, next_cursor=next_cursor, prev_cursor=prev_cursor,
        total=total, limit=limit,
    )


@router.get("/history", response_model=JobRunHistoryResponse)
async def get_all_history(
    limit: int = Query(default=50, ge=1, le=200),
    before: str | None = Query(default=None),
    after: str | None = Query(default=None),
    status: str | None = Query(default=None),
    user: UserRecord = Depends(require_user),
):
    history = get_run_history_store()
    runs, next_cursor, prev_cursor, total = await asyncio.to_thread(
        history.query_cursor,
        user.username, limit=limit, before=before, after=after, status=status,
    )
    return JobRunHistoryResponse(
        runs=runs, next_cursor=next_cursor, prev_cursor=prev_cursor,
        total=total, limit=limit,
    )


@router.post("/reload")
async def reload_jobs(user: UserRecord = Depends(require_user)):
    write_command("reload_user", {"username": user.username})
    return {"status": "accepted"}


# --- Running tasks ---


@router.get("/running", response_model=RunningTasksResponse)
async def get_running_tasks(user: UserRecord = Depends(require_user)):
    state = _read_json_file(get_state_path())
    running = state.get("running", [])
    user_tasks = [
        RunningTaskInfo(**r) for r in running if r.get("username") == user.username
    ]
    return RunningTasksResponse(running=user_tasks, total=len(user_tasks))


@router.get("/running/{run_id}/output")
async def get_run_output(
    run_id: str,
    offset: int = Query(default=0, ge=0),
    user: UserRecord = Depends(require_user),
):
    # Verify ownership
    history = get_run_history_store()
    record = history.get_run(user.username, run_id)
    if not record:
        raise HTTPException(404, "Run not found")

    run_path = get_user_runs_dir(user.username) / f"{run_id}.jsonl"
    if not run_path.exists():
        return {"events": [], "offset": 0}

    try:
        with open(run_path, "rb") as f:
            f.seek(offset)
            data = f.read()
            new_offset = f.tell()
    except Exception:
        return {"events": [], "offset": offset}

    events = []
    for line in data.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except Exception:
            continue

    return {"events": events, "offset": new_offset}


@router.post("/running/{run_id}/cancel")
async def cancel_run(run_id: str, user: UserRecord = Depends(require_user)):
    # Verify ownership
    history = get_run_history_store()
    record = history.get_run(user.username, run_id)
    if not record:
        raise HTTPException(404, "Run not found")

    write_command("cancel_run", {"run_id": run_id})
    return {"status": "accepted"}


# --- Health ---


@router.get("/health", response_model=SchedulerHealthResponse)
async def get_health(user: UserRecord = Depends(require_user)):
    settings = get_settings()
    heartbeat_path = get_heartbeat_path()

    from ..services.user_store import get_user_store
    store = get_user_store()
    runtime = store.get_runtime_config()
    retention_days = runtime.get("history_retention_days", 7)

    if not heartbeat_path.exists():
        return SchedulerHealthResponse(healthy=False, running_count=0, history_retention_days=retention_days)

    try:
        with open(heartbeat_path, "r") as f:
            ts = f.read().strip()
        last_beat = datetime.fromisoformat(ts)
        age = (datetime.now(timezone.utc) - last_beat).total_seconds()
        healthy = age < settings.scheduler.heartbeat_interval * 3
    except Exception:
        return SchedulerHealthResponse(healthy=False, running_count=0, history_retention_days=retention_days)

    state = _read_json_file(get_state_path())
    running_count = len(state.get("running", []))

    return SchedulerHealthResponse(
        healthy=healthy,
        last_heartbeat=ts,
        running_count=running_count,
        history_retention_days=retention_days,
    )
