"""Sammelimport aller ORM-Modelle.

Alembic-Autogenerate und die Testinfrastruktur brauchen eine Stelle, an der
alle Modelle bekannt sind. Neue Module tragen sich hier ein.

Dieses Modul liegt bewusst **oberhalb** aller Schichten (wie ``app.main``):
Es kennt Core und Module, damit die Datenbankschicht selbst keine Fachlogik
importieren muss (ADR 0001).
"""

from __future__ import annotations

from app.core.audit.models import AuditEntry
from app.core.auth.models import RefreshToken
from app.core.authorization.models import MemberRole, Permission, Role, RolePermission
from app.core.events.models import DomainEventRecord
from app.core.files.models import FileRecord
from app.core.numbering.models import NumberSequence
from app.core.organizations.models import Organization, OrganizationMember, OrganizationModule
from app.core.users.models import User
from app.db.base import Base, metadata

__all__ = [
    "AuditEntry",
    "Base",
    "DomainEventRecord",
    "FileRecord",
    "MemberRole",
    "NumberSequence",
    "Organization",
    "OrganizationMember",
    "OrganizationModule",
    "Permission",
    "RefreshToken",
    "Role",
    "RolePermission",
    "User",
    "metadata",
]
