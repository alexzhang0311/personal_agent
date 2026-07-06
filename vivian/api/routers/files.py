"""File upload/download/delete endpoints."""

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse

from ..services.auth import require_user
from ..services.temp_files import (
    delete_temp_file,
    get_file_by_uuid,
    list_temp_files,
    save_temp_file,
    validate_file,
    validate_file_content,
    _validate_uuid,
)
from ..services.user_store import UserRecord

router = APIRouter(prefix="/api/files", tags=["files"])


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user: UserRecord = Depends(require_user),
):
    file_data = await file.read()
    filename = file.filename or "upload"
    validate_file(filename, len(file_data))
    validate_file_content(filename, file_data)
    file_uuid, stored_name, full_path, size = save_temp_file(user.username, filename, file_data)
    return {
        "uuid": file_uuid,
        "filesystem_name": stored_name,
        "upload_name": filename,
        "path": full_path,
        "size": size,
    }


@router.delete("/{fileuuid}")
async def delete_file(
    fileuuid: str,
    user: UserRecord = Depends(require_user),
):
    _validate_uuid(fileuuid)
    delete_temp_file(user.username, fileuuid)
    return {"status": "ok"}


@router.get("/")
async def list_files(
    user: UserRecord = Depends(require_user),
    date: str | None = Query(default=None),
):
    return {"files": list_temp_files(user.username, date_filter=date)}


@router.get("/{fileuuid}")
async def download_file(
    fileuuid: str,
    user: UserRecord = Depends(require_user),
):
    _validate_uuid(fileuuid)
    file_path, original_name, mime_type = get_file_by_uuid(user.username, fileuuid)
    # RFC 5987: use filename* with UTF-8 encoding for non-ASCII filenames
    encoded_name = quote(original_name)
    disposition = f"attachment; filename*=UTF-8''{encoded_name}"
    return FileResponse(
        path=file_path,
        media_type=mime_type,
        headers={"Content-Disposition": disposition},
    )
