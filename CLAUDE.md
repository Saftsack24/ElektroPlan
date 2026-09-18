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

Nach **jedem** abgeschlossenen Entwicklungsauftrag:

1. Tests ausführen
2. Typecheck ausführen
3. Build ausführen
4. relevante Fehler beheben
5. `docs/current-status.md` aktualisieren
6. `docs/task-history.md` ergänzen
7. `docs/changelog.md` aktualisieren, falls relevant
8. `docs/roadmap.md` aktualisieren, falls relevant
9. Modul-Dokumentation aktualisieren, falls sich Verhalten oder Architektur geändert hat
10. ADR erstellen, falls eine wichtige Architekturentscheidung getroffen wurde

Danach Zusammenfassung ausgeben in genau diesem Format:

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

## 11. Wichtige Befehle (ab Phase 1)

```bash
make dev        # Compose starten
make test       # Backend- und Frontend-Tests
make lint       # ruff + eslint
make typecheck  # mypy + tsc
make migrate    # Alembic upgrade head
make check      # alle Qualitätsschranken inkl. import-linter und Drift-Check
```

---

## 12. Aktueller Stand

Siehe `docs/current-status.md`. **Immer zuerst dort nachsehen.**

Phase 0 (Architektur und Dokumentation) ist abgeschlossen. Es existiert noch **kein**
Anwendungscode. Phase 1 ist geplant (`docs/phase-1-plan.md`) und wartet auf Freigabe.
