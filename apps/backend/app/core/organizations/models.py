"""Organisationen (Mandanten), Mitgliedschaften und Modulaktivierung."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Numeric, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import SoftDeletable, TenantScoped, Timestamped, UUIDPrimaryKey, tenant_identity

MEMBER_STATUS_ACTIVE = "active"
MEMBER_STATUS_INVITED = "invited"
MEMBER_STATUS_DISABLED = "disabled"
MEMBER_STATUSES = (MEMBER_STATUS_ACTIVE, MEMBER_STATUS_INVITED, MEMBER_STATUS_DISABLED)


class Organization(UUIDPrimaryKey, Timestamped, SoftDeletable, Base):
    """Ein Elektrofachbetrieb. Zentrale Einheit der Mandantentrennung."""

    __tablename__ = "organizations"
    __table_args__ = (UniqueConstraint("slug"),)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    street: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="DE")
    default_tax_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("19.00")
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")


class OrganizationMember(UUIDPrimaryKey, TenantScoped, Timestamped, Base):
    """Zugehoerigkeit einer Person zu einem Betrieb (ADR 0006).

    Benutzer sind global; Rollen haengen an dieser Mitgliedschaft, nicht am
    Benutzer. Damit ist Mehrfachmitgliedschaft ohne Migration moeglich.
    """

    __tablename__ = "organization_members"
    __table_args__ = (
        tenant_identity(),
        UniqueConstraint("organization_id", "user_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=MEMBER_STATUS_ACTIVE)

    @property
    def is_active(self) -> bool:
        return self.status == MEMBER_STATUS_ACTIVE


class OrganizationModule(Timestamped, Base):
    """Aktivierung eines Moduls fuer eine Organisation.

    Im MVP sind alle registrierten Module aktiv. Keine Lizenz- oder
    Abrechnungslogik (docs/modules.md, Abschnitt 7).
    """

    __tablename__ = "organization_modules"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    module_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
