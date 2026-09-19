# CLAUDE.md — Arbeitsanweisung für KI-Sessions

Dieses Dokument ist verbindlich. Es gilt für jede KI-gestützte Arbeit an ElektroPlan.
Das Repository und seine Dokumentation sind die **Source of Truth** — nicht der
Chatverlauf einer früheren Sitzung.

---

## 1. Session Start Rule

Vor jeder größeren Aufgabe **zuerst lesen**, in dieser Reihenfolge:

1. `CLAUDE.md` (diese Datei)
2. `docs/current-status.md` — wo steht das Projekt?
3. `docs/roadmap.md` — welche Phase, welche Exit-Kriterien?
4. die relevanten Modul-Dokumente unter `docs/modules/`
5. betroffene ADRs unter `docs/decisions/`

**Danach** den bestehenden Code analysieren. **Erst dann** ändern.

Nicht auf Erinnerungen aus früheren Sitzungen verlassen. Wenn Dokumentation und Code
widersprüchlich sind: den Widerspruch melden, nicht stillschweigend eine Seite wählen.

---

## 2. Session End Rule

**Immer** — nach jeder Änderung am Code:

1. Tests ausführen
2. Typecheck ausführen
3. Build ausführen
4. relevante Fehler beheben

**Dokumentation nach Bedarf, nicht nach Ritual.** Maßgeblich ist die Wirkung der
Änderung, nicht ihre Größe:

| Dokument | Wann aktualisieren |
|---|---|
| `docs/current-status.md` | nach einem größeren abgeschlossenen Auftrag oder am Ende einer Session |
| `docs/task-history.md` | für relevante abgeschlossene Entwicklungsaufträge |
| `docs/changelog.md` | nur bei Änderungen, die Nutzer, API, Architektur oder Betrieb betreffen |
| `docs/roadmap.md` | nur bei Änderungen an Status, Reihenfolge oder Umfang |
| Modul-Dokumentation | nur wenn sich Verhalten oder Architektur des Moduls geändert hat |
| ADR | nur bei einer **echten** Architekturentscheidung |

Eine kleine interne Fehlerkorrektur ohne Zustands- oder Architekturwirkung —
etwa ein Tippfehler, eine Lint-Bereinigung oder ein nachgezogener Test — muss
**nicht** mehrere Dokumente verändern. Dokumentation soll verlässlich sein, nicht
zeremoniell.

Nach einem **größeren Auftrag** ist die Abschlusszusammenfassung verpflichtend,
in genau diesem Format:

```
DONE        — was umgesetzt wurde
TESTS       — welche Tests/Builds liefen, mit Ergebnis
FILES       — wichtigste geänderte Dateien
DOCUMENTATION — welche Dokumentation aktualisiert wurde
OPEN        — bekannte Probleme, offene Aufgaben
NEXT        — sinnvollster nächster Schritt
```

> **NEXT wird nicht automatisch begonnen. Auf ausdrückliche Freigabe warten.**

---

## 3. Die unverhandelbaren Architekturregeln

| # | Regel | Referenz |
|---|---|---|
| 1 | Ein Modul kennt von einem anderen nur dessen Contracts — nie Models, Repositories, Tabellen | `docs/modules.md` |
| 2 | Abhängigkeitsrichtung: Fachmodul → Shared → Core. Nie umgekehrt, nie Fachmodul → Fachmodul | ADR 0001 |
| 3 | Shared Modules erhalten Fachmodul-Daten ausschließlich über Provider-Ports | ADR 0003 |
| 4 | Events werden erst **nach** dem Commit zugestellt; jede eventgetriebene Ableitung braucht einen idempotenten Recompute-Endpunkt | ADR 0004 |
| 5 | Alles, was Geld oder Bestand ändert, ist ein synchroner Aufruf — nie ein Event | ADR 0004 |
| 6 | Geld und Mengen sind `Decimal`/`numeric`, über die API **Strings**. Kein `float` | ADR 0005 |
| 7 | Geometrie ist ganzzahlig in Millimetern | ADR 0007 |
| 8 | Jede mandantenbezogene Tabelle hat `organization_id`; Fremdschlüssel sind zusammengesetzt `(organization_id, id)` | ADR 0006 |
| 9 | `offer_versions` und `offer_items` enthalten **keine** Kostenspalten | ADR 0006 |
| 10 | Lagerbestand wird nur gebucht, nie gesetzt | `docs/modules/inventory.md` |
| 11 | Kalkulationen und Angebote lesen nach dem Einfrieren nur aus ihrem Snapshot | ADR 0005, `docs/modules/calculation.md` |
| 12 | Keine automatische elektrotechnische Normprüfung oder Schutzorgan-Dimensionierung | `docs/security.md` §17 |
| 13 | Ein einziger Alembic-Strang | ADR 0002 |
| 14 | Contracts: Python ist Quelle der Wahrheit, der TS-Client wird generiert | ADR 0009 |

**Wenn eine dieser Regeln im Weg steht, ist das ein Anlass für einen ADR — nicht für eine
Ausnahme.**

---

## 4. Sprache

| Artefakt | Sprache |
|---|---|
| Dokumentation, ADRs, Oberfläche, Benutzerfehlermeldungen | **Deutsch** |
| Code, Bezeichner, Tabellen, API-Felder, Logs, Commits | **Englisch** |

Neue Fachbegriffe zuerst in `docs/glossary.md` eintragen. Siehe ADR 0008.

---

## 5. Codequalität

- TypeScript `strict`, Python `mypy --strict` für `app/`.
- Kleine, verständliche Einheiten. Keine God Components, keine God Services.
- Keine Abstraktion ohne zweiten Anwendungsfall. Ein Interface um des Interfaces willen ist
  kein Qualitätsmerkmal.
- Schichten je Modul: `api` → `services` → `repositories` → `models`.
  `api` ruft nie `repositories` oder `models` direkt.
- Fehler nie verschlucken. API-Fehler nach RFC 9457, ohne interne Details.
- Keine Secrets im Repository.
- Jede schreibende Route deklariert ihre Permission explizit.

---

## 6. Keine blinden Rewrites

Funktionierender Code wird nicht ohne Grund ersetzt. Vor einem größeren Refactoring:

1. bestehenden Code analysieren
2. Problem erklären
3. Auswirkungen identifizieren
4. Lösung vorschlagen und Freigabe abwarten
5. umsetzen
6. testen
7. dokumentieren

---

## 7. Git

- Kleine, nachvollziehbare Änderungen.
- Conventional Commits auf Englisch:
  `feat(electrical): add cable route length calculation`
  `fix(auth): enforce organization isolation on refresh`
  `docs(architecture): document module contracts`
  `refactor(calculation): separate pricing rules`
  `test(inventory): cover reservation release`
- **Keine destruktiven Git-Befehle ohne ausdrückliche Freigabe** (`reset --hard`,
  `push --force`, `clean -fd`, Branch löschen).
- Commit erst nach einem stabilen Meilenstein, nicht nach jeder Zwischenänderung.

---

## 8. Umfangsdisziplin

- Nur das umsetzen, was beauftragt wurde.
- Aufgefallene Zusatzpunkte gehören nach `docs/current-status.md` unter "Offene Punkte" —
  nicht in die laufende Änderung.
- Keine vorsorglichen Abstraktionen für hypothetische zukünftige Module.
- Bei Unklarheit mit erheblicher Auswirkung: nachfragen, statt zu raten.
  Bei Unklarheit ohne erhebliche Auswirkung: begründet entscheiden und die Annahme
  dokumentieren.

---

## 9. Tests — Pflichtbereiche

Diese Bereiche werden **immer** getestet:

Mandantentrennung · Permissions · Leitungslängen · Materialberechnung · Verschnitt und
Rundung · Lagerbewegungen und Reservierungen · Arbeitszeiten · Kalkulation · Umsatzsteuer ·
Angebotssummen · Preis- und Mengen-Snapshots · Trennung interner Daten vom Kundendokument ·
Modul-Contracts · Event-Transaktionsverhalten.

Tests laufen gegen **PostgreSQL**, nicht gegen SQLite.

---

## 10. Projektstruktur (Zielbild)

```
apps/planner      React/Vite
apps/backend      FastAPI (app/core, app/modules, app/contracts, migrations)
apps/android      Capacitor            (ab Phase 13)
packages/api-client   generiert aus OpenAPI
infrastructure/   Docker Compose
docs/             Dokumentation (siehe docs/README-Übersicht in README.md)
```

`packages/ui` und `packages/3d-engine` werden erst angelegt, wenn ein zweiter Consumer
existiert.

---

## 11. Wichtige Befehle

Unter Windows ist `tasks.ps1` der Hauptweg (`make` ist dort meist nicht installiert);
das `Makefile` bietet dieselben Ziele.

```powershell
.\tasks.ps1 install     # uv sync --frozen + npm ci
.\tasks.ps1 check       # alle Qualitätsschranken auf einmal
.\tasks.ps1 test        # Backend- und Frontend-Tests
.\tasks.ps1 lint        # ruff + eslint
.\tasks.ps1 typecheck   # mypy + tsc
.\tasks.ps1 boundaries  # import-linter
.\tasks.ps1 migrate     # alembic upgrade head
.\tasks.ps1 seed        # Startbestand anlegen
.\tasks.ps1 openapi     # OpenAPI exportieren + API-Client erzeugen
```

`check` umfasst: Ruff (Lint und Format), mypy `--strict`, Modulgrenzen, genau ein
Alembic-Head, Backend-Tests, OpenAPI-Drift-Check, Frontend-Typecheck, ESLint,
Frontend-Tests und Build.

Datenbanktests brauchen PostgreSQL:

```powershell
$env:ELEKTROPLAN_TEST_DATABASE_URL = 'postgresql+psycopg://elektroplan:elektroplan@localhost:5432/elektroplan'
```

---

## 12. Aktueller Stand

Siehe `docs/current-status.md`. **Immer zuerst dort nachsehen.**

Phase 0 (Architektur) ist abgeschlossen. Phase 1 (Platform Foundation) ist
implementiert; drei Exit-Kriterien warten auf die Abnahme mit laufender Datenbank.

Für die Arbeit am Code wichtig:

- Das Backend ist **synchron** (ADR 0011): Endpunkte sind `def`, nicht `async def`.
- Neues Backend-Modul: `ModuleDescriptor` anlegen und in
  `apps/backend/app/modules/__init__.py` eintragen.
- Neues Frontend-Modul: eine Zeile in `apps/planner/src/modules/index.ts`.
- Nach Schemaänderungen eine Migration erzeugen — es darf nur **einen** Alembic-Head geben.
- Nach API-Änderungen den API-Client neu erzeugen, sonst schlägt der Drift-Check fehl.
- Abhängigkeiten **nur** über `uv`: `pyproject.toml` ändern, dann `uv lock`.
  `uv.lock` wird eingecheckt; installiert wird ausschließlich mit `--frozen`.
  Kein paralleler `pip install`-Pfad.
