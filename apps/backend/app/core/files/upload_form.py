"""Fruehe Upload-Schranke vor der Multipart-Verarbeitung (Sicherheitsauftrag, Befund 2).

Ein Endpunkt mit ``File``/``Form``-Parametern laesst FastAPI den **gesamten**
Anfragekoerper lesen und puffern, bevor auch nur eine Dependency - also
Anmeldung und Berechtigung - laeuft. Das Dateilimit im Service griff deshalb
erst, nachdem beliebig viele Bytes bereits angenommen waren, auch von
Unangemeldeten.

Hier liest der Endpunkt den Koerper selbst, und zwar **erst nach** den
Dependencies:

1. Anmeldung und ``file.object.write`` (Dependency, ohne Koerper zu lesen),
2. allgemeine Schreibgrenze und Upload-Grenze je Betrieb (``429``),
3. ``Content-Type`` muss ``multipart/form-data`` sein,
4. ``Content-Length`` ueber der Anfragegrenze -> ``413`` ohne ein Byte zu lesen,
5. Strom stueckweise lesen und die **tatsaechlich empfangenen** Bytes zaehlen -
   unabhaengig von einer fehlenden oder falschen ``Content-Length`` -> ``413``,
   sobald die Anfragegrenze ueberschritten ist,
6. Multipart mit engen Grenzen: hoechstens ein Dateiteil, drei Formularfelder,
   je Formularfeld 1 KiB.

Anfragegrenze = Dateilimit (``upload_max_bytes``) + Zuschlag fuer den
Multipart-Rahmen (``upload_request_overhead_bytes``). Das Dateilimit selbst
prueft weiterhin der Service beim Lesen des Dateiteils (zweite Schicht).

Aufraeumen: Scheitert das Lesen, schliesst der Multipart-Parser alle bis dahin
angelegten temporaeren Dateien; nach der Anfrage schliesst diese Dependency
die Datei in jedem Fall. In den Object Storage gelangt nichts, bevor der
Service die Datei vollstaendig geprueft hat.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator, AsyncIterator
from dataclasses import dataclass

from fastapi import Depends, Request
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.requests import ClientDisconnect

from app.config import get_settings
from app.core.auth.dependencies import CurrentUser, require_permission
from app.core.auth.rate_limit import SlidingWindowLimiter, enforce
from app.core.authorization.permissions import FILE_OBJECT_WRITE
from app.errors import PayloadTooLargeError, ProblemFieldError, ValidationFailedError
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Eine Instanz fuer Endpunkt und Dependency: FastAPI fuehrt die Pruefung so
#: nur einmal je Anfrage aus.
upload_permission = require_permission(FILE_OBJECT_WRITE)

_settings = get_settings()
#: Uploads je Betrieb (docs/security.md, Abschnitt 11).
_upload_limiter = SlidingWindowLimiter(
    name="upload",
    limit=_settings.upload_per_organization_per_window,
    window_seconds=_settings.upload_window_seconds,
)

FILE_FIELD = "upload"
TEXT_FIELDS = frozenset({"project_id", "entity_type", "entity_id"})
#: Groesste Laenge eines Formularfelds (UUIDs, kurzer Objekttyp).
MAX_FIELD_BYTES = 1024
ENTITY_TYPE_MAX_LENGTH = 60


@dataclass(frozen=True, slots=True)
class UploadForm:
    """Gepruefter Inhalt eines Upload-Formulars."""

    upload: UploadFile
    project_id: uuid.UUID | None
    entity_type: str | None
    entity_id: uuid.UUID | None


def _too_large(limit: int) -> PayloadTooLargeError:
    limit_mb = max(1, get_settings().upload_max_bytes // (1024 * 1024))
    logger.info("upload_rejected_too_large", limit_bytes=limit)
    return PayloadTooLargeError(f"Die Datei ist groesser als {limit_mb} MB.")


def _invalid_form(detail: str, field: str | None = None) -> ValidationFailedError:
    errors = [ProblemFieldError(field=field, code="invalid", message=detail)] if field else None
    return ValidationFailedError(detail, errors=errors)


async def _counted(request: Request, limit: int) -> AsyncGenerator[bytes, None]:
    """Reicht den Strom durch und zaehlt die tatsaechlich empfangenen Bytes."""
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > limit:
            raise _too_large(limit)
        yield chunk


def _optional_uuid(value: str | UploadFile | None, field: str) -> uuid.UUID | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise _invalid_form("Ungueltiges Formularfeld.", field)
    try:
        return uuid.UUID(value)
    except ValueError:
        raise _invalid_form("Keine gueltige ID.", field) from None


async def read_upload_form(
    request: Request,
    current_user: CurrentUser = Depends(upload_permission),
) -> AsyncIterator[UploadForm]:
    """Liest das Upload-Formular - erst nach Anmeldung, Berechtigung und Grenzen."""
    enforce(
        _upload_limiter,
        f"organization:{current_user.organization_id}",
        message="Zu viele Uploads in kurzer Zeit. Bitte spaeter erneut versuchen.",
        log_event="upload_rate_limited",
    )
    settings = get_settings()
    limit = settings.upload_request_max_bytes

    content_type = request.headers.get("content-type", "")
    if not content_type.lower().startswith("multipart/form-data"):
        raise _invalid_form("Erwartet wird ein Formular (multipart/form-data).")

    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            declared_bytes = int(declared)
        except ValueError:
            raise _invalid_form("Ungueltige Laengenangabe.") from None
        if declared_bytes < 0:
            raise _invalid_form("Ungueltige Laengenangabe.")
        if declared_bytes > limit:
            # Abgewiesen, bevor ein Byte des Koerpers gelesen ist.
            raise _too_large(limit)

    parser = MultiPartParser(
        request.headers,
        _counted(request, limit),
        max_files=1,
        max_fields=len(TEXT_FIELDS),
        max_part_size=MAX_FIELD_BYTES,
    )
    try:
        form = await parser.parse()
    except MultiPartException:
        raise _invalid_form("Das Upload-Formular ist ungueltig.") from None
    except ClientDisconnect:
        logger.info("upload_aborted_by_client")
        raise _invalid_form("Die Uebertragung wurde abgebrochen.") from None

    try:
        unknown = sorted({key for key in form if key != FILE_FIELD and key not in TEXT_FIELDS})
        if unknown:
            raise _invalid_form("Unbekanntes Formularfeld.", unknown[0])
        files = form.getlist(FILE_FIELD)
        if len(files) != 1 or not isinstance(files[0], UploadFile):
            raise _invalid_form("Genau eine Datei im Feld 'upload' erwartet.", FILE_FIELD)
        for key in TEXT_FIELDS:
            if len(form.getlist(key)) > 1:
                raise _invalid_form("Formularfeld mehrfach angegeben.", key)
        entity_type = form.get("entity_type")
        if entity_type is not None and not isinstance(entity_type, str):
            raise _invalid_form("Ungueltiges Formularfeld.", "entity_type")
        if entity_type is not None and len(entity_type) > ENTITY_TYPE_MAX_LENGTH:
            raise _invalid_form("Objekttyp ist zu lang.", "entity_type")
        parsed = UploadForm(
            upload=files[0],
            project_id=_optional_uuid(form.get("project_id"), "project_id"),
            entity_type=entity_type or None,
            entity_id=_optional_uuid(form.get("entity_id"), "entity_id"),
        )
    except BaseException:
        await form.close()
        raise

    try:
        yield parsed
    finally:
        await form.close()
