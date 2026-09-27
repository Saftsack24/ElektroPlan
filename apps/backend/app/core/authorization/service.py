"""Aufloesung und Pflege von Rollen und Berechtigungen."""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.authorization.models import MemberRole, Permission, Role, RolePermission
from app.core.authorization.permissions import (
    ADMIN_ROLE_KEY,
    CORE_PERMISSION_AREAS,
    SYSTEM_ROLE_KEYS,
    SYSTEM_ROLES,
)
from app.core.module_registry.registry import ModuleRegistry
from app.errors import ProblemFieldError, ValidationFailedError
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


def _role_permission_keys(registry: ModuleRegistry, role_key: str) -> tuple[str, ...]:
    """Welche Schluessel eines Moduls diese Systemrolle beim Seed erhaelt.

    Der Administrator bekommt **jede** registrierte Berechtigung - sonst
    verliert er mit jedem neuen Modul an Reichweite, obwohl seine Rolle
    "Vollzugriff" heisst. Die uebrigen Systemrollen erhalten genau die
    Schluessel, die das Modul ihnen in ``PermissionDef.default_roles``
    zuschreibt. Der Core kennt dabei keine Modulschluessel; er liest sie aus
    der Registry (ADR 0001).
    """
    if role_key == ADMIN_ROLE_KEY:
        return tuple(key for key, _, _ in registry.all_permissions())
    return tuple(
        permission.key
        for module in registry.modules
        for permission in module.permissions
        if role_key in permission.default_roles
    )


def ensure_system_roles(
    session: Session, organization_id: uuid.UUID, registry: ModuleRegistry
) -> dict[str, Role]:
    """Legt die ausgelieferten Systemrollen fuer eine Organisation an.

    Idempotent: bestehende Rollen werden aktualisiert, nicht dupliziert. Eine
    Rolle **verliert** dabei nie eine Berechtigung - es werden nur fehlende
    ergaenzt (siehe :func:`_assign_permissions`).
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
        _assign_permissions(
            session,
            role,
            (*template.permissions, *_role_permission_keys(registry, template.key)),
            permissions_by_key,
        )
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
    for key in dict.fromkeys(permission_keys):
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


# ------------------------------------------------- Systemrollen (Phase 4.2)


@dataclass(frozen=True, slots=True)
class PermissionView:
    """Eine Berechtigung, wie die Verwaltung sie zeigt."""

    key: str
    description: str
    area: str


def permission_area(permission: Permission, registry: ModuleRegistry) -> str:
    """Verstaendlicher Bereich einer Berechtigung.

    Core-Berechtigungen nach ihrem Namensraum, Modulberechtigungen nach dem
    Namen ihres Moduls. Der Core kennt dabei kein Modul (ADR 0001).
    """
    if permission.module_id == "core":
        namespace = permission.key.split(".", 1)[0]
        return CORE_PERMISSION_AREAS.get(namespace, "Weitere")
    if permission.module_id in registry:
        return registry.get(permission.module_id).name
    # Eine Berechtigung eines nicht mehr registrierten Moduls bleibt in der
    # Tabelle stehen (siehe :func:`sync_permissions`).
    return permission.module_id


def list_system_roles(session: Session, organization_id: uuid.UUID) -> list[Role]:
    """Die festen Systemrollen eines Betriebs in ausgelieferter Reihenfolge.

    Frei angelegte Rollen gibt es in dieser Phase nicht; eine Rolle ohne
    ``is_system`` wird hier bewusst nicht angeboten (ADR 0015).
    """
    roles = (
        session.execute(
            select(Role).where(Role.organization_id == organization_id, Role.is_system.is_(True))
        )
        .scalars()
        .all()
    )
    order = {key: index for index, key in enumerate(SYSTEM_ROLE_KEYS)}
    return sorted(roles, key=lambda role: (order.get(role.key, len(order)), role.key))


def resolve_system_roles(
    session: Session, organization_id: uuid.UUID, role_keys: Sequence[str]
) -> list[Role]:
    """Loest Rollenschluessel gegen die Systemrollen **dieses** Betriebs auf.

    Unbekannte Schluessel, doppelte Angaben und Rollen ohne ``is_system``
    werden abgelehnt (``422``). Ein Rollenschluessel eines anderen Betriebs
    kann gar nicht getroffen werden - die Abfrage ist mandantengefiltert.
    """
    keys = list(role_keys)
    if len(set(keys)) != len(keys):
        raise ValidationFailedError(
            "Jede Rolle darf nur einmal angegeben werden.",
            errors=[
                ProblemFieldError(
                    field="role_keys", code="duplicate_role", message="Rolle doppelt angegeben."
                )
            ],
        )
    by_key = {role.key: role for role in list_system_roles(session, organization_id)}
    unknown = [key for key in keys if key not in by_key]
    if unknown:
        raise ValidationFailedError(
            "Mindestens eine Rolle ist unbekannt oder nicht vergebbar.",
            errors=[
                ProblemFieldError(
                    field="role_keys",
                    code="unknown_role",
                    message="Nur die festen Systemrollen sind vergebbar.",
                )
            ],
        )
    return [by_key[key] for key in keys]


def role_permissions(
    session: Session, role_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[Permission]]:
    """Berechtigungen je Rolle - eine Abfrage fuer alle Rollen."""
    result: dict[uuid.UUID, list[Permission]] = defaultdict(list)
    if not role_ids:
        return result
    rows = session.execute(
        select(RolePermission.role_id, Permission)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(RolePermission.role_id.in_(role_ids))
        .order_by(Permission.key)
    ).all()
    for role_id, permission in rows:
        result[role_id].append(permission)
    return result


def roles_of_members(
    session: Session, member_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[Role]]:
    """Rollen mehrerer Mitgliedschaften - eine Abfrage statt N."""
    result: dict[uuid.UUID, list[Role]] = defaultdict(list)
    if not member_ids:
        return result
    rows = session.execute(
        select(MemberRole.member_id, Role)
        .join(Role, Role.id == MemberRole.role_id)
        .where(MemberRole.member_id.in_(member_ids))
    ).all()
    order = {key: index for index, key in enumerate(SYSTEM_ROLE_KEYS)}
    for member_id, role in rows:
        result[member_id].append(role)
    for roles in result.values():
        roles.sort(key=lambda role: (order.get(role.key, len(order)), role.key))
    return result


def replace_member_roles(
    session: Session,
    *,
    organization_id: uuid.UUID,
    member_id: uuid.UUID,
    roles: Sequence[Role],
) -> None:
    """Ersetzt die Rollen einer Mitgliedschaft als Ganzes.

    Loeschen und Einfuegen liegen in der Transaktion des Aufrufers; ein
    Zwischenstand ist fuer andere Transaktionen nie sichtbar.
    """
    session.execute(delete(MemberRole).where(MemberRole.member_id == member_id))
    for role in roles:
        session.add(
            MemberRole(organization_id=organization_id, member_id=member_id, role_id=role.id)
        )
    session.flush()
