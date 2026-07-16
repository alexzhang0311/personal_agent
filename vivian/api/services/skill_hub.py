"""Skill Hub service — public catalog, submissions, review, and delivery."""

from __future__ import annotations

import fcntl
import io
import json
import os
import shutil
import tarfile
import threading
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import yaml
from fastapi import HTTPException

from ..middleware.logging import get_app_logger
from ..models.skill_hub import (
    HubDeliverResponse,
    HubSkillDetailResponse,
    HubSkillListResponse,
    HubSkillSummary,
    HubSubmissionDetailResponse,
    HubSubmissionListResponse,
    HubSubmissionSummary,
)
from ..models.skills import FileTreeNode, SkillFileResponse, SkillPublicationInfo
from .config import get_settings
from .paths import resource_dir
from .skills import (
    MAX_FILE_READ_SIZE,
    MAX_UPLOAD_SIZE,
    _build_tree,
    _count_files,
    _detect_binary,
    _detect_language,
    _extract_tar,
    _extract_zip,
    _parse_frontmatter,
    _safe_resolve,
    _validate_frontmatter,
    _validate_skill_name,
)

logger = get_app_logger(__name__)

_SOURCE_SKILLS_DIR = Path(__file__).parent.parent / "bundled" / "skills"
_IGNORE = shutil.ignore_patterns(".DS_Store", "__pycache__", "*.pyc")
_STATE_MUTEX = threading.RLock()


def _runtime_skills_dir() -> Path:
    return resource_dir("skills")


def _hub_data_dir() -> Path:
    return resource_dir("skill-hub")


def _state_path() -> Path:
    return _hub_data_dir() / "catalog.json"


def _lock_path() -> Path:
    return _hub_data_dir() / ".catalog.lock"


def _submissions_dir() -> Path:
    return _hub_data_dir() / "submissions"


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_state() -> dict:
    return {"version": 1, "skills": {}}


def _load_state_unlocked() -> dict:
    path = _state_path()
    if not path.exists():
        return _empty_state()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Failed to read skill hub catalog: {}", exc)
        raise HTTPException(500, "Skill Hub metadata is unavailable") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("skills"), dict):
        raise HTTPException(500, "Skill Hub metadata is invalid")
    raw.setdefault("version", 1)
    return raw


def _save_state_unlocked(state: dict) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temp.write_text(
            json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


@contextmanager
def _locked_state(*, write: bool = False):
    _hub_data_dir().mkdir(parents=True, exist_ok=True)
    with _STATE_MUTEX:
        with open(_lock_path(), "a+") as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_EX if write else fcntl.LOCK_SH)
            try:
                state = _load_state_unlocked()
                yield state
                if write:
                    _save_state_unlocked(state)
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)


def _system_entry(name: str) -> dict:
    return {
        "owner": "system",
        "published": True,
        "published_at": None,
        "submission": None,
    }


def _entry_for_public_skill(state: dict, name: str) -> dict | None:
    entry = state["skills"].get(name)
    if entry is not None:
        return entry
    if (_runtime_skills_dir() / name).is_dir():
        return _system_entry(name)
    return None


def seed_bundled_skills() -> None:
    """Seed source-bundled skills while preserving user-published resources."""
    if not _SOURCE_SKILLS_DIR.is_dir():
        logger.warning("Source skills seed dir not found: {}", _SOURCE_SKILLS_DIR)
        return

    runtime_dir = _runtime_skills_dir()
    runtime_dir.mkdir(parents=True, exist_ok=True)
    with _locked_state() as state:
        owned_names = {
            name for name, entry in state["skills"].items()
            if entry.get("owner") not in (None, "system")
        }
    seeded_names: list[str] = []
    for skill_dir in sorted(_SOURCE_SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        if skill_dir.name in owned_names:
            logger.warning("Skipping bundled seed for user-owned skill '{}'", skill_dir.name)
            continue
        dest = runtime_dir / skill_dir.name
        try:
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(str(skill_dir), str(dest), ignore=_IGNORE)
            seeded_names.append(skill_dir.name)
        except Exception as exc:
            logger.warning("Failed to seed bundled skill '{}': {}", skill_dir.name, exc)

    with _locked_state(write=True) as state:
        for name in seeded_names:
            existing = state["skills"].get(name)
            if existing and existing.get("owner") not in (None, "system"):
                logger.warning("Bundled skill '{}' conflicts with a user-owned catalog entry", name)
                continue
            state["skills"][name] = _system_entry(name)
    logger.info("Seeded {} bundled skill(s) into {}", len(seeded_names), runtime_dir)


def _get_user_skills_dir(username: str) -> Path:
    settings = get_settings()
    base = os.path.expanduser(settings.server.work_dir)
    return Path(base) / username / ".claude" / "skills"


def _is_installed(name: str, username: str) -> bool:
    dest = _get_user_skills_dir(username) / name
    return dest.is_dir() and not dest.is_symlink()


def get_skill_publication(name: str, username: str) -> SkillPublicationInfo:
    with _locked_state() as state:
        entry = _entry_for_public_skill(state, name)
        if entry is None:
            return SkillPublicationInfo()

        owner = entry.get("owner")
        submission = entry.get("submission") or {}
        submitter = submission.get("submitter")
        if owner == username:
            ownership = "owned"
        elif owner is None:
            ownership = "available"
        else:
            ownership = "other"

        visible_submission = submission if submitter == username else {}
        return SkillPublicationInfo(
            ownership=ownership,
            published=bool(entry.get("published")),
            submission_status=visible_submission.get("status"),
            rejection_reason=visible_submission.get("rejection_reason"),
            submitted_at=visible_submission.get("submitted_at"),
        )


def _publisher_for(name: str) -> str | None:
    with _locked_state() as state:
        entry = _entry_for_public_skill(state, name)
        return entry.get("owner") if entry else None


def list_hub_skills(username: str) -> HubSkillListResponse:
    skills: list[HubSkillSummary] = []
    runtime_dir = _runtime_skills_dir()
    if not runtime_dir.is_dir():
        return HubSkillListResponse(skills=skills)

    with _locked_state() as state:
        for entry_path in sorted(runtime_dir.iterdir()):
            if not entry_path.is_dir():
                continue
            skill_md = entry_path / "SKILL.md"
            if not skill_md.exists():
                continue
            fm = _parse_frontmatter(skill_md)
            meta = fm.get("metadata") or {}
            catalog_entry = _entry_for_public_skill(state, entry_path.name)
            skills.append(
                HubSkillSummary(
                    name=entry_path.name,
                    description=fm.get("description"),
                    icon=meta.get("icon"),
                    icon_color=meta.get("icon_color"),
                    file_count=_count_files(entry_path),
                    installed=_is_installed(entry_path.name, username),
                    publisher=catalog_entry.get("owner") if catalog_entry else None,
                )
            )
    return HubSkillListResponse(skills=skills)


def get_hub_skill_detail(name: str, username: str) -> HubSkillDetailResponse:
    _validate_skill_name(name)
    skill_path = _safe_resolve(_runtime_skills_dir(), name)
    if not skill_path.is_dir():
        raise HTTPException(404, f"Bundled skill '{name}' not found")
    skill_md = skill_path / "SKILL.md"
    fm = _parse_frontmatter(skill_md) if skill_md.exists() else {}
    meta = fm.get("metadata") or {}
    return HubSkillDetailResponse(
        name=name,
        description=fm.get("description"),
        icon=meta.get("icon"),
        icon_color=meta.get("icon_color"),
        frontmatter=fm if fm else None,
        tree=_build_tree(skill_path),
        installed=_is_installed(name, username),
        publisher=_publisher_for(name),
    )


def _read_skill_file(skill_path: Path, path: str, label: str) -> SkillFileResponse:
    file_path = _safe_resolve(skill_path, path)
    if not file_path.is_file():
        raise HTTPException(404, f"File '{path}' not found in {label}")
    size = file_path.stat().st_size
    if size > MAX_FILE_READ_SIZE:
        raise HTTPException(413, f"File exceeds {MAX_FILE_READ_SIZE // (1024 * 1024)}MB size limit")
    raw = file_path.read_bytes()
    is_binary = _detect_binary(raw)
    return SkillFileResponse(
        path=path,
        content="" if is_binary else raw.decode("utf-8", errors="replace"),
        language=_detect_language(path),
        is_binary=is_binary,
    )


def get_hub_skill_file(name: str, path: str) -> SkillFileResponse:
    _validate_skill_name(name)
    skill_path = _safe_resolve(_runtime_skills_dir(), name)
    if not skill_path.is_dir():
        raise HTTPException(404, f"Bundled skill '{name}' not found")
    return _read_skill_file(skill_path, path, f"bundled skill '{name}'")


def deliver_hub_skill(name: str, username: str) -> HubDeliverResponse:
    _validate_skill_name(name)
    source = _safe_resolve(_runtime_skills_dir(), name)
    if not source.is_dir():
        raise HTTPException(404, f"Bundled skill '{name}' not found")
    dest = _get_user_skills_dir(username) / name
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(str(source), str(dest), ignore=_IGNORE)
    logger.info("Delivered bundled skill '{}' to user '{}'", name, username)
    return HubDeliverResponse(name=name, message=f"Skill '{name}' installed successfully")


def _validate_source_skill(source: Path, expected_name: str) -> tuple[dict, int]:
    if not source.is_dir() or source.is_symlink():
        raise HTTPException(404, f"Project skill '{expected_name}' not found")
    skill_md = source / "SKILL.md"
    if not skill_md.is_file() or skill_md.is_symlink():
        raise HTTPException(422, "Skill must contain a regular SKILL.md file")
    try:
        text = skill_md.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise HTTPException(422, "SKILL.md must be valid UTF-8") from exc
    frontmatter: dict = {}
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            try:
                frontmatter = yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError as exc:
                raise HTTPException(422, "SKILL.md has invalid YAML frontmatter") from exc
    _validate_frontmatter(frontmatter)
    if frontmatter["name"] != expected_name:
        raise HTTPException(422, "Skill directory name must match SKILL.md frontmatter name")

    total_size = 0
    file_count = 0
    for path in source.rglob("*"):
        if path.is_symlink():
            raise HTTPException(422, "Skills containing symbolic links cannot be published")
        if path.is_dir():
            continue
        if not path.is_file():
            raise HTTPException(422, "Skills containing special files cannot be published")
        try:
            total_size += path.stat().st_size
        except OSError as exc:
            raise HTTPException(422, "Could not inspect all skill files") from exc
        file_count += 1
        if total_size > MAX_UPLOAD_SIZE:
            raise HTTPException(413, f"Skill exceeds {MAX_UPLOAD_SIZE // (1024 * 1024)}MB size limit")
    return frontmatter, file_count


def _copy_snapshot(source: Path, submission_id: str) -> Path:
    root = _submissions_dir() / submission_id
    content = root / "content"
    if root.exists():
        shutil.rmtree(root)
    content.mkdir(parents=True, exist_ok=False)
    total_size = 0
    try:
        for source_path in sorted(source.rglob("*")):
            relative = source_path.relative_to(source)
            dest = _safe_resolve(content, str(relative))
            if source_path.is_symlink():
                raise HTTPException(422, "Skills containing symbolic links cannot be published")
            if source_path.is_dir():
                dest.mkdir(parents=True, exist_ok=True)
            elif source_path.is_file():
                dest.parent.mkdir(parents=True, exist_ok=True)
                data = source_path.read_bytes()
                total_size += len(data)
                if total_size > MAX_UPLOAD_SIZE:
                    raise HTTPException(413, "Skill exceeds 3MB size limit")
                dest.write_bytes(data)
            else:
                raise HTTPException(422, "Skills containing special files cannot be published")
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise
    return content


def _submission_summary(submission: dict) -> HubSubmissionSummary:
    return HubSubmissionSummary(
        id=submission["id"],
        name=submission["name"],
        submitter=submission["submitter"],
        submitted_at=submission["submitted_at"],
        is_update=bool(submission.get("is_update")),
        description=submission.get("description"),
        file_count=int(submission.get("file_count") or 0),
    )


def submit_project_skill(name: str, username: str) -> HubSubmissionSummary:
    _validate_skill_name(name)
    source = _safe_resolve(_get_user_skills_dir(username), name)
    frontmatter, file_count = _validate_source_skill(source, name)

    with _locked_state(write=True) as state:
        entry = _entry_for_public_skill(state, name)
        if entry and (entry.get("submission") or {}).get("status") == "pending":
            raise HTTPException(409, f"Skill '{name}' already has a pending submission")
        if entry and entry.get("owner") not in (None, username):
            raise HTTPException(409, f"Skill name '{name}' is owned by another publisher")

        submission_id = uuid4().hex
        _copy_snapshot(source, submission_id)
        is_update = bool(entry and entry.get("published"))
        submission = {
            "id": submission_id,
            "name": name,
            "submitter": username,
            "submitted_at": _utcnow(),
            "status": "pending",
            "is_update": is_update,
            "description": frontmatter.get("description"),
            "file_count": file_count,
            "rejection_reason": None,
        }
        if entry is None:
            entry = {"owner": username, "published": False, "published_at": None}
        else:
            entry = dict(entry)
            entry["owner"] = username
        entry["submission"] = submission
        state["skills"][name] = entry
        logger.info("User '{}' submitted skill '{}' for review", username, name)
        return _submission_summary(submission)


def list_pending_submissions() -> HubSubmissionListResponse:
    pending: list[HubSubmissionSummary] = []
    with _locked_state() as state:
        for entry in state["skills"].values():
            submission = entry.get("submission") or {}
            if submission.get("status") == "pending":
                pending.append(_submission_summary(submission))
    pending.sort(key=lambda item: item.submitted_at)
    return HubSubmissionListResponse(submissions=pending)


def _find_submission(state: dict, submission_id: str) -> tuple[str, dict, dict]:
    for name, entry in state["skills"].items():
        submission = entry.get("submission") or {}
        if submission.get("id") == submission_id:
            return name, entry, submission
    raise HTTPException(404, "Skill submission not found")


def _submission_content(submission_id: str) -> Path:
    content = _safe_resolve(_submissions_dir(), f"{submission_id}/content")
    if not content.is_dir():
        raise HTTPException(404, "Skill submission snapshot not found")
    return content


def get_submission_detail(submission_id: str) -> HubSubmissionDetailResponse:
    with _locked_state() as state:
        _, _, submission = _find_submission(state, submission_id)
        if submission.get("status") != "pending":
            raise HTTPException(404, "Pending skill submission not found")
        summary = _submission_summary(submission)
    content = _submission_content(submission_id)
    fm = _parse_frontmatter(content / "SKILL.md")
    return HubSubmissionDetailResponse(
        **summary.model_dump(),
        frontmatter=fm if fm else None,
        tree=_build_tree(content),
    )


def get_submission_file(submission_id: str, path: str) -> SkillFileResponse:
    with _locked_state() as state:
        _, _, submission = _find_submission(state, submission_id)
        if submission.get("status") != "pending":
            raise HTTPException(404, "Pending skill submission not found")
    return _read_skill_file(_submission_content(submission_id), path, "skill submission")


def _publish_snapshot(name: str, content: Path) -> None:
    runtime = _runtime_skills_dir()
    runtime.mkdir(parents=True, exist_ok=True)
    dest = _safe_resolve(runtime, name)
    staged = runtime / f".{name}.{uuid4().hex}.staged"
    backup = runtime / f".{name}.{uuid4().hex}.backup"
    shutil.copytree(content, staged, ignore=_IGNORE)
    try:
        if dest.exists():
            os.replace(dest, backup)
        os.replace(staged, dest)
        shutil.rmtree(backup, ignore_errors=True)
    except Exception:
        if not dest.exists() and backup.exists():
            os.replace(backup, dest)
        shutil.rmtree(staged, ignore_errors=True)
        raise


def approve_submission(submission_id: str, reviewer: str) -> HubSubmissionSummary:
    with _locked_state(write=True) as state:
        name, entry, submission = _find_submission(state, submission_id)
        if submission.get("status") != "pending":
            raise HTTPException(409, "Skill submission is no longer pending")
        content = _submission_content(submission_id)
        _publish_snapshot(name, content)
        result = _submission_summary(submission)
        entry["owner"] = submission["submitter"]
        entry["published"] = True
        entry["published_at"] = _utcnow()
        entry["submission"] = None
        state["skills"][name] = entry
    shutil.rmtree(_submissions_dir() / submission_id, ignore_errors=True)
    logger.info("Admin '{}' approved skill submission '{}'", reviewer, submission_id)
    return result


def reject_submission(submission_id: str, reviewer: str, reason: str) -> HubSubmissionSummary:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise HTTPException(422, "Rejection reason is required")
    with _locked_state(write=True) as state:
        name, entry, submission = _find_submission(state, submission_id)
        if submission.get("status") != "pending":
            raise HTTPException(409, "Skill submission is no longer pending")
        submission["status"] = "rejected"
        submission["rejection_reason"] = normalized_reason
        submission["reviewed_at"] = _utcnow()
        submission["reviewer"] = reviewer
        if not entry.get("published"):
            entry["owner"] = None
        entry["submission"] = submission
        state["skills"][name] = entry
        result = _submission_summary(submission)
    shutil.rmtree(_submissions_dir() / submission_id, ignore_errors=True)
    logger.info("Admin '{}' rejected skill submission '{}'", reviewer, submission_id)
    return result


def upload_hub_skill(file_data: bytes, filename: str, actor: str = "system") -> HubDeliverResponse:
    """Legacy admin upload for system-owned/bundled catalog entries."""
    if len(file_data) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, f"File exceeds {MAX_UPLOAD_SIZE // (1024 * 1024)}MB size limit")
    lower_name = filename.lower()
    if lower_name.endswith((".zip", ".skill")):
        members, read_file = _extract_zip(file_data)
    elif lower_name.endswith((".tar.gz", ".tgz")):
        members, read_file = _extract_tar(file_data, "r:gz")
    elif lower_name.endswith(".tar"):
        members, read_file = _extract_tar(file_data, "r:")
    else:
        raise HTTPException(400, "Only .zip, .tar, .tar.gz, and .skill files are accepted")

    top_dirs: set[str] = set()
    for member in members:
        parts = member.split("/")
        if parts[0]:
            top_dirs.add(parts[0])
        if ".." in parts or member.startswith("/"):
            raise HTTPException(400, "Archive contains an unsafe path")
    if len(top_dirs) != 1:
        raise HTTPException(400, "Archive must contain exactly one top-level directory")
    source_dir = top_dirs.pop()
    skill_md_path = f"{source_dir}/SKILL.md"
    skill_md_content = read_file(skill_md_path)
    if skill_md_path not in members or skill_md_content is None:
        raise HTTPException(400, f"Archive must contain {source_dir}/SKILL.md")
    try:
        text = skill_md_content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(422, "SKILL.md must be valid UTF-8") from exc
    frontmatter = {}
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            try:
                frontmatter = yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError as exc:
                raise HTTPException(422, "SKILL.md has invalid YAML frontmatter") from exc
    _validate_frontmatter(frontmatter)
    name = frontmatter["name"]

    with _locked_state(write=True) as state:
        existing = _entry_for_public_skill(state, name)
        if existing and existing.get("owner") not in (None, "system"):
            raise HTTPException(409, f"Skill '{name}' is owned by a user publisher")
        dest = _runtime_skills_dir() / name
        staged = _runtime_skills_dir() / f".{name}.{uuid4().hex}.upload"
        staged.mkdir(parents=True, exist_ok=False)
        try:
            for member_path in members:
                prefix = source_dir + "/"
                if not member_path.startswith(prefix):
                    continue
                relative = member_path[len(prefix):]
                if not relative:
                    continue
                file_dest = _safe_resolve(staged, relative)
                if member_path.endswith("/"):
                    file_dest.mkdir(parents=True, exist_ok=True)
                    continue
                content = read_file(member_path)
                if content is not None:
                    file_dest.parent.mkdir(parents=True, exist_ok=True)
                    file_dest.write_bytes(content)
            _validate_source_skill(staged, name)
            _publish_snapshot(name, staged)
        finally:
            shutil.rmtree(staged, ignore_errors=True)
        state["skills"][name] = _system_entry(name)
    logger.info("Admin '{}' uploaded bundled skill '{}' to hub", actor, name)
    return HubDeliverResponse(name=name, message=f"Bundled skill '{name}' uploaded successfully")


def delete_hub_skill(name: str) -> None:
    _validate_skill_name(name)
    skill_path = _safe_resolve(_runtime_skills_dir(), name)
    if not skill_path.is_dir():
        raise HTTPException(404, f"Bundled skill '{name}' not found")
    with _locked_state(write=True) as state:
        entry = state["skills"].pop(name, None)
        submission = (entry or {}).get("submission") or {}
        submission_id = submission.get("id")
        if submission_id:
            shutil.rmtree(_submissions_dir() / submission_id, ignore_errors=True)
        shutil.rmtree(skill_path)
    logger.info("Deleted bundled skill '{}' from hub", name)
