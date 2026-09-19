"""Statische Grenzpruefung fuer Module und ihre Datenbanktabellen.

Diese Datei ergaenzt die Laufzeitpruefungen der Module Registry und die
Contracts des ``import-linter``:

* Sie liest die :class:`~app.core.module_registry.descriptor.ModuleDescriptor`
  aller registrierten Module.
* Sie scannt die tatsaechlichen ``import``-Anweisungen jeder Modul-Datei
  **rein am Dateisystem** per AST. **Es wird kein Anwendungscode
  ausgefuehrt.** ``importlib.import_module`` und
  ``pkgutil.walk_packages`` werden bewusst gemieden - andernfalls waere
  jede Grenzpruefung auch ein Ausfuehren des Moduls.
* Sie liest die SQLAlchemy-Metadaten und ordnet jede Tabelle einem Modul
  ueber dessen ``table_prefix`` zu.

**Regel fuer Backend-Imports.** ``depends_on`` ist eine *fachliche*
Abhaengigkeit und eine Verdrahtungsreihenfolge - **keine
Importerlaubnis**. Ein Modul darf niemals ``app.modules.<anderes>.*``
importieren, in keiner Form: nicht den Paket-Root, nicht dessen
``contracts``, ``providers``, ``schemas``, ``domain`` oder Sonstiges.
Kommunikation zwischen Modulen laeuft ausschliesslich ueber
``app.contracts.v1.*``, typisierte Ports und deren zentrale
Verdrahtung.

**Regel fuer Datenbanktabellen.** Eine Modultabelle referenziert nur
eigene Tabellen oder ausdruecklich freigegebene Core-Tabellen. **Nie**
eine Tabelle eines anderen Moduls, auch wenn dieses in ``depends_on``
steht (docs/modules.md, Abschnitt 8).

Fehler brechen den Build mit Datei-, Zeilen- und Zielangabe ab. Nicht
lesbare oder syntaktisch defekte Dateien und nicht aufloesbare relative
Importe fuehren zu einem Fehler mit Ursachenhinweis - sie werden nicht
stillschweigend uebersprungen.
"""

from __future__ import annotations

import ast
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import MetaData, Table

from app.core.module_registry.descriptor import ModuleDescriptor, ModuleKind
from app.core.module_registry.registry import ModuleRegistry

#: Namensraum fuer Fach- und Shared-Business-Module.
MODULES_ROOT = "app.modules"


# ------------------------------------------------------------ Grundtypen


@dataclass(frozen=True, slots=True)
class BoundaryViolation:
    """Ein einzelner Verstoss gegen eine Modulgrenze.

    ``line`` = 0 signalisiert einen Fund, der keiner Zeile zugeordnet ist
    (z. B. eine defekte Datei oder eine Tabelle ohne Eigentuemer).
    """

    module_id: str
    source_file: str
    line: int
    imported: str
    reason: str

    def describe(self) -> str:
        location = f"{self.source_file}:{self.line}" if self.line else self.source_file
        return f"[{self.module_id}] {location}: imports {self.imported!r} - {self.reason}"


# ------------------------------------------------------------ AST-Scanner


def _resolve_relative(module: str | None, level: int, containing: tuple[str, ...]) -> str | None:
    """Loest einen relativen Import auf den absoluten Modulnamen auf.

    Rueckgabe ``None`` bedeutet: der relative Pfad greift **ueber** das
    Paket ``app`` hinaus (das darf im Backend niemals vorkommen). Der
    Aufrufer meldet das als Fehler.
    """
    if level == 0:
        return module
    if level > len(containing):
        return None
    prefix = containing[: len(containing) - level + 1]
    return ".".join([*prefix, module]) if module else ".".join(prefix)


def _module_of_file(path: Path, source_root: Path) -> tuple[str, ...]:
    """Berechnet den Modulnamen einer Datei aus ihrem Pfad.

    ``__init__.py`` bezeichnet das Paket selbst; andere Dateien ergeben
    ``<paket>.<datei-ohne-endung>``.
    """
    relative = path.relative_to(source_root)
    parts: list[str] = list(relative.with_suffix("").parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return tuple(parts)


@dataclass(slots=True)
class ImportEdge:
    """Ein aufgeloester Import einer Datei."""

    source_file: Path
    line: int
    target: str


def _parse_imports_of_file(
    path: Path, source_root: Path
) -> tuple[list[ImportEdge], list[BoundaryViolation]]:
    """Liest die Import-Anweisungen einer Datei per AST.

    Rueckgabe ist ``(imports, violations)`` - Syntaxfehler und nicht
    aufloesbare relative Importe werden nicht stillschweigend
    verschluckt, sondern als Verstoss zurueckgegeben.
    """
    edges: list[ImportEdge] = []
    problems: list[BoundaryViolation] = []
    module_of = _module_of_file(path, source_root)

    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except SyntaxError as exc:
        problems.append(
            BoundaryViolation(
                module_id="?",
                source_file=str(path),
                line=exc.lineno or 0,
                imported="?",
                reason=f"Datei laesst sich nicht parsen: {exc.msg}",
            )
        )
        return edges, problems
    except OSError as exc:
        problems.append(
            BoundaryViolation(
                module_id="?",
                source_file=str(path),
                line=0,
                imported="?",
                reason=f"Datei nicht lesbar: {exc}",
            )
        )
        return edges, problems

    # Der Kontext fuer relative Imports ist das *Paket*, in dem die Datei
    # liegt. Fuer ``__init__.py`` ist das das Paket selbst; fuer ein
    # Submodul ist es das umschliessende Paket.
    containing = module_of if path.name == "__init__.py" else module_of[:-1]

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                edges.append(ImportEdge(source_file=path, line=node.lineno, target=alias.name))
        elif isinstance(node, ast.ImportFrom):
            absolute = _resolve_relative(node.module, node.level, containing)
            if absolute is None:
                problems.append(
                    BoundaryViolation(
                        module_id="?",
                        source_file=str(path),
                        line=node.lineno,
                        imported=f".{node.module or ''} (level={node.level})",
                        reason=(
                            "Relativer Import geht ueber das Backend-Paket hinaus - "
                            "das ist strukturell verboten"
                        ),
                    )
                )
                continue
            for alias in node.names:
                edges.append(
                    ImportEdge(
                        source_file=path,
                        line=node.lineno,
                        target=f"{absolute}.{alias.name}" if absolute else alias.name,
                    )
                )
    return edges, problems


# ---------------------------------------------------- Import-Grenzpruefung


def _module_source_dir(descriptor: ModuleDescriptor, source_root: Path) -> Path | None:
    """Liefert den erwarteten Modulordner - Core hat keinen unter ``app.modules``."""
    if descriptor.kind is ModuleKind.CORE:
        return None
    return source_root / "modules" / descriptor.id


def _iter_python_files(root: Path) -> Iterable[Path]:
    """Alle ``.py``-Dateien unter ``root`` in stabiler Reihenfolge."""
    return sorted(root.rglob("*.py"))


def check_import_boundaries(
    registry: ModuleRegistry,
    *,
    source_root: Path | None = None,
    require_module_folder: bool = False,
) -> list[BoundaryViolation]:
    """Prueft die Import-Grenzen zwischen allen registrierten Modulen.

    Regeln:

    * Ein Modul unter ``app.modules`` darf **keinerlei** Import auf
      ``app.modules.<anderes>.*`` haben - auch nicht auf dessen
      Paket-Root, ``contracts``, ``providers``, ``schemas``, ``domain``
      oder Sonstiges. Kommunikation laeuft ueber ``app.contracts.v1.*``
      und ueber Ports, die in der Composition Root verdrahtet werden.
    * ``depends_on`` ist keine Importerlaubnis, sondern eine fachliche
      Abhaengigkeit und Verdrahtungsreihenfolge.

    :param source_root: Optional. Standard: ``apps/backend/app`` relativ
        zu dieser Datei.
    :param require_module_folder: Wenn ``True``, meldet die Pruefung
        einen Fehler, sobald ein registriertes Nicht-Core-Modul keinen
        eigenen Ordner unter ``app/modules/<id>`` besitzt. Standardwert
        ``False`` bleibt tolerant, weil ``ModuleDescriptor``-Fixtures
        in Tests ohne Dateisystem-Modul auftreten.
    """
    resolved_source_root = source_root or _default_source_root()
    violations: list[BoundaryViolation] = []

    for descriptor in registry.modules:
        module_dir = _module_source_dir(descriptor, resolved_source_root)
        if module_dir is None:
            continue
        if not module_dir.is_dir():
            if require_module_folder:
                violations.append(
                    BoundaryViolation(
                        module_id=descriptor.id,
                        source_file=str(module_dir),
                        line=0,
                        imported="?",
                        reason=(
                            "Modul ist registriert, aber der erwartete Ordner "
                            f"{module_dir} existiert nicht"
                        ),
                    )
                )
            continue

        for path in _iter_python_files(module_dir):
            edges, problems = _parse_imports_of_file(path, resolved_source_root.parent)
            for problem in problems:
                # Datei- und Modul-ID nachtragen, damit die Meldung eindeutig ist.
                violations.append(
                    BoundaryViolation(
                        module_id=descriptor.id,
                        source_file=problem.source_file,
                        line=problem.line,
                        imported=problem.imported,
                        reason=problem.reason,
                    )
                )
            for edge in edges:
                reason = _classify_import(edge.target, descriptor)
                if reason is not None:
                    violations.append(
                        BoundaryViolation(
                            module_id=descriptor.id,
                            source_file=str(edge.source_file),
                            line=edge.line,
                            imported=edge.target,
                            reason=reason,
                        )
                    )

    return violations


def _classify_import(target: str, descriptor: ModuleDescriptor) -> str | None:
    """Ordnet einen absoluten Zielimport ein.

    Rueckgabe ``None`` bedeutet "erlaubt". Ein String beschreibt den
    Verstoss.
    """
    if not target.startswith(MODULES_ROOT + "."):
        return None
    remainder = target[len(MODULES_ROOT) + 1 :]
    target_module_id = remainder.split(".", 1)[0]
    if target_module_id == descriptor.id:
        return None
    return (
        f"Fremder Modulimport {target!r} - depends_on ist keine "
        "Importerlaubnis. Modulkommunikation laeuft ausschliesslich "
        "ueber app.contracts.v1.*"
    )


def _default_source_root() -> Path:
    """Findet ``apps/backend/app`` relativ zu dieser Datei.

    ``.parents[2]`` = ``apps/backend/app`` (diese Datei liegt unter
    ``app/core/module_registry/boundaries.py``).
    """
    return Path(__file__).resolve().parents[2]


# ------------------------------------------------------------ Datenbankgrenzen


def build_table_module_map(
    registry: ModuleRegistry,
    metadata: MetaData,
    *,
    core_tables: Iterable[str],
) -> dict[str, str | None]:
    """Ordnet jede Tabelle des Metadatensatzes einem Modul zu.

    Der Core ist explizit ueber ``core_tables`` benannt: Er hat kein
    Praefix und muss deshalb ueber eine Positivliste identifiziert
    werden. Alle uebrigen Tabellen werden ueber ``table_prefix`` einem
    Modul zugeordnet; keine Zuordnung liefert ``None``.
    """
    core_set = set(core_tables)
    prefixes = [
        (module.table_prefix, module.id) for module in registry.modules if module.table_prefix
    ]
    # Laengster Praefix zuerst.
    prefixes.sort(key=lambda pair: len(pair[0]), reverse=True)

    result: dict[str, str | None] = {}
    for table in metadata.sorted_tables:
        if table.name in core_set:
            result[table.name] = "core"
            continue
        assigned: str | None = None
        for prefix, module_id in prefixes:
            if table.name.startswith(prefix):
                assigned = module_id
                break
        result[table.name] = assigned
    return result


def check_table_boundaries(
    registry: ModuleRegistry,
    metadata: MetaData,
    *,
    core_tables: Iterable[str],
) -> list[BoundaryViolation]:
    """Prueft die Foreign-Key-Grenzen zwischen Modultabellen.

    Verbindliche Regel: Eine Modultabelle darf nur eigene Tabellen oder
    ausdruecklich freigegebene Core-Tabellen referenzieren.
    ``depends_on`` erlaubt **keine** Fremdtabellen-Referenzen. Ein Modul
    kennt Fremddaten ausschliesslich als externe UUID (ohne FK) und
    validiert sie ueber den veroeffentlichten Contract.
    """
    table_owner = build_table_module_map(registry, metadata, core_tables=core_tables)
    violations: list[BoundaryViolation] = []

    for table in metadata.sorted_tables:
        owner = table_owner[table.name]
        if owner is None:
            violations.append(
                BoundaryViolation(
                    module_id="?",
                    source_file=table.name,
                    line=0,
                    imported=table.name,
                    reason=(
                        "Tabelle ist keinem Modulpraefix zugeordnet und steht "
                        "nicht in der Core-Positivliste"
                    ),
                )
            )
            continue

        if owner == "core":
            continue

        violations.extend(_check_table_fks(table=table, owner=owner, table_owner=table_owner))

    return violations


def _check_table_fks(
    *,
    table: Table,
    owner: str,
    table_owner: dict[str, str | None],
) -> Iterable[BoundaryViolation]:
    for constraint in table.foreign_key_constraints:
        target_name = constraint.referred_table.name
        target_owner = table_owner.get(target_name)

        if target_owner is None:
            yield BoundaryViolation(
                module_id=owner,
                source_file=table.name,
                line=0,
                imported=target_name,
                reason="Ziel-Tabelle ist keinem Modul zugeordnet",
            )
            continue

        if target_owner in {"core", owner}:
            continue

        yield BoundaryViolation(
            module_id=owner,
            source_file=table.name,
            line=0,
            imported=target_name,
            reason=(
                f"Modultabelle referenziert Tabelle des Fremdmoduls {target_owner!r}. "
                "depends_on erlaubt keine Datenbankreferenzen auf fremde Modultabellen; "
                "eine externe UUID ohne FK samt Contract-Validierung ist der einzige Weg"
            ),
        )


def check_table_prefix_matches_descriptor(
    registry: ModuleRegistry, metadata: MetaData, *, core_tables: Iterable[str]
) -> list[BoundaryViolation]:
    """Warnt, wenn eine Tabelle mit dem Praefix eines Moduls beginnt,
    aber in der Core-Positivliste steht. So bleiben Registry-Metadaten
    und Tabellenlandschaft konsistent."""
    core_set = set(core_tables)
    violations: list[BoundaryViolation] = []
    for module in registry.modules:
        if not module.table_prefix:
            continue
        for name in metadata.sorted_tables:
            if name.name.startswith(module.table_prefix) and name.name in core_set:
                violations.append(
                    BoundaryViolation(
                        module_id=module.id,
                        source_file=name.name,
                        line=0,
                        imported=name.name,
                        reason=(
                            "Tabelle steht in der Core-Positivliste, traegt aber das "
                            f"Praefix {module.table_prefix!r} eines Moduls"
                        ),
                    )
                )
    return violations


# ---------------------------------------------------------- Test-Helfer


def scan_directory(module_id: str, module_dir: Path, source_root: Path) -> list[BoundaryViolation]:
    """Scannt einen konkreten Modulordner unter einem alternativen
    Backend-Root - fuer synthetische Tests. Die Regeln sind identisch
    mit :func:`check_import_boundaries`, nur der Datei-Suchpfad ist
    frei gewaehlt.

    Die Klassifizierung nutzt einen minimalen ``ModuleDescriptor``, der
    ausschliesslich ``id`` und ``kind`` benoetigt.
    """
    descriptor = ModuleDescriptor(
        id=module_id, name=module_id, version="test", kind=ModuleKind.DOMAIN
    )
    violations: list[BoundaryViolation] = []
    for path in _iter_python_files(module_dir):
        edges, problems = _parse_imports_of_file(path, source_root)
        for problem in problems:
            violations.append(
                BoundaryViolation(
                    module_id=module_id,
                    source_file=problem.source_file,
                    line=problem.line,
                    imported=problem.imported,
                    reason=problem.reason,
                )
            )
        for edge in edges:
            reason = _classify_import(edge.target, descriptor)
            if reason is not None:
                violations.append(
                    BoundaryViolation(
                        module_id=module_id,
                        source_file=str(edge.source_file),
                        line=edge.line,
                        imported=edge.target,
                        reason=reason,
                    )
                )
    return violations
