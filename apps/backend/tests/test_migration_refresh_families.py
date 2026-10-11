"""Migration ``0010 -> 0011``: Refresh-Token-Familien (Sicherheitsauftrag, Befund 4).

Bestand vor ``0011``: eine offene Sitzung (rotiert, mit gueltigem Nachfolger)
und eine vollstaendig widerrufene Sitzung. Die Migration

* legt je vorhandener ``family_id`` genau eine Familie an,
* laesst die offene Sitzung gueltig und markiert die widerrufene als widerrufen,
* aendert keinen Token,
* laesst Autogenerate keinen Unterschied melden,
* laesst sich zurueckrollen und erneut anwenden.

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
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth.service import AuthService, _login_limiter
from app.core.module_registry.registry import ModuleRegistry
from app.core.seed import seed_initial_data
from app.errors import AuthenticationError
from app.model_registry import metadata
from tests.conftest import (
    ADMIN_PASSWORD,
    TEST_DATABASE_URL,
    entwicklungsdatenbank_url,
    requires_database,
)
from tests.datenbankschutz import pruefe_testdatenbank

pytestmark = [requires_database, pytest.mark.database]

DB_NAME = "elektroplan_migration_0011_test"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
ADMIN = "admin@bestand-0011.example"


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
    offen: str
    offene_familie: uuid.UUID
    beendete_familie: uuid.UUID
    tokens_vorher: list[tuple[object, ...]]


def _tokens(engine: Engine) -> list[tuple[object, ...]]:
    with engine.connect() as connection:
        return [
            tuple(z)
            for z in connection.execute(
                text(
                    "SELECT id, family_id, revoked_at, revoked_reason, replaced_by_id "
                    "FROM refresh_tokens ORDER BY id"
                )
            ).all()
        ]


@pytest.fixture(scope="module")
def bestand() -> Iterator[Bestand]:
    pruefe_testdatenbank(_url(DB_NAME), entwicklungsdatenbank_url())
    maintenance = create_engine(_url("postgres"), isolation_level="AUTOCOMMIT", future=True)
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{DB_NAME}"'))

    command.upgrade(_config(), "head")
    engine = create_engine(_url(DB_NAME), future=True)
    from app.main import build_registry

    registry: ModuleRegistry = build_registry()
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session: Session = factory()
    try:
        seed_initial_data(
            session,
            registry,
            organization_name="Bestand 0011 GmbH",
            admin_email=ADMIN,
            admin_password=ADMIN_PASSWORD,
        )
        session.commit()
        _login_limiter.clear()
        # Offene Sitzung: einmal rotiert, der Nachfolger ist gueltig.
        erste = AuthService(session).login(email=ADMIN, password=ADMIN_PASSWORD)
        session.commit()
        offen = AuthService(session).refresh(erste.refresh_token)
        session.commit()
        # Beendete Sitzung: abgemeldet.
        zweite = AuthService(session).login(email=ADMIN, password=ADMIN_PASSWORD)
        session.commit()
        AuthService(session).logout(zweite.refresh_token)
        session.commit()
        with engine.connect() as connection:
            offene_familie = connection.execute(
                text("SELECT family_id FROM refresh_tokens WHERE id = :id"),
                {"id": offen.refresh_token_id},
            ).scalar_one()
            beendete_familie = connection.execute(
                text("SELECT family_id FROM refresh_tokens WHERE id = :id"),
                {"id": zweite.refresh_token_id},
            ).scalar_one()
    finally:
        session.close()

    command.downgrade(_config(), "0010_wall_links_and_risers")
    assert "refresh_token_families" not in set(inspect(engine).get_table_names())
    vorher = _tokens(engine)
    command.upgrade(_config(), "head")
    yield Bestand(engine, offen.refresh_token, offene_familie, beendete_familie, vorher)
    engine.dispose()
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
    maintenance.dispose()


def test_je_familie_genau_ein_zustand(bestand: Bestand) -> None:
    with bestand.engine.connect() as connection:
        familien = {
            z[0]: (z[1], z[2])
            for z in connection.execute(
                text(
                    "SELECT id, revoked_at IS NOT NULL, revoked_reason FROM refresh_token_families"
                )
            ).all()
        }
    assert set(familien) == {bestand.offene_familie, bestand.beendete_familie}
    assert familien[bestand.offene_familie] == (False, None)
    assert familien[bestand.beendete_familie] == (True, "family_revoked")


def test_tokens_bleiben_unveraendert(bestand: Bestand) -> None:
    assert _tokens(bestand.engine) == bestand.tokens_vorher


def test_kein_unterschied_zum_modell(bestand: Bestand) -> None:
    with bestand.engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), metadata) == []


def test_offene_sitzung_bleibt_gueltig_und_logout_wirkt(bestand: Bestand) -> None:
    factory = sessionmaker(bind=bestand.engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        erneuert = AuthService(session).refresh(bestand.offen)
        session.commit()
        AuthService(session).logout(erneuert.refresh_token)
        session.commit()
        with pytest.raises(AuthenticationError):
            AuthService(session).refresh(erneuert.refresh_token)
    finally:
        session.rollback()
        session.close()


def test_downgrade_und_erneutes_upgrade(bestand: Bestand) -> None:
    command.downgrade(_config(), "0010_wall_links_and_risers")
    assert "refresh_token_families" not in set(inspect(bestand.engine).get_table_names())
    command.upgrade(_config(), "head")
    with bestand.engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), metadata) == []
        anzahl = connection.execute(text("SELECT count(*) FROM refresh_token_families")).scalar()
    assert anzahl == 2
