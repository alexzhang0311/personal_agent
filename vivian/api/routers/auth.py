from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException

from ..models.auth import (
    ApiKeyResponse,
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    SetupRequest,
    SetupStatus,
    UserPublic,
)
from ..models.user_env import UserEnvResponse, UserEnvSettings, UserEnvUpdateRequest
from ..services.auth import (
    create_jwt,
    decode_jwt,
    get_user_workspace,
    rate_limiter,
    require_user,
    user_record_to_public,
)
from ..services.audit_log import AuditEntry, get_audit_logger
from ..services.compute_user_stats import compute_user_stats
from ..services.config import get_settings
from ..services.user_env import has_user_env, mask_token, read_user_env, write_user_env
from ..services.user_store import get_user_store, UserRecord

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/setup", response_model=SetupStatus)
async def check_setup():
    store = get_user_store()
    return SetupStatus(needs_setup=not store.has_users())


@router.post("/setup", response_model=LoginResponse)
async def setup_admin(request: SetupRequest):
    store = get_user_store()
    if store.has_users():
        raise HTTPException(403, "Setup already completed")
    user = store.create_user(request.username, request.password, role="admin")
    token = create_jwt(user.username, user.role)

    # Write env if provided
    if request.env:
        env_dict = request.env.model_dump(exclude_none=True)
        if env_dict:
            write_user_env(request.username, env_dict)

    public = user_record_to_public(user)
    public.workspace = get_user_workspace(user)
    return LoginResponse(access_token=token, user=public)


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    store = get_user_store()
    settings = get_settings()

    rate_limiter.check(request.username)

    if not store.verify_password(request.username, request.password):
        rate_limiter.record_failure(request.username)
        audit = get_audit_logger()
        audit.append(AuditEntry(
            actor=request.username,
            action="login.failed",
            target=request.username,
        ))
        raise HTTPException(401, "Invalid username or password")

    rate_limiter.reset(request.username)
    user = store.get_user(request.username)

    # Determine effective role
    role = user.role
    if user.username in settings.auth.admins and role != "admin":
        role = "admin"

    token = create_jwt(user.username, role)
    public = user_record_to_public(user)
    if role != user.role:
        public.role = role
    public.workspace = get_user_workspace(user)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=user.username,
        action="login.success",
        target=user.username,
    ))

    return LoginResponse(access_token=token, user=public)


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(user: UserRecord = Depends(require_user)):
    settings = get_settings()
    role = user.role
    if user.username in settings.auth.admins and role != "admin":
        role = "admin"
    token = create_jwt(user.username, role)
    public = user_record_to_public(user)
    if role != user.role:
        public.role = role
    public.workspace = get_user_workspace(user)
    return LoginResponse(access_token=token, user=public)


@router.get("/me", response_model=UserPublic)
async def get_me(user: UserRecord = Depends(require_user)):
    settings = get_settings()
    public = user_record_to_public(user)
    if user.username in settings.auth.admins:
        public.role = "admin"
    public.workspace = get_user_workspace(user)

    stats_block = compute_user_stats(user.username)
    public.stats = stats_block.stats
    public.heatmap = stats_block.heatmap
    public.model_usage = stats_block.model_usage
    public.daily_model_tokens = stats_block.daily_model_tokens
    public.favorite_model = stats_block.favorite_model
    public.current_streak = stats_block.current_streak
    public.longest_streak = stats_block.longest_streak
    public.peak_hour = stats_block.peak_hour
    public.tagline = stats_block.tagline

    return public


@router.get("/me/apikey", response_model=ApiKeyResponse)
async def get_my_apikey(user: UserRecord = Depends(require_user)):
    return ApiKeyResponse(has_key=bool(user.api_key), api_key=user.api_key)


@router.post("/me/apikey", response_model=ApiKeyResponse)
async def generate_my_apikey(user: UserRecord = Depends(require_user)):
    store = get_user_store()
    new_key = "sk-" + secrets.token_hex(24)
    store.update_user(user.username, api_key=new_key)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=user.username,
        action="self.apikey_generated",
        target=user.username,
    ))

    return ApiKeyResponse(has_key=True, api_key=new_key)


@router.delete("/me/apikey", response_model=ApiKeyResponse)
async def revoke_my_apikey(user: UserRecord = Depends(require_user)):
    store = get_user_store()
    store.update_user(user.username, api_key=None)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=user.username,
        action="self.apikey_revoked",
        target=user.username,
    ))

    return ApiKeyResponse(has_key=False)


@router.put("/me/password")
async def change_my_password(
    request: ChangePasswordRequest,
    user: UserRecord = Depends(require_user),
):
    store = get_user_store()
    if not store.verify_password(user.username, request.current_password):
        raise HTTPException(401, "Current password is incorrect")
    store.update_user(user.username, password=request.new_password)

    audit = get_audit_logger()
    audit.append(AuditEntry(
        actor=user.username,
        action="self.password_changed",
        target=user.username,
    ))

    return {"status": "ok"}


@router.get("/me/env", response_model=UserEnvResponse)
async def get_my_env(user: UserRecord = Depends(require_user)):
    env = read_user_env(user.username)
    if env is None:
        return UserEnvResponse(has_env=False)

    return UserEnvResponse(
        has_env=has_user_env(user.username),
        env=UserEnvSettings(**env),
    )


@router.put("/me/env", response_model=UserEnvResponse)
async def update_my_env(request: UserEnvUpdateRequest, user: UserRecord = Depends(require_user)):
    env_dict = request.model_dump(exclude_none=True)
    if not env_dict:
        raise HTTPException(400, "No env fields provided")

    write_user_env(user.username, env_dict)

    env = read_user_env(user.username)
    return UserEnvResponse(
        has_env=has_user_env(user.username),
        env=UserEnvSettings(**env) if env else None,
    )


@router.get("/me/env/status")
async def get_my_env_status(user: UserRecord = Depends(require_user)):
    return {"has_env": has_user_env(user.username)}
