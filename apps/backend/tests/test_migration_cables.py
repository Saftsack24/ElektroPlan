"""Migration ``0013`` (Leitungen, Wegpunkte, Durchfuehrungen) auf einer Wegwerf-Datenbank.

Phase 6b.3 (ADR 0026). Eigene Datenbank, Schema ausschliesslich per Alembic, nur
synthetische Daten:

* Bestand aus 6b.0 (Raeume, Geraete, Verteilung, Stromkreis, Steigweg) wird von
  ``0012`` auf ``0013`` gehoben und bleibt unveraendert,
* mit Leitungen oder Durchfuehrungen bricht das Downgrade ab - nichts wird still
  geloescht, der Stand bleibt ``0013``; ohne sie gelingt es, der Bestand bleibt,
* Autogenerate meldet danach keinen Unterschied zum ORM,
* die Datenbank erzwingt Wegpunktform, Reihenfolge, verschiedene Endgeraete,
  Halt-zu-Steigweg-Zugehoerigkeit und Mandantenreinheit.
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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.core.customers.models import Customer
from app.core.module_registry.registry import ModuleRegistry
from app.core.projects.models import Building, Floor, Project
from app.core.seed import seed_initial_data
from app.model_registry import metadata
from app.modules.electrical.models import (
    ElectricalCircuit,
    ElectricalDevice,
    ElectricalDistributionBoard,
    ElectricalRiser,
    ElectricalRiserStop,
    ElectricalRoom,
    ElectricalWall,
)
from tests.conftest import (
    ADMIN_PASSWORD,
    TEST_DATABASE_URL,
    entwicklungsdatenbank_url,
    requires_database,
)
from tests.datenbankschutz import pruefe_testdatenbank

pytestmark = [requires_database, pytest.mark.database]

DB_NAME = "elektroplan_migration_6b3_test"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
VOR_6B3 = "0012_boards_and_circuits"
NEUE_TABELLEN = {"electrical_cables", "electrical_cable_waypoints", "electrical_wall_penetrations"}


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
    room: uuid.UUID
    board_device: uuid.UUID
    socket: uuid.UUID
    circuit: uuid.UUID
    riser: uuid.UUID
    stop: uuid.UUID
    other_riser: uuid.UUID
    other_stop: uuid.UUID
    other_wall: uuid.UUID


def _struktur(
    session: Session, registry: ModuleRegistry, name: str, email: str
) -> dict[str, uuid.UUID]:
    org = seed_initial_data(
        session, registry, organization_name=name, admin_email=email, admin_password=ADMIN_PASSWORD
    ).organization_id
    kunde = Customer(organization_id=org, customer_number="KD-00001", kind="company", name="Kunde")
    session.add(kunde)
    session.flush()
    projekt = Project(
        organization_id=org, customer_id=kunde.id, project_number="PR-2026-0001", name="Bestand"
    )
    session.add(projekt)
    session.flush()
    haus = Building(organization_id=org, project_id=projekt.id, name="Haupthaus")
    session.add(haus)
    session.flush()
    eg = Floor(organization_id=org, building_id=haus.id, name="EG", level=0)
    session.add(eg)
    session.flush()
    raeume = []
    waende = []
    for raumname, (y1, y2) in (("A", (0, 3_000)), ("B", (3_000, 0))):
        raum = ElectricalRoom(organization_id=org, floor_id=eg.id, name=raumname)
        session.add(raum)
        session.flush()
        wand = ElectricalWall(
            organization_id=org,
            room_id=raum.id,
            x1_mm=4_000,
            y1_mm=y1,
            x2_mm=4_000,
            y2_mm=y2,
            sort_order=0,
        )
        session.add(wand)
        session.flush()
        raeume.append(raum.id)
        waende.append(wand.id)
    lage = ElectricalDevice(
        organization_id=org,
        room_id=raeume[0],
        device_type_key="distribution_board",
        mounting_surface="wall_interior",
        wall_id=waende[0],
        center_offset_mm=1_000,
        center_height_mm=1_400,
    )
    dose = ElectricalDevice(
        organization_id=org,
        room_id=raeume[0],
        device_type_key="socket_single",
        mounting_surface="wall_interior",
        wall_id=waende[0],
        center_offset_mm=2_500,
        center_height_mm=300,
    )
    session.add_all([lage, dose])
    session.flush()
    verteilung = ElectricalDistributionBoard(
        organization_id=org,
        building_id=haus.id,
        code="UV1",
        name="UV1",
        placement_device_id=lage.id,
    )
    session.add(verteilung)
    session.flush()
    kreis = ElectricalCircuit(
        organization_id=org, board_id=verteilung.id, designation="F1", name="F1"
    )
    steigwege = []
    halte = []
    for name_steigweg in ("S1", "S2"):
        steigweg = ElectricalRiser(
            organization_id=org, building_id=haus.id, name=name_steigweg, offset_mode="orthogonal"
        )
        session.add(steigweg)
        session.flush()
        halt = ElectricalRiserStop(
            organization_id=org, riser_id=steigweg.id, floor_id=eg.id, x_mm=100, y_mm=100
        )
        session.add(halt)
        session.flush()
        steigwege.append(steigweg.id)
        halte.append(halt.id)
    session.add(kreis)
    session.flush()
    return {
        "org": org,
        "wall_a": waende[0],
        "wall_b": waende[1],
        "room": raeume[0],
        "board_device": lage.id,
        "socket": dose.id,
        "circuit": kreis.id,
        "riser": steigwege[0],
        "stop": halte[0],
        "other_riser": steigwege[1],
        "other_stop": halte[1],
    }


@pytest.fixture(scope="module")
def bestand() -> Iterator[Bestand]:
    pruefe_testdatenbank(_url(DB_NAME), entwicklungsdatenbank_url())
    maintenance = create_engine(_url("postgres"), isolation_level="AUTOCOMMIT", future=True)
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{DB_NAME}"'))

    # Bestand im Stand vor 6b.3 anlegen, dann hinauf auf 0013.
    command.upgrade(_config(), VOR_6B3)
    engine = create_engine(_url(DB_NAME), future=True)
    from app.main import build_registry

    registry = build_registry()
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        eigen = _struktur(session, registry, "Bestand 6b3 GmbH", "admin@bestand-6b3.example")
        fremd = _struktur(session, registry, "Fremd 6b3 GmbH", "admin@fremd-6b3.example")
        session.commit()
    finally:
        session.close()
    command.upgrade(_config(), "head")
    yield Bestand(
        engine,
        eigen["org"],
        fremd["org"],
        eigen["wall_a"],
        eigen["wall_b"],
        eigen["room"],
        eigen["board_device"],
        eigen["socket"],
        eigen["circuit"],
        eigen["riser"],
        eigen["stop"],
        eigen["other_riser"],
        eigen["other_stop"],
        fremd["wall_a"],
    )
    engine.dispose()
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
    maintenance.dispose()


def _version(engine: Engine) -> str:
    with engine.connect() as connection:
        return str(connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one())


def _anzahl(engine: Engine, tabelle: str) -> int:
    with engine.connect() as connection:
        return int(connection.execute(text(f"SELECT count(*) FROM {tabelle}")).scalar_one())  # noqa: S608


def _leitung(bestand: Bestand, connection: object, **werte: object) -> uuid.UUID:
    daten = {
        "id": uuid.uuid4(),
        "org": bestand.organization_id,
        "circuit": bestand.circuit,
        "start": bestand.board_device,
        "end": bestand.socket,
    }
    daten.update(werte)
    connection.execute(  # type: ignore[attr-defined]
        text(
            "INSERT INTO electrical_cables (id, organization_id, circuit_id, start_device_id, "
            "end_device_id) VALUES (:id, :org, :circuit, :start, :end)"
        ),
        daten,
    )
    return uuid.UUID(str(daten["id"]))


def _wegpunkt(
    bestand: Bestand, connection: object, cable: uuid.UUID, seq: int, **werte: object
) -> None:
    spalten = {"kind": "wall", "wall_id": bestand.wall_a, "offset_mm": 100, "height_mm": 2_200}
    spalten.update(werte)
    namen = ", ".join(spalten)
    platzhalter = ", ".join(f":{name}" for name in spalten)
    connection.execute(  # type: ignore[attr-defined]
        text(
            "INSERT INTO electrical_cable_waypoints (id, organization_id, cable_id, seq, "  # noqa: S608
            f"{namen}) VALUES (:id, :org, :cable, :seq, {platzhalter})"
        ),
        {"id": uuid.uuid4(), "org": bestand.organization_id, "cable": cable, "seq": seq, **spalten},
    )


def test_bestand_bleibt_und_neue_tabellen_ohne_unterschied_zum_modell(bestand: Bestand) -> None:
    assert _version(bestand.engine) == "0013_cables_and_penetrations"
    assert set(inspect(bestand.engine).get_table_names()) >= NEUE_TABELLEN
    assert _anzahl(bestand.engine, "electrical_devices") == 4
    assert _anzahl(bestand.engine, "electrical_circuits") == 2
    with bestand.engine.connect() as connection:
        unterschiede = compare_metadata(
            MigrationContext.configure(connection, opts={"compare_type": True}), metadata
        )
    assert unterschiede == []


def test_datenbank_erzwingt_wegpunktform_und_bezuege(bestand: Bestand) -> None:
    with bestand.engine.begin() as connection:
        cable = _leitung(bestand, connection)
        _wegpunkt(bestand, connection, cable, 0)
        _wegpunkt(
            bestand,
            connection,
            cable,
            1,
            kind="riser",
            wall_id=None,
            offset_mm=None,
            height_mm=None,
            riser_id=bestand.riser,
            from_stop_id=bestand.stop,
            from_height_mm=0,
            to_stop_id=bestand.stop,
            to_height_mm=0,
        )
    verboten = [
        # Wandpunkt mit Raum: falsche Spalten fuer die Art.
        {"seq": 5, "room_id": bestand.room},
        # Doppelte Reihenfolge.
        {"seq": 0},
        # Wand eines fremden Betriebs.
        {"seq": 6, "wall_id": bestand.other_wall},
        # Halt eines anderen Steigwegs.
        {
            "seq": 7,
            "kind": "riser",
            "wall_id": None,
            "offset_mm": None,
            "height_mm": None,
            "riser_id": bestand.riser,
            "from_stop_id": bestand.other_stop,
            "from_height_mm": 0,
            "to_stop_id": bestand.stop,
            "to_height_mm": 0,
        },
        # Unbekannte Art.
        {"seq": 8, "kind": "luft"},
    ]
    for werte in verboten:
        with pytest.raises(IntegrityError), bestand.engine.begin() as connection:
            _wegpunkt(bestand, connection, cable, **werte)  # type: ignore[arg-type]
    with pytest.raises(IntegrityError), bestand.engine.begin() as connection:
        _leitung(bestand, connection, end=bestand.board_device)
    with bestand.engine.begin() as connection:
        connection.execute(text("DELETE FROM electrical_cables WHERE id = :id"), {"id": cable})
    # Die Wegpunkte folgen der Leitung.
    assert _anzahl(bestand.engine, "electrical_cable_waypoints") == 0


def test_downgrade_bricht_mit_leitungen_ab_und_gelingt_ohne(bestand: Bestand) -> None:
    with bestand.engine.begin() as connection:
        cable = _leitung(bestand, connection)
    with pytest.raises(RuntimeError, match="Downgrade abgebrochen"):
        command.downgrade(_config(), VOR_6B3)
    # Nichts geloescht, Stand unveraendert.
    assert _version(bestand.engine) == "0013_cables_and_penetrations"
    assert _anzahl(bestand.engine, "electrical_cables") == 1

    with bestand.engine.begin() as connection:
        connection.execute(text("DELETE FROM electrical_cables WHERE id = :id"), {"id": cable})
    command.downgrade(_config(), VOR_6B3)
    assert _version(bestand.engine) == VOR_6B3
    assert not NEUE_TABELLEN & set(inspect(bestand.engine).get_table_names())
    # Der Bestand aus 6b.0 bleibt.
    assert _anzahl(bestand.engine, "electrical_circuits") == 2
    assert _anzahl(bestand.engine, "electrical_riser_stops") == 4
    command.upgrade(_config(), "head")
    assert _version(bestand.engine) == "0013_cables_and_penetrations"
