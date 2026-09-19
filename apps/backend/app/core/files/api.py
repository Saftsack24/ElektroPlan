"""Endpunkte fuer Datei-Upload und -Download."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.audit import service as audit
from app.core.auth.dependencies import CurrentUser, require_permission
from app.core.authorization.permissions import FILE_OBJECT_READ, FILE_OBJECT_WRITE
from app.core.files.service import FileService
from app.core.files.storage import ObjectStorage, get_object_storage
from app.db.session import get_session

router = APIRouter(tags=["files"])


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    entity_type: str | None
    entity_id: uuid.UUID | None
    created_at: datetime


@router.post(
    "/files",
    response_model=FileOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="uploadFile",
    summary="Datei hochladen",
)
def upload_file(
    upload: UploadFile = File(...),
    entity_type: str | None = Form(default=None),
    entity_id: uuid.UUID | None = Form(default=None),
    current_user: CurrentUser = Depends(require_permission(FILE_OBJECT_WRITE)),
    session: Session = Depends(get_session),
    storage: ObjectStorage = Depends(get_object_storage),
) -> FileOut:
    """Nimmt eine Datei entgegen, prueft sie und legt sie im Storage ab."""
    service = FileService(session, storage, current_user.organization_id)
    # Der Strom wird stueckweise gelesen; das Groessenlimit greift waehrend des
    # Lesens, nicht erst danach.
    record = service.upload(
        filename=upload.filename or "datei",
        content_type=upload.content_type or "application/octet-stream",
        stream=upload.file,
        uploaded_by=current_user.user_id,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_FILE_UPLOADED,
        entity_type="file",
        entity_id=record.id,
        actor_user_id=current_user.user_id,
        summary=f"Upload {record.filename}",
        data={"size_bytes": record.size_bytes, "content_type": record.content_type},
    )
    # Committet und raeumt bei Fehlschlag das bereits geladene Objekt ab.
    service.finalize(record)
    return FileOut.model_validate(record)


@router.get(
    "/files/{file_id}",
    response_model=FileOut,
    operation_id="getFile",
    summary="Dateimetadaten",
)
def get_file(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(FILE_OBJECT_READ)),
    session: Session = Depends(get_session),
    storage: ObjectStorage = Depends(get_object_storage),
) -> FileOut:
    """Metadaten einer Datei der eigenen Organisation."""
    service = FileService(session, storage, current_user.organization_id)
    return FileOut.model_validate(service.repository.get_or_404(file_id))


@router.get(
    "/files/{file_id}/download",
    operation_id="downloadFile",
    summary="Datei herunterladen",
    response_class=RedirectResponse,
    status_code=status.HTTP_307_TEMPORARY_REDIRECT,
)
def download_file(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(FILE_OBJECT_READ)),
    session: Session = Depends(get_session),
    storage: ObjectStorage = Depends(get_object_storage),
) -> RedirectResponse:
    """Leitet auf eine kurzlebige, autorisierte Download-URL um."""
    service = FileService(session, storage, current_user.organization_id)
    url = service.download_url(file_id)
    audit.record(
        session,
        organization_id=current_user.organization_id,
        action=audit.ACTION_FILE_DOWNLOADED,
        entity_type="file",
        entity_id=file_id,
        actor_user_id=current_user.user_id,
        summary="Download",
    )
    session.commit()
    return RedirectResponse(url=url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
