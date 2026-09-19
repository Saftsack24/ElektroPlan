"""Passwoerter und Tokens (docs/security.md, Abschnitt 3)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.config import get_settings
from app.core.auth.rate_limit import SlidingWindowLimiter
from app.core.auth.security import (
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    validate_password_strength,
    verify_password,
)
from app.errors import AuthenticationError


def test_passwort_hash_ist_argon2id() -> None:
    digest = hash_password("ein-sicheres-passwort")
    assert digest.startswith("$argon2id$")


def test_gleiches_passwort_ergibt_verschiedene_hashes() -> None:
    """Salt pro Hash - identische Passwoerter duerfen nicht gleich aussehen."""
    assert hash_password("gleiches-passwort") != hash_password("gleiches-passwort")


def test_passwortpruefung() -> None:
    digest = hash_password("richtiges-passwort")
    assert verify_password(digest, "richtiges-passwort")
    assert not verify_password(digest, "falsches-passwort")


def test_pruefung_gegen_defekten_hash_wirft_nicht() -> None:
    assert not verify_password("kein-gueltiger-hash", "egal")


def test_passwortregeln() -> None:
    assert validate_password_strength("kurz")
    assert validate_password_strength("password")
    assert validate_password_strength("ausreichend-langes-passwort") == []


# ------------------------------------------------------------- Access Token


def test_access_token_enthaelt_keine_berechtigungen() -> None:
    """Berechtigungen werden pro Request geladen, damit Entzug sofort wirkt."""
    token, _ = create_access_token(
        user_id=uuid.uuid4(), organization_id=uuid.uuid4(), member_id=uuid.uuid4()
    )
    claims = jwt.decode(token, options={"verify_signature": False})
    assert "permissions" not in claims
    assert set(claims) == {"sub", "org", "mid", "iat", "exp", "jti"}


def test_access_token_roundtrip() -> None:
    user_id, org_id, member_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    token, expires_in = create_access_token(
        user_id=user_id, organization_id=org_id, member_id=member_id
    )
    payload = decode_access_token(token)

    assert payload.user_id == user_id
    assert payload.organization_id == org_id
    assert payload.member_id == member_id
    assert expires_in == get_settings().access_token_minutes * 60


def test_abgelaufener_token_wird_abgelehnt() -> None:
    settings = get_settings()
    expired = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "org": str(uuid.uuid4()),
            "mid": str(uuid.uuid4()),
            "exp": int((datetime.now(tz=UTC) - timedelta(minutes=1)).timestamp()),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(AuthenticationError, match="abgelaufen"):
        decode_access_token(expired)


def test_token_mit_falscher_signatur_wird_abgelehnt() -> None:
    forged = jwt.encode({"sub": str(uuid.uuid4())}, "falscher-schluessel", algorithm="HS256")
    with pytest.raises(AuthenticationError, match="Ungueltiges Token"):
        decode_access_token(forged)


def test_token_ohne_pflichtfelder_wird_abgelehnt() -> None:
    settings = get_settings()
    incomplete = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "exp": int((datetime.now(tz=UTC) + timedelta(minutes=5)).timestamp()),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(AuthenticationError):
        decode_access_token(incomplete)


# ------------------------------------------------------------ Refresh Token


def test_refresh_token_wird_nur_als_hash_gespeichert() -> None:
    raw, digest = generate_refresh_token()
    assert raw != digest
    assert len(digest) == 64
    assert hash_refresh_token(raw) == digest


def test_refresh_tokens_sind_eindeutig() -> None:
    tokens = {generate_refresh_token()[0] for _ in range(50)}
    assert len(tokens) == 50


# --------------------------------------------------------------- Rate Limit


def test_rate_limiter_greift_nach_dem_limit() -> None:
    limiter = SlidingWindowLimiter(limit=3, window_seconds=60)
    for _ in range(3):
        assert limiter.check("konto")
        limiter.register("konto")
    assert not limiter.check("konto")


def test_rate_limiter_trennt_schluessel() -> None:
    limiter = SlidingWindowLimiter(limit=1, window_seconds=60)
    limiter.register("a")
    assert not limiter.check("a")
    assert limiter.check("b")


def test_rate_limiter_reset() -> None:
    limiter = SlidingWindowLimiter(limit=1, window_seconds=60)
    limiter.register("konto")
    limiter.reset("konto")
    assert limiter.check("konto")
