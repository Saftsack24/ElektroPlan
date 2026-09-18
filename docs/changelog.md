# Changelog

Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).
Einträge entstehen nach relevanten Änderungen, nicht nach jedem Commit.

---

## 2026-09-18 — Phase 0: Architektur und Dokumentation

### Added

- Projektdokumentation angelegt: `README.md`, `CLAUDE.md` und `docs/`
- `docs/architecture.md` — Architektur, drei Ebenen, Modulgrenzen, Datenfluss,
  Einfrierpunkte, Durchsetzungsmechanismen
- `docs/architecture-review.md` — kritische Prüfung des Masterplans mit 16 Befunden,
  10 Risiken und 11 begründeten Abweichungen
- `docs/database.md` — ER-Modell für Core, electrical, materials, inventory, calculation,
  offers, work_orders inklusive Constraints, Indizes und Migrationsregeln
- `docs/modules.md` — Modullandschaft, Provider-Ports, Backend- und
  Frontend-Modulregistrierung, maschinelle Durchsetzung der Grenzen
- `docs/contracts.md` — Contract-Definitionen inkl. `MaterialRequirement`,
  `LaborRequirement`, `OfferItemSuggestion`, `InventoryService`, `PricingService`
- `docs/events.md` — Event-Bus-Regeln, Envelope, Event-Katalog, Recompute-Pflicht
- `docs/api.md` — API-Richtlinien, Versionierung, RFC-9457-Fehlerformat, Datentypen
- `docs/security.md` — Schutzbedarf, Bedrohungsmodell, Authentifizierung,
  Mandantentrennung, Uploads, DSGVO, Backup
- `docs/roadmap.md` — Phasen 0–20 mit Status, Exit-Kriterien und Meilensteinen
- `docs/phase-1-plan.md` — 18 Aufgaben für Phase 1 mit Abhängigkeiten und Definition of Done
- `docs/glossary.md` — Fachbegriffe Deutsch ↔ Englisch
- `docs/current-status.md`, `docs/task-history.md`
- `docs/modules/` — Fachdokumentation für electrical, materials, inventory, calculation,
  offers, work-orders
- `docs/decisions/` — ADR 0001 bis 0010 mit Index

### Changed (gegenüber Masterplan v1.0)

- **§5:** Handgepflegtes TypeScript-Contract-Paket entfällt. Python ist Quelle der
  Wahrheit, `packages/api-client` wird aus OpenAPI generiert (ADR 0009)
- **§6:** Event Bus stellt erst nach dem Commit zu; Zustellung ist at-most-once; jede
  eventgetriebene Ableitung braucht einen Recompute-Endpunkt (ADR 0004)
- **§11/§13:** Benutzer sind globale Identitäten; Zugehörigkeit über
  `organization_members` (ADR 0006)
- **§16:** Tür und Fenster zu `electrical_openings` mit `kind` zusammengefasst
- **§17:** Phase 4 in 4a (2D-Editor) und 4b (3D-Ansicht) geteilt; Z-Koordinaten werden aus
  Installationszonen abgeleitet (ADR 0010)
- **§21/§22:** Eine Material Engine statt zweier Regelwerke; globale Regeln verändern nur
  Mengen (ADR 0003)
- **§21:** Drei getrennte Mengen — `required`, `planned`, `procurement` (ADR 0003)
- **§25:** Geld zusätzlich als String über die API, nie als JSON-Number (ADR 0005)
- **§29:** Trennung interner Daten strukturell — Angebotstabellen ohne Kostenspalten
  (ADR 0006)
- **§33:** Offline-Felder nur auf Tabellen, die die Baustellen-App beschreibt
- **§18:** Geometrie als ganzzahlige Millimeter statt Fließkomma (ADR 0007)

### Notes

Kein Anwendungscode. Keine Datenbank. Keine Abhängigkeiten installiert.
Phase 1 wartet auf ausdrückliche Freigabe.
