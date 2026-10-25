"""Migration ``0014`` (Kabelvorlagen, Planungsvorgaben, Prozentreserve) auf einer Wegwerf-Datenbank.

Phase 6c V1 (ADR 0027). Eigene Datenbank, Schema ausschliesslich per Alembic, nur
synthetische Daten:

* Bestand aus 6b.3 (Stromkreis mit vollstaendigem Vorschlag, Leitung mit Kabelangaben,
  Zugaben und fester Reserve) wird von ``0013`` auf ``0014`` gehoben: Werte unveraendert,
  Reserve ``fixed``, Herkunft ``legacy``, keine Vorlage, Stromkreisvorrang **aus** - die
  Mengen sind dieselben wie vorher (hergeleitet, nicht erneut berechnet),
* keine Vorlage, kein Standard, keine Projektvorgabe entsteht durch die Migration,
* Autogenerate meldet danach keinen Unterschied zum ORM,
* mit V1-Daten bricht das Downgrade ab - nichts wird still verworfen; ohne sie gelingt
  es, der Bestand bleibt, und das Upgrade laeuft erneut.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.model_registry import metadata
from app.modules.electrical.cable_length import Cable, CablePlan, analyse_cables
from tests import test_migration_cables as basis
from tests.conftest import entwicklungsdatenbank_url, requires_database
from tests.datenbankschutz import pruefe_testdatenbank

pytestmark = [requires_database, pytest.mark.database]

DB_NAME = "elektroplan_migration_6c_v1_test"
VOR_V1 = "0013_cables_and_penetrations"
NEUE_TABELLEN = {
    "electrical_cable_templates",
    "electrical_planning_defaults",
    "electrical_type_templates",
    "electrical_project_defaults",
    "electrical_proj_type_templates",
}


def _config():  # type: ignore[no-untyped-def]
    config = basis._config()
    config.set_main_option("sqlalchemy.url", basis._url(DB_NAME))
    return config


@dataclass(frozen=True, slots=True)
class Bestand:
    engine: Engine
    organization_id: uuid.UUID
    project_id: uuid.UUID
    circuit: uuid.UUID
    cable: uuid.UUID
    board_device: uuid.UUID
    socket: uuid.UUID


@pytest.fixture(scope="module")
def bestand() -> Iterator[Bestand]:
    pruefe_testdatenbank(basis._url(DB_NAME), entwicklungsdatenbank_url())
    maintenance = create_engine(basis._url("postgres"), isolation_level="AUTOCOMMIT", future=True)
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{DB_NAME}"'))

    # Bestand im Stand 6b.3 (``0013``), dann hinauf auf den Head.
    command.upgrade(_config(), basis.VOR_6B3)
    engine = create_engine(basis._url(DB_NAME), future=True)
    from app.main import build_registry

    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        eigen = basis._struktur(
            session, build_registry(), "Bestand V1 GmbH", "admin@bestand-v1.example"
        )
        session.commit()
    finally:
        session.close()
    command.upgrade(_config(), VOR_V1)
    cable = uuid.uuid4()
    with engine.begin() as connection:
        projekt = connection.execute(
            text("SELECT id FROM projects WHERE organization_id = :org"), {"org": eigen["org"]}
        ).scalar_one()
        # Vollstaendiger Stromkreisvorschlag (synthetisch) - darf nach V1 nichts vorschreiben.
        connection.execute(
            text(
                "UPDATE electrical_circuits SET proposed_cable_type = 'TEST-K', "
                "proposed_conductor_count = 5, proposed_cross_section_mm2 = 2.5 WHERE id = :id"
            ),
            {"id": eigen["circuit"]},
        )
        connection.execute(
            text(
                "INSERT INTO electrical_cables (id, organization_id, circuit_id, label, "
                "start_device_id, end_device_id, cable_type, conductor_count, cross_section_mm2, "
                "start_allowance_mm, end_allowance_mm, reserve_mm) VALUES (:id, :org, :circuit, "
                "'L1', :start, :end, 'TEST-K', 3, 1.5, 500, 200, 300)"
            ),
            {
                "id": cable,
                "org": eigen["org"],
                "circuit": eigen["circuit"],
                "start": eigen["board_device"],
                "end": eigen["socket"],
            },
        )
    command.upgrade(_config(), "head")
    yield Bestand(
        engine,
        eigen["org"],
        uuid.UUID(str(projekt)),
        eigen["circuit"],
        cable,
        eigen["board_device"],
        eigen["socket"],
    )
    engine.dispose()
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
    maintenance.dispose()


def _zeile(engine: Engine, sql: str, **werte: object) -> dict[str, object]:
    with engine.connect() as connection:
        return dict(connection.execute(text(sql), werte).mappings().one())


def _anzahl(engine: Engine, tabelle: str) -> int:
    with engine.connect() as connection:
        return int(connection.execute(text(f"SELECT count(*) FROM {tabelle}")).scalar_one())  # noqa: S608


def test_bestand_unveraendert_reserve_fest_herkunft_legacy(bestand: Bestand) -> None:
    assert basis._version(bestand.engine) == basis._head()
    assert set(inspect(bestand.engine).get_table_names()) >= NEUE_TABELLEN
    # Die Migration legt keine Vorgaben an - weder Vorlagen noch Standards.
    for tabelle in NEUE_TABELLEN:
        assert _anzahl(bestand.engine, tabelle) == 0, tabelle
    kreis = _zeile(
        bestand.engine,
        "SELECT proposed_cable_type, proposed_conductor_count, proposed_cross_section_mm2, "
        "proposal_overrides_templates FROM electrical_circuits WHERE id = :id",
        id=bestand.circuit,
    )
    assert kreis == {
        "proposed_cable_type": "TEST-K",
        "proposed_conductor_count": 5,
        "proposed_cross_section_mm2": Decimal("2.50"),
        "proposal_overrides_templates": False,
    }
    leitung = _zeile(
        bestand.engine,
        "SELECT end_device_id, cable_type, conductor_count, cross_section_mm2, "
        "start_allowance_mm, end_allowance_mm, reserve_mm, reserve_mode, reserve_percent, "
        "spec_origin, reserve_origin, allowance_origin, cable_template_id, "
        "cable_template_version, defaults_office_version, defaults_project_version "
        "FROM electrical_cables WHERE id = :id",
        id=bestand.cable,
    )
    assert leitung == {
        "end_device_id": bestand.socket,
        "cable_type": "TEST-K",
        "conductor_count": 3,
        "cross_section_mm2": Decimal("1.50"),
        "start_allowance_mm": 500,
        "end_allowance_mm": 200,
        "reserve_mm": 300,
        "reserve_mode": "fixed",
        "reserve_percent": None,
        "spec_origin": "legacy",
        "reserve_origin": "legacy",
        "allowance_origin": "legacy",
        "cable_template_id": None,
        "cable_template_version": None,
        "defaults_office_version": None,
        "defaults_project_version": None,
    }


def test_mengen_wie_vorher(bestand: Bestand) -> None:
    """Vor V1: Zugaben = Start + Ende + Reserve = 1 000 mm. Nach V1 mit ``fixed`` dieselben."""
    leitung = _zeile(
        bestand.engine,
        "SELECT start_allowance_mm, end_allowance_mm, reserve_mm, reserve_mode, reserve_percent "
        "FROM electrical_cables WHERE id = :id",
        id=bestand.cable,
    )
    # Ohne Weg (Bestand ohne Wegpunkte) ist die Leitung offen; Zugaben gelten trotzdem.
    (result,) = analyse_cables(
        CablePlan(floors=(), rooms=()),
        [
            Cable(
                id=str(bestand.cable),
                start_device_id=None,
                end_device_id=None,
                waypoints=(),
                start_allowance_mm=int(str(leitung["start_allowance_mm"])),
                end_allowance_mm=int(str(leitung["end_allowance_mm"])),
                reserve_mm=int(str(leitung["reserve_mm"])),
                reserve_mode=str(leitung["reserve_mode"]),
                reserve_percent=None,
            )
        ],
    )
    assert (result.connection_allowance_mm, result.reserve_mm, result.allowance_mm) == (
        700,
        300,
        1_000,
    )
    assert result.reserve_pending is False


def test_schema_ohne_unterschied_zum_modell(bestand: Bestand) -> None:
    with bestand.engine.connect() as connection:
        unterschiede = compare_metadata(MigrationContext.configure(connection), metadata)
    assert unterschiede == []


def test_datenbank_erzwingt_reserveform_und_herkunft(bestand: Bestand) -> None:
    from sqlalchemy.exc import IntegrityError

    for sql in (
        "UPDATE electrical_cables SET reserve_mode = 'percent' WHERE id = :id",
        "UPDATE electrical_cables SET reserve_percent = 20 WHERE id = :id",
        "UPDATE electrical_cables SET spec_origin = 'erfunden' WHERE id = :id",
        "UPDATE electrical_cables SET reserve_mode = 'flat' WHERE id = :id",
    ):
        with pytest.raises(IntegrityError), bestand.engine.begin() as connection:
            connection.execute(text(sql), {"id": bestand.cable})


def test_downgrade_bricht_mit_v1_daten_ab_und_gelingt_ohne(bestand: Bestand) -> None:
    vorlage = uuid.uuid4()
    with bestand.engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO electrical_cable_templates (id, organization_id, name, cable_type, "
                "conductor_count, cross_section_mm2) VALUES (:id, :org, 'T', 'TEST-K', 3, 1.5)"
            ),
            {"id": vorlage, "org": bestand.organization_id},
        )
        connection.execute(
            text(
                "UPDATE electrical_cables SET reserve_mode = 'percent', reserve_mm = 0, "
                "reserve_percent = 20, reserve_origin = 'manual' WHERE id = :id"
            ),
            {"id": bestand.cable},
        )
    with pytest.raises(RuntimeError, match="Downgrade abgebrochen"):
        command.downgrade(_config(), VOR_V1)
    # Nichts verworfen, Stand unveraendert (eine Transaktion fuer den ganzen Lauf).
    assert basis._version(bestand.engine) == basis._head()
    assert _anzahl(bestand.engine, "electrical_cable_templates") == 1

    with bestand.engine.begin() as connection:
        connection.execute(
            text("DELETE FROM electrical_cable_templates WHERE id = :id"), {"id": vorlage}
        )
        connection.execute(
            text(
                "UPDATE electrical_cables SET reserve_mode = 'fixed', reserve_mm = 300, "
                "reserve_percent = NULL, reserve_origin = 'legacy' WHERE id = :id"
            ),
            {"id": bestand.cable},
        )
    command.downgrade(_config(), VOR_V1)
    assert basis._version(bestand.engine) == VOR_V1
    assert not NEUE_TABELLEN & set(inspect(bestand.engine).get_table_names())
    spalten = {c["name"] for c in inspect(bestand.engine).get_columns("electrical_cables")}
    assert not spalten & {"reserve_mode", "reserve_percent", "spec_origin", "cable_template_id"}
    leitung = _zeile(
        bestand.engine,
        "SELECT cable_type, start_allowance_mm, end_allowance_mm, reserve_mm "
        "FROM electrical_cables WHERE id = :id",
        id=bestand.cable,
    )
    assert leitung == {
        "cable_type": "TEST-K",
        "start_allowance_mm": 500,
        "end_allowance_mm": 200,
        "reserve_mm": 300,
    }
    command.upgrade(_config(), "head")
    assert basis._version(bestand.engine) == basis._head()
