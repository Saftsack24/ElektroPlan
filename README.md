# ElektroPlan

Modulare Softwareplattform für Elektrofachbetriebe — von der Kundenanfrage über die
technische Planung, den Materialbedarf und die Kalkulation bis zum Angebot, Auftrag und
zur Nachkalkulation.

**Status: Phase 2 (Core Business Data) abgeschlossen und abgenommen.**
Details in [`docs/current-status.md`](docs/current-status.md).

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
| Gestaltung | Tailwind CSS 4 (Vite-Plugin, ohne Preflight) über semantische Laufzeit-Tokens `--ep-*`; Hell/Dunkel/System und Akzentschemata über Wurzelattribute ([ADR 0018](docs/decisions/0018-frontend-styling-tailwind-and-theme-tokens.md), [ADR 0019](docs/decisions/0019-personal-display-preferences-local-storage.md)) |
| 3D | Three.js (reine Ansicht seit Phase 4b; Browser mit WebGL 2 nötig, sonst Hinweis und 2D/Tabelle) |
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

**Phase 1 — Platform Foundation — abgeschlossen und abgenommen.**
Backend mit Core-Datenmodell, Authentifizierung, Autorisierung, Mandantentrennung,
Module Registry, Event Bus, Audit und Object Storage; React-Shell mit
Modulregistrierung und generiertem API-Client.

**Phase 2 — Core Business Data — abgeschlossen und abgenommen.**
Kunden, Projekte, Gebäude und Geschosse mit Nummernkreisen und optimistischem Sperren;
Projektdateien gegen MinIO; (bis Phase 4d) Anonymisierungspfad; Oberfläche mit
Kunden- und Projektverwaltung und einer Projektansicht, in die sich Fachmodule ab
Phase 3 mit eigenen Tabs einhängen.

**Phase 3 bis 4a.1** — Raummodell der Elektroplanung und grafischer 2D-Editor, siehe
[`docs/current-status.md`](docs/current-status.md).

**Phase 4.2 — Benutzerverwaltung und Startseite — abgeschlossen.**
Administration mit Benutzerliste, Einladungen (Token nur als Hash, einmalig, befristet),
Sperren des Zugangs je Betrieb, Vergabe fester Systemrollen mit nachvollziehbaren
effektiven Rechten und Schutz des letzten Administrators; arbeitsorientierte Startseite.
Entscheidung: [ADR 0015](docs/decisions/0015-membership-administration-and-invitations.md).

**Phase 4b — 3D-Ansicht — abgeschlossen.**
Abgeleitete, schreibgeschützte 3D-Ansicht des Grundrisses neben 2D-Editor und Tabellen;
gemeinsame Wände werden – exakt, auch bei Teilüberlappung – abschnittsweise
zusammengeführt (seit 4b.2), Datenkonflikte als Hinweis. Entscheidung: [ADR 0016](docs/decisions/0016-derived-3d-view-wall-height-and-coincident-walls.md).
Voraussetzung im Browser: WebGL 2; ohne WebGL bleiben 2D-Editor und Tabellen nutzbar.

**Bedienungsnacharbeit 1 — umgesetzt.**
Kunden- und Projektlisten mit nummerierten Seiten ([ADR 0017](docs/decisions/0017-numbered-pages-for-customer-and-project-lists.md)),
eigener Kundenfilter in der Projektübersicht, laufende und abgeschlossene Projekte auf der
Kundenseite, Adressvorschlag aus dem Kunden, eigener Bestätigungsdialog statt
Browserdialog (außer beim Neuladen/Schließen) und eine persönliche **Maßeinheit**:
Längen erscheinen standardmäßig in Zentimetern, umstellbar auf Millimeter unter
„Einstellungen" (je Benutzer, in diesem Browser). Gespeichert und übertragen wird weiter
in ganzen Millimetern.

**Bedienungsnacharbeit 2 (Phase 4b.2) — umgesetzt.**
Türen, Fenster und Durchgänge werden im 2D-Editor direkt mit der Maus auf eine Wand
gesetzt und entlang der Wand verschoben (Vorschau mit verbundenen Räumen, 5-cm-Fang,
Escape bricht ab); genaue Werte weiter in der Seitenleiste. Eine Öffnung auf einer
gemeinsamen Wand wird nur **einmal** gespeichert und gilt – abgeleitet – für beide Räume.

**Phase 4c.1 — Tailwind-Migration und Theme-Grundlage — abgeschlossen** (mit diesem Checkpoint committet).
Die Oberfläche ist vollständig auf Tailwind CSS 4 umgestellt; das Erscheinungsbild ist
bewusst unverändert. Farben kommen ausschließlich aus semantischen Tokens, die zur
Laufzeit überschreibbar sind – die Grundlage für persönliche Farbeinstellungen in Phase
4c.2. Neue Oberfläche: Utilities und die Rezepte aus `apps/planner/src/core/ui/stil.ts`;
Regeln in [ADR 0018](docs/decisions/0018-frontend-styling-tailwind-and-theme-tokens.md)
und `docs/architecture.md`, Abschnitt 13. Nach dem Aktualisieren das Planner-Image neu
bauen (`docker compose build planner`), weil `package.json` und `vite.config.ts` darin
enthalten sind.

**Phase 4c.2 — Persönliche Darstellung — abgeschlossen** (mit diesem Checkpoint committet).
Unter „Einstellungen" wählt jeder Benutzer **Darstellung** (Wie das System, Hell, Dunkel),
**Akzentfarbe** (ElektroPlan Blau, Türkis, Grün, Violett, Orange) und **Maßeinheit**
(cm/mm). Jede Wahl wirkt sofort als Vorschau – auch im 2D-Editor und in einer geöffneten
3D-Ansicht – und wird erst mit „Übernehmen" gespeichert; Abbrechen stellt den vorherigen
Stand her. Gespeichert wird **nur in diesem Browser, je Benutzer**
(`elektroplan.darstellung.<user_id>`); auf einem anderen Gerät gilt der Standard.
Warnfarbe und Umrisse von Eingabefeldern und Knöpfen erfüllen jetzt WCAG AA bzw. 3 : 1.

**Phase 4d — Datenlebenszyklus — abgeschlossen** (mit diesem Checkpoint committet).
Versehentlich angelegte, **leere** Projekte löschen Projektbearbeiter; Projekte mit Inhalt
löscht nur ein Administrator nach Eingabe der Projektnummer. Abgeschlossene und
archivierte Projekte verschwinden aus der Hauptliste (Umschaltung
„Abgeschlossene & archivierte anzeigen"); ein Administrator kann ein abgeschlossenes
Projekt wieder in Bearbeitung setzen, archivierte bleiben endgültig. Kunden ohne Projekte
löscht ein Administrator physisch – die frühere Anonymisierung ist entfallen, ebenso
das Ausblenden (Soft Delete): Die Migration entfernt die Markierung, löscht keine Zeile,
und früher ausgeblendete Kunden und Projekte sind wieder sichtbar. Kunden und
Projekte zeigen, wer sie angelegt und zuletzt geändert hat. Aktionen tragen einheitliche
Icons (`lucide-react`). Regeln und Protokoll:
[ADR 0020](docs/decisions/0020-data-lifecycle-deletion-and-reopen.md).

> **Nach dem Aktualisieren auf 4d:** `.\tasks.ps1 migrate` (Migration `0006`), danach
> `.\tasks.ps1 seed` – erst der Seed legt `project.record.purge` und
> `project.record.reopen` an und gibt dem Planer `project.record.delete`. Das
> Planner-Image neu bauen (`docker compose build planner`, neue Abhängigkeit
> `lucide-react`). Offene Storage-Aufräumaufträge arbeitet
> `python -m app.cli storage-cleanup` ab.

**Phase 4f — Wand- und Deckenansicht — abgeschlossen**
(vom Auftraggeber manuell abgenommen, mit diesem Checkpoint committet)

Wand frontal aus dem Raum bearbeiten (Türen, Fenster, Durchgänge mit Hilfslinien und
Einrasten), Deckenansicht je Raum; abgeschlossene Projekte sind schreibgeschützt; eine neue
Geschoss-Standardhöhe wird gegen vorhandene Öffnungen geprüft. Keine Migration.
Entscheidung: [ADR 0022](docs/decisions/0022-wall-and-ceiling-view.md).

**Phase 4e — Benutzerlebenszyklus und serverseitige Einstellungen — abgeschlossen**
(vom Auftraggeber geprüft, mit diesem Checkpoint committet). Darstellung, Akzentfarbe und
Maßeinheit liegen jetzt **auf dem Server** je Benutzer und Betrieb (der Browser hält nur einen
Cache) und folgen auf jedes Gerät; neue Maßeinheit **Meter** (`m`, drei Nachkommastellen,
intern weiter ganze Millimeter). Administratoren ändern Name und E-Mail, **sperren und
entsperren** mit sofortiger Wirkung auf jede Sitzung, lösen einen **Einmal-Link zum
Zurücksetzen des Passworts** aus (das Passwort setzt die Person selbst) und **entfernen**
Benutzer endgültig (Tombstone, frühere Einträge zeigen „Entfernter Benutzer“). Kontoänderungen
nur bei Konten, die keinem anderen Betrieb angehören. Entscheidung:
[ADR 0021](docs/decisions/0021-user-lifecycle-account-locks-password-reset-preferences.md).

> **Nach dem Aktualisieren auf 4e:** `.\tasks.ps1 migrate` (Migration `0007`), danach
> **zwingend** `.\tasks.ps1 seed` – erst der Seed legt `user.account.lock`,
> `user.profile.write`, `user.password.reset`, `user.account.remove` und
> `user.preferences.write` an; ohne ihn kann niemand sperren oder Einstellungen speichern.
> Der Reset-Link erscheint nur mit `ELEKTROPLAN_PASSWORD_RESET_DELIVERY=admin_link` (in
> `docker-compose.yml` gesetzt, in Produktion verboten). Bereits angemeldete Browser
> erneuern ihre Sitzung einmal automatisch.

> **Einladungen in der Entwicklung:** Es gibt noch keinen E-Mail-Versand. Mit
> `ELEKTROPLAN_INVITATION_DELIVERY=development_link` (in `docker-compose.yml` gesetzt)
> erscheint der Einladungslink einmalig in der Oberfläche, deutlich als
> Entwicklungsfunktion markiert. In Produktion ist diese Einstellung verboten; ohne
> Zustellweg werden Einladungen abgelehnt.

Geprüft gegen echtes PostgreSQL 17 und MinIO: Ruff, mypy `--strict`, `import-linter`,
Modul- und Datenbankgrenzen, ein Alembic-Head, der vollständige Backend-Testlauf ohne
übersprungene Tests, Frontend-Typecheck, ESLint, Frontend-Tests und Build.

> Es werden ausschließlich **synthetische Testdaten** verwendet. Vor dem ersten echten
> Kundendatensatz sind die offenen DSGVO-Punkte aus
> [`docs/security.md`](docs/security.md), Abschnitt 13 zu erfüllen.

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
| `docker exec elektroplan-backend python -m app.cli seed` | nach Migration `0007` Pflicht: neue Rechte der Benutzerverwaltung (Phase 4e) |
| `docker exec elektroplan-backend python -m app.cli purge-invitations` | abgeschlossene und abgelaufene Einladungen nach der Aufbewahrungsfrist (30 Tage) löschen |
| `docker exec elektroplan-backend python -m app.cli storage-cleanup` | offene Storage-Aufräumaufträge gelöschter Projekte erneut abarbeiten (idempotent; Exitcode 1, solange Aufträge offen sind) |

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
