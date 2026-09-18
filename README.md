# ElektroPlan

Modulare Softwareplattform für Elektrofachbetriebe — von der Kundenanfrage über die
technische Planung, den Materialbedarf und die Kalkulation bis zum Angebot, Auftrag und
zur Nachkalkulation.

**Status: Phase 0 (Architektur und Dokumentation) abgeschlossen.
Es existiert noch kein Anwendungscode.**

---

## Worum es geht

ElektroPlan verbindet Arbeitsschritte, die in vielen Betrieben in getrennten Werkzeugen
stattfinden:

```
Kunde → Projekt → Aufmaß → Planung → Materialbedarf → Arbeitszeit
      → Kalkulation → Angebot → Auftrag → Baustelle → Soll/Ist → Nachkalkulation
```

Der eigentliche Gedanke ist nicht ein einzelnes Planungswerkzeug, sondern eine
**Plattform**: Fachmodule (Elektroplanung, später Photovoltaik, KNX, Wallbox) liefern
ihren Bedarf über dieselben Schnittstellen an dieselbe Material-, Lager-, Kalkulations-
und Angebotskette.

---

## Architektur in fünf Sätzen

1. **Modularer Monolith** — ein Backend, eine Datenbank, aber harte interne Modulgrenzen.
2. Drei Ebenen: **Core** (Mandanten, Benutzer, Projekte) · **Shared Business Modules**
   (Material, Lager, Kalkulation, Angebote, Aufträge) · **Fachmodule** (Elektro, später PV).
3. Module kommunizieren ausschließlich über **Contracts, Provider-Ports und Domain Events**
   — nie über fremde Tabellen oder Modelle.
4. Ein Fachmodul liefert `MaterialRequirement` und `LaborRequirement`; alles Weitere —
   Preise, Bestände, Angebote — erledigt die Plattform.
5. Die Grenzen werden **maschinell geprüft**, nicht nur dokumentiert.

Ausführlich: [`docs/architecture.md`](docs/architecture.md)

---

## Technologie

| Bereich | Stack |
|---|---|
| Backend | Python 3.12+, FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL 17 |
| Frontend | TypeScript (strict), React, Vite, TanStack Query, Zod |
| 3D | Three.js (Ansicht, ab Phase 4b) |
| Mobil | React + Capacitor, später ARCore (ab Phase 13) |
| Dateien | S3-kompatibler Object Storage (lokal MinIO) |
| Infrastruktur | Docker, Docker Compose |

---

## Dokumentation

| Datei | Inhalt |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Verbindliche Arbeitsregeln für Entwicklung und KI-Sessions |
| [`docs/current-status.md`](docs/current-status.md) | **Hier zuerst nachsehen** — aktueller Stand |
| [`docs/architecture.md`](docs/architecture.md) | Architektur, Ebenen, Modulgrenzen, Datenfluss |
| [`docs/architecture-review.md`](docs/architecture-review.md) | Kritische Prüfung des Masterplans, Befunde und Risiken |
| [`docs/database.md`](docs/database.md) | ER-Modell, Tabellen, Konventionen, Indizes |
| [`docs/modules.md`](docs/modules.md) | Modullandschaft, Registrierung, Durchsetzung der Grenzen |
| [`docs/contracts.md`](docs/contracts.md) | Contracts und Provider-Ports |
| [`docs/events.md`](docs/events.md) | Event Bus, Regeln, Event-Katalog |
| [`docs/api.md`](docs/api.md) | API-Richtlinien, Fehlerformat, Datentypen |
| [`docs/security.md`](docs/security.md) | Sicherheits- und Datenschutzkonzept |
| [`docs/roadmap.md`](docs/roadmap.md) | Phasen, Status, Meilensteine |
| [`docs/phase-1-plan.md`](docs/phase-1-plan.md) | Detailplan der nächsten Phase |
| [`docs/glossary.md`](docs/glossary.md) | Fachbegriffe Deutsch ↔ Englisch |
| [`docs/task-history.md`](docs/task-history.md) | Was wann warum geändert wurde |
| [`docs/changelog.md`](docs/changelog.md) | Änderungsprotokoll |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records |
| [`docs/modules/`](docs/modules/) | Fachdokumentation je Modul |

---

## Aktuelle Phase

**Phase 0 — abgeschlossen.** Architektur, ER-Modell, Contracts, Event-Regeln,
Modulregistrierung, Sicherheitskonzept und Dokumentationsstruktur stehen.
Zehn Architekturentscheidungen sind als ADR festgehalten.

**Phase 1 — Platform Foundation** ist geplant und wartet auf Freigabe:
Monorepo, Docker Compose, FastAPI, PostgreSQL, Organisationen, Benutzer,
Authentifizierung, Permissions, Module Registry, Event Bus, React-Shell.

Details: [`docs/phase-1-plan.md`](docs/phase-1-plan.md)

---

## Entwicklung starten

Noch nicht möglich — Phase 1 ist nicht begonnen.
Ab Phase 1 gilt:

```bash
docker compose up
```

Die vollständige Anleitung wird mit Aufgabe T-0018 in dieses Dokument aufgenommen.

---

## Mitwirkungsregeln

1. Vor jeder Änderung `CLAUDE.md` und `docs/current-status.md` lesen.
2. Modulgrenzen einhalten — sie werden in CI geprüft.
3. Nach jedem Arbeitsauftrag `current-status.md` und `task-history.md` aktualisieren.
4. Architekturentscheidungen als ADR festhalten, nicht stillschweigend ändern.
5. Keine destruktiven Git-Befehle ohne ausdrückliche Freigabe.

---

## Hinweis zur Elektrotechnik

ElektroPlan trifft **keine** sicherheitsrelevanten elektrotechnischen Entscheidungen.
Querschnitte, Schutzorgane und Normkonformität werden weder automatisch ermittelt noch
geprüft. Das System rechnet, dokumentiert und schlägt vor — die verantwortliche
Elektrofachkraft entscheidet und gibt frei.
