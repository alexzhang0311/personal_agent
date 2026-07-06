from __future__ import annotations

import io
import os
import re
import shutil
import tarfile
import zipfile
from pathlib import Path

import yaml
from fastapi import HTTPException

from ..middleware.logging import get_app_logger
from ..models.skills import (
    FileTreeNode,
    SkillDetailResponse,
    SkillFileResponse,
    SkillLevel,
    SkillListResponse,
    SkillSummary,
)
from .config import get_settings

logger = get_app_logger(__name__)

SKILL_NAME_RE = re.compile(r"^[a-z0-9-]+$")
RESERVED_WORDS = {"anthropic", "claude", "system", "admin", "root"}
MAX_UPLOAD_SIZE = 3 * 1024 * 1024  # 3MB
MAX_FILE_READ_SIZE = 1 * 1024 * 1024  # 1MB
MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024
XML_TAG_RE = re.compile(r"<[^>]+>")

EXTENSION_LANGUAGE_MAP = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".css": "css",
    ".html": "html",
    ".xml": "xml",
    ".sql": "sql",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".toml": "toml",
    ".ini": "ini",
    ".conf": "ini",
    ".txt": "plaintext",
    ".env": "bash",
    ".dockerfile": "dockerfile",
    ".r": "r",
    ".lua": "lua",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
}


def _get_skills_dir(level: SkillLevel, username: str | None = None) -> Path:
    if level == "global":
        # Maps to SDK setting_sources=["user"] → ~/.claude/skills/
        return Path.home() / ".claude" / "skills"
    settings = get_settings()
    base = os.path.expanduser(settings.server.work_dir)
    if username is None:
        raise HTTPException(400, "Username required for project-level skills")
    # Maps to SDK setting_sources=["project"] → {cwd}/.claude/skills/
    return Path(base) / username / ".claude" / "skills"


def _get_skill_exclude(username: str) -> list[str]:
    """Read the skill_exclude denylist (with lazy migration) from .vivian.user.yml.

    Tolerates a stale ``ChannelConfigStore`` (e.g. long-running daemon that
    loaded an older class definition before the migration shipped): falls back
    to ``[]`` so all discovered skills stay enabled until the process restarts.
    """
    from .channels.config_store import get_channel_config_store
    store = get_channel_config_store()
    method = getattr(store, "get_skill_exclude", None)
    if method is None:
        logger.warning(
            "ChannelConfigStore is missing get_skill_exclude — running stale "
            "code; treating skill_exclude as empty. Restart the daemon to pick "
            "up the new config schema."
        )
        return []
    try:
        value = method(username)
    except Exception:
        logger.warning("get_skill_exclude failed; defaulting to empty denylist", exc_info=True)
        return []
    return list(value) if isinstance(value, list) else []


def _cleanup_legacy_skill_symlinks(username: str) -> None:
    """One-time wipe of leftover symlinks created by the old sync_global_skill_symlinks
    path. Skill enable/disable is now driven by ``options.skills`` and the
    project skills directory should not contain global-symlinked entries.
    """
    try:
        global_dir = _get_skills_dir("global")
        project_dir = _get_skills_dir("project", username)
    except HTTPException:
        return
    if not project_dir.exists():
        return
    global_dir_str = str(global_dir.resolve())
    for entry in project_dir.iterdir():
        if not entry.is_symlink():
            continue
        try:
            target = str(Path(os.readlink(entry)).resolve())
        except (OSError, ValueError):
            continue
        if target.startswith(global_dir_str):
            try:
                entry.unlink()
            except OSError:
                logger.warning("Failed to remove stale skill symlink: {}", entry)


def compute_enabled_skill_names(username: str) -> list[str]:
    """Return the list of skill names to pass to ``ClaudeAgentOptions.skills``.

    Enumerates discovered skills (project + global) and removes anything in
    the user's ``skill_exclude`` denylist. Result is an allowlist suitable for
    direct assignment.
    """
    exclude = set(_get_skill_exclude(username))
    seen: set[str] = set()
    enabled: list[str] = []
    for level in ("project", "global"):
        try:
            skills_dir = _get_skills_dir(level, username)
        except HTTPException:
            continue
        if not skills_dir.exists():
            continue
        for entry in sorted(skills_dir.iterdir()):
            if not entry.is_dir():
                continue
            # Skip symlinks leftover from the legacy sync (cleaned up elsewhere)
            if level == "project" and entry.is_symlink():
                try:
                    target = str(Path(os.readlink(entry)).resolve())
                    if target.startswith(str(_get_skills_dir("global").resolve())):
                        continue
                except (OSError, ValueError):
                    pass
            if not (entry / "SKILL.md").exists():
                continue
            name = entry.name
            if name in seen or name in exclude:
                seen.add(name)
                continue
            seen.add(name)
            enabled.append(name)
    return enabled


def _parse_frontmatter(skill_md_path: Path) -> dict:
    """Extract YAML frontmatter from SKILL.md."""
    try:
        text = skill_md_path.read_text(encoding="utf-8")
    except Exception:
        return {}
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    try:
        return yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        return {}


def _count_files(directory: Path) -> int:
    count = 0
    for item in directory.rglob("*"):
        if item.is_file():
            count += 1
    return count


def _build_tree(directory: Path) -> list[FileTreeNode]:
    nodes: list[FileTreeNode] = []
    try:
        entries = sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except PermissionError:
        return nodes
    for entry in entries:
        if entry.is_dir():
            children = _build_tree(entry)
            nodes.append(FileTreeNode(name=entry.name, type="directory", children=children))
        else:
            size = entry.stat().st_size if entry.exists() else 0
            nodes.append(FileTreeNode(name=entry.name, type="file", size=size))
    return nodes


def _detect_binary(data: bytes) -> bool:
    return b"\x00" in data[:8192]


def _detect_language(path: str) -> str | None:
    ext = Path(path).suffix.lower()
    if Path(path).name == "Dockerfile":
        return "dockerfile"
    return EXTENSION_LANGUAGE_MAP.get(ext)


def _validate_skill_name(name: str) -> None:
    if not name:
        raise HTTPException(422, "Skill name is required")
    if len(name) > MAX_NAME_LENGTH:
        raise HTTPException(422, f"Skill name must be at most {MAX_NAME_LENGTH} characters")
    if not SKILL_NAME_RE.match(name):
        raise HTTPException(422, "Skill name must contain only lowercase letters, numbers, and hyphens")
    if XML_TAG_RE.search(name):
        raise HTTPException(422, "Skill name must not contain XML tags")
    if name in RESERVED_WORDS:
        raise HTTPException(422, f"Skill name '{name}' is reserved")


def _validate_skill_description(desc: str | None) -> None:
    if not desc:
        raise HTTPException(422, "Skill description is required")
    if len(desc) > MAX_DESCRIPTION_LENGTH:
        raise HTTPException(422, f"Skill description must be at most {MAX_DESCRIPTION_LENGTH} characters")
    if XML_TAG_RE.search(desc):
        raise HTTPException(422, "Skill description must not contain XML tags")


def _validate_frontmatter(frontmatter: dict) -> None:
    name = frontmatter.get("name")
    if not isinstance(name, str):
        raise HTTPException(422, "SKILL.md frontmatter must contain a 'name' field (string)")
    _validate_skill_name(name)
    desc = frontmatter.get("description")
    if not isinstance(desc, str):
        raise HTTPException(422, "SKILL.md frontmatter must contain a 'description' field (string)")
    _validate_skill_description(desc)


def _safe_resolve(base: Path, relative: str) -> Path:
    """Resolve path and verify it's inside base directory."""
    resolved = (base / relative).resolve()
    if not str(resolved).startswith(str(base.resolve())):
        raise HTTPException(400, "Path traversal detected")
    return resolved


def list_skills(username: str) -> SkillListResponse:
    skills: list[SkillSummary] = []
    exclude = set(_get_skill_exclude(username))

    for level in ("project", "global"):
        skills_dir = _get_skills_dir(level, username)
        if not skills_dir.exists():
            continue
        for entry in sorted(skills_dir.iterdir()):
            if not entry.is_dir():
                continue
            # Skip symlinks in project dir that point to global — they'll be
            # listed under the "global" level instead.
            if level == "project" and entry.is_symlink():
                try:
                    target = str(Path(os.readlink(entry)).resolve())
                    global_dir_str = str(_get_skills_dir("global").resolve())
                    if target.startswith(global_dir_str):
                        continue
                except (OSError, ValueError):
                    pass
            skill_md = entry / "SKILL.md"
            if not skill_md.exists():
                continue
            fm = _parse_frontmatter(skill_md)
            skills.append(
                SkillSummary(
                    name=entry.name,
                    level=level,
                    description=fm.get("description"),
                    file_count=_count_files(entry),
                    enabled=entry.name not in exclude,
                )
            )

    return SkillListResponse(skills=skills)


def get_skill_detail(level: SkillLevel, name: str, username: str) -> SkillDetailResponse:
    skills_dir = _get_skills_dir(level, username)
    skill_path = _safe_resolve(skills_dir, name)
    if not skill_path.is_dir():
        raise HTTPException(404, f"Skill '{name}' not found at {level} level")

    skill_md = skill_path / "SKILL.md"
    fm = _parse_frontmatter(skill_md) if skill_md.exists() else {}
    tree = _build_tree(skill_path)

    return SkillDetailResponse(
        name=name,
        level=level,
        description=fm.get("description"),
        frontmatter=fm if fm else None,
        tree=tree,
        base_path=str(skill_path),
    )


def get_file_content(level: SkillLevel, name: str, path: str, username: str) -> SkillFileResponse:
    skills_dir = _get_skills_dir(level, username)
    skill_path = _safe_resolve(skills_dir, name)
    if not skill_path.is_dir():
        raise HTTPException(404, f"Skill '{name}' not found")

    file_path = _safe_resolve(skill_path, path)
    if not file_path.is_file():
        raise HTTPException(404, f"File '{path}' not found in skill '{name}'")

    size = file_path.stat().st_size
    if size > MAX_FILE_READ_SIZE:
        raise HTTPException(413, f"File exceeds {MAX_FILE_READ_SIZE // (1024*1024)}MB size limit")

    raw = file_path.read_bytes()
    is_binary = _detect_binary(raw)

    return SkillFileResponse(
        path=path,
        content="" if is_binary else raw.decode("utf-8", errors="replace"),
        language=_detect_language(path),
        is_binary=is_binary,
    )


def upload_skill(level: SkillLevel, file_data: bytes, filename: str, username: str) -> tuple[str, SkillLevel]:
    # Validate file size
    if len(file_data) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, f"File exceeds {MAX_UPLOAD_SIZE // (1024*1024)}MB size limit")

    # Validate file format and extract
    lower_name = filename.lower()
    if lower_name.endswith(".zip") or lower_name.endswith(".skill"):
        members, read_file = _extract_zip(file_data)
    elif lower_name.endswith(".tar.gz") or lower_name.endswith(".tgz"):
        members, read_file = _extract_tar(file_data, "r:gz")
    elif lower_name.endswith(".tar"):
        members, read_file = _extract_tar(file_data, "r:")
    else:
        raise HTTPException(400, "Only .zip, .tar, .tar.gz, and .skill files are accepted")

    # Find top-level directory and validate structure
    top_dirs = set()
    for m in members:
        parts = m.split("/")
        if parts[0]:
            top_dirs.add(parts[0])
        # Path traversal check
        if ".." in parts:
            raise HTTPException(400, "Archive contains path traversal (..)")

    if len(top_dirs) != 1:
        raise HTTPException(400, "Archive must contain exactly one top-level directory")

    skill_dir_name = top_dirs.pop()
    skill_md_path = f"{skill_dir_name}/SKILL.md"

    if skill_md_path not in members:
        raise HTTPException(400, f"Archive must contain {skill_dir_name}/SKILL.md")

    # Read and validate SKILL.md frontmatter
    skill_md_content = read_file(skill_md_path)
    if skill_md_content is None:
        raise HTTPException(400, "Could not read SKILL.md from archive")

    # Parse frontmatter
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

    # Extract to target directory
    target_dir = _get_skills_dir(level, username)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / skill_name

    # Remove existing if present
    if dest.exists():
        shutil.rmtree(dest)

    dest.mkdir(parents=True, exist_ok=True)

    # Write all files
    for member_path in members:
        if not member_path.startswith(skill_dir_name + "/"):
            continue
        relative = member_path[len(skill_dir_name) + 1 :]
        if not relative or member_path.endswith("/"):
            # Directory entry
            if relative:
                (dest / relative).mkdir(parents=True, exist_ok=True)
            continue
        content = read_file(member_path)
        if content is not None:
            file_dest = dest / relative
            file_dest.parent.mkdir(parents=True, exist_ok=True)
            file_dest.write_bytes(content)

    return skill_name, level


def _extract_zip(data: bytes) -> tuple[list[str], callable]:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Invalid zip file")

    members = [info.filename for info in zf.infolist()]

    def read_file(path: str) -> bytes | None:
        try:
            return zf.read(path)
        except KeyError:
            return None

    return members, read_file


def _extract_tar(data: bytes, mode: str) -> tuple[list[str], callable]:
    try:
        tf = tarfile.open(fileobj=io.BytesIO(data), mode=mode)
    except (tarfile.TarError, Exception):
        raise HTTPException(400, "Invalid tar archive")

    members = [m.name for m in tf.getmembers()]

    def read_file(path: str) -> bytes | None:
        try:
            member = tf.getmember(path)
            f = tf.extractfile(member)
            return f.read() if f else None
        except (KeyError, AttributeError):
            return None

    return members, read_file


def delete_skill(level: SkillLevel, name: str, username: str) -> None:
    skills_dir = _get_skills_dir(level, username)
    skill_path = _safe_resolve(skills_dir, name)
    if not skill_path.is_dir():
        raise HTTPException(404, f"Skill '{name}' not found at {level} level")

    shutil.rmtree(skill_path)
