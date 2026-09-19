"""Aufloesung und Pflege von Rollen und Berechtigungen."""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.authorization.models import MemberRole, Permission, Role, RolePermission
from app.core.authorization.permissions import SYSTEM_ROLES
from app.core.module_registry.registry import ModuleRegistry
from app.logging_config import get_logger

logger = get_logger(__name__)


def resolve_member_permissions(session: Session, member_id: uuid.UUID) -> frozenset[str]:
    """Alle Permission-Schluessel einer Mitgliedschaft.

    Wird pro Request geladen - kein Cache ueber Requests hinaus, damit ein
    Rechteentzug sofort wirkt (docs/security.md, Abschnitt 4).
    """
    stmt = (
        select(Permission.key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(MemberRole, MemberRole.role_id == RolePermission.role_id)
        .where(MemberRole.member_id == member_id)
    )
    return frozenset(session.execute(stmt).scalars().all())


def list_member_roles(session: Session, member_id: uuid.UUID) -> Sequence[Role]:
    """Rollen einer Mitgliedschaft."""
    stmt = (
        select(Role)
        .join(MemberRole, MemberRole.role_id == Role.id)
        .where(MemberRole.member_id == member_id)
        .order_by(Role.name)
    )
    return session.execute(stmt).scalars().all()


def sync_permissions(session: Session, registry: ModuleRegistry) -> int:
    """Gleicht die Permission-Tabelle mit der Module Registry ab.

    Neue Permissions werden angelegt, Beschreibungen aktualisiert. Entfernte
    Permissions bleiben bestehen - sie koennen noch in Rollen referenziert sein
    und werden bewusst nur manuell entfernt.
    """
    existing = {
        permission.key: permission
        for permission in session.execute(select(Permission)).scalars().all()
    }
    created = 0
    for key, module_id, description in registry.all_permissions():
        permission = existing.get(key)
        if permission is None:
            session.add(Permission(key=key, module_id=module_id, description=description))
            created += 1
        else:
            permission.module_id = module_id
            permission.description = description
    session.flush()
    if created:
        logger.info("permissions_synced", created=created)
    return created


def ensure_system_roles(session: Session, organization_id: uuid.UUID) -> dict[str, Role]:
    """Legt die ausgelieferten Systemrollen fuer eine Organisation an.

    Idempotent: bestehende Rollen werden aktualisiert, nicht dupliziert.
    """
    permissions_by_key = {
        permission.key: permission
        for permission in session.execute(select(Permission)).scalars().all()
    }
    existing_roles = {
        role.key: role
        for role in session.execute(select(Role).where(Role.organization_id == organization_id))
        .scalars()
        .all()
    }

    result: dict[str, Role] = {}
    for template in SYSTEM_ROLES:
        role = existing_roles.get(template.key)
        if role is None:
            role = Role(
                organization_id=organization_id,
                key=template.key,
                name=template.name,
                description=template.description,
                is_system=True,
            )
            session.add(role)
            session.flush()
        else:
            role.name = template.name
            role.description = template.description
        _assign_permissions(session, role, template.permissions, permissions_by_key)
        result[template.key] = role
    session.flush()
    return result


def _assign_permissions(
    session: Session,
    role: Role,
    permission_keys: Iterable[str],
    permissions_by_key: dict[str, Permission],
) -> None:
    current = set(
        session.execute(
            select(RolePermission.permission_id).where(RolePermission.role_id == role.id)
        )
        .scalars()
        .all()
    )
    for key in permission_keys:
        permission = permissions_by_key.get(key)
        if permission is None:
            logger.warning("unknown_permission_in_system_role", role=role.key, permission=key)
            continue
        if permission.id not in current:
            session.add(RolePermission(role_id=role.id, permission_id=permission.id))


def assign_role(
    session: Session,
    *,
    organization_id: uuid.UUID,
    member_id: uuid.UUID,
    role_id: uuid.UUID,
) -> None:
    """Weist einer Mitgliedschaft eine Rolle zu (idempotent)."""
    existing = session.execute(
        select(MemberRole).where(MemberRole.member_id == member_id, MemberRole.role_id == role_id)
    ).scalar_one_or_none()
    if existing is None:
        session.add(
            MemberRole(organization_id=organization_id, member_id=member_id, role_id=role_id)
        )
        session.flush()
