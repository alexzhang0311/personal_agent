from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile

from ..models.auth import UserRecord
from ..models.skill_hub import (
    HubDeliverResponse,
    HubSkillDetailResponse,
    HubSkillListResponse,
    HubSubmissionCreateRequest,
    HubSubmissionDetailResponse,
    HubSubmissionListResponse,
    HubSubmissionRejectRequest,
    HubSubmissionSummary,
)
from ..models.skills import SkillFileResponse
from ..services.audit_log import AuditEntry, get_audit_logger
from ..services.auth import require_admin, require_user
from ..services.skill_hub import (
    approve_submission,
    delete_hub_skill,
    deliver_hub_skill,
    get_hub_skill_detail,
    get_hub_skill_file,
    get_submission_detail,
    get_submission_file,
    list_hub_skills,
    list_pending_submissions,
    reject_submission,
    submit_project_skill,
    upload_hub_skill,
)

router = APIRouter(prefix="/api/resource/skill-hub", tags=["skill-hub"])


# Fixed routes must be registered before /{name}.
@router.post("/upload", response_model=HubDeliverResponse)
async def upload_hub_skill_endpoint(
    file: UploadFile = File(...),
    user: UserRecord = Depends(require_admin),
):
    result = upload_hub_skill(
        await file.read(), file.filename or "upload.zip", user.username
    )
    get_audit_logger().append(
        AuditEntry(actor=user.username, action="skill_hub.uploaded", target=result.name)
    )
    return result


@router.post("/submissions", response_model=HubSubmissionSummary)
async def submit_hub_skill_endpoint(
    request: HubSubmissionCreateRequest,
    user: UserRecord = Depends(require_user),
):
    result = submit_project_skill(request.skill_name, user.username)
    get_audit_logger().append(
        AuditEntry(
            actor=user.username,
            action="skill_hub.submitted",
            target=result.name,
            details={"submission_id": result.id, "is_update": result.is_update},
        )
    )
    return result


@router.get("/submissions/pending", response_model=HubSubmissionListResponse)
async def list_pending_submissions_endpoint(
    user: UserRecord = Depends(require_admin),
):
    return list_pending_submissions()


@router.get("/submissions/{submission_id}", response_model=HubSubmissionDetailResponse)
async def get_submission_detail_endpoint(
    submission_id: str,
    user: UserRecord = Depends(require_admin),
):
    return get_submission_detail(submission_id)


@router.get("/submissions/{submission_id}/file", response_model=SkillFileResponse)
async def get_submission_file_endpoint(
    submission_id: str,
    path: str,
    user: UserRecord = Depends(require_admin),
):
    return get_submission_file(submission_id, path)


@router.post("/submissions/{submission_id}/approve", response_model=HubSubmissionSummary)
async def approve_submission_endpoint(
    submission_id: str,
    user: UserRecord = Depends(require_admin),
):
    result = approve_submission(submission_id, user.username)
    get_audit_logger().append(
        AuditEntry(
            actor=user.username,
            action="skill_hub.approved",
            target=result.name,
            details={"submission_id": result.id, "submitter": result.submitter},
        )
    )
    return result


@router.post("/submissions/{submission_id}/reject", response_model=HubSubmissionSummary)
async def reject_submission_endpoint(
    submission_id: str,
    request: HubSubmissionRejectRequest,
    user: UserRecord = Depends(require_admin),
):
    result = reject_submission(submission_id, user.username, request.reason)
    get_audit_logger().append(
        AuditEntry(
            actor=user.username,
            action="skill_hub.rejected",
            target=result.name,
            details={
                "submission_id": result.id,
                "submitter": result.submitter,
                "reason": request.reason.strip(),
            },
        )
    )
    return result


@router.get("/", response_model=HubSkillListResponse)
async def list_hub_skills_endpoint(user: UserRecord = Depends(require_user)):
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
    get_audit_logger().append(
        AuditEntry(actor=user.username, action="skill_hub.delivered", target=name)
    )
    return result


@router.delete("/{name}")
async def delete_hub_skill_endpoint(
    name: str,
    user: UserRecord = Depends(require_admin),
):
    delete_hub_skill(name)
    get_audit_logger().append(
        AuditEntry(actor=user.username, action="skill_hub.deleted", target=name)
    )
    return {"message": f"Bundled skill '{name}' deleted successfully"}
