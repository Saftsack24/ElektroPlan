"""Migration ``0005 -> 0006``: Ende des Soft Delete fuer Kunden und Projekte (Phase 4d).

Ausgangslage vor 4d: Kunden und Projekte konnten ausgeblendet werden
(``deleted_at``). Mit 4d ist das Ausblenden abgeschafft (ADR 0020). Die Migration

* entfernt ``customers.deleted_at`` und ``projects.deleted_at``,
* **loescht keine Zeile** - vorher ausgeblendete Datensaetze sind danach wieder
  normal sichtbar,
* laesst sich zurueckrollen; die Spalten entstehen dann leer (nullable).

Danach gelten fuer die wieder sichtbaren Datensaetze die neuen Regeln: Projekt
loeschen, Kundenloeschung erst ohne Projekte.

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
from sqlalchemy.orm import Session, sessionmaker

from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from app.db.session import get_session
from app.model_registry import metadata
from tests.conftest import (
    ADMIN_PASSWORD,
    TEST_DATABASE_URL,
    auth_headers,
    entwicklungsdatenbank_url,
    login,
    requires_database,
)
from tests.datenbankschutz import pruefe_testdatenbank

pytestmark = [requires_database, pytest.mark.database]

DB_NAME = "elektroplan_migration_4d_test"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
ADMIN_A = "admin@altbestand-a.example"
ADMIN_B = "admin@altbestand-b.example"


def _url(name: str) -> str:
    base, _, _ = TEST_DATABASE_URL.rpartition("/")
    return f"{base}/{name}"


def _config() -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", _url(DB_NAME))
    return config


@dataclass(frozen=True, slots=True)
class Altbestand:
    engine: Engine
    org_a: uuid.UUID
    kunde: uuid.UUID
    laufend: uuid.UUID
    abgeschlossen: uuid.UUID
    archiviert: uuid.UUID
    kunde2: uuid.UUID
    projekt2: uuid.UUID


def _seed(engine: Engine, registry: ModuleRegistry, name: str, email: str) -> uuid.UUID:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session: Session = factory()
    try:
        result = seed_initial_data(
            session,
            registry,
            organization_name=name,
            admin_email=email,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        return result.organization_id
    finally:
        session.close()


@pytest.fixture(scope="module")
def altbestand() -> Iterator[Altbestand]:
    """Schema bis ``0005``, ausgeblendeter Altbestand, danach ``0006``."""
    pruefe_testdatenbank(_url(DB_NAME), entwicklungsdatenbank_url())
    maintenance = create_engine(_url("postgres"), isolation_level="AUTOCOMMIT", future=True)
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{DB_NAME}"'))

    # Der Seed benutzt die aktuellen ORM-Modelle. Er laeuft deshalb auf dem
    # aktuellen Schema; danach geht es zurueck auf 0005, wo der ausgeblendete
    # Altbestand entsteht (seit Phase 4e kennt das Modell Spalten, die es in
    # 0005 noch nicht gibt).
    command.upgrade(_config(), "head")
    engine = create_engine(_url(DB_NAME), future=True)

    from app.main import build_registry

    registry = build_registry()
    org_a = _seed(engine, registry, "Altbestand A GmbH", ADMIN_A)
    _seed(engine, registry, "Altbestand B GmbH", ADMIN_B)
    command.downgrade(_config(), "0005_member_administration")

    kunde, laufend, abgeschlossen, archiviert, kunde2, projekt2 = (uuid.uuid4() for _ in range(6))
    with engine.begin() as connection:
        for kid, nummer, name in (
            (kunde, "KD-00001", "Ausgeblendet Kunde"),
            (kunde2, "KD-00002", "Ausgeblendet Kunde Zwei"),
        ):
            connection.execute(
                text(
                    "INSERT INTO customers (id, organization_id, customer_number, kind, name, "
                    "billing_country_code, deleted_at) VALUES "
                    "(:id, :org, :nummer, 'private', :name, 'DE', now())"
                ),
                {"id": kid, "org": org_a, "nummer": nummer, "name": name},
            )
        for pid, kid, nummer, status in (
            (laufend, kunde, "PR-2026-0001", "active"),
            (abgeschlossen, kunde, "PR-2026-0002", "completed"),
            (archiviert, kunde, "PR-2026-0003", "archived"),
            (projekt2, kunde2, "PR-2026-0004", "draft"),
        ):
            connection.execute(
                text(
                    "INSERT INTO projects (id, organization_id, customer_id, project_number, "
                    "name, status, site_country_code, deleted_at) VALUES "
                    "(:id, :org, :kunde, :nummer, :name, :status, 'DE', now())"
                ),
                {
                    "id": pid,
                    "org": org_a,
                    "kunde": kid,
                    "nummer": nummer,
                    "name": f"Ausgeblendet {status}",
                    "status": status,
                },
            )
        # Nummernkreise wie im echten Bestand, damit neue Nummern nicht kollidieren.
        connection.execute(
            text(
                "INSERT INTO number_sequences (organization_id, scope, period, current_value) "
                "VALUES (:org, 'customer', '', 2), (:org, 'project', :jahr, 4)"
            ),
            {"org": org_a, "jahr": "2026"},
        )

    command.upgrade(_config(), "head")
    yield Altbestand(engine, org_a, kunde, laufend, abgeschlossen, archiviert, kunde2, projekt2)
    engine.dispose()
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
    maintenance.dispose()


@pytest.fixture
def api(app: FastAPI, altbestand: Altbestand) -> Iterator[TestClient]:
    factory = sessionmaker(bind=altbestand.engine, autoflush=False, expire_on_commit=False)

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


def _ids(api: TestClient, token: str, **params: object) -> set[str]:
    body = api.get("/api/v1/projects", headers=auth_headers(token), params=params).json()
    return {item["id"] for item in body["items"]}


# ------------------------------------------------------------------ Schema


def test_zeilen_bleiben_und_spalten_sind_entfernt(altbestand: Altbestand) -> None:
    inspector = inspect(altbestand.engine)
    assert "deleted_at" not in {c["name"] for c in inspector.get_columns("customers")}
    assert "deleted_at" not in {c["name"] for c in inspector.get_columns("projects")}
    with altbestand.engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM customers")).scalar_one() == 2
        assert connection.execute(text("SELECT count(*) FROM projects")).scalar_one() == 4


def test_autogenerate_meldet_keinen_unterschied(altbestand: Altbestand) -> None:
    with altbestand.engine.connect() as connection:
        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "target_metadata": metadata}
        )
        unterschiede = [
            diff
            for diff in compare_metadata(context, metadata)
            if not (isinstance(diff, tuple) and diff and str(diff[0]).endswith("_index"))
        ]
    assert unterschiede == []


# ---------------------------------------------------------- Sichtbarkeit


def test_ehemals_ausgeblendete_datensaetze_sind_wieder_sichtbar(
    api: TestClient, altbestand: Altbestand
) -> None:
    token = login(api, ADMIN_A)

    kunden = api.get("/api/v1/customers", headers=auth_headers(token)).json()
    assert {k["id"] for k in kunden["items"]} == {str(altbestand.kunde), str(altbestand.kunde2)}
    assert (
        api.get(f"/api/v1/customers/{altbestand.kunde}", headers=auth_headers(token)).status_code
        == 200
    )
    assert _ids(api, token, status_group="current") == {
        str(altbestand.laufend),
        str(altbestand.projekt2),
    }
    assert _ids(api, token, status_group="closed") == {
        str(altbestand.abgeschlossen),
        str(altbestand.archiviert),
    }


def test_mandantentrennung_bleibt_erhalten(api: TestClient, altbestand: Altbestand) -> None:
    token = login(api, ADMIN_B)

    assert api.get("/api/v1/customers", headers=auth_headers(token)).json()["items"] == []
    assert _ids(api, token) == set()
    assert (
        api.get(f"/api/v1/projects/{altbestand.laufend}", headers=auth_headers(token)).status_code
        == 404
    )
    antwort = api.delete(
        f"/api/v1/customers/{altbestand.kunde}",
        headers={**auth_headers(token), "If-Match": "1"},
    )
    assert antwort.status_code == 404


# ------------------------------------------------------- neue Regeln greifen


def _kunde_loeschen(api: TestClient, token: str, kunde: uuid.UUID) -> int:
    return api.delete(
        f"/api/v1/customers/{kunde}", headers={**auth_headers(token), "If-Match": "1"}
    ).status_code


def test_nach_projektloeschung_ist_der_kunde_loeschbar(
    api: TestClient, altbestand: Altbestand
) -> None:
    token = login(api, ADMIN_A)

    assert _kunde_loeschen(api, token, altbestand.kunde2) == 409
    geloescht = api.delete(
        f"/api/v1/projects/{altbestand.projekt2}",
        headers={**auth_headers(token), "If-Match": "1"},
    )
    assert geloescht.status_code == 204, geloescht.text
    assert _kunde_loeschen(api, token, altbestand.kunde2) == 204


def test_archiviertes_altprojekt_bleibt_und_blockiert_den_kunden(
    api: TestClient, altbestand: Altbestand
) -> None:
    """Archiviert bleibt archiviert - der Kunde ist dann nach den Regeln nicht loeschbar."""
    token = login(api, ADMIN_A)

    assert (
        api.delete(
            f"/api/v1/projects/{altbestand.laufend}",
            headers={**auth_headers(token), "If-Match": "1"},
        ).status_code
        == 204
    )
    wieder = api.post(
        f"/api/v1/projects/{altbestand.abgeschlossen}/reopen",
        headers={**auth_headers(token), "If-Match": "1"},
    )
    assert wieder.status_code == 200, wieder.text
    assert (
        api.delete(
            f"/api/v1/projects/{altbestand.abgeschlossen}",
            headers={**auth_headers(token), "If-Match": str(wieder.json()["version"])},
        ).status_code
        == 204
    )
    archiv = api.delete(
        f"/api/v1/projects/{altbestand.archiviert}",
        headers={**auth_headers(token), "If-Match": "1"},
    )
    assert archiv.status_code == 409
    assert _kunde_loeschen(api, token, altbestand.kunde) == 409


# ---------------------------------------------------------------- Rueckbau


def test_downgrade_legt_die_spalten_nullable_wieder_an(altbestand: Altbestand) -> None:
    command.downgrade(_config(), "0005_member_administration")
    try:
        inspector = inspect(altbestand.engine)
        for tabelle in ("customers", "projects"):
            spalte = next(c for c in inspector.get_columns(tabelle) if c["name"] == "deleted_at")
            assert spalte["nullable"] is True
    finally:
        command.upgrade(_config(), "head")
    assert "deleted_at" not in {
        c["name"] for c in inspect(altbestand.engine).get_columns("projects")
    }
