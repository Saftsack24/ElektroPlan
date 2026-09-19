"""Architekturschranken (CLAUDE.md, Abschnitt 3).

Eine Regel ohne automatische Pruefung gilt in diesem Projekt als unverbindlich.
Diese Tests setzen die Regeln durch, die sich am leichtesten unbemerkt
verletzen lassen.
"""

from __future__ import annotations

from sqlalchemy import Float, Numeric, Table

from app.core.auth.dependencies import PermissionRequirement
from app.core.module import CORE_TABLES
from app.core.module_registry.registry import ModuleRegistry
from app.main import create_app
from app.model_registry import metadata
from tests.routes import all_routes

MUTATING_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})

#: Endpunkte, die bewusst keine Permission verlangen: Sie stellen die
#: Authentifizierung ueberhaupt erst her.
PERMISSION_EXEMPT_PATHS = frozenset(
    {
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/logout",
        "/api/v1/auth/switch-organization",
    }
)

#: Spalten, die Geldbetraege oder Mengen fuehren, muessen ``numeric`` sein.
MONEY_COLUMN_HINTS = ("price", "cost", "amount", "total", "rate", "quantity", "percent")


def tenant_tables() -> list[Table]:
    """Alle Tabellen mit Mandantenbezug."""
    return [table for table in metadata.sorted_tables if "organization_id" in table.c]


# ------------------------------------------------------------ Mandantentrennung


def test_mandantentabellen_haben_organization_id_not_null() -> None:
    for table in tenant_tables():
        column = table.c["organization_id"]
        assert not column.nullable, f"{table.name}.organization_id darf nicht NULL sein"


def test_mandantentabellen_indizieren_organization_id() -> None:
    """Ohne Index wird jede mandantengefilterte Abfrage zum Seq Scan."""
    for table in tenant_tables():
        indexed = any(
            "organization_id" in {column.name for column in index.columns}
            for index in table.indexes
        )
        primary = "organization_id" in {column.name for column in table.primary_key.columns}
        unique = any(
            "organization_id" in {column.name for column in constraint.columns}
            for constraint in table.constraints
            if hasattr(constraint, "columns")
        )
        assert indexed or primary or unique, f"{table.name}.organization_id ist nicht indiziert"


def test_referenzen_zwischen_mandantentabellen_sind_zusammengesetzt() -> None:
    """ADR 0006: Verweise laufen ueber ``(organization_id, id)``.

    Ein einspaltiger Fremdschluessel zwischen zwei mandantenbezogenen Tabellen
    wuerde einen mandantenuebergreifenden Verweis technisch erlauben.
    """
    tenant_table_names = {table.name for table in tenant_tables()}
    problems: list[str] = []

    for table in tenant_tables():
        for constraint in table.foreign_key_constraints:
            target = constraint.referred_table.name
            if target not in tenant_table_names or target == table.name:
                continue
            columns = {element.parent.name for element in constraint.elements}
            if "organization_id" not in columns:
                problems.append(f"{table.name} -> {target} ueber {sorted(columns)}")

    assert not problems, (
        "Einspaltige Fremdschluessel zwischen Mandantentabellen gefunden: " + ", ".join(problems)
    )


# ------------------------------------------------------------------- Geld


def test_keine_float_spalten() -> None:
    """ADR 0005: Fachliche Werte sind niemals Fliesskomma."""
    problems = [
        f"{table.name}.{column.name}"
        for table in metadata.sorted_tables
        for column in table.c
        if isinstance(column.type, Float)
    ]
    assert not problems, f"Float-Spalten gefunden: {problems}"


def test_geld_und_mengenspalten_sind_numeric() -> None:
    problems = [
        f"{table.name}.{column.name} ({column.type})"
        for table in metadata.sorted_tables
        for column in table.c
        if any(hint in column.name for hint in MONEY_COLUMN_HINTS)
        and not isinstance(column.type, Numeric)
    ]
    assert not problems, f"Betrags-/Mengenspalten ohne numeric: {problems}"


# --------------------------------------------------------------- Modulgrenzen


def test_tabellenpraefixe_entsprechen_den_modulen(registry: ModuleRegistry) -> None:
    """Jede Tabelle gehoert sichtbar zu genau einem Modul.

    Die Core-Positivliste kommt aus :data:`app.core.module.CORE_TABLES` und
    ist damit die einzige Quelle - die feinkoernige Grenzpruefung in
    ``test_module_boundaries.py`` benutzt dieselbe Liste.
    """
    prefixes = {
        module.table_prefix: module.id for module in registry.modules if module.table_prefix
    }
    core_tables = set(CORE_TABLES)
    for table in metadata.sorted_tables:
        if table.name in core_tables:
            continue
        assert any(table.name.startswith(prefix) for prefix in prefixes), (
            f"Tabelle {table.name} gehoert zu keinem registrierten Modulpraefix"
        )


def test_core_tabellen_sind_vollstaendig_erfasst() -> None:
    """Warnt, wenn eine neue Tabelle hinzukommt, ohne die Liste zu pflegen."""
    assert len(metadata.sorted_tables) == 17, (
        "Anzahl der Tabellen hat sich geaendert - test_architecture.py und "
        "docs/database.md pruefen."
    )


# ----------------------------------------------------------------- Permissions


def test_jede_schreibende_route_deklariert_eine_permission() -> None:
    """Ein Endpunkt ohne Permission-Deklaration ist ein Fehler."""
    app = create_app()
    problems: list[str] = []

    for path, route in all_routes(app):
        if not (route.methods & MUTATING_METHODS):
            continue
        if path in PERMISSION_EXEMPT_PATHS:
            continue
        declared = any(
            isinstance(dependency.call, PermissionRequirement)
            for dependency in route.dependant.dependencies
        )
        if not declared:
            problems.append(f"{sorted(route.methods)} {path}")

    assert not problems, f"Schreibende Routen ohne Permission: {problems}"


def test_deklarierte_permissions_sind_registriert(registry: ModuleRegistry) -> None:
    """Keine Route darf eine Permission verlangen, die kein Modul registriert."""
    known = {key for key, _, _ in registry.all_permissions()}
    app = create_app()
    problems: list[str] = []

    for path, route in all_routes(app):
        for dependency in route.dependant.dependencies:
            call = dependency.call
            if isinstance(call, PermissionRequirement) and call.permission not in known:
                problems.append(f"{path}: {call.permission}")

    assert not problems, f"Unbekannte Permissions in Routen: {problems}"
