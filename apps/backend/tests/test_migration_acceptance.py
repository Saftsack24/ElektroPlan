"""Migrationsabnahme gegen eine leere PostgreSQL-Datenbank (Punkt 7).

Diese Tests beweisen, dass die Alembic-Migration selbst funktioniert. Sie
verwenden eine **eigene** Datenbank und rufen bewusst **kein**
``metadata.create_all()`` auf - sonst wuerde das migrierte Schema durch das
ORM-Schema ersetzt und die Migration bliebe ungeprueft.

Die uebrigen fachlichen Tests duerfen weiterhin die schnellere
``create_all``-Fixture nutzen; der Abgleich zwischen beiden erfolgt hier ueber
``compare_metadata``.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.core.authorization.models import MemberRole, Role
from app.core.module_registry.registry import ModuleRegistry
from app.core.organizations.models import Organization, OrganizationMember
from app.core.seed import seed_initial_data
from app.db.session import get_session
from app.model_registry import metadata
from tests.conftest import (
    ADMIN_PASSWORD,
    TEST_DATABASE_URL,
    auth_headers,
    login,
    requires_database,
)

pytestmark = [requires_database, pytest.mark.database]

MIGRATION_DB_NAME = "elektroplan_migration_test"
ADMIN_EMAIL = "admin@migration.example"
BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _migration_database_url() -> str:
    base, _, _ = TEST_DATABASE_URL.rpartition("/")
    return f"{base}/{MIGRATION_DB_NAME}"


def _maintenance_url() -> str:
    base, _, _ = TEST_DATABASE_URL.rpartition("/")
    return f"{base}/postgres"


@pytest.fixture(scope="module")
def migrated_engine() -> Iterator[Engine]:
    """Leere Datenbank, ausschliesslich per ``alembic upgrade head`` aufgebaut."""
    maintenance = create_engine(_maintenance_url(), isolation_level="AUTOCOMMIT", future=True)
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{MIGRATION_DB_NAME}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{MIGRATION_DB_NAME}"'))

    url = _migration_database_url()
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", url)
    # Kein create_all: Das Schema entsteht allein aus der Migration.
    command.upgrade(config, "head")

    engine = create_engine(url, future=True)
    yield engine
    engine.dispose()
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{MIGRATION_DB_NAME}" WITH (FORCE)'))
    maintenance.dispose()


# ------------------------------------------------------------------ Migration


def test_genau_ein_alembic_head() -> None:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()
    assert len(heads) == 1, f"Es muss genau einen Head geben, gefunden: {heads}"


def test_migration_erzeugt_alle_tabellen(migrated_engine: Engine) -> None:
    vorhanden = set(inspect(migrated_engine).get_table_names())
    erwartet = {table.name for table in metadata.sorted_tables}

    assert erwartet <= vorhanden, f"Fehlende Tabellen: {sorted(erwartet - vorhanden)}"
    assert "alembic_version" in vorhanden


def test_migration_und_orm_laufen_nicht_auseinander(migrated_engine: Engine) -> None:
    """Das migrierte Schema muss dem ORM-Modell entsprechen."""
    with migrated_engine.connect() as connection:
        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "target_metadata": metadata}
        )
        unterschiede = compare_metadata(context, metadata)

    relevante = [
        diff
        for diff in unterschiede
        # Indizes, die PostgreSQL implizit ueber Constraints anlegt, meldet
        # Alembic je nach Version als Unterschied - sie sind keine Drift.
        if not (isinstance(diff, tuple) and diff and str(diff[0]).endswith("_index"))
    ]
    assert not relevante, f"Schema-Drift zwischen Migration und ORM: {relevante}"


def test_zusammengesetzte_fremdschluessel_sind_vorhanden(migrated_engine: Engine) -> None:
    """ADR 0006 muss im migrierten Schema tatsaechlich stehen."""
    inspector = inspect(migrated_engine)
    keys = inspector.get_foreign_keys("member_roles")

    zusammengesetzt = [key for key in keys if len(key["constrained_columns"]) == 2]
    ziele = {key["referred_table"] for key in zusammengesetzt}

    assert len(zusammengesetzt) == 2, f"Erwartet: zwei zusammengesetzte Schluessel, {keys}"
    assert ziele == {"organization_members", "roles"}
    for key in zusammengesetzt:
        assert "organization_id" in key["constrained_columns"]


def test_downgrade_und_erneutes_upgrade(migrated_engine: Engine) -> None:
    """Der Rueckbau der Initialmigration ist trivial und wird hier geprueft."""
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", _migration_database_url())

    command.downgrade(config, "base")
    verbleibend = set(inspect(migrated_engine).get_table_names()) - {"alembic_version"}
    assert not verbleibend, f"Nach downgrade verbleiben Tabellen: {sorted(verbleibend)}"

    command.upgrade(config, "head")
    assert "organizations" in inspect(migrated_engine).get_table_names()


# ----------------------------------------------------------------------- Seed


def test_seed_ist_idempotent(migrated_engine: Engine, registry: ModuleRegistry) -> None:
    """Zweimal ausfuehren darf nichts duplizieren."""
    factory = sessionmaker(bind=migrated_engine, autoflush=False, expire_on_commit=False)

    def seed_lauf() -> uuid.UUID:
        session: Session = factory()
        try:
            result = seed_initial_data(
                session,
                registry,
                organization_name="Elektro Migration GmbH",
                admin_email=ADMIN_EMAIL,
                admin_password=ADMIN_PASSWORD,
            )
            session.commit()
            return result.organization_id
        finally:
            session.close()

    erste = seed_lauf()
    zweite = seed_lauf()
    assert erste == zweite

    session = factory()
    try:
        assert session.query(Organization).count() == 1
        assert session.query(OrganizationMember).count() == 1
        assert session.query(Role).filter(Role.organization_id == erste).count() == 6
        assert session.query(MemberRole).count() == 1
    finally:
        session.close()


# --------------------------------------------------- Anwendung auf dem Schema


@pytest.fixture
def migrated_api(app, migrated_engine: Engine, registry: ModuleRegistry) -> Iterator[TestClient]:
    """Anwendung gegen das migrierte Schema."""
    factory = sessionmaker(bind=migrated_engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        seed_initial_data(
            session,
            registry,
            organization_name="Elektro Migration GmbH",
            admin_email=ADMIN_EMAIL,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
    finally:
        session.close()

    def override_session() -> Iterator[Session]:
        inner = factory()
        try:
            yield inner
        finally:
            inner.close()

    app.dependency_overrides[get_session] = override_session
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
    app.dependency_overrides.clear()


def test_anmeldung_gegen_migriertes_schema(migrated_api: TestClient) -> None:
    token = login(migrated_api, ADMIN_EMAIL)

    body = migrated_api.get("/api/v1/me", headers=auth_headers(token)).json()

    assert body["email"] == ADMIN_EMAIL
    assert body["organization"]["name"] == "Elektro Migration GmbH"
    assert {rolle["key"] for rolle in body["roles"]} == {"admin"}
    assert "audit.entry.read" in body["permissions"]


def test_datenbank_verhindert_mandantenuebergreifende_referenz(
    migrated_engine: Engine, registry: ModuleRegistry
) -> None:
    """Der zusammengesetzte Fremdschluessel muss in PostgreSQL greifen."""
    factory = sessionmaker(bind=migrated_engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        erste = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Eins GmbH",
            admin_email="eins@migration.example",
            admin_password=ADMIN_PASSWORD,
        )
        zweite = seed_initial_data(
            session,
            registry,
            organization_name="Elektro Zwei GmbH",
            admin_email="zwei@migration.example",
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()

        fremde_rolle = (
            session.query(Role).filter(Role.organization_id == zweite.organization_id).first()
        )
        eigenes_mitglied = (
            session.query(OrganizationMember)
            .filter(OrganizationMember.organization_id == erste.organization_id)
            .first()
        )
        assert fremde_rolle is not None and eigenes_mitglied is not None

        # Mitgliedschaft aus Betrieb 1 mit Rolle aus Betrieb 2 zu verbinden,
        # muss die Datenbank ablehnen - nicht erst die Anwendung.
        session.add(
            MemberRole(
                organization_id=erste.organization_id,
                member_id=eigenes_mitglied.id,
                role_id=fremde_rolle.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
    finally:
        session.close()
