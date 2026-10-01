"""Passwortzuruecksetzung: Administrator loest aus, die Person setzt selbst (ADR 0021).

Ein Administrator legt **nie** ein Passwort fest und liest keines. Er erhaelt
einen Einmal-Link, den er - solange es keinen E-Mail-Versand gibt - genau
einmal angezeigt bekommt und persoenlich uebergibt. Die Person oeffnet ihn und
waehlt ihr neues Passwort.

Sicherheitsfestlegungen (docs/security.md, Abschnitt 18a):

* 256 Bit Zufall, gespeichert ausschliesslich als SHA-256-Hash
  (:func:`app.core.auth.security.generate_one_time_token`, gemeinsam mit den
  Einladungen).
* Kurze, konfigurierte Gueltigkeit (``ELEKTROPLAN_PASSWORD_RESET_VALID_MINUTES``).
* Hoechstens ein offener Link je Mitgliedschaft; ein neuer ersetzt den alten.
* Nur fuer aktive oder gesperrte, nie fuer entfernte Mitglieder - und nur fuer
  Konten, die keinem anderen Betrieb angehoeren (ADR 0021).
* Eine **Sperre** loescht jeden zuvor ausgestellten offenen Link der
  Mitgliedschaft (Sicherheitsstopp); Entsperren belebt ihn nicht. Ein danach
  bewusst neu erzeugter Link funktioniert - die Sperre bleibt bestehen, die
  Anmeldung ist erst nach dem Entsperren moeglich.
* Einloesen ist atomar: Passwort setzen, Link loeschen, alle Sitzungen
  widerrufen und die Sitzungsversion hochzaehlen - in einer Transaktion. Zwei
  gleichzeitige Einloesungen desselben Links: genau eine gelingt.
* Token, Link und Passwort erscheinen weder im Protokoll noch in Logs oder
  Fehlermeldungen. Unbekannt, abgelaufen, verwendet, ersetzt: **eine** Antwort.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.auth.models import RefreshTokenRevocationReason
from app.core.auth.rate_limit import SlidingWindowLimiter
from app.core.auth.security import (
    MAX_ONE_TIME_TOKEN_LENGTH,
    generate_one_time_token,
    hash_one_time_token,
    hash_password,
    validate_password_strength,
)
from app.core.auth.service import bump_session_version, revoke_user_sessions
from app.core.members.guard import (
    Actor,
    MembershipGuard,
    account_is_exclusive,
    require_not_removed,
)
from app.core.organizations.models import MEMBER_STATUS_REMOVED, Organization, OrganizationMember
from app.core.password_reset.models import PasswordResetToken
from app.core.users.models import User
from app.db.mixins import utcnow
from app.errors import (
    PasswordResetDeliveryUnavailableError,
    PasswordResetInvalidError,
    ProblemFieldError,
    RateLimitedError,
    ValidationFailedError,
)
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Pfad der oeffentlichen Seite im Planner. Das Token steht im Fragment.
RESET_PATH = "/passwort-zuruecksetzen"

_INVALID = (
    "Dieser Link ist nicht (mehr) gueltig - er ist abgelaufen, wurde bereits verwendet oder "
    "durch einen neueren ersetzt. Bitte beim Administrator einen neuen Link anfordern."
)

_settings = get_settings()
_issue_limiter = SlidingWindowLimiter(
    limit=_settings.password_reset_issue_per_window,
    window_seconds=_settings.password_reset_window_seconds,
)
_redeem_limiter = SlidingWindowLimiter(
    limit=_settings.password_reset_attempts_per_window,
    window_seconds=_settings.password_reset_window_seconds,
)


def reset_password_reset_limiters() -> None:
    """Vergisst alle Zaehler - nur fuer Tests."""
    _issue_limiter.clear()
    _redeem_limiter.clear()


def ensure_reset_delivery_available(settings: Settings) -> None:
    """Bricht ab, **bevor** etwas angelegt wird, wenn niemand erreicht werden kann."""
    if settings.password_reset_delivery != "admin_link":  # noqa: S105 - Zustellweg
        raise PasswordResetDeliveryUnavailableError(
            "Fuer das Zuruecksetzen von Passwoertern ist noch kein Zustellweg eingerichtet. "
            "Es wurde kein Link erzeugt."
        )


def reset_url(settings: Settings, token: str) -> str:
    """Reset-Link; das Token steht im Fragment und erreicht so weder Logs noch ``Referer``."""
    return f"{settings.public_app_url.rstrip('/')}{RESET_PATH}#t={token}"


@dataclass(frozen=True, slots=True)
class IssuedReset:
    member_id: uuid.UUID
    token: str
    expires_at: datetime


class PasswordResetService:
    """Ausloesen durch einen Administrator **dieses** Betriebs.

    Committet nicht: Der Endpunkt protokolliert und committet.
    """

    def __init__(self, session: Session, organization_id: uuid.UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.guard = MembershipGuard(session, organization_id)
        self.settings = get_settings()

    def issue(self, member_id: uuid.UUID, *, actor: Actor, permission: str) -> IssuedReset:
        """Erzeugt einen neuen Einmal-Link und macht einen vorherigen ungueltig."""
        ensure_reset_delivery_available(self.settings)
        self.guard.lock_organization()
        self.guard.reverify_actor(actor, permission)
        member, user = self.guard.load(member_id, lock=True)
        require_not_removed(member)
        self.guard.require_exclusive_account(user.id)

        key = f"member:{member.id}"
        if not _issue_limiter.check(key):
            logger.warning("password_reset_issue_limited")
            raise RateLimitedError(
                "Fuer dieses Konto wurden gerade mehrere Links erzeugt. Bitte spaeter erneut "
                "versuchen."
            )
        _issue_limiter.register(key)

        # Hoechstens ein offener Link: der bisherige verschwindet.
        self.session.execute(
            delete(PasswordResetToken).where(PasswordResetToken.member_id == member.id)
        )
        raw, token_hash = generate_one_time_token()
        expires_at = utcnow() + timedelta(minutes=self.settings.password_reset_valid_minutes)
        self.session.add(
            PasswordResetToken(
                organization_id=self.organization_id,
                member_id=member.id,
                token_hash=token_hash,
                expires_at=expires_at,
                created_by_user_id=actor.user_id,
            )
        )
        self.session.flush()
        return IssuedReset(member_id=member.id, token=raw, expires_at=expires_at)


@dataclass(frozen=True, slots=True)
class CompletedReset:
    organization_id: uuid.UUID
    member_id: uuid.UUID
    user_id: uuid.UUID


class PasswordResetRedemption:
    """Oeffentliche Einloesung - ohne Anmeldung, nur mit dem Token.

    Das Token ersetzt hier die Anmeldung und wird deshalb wie eine Anmeldung
    begrenzt (Fehlversuche je IP).
    """

    def __init__(self, session: Session, *, client_ip: str | None) -> None:
        self.session = session
        self.client_ip = client_ip

    def preview(self, token: str) -> datetime:
        """Prueft den Link, ohne etwas zu aendern. Liefert nur die Ablaufzeit."""
        return self._find_open(token).expires_at

    def complete(self, token: str, *, password: str) -> CompletedReset:
        """Setzt das Passwort - genau einmal, atomar.

        Sperrreihenfolge wie in der Verwaltung, nur ohne Organisationszeile:
        ``Mitgliedschaft -> Konto -> Reset-Link``. Erst unter den Sperren wird
        der Link erneut gesucht: Hat eine gleichzeitige Einloesung ihn schon
        verbraucht, ein Administrator ihn ersetzt oder die Mitgliedschaft
        entfernt, ist er hier weg.
        """
        found = self._find_open(token)
        problems = validate_password_strength(password)
        if problems:
            raise ValidationFailedError(
                problems[0],
                errors=[
                    ProblemFieldError(field="password", code="password_policy", message=text)
                    for text in problems
                ],
            )

        member = self.session.execute(
            select(OrganizationMember)
            .where(OrganizationMember.id == found.member_id)
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if member is None:  # pragma: no cover - Fremdschluessel mit CASCADE
            raise self._invalid()
        user = self.session.execute(
            select(User)
            .where(User.id == member.user_id)
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        ).scalar_one()
        stored = self.session.execute(
            select(PasswordResetToken)
            .where(PasswordResetToken.id == found.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if (
            stored is None
            or stored.token_hash != hash_one_time_token(token)
            or stored.expires_at <= utcnow()
            or member.status == MEMBER_STATUS_REMOVED
            or not user.is_active
            # Inzwischen einem weiteren Betrieb beigetreten: Der Link stammt von
            # einem Administrator, der das Konto nicht mehr allein verwaltet.
            or not account_is_exclusive(
                self.session, user_id=user.id, organization_id=member.organization_id
            )
        ):
            raise self._invalid()

        user.password_hash = hash_password(password)
        self.session.delete(stored)
        self.session.flush()
        revoke_user_sessions(
            self.session, user_id=user.id, reason=RefreshTokenRevocationReason.CREDENTIALS_CHANGED
        )
        bump_session_version(self.session, member.id)
        return CompletedReset(
            organization_id=member.organization_id, member_id=member.id, user_id=user.id
        )

    # ----------------------------------------------------------------- intern

    def _find_open(self, token: str) -> PasswordResetToken:
        key = f"ip:{self.client_ip or 'unbekannt'}"
        if not _redeem_limiter.check(key):
            logger.warning("password_reset_rate_limited")
            raise RateLimitedError("Zu viele Versuche. Bitte spaeter erneut versuchen.")
        stored: PasswordResetToken | None = None
        if 0 < len(token) <= MAX_ONE_TIME_TOKEN_LENGTH:
            stored = self.session.execute(
                select(PasswordResetToken).where(
                    PasswordResetToken.token_hash == hash_one_time_token(token)
                )
            ).scalar_one_or_none()
        organization = (
            self.session.get(Organization, stored.organization_id) if stored is not None else None
        )
        if (
            stored is None
            or stored.expires_at <= utcnow()
            or organization is None
            or organization.deleted_at is not None
        ):
            _redeem_limiter.register(key)
            raise self._invalid()
        return stored

    @staticmethod
    def _invalid() -> PasswordResetInvalidError:
        # Bewusst ohne Token, Hash oder Grund im Log.
        logger.info("password_reset_rejected")
        return PasswordResetInvalidError(_INVALID)
