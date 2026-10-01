"""Authentifizierungsdienst: Anmeldung, Token-Rotation, Abmeldung.

Sicherheitsrelevante Festlegungen (docs/security.md, Abschnitt 3):
- Argon2id fuer Passwoerter
- kurzlebige Access Tokens ohne Berechtigungen im Token
- Refresh Tokens nur als Hash gespeichert, Rotation bei jeder Nutzung
- Wiederverwendung eines ersetzten Tokens invalidiert die gesamte Familie
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import NoReturn

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.audit import service as audit
from app.core.auth.models import RefreshToken, RefreshTokenRevocationReason
from app.core.auth.rate_limit import SlidingWindowLimiter
from app.core.auth.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    needs_rehash,
    verify_password,
)
from app.core.organizations.models import MEMBER_STATUS_ACTIVE, Organization, OrganizationMember
from app.core.users.models import User
from app.errors import (
    AuthenticationError,
    NotFoundError,
    OrganizationChoice,
    OrganizationSelectionRequiredError,
    RateLimitedError,
    RefreshConflictError,
)
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Eine Antwort fuer **jeden** abgelehnten Anmeldeversuch (ADR 0021): unbekannte
#: Adresse, falsches Passwort, deaktiviertes Konto, gesperrte, entfernte oder
#: fehlende Mitgliedschaft, gewaehlter Betrieb ohne aktive Mitgliedschaft. Sonst
#: verriete die Antwort, dass ein Passwort stimmte (Passwort- und
#: Kontozustands-Orakel).
LOGIN_REJECTED = (
    "Anmeldung nicht möglich. Bitte Zugangsdaten prüfen oder die Administration kontaktieren."
)

_settings = get_settings()
_login_limiter = SlidingWindowLimiter(
    limit=_settings.login_attempts_per_window,
    window_seconds=_settings.login_window_seconds,
)


@dataclass(frozen=True, slots=True)
class IssuedTokens:
    """Ergebnis einer erfolgreichen Anmeldung oder Erneuerung."""

    access_token: str
    expires_in: int
    refresh_token: str
    #: Datenbank-ID des neuen Refresh-Datensatzes. Wird beim Rotieren in
    #: ``replaced_by_id`` des Vorgaengers eingetragen, damit die Kette
    #: nachvollziehbar bleibt.
    refresh_token_id: uuid.UUID
    organization_id: uuid.UUID
    user_id: uuid.UUID
    member_id: uuid.UUID


def normalize_email(email: str) -> str:
    """E-Mails werden immer in Kleinbuchstaben gespeichert und gesucht."""
    return email.strip().lower()


class AuthService:
    """Alle Vorgaenge rund um Anmeldung und Sitzungen."""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.settings = get_settings()

    # ------------------------------------------------------------- Anmeldung

    def login(
        self,
        *,
        email: str,
        password: str,
        organization_id: uuid.UUID | None = None,
        user_agent: str | None = None,
        client_ip: str | None = None,
    ) -> IssuedTokens:
        """Meldet einen Benutzer an.

        **Jeder** abgelehnte Versuch - unbekannte Adresse, falsches Passwort,
        deaktiviertes Konto, keine aktive Mitgliedschaft (gesperrt, entfernt,
        nie vorhanden) oder ein gewaehlter Betrieb ohne aktive Mitgliedschaft -
        endet gleich: ``401 authentication-failed`` mit :data:`LOGIN_REJECTED`,
        kein Token, und er zaehlt als Fehlversuch je Konto **und** IP. Sonst
        liesse sich gegen ein gesperrtes Konto unbegrenzt pruefen, ob ein
        Passwort stimmt (ADR 0021). Die Sperre selbst bleibt unberuehrt.

        Die Auswahl zwischen mehreren **aktiven** Betrieben nach geprueften
        Zugangsdaten ist kein Fehler (``409 organization-selection-required``).
        """
        normalized = normalize_email(email)
        self._check_rate_limit(normalized, client_ip)

        user = self.session.execute(
            select(User).where(User.email == normalized)
        ).scalar_one_or_none()

        if user is None or not verify_password(user.password_hash, password) or not user.is_active:
            self._reject_login(normalized, client_ip, user)

        assert user is not None  # durch _reject_login ausgeschlossen
        try:
            member = self._select_member(user.id, organization_id)
        except NotFoundError:
            # Gesperrt, entfernt, ohne Mitgliedschaft oder fremder Betrieb:
            # nach aussen nicht vom falschen Passwort zu unterscheiden.
            self._reject_login(normalized, client_ip, user)
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)

        user.last_login_at = datetime.now(tz=UTC)
        _login_limiter.reset(f"user:{normalized}")

        tokens = self._issue(user=user, member=member, user_agent=user_agent, family_id=None)
        audit.record(
            self.session,
            organization_id=member.organization_id,
            action=audit.ACTION_LOGIN,
            entity_type="user",
            entity_id=user.id,
            actor_user_id=user.id,
            # Ohne E-Mail: Das Protokoll ist unveraenderlich und ueberdauert
            # eine Kontoentfernung (ADR 0021). Die Ziel-ID genuegt.
            summary="Anmeldung",
        )
        logger.info("login_succeeded", user_id=str(user.id))
        return tokens

    def verify_credentials(
        self, *, email: str, password: str, client_ip: str | None = None
    ) -> User:
        """Prueft Anmeldedaten, **ohne** eine Sitzung auszustellen.

        Gebraucht bei der Annahme einer Einladung mit einem bestehenden Konto
        (ADR 0015). Es gelten dieselben Regeln wie bei der Anmeldung: dieselbe
        Begrenzung je Konto und IP, **dieselbe** Antwort fuer unbekanntes
        Konto, falsches Passwort und deaktiviertes Konto. Das Passwort wird nie
        geaendert.
        """
        normalized = normalize_email(email)
        self._check_rate_limit(normalized, client_ip)
        user = self.session.execute(
            select(User).where(User.email == normalized)
        ).scalar_one_or_none()
        if user is None or not verify_password(user.password_hash, password) or not user.is_active:
            self._register_failed_attempt(normalized, client_ip)
            raise AuthenticationError(LOGIN_REJECTED)
        _login_limiter.reset(f"user:{normalized}")
        return user

    # ------------------------------------------------------------ Erneuerung

    def refresh(self, raw_token: str, *, user_agent: str | None = None) -> IssuedTokens:
        """Erneuert eine Sitzung und rotiert den Refresh Token.

        Die Zeile wird mit ``SELECT ... FOR UPDATE`` gesperrt. Zwei parallele
        Anfragen sehen den Token dadurch nicht gleichzeitig als gueltig: Genau
        eine erzeugt den Nachfolger, die zweite trifft auf den bereits
        widerrufenen Datensatz.

        Die Entscheidung nutzt ausschliesslich ``revoked_reason``:

        * Widerrufsgrund ``ROTATED`` und innerhalb von
          ``refresh_race_grace_seconds`` -> parallele Anfrage desselben
          Clients; die Familie bleibt bestehen
          (:class:`RefreshConflictError`).
        * Widerrufsgrund ``ROTATED`` ausserhalb des Toleranzfensters ->
          echte Wiederverwendung eines ersetzten Tokens; die gesamte
          Familie wird widerrufen.
        * Jeder andere Widerrufsgrund (``LOGOUT``, ``FAMILY_REVOKED``,
          ``REUSE_DETECTED``) -> der Token ist sofort und eindeutig
          ungueltig, ohne dass die Familie erneut widerrufen wird.
        """
        token_hash = hash_refresh_token(raw_token)
        stored = self.session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash).with_for_update()
        ).scalar_one_or_none()

        if stored is None:
            raise AuthenticationError("Die Sitzung ist ungueltig.")

        if stored.is_revoked:
            if stored.is_rotated and self._is_parallel_refresh(stored):
                # Benigne Ueberschneidung: keine neuen Tokens, aber auch keine
                # Zwangsabmeldung einer gueltigen Sitzung.
                self.session.commit()
                logger.info("refresh_race_detected", user_id=str(stored.user_id))
                raise RefreshConflictError(
                    "Die Sitzung wird bereits erneuert. Bitte Anfrage wiederholen."
                )
            if stored.is_rotated:
                # Ein bereits ersetzter Token wird nach dem Toleranzfenster
                # erneut vorgelegt: Diebstahl annehmen und die gesamte
                # Familie widerrufen.
                self._revoke_family(
                    stored.family_id,
                    reason=RefreshTokenRevocationReason.REUSE_DETECTED,
                )
                audit.record(
                    self.session,
                    organization_id=stored.organization_id,
                    action=audit.ACTION_TOKEN_REUSE,
                    entity_type="refresh_token",
                    entity_id=stored.id,
                    actor_user_id=stored.user_id,
                    summary="Wiederverwendung eines ersetzten Refresh Tokens",
                )
                self.session.commit()
                logger.warning("refresh_token_reuse_detected", user_id=str(stored.user_id))
                raise AuthenticationError("Die Sitzung wurde aus Sicherheitsgruenden beendet.")
            # Logout, Familienwiderruf oder bereits erkannte Wiederverwendung:
            # kein weiterer Sammelwiderruf noetig, der Token ist ungueltig.
            logger.info(
                "refresh_token_revoked",
                user_id=str(stored.user_id),
                reason=stored.revoked_reason,
            )
            raise AuthenticationError("Die Sitzung ist ungueltig.")

        if stored.expires_at <= datetime.now(tz=UTC):
            raise AuthenticationError("Die Sitzung ist abgelaufen.")

        user = self.session.get(User, stored.user_id)
        if user is None or not user.is_active:
            raise AuthenticationError("Dieses Konto ist deaktiviert.")

        try:
            member = self._select_member(user.id, stored.organization_id)
        except NotFoundError as exc:
            # Der Zugang zu diesem Betrieb ist gesperrt (oder die
            # Mitgliedschaft existiert nicht mehr). Keine neue Sitzung - und
            # die Familie wird endgueltig widerrufen, damit auch ein spaeteres
            # Reaktivieren keine alte Sitzung wiederbelebt. Committet wird vor
            # dem Fehler, sonst rollte die Dependency den Widerruf zurueck.
            self._revoke_family(
                stored.family_id, reason=RefreshTokenRevocationReason.MEMBERSHIP_DISABLED
            )
            self.session.commit()
            raise AuthenticationError("Die Mitgliedschaft ist nicht mehr gueltig.") from exc
        if stored.session_version != member.session_version:
            # Seit der Ausstellung hat sich etwas Sicherheitsrelevantes
            # geaendert (Sperre und Entsperren, neue E-Mail, neues Passwort).
            # Auch ein Token, den eine gleichzeitige Erneuerung noch mit dem
            # alten Stand ausgestellt hat, endet hier - endgueltig (ADR 0021).
            self._revoke_family(
                stored.family_id, reason=RefreshTokenRevocationReason.SESSION_OUTDATED
            )
            self.session.commit()
            raise AuthenticationError("Die Sitzung ist nicht mehr gueltig.")
        new_tokens = self._issue(
            user=user,
            member=member,
            user_agent=user_agent,
            family_id=stored.family_id,
            record_login=False,
        )
        # Atomar mit dem neuen Datensatz koppeln: Nachfolger-ID und
        # Widerrufsgrund gemeinsam setzen, damit spaeter erkennbar bleibt,
        # dass dies eine regulaere Rotation war.
        stored.revoked_at = datetime.now(tz=UTC)
        stored.revoked_reason = RefreshTokenRevocationReason.ROTATED.value
        stored.replaced_by_id = new_tokens.refresh_token_id
        return new_tokens

    # -------------------------------------------------------------- Abmeldung

    def logout(self, raw_token: str | None) -> None:
        """Widerruft die Token-Familie serverseitig."""
        if not raw_token:
            return
        stored = self.session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw_token))
        ).scalar_one_or_none()
        if stored is None:
            return
        self._revoke_family(stored.family_id, reason=RefreshTokenRevocationReason.LOGOUT)
        audit.record(
            self.session,
            organization_id=stored.organization_id,
            action=audit.ACTION_LOGOUT,
            entity_type="user",
            entity_id=stored.user_id,
            actor_user_id=stored.user_id,
            summary="Abmeldung",
        )

    # ------------------------------------------------------- Mandantenwechsel

    def switch_organization(
        self,
        *,
        user_id: uuid.UUID,
        organization_id: uuid.UUID,
        user_agent: str | None = None,
    ) -> IssuedTokens:
        """Wechselt den aktiven Mandanten gegen eine gepruefte Mitgliedschaft."""
        user = self.session.get(User, user_id)
        if user is None or not user.is_active:
            raise AuthenticationError("Dieses Konto ist deaktiviert.")
        member = self._select_member(user_id, organization_id)
        tokens = self._issue(user=user, member=member, user_agent=user_agent, family_id=None)
        audit.record(
            self.session,
            organization_id=member.organization_id,
            action=audit.ACTION_ORGANIZATION_SWITCHED,
            entity_type="organization",
            entity_id=member.organization_id,
            actor_user_id=user_id,
            summary="Mandantenwechsel",
        )
        return tokens

    def list_memberships(self, user_id: uuid.UUID) -> list[Organization]:
        """Alle Organisationen, in denen der Benutzer aktiv ist."""
        stmt = (
            select(Organization)
            .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.status == MEMBER_STATUS_ACTIVE,
                Organization.deleted_at.is_(None),
            )
            .order_by(Organization.name)
        )
        return list(self.session.execute(stmt).scalars().all())

    # ----------------------------------------------------------------- intern

    def _select_member(
        self, user_id: uuid.UUID, organization_id: uuid.UUID | None
    ) -> OrganizationMember:
        """Waehlt die aktive Mitgliedschaft - serverseitig geprueft.

        Regel (Punkt 9 der Phase-1.1-Abnahme):

        * genau eine aktive Mitgliedschaft -> sie wird verwendet,
        * mehrere und keine Auswahl -> :class:`OrganizationSelectionRequiredError`
          mit der Liste der Betriebe,
        * ausdrueckliche Auswahl -> nur mit aktiver Mitgliedschaft dort.

        Kein unsortiertes ``LIMIT 1``: Welcher Betrieb aktiv wird, darf nicht
        von der Rueckgabereihenfolge der Datenbank abhaengen.
        """
        if organization_id is not None:
            member = self.session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == user_id,
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.status == MEMBER_STATUS_ACTIVE,
                )
            ).scalar_one_or_none()
            if member is None:
                raise NotFoundError("Keine aktive Mitgliedschaft in diesem Betrieb.")
            return member

        rows = list(
            self.session.execute(
                select(OrganizationMember, Organization)
                .join(Organization, Organization.id == OrganizationMember.organization_id)
                .where(
                    OrganizationMember.user_id == user_id,
                    OrganizationMember.status == MEMBER_STATUS_ACTIVE,
                    Organization.deleted_at.is_(None),
                )
                .order_by(Organization.name, Organization.id)
            ).all()
        )

        if not rows:
            raise NotFoundError("Keine aktive Mitgliedschaft in diesem Betrieb.")
        if len(rows) == 1:
            einzige: OrganizationMember = rows[0][0]
            return einzige

        raise OrganizationSelectionRequiredError(
            "Dieses Konto gehoert mehreren Betrieben an. Bitte einen Betrieb waehlen.",
            organizations=[
                OrganizationChoice(id=str(organization.id), name=organization.name)
                for _, organization in rows
            ],
        )

    def _is_parallel_refresh(self, stored: RefreshToken) -> bool:
        """True, wenn eine regulaere Rotation gerade erst erfolgt ist.

        Wird ausschliesslich fuer Tokens mit ``revoked_reason == ROTATED``
        aufgerufen (siehe :meth:`refresh`). Ein Token, der durch Logout,
        Familienwiderruf oder Diebstahlserkennung widerrufen wurde, gilt
        niemals als paralleler Refresh.
        """
        grace = self.settings.refresh_race_grace_seconds
        if grace <= 0 or stored.revoked_at is None:
            return False
        if not stored.is_rotated:
            return False
        age = (datetime.now(tz=UTC) - stored.revoked_at).total_seconds()
        return 0 <= age <= grace

    def _issue(
        self,
        *,
        user: User,
        member: OrganizationMember,
        user_agent: str | None,
        family_id: uuid.UUID | None,
        record_login: bool = True,
    ) -> IssuedTokens:
        if record_login:
            # Letzte Anmeldung in **diesem** Betrieb. Als Core-UPDATE statt
            # ueber das ORM: Die Spalte gehoert nicht zur verwaltbaren
            # Mitgliedschaft und darf deren Version nicht weiterzaehlen - sonst
            # machte jede Anmeldung die geoeffnete Verwaltungsansicht eines
            # Administrators ungueltig (ADR 0015).
            self.session.execute(
                update(OrganizationMember)
                .where(OrganizationMember.id == member.id)
                .values(last_login_at=datetime.now(tz=UTC))
                .execution_options(synchronize_session=False)
            )
        access_token, expires_in = create_access_token(
            user_id=user.id,
            organization_id=member.organization_id,
            member_id=member.id,
            session_version=member.session_version,
        )
        raw_refresh, refresh_hash = generate_refresh_token()
        record = RefreshToken(
            user_id=user.id,
            organization_id=member.organization_id,
            family_id=family_id or uuid.uuid4(),
            token_hash=refresh_hash,
            expires_at=datetime.now(tz=UTC) + timedelta(days=self.settings.refresh_token_days),
            user_agent=(user_agent or "")[:255] or None,
            session_version=member.session_version,
        )
        self.session.add(record)
        self.session.flush()
        return IssuedTokens(
            access_token=access_token,
            expires_in=expires_in,
            refresh_token=raw_refresh,
            refresh_token_id=record.id,
            organization_id=member.organization_id,
            user_id=user.id,
            member_id=member.id,
        )

    def _revoke_family(
        self,
        family_id: uuid.UUID,
        *,
        reason: RefreshTokenRevocationReason,
    ) -> None:
        """Widerruft alle noch gueltigen Tokens einer Familie.

        Rotierte Vorgaenger behalten ihren Grund (``ROTATED``) und werden
        nicht ueberschrieben - die Kette zur Ursache soll lesbar bleiben.
        """
        now = datetime.now(tz=UTC)
        tokens = (
            self.session.execute(
                select(RefreshToken).where(
                    RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None)
                )
            )
            .scalars()
            .all()
        )
        for token in tokens:
            token.revoked_at = now
            token.revoked_reason = reason.value

    def _reject_login(self, email: str, client_ip: str | None, user: User | None) -> NoReturn:
        """Ein abgelehnter Anmeldeversuch - immer derselbe Weg.

        Zaehlt als Fehlversuch je normalisierter E-Mail und je IP; bei einem
        vorhandenen Konto ein Protokolleintrag nur mit der Konto-ID und einer
        neutralen Beschreibung. Keine E-Mail in Protokoll oder Log.
        """
        self._register_failed_attempt(email, client_ip)
        if user is not None:
            self._audit_failed_login(user)
        logger.info("login_rejected")
        raise AuthenticationError(LOGIN_REJECTED)

    def _check_rate_limit(self, email: str, client_ip: str | None) -> None:
        for key in self._limit_keys(email, client_ip):
            if not _login_limiter.check(key):
                logger.warning("login_rate_limited", key_kind=key.split(":", 1)[0])
                raise RateLimitedError("Zu viele Anmeldeversuche. Bitte spaeter erneut versuchen.")

    def _register_failed_attempt(self, email: str, client_ip: str | None) -> None:
        for key in self._limit_keys(email, client_ip):
            _login_limiter.register(key)

    @staticmethod
    def _limit_keys(email: str, client_ip: str | None) -> tuple[str, ...]:
        keys = [f"user:{email}"]
        if client_ip:
            keys.append(f"ip:{client_ip}")
        return tuple(keys)

    def _audit_failed_login(self, user: User) -> None:
        member = self.session.execute(
            select(OrganizationMember).where(OrganizationMember.user_id == user.id).limit(1)
        ).scalar_one_or_none()
        if member is None:
            return
        audit.record(
            self.session,
            organization_id=member.organization_id,
            action=audit.ACTION_LOGIN_FAILED,
            entity_type="user",
            entity_id=user.id,
            actor_user_id=user.id,
            summary="Fehlgeschlagene Anmeldung",
        )
        self.session.commit()


def revoke_membership_sessions(
    session: Session,
    *,
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    reason: RefreshTokenRevocationReason = RefreshTokenRevocationReason.MEMBERSHIP_DISABLED,
) -> int:
    """Widerruft alle offenen Refresh Tokens **einer** Mitgliedschaft.

    Gezielt: nur Tokens dieses Benutzers **in diesem Betrieb**. Sitzungen
    desselben Benutzers in anderen Betrieben bleiben unberuehrt. Ausgestellte
    Access Tokens laufen noch bis zu ihrem Ablauf, werden aber bei jeder
    Anfrage gegen Mitgliedsstatus und Sitzungsversion geprueft und ab sofort
    abgelehnt (:func:`app.core.auth.dependencies.get_current_user`).

    Allein genuegt der Widerruf nicht: Eine gleichzeitige Erneuerung kann noch
    einen Nachfolger mit altem Stand ausgestellt haben. Deshalb zaehlt der
    Aufrufer zusaetzlich die Sitzungsversion hoch
    (:func:`bump_session_version`).
    """
    tokens = (
        session.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                RefreshToken.organization_id == organization_id,
                RefreshToken.revoked_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    now = datetime.now(tz=UTC)
    for token in tokens:
        token.revoked_at = now
        token.revoked_reason = reason.value
    return len(tokens)


def revoke_user_sessions(
    session: Session, *, user_id: uuid.UUID, reason: RefreshTokenRevocationReason
) -> int:
    """Widerruft **alle** offenen Refresh Tokens eines Kontos - in jedem Betrieb.

    Fuer Aenderungen am Konto selbst (E-Mail, Passwort, Bereinigung beim
    Entfernen). Ein Betriebsadministrator loest das nur fuer Konten aus, die
    keinem anderen Betrieb angehoeren (ADR 0021); fuer sie ist "alle" und
    "dieser Betrieb" dasselbe.
    """
    tokens = (
        session.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)
            )
        )
        .scalars()
        .all()
    )
    now = datetime.now(tz=UTC)
    for token in tokens:
        token.revoked_at = now
        token.revoked_reason = reason.value
    return len(tokens)


def bump_session_version(session: Session, member_id: uuid.UUID) -> None:
    """Macht jedes bisher ausgestellte Token dieser Mitgliedschaft wertlos.

    Als Core-``UPDATE``: Die Sitzungsversion gehoert nicht zum verwaltbaren
    Zustand und zaehlt ``organization_members.version`` nicht weiter. Aendert
    der Aufrufer die Mitgliedschaft ohnehin (Status, Profil), zaehlt die
    Version dort - nicht hier.
    """
    session.execute(
        update(OrganizationMember)
        .where(OrganizationMember.id == member_id)
        .values(session_version=OrganizationMember.session_version + 1)
        .execution_options(synchronize_session=False)
    )
