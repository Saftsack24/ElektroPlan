"""Dateimetadaten. Der Inhalt liegt im Object Storage (ADR 0002)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import (
    Authored,
    TenantScoped,
    Timestamped,
    UUIDPrimaryKey,
    tenant_fk,
    tenant_identity,
)


class FileRecord(UUIDPrimaryKey, TenantScoped, Timestamped, Authored, Base):
    """Eine hochgeladene Datei.

    Der Speicherschluessel wird serverseitig erzeugt; der urspruengliche
    Dateiname wird nie als Pfad verwendet (docs/security.md, Abschnitt 7).
    """

    __tablename__ = "files"
    __table_args__ = (
        tenant_identity(),
        UniqueConstraint("storage_key"),
        tenant_fk("project_id", "projects"),
        Index("ix_files_organization_id_project_id", "organization_id", "project_id"),
    )

    #: Projektzuordnung. ``NULL`` fuer Dateien ohne Projektbezug; der
    #: zusammengesetzte Fremdschluessel greift dann nicht (MATCH SIMPLE).
    project_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)

    storage_key: Mapped[str] = mapped_column(String(400), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    #: Generische Verknuepfung zu einer Fachentitaet (ohne Fremdschluessel,
    #: damit Module ihre Interna nicht offenlegen muessen).
    entity_type: Mapped[str | None] = mapped_column(String(60), nullable=True, default=None)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)


class StorageCleanupJob(UUIDPrimaryKey, TenantScoped, Timestamped, Base):
    """Ein Objekt im Storage, das geloescht werden soll (ADR 0020).

    PostgreSQL und der Object Storage teilen **keine** Transaktion. Deshalb wird
    der Schluessel in **derselben** Datenbanktransaktion vorgemerkt, in der die
    Dateizeile verschwindet. Erst nach dem Commit wird das Objekt entfernt. Faellt
    der Storage aus, bleibt der Auftrag mit Versuchszaehler und letzter
    Fehlermeldung stehen und wird spaeter erneut abgearbeitet
    (``python -m app.cli storage-cleanup``). Ein erledigter Auftrag wird
    geloescht.

    Gespeichert werden nur Schluessel, Grund und Diagnose - **keine** signierten
    Adressen, keine Zugangsdaten. ``storage_key`` ist eindeutig: Ein Objekt wird
    hoechstens einmal vorgemerkt.
    """

    __tablename__ = "storage_cleanup_jobs"
    __table_args__ = (
        UniqueConstraint("storage_key"),
        CheckConstraint("attempts >= 0", name="attempts_not_negative"),
    )

    storage_key: Mapped[str] = mapped_column(String(400), nullable=False)
    #: Warum das Objekt weg soll, etwa ``project_deleted``.
    reason: Mapped[str] = mapped_column(String(40), nullable=False)
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    #: Fehlerklasse und gekuerzte Meldung des letzten Versuchs.
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
