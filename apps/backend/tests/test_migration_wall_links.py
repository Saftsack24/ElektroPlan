"""Migrationen ``0009`` (bestaetigte Hoehenlage) und ``0010`` (Wandkopplungen, Steigwege).

Phase 6a (ADR 0024, ADR 0025). Eigene Wegwerf-Datenbank, Schema ausschliesslich
per Alembic, nur synthetische Daten:

* Bestand mit Geschossen (auch EG mit ``0``), Raeumen und Waenden wird durch
  ``upgrade -> downgrade 0008 -> upgrade`` gefuehrt,
* danach sind **alle** Hoehenlagen unbestaetigt, die Werte unveraendert,
* Waende bleiben, Kopplungen sind nach einer Rueckmigration verloren
  (dokumentierte Grenze),
* Autogenerate meldet keinen Unterschied zum ORM,
* die Datenbank erzwingt kanonische Paare, Eindeutigkeit, bekannte Werte und
  mandantenreine Fremdschluessel.
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
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.core.customers.models import Customer
from app.core.module_registry.registry import ModuleRegistry
from app.core.projects.models import Building, Floor, Project
from app.core.seed import seed_initial_data
from app.model_registry import metadata
from app.modules.electrical.models import ElectricalRoom, ElectricalWall, ElectricalWallLink
from tests.conftest import (
    ADMIN_PASSWORD,
    TEST_DATABASE_URL,
    entwicklungsdatenbank_url,
    requires_database,
)
from tests.datenbankschutz import pruefe_testdatenbank

pytestmark = [requires_database, pytest.mark.database]

DB_NAME = "elektroplan_migration_6a_test"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
VOR_6A = "0008_electrical_devices"


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
    other_organization_id: uuid.UUID
    wall_a: uuid.UUID
    wall_b: uuid.UUID
    other_wall: uuid.UUID


def _struktur(
    session: Session, registry: ModuleRegistry, name: str, email: str
) -> tuple[uuid.UUID, list[uuid.UUID]]:
    organization_id = seed_initial_data(
        session, registry, organization_name=name, admin_email=email, admin_password=ADMIN_PASSWORD
    ).organization_id
    kunde = Customer(
        organization_id=organization_id, customer_number="KD-00001", kind="company", name="Kunde"
    )
    session.add(kunde)
    session.flush()
    projekt = Project(
        organization_id=organization_id,
        customer_id=kunde.id,
        project_number="PR-2026-0001",
        name="Bestand",
    )
    session.add(projekt)
    session.flush()
    haus = Building(organization_id=organization_id, project_id=projekt.id, name="Haupthaus")
    session.add(haus)
    session.flush()
    eg = Floor(
        organization_id=organization_id,
        building_id=haus.id,
        name="EG",
        level=0,
        elevation_mm=0,
        elevation_confirmed=True,
    )
    og = Floor(
        organization_id=organization_id,
        building_id=haus.id,
        name="OG",
        level=1,
        elevation_mm=2_900,
        elevation_confirmed=True,
    )
    session.add_all([eg, og])
    session.flush()
    walls = []
    for raumname, (x1, x2) in (("A", (4_000, 4_000)), ("B", (4_000, 4_000))):
        raum = ElectricalRoom(organization_id=organization_id, floor_id=eg.id, name=raumname)
        session.add(raum)
        session.flush()
        y1, y2 = (0, 3_000) if raumname == "A" else (3_000, 0)
        wand = ElectricalWall(
            organization_id=organization_id,
            room_id=raum.id,
            x1_mm=x1,
            y1_mm=y1,
            x2_mm=x2,
            y2_mm=y2,
            sort_order=0,
        )
        session.add(wand)
        session.flush()
        walls.append(wand.id)
    return organization_id, walls


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

    registry = build_registry()
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        organization_id, (wall_a, wall_b) = _struktur(
            session, registry, "Bestand 6a GmbH", "admin@bestand-6a.example"
        )
        other_organization_id, (other_wall, _) = _struktur(
            session, registry, "Fremd 6a GmbH", "admin@fremd-6a.example"
        )
        erste, zweite = sorted((wall_a, wall_b))
        session.add(
            ElectricalWallLink(
                organization_id=organization_id,
                wall_a_id=erste,
                wall_b_id=zweite,
                relation="separate",
                origin="user",
            )
        )
        session.commit()
    finally:
        session.close()

    # Zurueck vor Phase 6a und wieder hinauf: der Weg eines Bestandsbetriebs.
    command.downgrade(_config(), VOR_6A)
    command.upgrade(_config(), "head")
    yield Bestand(engine, organization_id, other_organization_id, wall_a, wall_b, other_wall)
    engine.dispose()
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
    maintenance.dispose()


def test_alle_hoehenlagen_sind_nach_der_migration_unbestaetigt(bestand: Bestand) -> None:
    with bestand.engine.connect() as connection:
        zeilen = connection.execute(
            text(
                "SELECT name, elevation_mm, elevation_confirmed FROM floors "
                "WHERE organization_id = :org ORDER BY level"
            ),
            {"org": bestand.organization_id},
        ).all()
    # Auch das EG mit 0 und das plausible OG: nichts wird automatisch bestaetigt.
    assert [tuple(z) for z in zeilen] == [("EG", 0, False), ("OG", 2_900, False)]


def test_waende_bleiben_kopplungen_gehen_bei_rueckmigration_verloren(bestand: Bestand) -> None:
    with bestand.engine.connect() as connection:
        waende = connection.execute(text("SELECT count(*) FROM electrical_walls")).scalar_one()
        kopplungen = connection.execute(
            text("SELECT count(*) FROM electrical_wall_links")
        ).scalar_one()
    assert (waende, kopplungen) == (4, 0)


def test_neue_tabellen_und_kein_unterschied_zum_modell(bestand: Bestand) -> None:
    vorhanden = set(inspect(bestand.engine).get_table_names())
    assert {"electrical_wall_links", "electrical_risers", "electrical_riser_stops"} <= vorhanden
    with bestand.engine.connect() as connection:
        unterschiede = compare_metadata(
            MigrationContext.configure(connection, opts={"compare_type": True}), metadata
        )
    relevante = [
        diff
        for diff in unterschiede
        if not (isinstance(diff, tuple) and str(diff[0]).endswith("_index"))
    ]
    assert relevante == []


def test_datenbank_erzwingt_die_kopplungsregeln(bestand: Bestand) -> None:
    erste, zweite = sorted((bestand.wall_a, bestand.wall_b))

    def einfuegen(**werte: object) -> None:
        daten = {
            "id": uuid.uuid4(),
            "org": bestand.organization_id,
            "a": erste,
            "b": zweite,
            "relation": "shared",
            "origin": "user",
        }
        daten.update(werte)
        with bestand.engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO electrical_wall_links "
                    "(id, organization_id, wall_a_id, wall_b_id, relation, origin) "
                    "VALUES (:id, :org, :a, :b, :relation, :origin)"
                ),
                daten,
            )

    # Nicht kanonisch, unbekannte Werte, fremde Wand (zusammengesetzter FK).
    for werte in (
        {"a": zweite, "b": erste},
        {"relation": "egal"},
        {"origin": "import"},
        {"b": bestand.other_wall} if bestand.other_wall > erste else {"a": bestand.other_wall},
    ):
        with pytest.raises(IntegrityError):
            einfuegen(**werte)
    einfuegen()
    with pytest.raises(IntegrityError):
        einfuegen(relation="separate")  # dasselbe Paar ein zweites Mal
    with bestand.engine.begin() as connection:
        connection.execute(text("DELETE FROM electrical_wall_links"))


def test_downgrade_und_erneutes_upgrade(bestand: Bestand) -> None:
    command.downgrade(_config(), VOR_6A)
    try:
        inspektor = inspect(bestand.engine)
        tabellen = set(inspektor.get_table_names())
        assert (
            not {"electrical_wall_links", "electrical_risers", "electrical_riser_stops"} & tabellen
        )
        spalten = {spalte["name"] for spalte in inspektor.get_columns("floors")}
        assert "elevation_confirmed" not in spalten
        with bestand.engine.connect() as connection:
            hoehen = (
                connection.execute(
                    text(
                        "SELECT elevation_mm FROM floors WHERE organization_id = :org "
                        "ORDER BY level"
                    ),
                    {"org": bestand.organization_id},
                )
                .scalars()
                .all()
            )
        assert hoehen == [0, 2_900]
    finally:
        command.upgrade(_config(), "head")
    with bestand.engine.connect() as connection:
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    # Seit 0011 (Sicherheitsauftrag 2026-10-10) ist 0010 nicht mehr der Head.
    assert version == ScriptDirectory.from_config(_config()).get_current_head()
