"""Passwoerter, Tokens, Hashes (docs/security.md, Abschnitt 3)."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.config import get_settings
from app.errors import AuthenticationError

_hasher = PasswordHasher()


# ------------------------------------------------------------------ Passwoerter


def hash_password(password: str) -> str:
    """Argon2id-Hash. Kein bcrypt, kein SHA-Derivat."""
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Prueft ein Passwort. Laeuft in konstanter Zeit gegen den Hash."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True, wenn der Hash mit veralteten Parametern erzeugt wurde."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def validate_password_strength(password: str) -> list[str]:
    """Liefert Verstoesse gegen die Passwortregeln (leer = in Ordnung)."""
    settings = get_settings()
    problems: list[str] = []
    if len(password) < settings.password_min_length:
        problems.append(
            f"Das Passwort muss mindestens {settings.password_min_length} Zeichen haben."
        )
    if password.lower() in {"password", "passwort", "12345678", "elektroplan"}:
        problems.append("Das Passwort ist zu leicht zu erraten.")
    return problems


# ---------------------------------------------------------------- Access Token


@dataclass(frozen=True, slots=True)
class AccessTokenPayload:
    """Inhalt eines Access Tokens.

    Berechtigungen stehen bewusst **nicht** im Token: Sie werden pro Request
    serverseitig geladen, damit ein Entzug sofort wirkt.
    """

    user_id: uuid.UUID
    organization_id: uuid.UUID
    member_id: uuid.UUID
    #: ``organization_members.session_version`` bei der Ausstellung. Jede
    #: Anfrage vergleicht sie mit dem aktuellen Stand (Phase 4e, ADR 0021).
    session_version: int
    expires_at: datetime


def create_access_token(
    *,
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    member_id: uuid.UUID,
    session_version: int,
) -> tuple[str, int]:
    """Erzeugt einen kurzlebigen Access Token. Liefert Token und Laufzeit."""
    settings = get_settings()
    now = datetime.now(tz=UTC)
    expires_at = now + timedelta(minutes=settings.access_token_minutes)
    claims = {
        "sub": str(user_id),
        "org": str(organization_id),
        "mid": str(member_id),
        "sv": session_version,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(
        claims,
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
        headers={"kid": settings.jwt_key_id},
    )
    return token, settings.access_token_minutes * 60


def decode_access_token(token: str) -> AccessTokenPayload:
    """Prueft und entpackt einen Access Token."""
    settings = get_settings()
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("Die Sitzung ist abgelaufen.") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError("Ungueltiges Token.") from exc
    try:
        session_version = claims["sv"]
        # Ein Token ohne Sitzungsversion stammt aus der Zeit vor Phase 4e. Er
        # gilt nicht - der Client erneuert die Sitzung einmal ueber das Cookie.
        if type(session_version) is not int:
            raise ValueError("sv")
        return AccessTokenPayload(
            user_id=uuid.UUID(claims["sub"]),
            organization_id=uuid.UUID(claims["org"]),
            member_id=uuid.UUID(claims["mid"]),
            session_version=session_version,
            expires_at=datetime.fromtimestamp(claims["exp"], tz=UTC),
        )
    except (KeyError, ValueError) as exc:
        raise AuthenticationError("Ungueltiges Token.") from exc


# ------------------------------------------------------------ Einmal-Tokens


#: 32 Byte = 256 Bit Zufall; als URL-sicheres Base64 43 Zeichen lang.
ONE_TIME_TOKEN_BYTES = 32
#: Obergrenze fuer ein vorgelegtes Einmal-Token. Laengere Werte sind nie
#: gueltig und werden nicht erst gehasht.
MAX_ONE_TIME_TOKEN_LENGTH = 128


def hash_one_time_token(raw: str) -> str:
    """SHA-256 eines Einmal-Tokens als Hex (64 Zeichen).

    Gemeinsam fuer Einladungen und Reset-Links. Ein KDF ist bei 256 Bit
    Zufall nicht noetig: Raten ist aussichtslos.
    """
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate_one_time_token() -> tuple[str, str]:
    """Erzeugt ``(klartext, hash)``. Gespeichert wird ausschliesslich der Hash."""
    raw = secrets.token_urlsafe(ONE_TIME_TOKEN_BYTES)
    return raw, hash_one_time_token(raw)


# --------------------------------------------------------------- Refresh Token


def generate_refresh_token() -> tuple[str, str]:
    """Erzeugt ``(klartext, hash)``. Gespeichert wird ausschliesslich der Hash."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    """SHA-256 des Tokens. Der Wert hat hohe Entropie, daher kein KDF noetig."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
