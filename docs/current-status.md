# Aktueller Projektstand

**Letzte Aktualisierung:** 2026-09-19
**Aktualisiert nach:** Task 0008 — Phase 2.1: Nebenläufigkeit und Zustandskonsistenz

> Dieses Dokument soll einer neuen Session in wenigen Minuten vermitteln, wo das Projekt
> steht.

---

## 1. Entwicklungsphase

**Phase 0 — Architektur: ABGESCHLOSSEN**
**Phase 1 — Platform Foundation: ABGESCHLOSSEN** (Abnahme durchgeführt, siehe Abschnitt 4)
**Phase 1.2 — Härtung der Grenzen und der Sitzungslogik: ABGESCHLOSSEN**
**Phase 2 — Core Business Data: ABGESCHLOSSEN** (siehe Abschnitt 3)
**Phase 2.1 — Nebenläufigkeit und Zustandskonsistenz: ABGESCHLOSSEN** (siehe Abschnitt 2)
**Phase 3 — Electrical Room Model: NICHT BEGONNEN**, wartet auf Freigabe

---

## 2. Zuletzt abgeschlossene Aufgabe

**Task 0008 — Phase 2.1: Nebenläufigkeit und Zustandskonsistenz**

Phase 2 war funktional fertig, hatte aber vier Lücken, die erst unter **echter
Parallelität** auftreten. Alle vier sind geschlossen und mit zwei getrennten Sessions
in zwei Threads und expliziten Barrieren gegen PostgreSQL nachgewiesen — jeder Test
prüft am Ende den Datenbankzustand, nicht nur die Antwort.

| # | Lücke | Vorher | Jetzt |
|---|---|---|---|
| 1 | Zwei Anfragen lesen dieselbe Version, beide bestehen `If-Match` | `StaleDataError` → `500` | `409` `version-conflict`, zentral übersetzt, Session zurückgerollt |
| 2 | Kunde ausblenden gegen Projekt anlegen | sichtbares Projekt an ausgeblendetem Kunden möglich | beide Seiten sperren zuerst die Kundenzeile; nur `409` oder `404` als Ausgang |
| 3 | Anonymisierter Kunde | für neue Projekte wiederverwendbar | für neue Zuordnungen `404`, für bestehende lesbar |
| 4 | Zwei Anfragen legen dieselbe Geschossebene an | `IntegrityError` → `500` | `422` wie im sequenziellen Fall, nur für die erwartete Constraint |

Dazu zwei Klarstellungen:

* **`If-Match` wird strikt geparst.** Akzeptiert sind nur `3` und `"3"`; `W/"3"`,
  `"3`, `3"`, `""3""`, `3, 4`, `*`, `0`, `-1`, `abc`, `3.0` und `03` sind `428`.
* **`archived` ist heute nur ein endgültiger Workflowstatus, kein Schreibschutz.**
  Kein Projektdokument legt Unveränderlichkeit fest, deshalb wurde das Verhalten
  **nicht** geändert — der Ist-Zustand ist dokumentiert, durch Tests festgehalten und
  in der Oberfläche ausdrücklich benannt. Die Entscheidung steht vor Phase 3 an.

**Keine Migration:** Das Schema blieb unverändert; die Invarianten werden mit
Transaktionsgrenzen und Zeilensperren gehalten, nicht mit Triggern.

Details: `docs/task-history.md`, Task 0008.

**Task 0007 — Phase 2: Core Business Data** (Vorgänger)

Die erste Phase mit Fachlichkeit. Neu im System:

1. **Kunden** mit Freitextsuche, Filter, Sortierung und Keyset-Pagination.
2. **Projekte** mit Pflichtkunde, Nummernkreis und einem Statuslauf
   `draft → active → completed`, `archived` als Endzustand. Statuswechsel sind eigene
   Endpunkte und werden einzeln protokolliert.
3. **Gebäude und Geschosse** je Projekt. Höhen sind ganzzahlige Millimeter (ADR 0007);
   je Gebäude ist jede Geschossebene nur einmal belegbar.
4. **Nummernkreise in Benutzung**: `KD-#####` und `PR-JJJJ-####`, Vergabe über
   Zeilensperre, nachgewiesen mit zwei echten Threads.
5. **Projektdateien**: Upload mit Projektbezug, Liste je Projekt, Download über eine
   signierte, zeitlich begrenzte Adresse.
6. **`If-Match` ist Pflicht** bei jeder Änderung an einer versionierten Entität — sonst
   `428`. Ohne Pflicht hätte die Versionsspalte keine Wirkung.
7. **Anonymisierung von Kunden** (Art. 17 DSGVO): personenbezogene Felder werden
   überschrieben, Kundennummer und Belegzuordnung bleiben. Nicht umkehrbar, eigene
   Berechtigung, nur Administrator, protokolliert **ohne** die gelöschten Werte.
8. **Oberfläche**: Kundenliste und -detail, Projektliste mit Filtern, Projektdetail mit
   Tabs (Stammdaten, Gebäude & Geschosse, Dateien). Der Beitragspunkt für Projekt-Tabs
   der Fachmodule ist live und getestet — ab Phase 3 hängt sich die Elektroplanung dort
   ein, ohne dass die Projektseite geändert werden muss.

Details: `docs/task-history.md`, Task 0007.

**Task 0006 — Phase 1.2: Finalisierung** (Vorgänger)

Sechs eng abgegrenzte Punkte aus dem letzten Review geschlossen:

1. **App-Grenze vollstaendig**: `src/app/**` darf keinen oeffentlichen
   Modul-Index mehr importieren — auch nicht ueber Alias oder relativen
   Pfad. Erlaubt ist nur die zentrale Composition-Root-Fassade
   `src/modules/index.ts`. Die produktive Regel in
   `apps/planner/scripts/module-boundaries.mjs` wurde korrigiert; die
   Vitest-Fixtures decken alle drei Formen (relativ, Alias, Interna) ab.
2. **Dynamische Imports**: die Grenzpruefung verwendet den TypeScript-
   Compiler und erkennt jetzt statische Imports, `export ... from`,
   `export *` und dynamische `import("…")` (auch in
   `React.lazy(() => import("…"))`, auch mehrzeilig). Nicht statisch
   bestimmbare Imports (`import(variable)`,
   `` import(`.../${x}`) ``) sind explizit ein Architekturverstoss
   `dynamic-non-literal` und brechen den Build.
3. **Quellbaum**: `npm run check:boundaries` gegen `apps/planner/src`
   ist gruen. Kein Verstoss im echten Quellbaum.
4. **`tasks.ps1 boundaries`**: fuehrt nun alle Grenzpruefungen aus
   (`import-linter`, Backend-AST-Grenzen, Datenbankgrenzen ueber die
   Metadaten, Port-Typisierung mit mypy-Negativfixtures, produktive
   Frontend-Grenze). Die Hilfe ist entsprechend angepasst.
5. **Frischer Compose-Abnahmelauf**: `docker compose down -v` +
   `up --build` ausgefuehrt; die ElektroPlan-Volumes
   (`dev_elektroplan_postgres-data`, `dev_elektroplan_minio-data`)
   wurden entfernt und neu erzeugt. Alle Container `healthy`,
   `minio-init` erfolgreich beendet, Migration von leer -> Head grün,
   Seed zweimal idempotent (12/0), Login/Refresh/Logout gegen laufendes
   Backend + Neuladen im Browser durchlaufen.
6. **Volle Qualitaetspruefung** nach dem frischen Start bestanden
   (Details in `docs/task-history.md`, Task 0006).

Details: `docs/task-history.md`, Task 0006.

**Task 0005 — Phase 1.2: Nachbesserungen (harte Grenzen, PG-Abnahme)**

Neun konkrete Review-Befunde zu Phase 1.2 abgearbeitet:

1. **Alembic-Revisions-ID** auf `0002_refresh_revocation` (23 Zeichen) verkürzt,
   passt in `alembic_version.version_num (varchar 32)`.
2. **Backend-Import-Grenze**: Jeder Import von `app.modules.<anderes>` ist
   verboten — auch dessen `contracts`, `providers`, `schemas`, `domain` oder
   Paket-Root. `depends_on` ist keine Importerlaubnis mehr.
3. **AST-Analyse ohne dynamischen Import**: `check_import_boundaries` liest
   Dateien vom Filesystem, ruft weder `importlib` noch `pkgutil.walk_packages`
   auf, meldet Syntaxfehler, unlesbare Dateien und relative Importe über das
   Backend hinaus als eigenständigen Fehler.
4. **FKs zwischen Modulen** sind nun kategorisch verboten — auch bei
   `depends_on`. Externe Referenzen werden als UUID ohne FK geführt und über
   Contracts validiert.
5. **Frontend-Sibling-Erkennung technisch**: neues Node-Skript
   `apps/planner/scripts/module-boundaries.mjs` löst Importpfade auf, bestimmt
   den Datei-Owner und lehnt `../andereModul/…` ab. Der Vitest-Test ruft
   dieselbe Funktion; `npm run check:boundaries` läuft in `tasks.ps1 check`.
6. **Port-Typisierung**: mypy-Negativ-Fixtures beweisen die statische Ablehnung
   von fehlender Methode, falscher Parameteranzahl, falschem Parametertyp und
   falschem Rückgabetyp. Laufzeitprüfung erweitert um Parametertypen,
   sync/async-Vergleich und harten Fehler für nicht auflösbare Forward-Refs.
7. **PostgreSQL-Abnahme**: 190 Tests bestanden, 0 übersprungen. Migration von
   leer → head, 0001↔0002 (downgrade und erneutes upgrade), Migration von
   Altdaten (widerrufener Legacy-Token → `family_revoked`), Seed zweimal
   idempotent, Login/Refresh/Logout gegen laufendes System, Neuladen im
   Browser.
8. **Dokumentation**: modules.md, security.md, current-status.md, roadmap.md,
   task-history.md, changelog.md aktualisiert.

Details: `docs/task-history.md`, Task 0005.

**Task 0004 — Phase 1.2: Härtung (Vorgänger)**

Erste Fassung der Härtung. Wurde in einem externen Review als noch nicht
akzeptiert eingestuft. Task 0005 hat die aufgezeigten Lücken geschlossen.

Die in Phase 1 gesetzten Regeln wurden automatisch durchsetzbar gemacht. Die
Prüfungen greifen jetzt auf **fünf** Ebenen und beziehen ihre Regeln direkt
aus den `ModuleDescriptor`-Metadaten, sodass ein neues Modul beim Anlegen
sofort in Reichweite der Grenzen steht:

1. **Backend-Modulgrenzen** — Neue statische Analyse
   `app/core/module_registry/boundaries.py`: pro Datei werden die Imports
   gegen `depends_on` und den erlaubten öffentlichen Namensraum (nur
   Contracts) geprüft. Der `import-linter` behält die groben
   Schichtenregeln.
2. **Provider-Ports** — `PortBinding[TPort]` ist generisch;
   `bind_port(TPort, TPort)` erzwingt die Bindung schon zur mypy-Zeit.
   Zur Startzeit prüft die Registry zusätzlich die Methoden-Signaturen mit
   `inspect.signature`.
3. **Datenbankgrenzen** — `check_table_boundaries()` liest die
   SQLAlchemy-Metadaten und ordnet jede Tabelle einem Modul zu; FKs
   werden gegen erlaubte Ziele geprüft. Core-Tabellen sind zentral in
   `app.core.module.CORE_TABLES` gelistet.
4. **Frontend-Modulgrenzen** — ESLint-Regeln blockieren jetzt auch
   relative Umgehungspfade und Geschwister-Imports innerhalb eines
   Modul-Ordners. Nur die Composition Root darf konkrete Modul-Indizes
   importieren.
5. **Refresh-Token-Rotation** — Neuer Widerrufsgrund
   (`revoked_reason`) und atomare Verknüpfung des Vorgängers über
   `replaced_by_id`. Nur `rotated` gilt innerhalb des Toleranzfensters
   als paralleler Refresh; `logout`, `reuse_detected` und
   `family_revoked` sind sofort und eindeutig ungültig.

Details: `docs/task-history.md`, Task 0004.

**Task 0003 — Phase 1.1: Korrektur- und Abnahmedurchlauf** (Vorvorgänger)

22 Prüfpunkte aus einer externen Durchsicht abgearbeitet: Compose- und MinIO-Konfiguration,
getrennte interne/öffentliche S3-Endpunkte, Refresh Token nur noch im Cookie,
nebenläufigkeitssichere Token-Rotation, CSRF-Schutz, Upload-Streaming, echte
Migrationsabnahme, vollständige Mandantentests, deterministischer Mehrmandanten-Login,
ehrliche Event-Zustellgarantie, Sicherheitsheader, reproduzierbare Abhängigkeiten,
typsicherer API-Client sowie zahlreiche Dokumentationskorrekturen.

Details: `docs/task-history.md`, Task 0003.

---

## 3. Abnahme von Phase 2 — Ergebnis

| # | Exit-Kriterium | Nachweis |
|---|---|---|
| 1 | Projekt mit Kunde, Gebäude und Geschossen anlegbar | Test `test_projekt_mit_gebaeude_und_geschossen`; zusätzlich im laufenden System: Kunde `KD-00002`, Projekt `PR-2026-0001`, Haupthaus mit UG/EG/OG |
| 2 | Plan-PDF hochladen und herunterladen | Test gegen echtes MinIO mit byteweisem Vergleich; im laufenden System über die signierte Adresse (`http://localhost:9000`) geladen und verglichen |
| 3 | Projektliste filterbar und paginiert | Filter nach Status, Kunde und Freitext (auch über den Kundennamen); Keyset-Cursor mit einem Test, der jeden Datensatz über mehrere Seiten genau einmal liefert |

**Zusätzlich im laufenden System geprüft:** `PATCH` ohne `If-Match` → `428`, mit
veralteter Version → `409`; Anonymisierung überschreibt die Felder und hinterlässt keine
personenbezogenen Daten im Protokoll; ein Kunde mit offenem Projekt lässt sich nicht
ausblenden (`409`).

---

## 4. Abnahme von Phase 1 — Ergebnis

Alle sieben Exit-Kriterien wurden **ausgeführt** und sind erfüllt:

| # | Exit-Kriterium | Nachweis |
|---|---|---|
| 1 | `docker compose up` startet Datenbank, MinIO, Backend und Planner | frischer Start mit neu erzeugten Volumes; alle Dienste `healthy` |
| 2 | Anmeldung funktioniert; `/api/v1/me` liefert Benutzer, Organisation, Rollen, Permissions | im laufenden System geprüft |
| 3 | Mandantentrennungstest über alle Routen ist grün | 9 Tests, Sweep über alle ID-Routen |
| 4 | Module Registry verweigert den Start bei ungültiger Konfiguration | 19 Tests |
| 5 | Event Bus stellt nachweislich erst nach dem Commit zu | 16 Tests |
| 6 | `alembic heads` liefert genau einen Head | geprüft; zusätzlich echte Migrationsabnahme |
| 7 | `import-linter`, Ruff, mypy, ESLint, `tsc --noEmit` laufen grün | Gesamtdurchlauf `tasks.ps1 check` |

**Testbilanz:** 145 Backend-Tests, **0 übersprungen** (zuvor 23 übersprungen), 8
Frontend-Tests. Ausgeführt gegen echtes PostgreSQL 17 und echtes MinIO.

---

## 5. Was funktioniert

### Nachgewiesen geprüft

Stand nach Task 0007, gegen echtes PostgreSQL 17 und MinIO:

| Bereich | Nachweis |
|---|---|
| Ruff (Lint + Format) | `All checks passed` |
| mypy `--strict` | keine Befunde, 73 Dateien |
| Modulgrenzen (import-linter) | 4 Contracts, 0 verletzt, 72 Dateien / 193 Abhängigkeiten |
| Modul- und Datenbankgrenzen (AST + Metadaten) | keine Verstöße |
| Frontend-Modulgrenzen | `npm run check:boundaries` OK |
| Lockfile aktuell | `uv lock --check` grün |
| Alembic | genau ein Head (`0003_core_business_data`); Autogenerate meldet keinen Unterschied zum Modell |
| Backend-Tests | **336 bestanden, 0 übersprungen** (4:46) |
| Frontend | Typecheck, ESLint, **54 Tests**, Build |
| API-Client-Drift | `npm run check:api` grün |
| Compose | Dienste gesund; Migration und Seed im Container ausgeführt |

### Umgesetzte Funktionen

- **Core-Datenmodell (17 Tabellen)** mit vierstufiger Mandantentrennung; die
  zusammengesetzten Fremdschlüssel wurden in PostgreSQL direkt gegen einen
  mandantenübergreifenden Verweis geprüft (IntegrityError) — sowohl für Rollen als auch
  für den Verweis Projekt → Kunde.
- **Kunden, Projekte, Gebäude, Geschosse** samt Nummernkreisen, Statuslauf,
  Freitextsuche, Filtern und Keyset-Pagination (Phase 2).
- **Optimistisches Sperren** über `If-Match` auf allen versionierten Entitäten;
  fehlender Header `428`, veraltete Version `409`.
- **Anonymisierung von Kunden** nach Art. 17 DSGVO, nicht umkehrbar, eigene
  Berechtigung, protokolliert ohne die gelöschten Werte.
- **Authentifizierung:** Argon2id, Access Token ohne Berechtigungen im Token,
  Refresh Token **ausschließlich** im HttpOnly-Cookie, Rotation mit
  `SELECT … FOR UPDATE`, Diebstahlserkennung mit Toleranzfenster für parallele
  Anfragen, Rate Limiting, deterministischer Mehrmandanten-Login.
- **CSRF:** `SameSite=Strict` plus strenge Origin-/Referer-Prüfung auf allen
  cookiebasierten Endpunkten.
- **Autorisierung:** 19 Permissions, 6 Systemrollen, Deklarationspflicht je Route.
- **Module Registry** mit sieben Startprüfungen; Bus wird vor dem Verdrahten geleert.
- **Event Bus:** Post-Commit-Zustellung, *at most once*, ehrlich dokumentiert.
- **Dateien:** Streaming-Upload mit hartem Limit, Magic-Byte-Prüfung, injektionssichere
  `Content-Disposition`, Aufräumen verwaister Objekte, signierte URLs über den
  **öffentlichen** Endpunkt (aus der Hostumgebung heruntergeladen und verglichen),
  Projektzuordnung und Dateiliste je Projekt.
- **Frontend:** Login mit Betriebsauswahl, Single-Flight-Sitzungserneuerung, Shell,
  Kunden- und Projektverwaltung, Projektdetail mit Tabs und Dateiupload, Protokollseite,
  typsicherer API-Client mit Compile-Zeit-Tests.
- **Projekt-Tabs der Fachmodule** sind als Beitragspunkt live: Der Core stellt den Kanal,
  die Composition Root füllt ihn. Ab Phase 3 hängt sich die Elektroplanung dort ein, ohne
  dass die Projektseite geändert werden muss.

---

## 6. Status der Einzelpunkte

Getrennt nach Art — nicht alles, was erledigt ist, ist auch getestet, und nicht alles,
was offen ist, ist eine Schuld.

### Behoben **und** nachweislich getestet

| Punkt | Nachweis |
|---|---|
| Paralleler Versionskonflikt ist `409` | zwei Sessions, zwei Threads, Barriere: genau ein Gewinner, Verlierer mit `version-conflict`; Version genau einmal weitergezählt |
| Kunde ausblenden gegen Projekt anlegen | Paralleltest prüft den Datenbankzustand; die verbotene Kombination kann nicht entstehen |
| Kundenzeile wird wirklich gesperrt | mitgeschriebenes SQL belegt `SELECT … FOR UPDATE` bei Anlage, Neuzuordnung und Ausblenden |
| Anonymisierter Kunde für neue Zuordnungen gesperrt | Tests für Anlage und Umhängen; bestehendes Projekt bleibt lesbar, Liste zeigt nur den Platzhalter |
| Parallele Geschossebene | Paralleltest plus threadfreier Test des Index-Pfads; genau ein Datensatz in der Datenbank |
| `If-Match`-Syntax | 35 parametrisierte Fälle |
| Nummernvergabe nebenläufigkeitssicher | Test mit zwei echten Threads und Barrier: zwei verschiedene Nummern |
| Optimistisches Sperren | Tests für fehlenden Header (`428`), veraltete Version (`409`) und ETag-Schreibweise |
| Anonymisierung nach Art. 17 DSGVO | Felder in der Datenbank geprüft; Protokoll enthält die gelöschten Werte nachweislich nicht; Berechtigung liegt nur beim Administrator |
| Keyset-Pagination | Test läuft über mehrere Seiten und prüft, dass jeder Datensatz genau einmal erscheint |
| Projekt → Kunde mandantenübergreifend | PostgreSQL lehnt den Verweis selbst ab (IntegrityError) |
| Plan-PDF hoch- und herunterladen | gegen echtes MinIO, Inhalt byteweise verglichen |
| Compose/MinIO: Healthcheck ohne Alias, gepinnte Digests | frischer Start, alle Dienste gesund |
| Interner/öffentlicher S3-Endpunkt getrennt | Datei über signierte URL vom Host geladen und byteweise verglichen |
| Refresh Token nicht mehr im JSON | Test prüft Antwortkörper **und** Rohtext |
| Rotation nebenläufigkeitssicher | Test mit zwei echten Threads und Barrier: genau ein Nachfolger |
| CSRF-Schutz | Tests für erlaubte Herkunft, fremde Origin, fremden Referer |
| Upload-Streaming und Grenzen | 15 Tests inkl. S3-Fehler und Commit-Fehler |
| Echte Migrationsabnahme | eigene Datenbank, nur `alembic upgrade head`, Seed zweimal |
| Mandantentrennung vollständig | 9 Tests, Sweep meldet unabgedeckte Routen als Fehler |
| Mehrmandanten-Login deterministisch | Tests für 0, 1, mehrere und deaktivierte Mitgliedschaften |
| Doppelte Handler-Registrierung | Bus wird vor dem Verdrahten geleert |
| API-Client-Typsicherheit | 4 `@ts-expect-error`-Marker, von `tsc` erzwungen |
| Reproduzierbare Abhängigkeiten | `uv.lock` (72 Pakete), `uv lock --check` im Gesamtlauf |

### Behoben, aber nur indirekt geprüft

| Punkt | Einschränkung |
|---|---|
| Sicherheitsheader (CSP, HSTS) | CSP wird gesetzt und ist im Code sichtbar; HSTS greift nur bei `ELEKTROPLAN_ENVIRONMENT=production` und wurde **nicht** unter echtem HTTPS erprobt |
| Frontend-Single-Flight | Logik implementiert und typgeprüft; es gibt **keinen** automatisierten Test, der zwei gleichzeitige 401er im Browser simuliert |
| Verwaiste Objekte bei Storage-Ausfall | Der Fehlerpfad ist getestet; der dokumentierte manuelle Cleanup-Lauf **existiert noch nicht** als Werkzeug |

### Bewusst aufgeschoben (keine Schuld, sondern Planung)

| Punkt | Geplant für |
|---|---|
| Row Level Security als fünfte Isolationsebene | vor externen Mandanten |
| Virenscan für Uploads, MFA | vor kommerziellem Einsatz |
| Offline-Sync-Umsetzung (Konzept steht) | Phase 13/16 |
| `packages/ui`, `packages/3d-engine` | erst bei zweitem Consumer |
| Benutzerverwaltungs-Oberfläche, Rolleneditor | offen, frühestens nach dem Pilot |
| Blätter-Bedienung in Kunden- und Projektliste | die API kann Cursor-Pagination bereits; die Oberfläche zeigt bis zu 50 Einträge und weist auf weitere hin |
| Echte transaktionale Outbox | erst wenn ein Handler eine nicht nachholbare Wirkung erzeugt (ADR 0012) |

### Technische Schulden

| Schuld | Auswirkung | Abtragen |
|---|---|---|
| Keine CI-Pipeline | Die Qualitätsschranken laufen nur lokal auf Zuruf | vor dem ersten Mehrpersonenbetrieb |
| Rate Limiting prozesslokal | Bei mehreren Backend-Instanzen wirkt die Grenze je Prozess | bei Mehrinstanzbetrieb |
| Kein Cleanup-Werkzeug für verwaiste Storage-Objekte | Ein doppelt fehlgeschlagener Upload hinterlässt ein Objekt; der Schlüssel steht im Log | offen — in Phase 2 nicht angefasst, weil es nicht zum Auftrag gehörte |
| `tests/test_ports_typing.py` startet mypy je Fixture als Subprozess | Bei kaltem mypy-Cache dauert der Gesamtlauf mehrere Minuten; funktional unbedenklich | wenn der Testlauf spürbar stört |
| `.uv-cache` projektlokal wegen defektem Benutzer-Cache | Umgehung, kein Fehler im Projekt | wenn der globale uv-Cache repariert ist |
| Compose-Datei dient Entwicklung **und** Abnahme | Für Produktion fehlt eine eigene Datei (Secrets, TLS, Backup) | vor Produktivbetrieb |

### Offene fachliche Entscheidungen

| # | Frage | Spätestens vor |
|---|---|---|
| T0 | Soll ein **archiviertes Projekt** vollständig unveränderlich sein? Heute ist `archived` nur ein endgültiger Workflowstatus; Stammdaten, Gebäude, Geschosse und Dateien bleiben änderbar | **vor Phase 3** |
| T1 | Symbolbibliothek: eigene SVGs oder DIN EN 60617 | Phase 4a |
| T2 | PDF-Erzeugung: WeasyPrint (Empfehlung) oder ReportLab | Phase 10 |
| T3 | Kleinmaterial: eigenes Material oder prozentualer Zuschlag | Phase 8 |
| T4 | Mehrgeschossige Steigezonen für Leitungswege | Phase 6 |
| T5 | Reservierungsstrategie bei mehreren Lagerorten | Phase 12 |
| F1 | Verschnittzuschläge je Materialgruppe, reale Ringgrößen | Phase 7 |
| F2 | 20–30 reale ServiceTemplates mit Zeiten | Phase 8 |
| F3 | Stundensatzmodell und Gemeinkostenaufschlag | Phase 9 |
| F4 | Angebotsstruktur und Mustervorlage | Phase 10 |
| F5 | Nummernkreise **für Angebot und Auftrag**: Format und Startwerte | Phase 10 (Kunde und Projekt sind mit Phase 2 festgelegt: `KD-#####`, `PR-JJJJ-####`) |
| F6 | Reale Lagerorte | Phase 12 |
| F7 | Vorkommende Umsatzsteuerfälle | Phase 10 |

### Voraussetzungen vor Echtdaten- oder Produktivbetrieb

**Phase 2 hat die Tabellen für personenbezogene Daten angelegt.** Sie sind bislang
ausschließlich mit synthetischen Daten gefüllt. Vor dem ersten echten Kundendatensatz
müssen die zwölf DSGVO-Voraussetzungen aus `docs/security.md`, Abschnitt 13 erfüllt
sein. Stand nach Phase 2:

| # | Anforderung | Stand |
|---|---|---|
| 1 | Zweck und Rechtsgrundlage | **dokumentiert** (`security.md`, Abschnitt 13) |
| 2 | Datenminimierung: Feldliste je Entität mit Zweck | **dokumentiert** |
| 3 | Auskunft und Export | offen |
| 4 | Berichtigung | **umgesetzt** (Stammdaten änderbar, Belege unberührt) |
| 5 | Löschung / Anonymisierung | **umgesetzt und getestet** |
| 6 | Aufbewahrungspflichten | offen (Festlegung je Dokumentart) |
| 7 | Trennung löschbar / aufbewahrungspflichtig | teilweise: für `customers` entschieden, für spätere Belegtabellen offen |
| 8 | Backup- und Restore-Wirkung auf Löschungen | offen |
| 9 | Protokoll- und Audit-Aufbewahrung | offen (Frist festgelegt, Umsetzung fehlt) |
| 10 | AV-Verträge | offen |
| 11 | Verarbeitungsverzeichnis | offen |
| 12 | TOM-Dokumentation | offen |

**Bis alle zwölf Punkte erfüllt sind gilt: ausschließlich synthetische Testdaten.**

Zusätzlich vor Produktivbetrieb: externes Security Review, geprobter Restore, TLS mit
HSTS, Virenscan, MFA für administrative Konten.

---

## 7. Bekannte Probleme

| # | Punkt | Bewertung |
|---|---|---|
| 1 | `starlette.testclient` warnt vor `httpx` (Deprecation) | kosmetisch |
| 2 | Readiness-Check braucht ohne Datenbank ~13 s bis zum Timeout | durch `database_connect_timeout` begrenzt |
| 3 | Globaler uv-Cache dieser Maschine ist defekt | umgangen durch projektlokalen Cache |

---

## 8. Nächste geplante Aufgabe

**Phase 3 — Electrical Room Model:** Datenmodell und API für Räume, Wände und Öffnungen
inklusive Geometrievalidierung. Noch ohne Editor — Erfassung über API und einfache
Formulare.

Für die Umsetzung wichtig:

- `electrical` wird mit `depends_on = ("core",)` registriert. `materials` existiert noch
  nicht und wird **nicht** als leerer Platzhalter angelegt (ADR 0003, Punkt 6).
- Räume und Wände hängen an `floors` — die Tabelle existiert seit Phase 2 und trägt
  `UNIQUE (organization_id, id)`, ein Fremdschlüssel aus `electrical_` darauf ist
  erlaubt (Core-Tabelle).
- Der Projekt-Tab-Beitragspunkt ist live; die Elektroplanung trägt sich mit einer Zeile
  in `apps/planner/src/modules/index.ts` ein.

> Phase 3 wird erst nach ausdrücklicher Freigabe begonnen.

---

## 9. Hinweise für die nächste Session

1. Zuerst `CLAUDE.md`, dieses Dokument und `docs/roadmap.md` lesen.
2. Umgebung: `.\tasks.ps1 install` (installiert aus `uv.lock` und `package-lock.json`),
   dann `docker compose up -d` und `.\tasks.ps1 check`.
3. Für Datenbanktests `ELEKTROPLAN_TEST_DATABASE_URL` setzen — sonst überspringen sie
   sichtbar.
4. Das Backend ist **synchron** (ADR 0011): Endpunkte sind `def`, nicht `async def`.
5. `electrical` hängt in den Phasen 3–6 **nur** von `core` ab; `materials` kommt erst in
   Phase 7 (siehe `docs/modules.md`).
7. Aendernde Endpunkte auf versionierten Entitäten verlangen `If-Match`; fehlt der
   Header, antwortet der Server mit `428` (docs/api.md, Abschnitt 5).
8. Der volle Testlauf dauert wegen der mypy-Subprozesse in
   `tests/test_ports_typing.py` mehrere Minuten, wenn der mypy-Cache kalt ist. Das ist
   kein Hänger.
6. Nach Schemaänderungen Migration erzeugen, nach API-Änderungen
   `.\tasks.ps1 openapi`, nach Abhängigkeitsänderungen `.\tasks.ps1 lock`.
