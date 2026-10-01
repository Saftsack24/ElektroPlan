"""Kundenstamm.

Ab dieser Tabelle verarbeitet ElektroPlan **personenbezogene Daten**. Die
Feldliste ist deshalb bewusst kurz gehalten (Datenminimierung, Art. 5 Abs. 1
lit. c DSGVO); jedes Feld hat einen dokumentierten Zweck in
``docs/security.md``, Abschnitt 13. Es gibt keine Felder "fuer spaeter".

**Loeschen heisst seit Phase 4d physisch loeschen** (ADR 0020): Ein Kunde
ohne Projekte wird aus der operativen Datenbank entfernt. Die fruehere
Anonymisierung (``anonymized_at``) ist entfallen.

Ein Ausblenden (Soft Delete) gibt es seit Phase 4d nicht mehr; die Spalte
``deleted_at`` ist mit Migration ``0006`` entfallen.
"""

from __future__ import annotations

from sqlalchemy import CheckConstraint, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import (
    Authored,
    TenantScoped,
    Timestamped,
    UUIDPrimaryKey,
    Versioned,
    tenant_identity,
)

CUSTOMER_KIND_PRIVATE = "private"
CUSTOMER_KIND_COMPANY = "company"
CUSTOMER_KINDS: tuple[str, ...] = (CUSTOMER_KIND_PRIVATE, CUSTOMER_KIND_COMPANY)


class Customer(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Authored, Base):
    """Ein Auftraggeber des Betriebs."""

    __tablename__ = "customers"
    __table_args__ = (
        tenant_identity(),
        UniqueConstraint("organization_id", "customer_number"),
        CheckConstraint(
            "kind IN ('private', 'company')",
            name="kind_known",
        ),
    )

    #: Vom Nummernkreis vergeben, innerhalb des Betriebs eindeutig.
    customer_number: Mapped[str] = mapped_column(String(30), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default=CUSTOMER_KIND_PRIVATE)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, default=None)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True, default=None)
    billing_street: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    billing_postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    billing_city: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    billing_country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="DE")
