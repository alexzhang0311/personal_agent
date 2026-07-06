from __future__ import annotations

import io
import tarfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from ..middleware.logging import get_app_logger
from ..models.auth import UserRecord
from ..models.skills import (
    SkillDetailResponse,
    SkillFileResponse,
    SkillLevel,
    SkillListResponse,
    SkillUploadResponse,
    SkillsConfigRequest,
    SkillsConfigResponse,
)
from ..services.audit_log import AuditEntry, get_audit_logger
from ..services.auth import require_admin, require_user
from ..services.channels.config_store import get_channel_config_store
from ..services.skills import (
    _get_skills_dir,
    _safe_resolve,
    delete_skill,
    get_file_content,
    get_skill_detail,
    list_skills,
    upload_skill,
)

logger = get_app_logger(__name__)

router = APIRouter(prefix="/api/resource/skills", tags=["skills"])


@router.get("/", response_model=SkillListResponse)
async def list_all_skills(user: UserRecord = Depends(require_user)):
    return list_skills(user.username)


@router.get("/config", response_model=SkillsConfigResponse)
async def get_skills_config(user: UserRecord = Depends(require_user)):
    store = get_channel_config_store()
    value = store.get_skill_exclude(user.username)
    return SkillsConfigResponse(skill_exclude=list(value))


@router.put("/config", response_model=SkillsConfigResponse)
async def update_skills_config(
    request: SkillsConfigRequest,
    user: UserRecord = Depends(require_user),
):
    store = get_channel_config_store()
    store.save_skill_exclude(user.username, list(request.skill_exclude or []))

    audit = get_audit_logger()
    audit.append(
        AuditEntry(
            actor=user.username,
            action="skills.config_updated",
            target="skill_exclude",
            details={"count": len(request.skill_exclude or [])},
        )
    )

    return SkillsConfigResponse(skill_exclude=list(request.skill_exclude or []))


@router.get("/{level}/{name}", response_model=SkillDetailResponse)
async def get_skill(
    level: SkillLevel,
    name: str,
    user: UserRecord = Depends(require_user),
):
    return get_skill_detail(level, name, user.username)


@router.get("/{level}/{name}/file", response_model=SkillFileResponse)
async def get_skill_file(
    level: SkillLevel,
    name: str,
    path: str,
    user: UserRecord = Depends(require_user),
):
    return get_file_content(level, name, path, user.username)


@router.get("/{level}/{name}/download")
async def download_skill_endpoint(
    level: SkillLevel,
    name: str,
    user: UserRecord = Depends(require_user),
):
    skills_dir = _get_skills_dir(level, user.username)
    _safe_resolve(skills_dir, name)
    skill_dir = skills_dir / name
    if not skill_dir.is_dir():
        raise HTTPException(404, "Skill not found")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(
            str(skill_dir),
            arcname=name,
            filter=lambda ti: (
                None
                if ti.name.endswith((".pyc", ".DS_Store"))
                or "__pycache__" in ti.name
                else ti
            ),
        )
    buf.seek(0)

    audit = get_audit_logger()
    audit.append(
        AuditEntry(
            actor=user.username,
            action="skill.downloaded",
            target=name,
            details={"level": level},
        )
    )

    def iterfile():
        while chunk := buf.read(8192):
            yield chunk

    return StreamingResponse(
        iterfile(),
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{name}.tar.gz"'},
    )


@router.post("/upload", response_model=SkillUploadResponse)
async def upload_skill_endpoint(
    file: UploadFile = File(...),
    level: SkillLevel = Form("project"),
    user: UserRecord = Depends(require_user),
):
    # Global skills require admin
    if level == "global":
        if user.role != "admin":
            raise HTTPException(403, "Admin access required for global skills")

    file_data = await file.read()
    skill_name, skill_level = upload_skill(level, file_data, file.filename or "upload.zip", user.username)

    audit = get_audit_logger()
    audit.append(
        AuditEntry(
            actor=user.username,
            action="skill.uploaded",
            target=skill_name,
            details={"level": skill_level},
        )
    )

    return SkillUploadResponse(
        name=skill_name,
        level=skill_level,
        message=f"Skill '{skill_name}' uploaded successfully",
    )


@router.delete("/{level}/{name}")
async def delete_skill_endpoint(
    level: SkillLevel,
    name: str,
    user: UserRecord = Depends(require_user),
):
    # Global skills require admin
    if level == "global":
        if user.role != "admin":
            raise HTTPException(403, "Admin access required for global skills")

    delete_skill(level, name, user.username)

    audit = get_audit_logger()
    audit.append(
        AuditEntry(
            actor=user.username,
            action="skill.deleted",
            target=name,
            details={"level": level},
        )
    )

    return {"message": f"Skill '{name}' deleted successfully"}
