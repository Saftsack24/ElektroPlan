"""Architekturnachweis fuer das erste Fachmodul (Phase 3).

Phase 3 ist der Prueffall der Modularchitektur: Ein Fachmodul haengt sich an
den Core, ohne ihn zu verbiegen. Diese Tests belegen das **automatisch** -
eine Regel ohne Pruefung gilt in diesem Projekt als unverbindlich
(CLAUDE.md, Abschnitt 3).

Geprueft wird:

1. Der Core importiert das Fachmodul nicht - weder direkt noch indirekt.
2. ``electrical`` benutzt nur die veroeffentlichte Core-Oberflaeche.
3. Die registrierte Abhaengigkeit ``("core",)`` passt zu den tatsaechlichen
   Imports - nicht mehr und nicht weniger.
4. Der oeffentliche Einstiegspunkt ist eindeutig.
5. Tabellen, Praefix, Permissions und Routen gehoeren dem Modul.

Diese Datei braucht **keine** Datenbank.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.core.module import CORE_TABLES
from app.core.module_registry.boundaries import (
    CORE_PUBLIC_SURFACE,
    check_import_boundaries,
    check_table_boundaries,
    scan_directory,
)
from app.core.module_registry.descriptor import ModuleKind
from app.core.module_registry.registry import ModuleRegistry
from app.model_registry import metadata
from app.modules import REGISTERED_MODULES
from app.modules.electrical import DESCRIPTOR
from app.modules.electrical.permissions import PLAN_READ, PLAN_WRITE
from tests.routes import all_routes

BACKEND_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = BACKEND_ROOT / "app"
MODULE_ROOT = APP_ROOT / "modules" / "electrical"

#: Kern des Moduls - die Dateien, die es geben muss.
ERWARTETE_DATEIEN = (
    "__init__.py",
    "module.py",
    "api.py",
    "service.py",
    "models.py",
    "schemas.py",
    "geometry.py",
    "events.py",
    "permissions.py",
)


def _importe(path: Path) -> set[str]:
    """Alle importierten Namen einer Datei - rein per AST, ohne Ausfuehrung."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    ziele: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            ziele.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            ziele.update(f"{node.module}.{alias.name}" for alias in node.names)
            ziele.add(node.module)
    return ziele


def _alle_core_dateien() -> list[Path]:
    return sorted(APP_ROOT.joinpath("core").rglob("*.py"))


# ----------------------------------------------------- 1. Core kennt kein Modul


def test_core_importiert_kein_fachmodul() -> None:
    """Der Core kennt kein Modul - auch nicht ``electrical`` (ADR 0001).

    Die Richtung ist die Grundlage der ganzen Architektur: Ein Core, der ein
    Fachmodul kennt, ist kein Core mehr.
    """
    verstoesse: list[str] = []
    for path in _alle_core_dateien():
        for ziel in _importe(path):
            if ziel.startswith("app.modules"):
                verstoesse.append(f"{path.relative_to(BACKEND_ROOT)}: {ziel}")

    assert verstoesse == [], verstoesse


def test_auch_die_datenbankschicht_kennt_kein_modul() -> None:
    verstoesse: list[str] = []
    for path in sorted(APP_ROOT.joinpath("db").rglob("*.py")):
        for ziel in _importe(path):
            if ziel.startswith("app.modules") or ziel.startswith("app.core"):
                verstoesse.append(f"{path.relative_to(BACKEND_ROOT)}: {ziel}")

    assert verstoesse == [], verstoesse


def test_contracts_haengen_an_nichts() -> None:
    for path in sorted(APP_ROOT.joinpath("contracts").rglob("*.py")):
        for ziel in _importe(path):
            assert not ziel.startswith(("app.core", "app.modules", "app.db")), (path, ziel)


# ------------------------------------------- 2. Nur die oeffentliche Oberflaeche


def test_electrical_benutzt_nur_die_oeffentliche_core_oberflaeche(
    registry: ModuleRegistry,
) -> None:
    """Der Nachweis laeuft ueber die produktive Grenzpruefung selbst."""
    assert check_import_boundaries(registry, require_module_folder=True) == []


def test_electrical_greift_auf_keine_core_modelle_zu() -> None:
    """Zusaetzlich namentlich: kein ``models``, ``service`` oder ``repository``.

    Der Test ist bewusst redundant zur Positivliste - er benennt genau die
    drei Dateiarten, die am leichtesten aus Bequemlichkeit importiert wuerden.
    """
    verboten = (".models", ".service", ".repository", ".schemas", ".storage")
    verstoesse: list[str] = []
    for path in sorted(MODULE_ROOT.rglob("*.py")):
        for ziel in _importe(path):
            if not ziel.startswith("app.core."):
                continue
            # ``app.core.tenancy.repository`` ist ausdruecklich freigegeben.
            if any(ziel.startswith(prefix) for prefix in CORE_PUBLIC_SURFACE):
                continue
            if any(teil in ziel for teil in verboten):
                verstoesse.append(f"{path.name}: {ziel}")

    assert verstoesse == [], verstoesse


def test_fremdes_fachmodul_darf_electrical_nicht_importieren(tmp_path: Path) -> None:
    """Ein spaeteres Modul (``pv``) kommt nicht an die Interna heran."""
    source_root = tmp_path / "app"
    pv = source_root / "modules" / "pv"
    pv.mkdir(parents=True)
    (pv / "__init__.py").write_text("", encoding="utf-8")
    (pv / "services.py").write_text(
        "from app.modules.electrical.models import ElectricalRoom\n"
        "from app.modules.electrical import DESCRIPTOR\n"
        "from app.modules.electrical.geometry import Point\n",
        encoding="utf-8",
    )

    violations = scan_directory(module_id="pv", module_dir=pv, source_root=source_root)

    assert len(violations) == 3
    for violation in violations:
        assert "depends_on" in violation.reason


# --------------------------------------- 3. depends_on passt zu den Imports


def test_registrierte_abhaengigkeit_ist_genau_core() -> None:
    """``depends_on = ("core",)`` - und die Imports bestaetigen es.

    In den Phasen 3-6 haengt ``electrical`` nur am Core. Waere hier
    ``materials`` eingetragen, wuerde die Registry den Start verweigern, weil
    das Modul nicht registriert ist.
    """
    assert DESCRIPTOR.depends_on == ("core",)

    fremde_module: set[str] = set()
    benutzt_core = False
    for path in sorted(MODULE_ROOT.rglob("*.py")):
        for ziel in _importe(path):
            if ziel.startswith("app.core.") or ziel.startswith("app.db.") or ziel == "app.errors":
                benutzt_core = True
            if ziel.startswith("app.modules."):
                modul = ziel[len("app.modules.") :].split(".", 1)[0]
                if modul != DESCRIPTOR.id:
                    fremde_module.add(modul)

    assert fremde_module == set(), fremde_module
    assert benutzt_core, "Das Modul benutzt den Core nicht - dann ist depends_on zu weit."


def test_registry_akzeptiert_die_reale_konfiguration(registry: ModuleRegistry) -> None:
    """Die Startpruefungen laufen ueber die echte Modulliste."""
    assert [module.id for module in registry.modules] == ["core", "electrical"]
    registry.validate()


def test_descriptor_ist_ein_fachmodul() -> None:
    assert DESCRIPTOR.kind is ModuleKind.DOMAIN
    assert DESCRIPTOR.table_prefix == "electrical_"
    assert DESCRIPTOR.namespaces == ("electrical",)
    assert DESCRIPTOR.provides == (), "Provider-Ports entstehen erst mit materials (Phase 7)"
    assert DESCRIPTOR.subscriptions == (), "Phase 3 konsumiert keine Events"


def test_modulliste_enthaelt_electrical() -> None:
    assert [descriptor.id for descriptor in REGISTERED_MODULES] == ["electrical"]


# ------------------------------------ 4. Eindeutiger oeffentlicher Einstieg


def test_oeffentlicher_einstiegspunkt_exportiert_nur_den_descriptor() -> None:
    """Genau ein Name verlaesst das Modul."""
    import app.modules.electrical as public

    assert public.__all__ == ["DESCRIPTOR"]
    oeffentlich = {name for name in dir(public) if not name.startswith("_")}
    # ``annotations`` stammt aus ``from __future__ import annotations``.
    # Submodule erscheinen nach dem Import im Namensraum des Pakets; alles
    # andere waere ein zusaetzlicher oeffentlicher Name.
    assert oeffentlich - {"DESCRIPTOR", "annotations"} <= {
        "api",
        "events",
        "geometry",
        "models",
        "module",
        "permissions",
        "schemas",
        "service",
    }


def test_modul_hat_die_erwarteten_schichten() -> None:
    vorhanden = {path.name for path in MODULE_ROOT.glob("*.py")}
    assert set(ERWARTETE_DATEIEN) <= vorhanden, set(ERWARTETE_DATEIEN) - vorhanden


def test_kein_leeres_platzhaltermodul() -> None:
    """``materials`` wird nicht vorsorglich angelegt (ADR 0003, Punkt 6)."""
    module_verzeichnisse = {
        path.name
        for path in APP_ROOT.joinpath("modules").iterdir()
        if path.is_dir() and not path.name.startswith("__")
    }
    assert module_verzeichnisse == {"electrical"}


# ------------------------------------------- 5. Tabellen, Rechte und Routen


def test_tabellen_tragen_das_modulpraefix(registry: ModuleRegistry) -> None:
    eigene = {table.name for table in metadata.sorted_tables if table.name not in set(CORE_TABLES)}
    assert eigene == {"electrical_rooms", "electrical_walls", "electrical_openings"}
    for name in eigene:
        assert name.startswith(DESCRIPTOR.table_prefix)


def test_fremdschluessel_zeigen_nur_auf_eigene_und_core_tabellen(
    registry: ModuleRegistry,
) -> None:
    assert check_table_boundaries(registry, metadata, core_tables=CORE_TABLES) == []


def test_verweis_auf_floors_ist_mandantensicher() -> None:
    """Der FK auf die Core-Tabelle ``floors`` ist zusammengesetzt (ADR 0006)."""
    tabelle = metadata.tables["electrical_rooms"]
    ziele = {
        constraint.referred_table.name: {element.parent.name for element in constraint.elements}
        for constraint in tabelle.foreign_key_constraints
    }
    assert ziele["floors"] == {"organization_id", "floor_id"}


def test_permissions_liegen_im_eigenen_namensraum() -> None:
    assert DESCRIPTOR.permission_keys == (PLAN_READ, PLAN_WRITE)
    for key in DESCRIPTOR.permission_keys:
        assert key.startswith("electrical.")


def test_admin_erhaelt_modulrechte_ueber_die_registry(registry: ModuleRegistry) -> None:
    """Der Core kennt die Schluessel nicht - er liest sie aus der Registry."""
    from app.core.authorization.permissions import ADMIN_ROLE_KEY
    from app.core.authorization.service import _role_permission_keys

    admin = _role_permission_keys(registry, ADMIN_ROLE_KEY)

    assert PLAN_READ in admin
    assert PLAN_WRITE in admin
    # Und die Kernrechte bleiben enthalten.
    assert "project.record.write" in admin


def test_modulrouten_liegen_unter_dem_modulpraefix() -> None:
    from app.main import create_app

    pfade = [pfad for pfad, _ in all_routes(create_app()) if "electrical" in pfad]

    assert pfade, "Keine Route des Moduls gefunden"
    for pfad in pfade:
        assert pfad.startswith("/api/v1/modules/electrical/"), pfad


@pytest.mark.parametrize(
    "operation",
    [
        "listElectricalRooms",
        "createElectricalRoom",
        "getElectricalRoom",
        "updateElectricalRoom",
        "deleteElectricalRoom",
        "getElectricalRoomContour",
        "listElectricalWalls",
        "createElectricalWall",
        "updateElectricalWall",
        "reorderElectricalWalls",
        "deleteElectricalWall",
        "listElectricalOpenings",
        "createElectricalOpening",
        "updateElectricalOpening",
        "deleteElectricalOpening",
    ],
)
def test_operation_ids_sind_stabil_und_sprechend(operation: str) -> None:
    """``operation_id`` wird zum Funktionsnamen im erzeugten Client."""
    from app.main import create_app

    vorhanden = {route.operation_id for _, route in all_routes(create_app())}

    assert operation in vorhanden
