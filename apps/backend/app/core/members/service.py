"""Verwaltung der Mitgliedschaften eines Betriebs (Phase 4.2, ADR 0015).

**Globale Identitaet und Mitgliedschaft sind getrennt.** Ein Administrator
verwaltet ausschliesslich die Mitgliedschaft in *seinem* Betrieb: Status und
Rollen. Das globale Konto - E-Mail, Passwort, Name, ``is_active`` - fasst
dieser Dienst nie an. Eine Sperre wirkt deshalb nur in diesem Betrieb.

**Die Organisationszeile ist die Sperrwurzel.** Jede Aenderung an Status oder
Rollen einer Mitgliedschaft sperrt zuerst ``organizations`` (``SELECT ... FOR
UPDATE``), danach die Mitgliedschaft. Erst unter dieser Sperre werden der
Handelnde erneut geprueft und die Administratoren gezaehlt. Zwei gleichzeitige
Anfragen, die zusammen den letzten Administrator entfernen wuerden, laufen
dadurch nacheinander - die zweite zaehlt den Stand nach der ersten und wird
abgelehnt. Ein Zaehlen ohne Sperre genuegte nicht: Beide saehen noch zwei
Administratoren.

Sperrreihenfolge, ueberall dieselbe: ``Organisation -> Mitgliedschaft``.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import DateTime, Integer, String, and_, cast, func, literal, null, or_, select
from sqlalchemy.orm import Session

from app.core.auth.service import revoke_membership_sessions
from app.core.authorization.models import MemberRole, Permission, Role
from app.core.authorization.permissions import ADMIN_ROLE_KEY
from app.core.authorization.service import (
    permission_area,
    replace_member_roles,
    resolve_member_permissions,
    resolve_system_roles,
    role_permissions,
    roles_of_members,
)
from app.core.invitations.models import MemberInvitation
from app.core.invitations.service import roles_of_invitations
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import (
    MEMBER_STATUS_ACTIVE,
    MEMBER_STATUS_DISABLED,
    Organization,
    OrganizationMember,
)
from app.core.pagination import KeysetPage, build_keyset_page, decode_keyset_cursor
from app.core.persistence import flush
from app.core.preconditions import check_version
from app.core.users.models import User
from app.db.mixins import utcnow
from app.errors import (
    ConflictError,
    LastAdministratorError,
    NotFoundError,
    PermissionDeniedError,
    SelfLockoutError,
)

DirectoryStatus = Literal["active", "disabled", "invited"]


@dataclass(frozen=True, slots=True)
class Actor:
    """Wer handelt - aus dem geprueften Access Token."""

    user_id: uuid.UUID
    member_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class DirectoryEntry:
    """Ein Eintrag der Benutzerliste: Mitgliedschaft oder offene Einladung."""

    kind: Literal["member", "invitation"]
    id: uuid.UUID
    full_name: str | None
    email: str
    status: DirectoryStatus
    last_login_at: datetime | None
    invitation_expires_at: datetime | None
    version: int
    sort_key: str
    roles: list[Role]

    @property
    def invitation_expired(self) -> bool:
        return self.invitation_expires_at is not None and self.invitation_expires_at <= utcnow()


@dataclass(frozen=True, slots=True)
class MemberView:
    member: OrganizationMember
    user: User
    roles: list[Role]

    @property
    def is_administrator(self) -> bool:
        return any(role.key == ADMIN_ROLE_KEY for role in self.roles)


@dataclass(frozen=True, slots=True)
class EffectivePermission:
    key: str
    description: str
    area: str
    granted_by: list[Role]


@dataclass(frozen=True, slots=True)
class RoleChange:
    view: MemberView
    added: list[str]
    removed: list[str]


class MemberAdminService:
    """Mitgliedschaften eines Betriebs lesen und verwalten.

    Committet nicht selbst: Der Endpunkt schreibt das Protokoll in dieselbe
    Transaktion und committet danach.
    """

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id

    # ------------------------------------------------------------------ Liste

    def list_entries(
        self,
        *,
        limit: int,
        cursor: str | None = None,
        search: str | None = None,
        status: DirectoryStatus | None = None,
    ) -> KeysetPage[DirectoryEntry]:
        """Mitgliedschaften und offene Einladungen in **einer** sortierten Liste.

        Sortiert nach Anzeigename (ohne Gross-/Kleinschreibung), dann ID; der
        Cursor ist ein Keyset ueber genau diese beiden Werte. Beide Teile
        werden in der Datenbank vereinigt und begrenzt - es wird nichts in
        den Speicher geladen, um es dort zu sortieren. Rollen werden danach
        fuer die sichtbare Seite in je einer Abfrage nachgeladen.
        """
        parts: list[Any] = []
        if status in (None, "active", "disabled"):
            parts.append(self._member_part(search, status))
        if status in (None, "invited"):
            parts.append(self._invitation_part(search))
        combined = parts[0] if len(parts) == 1 else parts[0].union_all(parts[1])
        entries = combined.subquery("verzeichnis")

        stmt = select(entries)
        if cursor:
            key, last_id = decode_keyset_cursor(cursor)
            stmt = stmt.where(
                or_(
                    entries.c.sort_key > key,
                    and_(entries.c.sort_key == key, entries.c.id > last_id),
                )
            )
        stmt = stmt.order_by(entries.c.sort_key.asc(), entries.c.id.asc()).limit(limit + 1)
        rows = self.session.execute(stmt).mappings().all()

        member_ids = [row["id"] for row in rows if row["kind"] == "member"]
        invitation_ids = [row["id"] for row in rows if row["kind"] == "invitation"]
        member_roles = roles_of_members(self.session, member_ids)
        invitation_roles = roles_of_invitations(self.session, invitation_ids)

        result = [
            DirectoryEntry(
                kind=row["kind"],
                id=row["id"],
                full_name=row["full_name"],
                email=row["email"],
                status=row["status"],
                last_login_at=row["last_login_at"],
                invitation_expires_at=row["expires_at"],
                version=row["version"],
                sort_key=row["sort_key"],
                roles=(
                    member_roles.get(row["id"], [])
                    if row["kind"] == "member"
                    else invitation_roles.get(row["id"], [])
                ),
            )
            for row in rows
        ]
        return build_keyset_page(
            result, limit=limit, key_of=lambda entry: entry.sort_key, id_of=lambda entry: entry.id
        )

    def _member_part(self, search: str | None, status: DirectoryStatus | None) -> Any:
        stmt = (
            select(
                literal("member", String).label("kind"),
                OrganizationMember.id.label("id"),
                cast(User.full_name, String).label("full_name"),
                cast(User.email, String).label("email"),
                cast(OrganizationMember.status, String).label("status"),
                OrganizationMember.last_login_at.label("last_login_at"),
                cast(null(), DateTime(timezone=True)).label("expires_at"),
                cast(OrganizationMember.version, Integer).label("version"),
                func.lower(User.full_name).label("sort_key"),
            )
            .join(User, User.id == OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == self.organization_id)
        )
        if status is not None:
            stmt = stmt.where(OrganizationMember.status == status)
        if search:
            pattern = f"%{search.strip()}%"
            stmt = stmt.where(or_(User.full_name.ilike(pattern), User.email.ilike(pattern)))
        return stmt

    def _invitation_part(self, search: str | None) -> Any:
        display = func.coalesce(MemberInvitation.full_name, MemberInvitation.email)
        stmt = select(
            literal("invitation", String).label("kind"),
            MemberInvitation.id.label("id"),
            cast(MemberInvitation.full_name, String).label("full_name"),
            cast(MemberInvitation.email, String).label("email"),
            literal("invited", String).label("status"),
            cast(null(), DateTime(timezone=True)).label("last_login_at"),
            MemberInvitation.expires_at.label("expires_at"),
            cast(MemberInvitation.version, Integer).label("version"),
            func.lower(display).label("sort_key"),
        ).where(
            MemberInvitation.organization_id == self.organization_id,
            MemberInvitation.accepted_at.is_(None),
            MemberInvitation.revoked_at.is_(None),
        )
        if search:
            pattern = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    func.coalesce(MemberInvitation.full_name, "").ilike(pattern),
                    MemberInvitation.email.ilike(pattern),
                )
            )
        return stmt

    # ------------------------------------------------------------------ Lesen

    def get(self, member_id: uuid.UUID) -> MemberView:
        member, user = self._load(member_id, lock=False)
        return self._view(member, user)

    def effective_permissions(
        self, member_id: uuid.UUID, registry: ModuleRegistry
    ) -> tuple[MemberView, list[EffectivePermission]]:
        """Effektive Berechtigungen samt Herkunft.

        Liefert eine Berechtigung mehrere Rollen, stehen alle in
        ``granted_by``. Dieselbe Aufloesung wie
        :func:`resolve_member_permissions` - nur mit Herkunft.
        """
        view = self.get(member_id)
        by_role = role_permissions(self.session, [role.id for role in view.roles])
        collected: dict[str, tuple[Permission, list[Role]]] = {}
        for role in view.roles:
            for permission in by_role.get(role.id, []):
                entry = collected.setdefault(permission.key, (permission, []))
                entry[1].append(role)
        result = [
            EffectivePermission(
                key=permission.key,
                description=permission.description,
                area=permission_area(permission, registry),
                granted_by=roles,
            )
            for permission, roles in collected.values()
        ]
        result.sort(key=lambda item: (item.area, item.key))
        return view, result

    # ---------------------------------------------------------------- Aendern

    def suspend(
        self, member_id: uuid.UUID, *, expected_version: int, actor: Actor, permission: str
    ) -> MemberView:
        """Sperrt den Zugang zu **diesem** Betrieb.

        Das globale Konto bleibt aktiv; Mitgliedschaften und Sitzungen in
        anderen Betrieben bleiben unberuehrt. Offene Refresh Tokens dieser
        Mitgliedschaft werden widerrufen; ausgestellte Access Tokens scheitern
        ab sofort an der Mitgliedspruefung jeder Anfrage.
        """
        self._lock_organization()
        self._reverify_actor(actor, permission)
        member, user = self._load(member_id, lock=True)
        check_version(member, expected_version)
        if member.id == actor.member_id:
            raise SelfLockoutError(
                "Der eigene Zugang kann nicht gesperrt werden. Bitte einen anderen "
                "Administrator darum bitten."
            )
        if member.status == MEMBER_STATUS_DISABLED:
            raise ConflictError("Der Zugang dieses Mitglieds ist bereits gesperrt.")
        self._require_other_admin(member)
        member.status = MEMBER_STATUS_DISABLED
        flush(self.session)
        revoke_membership_sessions(
            self.session, user_id=member.user_id, organization_id=self.organization_id
        )
        return self._view(member, user)

    def reactivate(
        self, member_id: uuid.UUID, *, expected_version: int, actor: Actor, permission: str
    ) -> MemberView:
        """Gibt den Zugang zu diesem Betrieb wieder frei.

        Widerrufene Sitzungen bleiben widerrufen - das Mitglied meldet sich neu
        an.
        """
        self._lock_organization()
        self._reverify_actor(actor, permission)
        member, user = self._load(member_id, lock=True)
        check_version(member, expected_version)
        if member.status == MEMBER_STATUS_ACTIVE:
            raise ConflictError("Der Zugang dieses Mitglieds ist bereits aktiv.")
        member.status = MEMBER_STATUS_ACTIVE
        flush(self.session)
        return self._view(member, user)

    def replace_roles(
        self,
        member_id: uuid.UUID,
        role_keys: Sequence[str],
        *,
        expected_version: int,
        actor: Actor,
        permission: str,
    ) -> RoleChange:
        """Ersetzt die Rollen einer Mitgliedschaft atomar.

        Die Version der Mitgliedschaft zaehlt dabei weiter, auch wenn sich an
        der Zeile selbst nichts aendert: Die Rollen gehoeren zum verwaltbaren
        Zustand. Ohne wirksame Aenderung bleibt alles, wie es ist.
        """
        self._lock_organization()
        self._reverify_actor(actor, permission)
        member, user = self._load(member_id, lock=True)
        check_version(member, expected_version)
        new_roles = resolve_system_roles(self.session, self.organization_id, role_keys)
        current = roles_of_members(self.session, [member.id]).get(member.id, [])
        current_keys = {role.key for role in current}
        new_keys = {role.key for role in new_roles}
        if new_keys == current_keys:
            return RoleChange(self._view(member, user), added=[], removed=[])

        if ADMIN_ROLE_KEY in current_keys and ADMIN_ROLE_KEY not in new_keys:
            if member.id == actor.member_id:
                raise SelfLockoutError(
                    "Die eigene Administratorrolle kann hier nicht entfernt werden. Bitte "
                    "einen anderen Administrator darum bitten."
                )
            self._require_other_admin(member)

        replace_member_roles(
            self.session,
            organization_id=self.organization_id,
            member_id=member.id,
            roles=new_roles,
        )
        # Die Rollen gehoeren zur Mitgliedschaft: Die Version zaehlt weiter,
        # damit eine zweite geoeffnete Ansicht die Aenderung bemerkt.
        member.updated_at = utcnow()
        flush(self.session)
        return RoleChange(
            self._view(member, user),
            added=sorted(new_keys - current_keys),
            removed=sorted(current_keys - new_keys),
        )

    # ----------------------------------------------------------------- intern

    def _lock_organization(self) -> None:
        """Sperrwurzel aller Mitgliedschaftsaenderungen dieses Betriebs."""
        locked = self.session.execute(
            select(Organization.id).where(Organization.id == self.organization_id).with_for_update()
        ).first()
        if locked is None:  # pragma: no cover - durch die Anmeldung ausgeschlossen
            raise NotFoundError("Betrieb nicht gefunden.")

    def _reverify_actor(self, actor: Actor, permission: str) -> None:
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

    def _load(self, member_id: uuid.UUID, *, lock: bool) -> tuple[OrganizationMember, User]:
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
            stmt = stmt.with_for_update(of=OrganizationMember)
        row = self.session.execute(stmt).first()
        if row is None:
            raise NotFoundError("Mitglied wurde nicht gefunden.")
        return row[0], row[1]

    def _view(self, member: OrganizationMember, user: User) -> MemberView:
        roles = roles_of_members(self.session, [member.id]).get(member.id, [])
        return MemberView(member=member, user=user, roles=roles)

    def _active_admin_ids(self) -> set[uuid.UUID]:
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

    def _require_other_admin(self, member: OrganizationMember) -> None:
        """Nach der Aenderung muss mindestens ein aktiver Administrator bleiben."""
        admins = self._active_admin_ids()
        if member.id in admins and not (admins - {member.id}):
            raise LastAdministratorError(
                "Der Betrieb braucht mindestens einen aktiven Administrator. Bitte zuerst "
                "einem anderen Mitglied die Administratorrolle geben."
            )
