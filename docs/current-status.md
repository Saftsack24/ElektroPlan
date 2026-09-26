# Aktueller Projektstand

**Letzte Aktualisierung:** 2026-09-26
**Aktualisiert nach:** Task 0013 — Phase 3.1: Projektweiter Schreibschutz unter
Nebenläufigkeit

> Dieses Dokument soll einer neuen Session in wenigen Minuten vermitteln, wo das Projekt
> steht.

---

## 1. Entwicklungsphase

**Phase 0 — Architektur: ABGESCHLOSSEN**
**Phase 1 — Platform Foundation: ABGESCHLOSSEN** (Abnahme durchgeführt, siehe Abschnitt 4)
**Phase 1.2 — Härtung der Grenzen und der Sitzungslogik: ABGESCHLOSSEN**
**Phase 2 — Core Business Data: ABGESCHLOSSEN** (siehe Abschnitt 3)
**Phase 2.1 — Nebenläufigkeit und Zustandskonsistenz: ABGESCHLOSSEN**
**Phase 2.2 — Schreibschutz für archivierte Projekte: ABGESCHLOSSEN**
**Phase 2.3 — Workflow- und UX-Nacharbeit: ABGESCHLOSSEN**
**Phase 2.4 — Nachkorrektur zu 2.2 und 2.3: ABGESCHLOSSEN**
**Phase 3 — Electrical Room Model: ABGESCHLOSSEN** (siehe Abschnitt 3)
**Phase 3.1 — Projektweiter Schreibschutz unter Nebenläufigkeit: ABGESCHLOSSEN**
(siehe Abschnitt 2)
**Phase 4a — 2D-Editor: NICHT BEGONNEN**, wartet auf Freigabe

> Phase 3 ist noch **nicht committet**; Phase 3.1 gehört fachlich dazu.

---

## 2. Zuletzt abgeschlossene Aufgabe

**Task 0013 — Phase 3.1: Projektweiter Schreibschutz unter Nebenläufigkeit**

Eine unabhängige Kontrolle nach Phase 3 fand eine echte Nebenläufigkeitslücke: Ein
Electrical-Schreibvorgang sperrte die **Raumzeile** und las den Projektstatus danach
**ohne Sperre**. Er konnte das Projekt als aktiv lesen, während eine andere Transaktion es
archivierte, und anschließend unter dem archivierten Projekt committen.

1. **Das Projekt ist jetzt die gemeinsame Sperrwurzel.** Jeder schreibende Zugriff auf ein
   Projekt oder eine Unterressource sperrt zuerst die Projektzeile
   (`SELECT … FOR UPDATE`) — **der Statuswechsel eingeschlossen**. Die Regel steht einmal
   im Core (`ProjectService.lock_writable`).
2. **Verbindliche Sperrreihenfolge `Projekt → (Kunde) → Unterressource`**, überall
   dieselbe. Die vorherige Reihenfolge Raum → Projekt war zugleich eine Deadlock-Quelle.
3. **Zwei serialisierbare Ausgänge, nichts dazwischen:** Fachänderung committet zuerst und
   die Archivierung folgt — oder die Archivierung committet zuerst und die Fachänderung
   erhält `409 project-archived`.
4. **Der Datei-Upload hält keine Sperre über die Übertragung** in den Object Storage:
   unverbindliche Vorprüfung → Upload → verbindliche Prüfung mit Sperre unmittelbar vor
   dem Commit.
5. **`CORE_PUBLIC_SURFACE` präzisiert**: keine Paketpräfixe mehr für `app.db` und
   `app.core.events`; `domain_events` ist für Module nicht mehr erreichbar.

Nachgewiesen mit 18 Parallelitätstests über sieben Schreibwege in beiden Richtungen; mit
vorübergehend entfernter Sperre fallen 8 davon um. Details: `docs/task-history.md`,
Task 0013.

**Task 0012 — Phase 3: Electrical Room Model** (Vorgänger)

Das **erste echte Fachmodul**. `electrical` modelliert Räume, Wände und Öffnungen auf
einem bestehenden Geschoss und prüft deren Geometrie serverseitig. Kein Editor, kein
Canvas, keine Elektrobauteile.

1. **Fachmodell** `Geschoss → Raum → Wand → Öffnung` in drei Tabellen (`electrical_rooms`,
   `electrical_walls`, `electrical_openings`), eine Migration (`0004`).
2. **Die Raumkontur sind die geordneten Wandsegmente** — kein Polygonfeld, keine
   gespeicherte Fläche, kein gespeicherter Konturzustand, kein `project_id` am Raum.
   Verbindlich in [ADR 0013](decisions/0013-room-contour-as-ordered-wall-segments.md); die
   Entwurfsfassung aus Phase 0 ist damit ausdrücklich überholt.
3. **Ganzzahlige Geometrie ohne Fließkomma**: Längen über `(isqrt(4n)+1)//2`, Flächen über
   die doppelte Gauß-Trapezfläche. Eine Funktion für Backend, Tests und späteren Editor.
4. **Zwei Prüfstufen**: Entwurfsregeln bei jedem Schreibvorgang, Konturschluss nur im
   Prüfbericht. Eine unvollständige Kontur ist ein zulässiger Zwischenstand.
5. **15 Endpunkte** unter `/api/v1/modules/electrical`, `If-Match` Pflicht, Archiv-Schutz
   über denselben Fehlervertrag wie im Core (`409 project-archived`).
6. **Ein Event** (`electrical.plan.updated` mit `change_kind`) über die Unit of Work nach
   dem Commit — ohne Empfänger in Phase 3, ohne personenbezogene Daten.
7. **Zwei Berechtigungen** (`electrical.plan.read`, `electrical.plan.write`). Der
   Administrator erhält über den Seed jede registrierte Berechtigung.
8. **Architekturgrenzen geschärft**: Ein Modul darf aus dem Core nur die veröffentlichte
   Oberfläche `CORE_PUBLIC_SURFACE` importieren — statisch geprüft. Der neue
   Erweiterungspunkt `app/core/projects/planning.py` ist die einzige Stelle, an der ein
   Fachmodul Geschoss, Projekt und Schreibschutz erfährt.
9. **Zeilensperre auf dem Raum** für jede Konturänderung: Zwei gleichzeitige Anfragen
   können keine gemeinsam ungültige Kontur erzeugen.
10. **Oberfläche**: Projekt-Tab „Räume & Grundriss" über den vorhandenen Beitragspunkt.
    **Die zentrale Projektseite wurde nicht angefasst.**

Details: `docs/task-history.md`, Task 0012.

**Task 0011 — Phase 2.4: Nachkorrektur zu 2.2 und 2.3** (Vorgänger)

Vier abgegrenzte Korrekturen, ohne Backend, Migration oder Architekturänderung:

1. **Dokumentation zu `archived` widerspruchsfrei.** Verbindlich: Endzustand, Projekt
   und untergeordnete Ressourcen schreibgeschützt, Lesen und Herunterladen bestehender
   Dateien erlaubt, keine Wiederherstellung. Ältere gegenteilige Aussagen bleiben als
   Historie stehen, sind aber als überholt gekennzeichnet.
2. **Zwei Fehlerstufen der Startstruktur.** Fehlt schon das Gebäude, wird das gesagt;
   fehlt nur das Geschoss, nennt die Meldung den bereits angelegten Gebäudenamen und
   warnt davor, ein zweites Gebäude anzulegen.
3. **Keine stille 200er-Grenze mehr** in der Kundenauswahl der Projektanlage: Sie sucht
   serverseitig, entprellt die Eingabe und weist auf abgeschnittene Treffer hin.
4. **Veraltete Kommentare korrigiert** — kein Hinweis behauptet mehr, bei einem
   Teilfehler werde ins Projekt navigiert.

Details: `docs/task-history.md`, Task 0011.

**Task 0010 — Phase 2.3: Workflow- und UX-Nacharbeit** (Vorgänger)

Bedienung statt Fachlichkeit. Datenmodell, API-Verträge, Berechtigungen und die
Nebenläufigkeitsgarantien aus Phase 2.1 sind unverändert; es gibt **keine Migration**.

1. **Kunden und Projekte werden im Dialog angelegt**, über einen Knopf **oberhalb** der
   Liste. Umgesetzt mit dem nativen `<dialog>`: Fokusfalle, Escape und Backdrop kommen
   vom Browser, auf schmalen Bildschirmen füllt er die Fläche. Keine neue Abhängigkeit.
2. **Startstruktur bei der Projektanlage**: „Gebäude und Geschoss gleich mit anlegen"
   ist vorausgewählt (`Hauptgebäude`, `Erdgeschoss`, Ebene 0, 2500 mm), die Namen sind
   änderbar, und für Serviceaufträge lässt sie sich abwählen. Als **Folgeablauf** aus
   den drei vorhandenen Endpunkten umgesetzt, nicht atomar — ein neuer geschachtelter
   Endpunkt wäre eine API-Änderung für eine reine Bedienerleichterung gewesen. Ein
   Teilfehler wird benannt, nicht verschwiegen.
3. **Projektdetail**: Gebäude und Geschosse als ruhige Übersicht, das Bearbeiten
   darunter im Bereich „Gebäudestruktur verwalten".
4. **„Weitere laden"** für beide Listen auf Basis des vorhandenen Keyset-Cursors —
   ohne Seitenzahlen (die API kennt keine) und ohne Infinite Scrolling. Such- und
   Filteränderungen setzen den Cursor zurück, überlappende Seiten werden entdoppelt.
5. **Gemeinsame UI-Bausteine** liegen in `src/core/ui/` und `src/core/api/`. Damit ist
   die dokumentierte technische Schuld abgetragen: Keine Seite exportiert mehr
   Bausteine für eine andere Seite.
6. **Formularfehler auf Deutsch und feldbezogen**; Eingaben bleiben bei jedem Fehler
   erhalten, Doppelübermittlung ist ausgeschlossen.

Details: `docs/task-history.md`, Task 0010.

**Task 0009 — Phase 2.2: Schreibschutz für archivierte Projekte** (Vorgänger)

Die offene fachliche Entscheidung **T0 ist getroffen**: Ein archiviertes Projekt ist
**vollständig schreibgeschützt**.

| Zugriff | Verhalten |
|---|---|
| Lesen (Projekt, Gebäude, Geschosse, Dateiliste) | erlaubt |
| Bestehende Datei herunterladen | erlaubt |
| Projektstammdaten, Gebäude, Geschosse ändern oder löschen | `409 project-archived` |
| Neuer Datei-Upload | `409 project-archived` |
| Statuswechsel aus `archived` | `409` (unverändert) |
| Projekt ausblenden (`deleted_at`) | **erlaubt** — bewusste Ausnahme |

Die Ausnahme beim Ausblenden ist notwendig: Ohne sie ließe sich ein Kunde mit
archiviertem Projekt nie mehr ausblenden, weil die Kundenlöschung offene Projekte zählt.
Eine Wiederherstellung aus `archived` gibt es nicht; sie wäre ein eigener
administrativer Vorgang mit eigener Berechtigung.

Die Regel steht als **eine** Service-Vorbedingung, nicht verstreut je Endpunkt. Für
Gebäude und Geschosse wird die Eigentümerkette bis zum Projekt aufgelöst. Die Oberfläche
spiegelt den Schreibschutz und verspricht nichts darüber hinaus.

Außerdem behoben: Die Kundenauswahl beim Anlegen eines Projekts bot anonymisierte Kunden
an, die der Server mit `404` ablehnt — eine Sackgasse für den Benutzer.

Details: `docs/task-history.md`, Task 0009.

**Task 0008 — Phase 2.1: Nebenläufigkeit und Zustandskonsistenz** (Vorgänger)

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
* ~~`archived` ist nur ein endgültiger Workflowstatus, kein Schreibschutz.~~
  **Überholt.** Damals lag die fachliche Entscheidung noch nicht vor, deshalb wurde das
  Verhalten in Phase 2.1 nicht geändert. Mit **Task 0009 (Phase 2.2)** ist entschieden:
  `archived` ist ein Endzustand **und** ein vollständiger Schreibschutz — siehe oben.

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

## 3. Abnahme von Phase 3 — Ergebnis

| # | Exit-Kriterium | Nachweis |
|---|---|---|
| 1 | Ein Raum mit Höhe, Wänden und Türen ist über die API erfassbar | Tests in `test_electrical_rooms.py`; im laufenden System über die Oberfläche: Raum `0.01`, vier Wände (5000 × 4000), Tür bei 1200 mm |
| 2 | Die Flächenberechnung ist getestet | Rechteck, Dreieck mit schräger Wand, L-Form, Umlaufsinn, Halb-mm²-Rundung — exakte Werte; im laufenden System 20,00 m² bei Umfang 18000 mm |
| 3 | Ungültige Geometrien werden abgelehnt | entartete Wand, Dublette, Überschneidung, Einschnürung, offene Kontur, Lücke, Öffnung außerhalb der Wand, überlappende Öffnungen — je mit eigenem Fehlercode |

**Abweichung vom Wortlaut des Exit-Kriteriums:** Dort stand „Polygon". Umgesetzt ist die
Kontur als geordnete Wandsegmente (ADR 0013); „ungültiges Polygon" heißt jetzt „ungültige
Raumkontur". Der fachliche Gehalt ist erfüllt, die Datenhaltung eine andere.

**Zusätzlich im laufenden System geprüft:** `PATCH` ohne `If-Match` → `428`, mit veralteter
Version → `409`; eine Wandverkürzung, die eine Tür ungültig machen würde, → `422` mit
verständlicher Meldung und unveränderter Wand; archiviertes Projekt → Räume, Wände und
Öffnungen lesbar, jeder schreibende Endpunkt `409 project-archived`, Oberfläche ohne
Aktionen; Abmelden und Neuladen einer Projekt-URL landet auf der Anmeldung.

---

## 4. Abnahme von Phase 2 — Ergebnis

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

## 5. Abnahme von Phase 1 — Ergebnis

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

## 6. Was funktioniert

### Nachgewiesen geprüft

Stand nach Task 0012 (Phase 3), gegen echtes PostgreSQL 17 und MinIO:

| Bereich | Nachweis |
|---|---|
| Ruff (Lint + Format) | `All checks passed` |
| mypy `--strict` | keine Befunde, 84 Dateien |
| Modulgrenzen (import-linter) | 4 Contracts, 0 verletzt |
| Modul- und Datenbankgrenzen (AST + Metadaten) | keine Verstöße; neu: Core-Oberfläche als Positivliste |
| Frontend-Modulgrenzen | `npm run check:boundaries` OK |
| Lockfile aktuell | `uv lock --check` grün |
| Alembic | genau ein Head (`0004_electrical_room_model`); Autogenerate und `alembic check` melden keinen Unterschied zum Modell |
| Backend-Tests | **579 bestanden, 0 übersprungen** (Phase 3: 552) |
| Frontend | Typecheck, ESLint, Modulgrenzen, **163 Tests**, Produktionsbuild |
| API-Client-Drift | `npm run check:api` grün |
| Compose | Dienste gesund; Migration `0004` und Seed im Container ausgeführt, Seed legte die zwei neuen Berechtigungen an |
| Browser-Smoke-Test | 12 Schritte im laufenden System, siehe Abschnitt 3; nach Phase 3.1 ein kurzer Nachtest (bearbeiten, dann archivieren) |

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
  die Composition Root füllt ihn. Die Elektroplanung hängt sich seit Phase 3 dort ein,
  **ohne dass die Projektseite geändert wurde**.
- **Raummodell der Elektroplanung (Phase 3):** Räume, Wände und Öffnungen auf einem
  Geschoss; ganzzahlige Geometrie in Millimetern; Kontur aus geordneten Wandsegmenten;
  berechnete Fläche, Umfang und Konturzustand; zwei Prüfstufen (Entwurf / geschlossene
  Kontur); Zeilensperre auf dem Raum gegen gleichzeitige Änderungen; ein Event;
  formularbasierte Oberfläche mit Geschossauswahl, Dialogen und Konturbericht.
- **Veröffentlichte Core-Oberfläche:** Ein Fachmodul darf nur eine benannte Positivliste
  aus dem Core importieren (`CORE_PUBLIC_SURFACE`) — statisch geprüft, mit Negativfällen
  für `models`, `service`, `schemas`, `storage`, `seed` und `registry`.

---

## 7. Status der Einzelpunkte

Getrennt nach Art — nicht alles, was erledigt ist, ist auch getestet, und nicht alles,
was offen ist, ist eine Schuld.

### Behoben **und** nachweislich getestet

| Punkt | Nachweis |
|---|---|
| Nach abgeschlossener Archivierung committet keine Änderung mehr | 14 Paralleltests (7 Schreibwege × 2 Richtungen), Prüfung des Datenbankzustands; ohne die Projektsperre fallen 8 Tests um |
| Sperrreihenfolge `Projekt → Unterressource` | mitgeschriebenes SQL belegt die Reihenfolge `projects` vor `electrical_rooms` |
| Keine Deadlocks bei gegenläufigen Unterressourcen | Gebäudeanlage und Wandänderung gleichzeitig, beide kommen durch |
| Datei-Upload hält keine Sperre über die Übertragung | Reihenfolge im Endpunkt: Vorprüfung ohne Sperre → Upload → Sperre vor dem Commit; der Datenbankteil ist als Paralleltest abgedeckt |
| Core-Oberfläche gibt keine Pakete frei | Negativtests für `app.db.*` und `app.core.events.models`, Zusicherung gegen Paketpräfixe |
| Raumkontur: geschlossen, offen, Lücke, Selbstüberschneidung, Einschnürung | 58 Geometrietests ohne Datenbank, exakte Werte statt Toleranzen |
| Flächen- und Umfangsberechnung | Rechteck, Dreieck mit schräger Wand, L-Form, Umlaufsinn, Halb-mm²-Rundung; zusätzlich über die API und im Browser |
| Öffnungen: innerhalb, außerhalb, überlappend, berührend, zu hoch | je eigener Fehlercode; Berührung an der Kante ist ausdrücklich erlaubt |
| Wandänderung macht keine Öffnung stillschweigend ungültig | `422`, Änderung wird nicht ausgeführt, Version bleibt stehen — auch im Browser geprüft |
| Löschregel für Wände mit Öffnungen | `409`; Raum löschen kaskadiert, im Datenbankzustand geprüft |
| Geschoss oder Gebäude mit Planungsdaten löschen | `409` statt `500`; Fremdschlüssel `RESTRICT` zentral übersetzt |
| Gleichzeitige Konturänderungen | 6 Paralleltests mit zwei Threads und Barriere; zwei davon schlagen ohne die Raumsperre nachweislich fehl |
| Mandantentrennung für Raum, Wand, Öffnung | Sweep über alle ID-Routen plus drei `IntegrityError`-Tests gegen mandantenübergreifende Verweise |
| Archiv-Schreibschutz im Fachmodul | alle zehn schreibenden Endpunkte liefern `409 project-archived`; Lesen bleibt geprüft möglich |
| `electrical` benutzt nur die öffentliche Core-Oberfläche | statische Prüfung mit Negativfällen für `models`, `service`, `schemas`, `storage`, `seed`, `registry` |
| Core importiert kein Fachmodul | AST-Prüfung über `app/core/**` und `app/db/**` |
| Projekt-Tab über den Beitragspunkt, ohne Änderung der Projektseite | 9 Frontend-Tests plus Sichtprüfung im Browser |
| Startstruktur meldet beide Fehlerstufen unterscheidbar | 9 Tests; bei fehlendem Geschoss wird der bereits angelegte Gebäudename genannt |
| Kundenauswahl ohne stille Obergrenze | 10 Tests für Suche, Entprellung, Auswahlbeständigkeit und den Hinweis auf weitere Treffer |
| Dialogbedienung (öffnen, abbrechen, Escape, Fokus, Doppelklick) | 24 Komponententests über beide Dialoge |
| Eingaben bleiben bei Feld- und Serverfehlern erhalten | je Dialog geprüft, inklusive `aria-invalid` |
| Cursor-Nachladen und Zurücksetzen bei Filterwechsel | 7 Tests gegen den echten Hook mit Seitenattrappe |
| Ausgeblendete Aktionen bei archivierten Projekten | 6 Komponententests; der verbindliche Schutz bleibt serverseitig |
| Schreibschutz archivierter Projekte | alle sieben schreibenden Unterressourcen liefern `409 project-archived`; Lesen und Download bleiben geprüft möglich |
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
| Zu **Task 0011** (Phase 2.4) fehlt der Eintrag in `docs/task-history.md` | `current-status.md` verweist auf einen Abschnitt, den es nicht gibt | wenn die Einzelheiten dieses Auftrags belegbar sind; in Phase 3 nicht rekonstruiert |
| Fachliche Fehlermeldungen des Backends sind in ASCII geschrieben (`schreibgeschuetzt`, `Aenderung`) | Im Browser erscheinen Umlaute als Umschrift; die Oberfläche selbst schreibt korrekt. Bestand seit Phase 2 | wenn eine Entscheidung zur Schreibweise der Servermeldungen getroffen wird |
| Fläche, Umfang und Konturzustand werden bei jedem Lesen berechnet | Bei den erwarteten Datenmengen nicht messbar; ein gespeicherter Wert bleibt ausgeschlossen (ADR 0013) | erst, wenn ein Profiling es verlangt |
| Die Überschneidungsprüfung ist quadratisch in der Wandzahl | Deshalb die Grenze von 200 Wänden je Raum | erst, wenn ein realer Grundriss daran scheitert |
| Die Projektsperre serialisiert **alle** Schreibvorgänge eines Projekts | Im Baualltag (ein bis zwei Bearbeiter je Projekt) unkritisch; nicht gemessen | wenn mehrere Personen gleichzeitig an einem Projekt arbeiten |
| Ein Datei-Upload kann nach vollständiger Übertragung noch mit `409` scheitern | Bewusster Tausch: Die Sperre wird nicht über die Übertragung gehalten. Das Objekt wird verworfen | keine Absicht, das zu ändern |

### Offene fachliche Entscheidungen

| # | Frage | Spätestens vor |
|---|---|---|
| T6 | **Projektarten** (Neubau, Sanierung, Service): Braucht es sie, und was unterscheidet sie? Bis dahin deckt die abwählbare Startstruktur den Serviceauftrag ab | vor Phase 8 |
| T1 | Symbolbibliothek: eigene SVGs oder DIN EN 60617 | Phase 4a |
| T7 | **Raumtyp** (`living`, `kitchen`, …): Wird er für Ausstattungsvorlagen gebraucht, und mit welcher Werteliste? In Phase 3 bewusst nicht angelegt | vor Phase 5 |
| T8 | **Wandhöhe und Wandtyp** je Wand: Braucht es sie neben der Raumhöhe (Kniestock, Außen- gegen Innenwand)? | vor Phase 4b |
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

## 8. Bekannte Probleme

| # | Punkt | Bewertung |
|---|---|---|
| 1 | `starlette.testclient` warnt vor `httpx` (Deprecation) | kosmetisch |
| 2 | Readiness-Check braucht ohne Datenbank ~13 s bis zum Timeout | durch `database_connect_timeout` begrenzt |
| 3 | Globaler uv-Cache dieser Maschine ist defekt | umgangen durch projektlokalen Cache |

---

## 9. Nächste geplante Aufgabe

**Phase 4a — 2D-Editor:** Canvas-Editor für Räume, Wände und Öffnungen mit Raster,
Fangfunktion, Maßanzeige und Undo/Redo.

Für die Umsetzung wichtig:

- Das Datenmodell aus Phase 3 bleibt: Der Editor verschiebt Wandpunkte und ordnet Wände
  um — beides gibt es schon. Es entsteht **kein** zweites Geometriemodell (ADR 0013).
- Die Geometrieregeln liegen in `app/modules/electrical/geometry.py` und sind ohne
  Datenbank aufrufbar. Der Editor sollte dieselben Regeln spiegeln, aber die verbindliche
  Prüfung bleibt serverseitig.
- Die Rundungsregel für schräge Wände ist verbindlich und darf im Editor nicht abweichen.
- Offen vor Phase 4a: **Symbolbibliothek** (offene Entscheidung T1) — betrifft erst
  Phase 5, sollte aber vor dem Editor geklärt sein.

> Phase 4a wird erst nach ausdrücklicher Freigabe begonnen.

---

## 10. Hinweise für die nächste Session

1. Zuerst `CLAUDE.md`, dieses Dokument und `docs/roadmap.md` lesen.
2. Umgebung: `.\tasks.ps1 install` (installiert aus `uv.lock` und `package-lock.json`),
   dann `docker compose up -d` und `.\tasks.ps1 check`.
3. Für Datenbanktests `ELEKTROPLAN_TEST_DATABASE_URL` setzen — sonst überspringen sie
   sichtbar.
4. Das Backend ist **synchron** (ADR 0011): Endpunkte sind `def`, nicht `async def`.
5. `electrical` hängt in den Phasen 3–6 **nur** von `core` ab; `materials` kommt erst in
   Phase 7 (siehe `docs/modules.md`).
5a. Ein Modul darf aus dem Core **nur** die Positivliste `CORE_PUBLIC_SURFACE`
   (`app/core/module_registry/boundaries.py`) importieren. Fehlt ein Zugang, wird er dort
   bewusst ergänzt und dokumentiert — nicht umgangen.
5b. Nach dem Hinzufügen eines Moduls muss `.\tasks.ps1 seed` laufen: Erst dadurch werden
   die neuen Berechtigungen angelegt, den Systemrollen zugeordnet und das Modul für die
   Organisation aktiviert (`organization_modules`). Ohne diesen Lauf bleibt der Projekt-Tab
   unsichtbar.
7. Aendernde Endpunkte auf versionierten Entitäten verlangen `If-Match`; fehlt der
   Header, antwortet der Server mit `428` (docs/api.md, Abschnitt 5).
8. Der volle Testlauf dauert wegen der mypy-Subprozesse in
   `tests/test_ports_typing.py` mehrere Minuten, wenn der mypy-Cache kalt ist. Das ist
   kein Hänger.
6. Nach Schemaänderungen Migration erzeugen, nach API-Änderungen
   `.\tasks.ps1 openapi`, nach Abhängigkeitsänderungen `.\tasks.ps1 lock`.
