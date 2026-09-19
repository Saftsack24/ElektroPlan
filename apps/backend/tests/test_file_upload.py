"""Datei-Upload und -Download gegen echten Object Storage (Punkt 6).

Benoetigt PostgreSQL **und** MinIO aus der Compose-Umgebung.
"""

from __future__ import annotations

import urllib.request
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.core.files.models import FileRecord
from app.core.files.service import FileService
from app.core.files.storage import (
    build_storage_key,
    content_disposition,
    get_object_storage,
    matches_magic_bytes,
)
from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from tests.conftest import (
    ADMIN_PASSWORD,
    auth_headers,
    login,
    requires_database,
    requires_object_storage,
)

pytestmark = [requires_database, requires_object_storage, pytest.mark.database]

ADMIN_EMAIL = "admin@test.example"
FREMD_EMAIL = "admin@fremd.example"
PDF = b"%PDF-1.7\n" + b"x" * 200


@pytest.fixture
def betrieb(engine: Engine, registry: ModuleRegistry, clean_database: None) -> uuid.UUID:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Datei GmbH",
            admin_email=ADMIN_EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


@pytest.fixture
def fremder_betrieb(engine: Engine, registry: ModuleRegistry) -> uuid.UUID:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Fremd GmbH",
            admin_email=FREMD_EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


def upload(client: TestClient, token: str, name: str, data: bytes, content_type: str):
    return client.post(
        "/api/v1/files",
        headers=auth_headers(token),
        files={"upload": (name, data, content_type)},
    )


# ------------------------------------------------------------------ Erfolg


def test_upload_und_download(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)

    response = upload(api, token, "grundriss.pdf", PDF, "application/pdf")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["filename"] == "grundriss.pdf"
    assert body["size_bytes"] == len(PDF)
    assert len(body["sha256"]) == 64

    weiterleitung = api.get(
        f"/api/v1/files/{body['id']}/download",
        headers=auth_headers(token),
        follow_redirects=False,
    )
    assert weiterleitung.status_code == 307
    signierte_url = weiterleitung.headers["location"]

    # Punkt 2: Die URL muss aus der Hostumgebung heraus funktionieren.
    with urllib.request.urlopen(signierte_url, timeout=10) as geladen:  # noqa: S310
        inhalt = geladen.read()
    assert inhalt == PDF


def test_signierte_url_nutzt_den_oeffentlichen_endpunkt(
    api: TestClient, betrieb: uuid.UUID
) -> None:
    """Punkt 2: Signiert wird mit dem Endpunkt, den der Browser aufruft."""
    token = login(api, ADMIN_EMAIL)
    datei = upload(api, token, "plan.pdf", PDF, "application/pdf").json()

    ziel = api.get(
        f"/api/v1/files/{datei['id']}/download",
        headers=auth_headers(token),
        follow_redirects=False,
    ).headers["location"]

    assert ziel.startswith(get_settings().s3_signing_endpoint_url)
    assert "X-Amz-Signature=" in ziel


def test_groesse_knapp_unter_dem_limit(
    api: TestClient, betrieb: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "upload_max_bytes", 4096)
    token = login(api, ADMIN_EMAIL)

    daten = b"%PDF-1.7\n" + b"y" * (4096 - 9)
    assert len(daten) == 4096

    assert upload(api, token, "knapp.pdf", daten, "application/pdf").status_code == 201


# ----------------------------------------------------------------- Ablehnung


def test_leere_datei_wird_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    response = upload(api, token, "leer.pdf", b"", "application/pdf")
    assert response.status_code == 422
    assert "leer" in response.json()["detail"].lower()


def test_zu_grosse_datei_wird_abgelehnt(
    api: TestClient, betrieb: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "upload_max_bytes", 1024)
    token = login(api, ADMIN_EMAIL)

    response = upload(api, token, "gross.pdf", b"%PDF-1.7\n" + b"z" * 5000, "application/pdf")

    assert response.status_code == 422
    assert "groesser" in response.json()["detail"].lower()


def test_falsche_magic_bytes_werden_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    response = upload(api, token, "fake.pdf", b"<html>kein PDF</html>", "application/pdf")
    assert response.status_code == 422


def test_nicht_erlaubter_typ_wird_abgelehnt(api: TestClient, betrieb: uuid.UUID) -> None:
    token = login(api, ADMIN_EMAIL)
    response = upload(api, token, "seite.svg", b"<svg></svg>", "image/svg+xml")
    assert response.status_code == 422


def test_ungewoehnlicher_dateiname_wird_entschaerft(api: TestClient, betrieb: uuid.UUID) -> None:
    """Weder Pfad noch Header duerfen sich aus dem Dateinamen ergeben."""
    token = login(api, ADMIN_EMAIL)
    boeser_name = '../../etc/passwd";\r\nX-Injected: 1.pdf'

    response = upload(api, token, boeser_name, PDF, "application/pdf")
    assert response.status_code == 201

    ziel = api.get(
        f"/api/v1/files/{response.json()['id']}/download",
        headers=auth_headers(token),
        follow_redirects=False,
    ).headers["location"]
    assert "\r" not in ziel and "\n" not in ziel


def test_content_disposition_ist_injektionssicher() -> None:
    wert = content_disposition('bericht";\r\nX-Injected: 1.pdf')
    assert "\r" not in wert
    assert "\n" not in wert
    assert wert.startswith("attachment; filename=")
    assert "filename*=UTF-8''" in wert


def test_speicherschluessel_ignoriert_den_pfad() -> None:
    org_id, file_id = uuid.uuid4(), uuid.uuid4()
    key = build_storage_key(org_id, file_id, "../../etc/passwd.pdf")
    assert key == f"org/{org_id}/{file_id}.pdf"


def test_magic_bytes_matrix() -> None:
    assert matches_magic_bytes("application/pdf", b"%PDF-1.7")
    assert not matches_magic_bytes("application/pdf", b"<html>")
    assert not matches_magic_bytes("image/svg+xml", b"<svg>")


# ------------------------------------------------------------- Fehlerpfade


def test_storage_fehler_hinterlaesst_keinen_datensatz(
    api: TestClient, engine: Engine, betrieb: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Punkt 6: Bei einem S3-Fehler darf kein Datenbankdatensatz zurueckbleiben."""

    def kaputt(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("S3 nicht erreichbar")

    monkeypatch.setattr(type(get_object_storage()), "put_stream", kaputt)
    token = login(api, ADMIN_EMAIL)

    response = upload(api, token, "fehler.pdf", PDF, "application/pdf")
    assert response.status_code == 500

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        assert session.query(FileRecord).count() == 0
    finally:
        session.close()


def test_commit_fehler_raeumt_das_objekt_ab(
    api: TestClient, engine: Engine, betrieb: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Punkt 6: Scheitert der Commit, wird das bereits geladene Objekt geloescht."""
    geloescht: list[str] = []
    storage = get_object_storage()
    original_delete = storage.delete

    def merken(key: str) -> None:
        geloescht.append(key)
        original_delete(key)

    def commit_faellt_aus(self: object) -> None:
        raise RuntimeError("Datenbankfehler nach dem Upload")

    monkeypatch.setattr(storage, "delete", merken)
    monkeypatch.setattr(FileService, "finalize", FileService.finalize)

    token = login(api, ADMIN_EMAIL)

    from sqlalchemy.orm import Session as SqlSession

    monkeypatch.setattr(SqlSession, "commit", commit_faellt_aus)
    response = upload(api, token, "commitfehler.pdf", PDF, "application/pdf")
    monkeypatch.undo()

    assert response.status_code == 500
    assert geloescht, "Das verwaiste Objekt wurde nicht entfernt"


# -------------------------------------------------------------- Mandanten


def test_fremde_datei_ist_nicht_lesbar(
    api: TestClient, betrieb: uuid.UUID, fremder_betrieb: uuid.UUID
) -> None:
    token = login(api, ADMIN_EMAIL)
    datei = upload(api, token, "eigen.pdf", PDF, "application/pdf").json()

    fremd_token = login(api, FREMD_EMAIL)
    assert (
        api.get(f"/api/v1/files/{datei['id']}", headers=auth_headers(fremd_token)).status_code
        == 404
    )


def test_fremder_bekommt_keine_download_url(
    api: TestClient, betrieb: uuid.UUID, fremder_betrieb: uuid.UUID
) -> None:
    token = login(api, ADMIN_EMAIL)
    datei = upload(api, token, "eigen.pdf", PDF, "application/pdf").json()

    fremd_token = login(api, FREMD_EMAIL)
    response = api.get(
        f"/api/v1/files/{datei['id']}/download",
        headers=auth_headers(fremd_token),
        follow_redirects=False,
    )
    assert response.status_code == 404
    assert "location" not in response.headers
