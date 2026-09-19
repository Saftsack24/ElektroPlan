# Changelog

Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).
Einträge entstehen nach relevanten Änderungen, nicht nach jedem Commit.

---

## 2026-09-19 — Phase 2.4: Nachkorrektur zu 2.2 und 2.3

Kleine, abgegrenzte Korrektur. Kein Backend, keine Migration, keine
Architekturänderung.

### Fixed

- **Widersprüchliche Dokumentation zu `archived` bereinigt.** Verbindlich gilt: `archived`
  ist ein Endzustand, Projekt und untergeordnete Ressourcen sind schreibgeschützt, Lesen
  und das Herunterladen bestehender Dateien bleiben erlaubt, eine Wiederherstellung gibt
  es nicht. Die älteren, gegenteiligen Aussagen in `current-status.md`, `roadmap.md`,
  `task-history.md` und `changelog.md` bleiben als Historie stehen, sind aber ausdrücklich
  als überholt markiert.
- **Zwei Fehlerstufen bei der Startstruktur.** Schlägt schon das Gebäude fehl, meldet die
  Oberfläche, dass beides fehlt. Schlägt nur das Geschoss fehl, sagt sie ausdrücklich,
  dass das Gebäude **bereits existiert**, nennt seinen Namen aus der Serverantwort und
  weist darauf hin, kein zweites Gebäude anzulegen. Vorher gab es nur eine unscharfe
  Sammelmeldung, die zu einer Dublette verleitet hätte.
- **Die stille Grenze von 200 Kunden in der Projektanlage ist weg.** Statt pauschal die
  ersten 200 zu laden, sucht die Oberfläche jetzt serverseitig (`q`, kleines `limit`,
  Auswertung von `has_more`), entprellt die Eingabe um 300 ms und sagt ausdrücklich, wenn
  es mehr Treffer gibt als angezeigt. Der gewählte Kunde bleibt stehen, auch wenn sich der
  Suchbegriff ändert.
- **Veraltete Codekommentare korrigiert**, insbesondere die Behauptung, bei einem
  Teilfehler werde trotzdem ins Projekt navigiert — die Oberfläche bleibt bewusst auf der
  Liste, sonst verschwände die Warnung mit dem Seitenwechsel.

### Tests

- Neu: `startstruktur.test.ts` (9) für beide Fehlerstufen, `KundenAuswahl.test.tsx` (10)
  für Suche, Entprellung, Auswahlbeständigkeit sowie Lade-, Leer- und Fehlerzustand.
- `ProjectFormDialog.test.tsx` auf die Suchauswahl umgestellt (11 Tests, unverändert grün).

---

## 2026-09-19 — Phase 2.3: Workflow und Bedienung

Kein neues Datenmodell, keine Migration, keine Architekturänderung — die vorhandene
Kunden- und Projektverwaltung wird alltagstauglich.

### Added

- **Kunden und Projekte werden im Dialog angelegt.** Über den Knöpfen „Neuer Kunde" und
  „Neues Projekt" **oberhalb** der Liste; das Formular steht nicht mehr dauerhaft unter
  einer langen Tabelle. Umgesetzt mit dem nativen `<dialog>`-Element: Fokusfalle,
  Escape und Backdrop kommen vom Browser, auf schmalen Bildschirmen füllt der Dialog
  per CSS die ganze Fläche. Keine zusätzliche Abhängigkeit.
- **Startstruktur bei der Projektanlage.** „Gebäude und Geschoss gleich mit anlegen" ist
  vorausgewählt (`Hauptgebäude`, `Erdgeschoss`, Ebene 0, 2500 mm), die Namen sind
  änderbar, und für Serviceaufträge lässt sich die Struktur abwählen. Umgesetzt als
  Folgeablauf aus drei vorhandenen Endpunkten statt als neuer atomarer Endpunkt; ein
  Teilfehler wird benannt statt verschwiegen (docs/api.md).
- **„Weitere laden" für Kunden- und Projektliste.** Der gemeinsame Baustein
  `useCursorListe` nutzt den vorhandenen Keyset-Cursor der API. Bewusst keine
  Seitenzahlen — die API kennt keine — und kein Infinite Scrolling.
- **Gemeinsame UI-Bausteine** in `src/core/ui/` und `src/core/api/`.

### Changed

- Die **Projektdetailseite** zeigt Gebäude und Geschosse als ruhige Übersicht; das
  Anlegen, Umbenennen und Löschen liegt darunter im ausklappbaren Bereich
  „Gebäudestruktur verwalten".
- **Fehlermeldungen in Formularen sind deutsch und feldbezogen.** Die englischen
  Pydantic-Codes werden übersetzt, Eingaben bleiben bei jedem Fehler erhalten, und
  unbekannte Codes führen zu einer verständlichen Rückfallmeldung statt zu einer
  Rohmeldung.
- Doppelte Übermittlung ist ausgeschlossen: Während einer laufenden Anfrage sind Felder
  und Knöpfe gesperrt.

### Fixed

- **Technische Schuld abgetragen:** `Feld` und `STATUS_LABEL` wurden aus Seitendateien
  importiert. Beides liegt jetzt in eigenen Bausteinen; zwischen Kunden- und
  Projektseiten gibt es keine gegenseitigen Importe mehr.

### Fixed (aus dem Browser-Smoke-Test)

- Bei einem **Teilfehler der Startstruktur** wäre die Warnung verlorengegangen, weil die
  Oberfläche sofort ins Projekt sprang. Jetzt wird nur bei vollständigem Erfolg
  gesprungen.
- Der Planner-Container band `packages/api-client` nicht vom Host ein und lief deshalb
  gegen eine Fassung ohne `ifMatch` — jeder Statuswechsel scheiterte mit `428`. Die
  Ursache lag in `docker-compose.yml` und stammt aus Phase 1; das Quellverzeichnis ist
  jetzt eingebunden.

### Tests

- 47 neue Frontend-Tests: Dialogbedienung (öffnen, abbrechen, Escape, Fokus,
  `aria-labelledby`), Eingabeerhalt bei Feld- und Serverfehlern, Schutz gegen
  Doppelübermittlung, Startstruktur an/aus, Cursor-Nachladen samt Zurücksetzen bei
  Such- und Filteränderung, Entdopplung überlappender Seiten, Fehlerübersetzung sowie
  die ausgeblendeten Aktionen bei archivierten Projekten.
- Backend ergänzt: Auch der **Kundenwechsel** an einem archivierten Projekt ist `409`.

---

## 2026-09-19 — Phase 2.2: Schreibschutz für archivierte Projekte

### Changed

- **`archived` ist jetzt ein vollständiger Schreibschutz** — fachlich entschieden, nicht
  stillschweigend eingeführt. Der vormals offene Punkt T0 ist damit erledigt.
  Projektstammdaten, Gebäude, Geschosse und Dateien eines archivierten Projekts sind
  unveränderlich, neue Uploads werden abgelehnt. Lesen und das Herunterladen bestehender
  Dateien bleiben erlaubt. Neuer Fehlertyp `project-archived` (`409`), damit Clients den
  Fall ohne Auswerten der Meldung erkennen.
  Durchgesetzt über **eine** Service-Vorbedingung, nicht verstreut je Endpunkt; für
  Gebäude und Geschosse wird die Eigentümerkette bis zum Projekt aufgelöst.
- **Eine bewusste Ausnahme:** Das Ausblenden des Projekts (`DELETE /projects/{id}`)
  bleibt möglich. Ohne sie ließe sich ein Kunde mit archiviertem Projekt nie mehr
  ausblenden, weil die Kundenlöschung offene Projekte zählt.
- Eine **Wiederherstellung** aus `archived` gibt es weiterhin nicht. Falls sie gebraucht
  wird, kommt sie als eigener administrativer Vorgang mit eigener Berechtigung.

### Fixed

- Die **Kundenauswahl beim Anlegen eines Projekts** listet keine anonymisierten Kunden
  mehr. Der Server lehnt sie mit `404` ab; die Oberfläche bot damit eine Sackgasse an.

### Tests

- Der Test, der den vorherigen Ist-Zustand festhielt
  (`test_archiviertes_projekt_bleibt_fachlich_bearbeitbar`), ist durch drei Tests
  ersetzt: vollständiger Schreibschutz über alle sieben schreibenden Unterressourcen,
  uneingeschränkte Lesbarkeit und die dokumentierte Ausnahme beim Ausblenden. Genau
  dafür war der alte Test da — er musste bewusst geändert werden.
- Dateien: Upload auf ein archiviertes Projekt wird abgelehnt; eine vorhandene Datei
  bleibt auflistbar und über die signierte Adresse herunterladbar (Inhalt verglichen).
- Frontend: `zuordenbareKunden()` mit drei Fällen.

---

## 2026-09-19 — Phase 2.1: Nebenläufigkeit und Zustandskonsistenz

Phase 2 war funktional fertig, hatte aber vier Lücken, die erst unter **echter
Parallelität** sichtbar werden. Alle vier sind jetzt geschlossen und mit Tests belegt,
die zwei getrennte Sessions in zwei Threads mit expliziten Barrieren gegen PostgreSQL
laufen lassen.

### Fixed

- **Echter paralleler Versionskonflikt ist `409`, nicht `500`.** Zwei gleichzeitige
  Anfragen können dieselbe Version lesen und beide die `If-Match`-Vorabprüfung bestehen.
  Der Verlierer trifft beim Schreiben keine Zeile mehr, SQLAlchemy meldet
  `StaleDataError`. Dieser Fall wird jetzt zentral in denselben fachlichen
  Versionskonflikt übersetzt wie ein veraltetes `If-Match`:
  `409` mit `type: …/version-conflict`. Die Antwort enthält keine Datenbank- oder
  Bibliotheksdetails.
- **Rennen zwischen Kundenausblendung und Projektanlage geschlossen.** Beide Seiten
  sperren jetzt zuerst die Kundenzeile (`SELECT … FOR UPDATE`) und arbeiten bis zum
  Commit in derselben Transaktion. Ein sichtbares Projekt an einem ausgeblendeten Kunden
  kann damit nicht mehr entstehen. Ein Vorab-Count ohne Sperre genügte nicht.
- **Anonymisierte Kunden sind für neue Projektzuordnungen gesperrt** (`404`).
  Bestehende Projekte behalten ihre Referenz und zeigen den Platzhalternamen — genau
  dafür bleibt der Datensatz erhalten. Dieselbe Zeilensperre verhindert, dass
  Anonymisierung und Zuordnung gegeneinander laufen.
- **Parallele Geschosseindeutigkeit endet nicht mehr in `500`.** Bestehen zwei
  gleichzeitige Anfragen die Vorabprüfung, entscheidet der eindeutige Index; der
  Verlierer erhält dieselbe `422`-Meldung wie im sequenziellen Fall. Übersetzt wird
  ausschließlich die namentlich erwartete Constraint `uq_floors_building_id_level` —
  jeder andere Integritätsfehler bleibt ein unerwarteter Fehler.
- **`If-Match` wird strikt geparst.** Akzeptiert sind nur `3` und `"3"`. Abgelehnt
  werden unter anderem `W/"3"`, `"3`, `3"`, `""3""`, `3, 4`, `*`, `0`, `-1`, `abc`,
  `3.0` und `03`. Die Fehlermeldung spiegelt den gesendeten Wert nicht zurück.

### Changed

- Die Session-Dependency rollt bei einer Ausnahme **ausdrücklich** zurück, bevor sie
  schließt. Eine Session mit fehlgeschlagener Transaktion darf nicht weiterverwendet
  werden; der zentrale Exception-Handler läuft erst danach und fasst sie nicht mehr an.
- `CustomerService.soft_delete` erwartet einen bereits gesperrten Datensatz statt einer
  ID. Damit ist im Code sichtbar, dass Sperre, Prüfung und Änderung zusammengehören.

### Documented

- **Bedeutung von `archived` offengelegt:** zum Zeitpunkt dieses Eintrags
  ausschließlich ein endgültiger Workflowstatus, kein Schreibschutz — die fachliche
  Entscheidung lag noch nicht vor und wurde nicht stillschweigend getroffen.

  > **Überholt durch den Eintrag vom selben Tag zu Phase 2.2.** Seither ist `archived`
  > zusätzlich ein vollständiger Schreibschutz. Dieser Absatz bleibt als Historie
  > stehen und beschreibt **nicht** mehr den geltenden Stand.

### Tests

- Neu: `tests/test_concurrency.py` — 15 Tests mit echten Threads und Barrieren gegen
  PostgreSQL. Jeder prüft am Ende den Datenbankzustand, nicht nur den Rückgabewert.
  Enthält den Nachweis, dass die Kundenzeile bei Anlage, Neuzuordnung und Ausblenden
  tatsächlich mit `FOR UPDATE` geladen wird (mitgeschriebenes SQL).
- Neu: `tests/test_preconditions.py` — 35 parametrisierte Tests der `If-Match`-Syntax.
- `tests/test_api_contract.py`: `StaleDataError` an der HTTP-Grenze wird zu `409`, ohne
  Datenbankinterna in der Antwort.
- `tests/test_projects.py`: die neun Fälle zum Kundenzustand bei Anlage und
  Neuzuordnung sowie zwei Tests, die den dokumentierten Ist-Zustand von `archived`
  festhalten.

### Database

- **Keine Migration.** Die Korrekturen betreffen Services, Fehlerbehandlung und
  Sperrstrategie; das Schema bleibt unverändert. `alembic heads` liefert weiterhin genau
  einen Head, Autogenerate meldet keinen Unterschied.

---

## 2026-09-19 — Phase 2: Core Business Data

### Added

- **Kundenstamm** (`/api/v1/customers`): Anlegen, Ändern, Ausblenden, Auflisten mit
  Freitextsuche (Name, Kundennummer, Ort), Filter nach Privat-/Firmenkunde, Sortierung
  nach Anlagezeitpunkt oder Name, Keyset-Pagination.
- **Projekte, Gebäude und Geschosse** (`/api/v1/projects`, `/api/v1/buildings`,
  `/api/v1/floors`). Ein Projekt braucht einen Kunden. Statuslauf
  `draft → active → completed`, `archived` als Endzustand; Statuswechsel sind eigene
  Endpunkte (`/activate`, `/complete`, `/archive`) und werden einzeln protokolliert.
  Geschosse tragen ganzzahlige Millimeter (ADR 0007) und sind je Gebäude auf ihrer Ebene
  eindeutig.
- **Nummernkreise in Benutzung**: `KD-#####` für Kunden (durchlaufend), `PR-JJJJ-####`
  für Projekte (je Kalenderjahr neu). Vergabe über Zeilensperre, nachgewiesen mit zwei
  echten Threads. Die Formate für Angebot und Auftrag bleiben offen (F5).
- **Anonymisierung von Kunden** (`POST /api/v1/customers/{id}/anonymize`): Umsetzung von
  Art. 17 DSGVO. Personenbezogene Felder werden überschrieben, Kundennummer und
  Belegzuordnung bleiben erhalten. Nicht umkehrbar; eigene Berechtigung
  (`customer.record.anonymize`), ausschließlich für Administratoren. Der Datensatz ist
  danach serverseitig gegen Änderungen gesperrt (`409`). Ausblenden (`deleted_at`) und
  Anonymisieren (`anonymized_at`) sind getrennte, kombinierbare Vorgänge.
- **Projektdateien**: Upload mit `project_id`, `GET /api/v1/projects/{id}/files` und
  `GET /api/v1/files/{id}/download-url`. Der Speicherschlüssel lautet nun
  `org/<org>/project/<projekt>/<datei><ext>` — wie in `docs/architecture.md`,
  Abschnitt 15 beschrieben.
- **Sieben neue Core-Permissions**: `customer.record.{read,write,delete,anonymize}`,
  `project.record.{read,write,delete}`. Zuordnung zu den Systemrollen erweitert.
- **Frontend**: Kundenliste und -detail, Projektliste mit Filtern, Projektdetail mit den
  Tabs Stammdaten, Gebäude & Geschosse und Dateien (inklusive Upload und Download).
- **Projekt-Tabs der Fachmodule** sind live: `src/core/modules/ProjectTabs.tsx` stellt den
  Kanal bereit, `src/app/App.tsx` füllt ihn aus der Registry. Ein Modul liest ihn über
  `useProjectTabs()` und muss die Composition Root nicht importieren.
- **API-Client**: `ifMatch` in den Request-Optionen und `upload()` für Multipart.
- **Ein ausdrückliches `null`** auf einem Pflichtfeld im `PATCH` wird als
  Validierungsfehler (`422`) abgelehnt, statt in einem Datenbankfehler zu enden.
  Optionale Felder lassen sich weiterhin über `null` leeren.

### Changed

- **`If-Match` ist Pflicht** bei jeder Änderung an einer versionierten Entität. Fehlt der
  Header, antwortet der Server mit **`428` Precondition Required** (RFC 6585, neu im
  Statuskatalog); passt er nicht, mit `409 version-conflict`. Ein `PATCH` ohne Bedingung
  wäre ein stilles Überschreiben — die Versionsspalte hätte dann keinerlei Wirkung.
- **Pagination verallgemeinert**: Der Cursor ist jetzt ein Keyset aus Sortierwert und ID
  und wird von Kunden, Projekten und dem Protokoll gemeinsam genutzt. Bestehende
  Cursor-Endpunkte verhalten sich unverändert.
- **Frontend-Modul `audit` → `platform`**: Das Modul trägt jetzt alle Core-Seiten
  (Kunden, Projekte, Protokoll), nicht mehr nur das Protokoll. Modul-ID bleibt `core`.

### Database

- Migration `0003_core_business_data`: neue Tabellen `customers`, `projects`,
  `buildings`, `floors`; neue Spalte `files.project_id` mit zusammengesetztem
  Fremdschlüssel. Alle vier Tabellen mandantenbezogen mit `UNIQUE (organization_id, id)`.
- `buildings → projects` und `floors → buildings` löschen mit `CASCADE`; Kunden und
  Projekte werden nur ausgeblendet (`deleted_at`).
- `alembic heads` liefert weiterhin genau einen Head; Autogenerate meldet keinen
  Unterschied mehr zum Modell.

### Tests

- Neu: `test_numbering.py`, `test_customers.py`, `test_projects.py`,
  `test_project_files.py`.
- `test_tenant_isolation.py` um Kunden, Projekte, Gebäude und Geschosse erweitert,
  inklusive des Nachweises, dass PostgreSQL einen mandantenübergreifenden
  Projekt-Kunde-Verweis selbst ablehnt.
- Frontend: Tests für den Projekt-Tab-Kanal und die Sichtbarkeitsregel des
  Plattform-Moduls; die Compile-Zeit-Prüfungen des API-Clients decken die neuen
  Endpunkte ab.

### Security

- `docs/security.md`, Abschnitt 13: Feldliste mit Zweck und Rechtsgrundlage je Entität
  (Datenminimierung) sowie die Beschreibung des umgesetzten Anonymisierungspfads.
  Weiterhin offen und Voraussetzung vor Echtdaten: Auskunft/Export,
  Verarbeitungsverzeichnis, TOM-Dokumentation, AV-Verträge, Restore-Regel.

---

## 2026-09-19 — Nachtrag: Klassifizierung verschachtelter `index`-Dateien

### Fixed

- **`ownerOf()`** in `apps/planner/scripts/module-boundaries.mjs`
  stufte bislang jede Datei namens `index.ts[x]` — unabhaengig von
  ihrer Tiefe — als `module-public` ein. Damit haette die Composition
  Root fremde Interna wie `modules/<id>/pages/index.ts` oder
  `modules/<id>/internal/index.ts` importieren koennen. Nur der
  Modulordner selbst (`src/modules/<id>`) und dessen direkte
  `index.ts[x]` sind jetzt der oeffentliche Einstieg; jede tiefer
  verschachtelte Datei bleibt `module-internal`. 11 neue
  Vitest-Fixtures decken Composition-Root-, App-, Cross-Modul- und
  dynamische Faelle ab.

---

## 2026-09-19 — Phase 1.2 Finalisierung: App-Grenze, dynamische Imports, frische Compose-Abnahme

### Changed

- **App-Grenze im Frontend**: `src/app/**` darf keinen oeffentlichen
  Modul-Index mehr importieren — weder ueber `../modules/audit` noch
  ueber `@/modules/audit`. Erlaubt ist nur die zentrale
  Composition-Root-Fassade `src/modules/index.ts`. Die produktive
  Regel in `apps/planner/scripts/module-boundaries.mjs` und die
  `reasonFor`-Meldungen wurden entsprechend erweitert.
- **Dynamische Imports** werden jetzt genauso streng geprueft wie
  statische. Die Analyse verwendet den TypeScript-Compiler und
  erkennt `import()`, `React.lazy(() => import(…))`, mehrzeilige
  Formen und Re-Exports (`export ... from`, `export * from`).
  Nicht statisch bestimmbare Importziele (`import(variable)` oder
  Template-Strings mit `${…}`) sind ein expliziter Architekturverstoss
  `dynamic-non-literal` und brechen den Build.
- **`tasks.ps1 boundaries`** fuehrt jetzt alle Grenzpruefungen aus:
  `import-linter`, Backend-AST-Grenzen + Datenbankgrenzen (ueber
  `tests/test_module_boundaries.py`), Port-Typisierung ueber die
  mypy-Negativfixtures und die produktive Frontend-Grenzpruefung. Die
  `help`-Ausgabe ist entsprechend angepasst.

### Tests

- Frontend-Boundaries-Suite ergaenzt: 29 Fixtures decken jetzt auch
  App-Faelle, Re-Exports, dynamische Sibling-Imports, dynamische
  App-/Composition-Root-Verstoesse, `dynamic-non-literal` (Template
  und Variable) und positive Faelle (eigenes Modul, Core, externe
  Pakete) ab. Alle Fixtures rufen weiterhin die produktive Funktion
  aus `module-boundaries.mjs` auf.
- 190 Backend-Tests bestanden, 0 uebersprungen (gegen frisch neu
  angelegte PostgreSQL-Datenbank).
- 37 Frontend-Tests bestanden.

### Docker

- `docker compose down -v` entfernte gezielt die
  ElektroPlan-Volumes `dev_elektroplan_postgres-data` und
  `dev_elektroplan_minio-data`. Kein breiter Volumelosch.
- `docker compose up --build -d` erzeugte einen frischen Zustand:
  `postgres`, `minio`, `backend` sind `healthy`, `minio-init` mit
  Exit 0 beendet, `planner` erreichbar.
- Migration `leer -> Head` (0001 -> 0002_refresh_revocation)
  innerhalb des frischen Backend-Containers erfolgreich.
- Seed zweimal ausgefuehrt: 12 / 0 neue Permissions (idempotent).
- Login / Refresh / Logout gegen laufendes Backend: 200 / 200 / 204,
  danach 401. Vorgaenger in DB `revoked_reason='rotated'` und
  `replaced_by_id`, Nachfolger `revoked_reason='logout'`.
- Browser-Smoke: Anmeldung ueber die UI erfolgreich, Neuladen erhaelt
  die Sitzung, Logout fuehrt zurueck zur Anmeldemaske.

---

## 2026-09-19 — Phase 1.2 Nachbesserung: harte Grenzen, PG-Abnahme

### Security / Migrations

- Alembic-Revision ID auf `0002_refresh_revocation` (23 Zeichen) verkürzt und
  passt zuverlässig in `alembic_version.version_num` (VARCHAR(32)).
  Migrationszyklus (leer → head, 0001↔0002, Legacy-Zeilen → `family_revoked`)
  gegen echtes PostgreSQL 17 durchlaufen.

### Changed

- **Backend-Modulgrenze**: `depends_on` erlaubt keinen Python-Import fremder
  Module. Jeder Import auf `app.modules.<anderes>` ist verboten — auch dessen
  `contracts`, `providers`, `schemas`, `domain`. Modulkommunikation läuft
  ausschließlich über `app.contracts.v1`.
- **Statische AST-Analyse**: kein `importlib`, kein `pkgutil.walk_packages`
  mehr. Syntaxfehler, unlesbare Dateien und relative Importe über das Backend
  hinaus werden als eigenständiger Fehler gemeldet. Ein registriertes
  Nicht-Core-Modul ohne Ordner löst einen klaren Fehler aus.
- **Datenbankgrenze**: FK zwischen Modultabellen kategorisch verboten — auch
  bei `depends_on`. Externe Daten werden als UUID ohne FK geführt.
- **Frontend-Grenze**: neues Node-Skript
  `apps/planner/scripts/module-boundaries.mjs` löst Importe zur Quelldatei auf
  und bestimmt den tatsächlichen Datei-Owner. Sibling-Imports
  (`../andereModul/…`) werden dadurch technisch erkannt. Der Test ruft
  dieselbe Produktivfunktion auf. In `tasks.ps1 check` integriert.
- **Port-Typisierung**: neuer Test `tests/test_ports_typing.py` fährt mypy
  `--strict` gegen vier Negativ-Fixtures (fehlende Methode, falsche
  Parameteranzahl, falscher Parametertyp, falscher Rückgabetyp) und eine
  positive Fixture. Laufzeitprüfung erweitert um Parametertypen,
  sync/async-Vergleich und harten Fehler bei nicht auflösbaren
  Forward-Referenzen.

### Tests

- 190 Backend-Tests bestanden, 0 übersprungen (gegen PostgreSQL 17 und MinIO).
- 19 Frontend-Tests bestanden, davon 11 neue Grenzentests, die die
  Produktivfunktion prüfen.
- Migration von leer → head, downgrade 0002→0001 und wieder upgrade →
  0002 erfolgreich.
- Migration mit einem alten widerrufenen Refresh-Token verwandelt dessen
  `revoked_reason` konservativ in `family_revoked`.
- Seed zweimal idempotent (12 Permissions beim ersten Lauf, 0 beim zweiten).
- Login/Refresh/Logout gegen laufendes Backend: 200/200/204, danach 401 bei
  erneutem Refresh. Rotationsvorgänger trägt `revoked_reason = rotated` und
  `replaced_by_id`, Logout-Token trägt `revoked_reason = logout`.
- Browser-Neuladen erhält die Sitzung via Cookie-Rotation.

---

## 2026-09-19 — Phase 1.2: Härtung der Architekturgrenzen und der Sitzungslogik

### Security

- **Refresh-Token-Rotation:** Der ersetzte Datensatz wird atomar mit
  `replaced_by_id` an den Nachfolger gebunden und mit einem expliziten
  `revoked_reason` versehen. Es gibt vier Gründe (`rotated`, `logout`,
  `reuse_detected`, `family_revoked`). Nur ein tatsächlich `rotated`
  ausgewiesener Token gilt innerhalb des Toleranzfensters als parallele
  Anfrage. Ein durch Logout oder Familienwiderruf ungültiger Token bleibt
  ohne weiteren Sammelwiderruf sofort und eindeutig ungültig.
- Alembic-Migration `0002_refresh_revocation` ergänzt die Spalte und
  setzt bestehende widerrufene Zeilen konservativ auf `family_revoked`.
  Die Revisions-ID bleibt unter der 32-Zeichen-Grenze von
  `alembic_version.version_num`.

### Changed

- **Backend-Modulgrenzen** werden über eine statische Analyse in
  `app.core.module_registry.boundaries` durchgesetzt: pro Datei werden
  die Imports gegen die `ModuleDescriptor.depends_on` und den erlaubten
  öffentlichen Namensraum (nur Contracts) geprüft. Der `import-linter`
  behält die groben Schichtenregeln. Datenbankgrenzen werden aus
  denselben Metadaten heraus geprüft (Tabellenpräfix → Modul, jeder FK
  gegen erlaubte Ziele).
- **Provider-Ports** sind generisch (`PortBinding[TPort]`) und werden zur
  Startzeit strukturell mit `inspect.signature` verifiziert. `bind_port()`
  erzwingt zusätzlich schon bei `mypy --strict`, dass Port und
  Implementierung passen. Falsche Parameter oder Rückgabetypen führen zu
  einer klaren `ModuleRegistrationError`-Meldung.
- **Frontend-Modulgrenzen** verbieten sowohl absolute (`@/modules/foo`,
  `src/modules/foo`) als auch relative Umgehungen (`../modules/foo`,
  `../../modules/foo`). Innerhalb eines Modul-Ordners sind Geschwister-
  Imports über `../<anderes>/…` blockiert. Nur die Composition Root
  `src/modules/index.ts` darf konkrete Modul-Indizes importieren.

### Tests

- Neue negative Architekturtests in `tests/test_module_boundaries.py`
  belegen mit synthetischen Modulen und Metadaten, dass jede verbotene
  Richtung (Shared → Fachmodul, Fachmodul → Fachmodul, Zugriff auf
  Fremdinterna, unbekanntes Präfix, mandantenübergreifender FK) erkannt
  wird — auch ohne dass heute reale Fachmodule existieren.
- Zwei neue Registry-Tests verifizieren, dass eine Port-Implementierung
  mit falscher Parameter- oder Rückgabesignatur zur Startzeit abgelehnt
  wird.
- Sechs neue Auth-Tests decken `replaced_by_id`, den Grund `LOGOUT`,
  `REUSE_DETECTED` und den Nicht-Sammelwiderruf einer bereits gelogout-
  markierten Sitzung ab.
- Ein Vitest-Suite `boundaries.test.ts` fährt ESLint programmatisch
  gegen synthetische Import-Muster und beweist, dass die
  `no-restricted-imports`-Regeln greifen — und legitime Core-Zugriffe
  weiter erlaubt bleiben.

---

## 2026-09-18 — Phase 1.1: Korrekturen und Abnahme

### Security

- **Refresh Token nicht mehr im Antwortkörper.** Login, Refresh und Mandantenwechsel
  liefern nur noch Access Token, Laufzeit, Token-Typ und Organisationskontext. Der
  Refresh Token verlässt den Server ausschließlich als HttpOnly-Cookie — vorher hob die
  zusätzliche JSON-Ausgabe den XSS-Schutz faktisch auf.
- **Token-Rotation nebenläufigkeitssicher.** `SELECT … FOR UPDATE` auf der Token-Zeile;
  ein Token kann genau einen Nachfolger erzeugen. Parallele Anfragen innerhalb eines
  Toleranzfensters führen nicht mehr zur Zwangsabmeldung.
- **CSRF-Schutz implementiert**: `SameSite=Strict` plus strenge Origin-/Referer-Prüfung
  auf allen cookiebasierten Endpunkten. Dokumentation und Code stimmen jetzt überein
  (vorher war ein Double-Submit-Token beschrieben, der nicht existierte).
- **Upload gestreamt und hart begrenzt.** Das Größenlimit greift während des Lesens,
  nicht mehr erst nach dem vollständigen Einlesen in den Arbeitsspeicher.
  `Content-Disposition` ist injektionssicher; verwaiste Storage-Objekte werden entfernt.
- **Sicherheitsheader vervollständigt**: CSP für Entwicklung und Produktion getrennt,
  HSTS nur in Produktion, Request-ID validiert und längenbegrenzt. Die Zuständigkeit für
  TLS/HSTS am Reverse Proxy ist dokumentiert.

### Fixed

- **Signierte Download-URLs waren im Browser nicht erreichbar.** Interner und
  öffentlicher S3-Endpunkt sind jetzt getrennt; signiert wird mit dem Endpunkt, den der
  Browser aufruft.
- **Mehrmandanten-Login war nichtdeterministisch** (unsortiertes `LIMIT 1`). Bei mehreren
  aktiven Mitgliedschaften antwortet die API mit `409
  organization-selection-required` samt Auswahlliste.
- `migrations/env.py` überschrieb die Datenbank-URL bedingungslos; eine programmatische
  Vorgabe wurde ignoriert.
- Event-Handler wurden bei mehrfachem Erzeugen der Anwendung doppelt registriert.
- MinIO-Images werden von quay.io bezogen — `minio/minio` existiert auf Docker Hub nicht
  mehr.

### Changed

- **Event-Zustellgarantie ehrlich dokumentiert** ([ADR 0012](decisions/0012-event-delivery-guarantee.md)):
  `domain_events` ist ein Best-Effort-Protokoll mit *at most once*, **keine**
  transaktionale Outbox. ADR 0004 ist entsprechend gekennzeichnet.
- **Reproduzierbare Abhängigkeiten**: `uv.lock` eingecheckt, Installation nur noch über
  `uv sync --frozen` und `npm ci`. Kein zweiter Installationsweg.
- **API-Client typsicher**: Pfade, Methoden, Parameter, Body und Response stammen aus dem
  OpenAPI-Schema; falsche Aufrufe übersetzen nicht mehr.
- **Compose**: Images auf Digests gepinnt, MinIO-Healthcheck alias-frei, Startreihenfolge
  über Healthchecks und `service_completed_successfully`.
- **Rollenmodell**: Der MVP-Umfang ist beschrieben — feste Rollen, statische
  Permission-Zuordnung, kein Rolleneditor. Gegenteilige Aussagen entfernt.
- **Electrical/Materials**: `electrical` hängt in den Phasen 3–6 nur von `core` ab;
  die Materials-Abhängigkeit kommt erst in Phase 7.
- **DSGVO-Zeitgrenze korrigiert**: Die Anforderungen gelten vor der ersten Verarbeitung
  echter personenbezogener Daten — also vor Phase 2, nicht erst beim externen Mandanten.
- **Dokumentationspflicht pragmatisiert**: je Dokument eine Bedingung statt Ritual.

### Added

- Echte Migrationsabnahme gegen eine leere Datenbank (nur `alembic upgrade head`),
  inklusive Drift-Vergleich, `downgrade`/`upgrade` und zweifachem Seed.
- Offline-Konzept `docs/offline-sync.md`: schreibbare Aggregate, Idempotenz,
  Versionierung, Tombstones, vier Konfliktklassen.
- ARCore: technischer Spike auf realer Zielhardware vor der Umsetzung; Kotlin als
  Alternative zu Capacitor.
- `git archive` als dokumentierter Weg zu einem schlanken Prüfarchiv.

### Tests

145 Backend-Tests (vorher 85 bestanden bei 23 übersprungenen), **keine übersprungen** —
ausgeführt gegen echtes PostgreSQL 17 und MinIO. 8 Frontend-Tests inklusive
Compile-Zeit-Prüfungen des API-Clients.

---

## 2026-09-18 — Phase 1: Platform Foundation

### Added

**Backend (FastAPI, synchron)**
- Anwendungsfabrik mit typisierter Konfiguration, Secret-Validierung beim Start,
  Request-ID-Middleware, Security-Headern und strukturiertem JSON-Logging
- Fehlerbehandlung nach RFC 9457 (`application/problem+json`) mit stabilen `type`-Werten
- Health-Endpunkte `/health/live` und `/health/ready`
- Datenbankschicht: Naming Convention, Mixins und die Helfer `tenant_identity()` /
  `tenant_fk()` für zusammengesetzte Fremdschlüssel (ADR 0006)
- Core-Datenmodell mit 13 Tabellen und Alembic-Initialmigration (ein Strang)
- Unit of Work mit Event-Sammlung und Post-Commit-Zustellung (ADR 0004)
- `domain_events` als Ereignisprotokoll und spätere Outbox
- Module Registry mit sieben Startprüfungen; Verstöße verhindern den Start
- Authentifizierung: Argon2id, Access Token ohne Berechtigungen im Token,
  Refresh-Token-Rotation mit Familien-Invalidierung, Rate Limiting, Mandantenwechsel
- Autorisierung über Permissions (12 Core-Permissions, 6 Systemrollen)
- `TenantRepository` mit Zwang zum Organisationskontext
- Audit-Service mit expliziten Aufrufpunkten und Cursor-Pagination
- Object Storage (S3/MinIO) mit Typ-Whitelist, Magic-Byte-Prüfung und kurzlebigen
  Download-URLs
- CLI: `seed`, `check-modules`, `export-openapi`
- 108 Tests (85 ohne Datenbank lauffähig, 23 für PostgreSQL)

**Frontend (React 19, TypeScript strict)**
- Vite-Setup, AuthProvider mit Token im Speicher und automatischer Sitzungserneuerung
- Login, Shell mit Navigation, Dashboard, Protokollseite
- Frontend-Module-Registry mit Sichtbarkeitsprüfung über aktive Module und
  Berechtigungen; ein neues Modul benötigt eine Zeile in `src/modules/index.ts`
- `packages/api-client`: aus OpenAPI generierte Typen plus Transport mit
  RFC-9457-Fehlerbehandlung
- Geld- und Mengenhelfer auf Decimal-Basis (ADR 0005)

**Infrastruktur und Werkzeuge**
- `docker-compose.yml` mit PostgreSQL 17, MinIO inkl. Bucket-Initialisierung,
  Backend und Planner; Dockerfiles unter `infrastructure/`
- `Makefile` und `tasks.ps1` (Windows) mit `check` als Gesamtdurchlauf
- Qualitätsschranken: `import-linter` (4 Contracts), Architekturtests,
  Alembic-Head-Prüfung, OpenAPI-Drift-Check

### Changed

- `docs/database.md`: keine PostgreSQL-Erweiterungen mehr nötig — `gen_random_uuid()`
  ist seit PostgreSQL 13 im Kern, E-Mails werden klein geschrieben gespeichert statt
  `citext` zu verwenden
- Werkzeuge gegenüber `docs/phase-1-plan.md`: `venv`/`pip` statt `uv`, npm statt pnpm,
  `docker-compose.yml` im Wurzelverzeichnis (Begründungen in `docs/current-status.md`)

### Fixed

- `refresh_tokens.organization_id` von nullable auf `NOT NULL` — vom Architekturtest
  gefunden; die Sonderfälle im Auth-Service entfielen dadurch
- Event-Bus meldete Zyklen als "zu tiefe Kette"; Prüfreihenfolge korrigiert
- Readiness-Check blockierte ohne erreichbare Datenbank; Verbindungs-Timeout ergänzt
- `app/db/registry.py` importierte aus `app.core` (Schichtverstoß, von `import-linter`
  gefunden) — jetzt `app/model_registry.py` oberhalb der Schichten

### Notes

Drei Exit-Kriterien von Phase 1 stehen aus: Sie brauchen eine laufende PostgreSQL- und
Docker-Umgebung, die auf dem Entwicklungsrechner nicht verfügbar ist. Die zugehörigen
23 Tests sind geschrieben und überspringen sichtbar — sie laufen bewusst nicht
ersatzweise gegen SQLite.

### Added (ADR)

- [ADR 0011](decisions/0011-synchronous-sqlalchemy.md) — Synchrones SQLAlchemy statt async

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
