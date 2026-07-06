"""Temporary file management for file uploads."""

from __future__ import annotations

import fcntl
import json
import mimetypes
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from ..middleware.logging import get_app_logger
from .config import get_settings

logger = get_app_logger(__name__)

MAX_FILE_SIZE = 3 * 1024 * 1024  # 3MB
TTL_SECONDS = 24 * 60 * 60  # 24 hours

ALLOWED_EXTENSIONS = {
    ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".pdf", ".zip",
    ".txt", ".csv", ".json", ".xml", ".md", ".log",
    ".yaml", ".yml", ".toml", ".ini", ".conf",
    ".py", ".js", ".ts", ".jsx", ".tsx",
    ".html", ".css", ".sh", ".sql",
    ".r", ".lua", ".swift", ".kt", ".scala",
    ".go", ".rs", ".java", ".rb", ".php",
    ".c", ".cpp", ".h", ".hpp",
    ".env", ".dockerfile",
}

ZIP_SIGNATURES = (
    b"PK\x03\x04",
    b"PK\x05\x06",
    b"PK\x07\x08",
)
OLE_SIGNATURE = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"
PDF_SIGNATURE = b"%PDF-"

_TEXT_EXTENSIONS = frozenset({
    ".txt", ".csv", ".json", ".xml", ".md", ".log",
    ".yaml", ".yml", ".toml", ".ini", ".conf",
    ".py", ".js", ".ts", ".jsx", ".tsx",
    ".html", ".css", ".sh", ".sql",
    ".r", ".lua", ".swift", ".kt", ".scala",
    ".go", ".rs", ".java", ".rb", ".php",
    ".c", ".cpp", ".h", ".hpp",
    ".env", ".dockerfile",
})

_index_lock = threading.Lock()


def get_temp_dir(username: str) -> Path:
    """Return base file directory: {workspace}/{username}/temp/uploads/"""
    settings = get_settings()
    base = os.path.expanduser(settings.server.work_dir)
    return Path(base) / username / "temp" / "uploads"


def _get_date_dir(username: str, date_str: str | None = None) -> Path:
    """Return date subdirectory: {workspace}/{username}/temp/uploads/{YYYY-MM-DD}/"""
    if date_str is None:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return get_temp_dir(username) / date_str


def _get_index_path(username: str) -> Path:
    """Return index file path: {workspace}/{username}/temp/uploads/.index.jsonl"""
    return get_temp_dir(username) / ".index.jsonl"


def _safe_resolve(base: Path, relative: str) -> Path:
    """Resolve path and verify it's inside base directory."""
    resolved = (base / relative).resolve()
    if not str(resolved).startswith(str(base.resolve())):
        raise HTTPException(400, "Path traversal detected")
    return resolved


def validate_file(filename: str, size: int) -> None:
    """Validate file extension and size."""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}")
    if size > MAX_FILE_SIZE:
        raise HTTPException(413, f"File exceeds {MAX_FILE_SIZE // (1024 * 1024)}MB size limit")


def _is_zip_container(data: bytes) -> bool:
    return any(data.startswith(signature) for signature in ZIP_SIGNATURES)


def _is_ole_container(data: bytes) -> bool:
    return data.startswith(OLE_SIGNATURE)


def _is_pdf(data: bytes) -> bool:
    return data.startswith(PDF_SIGNATURE)


def _looks_like_text(data: bytes) -> bool:
    """Heuristic: return True if `data` looks like a text/source file.

    Empty bytes are treated as text. Otherwise we inspect the first 8KB,
    reject any NUL byte (a strong binary signal), then try UTF-8. UTF-8
    failures fall back to Latin-1 with a control-character ratio check so
    legacy encodings still pass without letting random binary slip through.
    """
    if not data:
        return True
    window = data[:8192]
    if b"\x00" in window:
        return False
    if window.startswith(b"\xef\xbb\xbf"):
        window = window[3:]
    try:
        window.decode("utf-8")
        return True
    except UnicodeDecodeError:
        pass
    try:
        text = window.decode("latin-1")
    except UnicodeDecodeError:
        return False
    if not text:
        return True
    control = 0
    for ch in text:
        code = ord(ch)
        if code <= 0x08 or code == 0x0B or code == 0x0C or (0x0E <= code <= 0x1F) or code == 0x7F:
            control += 1
    return (control / len(text)) < 0.05


def validate_file_content(filename: str, data: bytes) -> None:
    """Validate office file container signatures to catch mislabeled binary files."""
    ext = Path(filename).suffix.lower()

    if ext in {".xlsx", ".docx", ".pptx"} and not _is_zip_container(data):
        raise HTTPException(400, f"Invalid {ext} file: expected a ZIP-based Office document")

    if ext in {".xls", ".doc", ".ppt"} and not (_is_zip_container(data) or _is_ole_container(data)):
        raise HTTPException(400, f"Invalid {ext} file: expected an OLE or ZIP-based Office document")

    if ext == ".pdf" and not _is_pdf(data):
        raise HTTPException(400, "Invalid .pdf file: expected '%PDF-' header")

    if ext == ".zip" and not _is_zip_container(data):
        raise HTTPException(400, "Invalid .zip file: expected ZIP signature")

    if ext in _TEXT_EXTENSIONS and not _looks_like_text(data):
        raise HTTPException(400, "Invalid text file: contains binary data")


def _read_index(username: str) -> list[dict]:
    """Read all entries from .index.jsonl, auto-clean entries whose files are missing."""
    index_path = _get_index_path(username)
    if not index_path.exists():
        return []

    entries = []
    dirty = False
    with _index_lock:
        with open(index_path, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except Exception:
                        dirty = True
                        continue
                    if entry.get("deleted"):
                        dirty = True
                        continue
                    # Verify file exists on disk
                    file_path = _get_date_dir(username, entry["upload_date"]) / entry["stored_name"]
                    if not file_path.is_file():
                        dirty = True
                        continue
                    entries.append(entry)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)

    # Rewrite index if we found stale entries
    if dirty:
        _rewrite_index(username, entries)

    return entries


def _append_index_entry(username: str, entry: dict) -> None:
    """Append one JSONL line to .index.jsonl with exclusive lock."""
    index_path = _get_index_path(username)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    with _index_lock:
        with open(index_path, "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                f.write(json.dumps(entry, default=str) + "\n")
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)


def _remove_index_entry(username: str, file_uuid: str) -> dict | None:
    """Remove entry from .index.jsonl by UUID. Returns removed entry or None."""
    index_path = _get_index_path(username)
    if not index_path.exists():
        return None

    removed = None
    remaining = []
    with _index_lock:
        with open(index_path, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except Exception:
                        continue
                    if entry.get("uuid") == file_uuid:
                        removed = entry
                    else:
                        remaining.append(entry)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)

        if removed is not None:
            with open(index_path, "w") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    for entry in remaining:
                        f.write(json.dumps(entry, default=str) + "\n")
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)

    return removed


def _rewrite_index(username: str, entries: list[dict]) -> None:
    """Rewrite .index.jsonl with given entries (exclusive lock)."""
    index_path = _get_index_path(username)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    with _index_lock:
        with open(index_path, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                for entry in entries:
                    f.write(json.dumps(entry, default=str) + "\n")
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)


def save_temp_file(username: str, filename: str, data: bytes) -> tuple[str, str, str, int]:
    """Save uploaded file with UUID name under date directory.

    Returns (uuid, stored_name, full_path, size).
    Write file to disk FIRST, then append index entry.
    """
    ext = Path(filename).suffix.lower() or ""
    file_uuid = uuid.uuid4().hex
    stored_name = f"{file_uuid}{ext}"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    date_dir = _get_date_dir(username, today)
    date_dir.mkdir(parents=True, exist_ok=True)
    file_path = date_dir / stored_name

    # Write file to disk FIRST
    file_path.write_bytes(data)
    size = len(data)

    # Guess mime type
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

    # Then append index entry
    entry = {
        "uuid": file_uuid,
        "original_name": filename,
        "stored_name": stored_name,
        "ext": ext,
        "size": size,
        "mime_type": mime_type,
        "upload_date": today,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "username": username,
        "deleted": False,
        "deleted_at": None,
    }
    _append_index_entry(username, entry)

    return file_uuid, stored_name, str(file_path), size


def _validate_uuid(file_uuid: str) -> None:
    """Validate UUID format: hex string, 32 chars, no special chars."""
    if not file_uuid or len(file_uuid) != 32:
        raise HTTPException(400, "Invalid file UUID")
    if not all(c in "0123456789abcdef" for c in file_uuid.lower()):
        raise HTTPException(400, "Invalid file UUID")
    if "/" in file_uuid or "\\" in file_uuid or "\x00" in file_uuid:
        raise HTTPException(400, "Invalid file UUID")


def delete_temp_file(username: str, file_uuid: str) -> None:
    """Delete a temp file by UUID. Remove index entry FIRST, then delete from disk."""
    _validate_uuid(file_uuid)

    # Remove entry from index FIRST
    removed = _remove_index_entry(username, file_uuid)
    if removed is None:
        raise HTTPException(404, "File not found")

    # Then delete file from disk (ignore if already gone)
    file_path = _get_date_dir(username, removed["upload_date"]) / removed["stored_name"]
    try:
        file_path.unlink()
    except FileNotFoundError:
        pass


def list_temp_files(username: str, date_filter: str | None = None) -> list[dict]:
    """List all temp files for a user from .index.jsonl."""
    entries = _read_index(username)
    if date_filter:
        entries = [e for e in entries if e.get("upload_date") == date_filter]
    # Add full filesystem path for each entry
    base = get_temp_dir(username)
    for entry in entries:
        entry["path"] = str(base / entry["upload_date"] / entry["stored_name"])
    return entries


def get_file_by_uuid(username: str, file_uuid: str) -> tuple[str, str, str]:
    """Look up file by UUID. Returns (file_path, original_name, mime_type).

    Raises 404 if not found or file missing on disk.
    """
    _validate_uuid(file_uuid)
    entries = _read_index(username)
    entry = next((e for e in entries if e["uuid"] == file_uuid), None)
    if entry is None:
        raise HTTPException(404, "File not found")

    file_path = _get_date_dir(username, entry["upload_date"]) / entry["stored_name"]

    # Verify within user's temp directory
    base = get_temp_dir(username)
    resolved = file_path.resolve()
    if not str(resolved).startswith(str(base.resolve())):
        raise HTTPException(400, "Path traversal detected")

    if not file_path.is_file():
        # Auto-clean dangling entry
        _remove_index_entry(username, file_uuid)
        raise HTTPException(404, "File not found")

    return str(file_path), entry["original_name"], entry.get("mime_type", "application/octet-stream")


def cleanup_expired_files() -> int:
    """Delete expired temp files across all users. Returns count deleted."""
    settings = get_settings()
    base = Path(os.path.expanduser(settings.server.work_dir))
    if not base.exists():
        return 0

    now = time.time()
    deleted = 0

    for user_dir in base.iterdir():
        if not user_dir.is_dir():
            continue

        username = user_dir.name

        # Clean new-style temp/uploads/ directory
        file_dir = user_dir / "temp" / "uploads"
        if file_dir.is_dir():
            index_path = file_dir / ".index.jsonl"
            if index_path.exists():
                # Read index and remove expired entries
                entries = _read_index(username)
                kept = []
                for entry in entries:
                    fp = _get_date_dir(username, entry["upload_date"]) / entry["stored_name"]
                    try:
                        if now - fp.stat().st_mtime > TTL_SECONDS:
                            try:
                                fp.unlink()
                            except FileNotFoundError:
                                pass
                            deleted += 1
                        else:
                            kept.append(entry)
                    except FileNotFoundError:
                        deleted += 1
                if len(kept) != len(entries):
                    _rewrite_index(username, kept)

            # Scan date directories for orphaned files
            indexed_files: set[str] = set()
            if index_path.exists():
                for entry in _read_index(username):
                    fp = _get_date_dir(username, entry["upload_date"]) / entry["stored_name"]
                    indexed_files.add(str(fp.resolve()))

            for sub in file_dir.iterdir():
                if not sub.is_dir() or sub.name.startswith("."):
                    continue
                for f in sub.iterdir():
                    if not f.is_file():
                        continue
                    if str(f.resolve()) not in indexed_files:
                        try:
                            if now - f.stat().st_mtime > TTL_SECONDS:
                                f.unlink()
                                deleted += 1
                        except Exception:
                            pass
                # Remove empty date directories
                try:
                    if sub.is_dir() and not any(sub.iterdir()):
                        sub.rmdir()
                except Exception:
                    pass

        # Clean legacy flat temp/ directory (backwards compat)
        legacy_temp = user_dir / "temp"
        if legacy_temp.is_dir():
            for f in legacy_temp.iterdir():
                if not f.is_file():
                    continue
                try:
                    if now - f.stat().st_mtime > TTL_SECONDS:
                        f.unlink()
                        deleted += 1
                except Exception:
                    pass

    if deleted:
        logger.info("Cleaned up {} expired temp files", deleted)
    return deleted
