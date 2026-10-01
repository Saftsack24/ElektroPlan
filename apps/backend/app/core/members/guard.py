"""Gemeinsame Sperr- und Pruefregeln aller Verwaltungsvorgaenge eines Betriebs.

**Die Organisationszeile ist die Sperrwurzel** (ADR 0015, ADR 0021). Jeder
Vorgang, der Status, Rollen, Profil, Passwort oder Bestand einer
Mitgliedschaft aendert, haelt dieselbe Reihenfolge ein::

    organizations -> organization_members -> users -> password_reset_tokens

Erst unter der Organisationssperre werden der Handelnde erneut geprueft und
die aktiven Administratoren gezaehlt.

**``FOR NO KEY UPDATE``, nicht ``FOR UPDATE``** (``key_share=True``). Die Sperren
serialisieren die Verwaltungsvorgaenge untereinander genauso, blockieren aber
keine Fremdschluesselpruefung (``FOR KEY SHARE``). Sonst entstuende ein
Deadlock: Eine Sitzungserneuerung haelt ihre Refresh-Token-Zeile und legt einen
Nachfolger an, dessen Fremdschluessel auf Organisation und Konto zeigt -
waehrend eine Sperre die Organisation haelt und auf genau diese
Refresh-Token-Zeile wartet (nachgewiesen in
``tests/test_lifecycle_concurrency.py``). Kein Vorgang aendert dabei einen
Primaerschluessel. Kein Pfad haelt eine spaetere Zeile und
wartet danach auf eine fruehere - deshalb entsteht kein Deadlock. Die
oeffentliche Einloesung eines Reset-Links beginnt ohne Organisationssperre
bei der Mitgliedschaft und folgt ab dort derselben Reihenfolge.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.authorization.models import MemberRole, Role
from app.core.authorization.permissions import ADMIN_ROLE_KEY
from app.core.authorization.service import resolve_member_permissions
from app.core.organizations.models import (
    MEMBER_STATUS_ACTIVE,
    MEMBER_STATUS_REMOVED,
    Organization,
    OrganizationMember,
)
from app.core.users.models import User
from app.errors import (
    AccountSharedError,
    LastAdministratorError,
    MemberRemovedError,
    NotFoundError,
    PermissionDeniedError,
)


@dataclass(frozen=True, slots=True)
class Actor:
    """Wer handelt - aus dem geprueften Access Token."""

    user_id: uuid.UUID
    member_id: uuid.UUID


def account_is_exclusive(
    session: Session, *, user_id: uuid.UUID, organization_id: uuid.UUID
) -> bool:
    """Gehoert das Konto ausser diesem Betrieb keinem anderen (nicht entfernt) an?

    Nur dann darf ein Betriebsadministrator Name, E-Mail und Passwort des
    globalen Kontos aendern oder es beim Entfernen bereinigen (ADR 0021,
    Praezisierung von ADR 0015). Entfernte Mitgliedschaften anderer Betriebe
    zaehlen nicht - sie sind Tombstones ohne Zugang.
    """
    other = session.execute(
        select(OrganizationMember.id)
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id != organization_id,
            OrganizationMember.status != MEMBER_STATUS_REMOVED,
        )
        .limit(1)
    ).first()
    return other is None


class MembershipGuard:
    """Sperrwurzel, Handelndenpruefung und Administratorregel eines Betriebs."""

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id

    def lock_organization(self) -> None:
        """Sperrwurzel aller Mitgliedschaftsaenderungen dieses Betriebs."""
        locked = self.session.execute(
            select(Organization.id)
            .where(Organization.id == self.organization_id)
            .with_for_update(key_share=True)
        ).first()
        if locked is None:  # pragma: no cover - durch die Anmeldung ausgeschlossen
            raise NotFoundError("Betrieb nicht gefunden.")

    def reverify_actor(self, actor: Actor, permission: str) -> None:
        """Prueft den Handelnden **unter der Sperre** erneut.

        Die Pruefung der Anfrage lief vor der Sperre. Hat eine gleichzeitige
        Anfrage dem Handelnden inzwischen Zugang oder Recht entzogen, darf er
        nicht mehr verwalten - sonst liesse sich eine eben entzogene
        Berechtigung noch einmal nutzen.
        """
        row = self.session.execute(
            select(OrganizationMember.status, User.is_active)
            .join(User, User.id == OrganizationMember.user_id)
            .where(
                OrganizationMember.id == actor.member_id,
                OrganizationMember.organization_id == self.organization_id,
            )
            .execution_options(populate_existing=True)
        ).first()
        if row is None or row.status != MEMBER_STATUS_ACTIVE or not row.is_active:
            raise PermissionDeniedError("Die eigene Mitgliedschaft ist nicht mehr aktiv.")
        if permission not in resolve_member_permissions(self.session, actor.member_id):
            raise PermissionDeniedError(f"Fuer diese Aktion fehlt die Berechtigung {permission!r}.")

    def load(self, member_id: uuid.UUID, *, lock: bool) -> tuple[OrganizationMember, User]:
        """Mitgliedschaft dieses Betriebs samt Konto; fremd oder unbekannt -> ``404``."""
        stmt = (
            select(OrganizationMember, User)
            .join(User, User.id == OrganizationMember.user_id)
            .where(
                OrganizationMember.id == member_id,
                OrganizationMember.organization_id == self.organization_id,
            )
            .execution_options(populate_existing=True)
        )
        if lock:
            stmt = stmt.with_for_update(of=OrganizationMember, key_share=True)
        row = self.session.execute(stmt).first()
        if row is None:
            raise NotFoundError("Mitglied wurde nicht gefunden.")
        return row[0], row[1]

    def lock_user(self, user_id: uuid.UUID) -> User:
        """Sperrt die Kontozeile - immer **nach** der Mitgliedschaft.

        Serialisiert Profilaenderung, Entfernen und Passwortwechsel desselben
        Kontos und die Annahme einer Einladung mit diesem Konto (die ein Konto
        erst zu einem geteilten macht).
        """
        user = self.session.execute(
            select(User)
            .where(User.id == user_id)
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if user is None:  # pragma: no cover - Fremdschluessel
            raise NotFoundError("Mitglied wurde nicht gefunden.")
        return user

    def require_exclusive_account(self, user_id: uuid.UUID) -> None:
        if not account_is_exclusive(
            self.session, user_id=user_id, organization_id=self.organization_id
        ):
            raise AccountSharedError(
                "Dieses Konto wird auch in einem anderen Betrieb verwendet. Name, E-Mail-Adresse "
                "und Passwort kann deshalb nur die Person selbst aendern."
            )

    def active_admin_ids(self) -> set[uuid.UUID]:
        """Aktive Administratoren: aktive Mitgliedschaft, aktives Konto, Rolle ``admin``."""
        stmt = (
            select(OrganizationMember.id)
            .join(MemberRole, MemberRole.member_id == OrganizationMember.id)
            .join(Role, Role.id == MemberRole.role_id)
            .join(User, User.id == OrganizationMember.user_id)
            .where(
                OrganizationMember.organization_id == self.organization_id,
                OrganizationMember.status == MEMBER_STATUS_ACTIVE,
                Role.key == ADMIN_ROLE_KEY,
                User.is_active.is_(True),
            )
        )
        return set(self.session.execute(stmt).scalars().all())

    def require_other_admin(self, member: OrganizationMember) -> None:
        """Nach der Aenderung muss mindestens ein aktiver Administrator bleiben."""
        admins = self.active_admin_ids()
        if member.id in admins and not (admins - {member.id}):
            raise LastAdministratorError(
                "Der Betrieb braucht mindestens einen aktiven Administrator. Bitte zuerst "
                "einem anderen Mitglied die Administratorrolle geben."
            )


def require_not_removed(member: OrganizationMember) -> None:
    """Ein entferntes Konto ist endgueltig - keine Aktion mehr (ADR 0021)."""
    if member.status == MEMBER_STATUS_REMOVED:
        raise MemberRemovedError(
            "Dieses Konto wurde entfernt. Es kann nicht mehr bearbeitet oder reaktiviert werden."
        )
