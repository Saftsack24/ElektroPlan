"""Migration ``0006 -> 0007``: Benutzerlebenszyklus und Einstellungen (Phase 4e).

Bestand vor 4e: aktive und gesperrte Mitgliedschaften, offene Sitzungen. Die
Migration

* uebernimmt jede Mitgliedschaft **unveraendert** - aktiv bleibt aktiv,
  gesperrt bleibt gesperrt -, Sitzungsversion 1,
* laesst bestehende Refresh Tokens gueltig (Sitzungsversion 1),
* legt ``password_reset_tokens`` und ``user_preferences`` an,
* laesst Autogenerate keinen Unterschied melden,
* laesst sich zurueckrollen - mit den im Downgrade dokumentierten Grenzen fuer
  entfernte Mitgliedschaften.

Eigene Datenbank, Schema ausschliesslich per Alembic. Nur synthetische Daten.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth.service import AuthService, _login_limiter
from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from app.db.session import get_session
from app.model_registry import metadata
from tests.conftest import (
    ADMIN_PASSWORD,
    TEST_DATABASE_URL,
    auth_headers,
    entwicklungsdatenbank_url,
    requires_database,
)
from tests.datenbankschutz import pruefe_testdatenbank

pytestmark = [requires_database, pytest.mark.database]

DB_NAME = "elektroplan_migration_4e_test"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
ADMIN = "admin@bestand-4e.example"


def _url(name: str) -> str:
    base, _, _ = TEST_DATABASE_URL.rpartition("/")
    return f"{base}/{name}"


def _config() -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", _url(DB_NAME))
    return config


@dataclass(frozen=True, slots=True)
class Bestand:
    engine: Engine
    organization_id: uuid.UUID
    gesperrt_member: uuid.UUID
    refresh_token: str


@pytest.fixture(scope="module")
def bestand() -> Iterator[Bestand]:
    pruefe_testdatenbank(_url(DB_NAME), entwicklungsdatenbank_url())
    maintenance = create_engine(_url("postgres"), isolation_level="AUTOCOMMIT", future=True)
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{DB_NAME}"'))

    # Seed und Anmeldung mit dem aktuellen Modell, dann zurueck auf 0006: So
    # entsteht ein Bestand, wie ihn ein Betrieb vor Phase 4e hatte.
    command.upgrade(_config(), "head")
    engine = create_engine(_url(DB_NAME), future=True)
    from app.main import build_registry

    registry: ModuleRegistry = build_registry()
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session: Session = factory()
    try:
        organization_id = seed_initial_data(
            session,
            registry,
            organization_name="Bestand 4e GmbH",
            admin_email=ADMIN,
            admin_password=ADMIN_PASSWORD,
        ).organization_id
        session.commit()
        _login_limiter.clear()
        refresh = AuthService(session).login(email=ADMIN, password=ADMIN_PASSWORD).refresh_token
        session.commit()
    finally:
        session.close()
    command.downgrade(_config(), "0006_data_lifecycle")

    gesperrt_user, gesperrt_member = uuid.uuid4(), uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, password_hash, full_name, is_active) "
                "VALUES (:id, 'gesperrt@bestand-4e.example', 'x', 'Gesperrt Bestand', true)"
            ),
            {"id": gesperrt_user},
        )
        connection.execute(
            text(
                "INSERT INTO organization_members (id, organization_id, user_id, status) "
                "VALUES (:id, :org, :user, 'disabled')"
            ),
            {"id": gesperrt_member, "org": organization_id, "user": gesperrt_user},
        )

    command.upgrade(_config(), "head")
    yield Bestand(engine, organization_id, gesperrt_member, refresh)
    engine.dispose()
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
    maintenance.dispose()


def test_bestehende_mitglieder_bleiben_wie_sie_waren(bestand: Bestand) -> None:
    with bestand.engine.connect() as connection:
        zeilen = connection.execute(
            text(
                "SELECT u.email, m.status, m.session_version, m.lock_reason "
                "FROM organization_members m JOIN users u ON u.id = m.user_id ORDER BY u.email"
            )
        ).all()
        token_versionen = (
            connection.execute(text("SELECT DISTINCT session_version FROM refresh_tokens"))
            .scalars()
            .all()
        )
    assert [tuple(z) for z in zeilen] == [
        (ADMIN, "active", 1, None),
        ("gesperrt@bestand-4e.example", "disabled", 1, None),
    ]
    assert token_versionen == [1]


def test_neue_tabellen_und_kein_unterschied_zum_modell(bestand: Bestand) -> None:
    vorhanden = set(inspect(bestand.engine).get_table_names())
    assert {"password_reset_tokens", "user_preferences"} <= vorhanden
    with bestand.engine.connect() as connection:
        unterschiede = compare_metadata(MigrationContext.configure(connection), metadata)
    assert unterschiede == []


@pytest.fixture
def api(app: FastAPI, bestand: Bestand) -> Iterator[TestClient]:
    factory = sessionmaker(bind=bestand.engine, autoflush=False, expire_on_commit=False)

    def override() -> Iterator[Session]:
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = override
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
    app.dependency_overrides.clear()


def test_bestehende_sitzung_bleibt_nach_der_migration_gueltig(
    api: TestClient, bestand: Bestand
) -> None:
    erneuert = api.post(
        "/api/v1/auth/refresh", headers={"Cookie": f"elektroplan_refresh={bestand.refresh_token}"}
    )
    assert erneuert.status_code == 200, erneuert.text
    me = api.get("/api/v1/me", headers=auth_headers(erneuert.json()["access_token"]))
    assert me.status_code == 200


def test_datenbank_kennt_nur_bekannte_zustaende(bestand: Bestand) -> None:
    with pytest.raises(IntegrityError), bestand.engine.begin() as connection:
        connection.execute(
            text("UPDATE organization_members SET status = 'geloescht' WHERE id = :id"),
            {"id": bestand.gesperrt_member},
        )
    with pytest.raises(IntegrityError), bestand.engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE organization_members SET lock_reason = 'x', status = 'active' "
                "WHERE id = :id"
            ),
            {"id": bestand.gesperrt_member},
        )


def test_downgrade_und_erneutes_upgrade_mit_entfernten_mitgliedschaften(bestand: Bestand) -> None:
    """Ein entferntes Mitglied, das erneut eingeladen wurde, hat zwei Zeilen.

    Der Downgrade loescht den Tombstone neben der aktuellen Mitgliedschaft und
    macht uebrige Tombstones zu ``disabled`` - der alte Stand kennt kein
    Entfernen. Danach laeuft das Upgrade erneut sauber.
    """
    wieder_user, einzeln_user = uuid.uuid4(), uuid.uuid4()
    with bestand.engine.begin() as connection:
        for user_id, email in (
            (wieder_user, "wieder@bestand-4e.example"),
            (einzeln_user, "einzeln@bestand-4e.example"),
        ):
            connection.execute(
                text(
                    "INSERT INTO users (id, email, password_hash, full_name, is_active) "
                    "VALUES (:id, :email, 'x', 'Synthetisch', true)"
                ),
                {"id": user_id, "email": email},
            )
        for status, user_id in (
            ("removed", wieder_user),
            ("active", wieder_user),
            ("removed", einzeln_user),
        ):
            connection.execute(
                text(
                    "INSERT INTO organization_members (organization_id, user_id, status) "
                    "VALUES (:org, :user, :status)"
                ),
                {"org": bestand.organization_id, "user": user_id, "status": status},
            )

    command.downgrade(_config(), "0006_data_lifecycle")
    with bestand.engine.connect() as connection:
        zustaende = connection.execute(
            text(
                "SELECT u.email, m.status FROM organization_members m "
                "JOIN users u ON u.id = m.user_id "
                "WHERE u.email IN ('wieder@bestand-4e.example', 'einzeln@bestand-4e.example') "
                "ORDER BY u.email"
            )
        ).all()
    assert [tuple(z) for z in zustaende] == [
        ("einzeln@bestand-4e.example", "disabled"),
        ("wieder@bestand-4e.example", "active"),
    ]
    verbleibend = set(inspect(bestand.engine).get_table_names())
    assert "password_reset_tokens" not in verbleibend
    assert "user_preferences" not in verbleibend

    command.upgrade(_config(), "head")
    with bestand.engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), metadata) == []
