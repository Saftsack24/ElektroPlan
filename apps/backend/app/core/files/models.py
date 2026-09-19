"""Dateimetadaten. Der Inhalt liegt im Object Storage (ADR 0002)."""

from __future__ import annotations

import uuid

from sqlalchemy import BigInteger, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import Authored, TenantScoped, Timestamped, UUIDPrimaryKey, tenant_identity


class FileRecord(UUIDPrimaryKey, TenantScoped, Timestamped, Authored, Base):
    """Eine hochgeladene Datei.

    Der Speicherschluessel wird serverseitig erzeugt; der urspruengliche
    Dateiname wird nie als Pfad verwendet (docs/security.md, Abschnitt 7).
    """

    __tablename__ = "files"
    __table_args__ = (
        tenant_identity(),
        UniqueConstraint("storage_key"),
    )

    storage_key: Mapped[str] = mapped_column(String(400), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    #: Generische Verknuepfung zu einer Fachentitaet (ohne Fremdschluessel,
    #: damit Module ihre Interna nicht offenlegen muessen).
    entity_type: Mapped[str | None] = mapped_column(String(60), nullable=True, default=None)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, default=None)
