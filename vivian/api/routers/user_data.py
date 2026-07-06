"""User self-service endpoints: stats and audit log."""

from __future__ import annotations

import asyncio
from pathlib import Path

from claude_agent_sdk import list_sessions
from fastapi import APIRouter, Depends, Query

from ..models.admin import AuditEntryResponse, AuditLogResponse
from ..services.audit_log import get_audit_logger
from ..services.auth import require_user
from ..services.config import get_settings
from ..services.temp_files import list_temp_files
from ..services.user_store import UserRecord

router = APIRouter(prefix="/api/user", tags=["user"])


@router.get("/stats")
async def get_user_stats(
    user: UserRecord = Depends(require_user),
):
    settings = get_settings()
    work_dir = Path(settings.server.work_dir).expanduser()
    user_workspace = work_dir / user.username

    session_count = 0
    storage_bytes = 0
    last_active = None

    if user_workspace.exists():
        try:
            sessions = list_sessions(directory=str(user_workspace))
            session_count = len(sessions)
            for s in sessions:
                storage_bytes += s.file_size or 0
                if s.last_modified:
                    if last_active is None or s.last_modified > last_active:
                        last_active = s.last_modified
        except Exception:
            pass

    # File stats
    files = list_temp_files(user.username)
    file_count = len(files)
    total_file_size = sum(f.get("size", 0) for f in files)

    return {
        "username": user.username,
        "session_count": session_count,
        "storage_bytes": storage_bytes,
        "file_count": file_count,
        "total_file_size": total_file_size,
        "last_active": last_active,
    }


@router.get("/audit", response_model=AuditLogResponse)
async def get_user_audit(
    user: UserRecord = Depends(require_user),
    limit: int = Query(default=50, ge=1, le=200),
    before: str | None = Query(default=None),
    after: str | None = Query(default=None),
    action: str | None = Query(default=None),
    target: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
):
    from datetime import datetime as _dt

    start_time = _dt.fromisoformat(start) if start else None
    end_time = _dt.fromisoformat(end) if end else None

    audit = get_audit_logger()
    entries, next_cursor, prev_cursor, total = await asyncio.to_thread(
        audit.query_cursor,
        limit=limit,
        before=before,
        after=after,
        action_filter=action,
        actor_filter=user.username,
        target_filter=target,
        start_time=start_time,
        end_time=end_time,
        session_id_filter=session_id,
    )
    return AuditLogResponse(
        entries=[
            AuditEntryResponse(
                id=e.id,
                timestamp=e.timestamp,
                actor=e.actor,
                action=e.action,
                target=e.target,
                details=e.details,
            )
            for e in entries
        ],
        next_cursor=next_cursor,
        prev_cursor=prev_cursor,
        total=total,
        limit=limit,
    )


@router.get("/analytics")
async def get_user_analytics(
    user: UserRecord = Depends(require_user),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
):
    from collections import Counter
    from datetime import datetime as _dt

    start_time = _dt.fromisoformat(start) if start else None
    end_time = _dt.fromisoformat(end) if end else None

    audit = get_audit_logger()

    # Timeline: all user audit entries (up to 500)
    timeline_entries, _, _, _ = await asyncio.to_thread(
        audit.query_cursor,
        limit=500,
        actor_filter=user.username,
        start_time=start_time,
        end_time=end_time,
    )
    timeline = [
        AuditEntryResponse(
            id=e.id,
            timestamp=e.timestamp,
            actor=e.actor,
            action=e.action,
            target=e.target,
            details=e.details,
        ).model_dump(mode="json")
        for e in timeline_entries
    ]

    # Skill usage: aggregate skill.invoked by target (skill name)
    skill_entries, _, _, _ = await asyncio.to_thread(
        audit.query_cursor,
        limit=500,
        action_filter="skill.invoked",
        actor_filter=user.username,
        start_time=start_time,
        end_time=end_time,
    )
    skill_counter: Counter[str] = Counter()
    for e in skill_entries:
        skill_name = e.target or "unknown"
        skill_counter[skill_name] += 1
    skill_usage = [
        {"skill": name, "count": count}
        for name, count in skill_counter.most_common(10)
    ]

    # Session activity: sessions per day
    settings = get_settings()
    work_dir = Path(settings.server.work_dir).expanduser()
    user_workspace = work_dir / user.username
    session_day_counter: Counter[str] = Counter()
    if user_workspace.exists():
        try:
            sessions = list_sessions(directory=str(user_workspace))
            for s in sessions:
                if s.last_modified:
                    day = s.last_modified.strftime("%Y-%m-%d")
                    if start_time and s.last_modified < start_time:
                        continue
                    if end_time and s.last_modified > end_time:
                        continue
                    session_day_counter[day] += 1
        except Exception:
            pass
    session_activity = [
        {"date": day, "count": count}
        for day, count in sorted(session_day_counter.items())
    ]

    return {
        "timeline": timeline,
        "skill_usage": skill_usage,
        "session_activity": session_activity,
    }
