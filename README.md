# ElektroPlan

Modulare Softwareplattform für Elektrofachbetriebe — von der Kundenanfrage über die
technische Planung, den Materialbedarf und die Kalkulation bis zum Angebot, Auftrag und
zur Nachkalkulation.

**Status: Phase 1 (Platform Foundation) implementiert — Abnahme mit laufender
Datenbank steht aus.** Details in [`docs/current-status.md`](docs/current-status.md).

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
Elf Architekturentscheidungen sind als ADR festgehalten.

**Phase 1 — Platform Foundation — implementiert, Abnahme offen.**
Backend mit Core-Datenmodell, Authentifizierung, Autorisierung, Mandantentrennung,
Module Registry, Event Bus, Audit und Object Storage; React-Shell mit
Modulregistrierung und generiertem API-Client.

Geprüft: Ruff, mypy `--strict`, `import-linter`, ein Alembic-Head, 85 Backend-Tests,
7 Frontend-Tests, Build. Offen: die 23 Tests, die PostgreSQL benötigen, sowie
`docker compose up` — beides ist auf dem Entwicklungsrechner nicht verfügbar.

---

## Entwicklung starten

### Einmalig

```bash
cp .env.example .env
```

```powershell
.\tasks.ps1 install
```

Ohne PowerShell (Linux/macOS oder Git Bash mit make):

```bash
make install
```

**Reproduzierbarkeit:** Installiert wird ausschließlich aus den eingecheckten
Lockdateien — `apps/backend/uv.lock` über `uv sync --frozen` und
`package-lock.json` über `npm ci`. Eine frische Umgebung erhält damit exakt die
getesteten Versionen. Es gibt bewusst **keinen** zweiten Installationsweg
(kein `pip install -e .`, kein `npm install` in Skripten).

Abhängigkeiten ändern:

```powershell
.\tasks.ps1 lock
```

(`pyproject.toml` anpassen, dann `lock` — die aktualisierte `uv.lock` wird mit
eingecheckt. `.\tasks.ps1 check` prüft mit `uv lock --check`, dass sie aktuell ist.)

### Dienste starten

```bash
docker compose up
```

Danach Datenbank vorbereiten und Startbestand anlegen:

```bash
docker compose exec backend alembic upgrade head
```

```bash
docker compose exec backend python -m app.cli seed
```

| Dienst | Adresse |
|---|---|
| Planner (Weboberfläche) | http://localhost:5173 |
| Backend-API | http://localhost:8000 |
| API-Dokumentation | http://localhost:8000/docs |
| MinIO-Konsole | http://localhost:9001 |

Anmeldedaten stammen aus `.env` (`ELEKTROPLAN_SEED_ADMIN_EMAIL`,
`ELEKTROPLAN_SEED_ADMIN_PASSWORD`).

### Qualitätsschranken

```powershell
.\tasks.ps1 check
```

Führt Lint, Formatprüfung, Typprüfung, Modulgrenzen, Alembic-Head-Prüfung,
Lockfile-Prüfung, Tests, Drift-Check und Build aus.

**Für die Datenbanktests** einmalig eine Testdatenbank anlegen und die Variable setzen:

```bash
docker compose exec postgres createdb -U elektroplan elektroplan_test
```

```powershell
$env:ELEKTROPLAN_TEST_DATABASE_URL = 'postgresql+psycopg://elektroplan:elektroplan@localhost:5432/elektroplan_test'
```

Ohne diese Variable überspringen die Datenbanktests **sichtbar** — sie laufen
bewusst nicht ersatzweise gegen SQLite.

### Weitere Befehle

| Befehl | Wirkung |
|---|---|
| `.\tasks.ps1 test` | Backend- und Frontend-Tests |
| `.\tasks.ps1 lint` | Ruff und ESLint |
| `.\tasks.ps1 typecheck` | mypy und tsc |
| `.\tasks.ps1 boundaries` | Modulgrenzen prüfen |
| `.\tasks.ps1 migrate` | Alembic upgrade head |
| `.\tasks.ps1 openapi` | OpenAPI exportieren und API-Client neu erzeugen |

---

## Mitwirkungsregeln

1. Vor jeder Änderung `CLAUDE.md` und `docs/current-status.md` lesen.
2. Modulgrenzen einhalten — sie werden von `import-linter` geprüft.
3. Nach einem größeren Auftrag `current-status.md` und `task-history.md`
   aktualisieren. Kleine interne Korrekturen ohne Zustands- oder
   Architekturwirkung brauchen das nicht (siehe `CLAUDE.md`, Abschnitt 2).
4. Architekturentscheidungen als ADR festhalten, nicht stillschweigend ändern.
5. Keine destruktiven Git-Befehle ohne ausdrückliche Freigabe.

---

## Repository-Hygiene

Nicht versioniert werden: `.venv/`, `node_modules/`, `dist/`, `*.egg-info/`,
`__pycache__/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `.uv-cache/`
und `.env`.

**Bewusst versioniert** — damit ein frischer Klon ohne laufendes Backend
typprüfbar und baubar ist:

| Datei | Grund |
|---|---|
| `apps/backend/uv.lock` | reproduzierbare Python-Umgebung |
| `package-lock.json` | reproduzierbare Node-Umgebung |
| `apps/backend/openapi.json` | Quelle des generierten API-Clients |
| `packages/api-client/src/generated.ts` | generiert, aber für Typecheck und Build nötig; `npm run check:api` erzwingt Aktualität |

### Schlankes Prüfarchiv erzeugen

Ein Archiv zur Weitergabe wird **aus dem Git-Index** erzeugt, nie durch Zippen
des Arbeitsverzeichnisses — sonst landen `.git`, `.venv`, `node_modules` und
Build-Caches darin:

```bash
git archive --format=zip --output=../elektroplan-pruefstand.zip HEAD
```

Enthält genau die versionierten Projektdateien (derzeit rund 135). Für einen
bestimmten Stand statt `HEAD` den Commit oder Tag angeben.

---

## Hinweis zur Elektrotechnik

ElektroPlan trifft **keine** sicherheitsrelevanten elektrotechnischen Entscheidungen.
Querschnitte, Schutzorgane und Normkonformität werden weder automatisch ermittelt noch
geprüft. Das System rechnet, dokumentiert und schlägt vor — die verantwortliche
Elektrofachkraft entscheidet und gibt frei.
