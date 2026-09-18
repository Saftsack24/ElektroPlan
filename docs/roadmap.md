# Roadmap

Stand: 2026-09-18
Status-Werte: `NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `DONE`

---

## Überblick

| Phase | Inhalt | Status | Abhängig von |
|---|---|---|---|
| 0 | Architektur, Contracts, Datenmodell, Dokumentation | **DONE** | — |
| 1 | Platform Foundation | **NOT STARTED** | 0 |
| 2 | Core Business Data | NOT STARTED | 1 |
| 3 | Electrical Room Model | NOT STARTED | 2 |
| 4a | 2D-Editor | NOT STARTED | 3 |
| 4b | 3D-Ansicht | NOT STARTED | 4a |
| 5 | Electrical Devices | NOT STARTED | 4a |
| 6 | Circuits & Cable Routes | NOT STARTED | 5 |
| 7 | Materials | NOT STARTED | 6 |
| 8 | Service Templates & Material Engine | NOT STARTED | 7 |
| 9 | Calculation | NOT STARTED | 8 |
| 10 | Offers | NOT STARTED | 9 |
| **PILOT** | **Erprobung mit echtem Auftrag — verbindlicher Stopp** | NOT STARTED | 10 |
| 11 | Work Orders | NOT STARTED | Pilot |
| 12 | Inventory | NOT STARTED | 11 |
| 13 | Android-App | NOT STARTED | 12 |
| 14 | Field Execution | NOT STARTED | 13 |
| 15 | Actual vs Planned | NOT STARTED | 14 |
| 16 | Offline Sync | NOT STARTED | 14 |
| 17 | AR Room Measurement | NOT STARTED | 13 |
| 18 | PV Foundation | NOT STARTED | Pilot, gesonderte Planung |
| 19 | PV Electrical | NOT STARTED | 18 |
| 20 | Weitere Fachmodule | NOT STARTED | nach Bedarf |

**Abweichung vom Masterplan:** Phase 4 ist in 4a (2D-Editor) und 4b (3D-Ansicht) geteilt.
Begründung: [ADR 0010](decisions/0010-2d-first-editor-with-installation-zones.md).

---

## Phase 0 — Architektur · DONE (2026-09-18)

Analyse des Masterplans, kritische Prüfung, ER-Modell, Modulgrenzen, Contracts,
Event-Regeln, Modulregistrierung (Backend und Frontend), Sicherheitskonzept,
Dokumentationsstruktur, 10 ADRs, Phase-1-Plan.

**Ergebnis:** `docs/architecture-review.md` mit 16 Befunden, 10 Risiken und 11 bewussten
Abweichungen vom Masterplan.

---

## Phase 1 — Platform Foundation · NOT STARTED

Monorepo, Docker Compose, FastAPI-Grundgerüst, PostgreSQL, Alembic, Organisationen,
Benutzer, Mitgliedschaften, Authentifizierung, Permissions, Module Registry, Event Bus,
Audit, React-Shell mit Login und Modulregistrierung.

Detailplan: [`docs/phase-1-plan.md`](phase-1-plan.md)

**Exit-Kriterien**
1. `docker compose up` startet Datenbank, MinIO, Backend und Planner.
2. Anmeldung funktioniert; `/api/v1/me` liefert Benutzer, Organisation und Permissions.
3. Mandantentrennungstest läuft automatisch über alle Routen und ist grün.
4. Module Registry verweigert den Start bei ungültigen Abhängigkeiten.
5. Event Bus stellt nachweislich erst nach dem Commit zu.
6. `alembic heads` liefert genau einen Head.
7. `import-linter`, Ruff, mypy, ESLint, `tsc --noEmit` laufen grün.

---

## Phase 2 — Core Business Data · NOT STARTED

Kunden, Projekte, Gebäude, Geschosse, Dateiupload gegen MinIO, Nummernkreise,
Projektübersicht im Frontend mit Modul-Tabs.

**Exit:** Ein Projekt kann mit Kunde, Gebäude und Geschossen angelegt werden; ein Plan-PDF
lässt sich hochladen und herunterladen; Projektliste ist filterbar und paginiert.

---

## Phase 3 — Electrical Room Model · NOT STARTED

Datenmodell und API für Räume, Wände, Öffnungen inklusive Geometrievalidierung.
Noch ohne Editor — Erfassung über API und einfache Formulare.

**Exit:** Ein Raum mit Polygon, Höhe, Wänden und Türen ist über die API erfassbar; die
Flächenberechnung ist getestet; ungültige Polygone werden abgelehnt.

---

## Phase 4a — 2D-Editor · NOT STARTED

Canvas-Editor: Räume zeichnen (Rechteck und Polygon), Wände, Öffnungen, Raster,
Fangfunktion, Maßanzeige, Undo/Redo, Speichern.

**Exit:** Ein realistischer Grundriss (Einfamilienhaus, 6–8 Räume) ist in unter 20 Minuten
erfassbar. Dieser Wert wird gemessen, nicht geschätzt.

---

## Phase 4b — 3D-Ansicht · NOT STARTED

Three.js: extrudierte Räume, Wände, Öffnungen, Orbit/Zoom/Pan, Auswahl.
**Keine Geometriebearbeitung in 3D.**

**Exit:** Der Grundriss aus 4a ist in 3D navigierbar; Szene und React-State sind entkoppelt.

---

## Phase 5 — Electrical Devices · NOT STARTED

Gerätetypen-Katalog mit Seed, Platzieren, Bearbeiten, Löschen, Raum- und Wandzuordnung,
Montagehöhen, Symbole in 2D und 3D.

**Exit:** Ein vollständiges Einfamilienhaus lässt sich mit Steckdosen, Schaltern, Leuchten
und Netzwerkdosen ausstatten.

---

## Phase 6 — Circuits & Cable Routes · NOT STARTED

Verteilungen, Stromkreise, Zuordnung von Geräten, Leitungswege mit Installationszonen,
Längenberechnung, Mengenübersicht.

**Exit:** Leitungslängen werden deterministisch berechnet; das Beispiel aus
`docs/modules/electrical.md` Abschnitt 5 ist als Test hinterlegt und grün.

---

## Phase 7 — Materials · NOT STARTED

Materialstamm, Kategorien, Preise mit Historie, Einheiten, Verpackungseinheiten,
Verschnittregeln, `MaterialRequirement`-Contract, Provider-Registrierung.

**Exit:** Materialbedarf entsteht aus der Elektroplanung über den Port — ohne dass
`materials` das Modul `electrical` importiert.

---

## Phase 8 — Service Templates & Material Engine · NOT STARTED

ServiceTemplates mit Stücklisten und Zeiten, globale Regeln, vollständige Material Engine
mit Lauf-Historie, Plausibilitätsprüfungen und Recompute-Endpunkt.

**Exit:** 20–30 reale ServiceTemplates sind erfasst; ein Testprojekt liefert eine
Materialliste, die ein Meister des Betriebs als plausibel bestätigt.

---

## Phase 9 — Calculation · NOT STARTED

Stundensätze, Kalkulationspositionen, Zuschläge, Preis- und Mengen-Snapshots,
Stale-Erkennung, interne Kalkulationsansicht.

**Exit:** Eine finalisierte Kalkulation bleibt nach einer Preisänderung unverändert
(getestet); alle Rundungstests sind grün.

---

## Phase 10 — Offers · NOT STARTED

Angebotsentwurf aus Kalkulation, Positionsarten, Gliederung, Versionierung, Freigabe,
PDF-Erzeugung.

**Exit:** Ein Angebots-PDF ist versandfähig; die Trennungstests (keine Kostenfelder, kein
Kalkulationsimport) sind grün.

---

## PILOT MILESTONE — verbindlicher Stopp

Nach Phase 10 wird **nicht** automatisch weiterentwickelt. Das System wird mit mindestens
einem realistischen Beispielprojekt oder einem echten internen Auftrag erprobt.

Zu prüfen und zu dokumentieren:

1. Ist die Planung praktikabel? Wie lange dauert ein reales Projekt?
2. Stimmen die Materialmengen gegenüber der bisherigen Arbeitsweise?
3. Stimmen die Arbeitszeiten?
4. Ist die Kalkulation nachvollziehbar?
5. Ist das Angebot brauchbar und versandfähig?
6. Wo entstehen unnötige Arbeitsschritte?

Ergebnis in `docs/pilot-report.md`. Die Roadmap wird danach angepasst — es ist ausdrücklich
zulässig, dass sich die Reihenfolge der Phasen 11–20 ändert.

---

## Phasen 11–20 — Kurzfassung

| Phase | Inhalt | Exit-Kriterium |
|---|---|---|
| 11 Work Orders | Angebot → Auftrag, Soll-Material, Status | Auftrag mit eingefrorenem Soll erzeugbar |
| 12 Inventory | Lagerorte, Bestände, Bewegungen, Reservierungen | Bestandsjournal stimmt mit Aggregat überein; Reservierung über Contract |
| 13 Android-App | Login, Aufträge, Projektdaten, 2D-Plan, Materialliste | Auftrag auf einem realen Gerät nutzbar |
| 14 Field Execution | Verbrauch, Fotos, Bemerkungen, Zeiten | Verbrauch idempotent buchbar |
| 15 Actual vs Planned | Soll/Ist, Nachkalkulation, Auswertung | Abweichungsbericht je Auftrag |
| 16 Offline Sync | lokale Daten, Sync Queue, Konflikterkennung | Auftrag ohne Netz bearbeitbar, danach synchron |
| 17 AR Measurement | ARCore, Eckpunkte, Raumhöhe, Öffnungen | Aufmaß mit dokumentierter Genauigkeit |
| 18 PV Foundation | Dachmodell, Hindernisse, Modulbelegung | PV erzeugt Bedarf über denselben Port |
| 19 PV Electrical | Strings, Wechselrichter, DC/AC | PV durchläuft Material → Kalkulation → Angebot |
| 20 Weitere Module | Wallbox, KNX, Netzwerk, Prüfungen | nach Bedarf |

---

## Meilensteine

| Meilenstein | Bedeutung |
|---|---|
| **M1 — Anmeldung und Mandantentrennung** (Ende Phase 1) | Tragfähiges Fundament |
| **M2 — Projekt mit Grundriss** (Ende Phase 4a) | Erster sichtbarer Nutzen |
| **M3 — Berechnete Leitungslängen** (Ende Phase 6) | Kern der Fachlichkeit steht |
| **M4 — Materialliste aus der Planung** (Ende Phase 8) | Plattform-Mechanik nachgewiesen |
| **M5 — Angebot aus dem System** (Ende Phase 10) | **MVP erreicht** |
| **M6 — Pilot ausgewertet** | Entscheidung über den weiteren Weg |
| **M7 — PV am selben Contract** (Ende Phase 19) | Plattformidee bewiesen |

---

## Regeln für diese Roadmap

1. Eine Phase gilt erst als `DONE`, wenn ihre Exit-Kriterien erfüllt und dokumentiert sind.
2. Phasen werden nicht parallel begonnen, solange das Team klein ist.
3. Nach jeder Phase: `current-status.md`, `task-history.md`, `changelog.md` und diese Datei
   aktualisieren.
4. Der Pilot-Meilenstein wird nicht übersprungen.
5. Umfangserweiterungen innerhalb einer laufenden Phase werden abgelehnt und als neue
   Aufgabe notiert.
