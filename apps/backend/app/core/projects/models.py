"""Projekte, Gebaeude und Geschosse.

Das Projekt ist die zentrale Core-Entitaet: Jedes Fachmodul haengt seine
Planungsdaten daran. Gebaeude und Geschosse gehoeren fachlich zum Projekt und
werden mit ihm gemeinsam bearbeitet.

Geometrie ist ganzzahlig in Millimetern (ADR 0007): ``elevation_mm`` ist die
Hoehenlage des Fertigfussbodens ueber dem Bezugspunkt des Gebaeudes,
``default_ceiling_height_mm`` die lichte Standardhoehe des Geschosses.
"""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import (
    Authored,
    SoftDeletable,
    TenantScoped,
    Timestamped,
    UUIDPrimaryKey,
    Versioned,
    tenant_fk,
    tenant_identity,
)

PROJECT_STATUS_DRAFT = "draft"
PROJECT_STATUS_ACTIVE = "active"
PROJECT_STATUS_COMPLETED = "completed"
PROJECT_STATUS_ARCHIVED = "archived"
PROJECT_STATUSES: tuple[str, ...] = (
    PROJECT_STATUS_DRAFT,
    PROJECT_STATUS_ACTIVE,
    PROJECT_STATUS_COMPLETED,
    PROJECT_STATUS_ARCHIVED,
)

#: Erlaubte Statuswechsel. Ein Wechsel ausserhalb dieser Tabelle ist ein
#: fachlicher Konflikt (409), kein Validierungsfehler.
PROJECT_STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    PROJECT_STATUS_DRAFT: frozenset({PROJECT_STATUS_ACTIVE, PROJECT_STATUS_ARCHIVED}),
    PROJECT_STATUS_ACTIVE: frozenset({PROJECT_STATUS_COMPLETED, PROJECT_STATUS_ARCHIVED}),
    PROJECT_STATUS_COMPLETED: frozenset({PROJECT_STATUS_ARCHIVED}),
    PROJECT_STATUS_ARCHIVED: frozenset(),
}


class Project(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, SoftDeletable, Authored, Base):
    """Ein Bauvorhaben eines Kunden."""

    __tablename__ = "projects"
    __table_args__ = (
        tenant_identity(),
        UniqueConstraint("organization_id", "project_number"),
        tenant_fk("customer_id", "customers"),
        CheckConstraint(
            "status IN ('draft', 'active', 'completed', 'archived')",
            name="status_known",
        ),
        Index("ix_projects_organization_id_customer_id", "organization_id", "customer_id"),
        Index("ix_projects_organization_id_status", "organization_id", "status"),
    )

    #: Verweis auf ``customers`` ueber den zusammengesetzten Fremdschluessel
    #: ``(organization_id, customer_id)`` - siehe ``__table_args__``.
    customer_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    project_number: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=PROJECT_STATUS_DRAFT, server_default=text("'draft'")
    )
    site_street: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)
    site_postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    site_city: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    site_country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="DE")


class Building(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Ein Bauwerk innerhalb eines Projekts."""

    __tablename__ = "buildings"
    __table_args__ = (
        tenant_identity(),
        tenant_fk("project_id", "projects", ondelete="CASCADE"),
        Index("ix_buildings_organization_id_project_id", "organization_id", "project_id"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Floor(UUIDPrimaryKey, TenantScoped, Timestamped, Versioned, Base):
    """Ein Geschoss eines Gebaeudes.

    ``level`` ist die uebliche Geschossnummer: ``0`` Erdgeschoss, ``-1``
    Untergeschoss, ``1`` erstes Obergeschoss. Sie ist je Gebaeude eindeutig -
    zwei Geschosse auf derselben Ebene waeren ein Erfassungsfehler.
    """

    __tablename__ = "floors"
    __table_args__ = (
        tenant_identity(),
        tenant_fk("building_id", "buildings", ondelete="CASCADE"),
        UniqueConstraint("building_id", "level"),
        Index("ix_floors_organization_id_building_id", "organization_id", "building_id"),
    )

    building_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Hoehenlage des Fertigfussbodens in Millimetern (ADR 0007).
    elevation_mm: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Lichte Standardhoehe in Millimetern.
    default_ceiling_height_mm: Mapped[int] = mapped_column(Integer, nullable=False, default=2500)
