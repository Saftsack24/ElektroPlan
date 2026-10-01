"""Gemeinsame Werkzeuge der Tests zur Benutzerverwaltung (Phase 4.2).

Ausschliesslich synthetische Personen und Adressen unter ``.example``.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from urllib.parse import urlsplit

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth.security import hash_password
from app.core.authorization.models import MemberRole, Permission, Role, RolePermission
from app.core.organizations.models import OrganizationMember
from app.core.users.models import User
from tests.conftest import ADMIN_PASSWORD

#: Schluessel der frei angelegten Testrollen. Sie existieren nur im Test:
#: Die Oberflaeche und die API vergeben ausschliesslich Systemrollen.
LESER_ROLLE = "test_leser"
VERWALTER_ROLLE = "test_verwalter"


@dataclass(frozen=True, slots=True)
class Person:
    user_id: uuid.UUID
    member_id: uuid.UUID
    email: str


def fabrik(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def rolle(session: Session, organization_id: uuid.UUID, key: str) -> Role:
    return session.execute(
        select(Role).where(Role.organization_id == organization_id, Role.key == key)
    ).scalar_one()


def eigene_rolle_anlegen(
    session: Session, organization_id: uuid.UUID, key: str, berechtigungen: Iterable[str]
) -> Role:
    """Eine **nicht** ausgelieferte Rolle - nur, um Rechtekombinationen zu pruefen."""
    neu = Role(
        organization_id=organization_id, key=key, name=key, description="Testrolle", is_system=False
    )
    session.add(neu)
    session.flush()
    for schluessel in berechtigungen:
        permission = session.execute(
            select(Permission).where(Permission.key == schluessel)
        ).scalar_one()
        session.add(RolePermission(role_id=neu.id, permission_id=permission.id))
    session.flush()
    return neu


def person_anlegen(
    engine: Engine,
    organization_id: uuid.UUID,
    email: str,
    rollen: Iterable[str],
    *,
    status: str = "active",
    name: str | None = None,
    passwort: str = ADMIN_PASSWORD,
) -> Person:
    """Legt Konto (falls noetig), Mitgliedschaft und Rollen an und committet."""
    session = fabrik(engine)()
    try:
        user = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            user = User(
                email=email,
                password_hash=hash_password(passwort),
                full_name=name or email.split("@")[0].title(),
            )
            session.add(user)
            session.flush()
        member = OrganizationMember(organization_id=organization_id, user_id=user.id, status=status)
        session.add(member)
        session.flush()
        for key in rollen:
            session.add(
                MemberRole(
                    organization_id=organization_id,
                    member_id=member.id,
                    role_id=rolle(session, organization_id, key).id,
                )
            )
        session.commit()
        return Person(user_id=user.id, member_id=member.id, email=email)
    finally:
        session.close()


def rollen_fuer_tests_anlegen(engine: Engine, organization_id: uuid.UUID) -> None:
    """``test_leser``: nur lesen. ``test_verwalter``: verwalten, aber kein Administrator."""
    session = fabrik(engine)()
    try:
        eigene_rolle_anlegen(
            session,
            organization_id,
            LESER_ROLLE,
            ("user.account.read", "role.assignment.read"),
        )
        eigene_rolle_anlegen(
            session,
            organization_id,
            VERWALTER_ROLLE,
            (
                "user.account.read",
                "user.account.write",
                # Seit Phase 4e ein eigenes Recht fuer Sperren und Entsperren.
                "user.account.lock",
                "role.assignment.read",
                "role.assignment.write",
            ),
        )
        session.commit()
    finally:
        session.close()


def admin_mitglied(engine: Engine, organization_id: uuid.UUID, email: str) -> Person:
    session = fabrik(engine)()
    try:
        row = session.execute(
            select(User.id, OrganizationMember.id)
            .join(OrganizationMember, OrganizationMember.user_id == User.id)
            .where(User.email == email, OrganizationMember.organization_id == organization_id)
        ).one()
        return Person(user_id=row[0], member_id=row[1], email=email)
    finally:
        session.close()


def token_aus_link(link: str) -> str:
    """Liest das Token aus dem Fragment eines Aktivierungslinks."""
    fragment = urlsplit(link).fragment
    assert fragment.startswith("t="), link
    return fragment[2:]
