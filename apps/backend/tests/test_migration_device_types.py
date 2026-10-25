"""Migration ``0015`` (betriebseigene Geraetetypen, Kategorie Geraeteanschluss) auf einer
Wegwerf-Datenbank.

Phase 6c K2 (ADR 0030). Eigene Datenbank, Schema ausschliesslich per Alembic, nur
synthetische Daten:

* Bestand aus V1 (``0014``: Systemkatalog, Geraete, Verteilung, Kabelvorlage mit Vorlage je
  Geraetetyp) wird auf ``0015`` gehoben: Schluessel, Verweise, Lage und Masse unveraendert,
  alle Typen sind Systemtypen, die berechneten Typspalten ``NULL``,
* Autogenerate meldet danach keinen Unterschied zum ORM,
* der Seed ergaenzt den Systemtyp Geraeteanschluss, ist idempotent und laesst eigene Typen
  unberuehrt,
* mit eigenen Typen bricht das Downgrade ab; ohne sie gelingt es, und das Upgrade laeuft erneut.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.model_registry import metadata
from app.modules.electrical.reference_data import ElectricalReferenceData
from tests import test_migration_cables as basis
from tests.conftest import entwicklungsdatenbank_url, requires_database
from tests.datenbankschutz import pruefe_testdatenbank

pytestmark = [requires_database, pytest.mark.database]

DB_NAME = "elektroplan_migration_6c_k2_test"
VOR_K2 = "0014_planning_defaults"


def _config():  # type: ignore[no-untyped-def]
    config = basis._config()
    config.set_main_option("sqlalchemy.url", basis._url(DB_NAME))
    return config


@dataclass(frozen=True, slots=True)
class Bestand:
    engine: Engine
    organization_id: uuid.UUID
    geraete: list[dict[str, object]]
    typen: list[dict[str, object]]
    vorlage_je_typ: list[dict[str, object]]


def _zeilen(engine: Engine, sql: str) -> list[dict[str, object]]:
    with engine.connect() as connection:
        return [dict(row) for row in connection.execute(text(sql)).mappings()]


_GERAETE = (
    "SELECT id, room_id, device_type_key, mounting_surface, wall_id, center_offset_mm, "
    "center_height_mm, x_mm, y_mm, label FROM electrical_devices ORDER BY id"
)
_TYPEN = (
    "SELECT key, label, category, symbol_key, allows_wall_interior, allows_wall_exterior, "
    "allows_ceiling, default_center_height_mm, width_mm, height_mm, sort_order, is_active "
    "FROM electrical_device_types ORDER BY key"
)
_VORLAGE_JE_TYP = (
    "SELECT organization_id, device_type_key, cable_template_id FROM electrical_type_templates "
    "ORDER BY device_type_key"
)


@pytest.fixture(scope="module")
def bestand() -> Iterator[Bestand]:
    pruefe_testdatenbank(basis._url(DB_NAME), entwicklungsdatenbank_url())
    maintenance = create_engine(basis._url("postgres"), isolation_level="AUTOCOMMIT", future=True)
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{DB_NAME}"'))

    command.upgrade(_config(), basis.VOR_6B3)
    engine = create_engine(basis._url(DB_NAME), future=True)
    from app.main import build_registry

    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    try:
        eigen = basis._struktur(
            session, build_registry(), "Bestand K2 GmbH", "admin@bestand-k2.example"
        )
        session.commit()
    finally:
        session.close()
    command.upgrade(_config(), VOR_K2)
    vorlage = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO electrical_cable_templates (id, organization_id, name, cable_type, "
                "conductor_count, cross_section_mm2) "
                "VALUES (:id, :org, 'NYM 3x1,5', 'NYM-J', 3, 1.5)"
            ),
            {"id": vorlage, "org": eigen["org"]},
        )
        connection.execute(
            text(
                "INSERT INTO electrical_type_templates (organization_id, device_type_key, "
                "cable_template_id) VALUES (:org, 'socket_single', :vorlage)"
            ),
            {"org": eigen["org"], "vorlage": vorlage},
        )
    vorher = Bestand(
        engine,
        eigen["org"],
        _zeilen(engine, _GERAETE),
        _zeilen(engine, _TYPEN),
        _zeilen(engine, _VORLAGE_JE_TYP),
    )
    command.upgrade(_config(), "head")
    yield vorher
    engine.dispose()
    with maintenance.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
    maintenance.dispose()


def test_bestand_unveraendert_alle_typen_sind_systemtypen(bestand: Bestand) -> None:
    assert basis._version(bestand.engine) == basis._head() == "0015_organization_device_types"
    assert _zeilen(bestand.engine, _GERAETE) == bestand.geraete
    assert _zeilen(bestand.engine, _TYPEN) == bestand.typen
    assert _zeilen(bestand.engine, _VORLAGE_JE_TYP) == bestand.vorlage_je_typ
    assert len(bestand.geraete) == 2 and len(bestand.vorlage_je_typ) == 1
    # Alle vorhandenen Typen sind Systemtypen mit Version 1, die berechneten Spalten leer.
    assert _zeilen(
        bestand.engine,
        "SELECT count(*) AS eigen, min(version) AS v_min, max(version) AS v_max "
        "FROM electrical_device_types WHERE organization_id IS NOT NULL OR version <> 1",
    ) == [{"eigen": 0, "v_min": None, "v_max": None}]
    for tabelle in (
        "electrical_devices",
        "electrical_type_templates",
        "electrical_proj_type_templates",
    ):
        assert _zeilen(
            bestand.engine,
            f"SELECT count(*) AS n FROM {tabelle} WHERE device_type_org_id IS NOT NULL",  # noqa: S608
        ) == [{"n": 0}]


def test_schema_ohne_unterschied_zum_modell(bestand: Bestand) -> None:
    with bestand.engine.connect() as connection:
        unterschiede = compare_metadata(MigrationContext.configure(connection), metadata)
    assert unterschiede == []
    fremdschluessel = {
        fk["name"] for fk in inspect(bestand.engine).get_foreign_keys("electrical_devices")
    }
    assert "fk_el_devices_device_type_scope" in fremdschluessel


def test_seed_ergaenzt_geraeteanschluss_idempotent_und_ohne_eigene_typen(bestand: Bestand) -> None:
    session = sessionmaker(bind=bestand.engine, expire_on_commit=False)()
    try:
        erster = ElectricalReferenceData().seed_reference_data(session)
        session.commit()
        session.execute(
            text(
                "INSERT INTO electrical_device_types (key, organization_id, label, category, "
                "symbol_key, allows_wall_interior, allows_wall_exterior, allows_ceiling, width_mm, "
                "height_mm, sort_order) VALUES (:key, :org, 'Herdanschluss', 'connection', "
                "'connection_outlet', true, false, false, 120, 120, 5)"
            ),
            {"key": "c_" + uuid.uuid4().hex, "org": bestand.organization_id},
        )
        session.commit()
        zweiter = ElectricalReferenceData().seed_reference_data(session)
        session.commit()
    finally:
        session.close()
    assert (erster.created, erster.updated, erster.deactivated) == (1, 0, 0)
    assert (zweiter.created, zweiter.updated, zweiter.deactivated) == (0, 0, 0)
    eigene = _zeilen(
        bestand.engine,
        "SELECT label, is_active, version FROM electrical_device_types "
        "WHERE organization_id IS NOT NULL",
    )
    assert eigene == [{"label": "Herdanschluss", "is_active": True, "version": 1}]


def test_downgrade_bricht_mit_eigenen_typen_ab_und_gelingt_ohne(bestand: Bestand) -> None:
    with bestand.engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO electrical_device_types (key, organization_id, label, category, "
                "symbol_key, allows_wall_interior, allows_wall_exterior, allows_ceiling, width_mm, "
                "height_mm, sort_order) VALUES (:key, :org, 'Rollladen', 'connection', "
                "'connection_outlet', true, false, false, 80, 80, 6) ON CONFLICT DO NOTHING"
            ),
            {"key": "c_" + uuid.uuid4().hex, "org": bestand.organization_id},
        )
    with pytest.raises(RuntimeError, match="Downgrade abgebrochen"):
        command.downgrade(_config(), VOR_K2)
    assert basis._version(bestand.engine) == basis._head()

    with bestand.engine.begin() as connection:
        connection.execute(
            text("DELETE FROM electrical_device_types WHERE organization_id IS NOT NULL")
        )
    command.downgrade(_config(), VOR_K2)
    assert basis._version(bestand.engine) == VOR_K2
    spalten = {c["name"] for c in inspect(bestand.engine).get_columns("electrical_device_types")}
    assert not spalten & {"organization_id", "description", "version"}
    assert _zeilen(bestand.engine, _GERAETE) == bestand.geraete
    assert _zeilen(bestand.engine, _TYPEN) == bestand.typen
    assert _zeilen(bestand.engine, _VORLAGE_JE_TYP) == bestand.vorlage_je_typ
    command.upgrade(_config(), "head")
    assert basis._version(bestand.engine) == basis._head()
