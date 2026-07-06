"""Skill Hub service — browse, preview, and install bundled skills on demand."""

from __future__ import annotations

import io
import os
import shutil
import tarfile
import zipfile
from pathlib import Path

import yaml
from fastapi import HTTPException

from ..middleware.logging import get_app_logger
from ..models.skill_hub import (
    HubDeliverResponse,
    HubSkillDetailResponse,
    HubSkillListResponse,
    HubSkillSummary,
)
from ..models.skills import FileTreeNode, SkillFileResponse
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

# Source-code seed: shipped in the package, copied into the runtime dir on
# startup. Not read by the API at runtime — see _runtime_skills_dir().
_SOURCE_SKILLS_DIR = Path(__file__).parent.parent / "bundled" / "skills"

# Files/dirs to skip when copying bundled resources
_IGNORE = shutil.ignore_patterns(".DS_Store", "__pycache__", "*.pyc")


def _runtime_skills_dir() -> Path:
    """Live source of truth: $VIVIAN_HOME/vivian/resource/skills/.

    Seeded from _SOURCE_SKILLS_DIR on startup; the catalog, admin lifecycle,
    and on-demand delivery all read/write here.
    """
    return resource_dir("skills")


def seed_bundled_skills() -> None:
    """Seed the runtime skills dir from the source-code seed on startup.

    Per-skill delete-and-rewrite: each skill under _SOURCE_SKILLS_DIR replaces
    its runtime counterpart. Skills present only in the runtime dir (e.g.
    admin-uploaded) are left untouched.
    """
    if not _SOURCE_SKILLS_DIR.is_dir():
        logger.warning("Source skills seed dir not found: {}", _SOURCE_SKILLS_DIR)
        return

    runtime_dir = _runtime_skills_dir()
    runtime_dir.mkdir(parents=True, exist_ok=True)

    seeded = 0
    for skill_dir in sorted(_SOURCE_SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        dest = runtime_dir / skill_dir.name
        try:
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(str(skill_dir), str(dest), ignore=_IGNORE)
            seeded += 1
        except Exception as exc:
            logger.warning("Failed to seed bundled skill '{}': {}", skill_dir.name, exc)

    logger.info("Seeded {} bundled skill(s) into {}", seeded, runtime_dir)


def _get_user_skills_dir(username: str) -> Path:
    settings = get_settings()
    base = os.path.expanduser(settings.server.work_dir)
    return Path(base) / username / ".claude" / "skills"


def _is_installed(name: str, username: str) -> bool:
    dest = _get_user_skills_dir(username) / name
    return dest.is_dir() and not dest.is_symlink()


def list_hub_skills(username: str) -> HubSkillListResponse:
    skills: list[HubSkillSummary] = []
    if not _runtime_skills_dir().is_dir():
        return HubSkillListResponse(skills=skills)

    for entry in sorted(_runtime_skills_dir().iterdir()):
        if not entry.is_dir():
            continue
        skill_md = entry / "SKILL.md"
        if not skill_md.exists():
            continue
        fm = _parse_frontmatter(skill_md)
        meta = fm.get("metadata") or {}
        skills.append(
            HubSkillSummary(
                name=entry.name,
                description=fm.get("description"),
                icon=meta.get("icon"),
                icon_color=meta.get("icon_color"),
                file_count=_count_files(entry),
                installed=_is_installed(entry.name, username),
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
    tree = _build_tree(skill_path)

    return HubSkillDetailResponse(
        name=name,
        description=fm.get("description"),
        icon=meta.get("icon"),
        icon_color=meta.get("icon_color"),
        frontmatter=fm if fm else None,
        tree=tree,
        installed=_is_installed(name, username),
    )


def get_hub_skill_file(name: str, path: str) -> SkillFileResponse:
    _validate_skill_name(name)
    skill_path = _safe_resolve(_runtime_skills_dir(), name)
    if not skill_path.is_dir():
        raise HTTPException(404, f"Bundled skill '{name}' not found")

    file_path = _safe_resolve(skill_path, path)
    if not file_path.is_file():
        raise HTTPException(404, f"File '{path}' not found in bundled skill '{name}'")

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


def deliver_hub_skill(name: str, username: str) -> HubDeliverResponse:
    _validate_skill_name(name)
    source = _safe_resolve(_runtime_skills_dir(), name)
    if not source.is_dir():
        raise HTTPException(404, f"Bundled skill '{name}' not found")

    dest = _get_user_skills_dir(username) / name

    # Remove existing if present (overwrite)
    if dest.exists():
        shutil.rmtree(dest)

    dest.mkdir(parents=True, exist_ok=True)
    shutil.copytree(str(source), str(dest), dirs_exist_ok=True, ignore=_IGNORE)
    logger.info("Delivered bundled skill '{}' to user '{}'", name, username)

    return HubDeliverResponse(
        name=name,
        message=f"Skill '{name}' installed successfully",
    )


def upload_hub_skill(file_data: bytes, filename: str) -> HubDeliverResponse:
    if len(file_data) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, f"File exceeds {MAX_UPLOAD_SIZE // (1024 * 1024)}MB size limit")

    lower_name = filename.lower()
    if lower_name.endswith(".zip") or lower_name.endswith(".skill"):
        members, read_file = _extract_zip(file_data)
    elif lower_name.endswith(".tar.gz") or lower_name.endswith(".tgz"):
        members, read_file = _extract_tar(file_data, "r:gz")
    elif lower_name.endswith(".tar"):
        members, read_file = _extract_tar(file_data, "r:")
    else:
        raise HTTPException(400, "Only .zip, .tar, .tar.gz, and .skill files are accepted")

    # Find top-level directory
    top_dirs = set()
    for m in members:
        parts = m.split("/")
        if parts[0]:
            top_dirs.add(parts[0])
        if ".." in parts:
            raise HTTPException(400, "Archive contains path traversal (..)")

    if len(top_dirs) != 1:
        raise HTTPException(400, "Archive must contain exactly one top-level directory")

    skill_dir_name = top_dirs.pop()
    skill_md_path = f"{skill_dir_name}/SKILL.md"

    if skill_md_path not in members:
        raise HTTPException(400, f"Archive must contain {skill_dir_name}/SKILL.md")

    skill_md_content = read_file(skill_md_path)
    if skill_md_content is None:
        raise HTTPException(400, "Could not read SKILL.md from archive")

    text = skill_md_content.decode("utf-8", errors="replace")
    fm = {}
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError:
                raise HTTPException(422, "SKILL.md has invalid YAML frontmatter")

    _validate_frontmatter(fm)
    skill_name = fm["name"]

    dest = _runtime_skills_dir() / skill_name

    if dest.exists():
        shutil.rmtree(dest)

    dest.mkdir(parents=True, exist_ok=True)

    for member_path in members:
        if not member_path.startswith(skill_dir_name + "/"):
            continue
        relative = member_path[len(skill_dir_name) + 1:]
        if not relative or member_path.endswith("/"):
            if relative:
                (dest / relative).mkdir(parents=True, exist_ok=True)
            continue
        content = read_file(member_path)
        if content is not None:
            file_dest = dest / relative
            file_dest.parent.mkdir(parents=True, exist_ok=True)
            file_dest.write_bytes(content)

    logger.info("Uploaded bundled skill '{}' to hub", skill_name)

    return HubDeliverResponse(
        name=skill_name,
        message=f"Bundled skill '{skill_name}' uploaded successfully",
    )


def delete_hub_skill(name: str) -> None:
    _validate_skill_name(name)
    skill_path = _safe_resolve(_runtime_skills_dir(), name)
    if not skill_path.is_dir():
        raise HTTPException(404, f"Bundled skill '{name}' not found")

    shutil.rmtree(skill_path)
    logger.info("Deleted bundled skill '{}' from hub", name)
