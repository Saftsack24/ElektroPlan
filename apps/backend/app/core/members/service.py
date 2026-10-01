"""Verwaltung der Mitgliedschaften eines Betriebs (Phase 4.2 und 4e).

**Globale Identitaet und Mitgliedschaft sind getrennt** (ADR 0015). Ein
Administrator verwaltet die Mitgliedschaft in *seinem* Betrieb: Status und
Rollen. Seit Phase 4e (ADR 0021) zusaetzlich Name und E-Mail des Kontos - aber
**nur**, wenn das Konto keinem anderen Betrieb angehoert. Ein geteiltes Konto
gehoert nicht ihm allein und bleibt unberuehrt (``409 account-shared``).

**Zustaende** (``organization_members.status``)::

    active  --sperren-->   disabled
    disabled --entsperren--> active
    active | disabled --entfernen--> removed   (endgueltig)

"Einladung ausstehend" ist keine Mitgliedschaft, sondern eine Einladung.

**Die Organisationszeile ist die Sperrwurzel** - fuer jeden Schreibweg
dieselbe Reihenfolge ``Organisation -> Mitgliedschaft -> Konto``
(:mod:`app.core.members.guard`). Unter der Sperre werden der Handelnde erneut
geprueft und die Administratoren gezaehlt; zwei Anfragen, die zusammen den
letzten aktiven Administrator sperren, entmachten oder entfernen wuerden,
laufen nacheinander, und die zweite wird abgelehnt.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import (
    DateTime,
    Integer,
    String,
    and_,
    cast,
    delete,
    false,
    func,
    literal,
    null,
    or_,
    select,
)
from sqlalchemy.orm import Session

from app.core.auth.models import RefreshTokenRevocationReason
from app.core.auth.service import (
    bump_session_version,
    normalize_email,
    revoke_membership_sessions,
    revoke_user_sessions,
)
from app.core.authorization.models import MemberRole, Permission, Role
from app.core.authorization.permissions import ADMIN_ROLE_KEY
from app.core.authorization.service import (
    permission_area,
    replace_member_roles,
    resolve_system_roles,
    role_permissions,
    roles_of_members,
)
from app.core.invitations.models import MemberInvitation
from app.core.invitations.service import USERS_EMAIL_CONSTRAINT, roles_of_invitations
from app.core.members.guard import (
    Actor,
    MembershipGuard,
    account_is_exclusive,
    require_not_removed,
)
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import (
    MEMBER_STATUS_ACTIVE,
    MEMBER_STATUS_DISABLED,
    MEMBER_STATUS_REMOVED,
    OrganizationMember,
)
from app.core.pagination import KeysetPage, build_keyset_page, decode_keyset_cursor
from app.core.password_reset.models import PasswordResetToken
from app.core.persistence import flush, unique_violation_translated
from app.core.preconditions import check_version
from app.core.preferences.models import UserPreferences
from app.core.users.models import User
from app.db.mixins import utcnow
from app.errors import (
    ConflictError,
    EmailUnavailableError,
    ProblemFieldError,
    SelfLockoutError,
    ValidationFailedError,
)

__all__ = [
    "Actor",
    "DirectoryEntry",
    "DirectoryStatus",
    "MemberAdminService",
    "MemberView",
    "ProfileChange",
    "Removal",
    "RoleChange",
]

DirectoryStatus = Literal["active", "disabled", "invited", "removed"]

#: Anzeigename eines entfernten Kontos - neutral, ohne Bezug zur Person.
REMOVED_DISPLAY_NAME = "Entfernter Benutzer"
#: Platzhalter der E-Mail eines bereinigten Kontos. Die Domain ``.invalid`` ist
#: reserviert (RFC 2606) und nie zustellbar; die Konto-ID macht sie eindeutig,
#: ohne etwas ueber die Person zu verraten.
REMOVED_EMAIL_DOMAIN = "removed.invalid"
#: Kein Argon2-Hash: Jede Passwortpruefung schlaegt fehl (``InvalidHashError``).
REMOVED_PASSWORD_HASH = "!removed"  # noqa: S105 - Sperrmarker, kein Passwort

_EMAIL_UNAVAILABLE = (
    "Diese E-Mail-Adresse ist bereits einem anderen Konto oder einer offenen Einladung "
    "zugeordnet. Bitte eine andere Adresse verwenden."
)


def removed_email(user_id: uuid.UUID) -> str:
    return f"removed-{user_id.hex}@{REMOVED_EMAIL_DOMAIN}"


@dataclass(frozen=True, slots=True)
class DirectoryEntry:
    """Ein Eintrag der Benutzerliste: Mitgliedschaft oder offene Einladung."""

    kind: Literal["member", "invitation"]
    id: uuid.UUID
    #: Bei entfernten Mitgliedschaften ``None`` - die Liste zeigt sie neutral.
    full_name: str | None
    email: str | None
    status: DirectoryStatus
    last_login_at: datetime | None
    invitation_expires_at: datetime | None
    created_at: datetime
    updated_at: datetime
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
    #: Gehoert das Konto noch einem anderen Betrieb an? Dann sind Name, E-Mail
    #: und Passwort hier nicht aenderbar.
    account_shared: bool
    #: Einziger aktiver Administrator des Betriebs - sperren, entfernen und
    #: Entzug der Administratorrolle sind dann ausgeschlossen.
    last_active_administrator: bool

    @property
    def is_administrator(self) -> bool:
        return any(role.key == ADMIN_ROLE_KEY for role in self.roles)

    @property
    def is_removed(self) -> bool:
        return self.member.status == MEMBER_STATUS_REMOVED


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


@dataclass(frozen=True, slots=True)
class ProfileChange:
    view: MemberView
    #: Namen der geaenderten Felder - nie deren Werte.
    changed: list[str]


@dataclass(frozen=True, slots=True)
class Removal:
    view: MemberView
    #: Wurden Name und E-Mail des Kontos bereinigt (Konto gehoerte nur diesem
    #: Betrieb)? Sonst bleibt das Konto fuer den anderen Betrieb bestehen.
    account_tombstoned: bool


class MemberAdminService:
    """Mitgliedschaften eines Betriebs lesen und verwalten.

    Committet nicht selbst: Der Endpunkt schreibt das Protokoll in dieselbe
    Transaktion und committet danach.
    """

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.guard = MembershipGuard(session, organization_id)

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

        Ohne Filter erscheinen aktive und gesperrte Mitglieder sowie offene
        Einladungen; entfernte Konten nur ueber ``status=removed`` - neutral,
        ohne Name und E-Mail, sortiert nach ID.

        Sortiert nach Anzeigename (ohne Gross-/Kleinschreibung), dann ID; der
        Cursor ist ein Keyset ueber genau diese beiden Werte. Beide Teile
        werden in der Datenbank vereinigt und begrenzt. Rollen werden danach
        fuer die sichtbare Seite in je einer Abfrage nachgeladen.
        """
        parts: list[Any] = []
        if status in (None, "active", "disabled"):
            parts.append(self._member_part(search, status))
        if status == "removed":
            parts.append(self._removed_part(search))
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
                created_at=row["created_at"],
                updated_at=row["updated_at"],
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
                OrganizationMember.created_at.label("created_at"),
                OrganizationMember.updated_at.label("updated_at"),
                cast(OrganizationMember.version, Integer).label("version"),
                func.lower(User.full_name).label("sort_key"),
            )
            .join(User, User.id == OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == self.organization_id)
        )
        if status is not None:
            stmt = stmt.where(OrganizationMember.status == status)
        else:
            stmt = stmt.where(
                OrganizationMember.status.in_((MEMBER_STATUS_ACTIVE, MEMBER_STATUS_DISABLED))
            )
        if search:
            pattern = f"%{search.strip()}%"
            stmt = stmt.where(or_(User.full_name.ilike(pattern), User.email.ilike(pattern)))
        return stmt

    def _removed_part(self, search: str | None) -> Any:
        """Entfernte Konten - **ohne** Name, E-Mail und Sortierung nach Name.

        Auch der Sortierschluessel (und damit der Cursor) enthaelt nichts von
        der Person. Eine Suche nach Name oder E-Mail findet entfernte Konten
        bewusst nicht.
        """
        stmt = select(
            literal("member", String).label("kind"),
            OrganizationMember.id.label("id"),
            cast(null(), String).label("full_name"),
            cast(null(), String).label("email"),
            cast(OrganizationMember.status, String).label("status"),
            cast(null(), DateTime(timezone=True)).label("last_login_at"),
            cast(null(), DateTime(timezone=True)).label("expires_at"),
            OrganizationMember.created_at.label("created_at"),
            OrganizationMember.updated_at.label("updated_at"),
            cast(OrganizationMember.version, Integer).label("version"),
            literal("", String).label("sort_key"),
        ).where(
            OrganizationMember.organization_id == self.organization_id,
            OrganizationMember.status == MEMBER_STATUS_REMOVED,
        )
        if search and search.strip():
            stmt = stmt.where(false())
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
            MemberInvitation.created_at.label("created_at"),
            MemberInvitation.updated_at.label("updated_at"),
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
        member, user = self.guard.load(member_id, lock=False)
        return self._view(member, user)

    def effective_permissions(
        self, member_id: uuid.UUID, registry: ModuleRegistry
    ) -> tuple[MemberView, list[EffectivePermission]]:
        """Effektive Berechtigungen samt Herkunft.

        Liefert eine Berechtigung mehrere Rollen, stehen alle in
        ``granted_by``. Dieselbe Aufloesung wie die Pruefung jeder Anfrage -
        nur mit Herkunft.
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
        self,
        member_id: uuid.UUID,
        *,
        expected_version: int,
        actor: Actor,
        permission: str,
        reason: str | None = None,
    ) -> MemberView:
        """Sperrt den Zugang zu **diesem** Betrieb.

        Das globale Konto bleibt bestehen; Rollen, Einstellungen und
        Bearbeiterreferenzen bleiben erhalten. Offene Refresh Tokens dieser
        Mitgliedschaft werden widerrufen, und die Sitzungsversion zaehlt hoch:
        Jedes bereits ausgestellte Token - Access wie Refresh, auch eines aus
        einer gleichzeitigen Erneuerung - ist ab dem Commit wertlos.

        **Sicherheitsstopp auch fuer Reset-Links:** Jeder zuvor ausgestellte,
        offene Link zum Zuruecksetzen des Passworts wird in derselben
        Transaktion geloescht (ADR 0021). Ein Entsperren belebt ihn nicht wieder.
        Ein Administrator darf fuer das gesperrte Mitglied bewusst einen neuen
        Link erzeugen; die Sperre bleibt davon unberuehrt. Sperrreihenfolge wie
        ueberall: Organisation -> Mitgliedschaft -> Reset-Link. Laeuft eine
        Einloesung gleichzeitig, entscheidet die Mitgliedschaftssperre: Hat die
        Einloesung zuerst committet, gilt das neue Passwort und die Sperre folgt;
        hat die Sperre zuerst committet, findet die Einloesung keinen Link mehr.
        """
        self.guard.lock_organization()
        self.guard.reverify_actor(actor, permission)
        member, user = self.guard.load(member_id, lock=True)
        check_version(member, expected_version)
        require_not_removed(member)
        if member.id == actor.member_id:
            raise SelfLockoutError(
                "Der eigene Zugang kann nicht gesperrt werden. Bitte einen anderen "
                "Administrator darum bitten."
            )
        if member.status == MEMBER_STATUS_DISABLED:
            raise ConflictError("Der Zugang dieses Mitglieds ist bereits gesperrt.")
        self.guard.require_other_admin(member)
        member.status = MEMBER_STATUS_DISABLED
        member.lock_reason = (reason or "").strip() or None
        flush(self.session)
        self.session.execute(
            delete(PasswordResetToken).where(PasswordResetToken.member_id == member.id)
        )
        revoke_membership_sessions(
            self.session, user_id=member.user_id, organization_id=self.organization_id
        )
        bump_session_version(self.session, member.id)
        return self._view(member, user)

    def reactivate(
        self, member_id: uuid.UUID, *, expected_version: int, actor: Actor, permission: str
    ) -> MemberView:
        """Gibt den Zugang zu diesem Betrieb wieder frei.

        Widerrufene Sitzungen bleiben widerrufen - die Sitzungsversion zaehlt
        erneut hoch, kein altes Token lebt wieder auf. Die Person meldet sich
        neu an; ihre Rollen sind unveraendert. Ein entferntes Konto bleibt
        entfernt.
        """
        self.guard.lock_organization()
        self.guard.reverify_actor(actor, permission)
        member, user = self.guard.load(member_id, lock=True)
        check_version(member, expected_version)
        require_not_removed(member)
        if member.id == actor.member_id:  # pragma: no cover - gesperrt gibt es keine Anfrage
            raise SelfLockoutError("Den eigenen Zugang kann niemand selbst freigeben.")
        if member.status == MEMBER_STATUS_ACTIVE:
            raise ConflictError("Der Zugang dieses Mitglieds ist bereits aktiv.")
        member.status = MEMBER_STATUS_ACTIVE
        member.lock_reason = None
        flush(self.session)
        bump_session_version(self.session, member.id)
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
        self.guard.lock_organization()
        self.guard.reverify_actor(actor, permission)
        member, user = self.guard.load(member_id, lock=True)
        check_version(member, expected_version)
        require_not_removed(member)
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
            self.guard.require_other_admin(member)

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

    def update_profile(
        self,
        member_id: uuid.UUID,
        *,
        full_name: str | None,
        email: str | None,
        expected_version: int,
        actor: Actor,
        permission: str,
    ) -> ProfileChange:
        """Aendert Name und/oder E-Mail-Adresse des Kontos (ADR 0021).

        Nur fuer Konten, die keinem anderen Betrieb angehoeren; ein gesperrtes
        Konto darf bearbeitet werden, ein entferntes nicht. Die E-Mail wird wie
        bei Einladung und Anmeldung normalisiert. Sie darf weder einem anderen
        Konto noch einer offenen Einladung **dieses** Betriebs gehoeren - beide
        Faelle mit derselben Meldung. Eine neue E-Mail beendet jede Sitzung des
        Kontos; danach gilt nur noch sie fuer die Anmeldung. Ein neuer Name
        allein laesst die Sitzungen bestehen.
        """
        self.guard.lock_organization()
        self.guard.reverify_actor(actor, permission)
        member, _ = self.guard.load(member_id, lock=True)
        check_version(member, expected_version)
        require_not_removed(member)
        user = self.guard.lock_user(member.user_id)
        self.guard.require_exclusive_account(user.id)

        changed: list[str] = []
        if full_name is not None:
            name = full_name.strip()
            if not name:
                raise ValidationFailedError(
                    "Bitte einen Namen angeben.",
                    errors=[
                        ProblemFieldError(
                            field="full_name", code="missing", message="Bitte einen Namen angeben."
                        )
                    ],
                )
            if name != user.full_name:
                user.full_name = name
                changed.append("full_name")
        if email is not None:
            normalized = normalize_email(email)
            if normalized != user.email:
                self._require_email_available(normalized, user.id)
                user.email = normalized
                changed.append("email")
        if not changed:
            return ProfileChange(self._view(member, user), changed=[])

        # Das Profil gehoert zum verwaltbaren Zustand: Version weiterzaehlen.
        member.updated_at = utcnow()
        # Zwei Konten koennen dieselbe Adresse nicht gleichzeitig erhalten - auch
        # nicht ueber eine Einladungsannahme in einem anderen Betrieb.
        with unique_violation_translated(
            self.session,
            constraint=USERS_EMAIL_CONSTRAINT,
            error=EmailUnavailableError(_EMAIL_UNAVAILABLE),
        ):
            flush(self.session)
        if "email" in changed:
            revoke_user_sessions(
                self.session,
                user_id=user.id,
                reason=RefreshTokenRevocationReason.CREDENTIALS_CHANGED,
            )
            bump_session_version(self.session, member.id)
        return ProfileChange(self._view(member, user), changed=changed)

    def remove(
        self,
        member_id: uuid.UUID,
        *,
        confirm_email: str,
        expected_version: int,
        actor: Actor,
        permission: str,
    ) -> Removal:
        """Entfernt ein Mitglied endgueltig - ein Tombstone, kein Soft Delete.

        Die Zeile der Mitgliedschaft bleibt (Status ``removed``), damit
        "Erstellt von" und "Zuletzt geaendert von" weiter aufloesbar sind - als
        "Entfernter Benutzer". Rollen, Einstellungen, offene Reset-Links und
        Sitzungen enden. Gehoert das Konto keinem anderen Betrieb an, werden
        Name und E-Mail durch neutrale Platzhalter ersetzt und das Konto ist
        nie wieder anmeldbar; die fruehere Adresse ist danach fuer eine neue
        Einladung frei. Gehoert es noch einem anderen Betrieb an, bleibt es
        dort unveraendert.

        Bestaetigt wird mit der aktuellen E-Mail-Adresse des Kontos.
        """
        self.guard.lock_organization()
        self.guard.reverify_actor(actor, permission)
        member, _ = self.guard.load(member_id, lock=True)
        check_version(member, expected_version)
        require_not_removed(member)
        if member.id == actor.member_id:
            raise SelfLockoutError(
                "Das eigene Konto kann niemand selbst entfernen. Bitte einen anderen "
                "Administrator darum bitten."
            )
        user = self.guard.lock_user(member.user_id)
        if normalize_email(confirm_email) != user.email:
            raise ValidationFailedError(
                "Die Bestaetigung stimmt nicht mit der E-Mail-Adresse des Kontos ueberein.",
                errors=[
                    ProblemFieldError(
                        field="confirm_email",
                        code="confirmation_mismatch",
                        message="Bitte die aktuelle E-Mail-Adresse des Kontos eingeben.",
                    )
                ],
            )
        # Vor dem Loeschen der Rollen zaehlen - danach waere er kein Admin mehr.
        self.guard.require_other_admin(member)
        exclusive = account_is_exclusive(
            self.session, user_id=user.id, organization_id=self.organization_id
        )

        self.session.execute(delete(MemberRole).where(MemberRole.member_id == member.id))
        self.session.execute(delete(UserPreferences).where(UserPreferences.member_id == member.id))
        self.session.execute(
            delete(PasswordResetToken).where(PasswordResetToken.member_id == member.id)
        )
        member.status = MEMBER_STATUS_REMOVED
        member.lock_reason = None
        member.last_login_at = None
        if exclusive:
            user.email = removed_email(user.id)
            user.full_name = REMOVED_DISPLAY_NAME
            user.password_hash = REMOVED_PASSWORD_HASH
            user.is_active = False
            user.last_login_at = None
        flush(self.session)
        if exclusive:
            revoke_user_sessions(
                self.session,
                user_id=user.id,
                reason=RefreshTokenRevocationReason.MEMBERSHIP_REMOVED,
            )
        else:
            revoke_membership_sessions(
                self.session,
                user_id=user.id,
                organization_id=self.organization_id,
                reason=RefreshTokenRevocationReason.MEMBERSHIP_REMOVED,
            )
        bump_session_version(self.session, member.id)
        return Removal(self._view(member, user), account_tombstoned=exclusive)

    # ----------------------------------------------------------------- intern

    def _require_email_available(self, email: str, own_user_id: uuid.UUID) -> None:
        """Weder ein anderes Konto noch eine offene Einladung dieses Betriebs."""
        taken_by_account = self.session.execute(
            select(User.id).where(User.email == email, User.id != own_user_id)
        ).first()
        open_invitation = self.session.execute(
            select(MemberInvitation.id).where(
                MemberInvitation.organization_id == self.organization_id,
                MemberInvitation.email == email,
                MemberInvitation.accepted_at.is_(None),
                MemberInvitation.revoked_at.is_(None),
            )
        ).first()
        if taken_by_account is not None or open_invitation is not None:
            raise EmailUnavailableError(_EMAIL_UNAVAILABLE)

    def _view(self, member: OrganizationMember, user: User) -> MemberView:
        roles = roles_of_members(self.session, [member.id]).get(member.id, [])
        removed = member.status == MEMBER_STATUS_REMOVED
        admins = set() if removed else self.guard.active_admin_ids()
        return MemberView(
            member=member,
            user=user,
            roles=roles,
            account_shared=(
                False
                if removed
                else not account_is_exclusive(
                    self.session, user_id=user.id, organization_id=self.organization_id
                )
            ),
            last_active_administrator=admins == {member.id},
        )
