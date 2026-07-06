from __future__ import annotations

import os
import time
from datetime import datetime, timedelta

from fastapi import Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from ..middleware.logging import get_app_logger
from ..models.auth import TokenPayload, UserPublic, UserRecord
from .config import get_settings
from .user_store import get_user_store

logger = get_app_logger(__name__)

security = HTTPBearer(auto_error=False)


def create_jwt(username: str, role: str) -> str:
    settings = get_settings()
    expire = datetime.utcnow() + timedelta(hours=settings.auth.jwt_expire_hours)
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, settings.auth.jwt_secret, algorithm="HS256")


def decode_jwt(token: str) -> TokenPayload:
    settings = get_settings()
    try:
        data = jwt.decode(token, settings.auth.jwt_secret, algorithms=["HS256"])
        return TokenPayload(**data)
    except JWTError as e:
        raise HTTPException(401, "Invalid or expired token") from e


def user_record_to_public(user: UserRecord) -> UserPublic:
    return UserPublic(
        username=user.username,
        role=user.role,
        api_key=user.api_key,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


async def authenticate_raw_token(
    token: str | None,
    x_user_name: str | None = None,
) -> UserRecord | None:
    """Core auth logic: JWT, per-user API key, global API key, anonymous.

    Single source of truth — used by both HTTP (get_current_user) and WebSocket.
    Returns UserRecord on success, None for anonymous, raises HTTPException on failure.
    """
    settings = get_settings()
    store = get_user_store()

    if token:
        # 1. Try JWT
        try:
            payload = decode_jwt(token)
            user = store.get_user(payload.sub)
            if user:
                return user
        except HTTPException:
            pass

        # 2. Try per-user API key
        user = store.find_by_api_key(token)
        if user:
            return user

        # 3. Try global API key
        if settings.auth.global_api_key and token == settings.auth.global_api_key:
            target_username = x_user_name or "admin"
            user = store.get_user(target_username)
            if user:
                return user.model_copy(update={"role": "admin"})
            return UserRecord(
                username=target_username,
                password_hash="",
                role="admin",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )

        raise HTTPException(401, "Invalid credentials")

    # No token provided
    if settings.auth.enable_anonymous:
        return None
    if store.has_users():
        raise HTTPException(401, "Authentication required")
    return None


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    x_user_name: str | None = Header(None, alias="x-user-name"),
) -> UserRecord | None:
    token = credentials.credentials if credentials else None
    user = await authenticate_raw_token(token, x_user_name)
    request.state.user = user
    # Tag auth method: JWT succeeds at step 1, API key at step 2/3
    if token and user:
        try:
            decode_jwt(token)
            request.state.auth_method = "jwt"
        except HTTPException:
            request.state.auth_method = "api_key"
    else:
        request.state.auth_method = "anonymous"
    return user


async def require_user(
    user: UserRecord | None = Depends(get_current_user),
) -> UserRecord:
    if user is None:
        raise HTTPException(401, "Authentication required")
    return user


async def require_admin(
    user: UserRecord = Depends(require_user),
) -> UserRecord:
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")
    return user


def get_user_workspace(user: UserRecord | None) -> str:
    settings = get_settings()
    base = os.path.expanduser(settings.server.work_dir)
    if user is None:
        workspace = os.path.join(base, "anonymous")
    else:
        workspace = os.path.join(base, user.username)
    os.makedirs(workspace, exist_ok=True)
    return workspace


class LoginRateLimiter:
    def __init__(self, max_attempts: int = 5, window_seconds: int = 60):
        self._attempts: dict[str, list[float]] = {}
        self._max = max_attempts
        self._window = window_seconds

    def check(self, username: str) -> None:
        now = time.time()
        attempts = self._attempts.get(username, [])
        # Remove expired entries
        attempts = [t for t in attempts if now - t < self._window]
        self._attempts[username] = attempts
        if len(attempts) >= self._max:
            raise HTTPException(429, "Too many login attempts, try again later")

    def record_failure(self, username: str) -> None:
        now = time.time()
        if username not in self._attempts:
            self._attempts[username] = []
        self._attempts[username].append(now)

    def reset(self, username: str) -> None:
        self._attempts.pop(username, None)


rate_limiter = LoginRateLimiter()
