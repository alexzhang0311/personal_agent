from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..middleware.logging import get_app_logger
from ..models.auth import UserRecord
from ..models.skill_hub import (
    HubDeliverResponse,
    HubSkillDetailResponse,
    HubSkillListResponse,
)
from ..models.skills import SkillFileResponse
from ..services.audit_log import AuditEntry, get_audit_logger
from ..services.auth import require_admin, require_user
from ..services.skill_hub import (
    delete_hub_skill,
    deliver_hub_skill,
    get_hub_skill_detail,
    get_hub_skill_file,
    list_hub_skills,
    upload_hub_skill,
)

logger = get_app_logger(__name__)

router = APIRouter(prefix="/api/resource/skill-hub", tags=["skill-hub"])


# --- Admin-only: upload must be registered before /{name} to avoid conflict ---

@router.post("/upload", response_model=HubDeliverResponse)
async def upload_hub_skill_endpoint(
    file: UploadFile = File(...),
    user: UserRecord = Depends(require_admin),
):
    file_data = await file.read()
    result = upload_hub_skill(file_data, file.filename or "upload.zip")

    audit = get_audit_logger()
    audit.append(
        AuditEntry(
            actor=user.username,
            action="skill_hub.uploaded",
            target=result.name,
        )
    )

    return result


# --- User endpoints ---

@router.get("/", response_model=HubSkillListResponse)
async def list_hub_skills_endpoint(
    user: UserRecord = Depends(require_user),
):
    return list_hub_skills(user.username)


@router.get("/{name}", response_model=HubSkillDetailResponse)
async def get_hub_skill_detail_endpoint(
    name: str,
    user: UserRecord = Depends(require_user),
):
    return get_hub_skill_detail(name, user.username)


@router.get("/{name}/file", response_model=SkillFileResponse)
async def get_hub_skill_file_endpoint(
    name: str,
    path: str,
    user: UserRecord = Depends(require_user),
):
    return get_hub_skill_file(name, path)


@router.post("/{name}/deliver", response_model=HubDeliverResponse)
async def deliver_hub_skill_endpoint(
    name: str,
    user: UserRecord = Depends(require_user),
):
    result = deliver_hub_skill(name, user.username)

    audit = get_audit_logger()
    audit.append(
        AuditEntry(
            actor=user.username,
            action="skill_hub.delivered",
            target=name,
        )
    )

    return result


@router.delete("/{name}")
async def delete_hub_skill_endpoint(
    name: str,
    user: UserRecord = Depends(require_admin),
):
    delete_hub_skill(name)

    audit = get_audit_logger()
    audit.append(
        AuditEntry(
            actor=user.username,
            action="skill_hub.deleted",
            target=name,
        )
    )

    return {"message": f"Bundled skill '{name}' deleted successfully"}
