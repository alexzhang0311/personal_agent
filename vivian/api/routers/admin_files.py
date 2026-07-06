"""Admin file manager: browse, download, preview, upload on the server filesystem."""

from __future__ import annotations

import mimetypes
import os
import shutil
import stat
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from ..middleware.logging import get_app_logger
from ..models.admin_files import DirectoryListResponse, FileEntry, FilePreviewResponse
from ..services.auth import require_admin

logger = get_app_logger(__name__)

router = APIRouter(
    prefix="/api/admin/files",
    tags=["admin-files"],
    dependencies=[Depends(require_admin)],
)

# Extensions treated as text for preview (beyond mime text/*)
_TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".yaml", ".yml",
    ".md", ".rst", ".txt", ".sh", ".bash", ".zsh", ".fish",
    ".toml", ".cfg", ".ini", ".xml", ".html", ".css", ".scss",
    ".csv", ".log", ".env", ".conf", ".properties", ".sql",
    ".rb", ".go", ".rs", ".java", ".kt", ".c", ".cpp", ".h",
    ".hpp", ".swift", ".r", ".lua", ".pl", ".makefile", ".dockerfile",
    ".gitignore", ".editorconfig",
}

# Dotfiles and extensionless filenames known to be text
_TEXT_FILENAMES = {
    ".zshrc", ".bashrc", ".bash_profile", ".bash_logout", ".profile",
    ".zprofile", ".zshenv", ".zlogin", ".zlogout",
    ".gitignore", ".gitconfig", ".gitattributes", ".gitmodules",
    ".editorconfig", ".npmrc", ".yarnrc", ".prettierrc",
    ".eslintrc", ".babelrc", ".dockerignore", ".env",
    ".flake8", ".pylintrc", ".pydocstyle", ".inputrc",
    ".wgetrc", ".curlrc", ".screenrc", ".tmux.conf",
    ".vimrc", ".nanorc", ".htaccess", ".mailmap",
    "Makefile", "Dockerfile", "Vagrantfile", "Procfile",
    "Gemfile", "Rakefile", "Brewfile", "Justfile",
    "LICENSE", "README", "CHANGELOG", "AUTHORS", "CONTRIBUTORS",
    "CODEOWNERS",
}

_MAX_PREVIEW_SIZE = 1 * 1024 * 1024  # 1 MB


def _looks_like_text(path: str, limit: int = 8192) -> bool:
    """Read first *limit* bytes; return True when no null bytes are found."""
    try:
        with open(path, "rb") as f:
            chunk = f.read(limit)
        return b"\x00" not in chunk
    except (PermissionError, OSError):
        return False


def _canonicalize(path: str) -> str:
    return os.path.realpath(os.path.expanduser(path))


def _sanitize_filename(name: str) -> str:
    """Replace surrogate characters that can't be encoded as UTF-8/JSON."""
    return name.encode("utf-8", errors="surrogateescape").decode("utf-8", errors="replace")


def _permission_string(mode: int) -> str:
    parts = []
    for who in (stat.S_IRUSR, stat.S_IWUSR, stat.S_IXUSR,
                stat.S_IRGRP, stat.S_IWGRP, stat.S_IXGRP,
                stat.S_IROTH, stat.S_IWOTH, stat.S_IXOTH):
        parts.append(bool(mode & who))
    chars = "rwxrwxrwx"
    return "".join(c if p else "-" for c, p in zip(chars, parts))


@router.get("/list", response_model=DirectoryListResponse)
async def list_directory(path: str = Query(default="~")):
    real_path = _canonicalize(path)
    if not os.path.isdir(real_path):
        raise HTTPException(400, f"Not a directory: {real_path}")

    entries: list[FileEntry] = []
    try:
        names = os.listdir(real_path)
    except PermissionError:
        raise HTTPException(403, f"Access denied: {real_path}")

    for raw_name in names:
        safe_name = _sanitize_filename(raw_name)
        full = os.path.join(real_path, raw_name)
        try:
            st = os.stat(full)
            entry_type = "directory" if stat.S_ISDIR(st.st_mode) else "file"
            entries.append(FileEntry(
                name=safe_name,
                type=entry_type,
                size=st.st_size if entry_type == "file" else None,
                modified=st.st_mtime,
                permissions=_permission_string(st.st_mode),
            ))
        except (PermissionError, OSError):
            entries.append(FileEntry(name=safe_name, type="file"))

    # Sort: directories first, then alphabetical
    entries.sort(key=lambda e: (0 if e.type == "directory" else 1, e.name.lower()))

    parent = os.path.dirname(real_path) if real_path != "/" else None
    return DirectoryListResponse(path=real_path, parent=parent, entries=entries)


@router.get("/download")
async def download_file(path: str = Query(...)):
    real_path = _canonicalize(path)
    if not os.path.isfile(real_path):
        raise HTTPException(404, f"File not found: {real_path}")

    try:
        mime_type = mimetypes.guess_type(real_path)[0] or "application/octet-stream"
        filename = os.path.basename(real_path)
        encoded_name = quote(filename)
        disposition = f"attachment; filename*=UTF-8''{encoded_name}"
        return FileResponse(
            path=real_path,
            media_type=mime_type,
            headers={"Content-Disposition": disposition},
        )
    except PermissionError:
        raise HTTPException(403, f"Access denied: {real_path}")


@router.get("/preview", response_model=FilePreviewResponse)
async def preview_file(path: str = Query(...)):
    real_path = _canonicalize(path)
    if not os.path.isfile(real_path):
        raise HTTPException(404, f"File not found: {real_path}")

    try:
        st = os.stat(real_path)
    except PermissionError:
        raise HTTPException(403, f"Access denied: {real_path}")

    filename = os.path.basename(real_path)
    mime_type = mimetypes.guess_type(real_path)[0] or "application/octet-stream"
    _, ext = os.path.splitext(filename)

    is_text = (
        mime_type.startswith("text/")
        or ext.lower() in _TEXT_EXTENSIONS
        or filename in _TEXT_FILENAMES
    )
    is_image = mime_type.startswith("image/")
    is_pdf = mime_type == "application/pdf" or ext.lower() == ".pdf"

    content = None
    is_binary = False
    preview_url = None

    if is_text:
        if st.st_size > _MAX_PREVIEW_SIZE:
            is_binary = True
        else:
            try:
                with open(real_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read(_MAX_PREVIEW_SIZE)
            except PermissionError:
                raise HTTPException(403, f"Access denied: {real_path}")
    elif is_image:
        preview_url = f"/api/admin/files/download?path={quote(real_path)}"
    elif is_pdf:
        preview_url = f"/api/admin/files/download?path={quote(real_path)}"
    elif st.st_size <= _MAX_PREVIEW_SIZE and _looks_like_text(real_path):
        try:
            with open(real_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read(_MAX_PREVIEW_SIZE)
        except PermissionError:
            raise HTTPException(403, f"Access denied: {real_path}")
    else:
        is_binary = True

    return FilePreviewResponse(
        path=real_path,
        name=filename,
        mime_type=mime_type,
        size=st.st_size,
        content=content,
        is_binary=is_binary,
        preview_url=preview_url,
    )


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    directory: str = Form(...),
):
    real_dir = _canonicalize(directory)
    if not os.path.isdir(real_dir):
        raise HTTPException(400, f"Not a directory: {real_dir}")

    filename = os.path.basename(file.filename or "upload")
    if not filename:
        raise HTTPException(400, "Invalid filename")

    target_path = os.path.join(real_dir, filename)

    if os.path.exists(target_path):
        raise HTTPException(409, f"File already exists: {filename}")

    try:
        with open(target_path, "wb") as dest:
            shutil.copyfileobj(file.file, dest)
    except PermissionError:
        raise HTTPException(403, f"Access denied: {real_dir}")

    size = os.path.getsize(target_path)
    logger.info("Admin uploaded file: {} ({} bytes)", target_path, size)

    return {"status": "ok", "path": target_path, "name": filename, "size": size}
