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

from sqlalchemy import ColumnElement, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.audit import service as audit
from app.core.auth.models import (
    RefreshToken,
    RefreshTokenFamily,
    RefreshTokenRevocationReason,
)
from app.core.auth.rate_limit import (
    Reservation,
    SlidingWindowLimiter,
    enforce,
    pseudonymous_key,
)
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
#: Fehlversuche je Konto und je IP (docs/security.md, Abschnitt 11).
_login_limiter = SlidingWindowLimiter(
    name="login",
    limit=_settings.login_attempts_per_window,
    window_seconds=_settings.login_window_seconds,
)
#: Erneuerungen je Konto - zaehlt jede Erneuerung mit gueltigem Token.
_refresh_limiter = SlidingWindowLimiter(
    name="refresh",
    limit=_settings.refresh_per_account_per_window,
    window_seconds=_settings.refresh_window_seconds,
)
#: Erneuerungsversuche mit unbekanntem, widerrufenem oder abgelaufenem Token je IP.
_refresh_invalid_limiter = SlidingWindowLimiter(
    name="refresh_invalid",
    limit=_settings.refresh_invalid_per_ip_per_window,
    window_seconds=_settings.refresh_invalid_window_seconds,
)


class _InvalidRefreshTokenError(AuthenticationError):
    """Ablehnung, die als **ungueltiger Versuch** fuer die IP zaehlt.

    Ausschliesslich: unbekannter Token, Token einer widerrufenen Familie,
    widerrufener Token, Wiederverwendung eines ersetzten Tokens nach dem
    Toleranzfenster, abgelaufener Token. Nach aussen identisch mit
    :class:`AuthenticationError`. Alles andere - Erfolg, paralleler Refresh im
    Toleranzfenster, persoenliche Kontogrenze, Kontozustand (deaktiviert,
    Mitgliedschaft gesperrt, Sitzungsversion) und interne Fehler - gibt die
    eigene Reservierung zurueck (Sicherheitsreview 2026-10-10).
    """


_LOGIN_LIMITED = "Zu viele Anmeldeversuche. Bitte spaeter erneut versuchen."
_REFRESH_LIMITED = "Zu viele Sitzungserneuerungen. Bitte spaeter erneut versuchen."


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
        # Pruefen und Reservieren in einem Schritt: Parallele Versuche koennen
        # die Grenze nicht gemeinsam ueberschreiten. Ein abgelehnter Versuch
        # behaelt seine Reservierung (zaehlt), alles andere gibt sie zurueck.
        reservation = self._reserve_attempt(normalized, client_ip)
        try:
            user = self.session.execute(
                select(User).where(User.email == normalized)
            ).scalar_one_or_none()

            if (
                user is None
                or not verify_password(user.password_hash, password)
                or not user.is_active
            ):
                self._reject_login(user)

            assert user is not None  # durch _reject_login ausgeschlossen
            try:
                member = self._select_member(user.id, organization_id)
            except NotFoundError:
                # Gesperrt, entfernt, ohne Mitgliedschaft oder fremder Betrieb:
                # nach aussen nicht vom falschen Passwort zu unterscheiden.
                self._reject_login(user)
        except AuthenticationError:
            raise
        except BaseException:
            # Auch die Auswahl zwischen mehreren Betrieben ist kein Fehlversuch.
            _login_limiter.release(reservation)
            raise
        _login_limiter.release(reservation)
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)

        user.last_login_at = datetime.now(tz=UTC)
        _login_limiter.reset(pseudonymous_key("user", normalized))

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
        reservation = self._reserve_attempt(normalized, client_ip)
        try:
            user = self.session.execute(
                select(User).where(User.email == normalized)
            ).scalar_one_or_none()
        except BaseException:
            _login_limiter.release(reservation)
            raise
        if user is None or not verify_password(user.password_hash, password) or not user.is_active:
            # Die Reservierung bleibt: ein Fehlversuch.
            raise AuthenticationError(LOGIN_REJECTED)
        _login_limiter.release(reservation)
        _login_limiter.reset(pseudonymous_key("user", normalized))
        return user

    # ------------------------------------------------------------ Erneuerung

    def refresh(
        self,
        raw_token: str,
        *,
        user_agent: str | None = None,
        client_ip: str | None = None,
    ) -> IssuedTokens:
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
        # Ungueltige Tokens je IP: vorab reserviert (atomar, gegen parallele
        # Raterei). Die Reservierung bleibt nur bei einer gezaehlten Ablehnung
        # (:class:`_InvalidRefreshTokenError`); in jedem anderen Fall wird
        # genau **diese** Reservierung zurueckgegeben - nie fremde Versuche.
        invalid_reservation = enforce(
            _refresh_invalid_limiter,
            f"ip:{client_ip or 'unbekannt'}",
            message=_REFRESH_LIMITED,
            log_event="refresh_rate_limited",
        )
        try:
            tokens = self._rotate(token_hash, user_agent=user_agent)
        except _InvalidRefreshTokenError:
            raise  # zaehlt: Reservierung bleibt
        except BaseException:
            _refresh_invalid_limiter.release(invalid_reservation)
            raise
        _refresh_invalid_limiter.release(invalid_reservation)
        return tokens

    def _rotate(self, token_hash: str, *, user_agent: str | None) -> IssuedTokens:
        """Kern der Erneuerung - siehe :meth:`refresh`."""
        found = self.session.execute(
            select(RefreshToken.family_id, RefreshToken.user_id).where(
                RefreshToken.token_hash == token_hash
            )
        ).one_or_none()
        if found is None:
            raise _InvalidRefreshTokenError("Die Sitzung ist ungueltig.")
        family_id, user_id = found
        # Erneuerungen je Konto - vor jeder Sperre, damit eine Flut von
        # Erneuerungen keine Datenbanksperren haelt.
        enforce(
            _refresh_limiter,
            f"user:{user_id}",
            message=_REFRESH_LIMITED,
            log_event="refresh_rate_limited",
        )
        # Sperrreihenfolge Konto -> Familie -> Token. ``KEY SHARE`` auf dem
        # Konto braucht der Nachfolger ohnehin (Fremdschluessel); vorab
        # genommen, kann eine Kontoaenderung (Lebenszyklus: ... -> users ->
        # Familien) nicht zwischen Familiensperre und Nachfolger geraten -
        # sonst Deadlock. Familie vor Token wie bei jedem Widerruf: Widerruf
        # und Rotation schliessen sich ueber die Familienzeile aus.
        self.session.execute(
            select(User.id).where(User.id == user_id).with_for_update(read=True, key_share=True)
        )
        family = _lock_family(self.session, family_id)
        stored = self.session.execute(
            select(RefreshToken)
            .where(RefreshToken.token_hash == token_hash)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()

        if stored is None or family is None:
            raise _InvalidRefreshTokenError("Die Sitzung ist ungueltig.")

        if family.is_revoked:
            # Abgeschlossener Widerruf (Logout, Wiederverwendung, Sperre ...):
            # Kein Token dieser Familie erneuert je wieder eine Sitzung - auch
            # kein Nachfolger, den eine gleichzeitige Rotation noch angelegt
            # hat. Kein weiterer Sammelwiderruf noetig.
            logger.info(
                "refresh_family_revoked",
                user_id=str(stored.user_id),
                reason=family.revoked_reason,
            )
            raise _InvalidRefreshTokenError("Die Sitzung ist ungueltig.")

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
                raise _InvalidRefreshTokenError(
                    "Die Sitzung wurde aus Sicherheitsgruenden beendet."
                )
            # Logout, Familienwiderruf oder bereits erkannte Wiederverwendung:
            # kein weiterer Sammelwiderruf noetig, der Token ist ungueltig.
            logger.info(
                "refresh_token_revoked",
                user_id=str(stored.user_id),
                reason=stored.revoked_reason,
            )
            raise _InvalidRefreshTokenError("Die Sitzung ist ungueltig.")

        if stored.expires_at <= datetime.now(tz=UTC):
            raise _InvalidRefreshTokenError("Die Sitzung ist abgelaufen.")

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
        # Nur diese Sitzung (Familie) endet - andere Geraete und Betriebe
        # bleiben angemeldet. Bereits ausgestellte Access Tokens dieser
        # Sitzung laufen bis zu ihrem Ablauf weiter (docs/security.md, Abschnitt 3).
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
        if family_id is None:
            # Neue Sitzung: eigene Familie mit dauerhaft gespeichertem Zustand.
            family = RefreshTokenFamily(user_id=user.id, organization_id=member.organization_id)
            self.session.add(family)
            self.session.flush()
            family_id = family.id
        record = RefreshToken(
            user_id=user.id,
            organization_id=member.organization_id,
            family_id=family_id,
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
        """Widerruft eine Familie dauerhaft - siehe :func:`revoke_family`."""
        revoke_family(self.session, family_id, reason=reason)

    def _reject_login(self, user: User | None) -> NoReturn:
        """Ein abgelehnter Anmeldeversuch - immer derselbe Weg.

        Der Versuch ist bereits je normalisierter E-Mail und je IP reserviert
        und zaehlt damit als Fehlversuch; bei einem vorhandenen Konto ein
        Protokolleintrag nur mit der Konto-ID und einer neutralen
        Beschreibung. Keine E-Mail in Protokoll oder Log.
        """
        if user is not None:
            self._audit_failed_login(user)
        logger.info("login_rejected")
        raise AuthenticationError(LOGIN_REJECTED)

    def _reserve_attempt(self, email: str, client_ip: str | None) -> Reservation:
        """Reserviert atomar einen Versuch je Konto und je IP - oder ``429``."""
        return enforce(
            _login_limiter,
            *self._limit_keys(email, client_ip),
            message=_LOGIN_LIMITED,
            log_event="login_rate_limited",
        )

    @staticmethod
    def _limit_keys(email: str, client_ip: str | None) -> tuple[str, ...]:
        # Die E-Mail steht nur als Hash im Speicher des Limiters.
        keys = [pseudonymous_key("user", email)]
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
    _revoke_families(
        session,
        reason,
        RefreshTokenFamily.user_id == user_id,
        RefreshTokenFamily.organization_id == organization_id,
    )
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
    _revoke_families(session, reason, RefreshTokenFamily.user_id == user_id)
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


def _lock_family(session: Session, family_id: uuid.UUID) -> RefreshTokenFamily | None:
    """Sperrt die Familienzeile (``FOR UPDATE``) und liest ihren aktuellen Stand."""
    return session.execute(
        select(RefreshTokenFamily)
        .where(RefreshTokenFamily.id == family_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def revoke_family(
    session: Session, family_id: uuid.UUID, *, reason: RefreshTokenRevocationReason
) -> None:
    """Widerruft eine Familie **dauerhaft** (Sicherheitsauftrag 2026-10-10, Befund 4).

    Zuerst wird die Familienzeile gesperrt und als widerrufen markiert; eine
    gleichzeitige Rotation wartet auf diese Sperre und scheitert danach am
    Familienzustand. Erst dann werden die Tokenzeilen widerrufen - in einer
    neuen Abfrage, die auch einen inzwischen committeten Nachfolger sieht.
    Rotierte Vorgaenger behalten ihren Grund (``ROTATED``) und werden nicht
    ueberschrieben - die Kette zur Ursache soll lesbar bleiben. Eine schon
    widerrufene Familie behaelt ihren ersten Grund.
    """
    now = datetime.now(tz=UTC)
    family = _lock_family(session, family_id)
    if family is not None and family.revoked_at is None:
        family.revoked_at = now
        family.revoked_reason = reason.value
        session.flush()
    tokens = (
        session.execute(
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


def _revoke_families(
    session: Session, reason: RefreshTokenRevocationReason, *criteria: ColumnElement[bool]
) -> None:
    """Markiert alle noch offenen Familien dauerhaft als widerrufen.

    Das ``UPDATE`` sperrt jede betroffene Familienzeile. Haelt eine laufende
    Rotation die Sperre, wartet es bis zu deren Commit und erfasst die Familie
    danach trotzdem (PostgreSQL wertet die Bedingung nach dem Warten neu aus).
    """
    session.execute(
        update(RefreshTokenFamily)
        .where(RefreshTokenFamily.revoked_at.is_(None), *criteria)
        .values(revoked_at=datetime.now(tz=UTC), revoked_reason=reason.value)
        .execution_options(synchronize_session=False)
    )


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
