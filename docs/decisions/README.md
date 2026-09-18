# Architecture Decision Records

Wichtige Architekturentscheidungen werden hier festgehalten. Eine getroffene Entscheidung
wird **nicht stillschweigend geändert** — wenn sie sich als falsch erweist, entsteht ein
neuer ADR, der den alten ausdrücklich ersetzt (Status `superseded by NNNN`).

Format: Context · Problem · Considered Options · Decision · Consequences

| Nr. | Titel | Status | Datum |
|---|---|---|---|
| [0001](0001-modular-monolith.md) | Modularer Monolith statt Microservices | accepted | 2026-09-18 |
| [0002](0002-postgresql-single-database.md) | PostgreSQL als einzige Datenbank | accepted | 2026-09-18 |
| [0003](0003-module-contracts-and-provider-ports.md) | Modul-Contracts und Provider-Ports | accepted | 2026-09-18 |
| [0004](0004-internal-event-bus.md) | Interner Event Bus mit Post-Commit-Zustellung | accepted | 2026-09-18 |
| [0005](0005-money-rounding-and-quantities.md) | Geld, Rundung und Mengen | accepted | 2026-09-18 |
| [0006](0006-tenant-isolation-and-data-separation.md) | Mandantentrennung und Datentrennung | accepted | 2026-09-18 |
| [0007](0007-identifiers-and-geometry-units.md) | UUIDs und Geometrie in Millimetern | accepted | 2026-09-18 |
| [0008](0008-documentation-language-and-naming.md) | Sprache in Dokumentation und Code | accepted | 2026-09-18 |
| [0009](0009-contracts-source-of-truth.md) | Quelle der Wahrheit für Contracts | accepted | 2026-09-18 |
| [0010](0010-2d-first-editor-with-installation-zones.md) | 2D-First-Editor mit Installationszonen | accepted | 2026-09-18 |

## Wann ein ADR nötig ist

- Wahl oder Wechsel einer zentralen Technologie
- Änderung von Modulgrenzen oder Abhängigkeitsrichtungen
- Neue Contracts oder Ports zwischen Modulen
- Änderungen an Geld-, Rundungs- oder Einheitenregeln
- Änderungen an der Mandantentrennung
- Alles, was eine frühere Entscheidung aufhebt

Kein ADR nötig für: Bibliotheksversionen, Namensgebung innerhalb eines Moduls,
UI-Details, Refactorings ohne Auswirkung auf Grenzen.
