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
| [0011](0011-synchronous-sqlalchemy.md) | Synchrones SQLAlchemy statt async | accepted | 2026-09-18 |
| [0012](0012-event-delivery-guarantee.md) | Event-Zustellung: at most once, keine Outbox | accepted | 2026-09-18 |
| [0013](0013-room-contour-as-ordered-wall-segments.md) | Raumkontur als geordnete Wandsegmente | accepted | 2026-09-26 |
| [0014](0014-2d-editor-svg-and-atomic-contour.md) | 2D-Editor: SVG, lokaler Entwurf, atomares Konturspeichern | accepted | 2026-09-26 |
| [0015](0015-membership-administration-and-invitations.md) | Mitgliedschaftsverwaltung, Einladungen, letzter Administrator | accepted | 2026-09-27 |
| [0016](0016-derived-3d-view-wall-height-and-coincident-walls.md) | Abgeleitete 3D-Ansicht: Wandhöhe/Wandlage (T8), deckungsgleiche Wände (T9); präzisiert 4b.2: exakte Teilwände, eine Öffnung als Quelle | accepted | 2026-09-27, präzisiert 2026-09-28 |
| [0017](0017-numbered-pages-for-customer-and-project-lists.md) | Nummerierte Seiten für Kunden- und Projektlisten | accepted | 2026-09-28 |
| [0018](0018-frontend-styling-tailwind-and-theme-tokens.md) | Frontend-Styling: Tailwind CSS mit semantischen Laufzeit-Tokens; präzisiert 4c.2: Wurzelattribute, Akzentschemata, Kontraste | accepted | 2026-09-29, präzisiert 2026-09-30 |
| [0019](0019-personal-display-preferences-local-storage.md) | Persönliche Darstellungseinstellungen: lokal je Benutzer, versioniert | accepted | 2026-09-30 |
| [0020](0020-data-lifecycle-deletion-and-reopen.md) | Datenlebenszyklus: Löschregeln, Wiedereröffnung, Löschschutz-Protokoll, Storage-Aufräumen | accepted | 2026-09-30 |

## Wann ein ADR nötig ist

- Wahl oder Wechsel einer zentralen Technologie
- Änderung von Modulgrenzen oder Abhängigkeitsrichtungen
- Neue Contracts oder Ports zwischen Modulen
- Änderungen an Geld-, Rundungs- oder Einheitenregeln
- Änderungen an der Mandantentrennung
- Alles, was eine frühere Entscheidung aufhebt

Kein ADR nötig für: Bibliotheksversionen, Namensgebung innerhalb eines Moduls,
UI-Details, Refactorings ohne Auswirkung auf Grenzen.
