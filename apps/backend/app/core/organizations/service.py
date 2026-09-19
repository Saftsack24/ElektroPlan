"""Organisationsbezogene Dienste."""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import Organization, OrganizationModule

_SLUG_PATTERN = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    """Erzeugt einen URL-tauglichen Schluessel aus einem Betriebsnamen."""
    normalized = (
        value.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    )
    return _SLUG_PATTERN.sub("-", normalized).strip("-")[:80] or "betrieb"


def enabled_module_ids(session: Session, organization_id: uuid.UUID) -> frozenset[str]:
    """IDs der fuer eine Organisation aktivierten Module."""
    stmt = select(OrganizationModule.module_id).where(
        OrganizationModule.organization_id == organization_id,
        OrganizationModule.enabled.is_(True),
    )
    return frozenset(session.execute(stmt).scalars().all())


def sync_organization_modules(
    session: Session, organization_id: uuid.UUID, registry: ModuleRegistry
) -> int:
    """Aktiviert alle registrierten Module fuer eine Organisation.

    Im MVP sind alle Module aktiv; die Tabelle existiert, damit eine spaetere
    Deaktivierung keine Migration erfordert (docs/modules.md, Abschnitt 7).
    """
    existing = frozenset(
        session.execute(
            select(OrganizationModule.module_id).where(
                OrganizationModule.organization_id == organization_id
            )
        )
        .scalars()
        .all()
    )
    created = 0
    for module in registry.modules:
        if module.id in existing:
            continue
        session.add(
            OrganizationModule(organization_id=organization_id, module_id=module.id, enabled=True)
        )
        created += 1
    session.flush()
    return created


def get_organization(session: Session, organization_id: uuid.UUID) -> Organization | None:
    return session.get(Organization, organization_id)
