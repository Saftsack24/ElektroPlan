"""Einladungen: anlegen, widerrufen, erneut ausstellen, annehmen (ADR 0015).

Sicherheitsfestlegungen (docs/security.md, Abschnitt 18):

* Das Token hat 256 Bit Zufall (``secrets.token_urlsafe(32)``). Gespeichert
  wird ausschliesslich sein SHA-256-Hash. Ein KDF ist wie beim Refresh Token
  nicht noetig: Bei dieser Entropie ist Raten aussichtslos.
* Einmal verwendbar: Die Annahme sperrt die Einladungszeile
  (``SELECT ... FOR UPDATE``) und setzt ``accepted_at`` in derselben
  Transaktion, in der Konto und Mitgliedschaft entstehen. Eine zweite,
  gleichzeitige Annahme liest danach eine geschlossene Einladung.
* Eine erneute Ausstellung ersetzt den Hash. Das alte Token findet danach
  keinen Datensatz mehr.
* Unbekannt, abgelaufen, widerrufen, verwendet: **ein** Fehler
  (:class:`~app.errors.InvitationInvalidError`). Fehlversuche werden je IP
  begrenzt.
* Ein bestehendes Konto wird **nie** veraendert - weder Passwort noch Name
  noch E-Mail. Seine Annahme verlangt dessen Anmeldedaten.
* Token, Link und Passwort erscheinen weder im Protokoll noch in Logs.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import CursorResult, and_, delete, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.auth.rate_limit import SlidingWindowLimiter
from app.core.auth.security import hash_password, validate_password_strength
from app.core.auth.service import AuthService, normalize_email
from app.core.authorization.models import MemberRole, Role
from app.core.authorization.service import resolve_system_roles
from app.core.invitations.delivery import ensure_delivery_available
from app.core.invitations.models import (
    OPEN_INVITATION_INDEX,
    MemberInvitation,
    MemberInvitationRole,
)
from app.core.organizations.models import MEMBER_STATUS_ACTIVE, Organization, OrganizationMember
from app.core.persistence import flush, unique_violation_translated
from app.core.preconditions import check_version
from app.core.tenancy.repository import TenantRepository
from app.core.users.models import User
from app.db.mixins import utcnow
from app.errors import (
    ConflictError,
    InvitationInvalidError,
    InvitationRequiresLoginError,
    NotFoundError,
    ProblemFieldError,
    RateLimitedError,
    ValidationFailedError,
)
from app.logging_config import get_logger

logger = get_logger(__name__)

#: 32 Byte = 256 Bit Zufall; als URL-sicheres Base64 43 Zeichen lang.
TOKEN_BYTES = 32
#: Obergrenze fuer ein vorgelegtes Token. Laengere Werte sind nie gueltig und
#: werden nicht erst gehasht.
MAX_TOKEN_LENGTH = 128

USERS_EMAIL_CONSTRAINT = "uq_users_email"
MEMBERSHIP_CONSTRAINT = "uq_organization_members_organization_id_user_id"

_OPEN_INVITATION_EXISTS = (
    "Fuer diese E-Mail-Adresse gibt es bereits eine offene Einladung. "
    "Bitte diese erneut ausstellen oder widerrufen."
)
_ALREADY_MEMBER = "Diese Person gehoert dem Betrieb bereits an."
_INVALID = (
    "Diese Einladung ist nicht (mehr) gueltig. Bitte beim Betrieb eine neue Einladung anfordern."
)

_settings = get_settings()
_acceptance_limiter = SlidingWindowLimiter(
    limit=_settings.invitation_attempts_per_window,
    window_seconds=_settings.invitation_window_seconds,
)


def reset_acceptance_limiter() -> None:
    """Vergisst alle Fehlversuche - nur fuer Tests."""
    _acceptance_limiter.clear()


def hash_invitation_token(raw: str) -> str:
    """SHA-256 des Tokens als Hex-Zeichenkette (64 Zeichen)."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _new_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(TOKEN_BYTES)
    return raw, hash_invitation_token(raw)


@dataclass(frozen=True, slots=True)
class InvitationView:
    """Eine Einladung samt vorgesehener Rollen und abgeleitetem Zustand."""

    invitation: MemberInvitation
    roles: list[Role]
    status: str


def roles_of_invitations(
    session: Session, invitation_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[Role]]:
    """Vorgesehene Rollen mehrerer Einladungen - eine Abfrage statt N."""
    result: dict[uuid.UUID, list[Role]] = defaultdict(list)
    if not invitation_ids:
        return result
    rows = session.execute(
        select(MemberInvitationRole.invitation_id, Role)
        .join(Role, Role.id == MemberInvitationRole.role_id)
        .where(MemberInvitationRole.invitation_id.in_(invitation_ids))
        .order_by(Role.name)
    ).all()
    for invitation_id, role in rows:
        result[invitation_id].append(role)
    return result


class InvitationRepository(TenantRepository[MemberInvitation]):
    model = MemberInvitation


class InvitationService:
    """Einladungen **eines** Betriebs aus Sicht der Verwaltung.

    Die Schicht committet nicht: Der Endpunkt schreibt das Protokoll in
    dieselbe Transaktion und committet danach.
    """

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.repository = InvitationRepository(session, organization_id)
        self.settings = get_settings()

    # ------------------------------------------------------------------ Lesen

    def get(self, invitation_id: uuid.UUID) -> InvitationView:
        return self._view(self._get(invitation_id, lock=False))

    # ---------------------------------------------------------------- Aendern

    def create(
        self,
        *,
        email: str,
        full_name: str | None,
        role_keys: Sequence[str],
        actor_user_id: uuid.UUID,
    ) -> tuple[InvitationView, str]:
        """Legt eine Einladung an. Liefert die Einladung und das Klartext-Token.

        Das Token geht ausschliesslich an die Zustellung; es wird nicht
        gespeichert und nicht protokolliert.
        """
        ensure_delivery_available(self.settings)
        normalized = normalize_email(email)
        roles = resolve_system_roles(self.session, self.organization_id, role_keys)

        if self._is_member(normalized):
            raise ConflictError(_ALREADY_MEMBER)
        if self._open_invitation_exists(normalized):
            raise ConflictError(_OPEN_INVITATION_EXISTS)

        raw, token_hash = _new_token()
        invitation = MemberInvitation(
            organization_id=self.organization_id,
            email=normalized,
            full_name=(full_name or "").strip() or None,
            token_hash=token_hash,
            expires_at=self._expiry(),
            created_by_user_id=actor_user_id,
        )
        self.repository.add(invitation)
        # Zwei gleichzeitige Einladungen derselben Adresse bestehen beide die
        # Vorabpruefung; der partielle eindeutige Index laesst nur eine zu.
        with unique_violation_translated(
            self.session,
            constraint=OPEN_INVITATION_INDEX,
            error=ConflictError(_OPEN_INVITATION_EXISTS),
        ):
            self.session.flush()
        for role in roles:
            self.session.add(
                MemberInvitationRole(
                    organization_id=self.organization_id,
                    invitation_id=invitation.id,
                    role_id=role.id,
                )
            )
        self.session.flush()
        return InvitationView(invitation, roles, invitation.status_at(utcnow())), raw

    def revoke(self, invitation_id: uuid.UUID, *, expected_version: int) -> InvitationView:
        """Widerruft eine offene oder abgelaufene Einladung."""
        invitation = self._get(invitation_id, lock=True)
        check_version(invitation, expected_version)
        self._require_open(invitation)
        invitation.revoked_at = utcnow()
        flush(self.session)
        return self._view(invitation)

    def reissue(
        self, invitation_id: uuid.UUID, *, expected_version: int
    ) -> tuple[InvitationView, str]:
        """Stellt eine Einladung neu aus: neues Token, neue Frist.

        Der Hash wird ersetzt - das bisherige Token findet danach keinen
        Datensatz mehr und ist damit ungueltig, auch wenn es noch nicht
        abgelaufen war.
        """
        invitation = self._get(invitation_id, lock=True)
        check_version(invitation, expected_version)
        self._require_open(invitation)
        ensure_delivery_available(self.settings)
        raw, token_hash = _new_token()
        invitation.token_hash = token_hash
        invitation.expires_at = self._expiry()
        flush(self.session)
        return self._view(invitation), raw

    # ----------------------------------------------------------------- intern

    def _get(self, invitation_id: uuid.UUID, *, lock: bool) -> MemberInvitation:
        stmt = self.repository.query().where(MemberInvitation.id == invitation_id)
        if lock:
            stmt = stmt.with_for_update()
        invitation = self.session.execute(stmt).scalar_one_or_none()
        if invitation is None:
            raise NotFoundError("Einladung wurde nicht gefunden.")
        return invitation

    def _view(self, invitation: MemberInvitation) -> InvitationView:
        roles = roles_of_invitations(self.session, [invitation.id]).get(invitation.id, [])
        return InvitationView(invitation, roles, invitation.status_at(utcnow()))

    def _expiry(self) -> datetime:
        return utcnow() + timedelta(hours=self.settings.invitation_valid_hours)

    @staticmethod
    def _require_open(invitation: MemberInvitation) -> None:
        if invitation.accepted_at is not None:
            raise ConflictError("Diese Einladung wurde bereits angenommen.")
        if invitation.revoked_at is not None:
            raise ConflictError("Diese Einladung wurde bereits widerrufen.")

    def _is_member(self, email: str) -> bool:
        stmt = (
            select(OrganizationMember.id)
            .join(User, User.id == OrganizationMember.user_id)
            .where(
                OrganizationMember.organization_id == self.organization_id,
                User.email == email,
            )
        )
        return self.session.execute(stmt).first() is not None

    def _open_invitation_exists(self, email: str) -> bool:
        stmt = self.repository.query().where(
            MemberInvitation.email == email,
            MemberInvitation.accepted_at.is_(None),
            MemberInvitation.revoked_at.is_(None),
        )
        return self.session.execute(stmt).first() is not None


# ----------------------------------------------------------------- Annahme


@dataclass(frozen=True, slots=True)
class InvitationPreviewData:
    """Was der Inhaber eines gueltigen Tokens ueber die Einladung erfaehrt."""

    organization_name: str
    email: str
    full_name: str | None
    expires_at: datetime
    #: Ob zur eingeladenen E-Mail bereits ein Konto besteht. Nur der Inhaber
    #: des Tokens erfaehrt das - er braucht es, um den richtigen Weg zu gehen.
    account_exists: bool


@dataclass(frozen=True, slots=True)
class AcceptanceResult:
    organization_id: uuid.UUID
    organization_name: str
    email: str
    user_id: uuid.UUID
    member_id: uuid.UUID
    invitation_id: uuid.UUID


class InvitationAcceptance:
    """Oeffentliche Annahme - ohne Anmeldung, nur mit dem Token.

    Der Mandant stammt hier ausnahmsweise nicht aus einem Access Token,
    sondern aus der Einladung, die das Token eindeutig bezeichnet. Das Token
    ersetzt damit die Anmeldung - und wird deshalb wie eine Anmeldung
    begrenzt.
    """

    def __init__(self, session: Session, *, client_ip: str | None) -> None:
        self.session = session
        self.client_ip = client_ip

    def preview(self, token: str) -> InvitationPreviewData:
        invitation, organization = self._load_open(token, lock=False)
        account_exists = (
            self.session.execute(select(User.id).where(User.email == invitation.email)).first()
            is not None
        )
        return InvitationPreviewData(
            organization_name=organization.name,
            email=invitation.email,
            full_name=invitation.full_name,
            expires_at=invitation.expires_at,
            account_exists=account_exists,
        )

    def accept_with_new_account(
        self, token: str, *, full_name: str, password: str
    ) -> AcceptanceResult:
        """Legt Konto und Mitgliedschaft atomar an.

        Besteht zur E-Mail bereits ein Konto, wird **nichts** angelegt und
        nichts geaendert (:class:`InvitationRequiresLoginError`).
        """
        invitation, organization = self._load_open(token, lock=True)
        problems = validate_password_strength(password)
        if problems:
            raise ValidationFailedError(
                problems[0],
                errors=[
                    ProblemFieldError(field="password", code="password_policy", message=text)
                    for text in problems
                ],
            )
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
        requires_login = InvitationRequiresLoginError(
            "Zu dieser E-Mail-Adresse gibt es bereits ein Konto. Bitte die Einladung mit "
            "dem bestehenden Passwort annehmen."
        )
        if self.session.execute(select(User.id).where(User.email == invitation.email)).first():
            raise requires_login

        user = User(email=invitation.email, password_hash=hash_password(password), full_name=name)
        self.session.add(user)
        # Zwei Einladungen verschiedener Betriebe an dieselbe Adresse koennen
        # gleichzeitig angenommen werden. Nur ein Konto entsteht; die zweite
        # Annahme verlangt dann die Anmeldung - sie ueberschreibt nichts.
        with unique_violation_translated(
            self.session, constraint=USERS_EMAIL_CONSTRAINT, error=requires_login
        ):
            self.session.flush()
        return self._complete(invitation, organization, user)

    def accept_with_existing_account(self, token: str, *, password: str) -> AcceptanceResult:
        """Nimmt eine Einladung mit einem bestehenden Konto an.

        Die Identitaet wird ueber die Anmeldedaten **genau der eingeladenen
        E-Mail-Adresse** geprueft - dieselbe Begrenzung und dieselbe Meldung
        wie bei der Anmeldung. Passwort, Name und E-Mail des Kontos bleiben
        unveraendert.
        """
        invitation, organization = self._load_open(token, lock=True)
        user = AuthService(self.session).verify_credentials(
            email=invitation.email, password=password, client_ip=self.client_ip
        )
        already = self.session.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.organization_id == organization.id,
                OrganizationMember.user_id == user.id,
            )
        ).first()
        if already is not None:
            raise ConflictError("Sie gehoeren diesem Betrieb bereits an.")
        return self._complete(invitation, organization, user)

    # ----------------------------------------------------------------- intern

    def _load_open(self, token: str, *, lock: bool) -> tuple[MemberInvitation, Organization]:
        key = f"ip:{self.client_ip or 'unbekannt'}"
        if not _acceptance_limiter.check(key):
            logger.warning("invitation_rate_limited")
            raise RateLimitedError("Zu viele Versuche. Bitte spaeter erneut versuchen.")

        invitation: MemberInvitation | None = None
        if 0 < len(token) <= MAX_TOKEN_LENGTH:
            stmt = select(MemberInvitation).where(
                MemberInvitation.token_hash == hash_invitation_token(token)
            )
            if lock:
                stmt = stmt.with_for_update()
            invitation = self.session.execute(stmt).scalar_one_or_none()

        organization = (
            self.session.get(Organization, invitation.organization_id)
            if invitation is not None
            else None
        )
        if (
            invitation is None
            or organization is None
            or organization.deleted_at is not None
            or invitation.status_at(utcnow()) != "pending"
        ):
            _acceptance_limiter.register(key)
            # Bewusst ohne Token, Hash oder Grund im Log.
            logger.info("invitation_rejected")
            raise InvitationInvalidError(_INVALID)
        return invitation, organization

    def _complete(
        self, invitation: MemberInvitation, organization: Organization, user: User
    ) -> AcceptanceResult:
        member = OrganizationMember(
            organization_id=organization.id, user_id=user.id, status=MEMBER_STATUS_ACTIVE
        )
        self.session.add(member)
        with unique_violation_translated(
            self.session,
            constraint=MEMBERSHIP_CONSTRAINT,
            error=ConflictError("Sie gehoeren diesem Betrieb bereits an."),
        ):
            self.session.flush()
        role_ids = self.session.execute(
            select(MemberInvitationRole.role_id).where(
                MemberInvitationRole.invitation_id == invitation.id
            )
        ).scalars()
        for role_id in role_ids:
            self.session.add(
                MemberRole(organization_id=organization.id, member_id=member.id, role_id=role_id)
            )
        invitation.accepted_at = utcnow()
        flush(self.session)
        return AcceptanceResult(
            organization_id=organization.id,
            organization_name=organization.name,
            email=user.email,
            user_id=user.id,
            member_id=member.id,
            invitation_id=invitation.id,
        )


# ---------------------------------------------------------------- Aufraeumen


def purge_invitations(session: Session, *, now: datetime, retention_days: int) -> int:
    """Loescht abgeschlossene und laengst abgelaufene Einladungen.

    Eine Einladung enthaelt E-Mail und Namen einer Person. Nach Annahme,
    Widerruf oder Ablauf hat sie keinen Zweck mehr; nach ``retention_days``
    wird sie endgueltig entfernt (docs/security.md, Abschnitt 13). Das
    Protokoll behaelt nur die ID - keine E-Mail, keinen Namen.
    """
    cutoff = now - timedelta(days=retention_days)
    result: CursorResult[Any] = session.execute(  # type: ignore[assignment]
        delete(MemberInvitation).where(
            or_(
                MemberInvitation.accepted_at < cutoff,
                MemberInvitation.revoked_at < cutoff,
                and_(
                    MemberInvitation.accepted_at.is_(None),
                    MemberInvitation.revoked_at.is_(None),
                    MemberInvitation.expires_at < cutoff,
                ),
            )
        )
    )
    return int(result.rowcount or 0)
