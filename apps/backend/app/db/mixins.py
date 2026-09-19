"""Wiederverwendbare Spalten-Mixins und Helfer fuer die Mandantentrennung.

``tenant_identity()`` und ``tenant_fk()`` setzen ADR 0006 um: Verweise laufen
ueber ``(organization_id, id)``, damit ein mandantenuebergreifender Verweis auf
Datenbankebene unmoeglich ist - nicht nur unerwuenscht.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint, Integer, UniqueConstraint, text
from sqlalchemy.orm import Mapped, declared_attr, mapped_column


def utcnow() -> datetime:
    """Aktueller Zeitpunkt in UTC (zeitzonenbewusst)."""
    return datetime.now(tz=UTC)


class UUIDPrimaryKey:
    """UUID-Primaerschluessel (ADR 0007)."""

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )


class Timestamped:
    """Anlage- und Aenderungszeitpunkt, immer UTC."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=text("now()"),
    )


class Versioned:
    """Optimistisches Sperren ueber eine Versionsspalte."""

    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )

    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, Any]:  # noqa: N805
        return {"version_id_col": cls.version}


class SoftDeletable:
    """Loeschkennzeichen fuer Geschaeftsdokumente.

    Ersetzt kein DSGVO-Loeschbegehren - dafuer existiert ein eigener
    Anonymisierungspfad (docs/security.md, Abschnitt 13).
    """

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class Authored:
    """Wer hat den Datensatz angelegt bzw. zuletzt geaendert."""

    @declared_attr
    @classmethod
    def created_by_user_id(cls) -> Mapped[uuid.UUID | None]:
        return mapped_column(
            ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
        )

    @declared_attr
    @classmethod
    def updated_by_user_id(cls) -> Mapped[uuid.UUID | None]:
        return mapped_column(
            ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
        )


class TenantScoped:
    """Mandantenbezug. Pflicht auf jeder mandantenbezogenen Tabelle (ADR 0006)."""

    @declared_attr
    @classmethod
    def organization_id(cls) -> Mapped[uuid.UUID]:
        return mapped_column(
            ForeignKey("organizations.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        )


def tenant_identity() -> UniqueConstraint:
    """``UNIQUE (organization_id, id)``.

    Voraussetzung dafuer, dass andere Tabellen ueber ``tenant_fk()`` auf diese
    Tabelle verweisen koennen.
    """
    return UniqueConstraint("organization_id", "id")


def tenant_fk(
    column: str,
    target_table: str,
    *,
    ondelete: str = "RESTRICT",
) -> ForeignKeyConstraint:
    """Zusammengesetzter Fremdschluessel ``(organization_id, <column>)``.

    Beispiel::

        __table_args__ = (
            tenant_identity(),
            tenant_fk("project_id", "projects"),
        )
    """
    return ForeignKeyConstraint(
        ["organization_id", column],
        [f"{target_table}.organization_id", f"{target_table}.id"],
        ondelete=ondelete,
    )
