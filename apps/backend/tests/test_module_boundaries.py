"""Statische Modul- und Datenbankgrenzen (CLAUDE.md, Abschnitt 3).

Diese Tests haerten die drei Ebenen der Architektur *innerhalb* von
``app.modules``: Core -> Shared -> Fachmodul. Sie sind bewusst ergaenzend
zum ``import-linter`` und zur Laufzeitpruefung der Registry:

* Der ``import-linter`` prueft die aeussere Schichtung
  (``modules -> core -> db -> contracts``) und dass Core keine Module
  importiert.
* Diese Datei prueft die feinkoernigen Regeln pro Modul: es ist
  ausschliesslich der Contract-Weg ueber ``app.contracts.v1`` erlaubt.
  ``depends_on`` ist **keine Importerlaubnis**, und keine Modultabelle
  darf eine Tabelle eines anderen Moduls referenzieren.

Die Regelpruefung laeuft rein am Dateisystem: kein ``importlib``, kein
``pkgutil.walk_packages``. Ein realistischer Modulbaum wird als
temporaeres Verzeichnis erzeugt und gegen den vollstaendigen Scanner
ausgefuehrt (``test_scanner_gegen_realistischen_modulbaum``).
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest
from sqlalchemy import (
    Column,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    MetaData,
    Table,
)

from app.core.module import CORE_TABLES
from app.core.module_registry.boundaries import (
    BoundaryViolation,
    _classify_import,
    build_table_module_map,
    check_import_boundaries,
    check_table_boundaries,
    check_table_prefix_matches_descriptor,
    scan_directory,
)
from app.core.module_registry.descriptor import (
    ModuleDescriptor,
    ModuleKind,
)
from app.core.module_registry.registry import ModuleRegistry
from app.model_registry import metadata

# --------------------------------------------------------- reale Konfiguration


def test_reale_konfiguration_verletzt_keine_grenzen(registry: ModuleRegistry) -> None:
    """Die tatsaechlich ausgelieferten Module verletzen keine Regel."""
    assert check_import_boundaries(registry, require_module_folder=True) == []
    assert check_table_boundaries(registry, metadata, core_tables=CORE_TABLES) == []
    assert check_table_prefix_matches_descriptor(registry, metadata, core_tables=CORE_TABLES) == []


def test_jede_tabelle_hat_einen_eigentuemer(registry: ModuleRegistry) -> None:
    """Kein bekanntes Tabellenpraefix bleibt ohne Eintrag."""
    zuordnung = build_table_module_map(registry, metadata, core_tables=CORE_TABLES)
    ohne = [name for name, module_id in zuordnung.items() if module_id is None]
    assert not ohne, f"Tabellen ohne Modul: {ohne}"


# ------------------------------------------------- direkte Klassifizierung


def _domain(module_id: str, **kw: object) -> ModuleDescriptor:
    return ModuleDescriptor(
        id=module_id,
        name=module_id.title(),
        version="1.0.0",
        kind=ModuleKind.DOMAIN,
        table_prefix=f"{module_id}_",
        **kw,  # type: ignore[arg-type]
    )


def _shared(module_id: str, **kw: object) -> ModuleDescriptor:
    return ModuleDescriptor(
        id=module_id,
        name=module_id.title(),
        version="1.0.0",
        kind=ModuleKind.SHARED,
        table_prefix=f"{module_id}_",
        **kw,  # type: ignore[arg-type]
    )


@pytest.mark.parametrize(
    ("descriptor", "target", "erwarte_verstoss"),
    [
        # Fremder Paket-Root
        (_shared("materials", depends_on=("core",)), "app.modules.electrical", True),
        # Fremde contracts
        (
            _shared("materials", depends_on=("core",)),
            "app.modules.electrical.contracts.MaterialProvider",
            True,
        ),
        # Fremde providers
        (
            _shared("materials", depends_on=("core",)),
            "app.modules.electrical.providers.MaterialProvider",
            True,
        ),
        # Fremde schemas
        (
            _shared("materials", depends_on=("core",)),
            "app.modules.electrical.schemas.MaterialSchema",
            True,
        ),
        # Fremde domain
        (
            _shared("materials", depends_on=("core",)),
            "app.modules.electrical.domain.SomeType",
            True,
        ),
        # Auch mit depends_on: verboten (depends_on ist KEINE Importerlaubnis)
        (
            _domain("electrical", depends_on=("core", "materials")),
            "app.modules.materials.contracts.MaterialProvider",
            True,
        ),
        (
            _domain("electrical", depends_on=("core", "materials")),
            "app.modules.materials",
            True,
        ),
        (
            _domain("electrical", depends_on=("core", "materials")),
            "app.modules.materials.providers.M",
            True,
        ),
        # Fachmodul -> Fachmodul
        (
            _domain("electrical", depends_on=("core",)),
            "app.modules.pv.services.X",
            True,
        ),
        # Eigenes Modul
        (
            _domain("electrical", depends_on=("core",)),
            "app.modules.electrical.services.PlanService",
            False,
        ),
        # app.contracts.v1 -> immer erlaubt
        (
            _domain("electrical", depends_on=("core", "materials")),
            "app.contracts.v1.material.MaterialRequirementProvider",
            False,
        ),
        # app.core -> immer erlaubt
        (_domain("electrical", depends_on=("core",)), "app.core.auth.security.hash", False),
        # app.db -> immer erlaubt
        (_domain("electrical", depends_on=("core",)), "app.db.base.Base", False),
        # externe Pakete -> egal
        (_domain("electrical", depends_on=("core",)), "sqlalchemy.orm.Session", False),
    ],
)
def test_klassifizierung_von_imports(
    descriptor: ModuleDescriptor, target: str, erwarte_verstoss: bool
) -> None:
    result = _classify_import(target, descriptor)
    if erwarte_verstoss:
        assert result is not None, (target, descriptor.id)
        assert "depends_on" in result
    else:
        assert result is None, (target, descriptor.id, result)


# ---------------------------------------------- Datei-Scanner (synthetisch)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")


def test_scanner_gegen_realistischen_modulbaum(tmp_path: Path) -> None:
    """Erzeugt einen realistischen Backend-Baum aus mehreren Dateien und
    faehrt den Scanner ueber ihn. Deckt absolute wie relative Imports und
    das Root-``__init__.py`` ab."""
    source_root = tmp_path / "app"
    (source_root / "modules").mkdir(parents=True)
    (source_root / "contracts" / "v1").mkdir(parents=True)
    (source_root / "core").mkdir()
    (source_root / "db").mkdir()

    (source_root / "__init__.py").write_text("", encoding="utf-8")
    (source_root / "modules" / "__init__.py").write_text("", encoding="utf-8")
    (source_root / "contracts" / "__init__.py").write_text("", encoding="utf-8")
    (source_root / "contracts" / "v1" / "__init__.py").write_text(
        "class SomeContract: ...", encoding="utf-8"
    )
    (source_root / "core" / "__init__.py").write_text("", encoding="utf-8")
    (source_root / "db" / "__init__.py").write_text("", encoding="utf-8")

    # Fremdes Modul auf Dateisystem: ``pv``.
    _write(source_root / "modules" / "pv" / "__init__.py", "")
    _write(source_root / "modules" / "pv" / "services.py", "class PvService: ...")
    _write(source_root / "modules" / "pv" / "contracts.py", "class PvContract: ...")

    # Zu pruefendes Modul ``electrical``.
    electrical_dir = source_root / "modules" / "electrical"
    _write(
        electrical_dir / "__init__.py",
        """
        # Root-__init__.py wird ebenfalls gescannt.
        from app.contracts.v1 import SomeContract  # noqa: F401  -> erlaubt
        """,
    )
    _write(
        electrical_dir / "services.py",
        """
        from app.core.auth import security  # noqa: F401  -> erlaubt
        from app.modules.pv.services import PvService  # -> verboten (Fachmodul)
        """,
    )
    _write(
        electrical_dir / "planner.py",
        """
        from app.modules.pv import PvService  # -> verboten (Paket-Root)
        from app.modules.pv.contracts import PvContract  # -> verboten (angeblich oeffentlich)
        """,
    )
    _write(
        electrical_dir / "own_stuff.py",
        """
        from .services import something as _  # noqa: F401  -> eigenes Modul
        from . import services  # noqa: F401  -> eigenes Paket
        """,
    )

    violations = scan_directory(
        module_id="electrical",
        module_dir=electrical_dir,
        source_root=source_root,
    )
    ziele = sorted((v.imported, v.line > 0) for v in violations)
    assert ziele == sorted(
        [
            ("app.modules.pv.services.PvService", True),
            ("app.modules.pv.PvService", True),
            ("app.modules.pv.contracts.PvContract", True),
        ]
    )
    for v in violations:
        assert "depends_on" in v.reason


def test_scanner_meldet_syntaxfehler(tmp_path: Path) -> None:
    source_root = tmp_path / "app"
    module_dir = source_root / "modules" / "electrical"
    _write(module_dir / "__init__.py", "")
    _write(module_dir / "broken.py", "def bad(:\n    pass\n")

    violations = scan_directory(
        module_id="electrical",
        module_dir=module_dir,
        source_root=source_root,
    )
    assert any("nicht parsen" in v.reason for v in violations)


def test_scanner_meldet_relativen_import_ueber_paket_hinaus(tmp_path: Path) -> None:
    source_root = tmp_path / "app"
    module_dir = source_root / "modules" / "electrical"
    _write(module_dir / "__init__.py", "")
    _write(
        module_dir / "reach.py",
        "from .......somewhere import X  # -> ueber app hinaus\n",
    )

    violations = scan_directory(
        module_id="electrical",
        module_dir=module_dir,
        source_root=source_root,
    )
    assert any("ueber das Backend-Paket hinaus" in v.reason for v in violations)


def test_fehlender_modulordner_wird_gemeldet(tmp_path: Path) -> None:
    """Ein registriertes Nicht-Core-Modul ohne Ordner wird streng gemeldet."""
    registry = ModuleRegistry()
    registry.register(_shared("materials", depends_on=()))
    fake_root = tmp_path / "empty_app"
    (fake_root / "modules").mkdir(parents=True)

    violations = check_import_boundaries(
        registry, source_root=fake_root, require_module_folder=True
    )
    assert any("erwartete Ordner" in v.reason for v in violations)


# ------------------------------------------- Datenbankgrenzen (Metadaten)


def _build_synth_registry() -> ModuleRegistry:
    registry = ModuleRegistry()
    registry.register(_shared("materials", depends_on=("core",)))
    registry.register(_shared("inventory", depends_on=("core", "materials")))
    registry.register(_domain("electrical", depends_on=("core", "materials")))
    registry.register(_domain("pv", depends_on=("core",)))
    return registry


def _md_with_organizations() -> MetaData:
    md = MetaData()
    Table("organizations", md, Column("id", Integer, primary_key=True))
    return md


def test_erlaubt_eigene_modultabelle_zu_eigener_modultabelle() -> None:
    md = _md_with_organizations()
    Table("materials_items", md, Column("id", Integer, primary_key=True))
    Table(
        "materials_prices",
        md,
        Column("id", Integer, primary_key=True),
        Column("item_id", Integer, ForeignKey("materials_items.id")),
    )
    assert check_table_boundaries(_build_synth_registry(), md, core_tables=("organizations",)) == []


def test_erlaubt_referenz_auf_core_tabelle() -> None:
    md = _md_with_organizations()
    Table(
        "materials_items",
        md,
        Column("id", Integer, primary_key=True),
        Column("organization_id", Integer, ForeignKey("organizations.id")),
    )
    assert check_table_boundaries(_build_synth_registry(), md, core_tables=("organizations",)) == []


def test_shared_darf_shared_nicht_referenzieren() -> None:
    md = _md_with_organizations()
    Table("materials_items", md, Column("id", Integer, primary_key=True))
    Table(
        "inventory_stock",
        md,
        Column("id", Integer, primary_key=True),
        Column("material_id", Integer, ForeignKey("materials_items.id")),
    )
    violations = check_table_boundaries(_build_synth_registry(), md, core_tables=("organizations",))
    assert any("Fremdmoduls 'materials'" in v.reason for v in violations)


def test_fachmodul_darf_shared_nicht_referenzieren() -> None:
    md = _md_with_organizations()
    Table("materials_items", md, Column("id", Integer, primary_key=True))
    Table(
        "electrical_devices",
        md,
        Column("id", Integer, primary_key=True),
        Column("material_id", Integer, ForeignKey("materials_items.id")),
    )
    violations = check_table_boundaries(_build_synth_registry(), md, core_tables=("organizations",))
    assert any("Fremdmoduls 'materials'" in v.reason for v in violations)


def test_fachmodul_darf_fachmodul_nicht_referenzieren() -> None:
    md = _md_with_organizations()
    Table("electrical_rooms", md, Column("id", Integer, primary_key=True))
    Table(
        "pv_strings",
        md,
        Column("id", Integer, primary_key=True),
        Column("room_id", Integer, ForeignKey("electrical_rooms.id")),
    )
    violations = check_table_boundaries(_build_synth_registry(), md, core_tables=("organizations",))
    assert any("Fremdmoduls 'electrical'" in v.reason for v in violations)


def test_shared_darf_fachmodul_nicht_referenzieren() -> None:
    md = _md_with_organizations()
    Table("electrical_rooms", md, Column("id", Integer, primary_key=True))
    Table(
        "materials_reservations",
        md,
        Column("id", Integer, primary_key=True),
        Column("room_id", Integer, ForeignKey("electrical_rooms.id")),
    )
    violations = check_table_boundaries(_build_synth_registry(), md, core_tables=("organizations",))
    assert any("Fremdmoduls 'electrical'" in v.reason for v in violations)


def test_unbekannter_tabellenbesitzer_wird_verweigert() -> None:
    md = _md_with_organizations()
    Table("mystery_something", md, Column("id", Integer, primary_key=True))
    violations = check_table_boundaries(_build_synth_registry(), md, core_tables=("organizations",))
    assert any("keinem modulpraefix" in v.reason.lower() for v in violations)


def test_zusammengesetzter_fk_zwischen_modulen_bleibt_verboten() -> None:
    """Ein mandantensicherer zusammengesetzter FK aendert das Modulverbot nicht."""
    md = MetaData()
    Table(
        "organizations",
        md,
        Column("id", Integer, primary_key=True),
    )
    Table(
        "electrical_rooms",
        md,
        Column("organization_id", Integer, primary_key=True),
        Column("id", Integer, primary_key=True),
    )
    Table(
        "pv_strings",
        md,
        Column("organization_id", Integer, primary_key=True),
        Column("id", Integer, primary_key=True),
        Column("room_id", Integer),
        ForeignKeyConstraint(
            ("organization_id", "room_id"),
            ("electrical_rooms.organization_id", "electrical_rooms.id"),
        ),
    )
    violations = check_table_boundaries(_build_synth_registry(), md, core_tables=("organizations",))
    assert any("Fremdmoduls 'electrical'" in v.reason for v in violations)


def test_depends_on_hebt_verbot_nicht_auf() -> None:
    """Selbst wenn ``electrical`` ``materials`` als depends_on fuehrt,
    darf eine electrical-Tabelle keine materials-Tabelle referenzieren."""
    md = _md_with_organizations()
    Table("materials_items", md, Column("id", Integer, primary_key=True))
    Table(
        "electrical_bill_items",
        md,
        Column("id", Integer, primary_key=True),
        Column("material_id", Integer, ForeignKey("materials_items.id")),
    )
    violations = check_table_boundaries(_build_synth_registry(), md, core_tables=("organizations",))
    assert any("depends_on erlaubt keine" in v.reason for v in violations)


def test_boundary_violation_describe_liefert_datei_und_zeile() -> None:
    example_path = "example/foo.py"
    v = BoundaryViolation(
        module_id="electrical",
        source_file=example_path,
        line=42,
        imported="app.modules.materials.contracts.Thing",
        reason="test",
    )
    beschreibung = v.describe()
    assert f"{example_path}:42" in beschreibung
    assert "app.modules.materials.contracts.Thing" in beschreibung
