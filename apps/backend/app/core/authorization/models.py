"""Rollen und Berechtigungen.

Autorisiert wird ueber Permissions, nicht ueber Rollennamen. Rollen sind Daten
pro Organisation (docs/architecture.md, Abschnitt 9).
"""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TenantScoped, Timestamped, UUIDPrimaryKey, tenant_fk, tenant_identity


class Permission(UUIDPrimaryKey, Timestamped, Base):
    """Eine Berechtigung, registriert von einem Modul.

    Global, nicht mandantenbezogen: Der Schluesselraum ist fuer alle
    Organisationen derselbe.
    """

    __tablename__ = "permissions"
    __table_args__ = (UniqueConstraint("key"),)

    key: Mapped[str] = mapped_column(String(120), nullable=False)
    module_id: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class Role(UUIDPrimaryKey, TenantScoped, Timestamped, Base):
    """Rollenbuendel pro Organisation."""

    __tablename__ = "roles"
    __table_args__ = (
        tenant_identity(),
        UniqueConstraint("organization_id", "key"),
    )

    key: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )


class RolePermission(Base):
    """Zuordnung Rolle -> Berechtigung."""

    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )


class MemberRole(TenantScoped, Base):
    """Zuordnung Mitgliedschaft -> Rolle.

    Der zusammengesetzte Fremdschluessel stellt sicher, dass Mitgliedschaft und
    Rolle zur selben Organisation gehoeren (ADR 0006).
    """

    __tablename__ = "member_roles"
    __table_args__ = (
        tenant_fk("member_id", "organization_members", ondelete="CASCADE"),
        tenant_fk("role_id", "roles", ondelete="CASCADE"),
    )

    member_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    role_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
