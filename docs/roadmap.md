# Roadmap

Stand: 2026-09-26 (nach Task 0012 — Phase 3)
Status-Werte: `NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `DONE`

---

## Überblick

| Phase | Inhalt | Status | Abhängig von |
|---|---|---|---|
| 0 | Architektur, Contracts, Datenmodell, Dokumentation | **DONE** | — |
| 1 | Platform Foundation | **DONE** | 0 |
| 1.2 | Härtung der Architekturgrenzen und der Sitzungslogik | **DONE** | 1 |
| 2 | Core Business Data | **DONE** | 1.2 |
| 2.1 | Nebenläufigkeit und Zustandskonsistenz | **DONE** | 2 |
| 2.2 | Schreibschutz für archivierte Projekte | **DONE** | 2.1 |
| 2.3 | Workflow- und UX-Nacharbeit | **DONE** | 2.2 |
| 2.4 | Nachkorrektur zu 2.2 und 2.3 | **DONE** | 2.3 |
| 3 | Electrical Room Model | **DONE** | 2 |
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

## Phase 1 — Platform Foundation · DONE (2026-09-18)

Monorepo, Docker Compose, FastAPI-Grundgerüst, PostgreSQL, Alembic, Organisationen,
Benutzer, Mitgliedschaften, Authentifizierung, Permissions, Module Registry, Event Bus,
Audit, React-Shell mit Login und Modulregistrierung.

Detailplan: [`docs/phase-1-plan.md`](phase-1-plan.md) · Ergebnis:
[`docs/task-history.md`](task-history.md), Task 0002

Alle 18 Aufgaben (T-0001 bis T-0018) sind umgesetzt. Die Abnahme wurde in Task 0003
mit echtem Docker, PostgreSQL 17 und MinIO **ausgeführt**.

**Exit-Kriterien — alle erfüllt und nachgewiesen**

| # | Kriterium | Nachweis |
|---|---|---|
| 1 | `docker compose up` startet Datenbank, MinIO, Backend und Planner | frischer Start mit neuen Volumes; alle Dienste `healthy`, `minio-init` mit Exit 0 |
| 2 | Anmeldung funktioniert; `/api/v1/me` liefert Benutzer, Organisation und Permissions | im laufenden System geprüft (API und Browser) |
| 3 | Mandantentrennungstest läuft automatisch über alle Routen und ist grün | 9 Tests; der Sweep meldet unabgedeckte Routen als Fehler |
| 4 | Module Registry verweigert den Start bei ungültigen Abhängigkeiten | 19 Tests |
| 5 | Event Bus stellt nachweislich erst nach dem Commit zu | 16 Tests |
| 6 | `alembic heads` liefert genau einen Head | geprüft; zusätzlich Migration auf leerer Datenbank inkl. `downgrade`/`upgrade` |
| 7 | `import-linter`, Ruff, mypy, ESLint, `tsc --noEmit` laufen grün | Gesamtdurchlauf `tasks.ps1 check` |

**Testbilanz:** 145 Backend-Tests, **0 übersprungen**; 8 Frontend-Tests; 48 funktionale
Prüfungen gegen das laufende System.

Zwei Punkte des Smoke-Tests ließen sich nicht über die Oberfläche prüfen, weil Phase 1
die **Dateiupload-Oberfläche ausdrücklich ausschließt** (nur Infrastruktur und API):
Upload und Download wurden stattdessen über die API und die signierte URL nachgewiesen.

---

## Phase 2 — Core Business Data · DONE (2026-09-19)

Kunden, Projekte, Gebäude, Geschosse, Dateiupload gegen MinIO, Nummernkreise,
Projektübersicht im Frontend mit Modul-Tabs.

Ergebnis: [`docs/task-history.md`](task-history.md), Task 0007.

**Exit-Kriterien — alle erfüllt und nachgewiesen**

| # | Kriterium | Nachweis |
|---|---|---|
| 1 | Ein Projekt kann mit Kunde, Gebäude und Geschossen angelegt werden | `tests/test_projects.py::test_projekt_mit_gebaeude_und_geschossen`; zusätzlich im laufenden System über die Oberfläche |
| 2 | Ein Plan-PDF lässt sich hochladen und herunterladen | `tests/test_project_files.py::test_plan_pdf_hochladen_und_herunterladen` — Inhalt byteweise verglichen, gegen echtes MinIO |
| 3 | Projektliste ist filterbar und paginiert | Filter nach Status, Kunde und Freitext; Keyset-Cursor mit Test, der jeden Datensatz genau einmal liefert |

**Zusätzlich umgesetzt, weil die Dokumentation es für Phase 2 verlangt:**

- **Nummernkreise in Benutzung** (`KD-#####`, `PR-JJJJ-####`) mit Zeilensperre und einem
  Nachweis über zwei echte Threads.
- **Anonymisierungspfad für Kunden** (`docs/security.md`, Abschnitt 13): Phase 2 führt die
  ersten personenbezogenen Daten ein, und die Sicherheitsdokumentation sagt zu, dass der
  Löschpfad mit dieser Phase existiert.
- **Optimistisches Sperren** über `If-Match` auf allen versionierten Entitäten
  (`architecture.md`, Abschnitt 16 und `api.md`, Abschnitt 5).

**Testbilanz nach Phase 2.4:** 341 Backend-Tests, 0 übersprungen; 129 Frontend-Tests.

---

## Phase 2.1 — Nebenläufigkeit und Zustandskonsistenz · DONE (2026-09-19)

Nachgezogene Härtung von Phase 2. Vier Lücken, die erst unter echter Parallelität
sichtbar werden, sind geschlossen und mit Threads, getrennten Sessions und expliziten
Barrieren gegen PostgreSQL nachgewiesen:

1. Ein echter paralleler Versionskonflikt (`StaleDataError`) ist ein `409`, kein `500`.
2. Kundenausblendung und Projektanlage sperren dieselbe Kundenzeile — ein sichtbares
   Projekt an einem ausgeblendeten Kunden kann nicht mehr entstehen.
3. Anonymisierte Kunden sind für neue Projektzuordnungen gesperrt, für bestehende
   lesbar.
4. Eine doppelte Geschossebene unter Parallelität endet in `422`, nicht in `500`.

Dazu: strikte `If-Match`-Syntax. Die damalige Feststellung, `archived` sei *nur* ein
endgültiger Workflowstatus, ist durch **Phase 2.2** überholt — seither ist es zusätzlich
ein vollständiger Schreibschutz.

Ergebnis: [`docs/task-history.md`](task-history.md), Task 0008. **Keine Migration** —
das Schema blieb unverändert.

---

## Phase 2.2 — Schreibschutz für archivierte Projekte · DONE (2026-09-19)

Umsetzung der aus Phase 2.1 offenen fachlichen Entscheidung **T0**: `archived` ist
Endzustand **und** vollständiger Schreibschutz. Lesen und das Herunterladen bestehender
Dateien bleiben erlaubt; jede Änderung an Projekt, Gebäuden, Geschossen und Dateien
sowie neue Uploads liefern `409 project-archived`.

Eine bewusste Ausnahme: Das Ausblenden des Projekts bleibt möglich — sonst ließe sich
ein Kunde mit archiviertem Projekt nie mehr ausblenden. Eine Wiederherstellung aus
`archived` gibt es nicht und wäre ein eigener administrativer Vorgang.

Ergebnis: [`docs/task-history.md`](task-history.md), Task 0009. **Keine Migration.**

---

## Phase 2.3 — Workflow- und UX-Nacharbeit · DONE (2026-09-19)

Bedienung statt Fachlichkeit: Kunden und Projekte werden über einen Knopf **oberhalb**
der Liste in einem Dialog angelegt, die Projektanlage bietet auf Wunsch gleich
`Hauptgebäude` und `Erdgeschoss` an (abwählbar), beide Listen haben „Weitere laden" auf
Basis des vorhandenen Cursors, und die gemeinsamen UI-Bausteine liegen nicht mehr in
Seitendateien.

Datenmodell, API-Verträge, Berechtigungen und die Nebenläufigkeitsgarantien aus
Phase 2.1 bleiben unverändert. **Keine Migration.**

Ergebnis: [`docs/task-history.md`](task-history.md), Task 0010.

---

## Phase 2.4 — Nachkorrektur zu 2.2 und 2.3 · DONE (2026-09-19)

Die Dokumentation zu `archived` ist widerspruchsfrei, die Startstruktur meldet ihre
beiden Fehlerstufen unterscheidbar, und die Kundenauswahl der Projektanlage hat keine
stille Obergrenze von 200 Datensätzen mehr — sie sucht serverseitig.

Kein Backend, keine Migration. Ergebnis:
[`docs/task-history.md`](task-history.md), Task 0011.

> **Weiterhin offen und Voraussetzung vor Echtdaten:** Auskunft/Export (Art. 15),
> Verarbeitungsverzeichnis, TOM-Dokumentation, AV-Verträge, Restore-Regel.
> Bis dahin gilt: **ausschließlich synthetische Testdaten.**

---

## Phase 3 — Electrical Room Model · DONE (2026-09-26)

Erstes echtes Fachmodul: `electrical` mit Räumen, Wänden und Öffnungen auf einem
bestehenden Geschoss, samt serverseitiger Geometrieprüfung. Ohne Editor — Erfassung über
API und formularbasierte Oberfläche.

Ergebnis: [`docs/task-history.md`](task-history.md), Task 0012.
Geometriemodell verbindlich in
[ADR 0013](decisions/0013-room-contour-as-ordered-wall-segments.md).

> **Modulabhängigkeit:** `electrical` ist mit `depends_on = ("core",)` registriert.
> `materials` existiert nicht; die Abhängigkeit und die Provider-Ports kommen erst in
> Phase 7 hinzu. Es wurde **kein** leeres Materials-Modul als Platzhalter angelegt.

**Exit-Kriterien — erfüllt und nachgewiesen**

| # | Kriterium | Nachweis |
|---|---|---|
| 1 | Ein Raum mit Höhe, Wänden und Türen ist über die API erfassbar | `tests/test_electrical_rooms.py` — Raum, vier Wände, Tür über die Endpunkte; zusätzlich im laufenden System über die Oberfläche |
| 2 | Die Flächenberechnung ist getestet | Rechteck, Dreieck mit schräger Wand, L-Form, Umlaufsinn, Halb-mm²-Rundung — exakte Werte, keine Toleranzen (`tests/test_electrical_geometry.py`) |
| 3 | Ungültige Geometrien werden abgelehnt | entartete Wand, Dublette, Überschneidung, Einschnürung, offene Kontur, Lücke, Öffnung außerhalb, überlappende Öffnungen — je mit eigenem Fehlercode |

**Abweichung vom Exit-Wortlaut, ausdrücklich:** Das Kriterium nannte ein „Polygon" und
„ungültige Polygone". Umgesetzt ist die Kontur als **geordnete Wandsegmente** ohne
Polygonspalte; „ungültiges Polygon" heißt jetzt „ungültige Raumkontur". Begründung und
Abgrenzung stehen in ADR 0013. Der fachliche Gehalt des Kriteriums ist damit erfüllt, die
Datenhaltung eine andere.

**Zusätzlich umgesetzt, weil die Umsetzung es verlangte:**

- **Veröffentlichte Core-Oberfläche** (`CORE_PUBLIC_SURFACE`): Ein Fachmodul darf aus dem
  Core nur eine benannte Positivliste importieren — statisch geprüft.
- **Erweiterungspunkt `app/core/projects/planning.py`**: die einzige Stelle, an der ein
  Fachmodul Geschoss, Projekt und Schreibschutz erfährt.
- **`409` statt `500`**, wenn ein Geschoss oder Gebäude mit Planungsdaten gelöscht werden
  soll (Fremdschlüssel `RESTRICT`, zentral übersetzt).
- **Modulberechtigungen im Seed**: Der Administrator erhält jede registrierte
  Berechtigung; weitere Systemrollen über `PermissionDef.default_roles`.

**Testbilanz nach Phase 3:** 552 Backend-Tests, 0 übersprungen (Phase 2.4: 341); 163
Frontend-Tests (Phase 2.4: 129).

**Ausdrücklich nicht in Phase 3:** kein 2D-Editor, kein Canvas, keine 3D-Ansicht, kein
AR-Aufmaß, keine Elektrobauteile, keine Stromkreise, keine Leitungswege, keine
Materialermittlung, keine Kalkulation, kein Offline-Sync, kein Platzhaltermodul.

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

Hier wird `electrical` erstmals um `depends_on = ("core", "materials")` erweitert
und implementiert `MaterialRequirementProvider` sowie `LaborRequirementProvider`.

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
| 17 AR Measurement | ARCore, Eckpunkte, Raumhöhe, Öffnungen | Technischer Spike auf realer Zielhardware **vor** der Umsetzung; Aufmaß mit dokumentierter Genauigkeit |
| 18 PV Foundation | Dachmodell, Hindernisse, Modulbelegung | PV erzeugt Bedarf über denselben Port |
| 19 PV Electrical | Strings, Wechselrichter, DC/AC | PV durchläuft Material → Kalkulation → Angebot |
| 20 Weitere Module | Wallbox, KNX, Netzwerk, Prüfungen | nach Bedarf |

---

### Phase 17 — technische Vorentscheidung (ARCore)

Vor jeder AR-Implementierung steht ein **technischer Spike auf realer
Android-Zielhardware**. Geprüft werden Messgenauigkeit, Lifecycle-Verhalten,
Sensorzugriff und Performance.

**Capacitor ist für den ARCore-Teil keine unveränderliche Vorgabe.** Zeigt der
Spike, dass sich Genauigkeit, Lifecycle, Sensorzugriff oder Performance über
Capacitor nicht zuverlässig erreichen lassen, wird die AR-Funktion als
**natives Kotlin-Modul** umgesetzt und in die App integriert. Die übrige App
bleibt davon unberührt.

Das Ergebnis des Spikes wird als ADR festgehalten. Bis dahin entsteht **kein**
AR-Code.

---

## Meilensteine

| Meilenstein | Bedeutung |
|---|---|
| **M1 — Anmeldung und Mandantentrennung** (Ende Phase 1) | **erreicht** — Fundament steht und ist abgenommen |
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
