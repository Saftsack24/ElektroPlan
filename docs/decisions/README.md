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
| [0015](0015-membership-administration-and-invitations.md) | Mitgliedschaftsverwaltung, Einladungen, letzter Administrator; präzisiert durch 0021 (exklusive Konten) | accepted | 2026-09-27, präzisiert 2026-10-01 |
| [0016](0016-derived-3d-view-wall-height-and-coincident-walls.md) | Abgeleitete 3D-Ansicht: Wandhöhe/Wandlage (T8), deckungsgleiche Wände (T9); präzisiert 4b.2: exakte Teilwände, eine Öffnung als Quelle | accepted | 2026-09-27, präzisiert 2026-09-28 |
| [0017](0017-numbered-pages-for-customer-and-project-lists.md) | Nummerierte Seiten für Kunden- und Projektlisten | accepted | 2026-09-28 |
| [0018](0018-frontend-styling-tailwind-and-theme-tokens.md) | Frontend-Styling: Tailwind CSS mit semantischen Laufzeit-Tokens; präzisiert 4c.2: Wurzelattribute, Akzentschemata, Kontraste | accepted | 2026-09-29, präzisiert 2026-09-30 |
| [0019](0019-personal-display-preferences-local-storage.md) | Persönliche Darstellungseinstellungen: lokal je Benutzer, versioniert | superseded by 0021 (Speicherort; lokal nur noch Cache) | 2026-09-30 |
| [0020](0020-data-lifecycle-deletion-and-reopen.md) | Datenlebenszyklus: Löschregeln, Wiedereröffnung, Löschschutz-Protokoll, Storage-Aufräumen; erweitert durch 0022 (`completed` schreibgeschützt) | accepted | 2026-09-30, erweitert 2026-10-02 |
| [0021](0021-user-lifecycle-account-locks-password-reset-preferences.md) | Benutzerlebenszyklus: exklusive Konten, Sperren mit Sitzungsversion, Passwortzurücksetzung, Entfernen als Tombstone, serverseitige Einstellungen, Maßeinheit m | accepted | 2026-10-01 |
| [0022](0022-wall-and-ceiling-view.md) | Wand- und Deckenansicht: Blickrichtung, Maßbezug, Einrasten, gemeinsamer Entwurf; `completed` schreibgeschützt; Teilnehmer-Prüfung der Geschoss-Standardhöhe | accepted | 2026-10-02 |
| [0023](0023-electrical-devices-symbols-room-types.md) | Elektrogeräte: Montagefläche und Gerätemitte, Gerätekatalog per Seed (`ReferenceDataSeeder`), exakte Geräteprüfung inkl. Nachbarräume, gemeinsamer Raumentwurf; T1 eigene Symbole, T7 Raumtyp | accepted | 2026-10-04 |
| [0024](0024-wall-links-physical-wall-assignment.md) | Physische Wandzuordnung als Wandkopplung zweier Raumwände (T10), Zustände unentschieden/shared/separate, Geometrie bleibt abgeleitet; bewusst begrenztes Paarmodell | accepted (umgesetzt in 6a.1–6a.3) | 2026-10-06 |
| [0025](0025-risers-between-floors.md) | Bestätigte Höhenlage im Core (6a.0); Steigwege mit definiertem Verlauf (T4, 6a.4–6a.5) | accepted (umgesetzt) | 2026-10-06 |
| [0026](0026-circuits-cables-and-cable-paths.md) | Verteilungen, Stromkreise (Kabelangaben als Vorschlag), Leitungen mit eigenen Kabelangaben und Wegpunkten (Wand, Decke, Fußboden), abgeleitete Trassen, Durchführungen, Steigwegnutzung, Leitungslängen (Phase 6b) | accepted (6b.0–6b.6 technisch umgesetzt und geprüft; manuelle Gesamtprüfung offen) | 2026-10-11 |
| [0027](0027-planning-defaults-cable-templates-and-reserve.md) | Planungsvorgaben (Betrieb, Projekt), Kabelvorlagen, Prioritätskette, prozentuale Leitungsreserve, zentrale Anwendung mit Vorschau; löst 0026 D5 ab (Phase 6c) | proposed | 2026-10-15 |
| [0028](0028-distribution-board-placement-and-layout.md) | Atomare Platzierung des Lagegeräts einer Verteilung; Aufbau mit Reihen, Teilungseinheiten, Komponenten, Vorlagen und Hinweisregeln (Phase 6c) | proposed | 2026-10-15 |
| [0029](0029-module-display-preference-flags.md) | Modulbezogene Ja/Nein-Anzeigeschalter in den persönlichen Einstellungen; erweitert 0021 (Phase 6c) | proposed | 2026-10-15 |
| [0030](0030-organization-device-types.md) | Betriebseigene Gerätetypen im Gerätekatalog: Geltungsbereich, Mandanten-FK, Feldsperre statt Typversionen (Gerätekatalog K2) | proposed | 2026-10-25 |

## Wann ein ADR nötig ist

- Wahl oder Wechsel einer zentralen Technologie
- Änderung von Modulgrenzen oder Abhängigkeitsrichtungen
- Neue Contracts oder Ports zwischen Modulen
- Änderungen an Geld-, Rundungs- oder Einheitenregeln
- Änderungen an der Mandantentrennung
- Alles, was eine frühere Entscheidung aufhebt

Kein ADR nötig für: Bibliotheksversionen, Namensgebung innerhalb eines Moduls,
UI-Details, Refactorings ohne Auswirkung auf Grenzen.
