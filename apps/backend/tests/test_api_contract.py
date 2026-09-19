"""API-Vertrag: Fehlerformat, Header, Uploadpruefung, Pagination."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.core.files.storage import build_storage_key, matches_magic_bytes
from app.core.pagination import clamp_limit, decode_cursor, encode_cursor
from app.errors import PROBLEM_CONTENT_TYPE, ValidationFailedError

# ------------------------------------------------------------- Fehlerformat


def test_fehler_folgt_rfc_9457(client: TestClient) -> None:
    response = client.get("/api/v1/me")

    assert response.status_code == 401
    assert response.headers["content-type"].startswith(PROBLEM_CONTENT_TYPE)
    body = response.json()
    assert body["type"].endswith("/authentication-failed")
    assert body["status"] == 401
    assert body["instance"] == "/api/v1/me"
    assert body["request_id"]


def test_fehler_enthaelt_keinen_stacktrace(client: TestClient) -> None:
    body = client.get("/api/v1/me").json()
    serialized = str(body)
    assert "Traceback" not in serialized
    assert "app\\" not in serialized and "app/" not in serialized


def test_validierungsfehler_nennt_felder(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"email": "keine-mail"})

    assert response.status_code == 422
    body = response.json()
    assert body["type"].endswith("/validation-failed")
    fields = {error["field"] for error in body["errors"]}
    assert "email" in fields
    assert "password" in fields


def test_unbekannte_felder_werden_abgelehnt(client: TestClient) -> None:
    """``extra='forbid'`` - Whitelist statt Blacklist."""
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "a@b.de", "password": "x", "is_admin": True},
    )
    assert response.status_code == 422


def test_request_id_header_wird_gesetzt(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.headers["X-Request-Id"]


def test_request_id_wird_uebernommen(client: TestClient) -> None:
    response = client.get("/health/live", headers={"X-Request-Id": "eigene-id-123"})
    assert response.headers["X-Request-Id"] == "eigene-id-123"


def test_sicherheitsheader_sind_gesetzt(client: TestClient) -> None:
    headers = client.get("/health/live").headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Referrer-Policy"] == "same-origin"


def test_liveness_ohne_datenbank(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readiness_meldet_fehlende_datenbank(client: TestClient) -> None:
    """Ohne erreichbare Datenbank ist der Dienst nicht bereit - aber er stuerzt nicht ab."""
    response = client.get("/health/ready")
    assert response.status_code in (200, 503)
    if response.status_code == 503:
        assert response.json()["database"] is False


# ------------------------------------------------------------------ Uploads


@pytest.mark.parametrize(
    ("content_type", "head", "erwartet"),
    [
        ("application/pdf", b"%PDF-1.7", True),
        ("application/pdf", b"<html>", False),
        ("image/png", b"\x89PNG\r\n\x1a\n", True),
        ("image/jpeg", b"\xff\xd8\xff\xe0", True),
        ("image/jpeg", b"%PDF-1.7", False),
        ("text/csv", b"a;b;c", True),
        ("image/svg+xml", b"<svg>", False),
        ("text/html", b"<html>", False),
    ],
)
def test_inhaltspruefung(content_type: str, head: bytes, erwartet: bool) -> None:
    """Geprueft wird der tatsaechliche Inhalt, nicht die Endung."""
    assert matches_magic_bytes(content_type, head) is erwartet


def test_speicherschluessel_verwendet_nicht_den_dateinamen() -> None:
    org_id, file_id = uuid.uuid4(), uuid.uuid4()
    key = build_storage_key(org_id, file_id, "../../etc/passwd.pdf")

    assert key == f"org/{org_id}/{file_id}.pdf"
    assert ".." not in key


def test_speicherschluessel_ohne_endung() -> None:
    org_id, file_id = uuid.uuid4(), uuid.uuid4()
    assert build_storage_key(org_id, file_id, "datei") == f"org/{org_id}/{file_id}"


# --------------------------------------------------------------- Pagination


def test_cursor_roundtrip() -> None:
    moment = datetime.now(tz=UTC)
    entity_id = uuid.uuid4()
    assert decode_cursor(encode_cursor(moment, entity_id)) == (moment, entity_id)


def test_ungueltiger_cursor_ist_eingabefehler() -> None:
    with pytest.raises(ValidationFailedError):
        decode_cursor("kein-gueltiger-cursor")


def test_limit_wird_begrenzt() -> None:
    assert clamp_limit(0) == 1
    assert clamp_limit(50) == 50
    assert clamp_limit(10_000) == 200
