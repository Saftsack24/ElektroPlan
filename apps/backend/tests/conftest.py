"""Gemeinsame Test-Fixtures.

Datenbanktests laufen gegen **PostgreSQL**, nie gegen SQLite: Constraints,
``numeric`` und zusammengesetzte Fremdschluessel verhalten sich dort anders
(CLAUDE.md, Abschnitt 9). Ohne ``ELEKTROPLAN_TEST_DATABASE_URL`` werden sie
uebersprungen statt stillschweigend gegen eine andere Engine zu laufen.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest

os.environ.setdefault("ELEKTROPLAN_ENVIRONMENT", "test")
os.environ.setdefault("ELEKTROPLAN_DEBUG", "false")
# Kurzer Verbindungs-Timeout: Tests ohne Datenbank sollen nicht blockieren.
os.environ.setdefault("ELEKTROPLAN_DATABASE_CONNECT_TIMEOUT", "2")
# Object Storage der lokalen Compose-Umgebung. Tests, die ihn brauchen,
# ueberspringen sichtbar, wenn er nicht erreichbar ist.
os.environ.setdefault("ELEKTROPLAN_S3_SECRET_KEY", "elektroplan-dev-secret")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from app.db.session import get_session
from app.main import build_registry, create_app
from app.model_registry import metadata

TEST_DATABASE_URL = os.environ.get("ELEKTROPLAN_TEST_DATABASE_URL", "")
ADMIN_PASSWORD = "test-passwort-1234"

requires_database = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="ELEKTROPLAN_TEST_DATABASE_URL ist nicht gesetzt (PostgreSQL erforderlich).",
)


def object_storage_available() -> bool:
    """Prueft, ob der konfigurierte Object Storage erreichbar ist."""
    import urllib.error
    import urllib.request

    from app.config import get_settings

    url = f"{get_settings().s3_endpoint_url}/minio/health/live"
    try:
        with urllib.request.urlopen(url, timeout=2) as response:  # noqa: S310
            return bool(response.status == 200)
    except (urllib.error.URLError, OSError):
        return False


requires_object_storage = pytest.mark.skipif(
    not object_storage_available(),
    reason="Object Storage (MinIO) ist nicht erreichbar.",
)


# --------------------------------------------------------------- ohne Datenbank


@pytest.fixture
def registry() -> ModuleRegistry:
    """Frisch aufgebaute und gepruefte Module Registry."""
    return build_registry()


@pytest.fixture
def app(registry: ModuleRegistry) -> FastAPI:
    return create_app()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """Client ohne Datenbankzugriff - fuer Fehlerformat und Health."""
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


# ---------------------------------------------------------------- mit Datenbank


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    """Engine auf die Testdatenbank; Schema wird einmal je Lauf erzeugt."""
    if not TEST_DATABASE_URL:
        pytest.skip("Keine Testdatenbank konfiguriert.")
    test_engine = create_engine(TEST_DATABASE_URL, future=True)
    metadata.drop_all(test_engine)
    metadata.create_all(test_engine)
    yield test_engine
    test_engine.dispose()


@pytest.fixture
def db_session(engine: Engine) -> Iterator[Session]:
    """Jeder Test laeuft in einer eigenen Transaktion, die zurueckgerollt wird."""
    connection = engine.connect()
    transaction = connection.begin()
    factory = sessionmaker(bind=connection, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def clean_database(engine: Engine) -> Iterator[None]:
    """Leert alle Tabellen - fuer Tests, die selbst committen muessen."""
    yield
    with engine.begin() as connection:
        tables = ", ".join(f'"{table.name}"' for table in reversed(metadata.sorted_tables))
        connection.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
def api(app: FastAPI, engine: Engine, clean_database: None) -> Iterator[TestClient]:
    """TestClient gegen die Testdatenbank."""
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_session() -> Iterator[Session]:
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = override_session
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def seeded_organization(engine: Engine, registry: ModuleRegistry) -> dict[str, uuid.UUID]:
    """Legt eine Organisation samt Admin an und liefert die IDs."""
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Testbetrieb GmbH",
            admin_email="admin@test.example",
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return {
            "organization_id": result.organization_id,
            "admin_user_id": result.admin_user_id,
        }
    finally:
        session.close()


def login(
    api_client: TestClient,
    email: str,
    password: str = ADMIN_PASSWORD,
    organization_id: uuid.UUID | None = None,
) -> str:
    """Meldet an und liefert den Access Token.

    Der Refresh Token landet im Cookie-Jar des Clients - er steht bewusst nicht
    im Antwortkoerper (docs/security.md, Abschnitt 3).
    """
    payload: dict[str, str] = {"email": email, "password": password}
    if organization_id is not None:
        payload["organization_id"] = str(organization_id)
    response = api_client.post("/api/v1/auth/login", json=payload)
    assert response.status_code == 200, response.text
    token: str = response.json()["access_token"]
    return token


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
