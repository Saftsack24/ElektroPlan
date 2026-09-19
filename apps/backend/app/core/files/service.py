"""Datei-Upload mit Pruefungen (docs/security.md, Abschnitt 7).

Der Upload liest **stueckweise**: Das Groessenlimit greift waehrend des Lesens,
nicht erst, wenn die Datei bereits vollstaendig im Speicher liegt. Gepuffert
wird in einer ``SpooledTemporaryFile``, die oberhalb einer kleinen Schwelle auf
die Festplatte auslagert.

Reihenfolge und Aufraeumen (Punkt 6 der Phase-1.1-Abnahme):

1. Inhaltstyp und erste Bytes pruefen, Strom gepuffert lesen, SHA-256 bilden.
2. Datenbankzeile anlegen und flushen.
3. Objekt in den Storage laden.
4. Commit. Schlaegt er fehl, wird das bereits geladene Objekt wieder geloescht.

Faellt Schritt 3 aus, wird die Transaktion zurueckgerollt - es bleibt kein
Datenbankdatensatz ohne Objekt zurueck. Faellt Schritt 4 aus, bleibt kein
verwaistes Objekt ohne Datenbankdatensatz zurueck.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from tempfile import SpooledTemporaryFile
from typing import IO

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.files.models import FileRecord
from app.core.files.storage import (
    ALLOWED_CONTENT_TYPES,
    ObjectStorage,
    build_storage_key,
    matches_magic_bytes,
)
from app.core.tenancy.repository import TenantRepository
from app.errors import ValidationFailedError
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Lesegroesse je Schritt.
CHUNK_SIZE = 64 * 1024
#: Ab dieser Groesse wird der Puffer auf die Festplatte ausgelagert.
SPOOL_MAX_MEMORY = 1024 * 1024


class FileRepository(TenantRepository[FileRecord]):
    model = FileRecord


@dataclass(frozen=True, slots=True)
class BufferedUpload:
    """Geprueftes Ergebnis des Einlesens."""

    buffer: SpooledTemporaryFile[bytes]
    size_bytes: int
    sha256: str


class FileService:
    """Legt Dateien im Object Storage ab und fuehrt die Metadaten."""

    def __init__(
        self, session: Session, storage: ObjectStorage, organization_id: uuid.UUID
    ) -> None:
        self.session = session
        self.storage = storage
        self.organization_id = organization_id
        self.repository = FileRepository(session, organization_id)

    # ------------------------------------------------------------------ Lesen

    @staticmethod
    def read_checked(stream: IO[bytes], content_type: str) -> BufferedUpload:
        """Liest den Strom stueckweise und prueft dabei Groesse und Inhalt.

        Bricht ab, sobald das Limit ueberschritten ist - der Rest wird nicht
        mehr gelesen.
        """
        settings = get_settings()
        if content_type not in ALLOWED_CONTENT_TYPES:
            allowed = ", ".join(sorted(ALLOWED_CONTENT_TYPES))
            raise ValidationFailedError(f"Dateityp nicht erlaubt. Zulaessig: {allowed}.")

        digest = hashlib.sha256()
        size = 0
        checked_head = False
        # Bewusst ohne Context Manager: Der Puffer wird an den Aufrufer
        # weitergereicht und dort geschlossen.
        buffer: SpooledTemporaryFile[bytes] = SpooledTemporaryFile(  # noqa: SIM115
            max_size=SPOOL_MAX_MEMORY
        )

        try:
            while True:
                chunk = stream.read(CHUNK_SIZE)
                if not chunk:
                    break
                if not checked_head:
                    if not matches_magic_bytes(content_type, chunk[:16]):
                        raise ValidationFailedError(
                            "Der Dateiinhalt passt nicht zum angegebenen Typ."
                        )
                    checked_head = True
                size += len(chunk)
                if size > settings.upload_max_bytes:
                    limit_mb = settings.upload_max_bytes // (1024 * 1024)
                    raise ValidationFailedError(f"Die Datei ist groesser als {limit_mb} MB.")
                digest.update(chunk)
                buffer.write(chunk)

            if size == 0:
                raise ValidationFailedError("Die Datei ist leer.")
        except Exception:
            buffer.close()
            raise

        buffer.seek(0)
        return BufferedUpload(buffer=buffer, size_bytes=size, sha256=digest.hexdigest())

    # --------------------------------------------------------------- Speichern

    def upload(
        self,
        *,
        filename: str,
        content_type: str,
        stream: IO[bytes],
        uploaded_by: uuid.UUID,
        project_id: uuid.UUID | None = None,
        entity_type: str | None = None,
        entity_id: uuid.UUID | None = None,
    ) -> FileRecord:
        """Prueft, speichert und verknuepft eine Datei.

        Diese Operation besitzt ihre Transaktionsgrenze selbst, weil sie ein
        externes System einbezieht: Nur so laesst sich zusichern, dass weder ein
        verwaistes Objekt noch ein Datensatz ohne Objekt zurueckbleibt.
        """
        buffered = self.read_checked(stream, content_type)
        try:
            file_id = uuid.uuid4()
            key = build_storage_key(self.organization_id, file_id, filename, project_id=project_id)

            record = FileRecord(
                id=file_id,
                organization_id=self.organization_id,
                project_id=project_id,
                storage_key=key,
                filename=filename[:255],
                content_type=content_type,
                size_bytes=buffered.size_bytes,
                sha256=buffered.sha256,
                entity_type=entity_type,
                entity_id=entity_id,
                created_by_user_id=uploaded_by,
            )
            self.session.add(record)
            # Erst die Datenbankzeile: Schlaegt sie fehl, wurde noch nichts
            # in den Storage geladen.
            self.session.flush()

            try:
                self.storage.put_stream(key, buffered.buffer, content_type, buffered.size_bytes)
            except Exception:
                self.session.rollback()
                logger.exception("upload_storage_failed", storage_key=key)
                raise
        finally:
            buffered.buffer.close()

        return record

    def finalize(self, record: FileRecord) -> None:
        """Committet den Upload und raeumt bei Fehlschlag das Objekt ab."""
        storage_key = record.storage_key
        try:
            self.session.commit()
        except Exception:
            self.session.rollback()
            self._discard_object(storage_key)
            raise

    def _discard_object(self, storage_key: str) -> None:
        """Entfernt ein Objekt, zu dem es keinen Datensatz (mehr) gibt."""
        try:
            self.storage.delete(storage_key)
            logger.warning("orphan_object_removed", storage_key=storage_key)
        except Exception:
            # Der eigentliche Fehler darf nicht verdeckt werden. Der Schluessel
            # ist protokolliert und kann ueber den dokumentierten
            # Cleanup-Lauf entfernt werden (docs/security.md, Abschnitt 7).
            logger.exception("orphan_object_cleanup_failed", storage_key=storage_key)

    # ------------------------------------------------------------------ Lesen

    def download_url(self, file_id: uuid.UUID) -> str:
        """Zeitlich begrenzte URL - nur fuer Dateien der eigenen Organisation."""
        record = self.repository.get_or_404(file_id)
        return self.storage.presigned_download_url(record.storage_key, filename=record.filename)

    def list_for_project(self, project_id: uuid.UUID) -> list[FileRecord]:
        """Dateien eines Projekts, neueste zuerst.

        Ohne Paginierung: Ein Projekt hat Plaene und Fotos in zweistelliger
        Zahl. Sollte sich das aendern, kommt derselbe Keyset-Cursor zum
        Einsatz wie bei Kunden und Projekten.
        """
        stmt = (
            self.repository.query()
            .where(FileRecord.project_id == project_id)
            .order_by(FileRecord.created_at.desc(), FileRecord.id.desc())
        )
        return list(self.session.execute(stmt).scalars().all())
