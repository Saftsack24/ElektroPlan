"""Idempotenter Startbestand fuer Entwicklung und Erstinstallation.

Kein Migrationsschritt: Seeds sind wiederholbar ausfuehrbare Skripte
(docs/database.md, Abschnitt 8).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.auth.security import hash_password
from app.core.authorization.permissions import ADMIN_ROLE_KEY
from app.core.authorization.service import assign_role, ensure_system_roles, sync_permissions
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import (
    MEMBER_STATUS_ACTIVE,
    Organization,
    OrganizationMember,
)
from app.core.organizations.service import slugify, sync_organization_modules
from app.core.users.models import User
from app.logging_config import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class SeedResult:
    organization_id: uuid.UUID
    admin_user_id: uuid.UUID
    created_organization: bool
    created_admin: bool
    permissions_created: int


def seed_initial_data(
    session: Session,
    registry: ModuleRegistry,
    *,
    organization_name: str | None = None,
    admin_email: str | None = None,
    admin_password: str | None = None,
) -> SeedResult:
    """Legt Berechtigungen, eine Organisation, Systemrollen und ein Adminkonto an."""
    settings = get_settings()
    organization_name = organization_name or settings.seed_org_name
    admin_email = (admin_email or settings.seed_admin_email).strip().lower()
    admin_password = admin_password or settings.seed_admin_password

    if not admin_password:
        msg = (
            "Kein Seed-Passwort gesetzt. ELEKTROPLAN_SEED_ADMIN_PASSWORD angeben "
            "oder --password uebergeben."
        )
        raise ValueError(msg)

    permissions_created = sync_permissions(session, registry)

    slug = slugify(organization_name)
    organization = session.execute(
        select(Organization).where(Organization.slug == slug)
    ).scalar_one_or_none()
    created_organization = organization is None
    if organization is None:
        organization = Organization(name=organization_name, slug=slug)
        session.add(organization)
        session.flush()

    roles = ensure_system_roles(session, organization.id, registry)
    sync_organization_modules(session, organization.id, registry)

    user = session.execute(select(User).where(User.email == admin_email)).scalar_one_or_none()
    created_admin = user is None
    if user is None:
        user = User(
            email=admin_email,
            password_hash=hash_password(admin_password),
            full_name="Administrator",
        )
        session.add(user)
        session.flush()

    member = session.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.user_id == user.id,
        )
    ).scalar_one_or_none()
    if member is None:
        member = OrganizationMember(
            organization_id=organization.id,
            user_id=user.id,
            status=MEMBER_STATUS_ACTIVE,
        )
        session.add(member)
        session.flush()

    assign_role(
        session,
        organization_id=organization.id,
        member_id=member.id,
        role_id=roles[ADMIN_ROLE_KEY].id,
    )
    session.flush()

    logger.info(
        "seed_completed",
        organization=organization.slug,
        created_organization=created_organization,
        created_admin=created_admin,
        permissions_created=permissions_created,
    )
    return SeedResult(
        organization_id=organization.id,
        admin_user_id=user.id,
        created_organization=created_organization,
        created_admin=created_admin,
        permissions_created=permissions_created,
    )
