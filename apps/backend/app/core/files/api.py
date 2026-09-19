"""Endpunkte fuer Datei-Upload und -Download."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.audit import service as audit
from app.core.auth.dependencies import CurrentUser, require_permission
from app.core.authorization.permissions import (
    FILE_OBJECT_READ,
    FILE_OBJECT_WRITE,
    PROJECT_RECORD_READ,
)
from app.core.files.service import FileService
from app.core.files.storage import ObjectStorage, get_object_storage
from app.core.projects.service import ProjectService
from app.db.session import get_session
from app.errors import ProblemDetail

router = APIRouter(tags=["files"])


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    project_id: uuid.UUID | None
    entity_type: str | None
    entity_id: uuid.UUID | None
    created_at: datetime


class FileDownloadUrl(BaseModel):
    """Kurzlebige Download-Adresse fuer den Browser."""

    url: str
    filename: str
    expires_in: int


@router.post(
    "/files",
    response_model=FileOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="uploadFile",
    summary="Datei hochladen",
    responses={
        404: {"model": ProblemDetail, "description": "Projekt nicht gefunden"},
        409: {"model": ProblemDetail, "description": "Projekt ist archiviert"},
        422: {"model": ProblemDetail, "description": "Dateityp, Inhalt oder Groesse unzulaessig"},
    },
)
def upload_file(
    upload: UploadFile = File(...),
    project_id: uuid.UUID | None = Form(default=None),
    entity_type: str | None = Form(default=None),
    entity_id: uuid.UUID | None = Form(default=None),
    current_user: CurrentUser = Depends(require_permission(FILE_OBJECT_WRITE)),
    session: Session = Depends(get_session),
    storage: ObjectStorage = Depends(get_object_storage),
) -> FileOut:
    """Nimmt eine Datei entgegen, prueft sie und legt sie im Storage ab.

    Mit ``project_id`` wird die Datei einem Projekt zugeordnet; das Projekt
    muss der eigenen Organisation gehoeren und darf nicht archiviert sein.
    """
    if project_id is not None:
        # Fremde oder unbekannte Projekte liefern 404, archivierte 409. Die
        # Vorbedingung liegt im Projektdienst, damit die Regel an einer
        # Stelle steht (docs/api.md, Abschnitt "Projektstatus").
        ProjectService(session, current_user.organization_id).get_writable(project_id)

    service = FileService(session, storage, current_user.organization_id)
    # Der Strom wird stueckweise gelesen; das Groessenlimit greift waehrend des
    # Lesens, nicht erst danach.
    record = service.upload(
        filename=upload.filename or "datei",
        content_type=upload.content_type or "application/octet-stream",
        stream=upload.file,
        uploaded_by=current_user.user_id,
        project_id=project_id,
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
        data={
            "size_bytes": record.size_bytes,
            "content_type": record.content_type,
            "project_id": str(project_id) if project_id else None,
        },
    )
    # Committet und raeumt bei Fehlschlag das bereits geladene Objekt ab.
    service.finalize(record)
    return FileOut.model_validate(record)


@router.get(
    "/projects/{project_id}/files",
    response_model=list[FileOut],
    operation_id="listProjectFiles",
    summary="Dateien eines Projekts",
    responses={404: {"model": ProblemDetail, "description": "Nicht gefunden"}},
)
def list_project_files(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(PROJECT_RECORD_READ)),
    session: Session = Depends(get_session),
    storage: ObjectStorage = Depends(get_object_storage),
) -> list[FileOut]:
    """Alle Dateien des Projekts, neueste zuerst."""
    ProjectService(session, current_user.organization_id).get(project_id)
    service = FileService(session, storage, current_user.organization_id)
    return [FileOut.model_validate(row) for row in service.list_for_project(project_id)]


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
    "/files/{file_id}/download-url",
    response_model=FileDownloadUrl,
    operation_id="getFileDownloadUrl",
    summary="Download-Adresse einer Datei",
    responses={404: {"model": ProblemDetail, "description": "Nicht gefunden"}},
)
def get_file_download_url(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_permission(FILE_OBJECT_READ)),
    session: Session = Depends(get_session),
    storage: ObjectStorage = Depends(get_object_storage),
) -> FileDownloadUrl:
    """Liefert die signierte Download-Adresse als JSON.

    Warum zusaetzlich zu ``/files/{id}/download``: Der Umleitungsendpunkt
    verlangt ``Authorization: Bearer``. Ein einfacher Link im Browser kann
    diesen Header nicht setzen, und der Token darf nicht in die URL wandern.
    Die Oberflaeche holt deshalb zuerst die Adresse und navigiert dann dorthin.
    """
    service = FileService(session, storage, current_user.organization_id)
    record = service.repository.get_or_404(file_id)
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
    return FileDownloadUrl(
        url=url,
        filename=record.filename,
        expires_in=get_settings().download_url_ttl_seconds,
    )


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
