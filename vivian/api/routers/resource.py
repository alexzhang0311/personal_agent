from __future__ import annotations

from pathlib import Path

import httpx
import yaml
from fastapi import APIRouter, Depends, HTTPException

from ..middleware.logging import get_app_logger
from ..models.resource import (
    ModelInfo,
    ModelListResponse,
    QuickAction,
    QuickActionListResponse,
    QuickActionUpdateRequest,
    VisionModelResponse,
    VisionModelUpdateRequest,
)
from ..services.auth import get_user_workspace, require_user
from ..services.config import get_settings
from ..services.user_env import read_user_env
from ..services.user_store import UserRecord

logger = get_app_logger(__name__)

router = APIRouter(prefix="/api/resource", tags=["resource"])


@router.get("/models", response_model=ModelListResponse)
async def list_models(user: UserRecord = Depends(require_user)):
    env = read_user_env(user.username)
    if env is None:
        raise HTTPException(400, "API credentials not configured")

    base_url = env.get("ANTHROPIC_BASE_URL", "").rstrip("/")
    auth_token = env.get("ANTHROPIC_AUTH_TOKEN", "")

    if not base_url or not auth_token:
        raise HTTPException(400, "API credentials not configured. Please set base URL and auth token.")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{base_url}/v1/models",
                headers={"Authorization": f"Bearer {auth_token}"},
            )
    except httpx.ConnectError as e:
        raise HTTPException(502, f"Cannot connect to API: {e}") from e
    except httpx.TimeoutException as e:
        raise HTTPException(504, f"API request timed out: {e}") from e
    except httpx.HTTPError as e:
        raise HTTPException(502, f"API request failed: {e}") from e

    if resp.status_code == 401:
        raise HTTPException(400, "Invalid auth token — upstream returned 401")
    if resp.status_code != 200:
        raise HTTPException(502, f"Upstream API returned {resp.status_code}: {resp.text[:200]}")

    try:
        data = resp.json()
    except Exception:
        raise HTTPException(502, "Invalid JSON response from upstream API")

    # Handle both OpenAI-style {"data": [...]} and flat list responses
    model_list = data.get("data") if isinstance(data, dict) else data
    if not isinstance(model_list, list):
        model_list = []

    models = []
    for m in model_list:
        if isinstance(m, dict) and "id" in m:
            models.append(ModelInfo(id=m["id"]))
        elif isinstance(m, str):
            models.append(ModelInfo(id=m))

    return ModelListResponse(models=models)


def _get_user_config_path(username: str) -> Path:
    settings = get_settings()
    work_dir = Path(settings.server.work_dir).expanduser()
    return work_dir / username / ".vivian.user.yml"


def _read_quickactions(username: str) -> list[dict]:
    path = _get_user_config_path(username)
    if not path.exists():
        return []
    try:
        with open(path, "r") as f:
            data = yaml.safe_load(f) or {}
        qa = data.get("quickactions", [])
        return qa if isinstance(qa, list) else []
    except Exception:
        return []


def _write_quickactions(username: str, quickactions: list[dict]) -> None:
    path = _get_user_config_path(username)
    path.parent.mkdir(parents=True, exist_ok=True)

    # Preserve other keys in the file
    existing = {}
    if path.exists():
        try:
            with open(path, "r") as f:
                existing = yaml.safe_load(f) or {}
        except Exception:
            existing = {}

    existing["quickactions"] = quickactions
    with open(path, "w") as f:
        yaml.dump(existing, f, default_flow_style=False, allow_unicode=True)


@router.get("/quickactions", response_model=QuickActionListResponse)
async def list_quickactions(user: UserRecord = Depends(require_user)):
    raw = _read_quickactions(user.username)
    actions = []
    for item in raw:
        if isinstance(item, dict) and "name" in item and "prompt" in item:
            actions.append(QuickAction(
                name=item["name"],
                prompt=item["prompt"],
                icon=item.get("icon"),
            ))
    return QuickActionListResponse(quickactions=actions)


@router.put("/quickactions", response_model=QuickActionListResponse)
async def update_quickactions(
    request: QuickActionUpdateRequest,
    user: UserRecord = Depends(require_user),
):
    qa_dicts = [qa.model_dump() for qa in request.quickactions]
    _write_quickactions(user.username, qa_dicts)
    return QuickActionListResponse(quickactions=request.quickactions)


# ── Vision model config ──────────────────────────────────────────────


def _read_vision_model(username: str) -> str | None:
    path = _get_user_config_path(username)
    if not path.exists():
        return None
    try:
        with open(path, "r") as f:
            data = yaml.safe_load(f) or {}
        vm = data.get("vision_model")
        return vm if isinstance(vm, str) and vm else None
    except Exception:
        return None


def _write_vision_model(username: str, vision_model: str | None) -> None:
    path = _get_user_config_path(username)
    path.parent.mkdir(parents=True, exist_ok=True)

    existing: dict = {}
    if path.exists():
        try:
            with open(path, "r") as f:
                existing = yaml.safe_load(f) or {}
        except Exception:
            existing = {}

    if vision_model:
        existing["vision_model"] = vision_model
    else:
        existing.pop("vision_model", None)

    with open(path, "w") as f:
        yaml.dump(existing, f, default_flow_style=False, allow_unicode=True)


@router.get("/vision-model", response_model=VisionModelResponse)
async def get_vision_model(user: UserRecord = Depends(require_user)):
    return VisionModelResponse(vision_model=_read_vision_model(user.username))


@router.put("/vision-model", response_model=VisionModelResponse)
async def update_vision_model(
    request: VisionModelUpdateRequest,
    user: UserRecord = Depends(require_user),
):
    _write_vision_model(user.username, request.vision_model)
    return VisionModelResponse(vision_model=request.vision_model)
