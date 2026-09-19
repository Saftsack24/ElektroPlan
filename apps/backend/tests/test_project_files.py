"""Projektdateien: Upload gegen MinIO, Liste und Download-Adresse.

Das ist das zweite Exit-Kriterium von Phase 2: Ein Plan-PDF laesst sich
hochladen und wieder herunterladen.

Benoetigt PostgreSQL **und** MinIO aus der Compose-Umgebung.
"""

from __future__ import annotations

import urllib.request
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from app.core.files.storage import build_storage_key
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

ADMIN_EMAIL = "admin@projektdateien.example"
PDF = b"%PDF-1.7\n" + b"Grundriss Erdgeschoss" * 20


@pytest.fixture
def betrieb(engine: Engine, registry: ModuleRegistry, clean_database: None) -> uuid.UUID:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Plaene GmbH",
            admin_email=ADMIN_EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


@pytest.fixture
def token(api: TestClient, betrieb: uuid.UUID) -> str:
    return login(api, ADMIN_EMAIL)


@pytest.fixture
def projekt_id(api: TestClient, token: str) -> str:
    kunde = api.post(
        "/api/v1/customers",
        headers=auth_headers(token),
        json={"name": "Bauherr Beispiel"},
    ).json()
    projekt = api.post(
        "/api/v1/projects",
        headers=auth_headers(token),
        json={"customer_id": kunde["id"], "name": "Neubau"},
    ).json()
    return str(projekt["id"])


def _upload(api: TestClient, token: str, projekt_id: str | None) -> dict[str, object]:
    data = {"project_id": projekt_id} if projekt_id else {}
    response = api.post(
        "/api/v1/files",
        headers=auth_headers(token),
        files={"upload": ("grundriss.pdf", PDF, "application/pdf")},
        data=data,
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


# --------------------------------------------------- Upload und Zuordnung


def test_plan_pdf_hochladen_und_herunterladen(api: TestClient, token: str, projekt_id: str) -> None:
    """Exit-Kriterium: hochladen, Adresse holen, Inhalt vergleichen."""
    datei = _upload(api, token, projekt_id)

    assert datei["project_id"] == projekt_id

    adresse = api.get(f"/api/v1/files/{datei['id']}/download-url", headers=auth_headers(token))
    assert adresse.status_code == 200, adresse.text
    body = adresse.json()
    assert body["filename"] == "grundriss.pdf"
    assert body["expires_in"] > 0

    with urllib.request.urlopen(body["url"], timeout=10) as response:  # noqa: S310
        geladen = response.read()

    assert geladen == PDF


def test_datei_ohne_projekt_bleibt_moeglich(api: TestClient, token: str) -> None:
    datei = _upload(api, token, None)

    assert datei["project_id"] is None


def test_upload_auf_unbekanntes_projekt_liefert_404(api: TestClient, token: str) -> None:
    response = api.post(
        "/api/v1/files",
        headers=auth_headers(token),
        files={"upload": ("grundriss.pdf", PDF, "application/pdf")},
        data={"project_id": str(uuid.uuid4())},
    )

    assert response.status_code == 404


def test_projektdateien_werden_aufgelistet(api: TestClient, token: str, projekt_id: str) -> None:
    erste = _upload(api, token, projekt_id)
    ohne_projekt = _upload(api, token, None)

    dateien = api.get(f"/api/v1/projects/{projekt_id}/files", headers=auth_headers(token)).json()

    ids = {item["id"] for item in dateien}
    assert erste["id"] in ids
    assert ohne_projekt["id"] not in ids


def test_dateiliste_eines_unbekannten_projekts_liefert_404(api: TestClient, token: str) -> None:
    response = api.get(f"/api/v1/projects/{uuid.uuid4()}/files", headers=auth_headers(token))

    assert response.status_code == 404


def test_download_wird_protokolliert(api: TestClient, token: str, projekt_id: str) -> None:
    datei = _upload(api, token, projekt_id)
    api.get(f"/api/v1/files/{datei['id']}/download-url", headers=auth_headers(token))

    protokoll = api.get(
        "/api/v1/audit", headers=auth_headers(token), params={"action": "file.downloaded"}
    ).json()

    assert len(protokoll["items"]) == 1


# --------------------------------------------------------- Speicherschluessel


def test_speicherschluessel_enthaelt_das_projekt() -> None:
    """docs/architecture.md, Abschnitt 15."""
    organization_id = uuid.uuid4()
    project_id = uuid.uuid4()
    file_id = uuid.uuid4()

    mit = build_storage_key(organization_id, file_id, "plan.pdf", project_id=project_id)
    ohne = build_storage_key(organization_id, file_id, "plan.pdf")

    assert mit == f"org/{organization_id}/project/{project_id}/{file_id}.pdf"
    assert ohne == f"org/{organization_id}/{file_id}.pdf"


def test_speicherschluessel_ignoriert_verzeichnisangaben() -> None:
    organization_id = uuid.uuid4()
    project_id = uuid.uuid4()
    file_id = uuid.uuid4()

    key = build_storage_key(organization_id, file_id, "../../etc/passwd.pdf", project_id=project_id)

    assert key == f"org/{organization_id}/project/{project_id}/{file_id}.pdf"


# ------------------------------------------- Schreibschutz bei "archived"


def test_upload_auf_archiviertes_projekt_wird_abgelehnt(
    api: TestClient, token: str, projekt_id: str
) -> None:
    """Neue Uploads sind Teil des Schreibschutzes."""
    api.post(
        f"/api/v1/projects/{projekt_id}/archive",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    response = api.post(
        "/api/v1/files",
        headers=auth_headers(token),
        files={"upload": ("grundriss.pdf", PDF, "application/pdf")},
        data={"project_id": projekt_id},
    )

    assert response.status_code == 409
    assert response.json()["type"].endswith("/project-archived")


def test_bestehende_datei_bleibt_nach_dem_archivieren_herunterladbar(
    api: TestClient, token: str, projekt_id: str
) -> None:
    """Lesen und Herunterladen bleiben ausdruecklich erlaubt."""
    datei = _upload(api, token, projekt_id)
    api.post(
        f"/api/v1/projects/{projekt_id}/archive",
        headers={**auth_headers(token), "If-Match": "1"},
    )

    liste = api.get(f"/api/v1/projects/{projekt_id}/files", headers=auth_headers(token))
    adresse = api.get(f"/api/v1/files/{datei['id']}/download-url", headers=auth_headers(token))

    assert liste.status_code == 200
    assert [item["id"] for item in liste.json()] == [datei["id"]]
    assert adresse.status_code == 200
    with urllib.request.urlopen(adresse.json()["url"], timeout=10) as antwort:  # noqa: S310
        assert antwort.read() == PDF
