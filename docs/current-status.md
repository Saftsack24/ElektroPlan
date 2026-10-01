# Aktueller Projektstand

**Letzte Aktualisierung:** 2026-09-30
**Aktualisiert nach:** Task 0022 — Phase 4d (Datenlebenszyklus, Löschregeln, Bearbeitungsmetadaten, Aktions-UX)

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
**Phase 4a — 2D-Editor: ABGESCHLOSSEN** (Exit-Kriterium gemessen, siehe Abschnitt 3)
**Phase 4a.1 — Navigationsschutz und Testdatenbank-Sicherheit: ABGESCHLOSSEN**
**Phase 4.2 — Benutzerverwaltung, Rollenvergabe und Startseite: ABGESCHLOSSEN**
(committet als `66cbff3`)
**Phase 4b — 3D-Ansicht: ABGESCHLOSSEN** (automatisiert und im Browser mit echtem WebGL
abgenommen, siehe Abschnitt 2a) — mit dem gemeinsamen Checkpoint 4b/4b.1/4b.2 committet
**Phase 4b.1 — Bedienungsnacharbeit 1: ABGESCHLOSSEN** (automatisiert und im Browser
geprüft) — mit dem gemeinsamen Checkpoint 4b/4b.1/4b.2 committet
**Phase 4b.2 — Bedienungsnacharbeit 2: ABGESCHLOSSEN** (automatisiert und im Browser
funktional geprüft, siehe Abschnitt 2) — mit dem gemeinsamen Checkpoint 4b/4b.1/4b.2
committet
**Phase 4c.1 — Tailwind-Migration und Theme-Grundlage: ABGESCHLOSSEN** (automatisiert,
per Stilvergleich und im Browser funktional geprüft, Sichtprüfung durch den Auftraggeber)
— mit diesem Checkpoint committet
**Phase 4c.2 — persönliche Darstellung, Laufzeitthemes, responsive Nachkorrektur: ABGESCHLOSSEN**
(automatisiert geprüft, manuell durch den Auftraggeber abgenommen) — mit diesem Checkpoint
committet
**Phase 4d — Datenlebenszyklus, Löschregeln, Bearbeitungsmetadaten, Aktions-UX: ABGESCHLOSSEN**
(automatisiert, per API und im Browser geprüft, vom Auftraggeber geprüft) — mit diesem
Checkpoint committet
**Phase 5 — Electrical Devices: NICHT BEGONNEN**

> Phase 4a und 4a.1 sind als `887f254`, Phase 4.2 als `66cbff3` committet. Die
> Entscheidungen **T8** (Wandhöhe und Wandtyp) und **T9** (deckungsgleiche Wände) sind
> getroffen: [ADR 0016](decisions/0016-derived-3d-view-wall-height-and-coincident-walls.md),
> in Phase 4b.2 präzisiert (exakte Teilwände, eine Öffnung als Quelle).

---

## 2. Zuletzt abgeschlossene Aufgabe

**Task 0022 — Phase 4d: Datenlebenszyklus**
([ADR 0020](decisions/0020-data-lifecycle-deletion-and-reopen.md), Migration `0006`)

1. **Projekte löschen:** nur `draft`/`active`. **Leer** = keine Datei, höchstens ein
   Gebäude mit höchstens einem Geschoss, kein Modul meldet Inhalt. Leer:
   `project.record.delete` (Administrator, Planer). Mit Inhalt: `project.record.purge`
   (nur Administrator) und `confirm_project_number`. Abgeschlossen/archiviert: `409`.
2. **Wiedereröffnen** `completed → active`: `POST /projects/{id}/reopen`,
   `project.record.reopen` (nur Administrator); `archived` bleibt endgültig.
3. **Kunden löschen** physisch, nur Administrator, nur ohne Projekte (jeder Status, auch
   früher ausgeblendete). Anonymisierung entfernt (Route, Service, Recht, Spalte, Oberfläche).
   **Soft Delete für Kunden und Projekte abgeschafft:** `0006` entfernt beide `deleted_at`,
   löscht keine Zeile; früher Ausgeblendetes ist wieder sichtbar und unterliegt den neuen
   Regeln. Archivierung = ausschließlich Status `archived`.
4. **Löschschutz-Protokoll** `ProjectContentParticipant` über `ModuleDescriptor.provides`;
   Electrical-Teilnehmer; alles in einer Transaktion unter der Projektsperre.
5. **Storage:** `storage_cleanup_jobs` (vorgemerkt vor dem Löschen der Dateizeilen,
   gelöscht nach dem Commit, Fehler bleiben mit Zähler), CLI `storage-cleanup`.
6. **Bearbeiter:** `created_by`/`updated_by` an Kunden und Projekten; Core und Electrical
   „berühren" das Projekt ohne Versionssprung.
7. **Oberfläche:** laufende/historische Projektliste per URL, Löschdialoge (leer / mit
   Inhalt + Projektnummer), Wiedereröffnungs- und Kundenlöschdialog, Metadatenbereich,
   gekürztes Kundensuchfeld, Icon-System mit `lucide-react`.
8. **Tests:** 792 Backend (vorher 736, 0 übersprungen), 681 Frontend (vorher 653);
   Nebenläufigkeit Löschen gegen Upload, Raumanlage und Statuswechsel mit echtem
   PostgreSQL – ohne Sperre fallen 4 von 7 um.

**Abnahme:** API-Skript im frisch gebauten Compose-System 14/14; Browserabnahme im
Claude-Browserbereich (Löschen als Planer und Administrator, Projektnummer, historische
Ansicht, Zurück, Wiedereröffnung, Kundenlöschung, 420/360/320 px). Zwei Befunde dabei
behoben (Nachlade-404 nach Löschung, ASCII-Meldung). Browserzoom nicht aussagekräftig
geprüft. Details: `docs/task-history.md`, Task 0022.

**Task 0021 — Phase 4c.2: persönliche Darstellung** (ADR 0018 präzisiert,
[ADR 0019](decisions/0019-personal-display-preferences-local-storage.md))

1. **Einstellungen:** Darstellung (Wie das System, Hell, Dunkel), Akzentfarbe (ElektroPlan
   Blau – Standard, Türkis, Grün, Violett, Orange) und Maßeinheit. Alle drei wirken sofort
   als Vorschau und werden erst mit „Übernehmen" gespeichert; Abbrechen, Escape und ✕
   stellen den gespeicherten Stand her; „Auf Standard zurücksetzen" setzt den Entwurf auf
   System, Blau, cm.
2. **Speicherung:** `elektroplan.darstellung.<user_id>` =
   `{"version":1,"modus":…,"akzent":…}`, nur in diesem Browser. Ungültige Werte → Standard.
   Beim Laden und nach dem Abmelden gilt der Standard; Betriebswechsel behält die Wahl;
   andere Tabs desselben Benutzers ziehen über `storage` nach.
3. **Anwendung:** `core/theme/darstellung.ts` setzt `data-theme`, `data-theme-mode`,
   `data-accent` und `color-scheme` am Wurzelelement; Tokens reagieren darauf. Systemmodus
   folgt einem Wechsel des Betriebssystems zur Laufzeit.
4. **Kontraste:** Warnfarbe hell `#946000` (5,3 : 1), neuer Kontrollrahmen für
   Eingabefelder und Knöpfe (3,3 : 1 hell, 3,4 : 1 dunkel); alle Schemata AA.
5. **2D/3D:** Fachfarben akzentunabhängig, Auswahl im 2D-Editor im Akzent; die 3D-Szene
   liest `--ep-plan3d-*` und übernimmt Wechsel ohne neue Szene (höchstens ein Bild).
6. **Responsiv:** Benutzerblock, Kartenköpfe und Blätterleiste brechen um, Hauptbereich und
   Tabellenhüllen `min-w-0`/`max-w-full`.
7. 653 Frontendtests (vorher 622), kein Backend, keine API, keine Migration.

**Abnahme:** manuell durch den Auftraggeber geprüft und freigegeben. Eine automatisierte
Browserabnahme mit Bildschirmfotos fand nicht statt; die Dokumentbreiten bei
320/360/420 px wurden nicht automatisiert gemessen.

**Task 0020 — Phase 4c.1: Frontend auf Tailwind CSS, Theme-Grundlage**
([ADR 0018](decisions/0018-frontend-styling-tailwind-and-theme-tokens.md))

1. **Tailwind CSS 4.3.3** über `@tailwindcss/vite`, CSS-first (keine `tailwind.config.js`),
   **ohne Preflight**, Quellscan `src/` ohne Ausschlussliste für Utilities (Nachkorrektur:
   die zunächst eingeführte Liste ist entfernt). Docker-Entwicklung geprüft (Image neu gebaut, Linux-Binärdatei im
   Lockfile).
2. **Semantische Laufzeit-Tokens** `--ep-*` (`core/theme/tokens.css`), per `@theme inline`
   als `bg-surface`, `text-muted`, `border-line`, `bg-accent` … nutzbar; Tailwind-
   Standardpalette abgeschaltet; Werte 1:1 aus dem Bestand (hell und dunkel).
   Editor-Tokens `--ep-plan-*` im Electrical-Modul.
3. **Oberfläche vollständig migriert** (Shell, Core-Bausteine, Anmeldung, Kunden,
   Projekte, Dialoge, Combobox, Seiten, Verwaltung, Projektstruktur, Electrical-Räume,
   2D-Editor, 3D-Ansicht). Wiederkehrendes in typisierten Rezepten (`core/ui/stil.ts`),
   neuer Baustein `DialogAktionen`. Die globale `styles.css` (553 Zeilen, ~267
   Regelblöcke) ist ersetzt; Spezial-CSS nur noch `core/theme/basis.css` und
   `modules/electrical/editor/grundriss.css` (SVG-Zeichenfläche).
4. **Erscheinungsbild unverändert**, nachgewiesen durch einen Vergleich der berechneten
   Stile und Positionen aller sichtbaren Elemente vor/nach (19 Seiten und Zustände, 33
   Vergleiche). Ein dabei gefundener Migrationsfehler (Fettschrift der aktiven Seitenzahl)
   ist behoben.
5. Keine Backend-, API-, Migrations- oder Verhaltensänderung; 622 Frontendtests grün.

**Abnahme:** Die automatisierte Sichtprüfung war nur teilweise möglich (Browserbereich
verdeckt); die abschließende Sichtprüfung hat der Auftraggeber vorgenommen und ohne
Befund bestätigt.

**Task 0019 — Bedienungsnacharbeit 2 / Phase 4b.2** (Punkt 9 der Abnahme nach 4b)

1. **Exakte Teilwandtopologie** als reine, gemeinsame Schicht für 2D und 3D
   (`modules/electrical/topologie/`): exakt kollineare Wände verschiedener Räume werden an
   allen Endpunkten in atomare Abschnitte zerlegt – ganzzahlig, ohne Toleranz, auch schräg.
   Warum: Im realen Grundriss aus 4a waren nur 4 Paare deckungsgleich, 7 nur teilweise.
2. **Eine Öffnung, keine Dublette** (ADR 0016 präzisiert): genau eine Zeile an der
   Eigentümerwand; liegt sie ganz in einem gemeinsamen Abschnitt, verbindet sie
   **abgeleitet** beide Räume. Keine Paar-ID, keine Migration, keine Backendänderung.
   Mehrdeutige Lagen (Grenze zweier Nachbarn, nur teilweise, > 2 Räume, Widerspruch) werden
   als Konflikt gezeigt, nie geraten. Vorhandene beidseitige Dubletten bleiben unverändert
   und werden gemeldet.
3. **3D:** ein Körper je Abschnitt, keine doppelten Wandkörper mehr (realer Grundriss:
   23 Körper, 0 Hinweise), stumpfe Stöße ohne Flimmern, eine gespeicherte Tür schneidet den
   gemeinsamen Körper.
4. **2D:** Tür per Maus setzen (Vorschau mit verbundenen Räumen, 5-cm-Fang, im Abschnitt
   unter dem Zeiger, Kollisionen inkl. Gegenseite) und entlang der Wand ziehen (Escape,
   Pointer Capture); gemeinsame Öffnungen einmal gezeichnet, im Nachbarraum abgeleitet.
   Numerische Bearbeitung unverändert.
5. **Maßeinheit je Benutzer** statt je Browser (einmalige Übernahme des alten Schlüssels).
6. **`.claude/launch.json`** als Werkzeugartefakt entfernt.

Details, Messwerte und Browserabnahme: `docs/task-history.md`, Task 0019.

**Task 0018 — Bedienungsnacharbeit 1** (Punkte 1–8 und 10–11 der Abnahme nach 4b)

1. **Nummerierte Seiten** für Kunden- und Projektlisten (`page`, `page_size`,
   `total_items`, `total_pages`; [ADR 0017](decisions/0017-numbered-pages-for-customer-and-project-lists.md)).
   Zählung über dieselbe gefilterte, mandantenbeschränkte Abfrage; Seite außerhalb →
   letzte Seite. Offset-Verschiebung bei gleichzeitigen Änderungen ist akzeptiert.
   Audit und Benutzerverwaltung bleiben beim Cursor. „Weitere laden" entfernt.
2. **Kundenfilter** in der Projektübersicht, getrennt von der Projektsuche (die den
   Kundennamen nicht mehr durchsucht); **Projekte dieses Kunden** auf der Kundenseite mit
   `status_group=current|closed`.
3. **Projektformular:** Adressvorschlag aus der Kundenadresse (gekennzeichnet, manuelle
   Eingaben geschützt, „Kundenadresse übernehmen"), sichtbarer **Ländercode**, schwebende
   Kundenvorschläge ohne Höhensprung, **genau ein Dialog-Scrollbereich**, Gebäude/Geschoss
   oben bündig (`.feldzeile`).
4. **Persönliche Maßeinheit:** Standard cm, wahlweise mm, unter „Einstellungen", lokal im
   Browser, sofort wirksam in Formularen, Tabellen, 2D und 3D. Gespeichert, übertragen
   und gerechnet wird **unverändert in ganzen Millimetern**; umgerechnet wird nur in
   `core/masse.ts`.
5. **Eigener Bestätigungsdialog** (`core/ui/Rueckfrage.tsx`) für alle anwendungsinternen
   Wechsel mit ungespeicherten Änderungen, auch mit dem Router-Blocker. **Ausnahme:**
   `beforeunload` (Neuladen, Tab schließen, Website verlassen) bleibt browsernativ –
   Browser lassen dort keinen eigenen Dialog zu.
6. „Ansicht einpassen" heißt in 2D und 3D **„Ansicht zurücksetzen"**.
7. Keine Migration; Phase-4b-Dateien erhalten (Abweichungen nur an den beauftragten
   Stellen). Punkt 9 (Tür/Teilwand) **nicht begonnen**.

Details und Browserabnahme: `docs/task-history.md`, Task 0018.

**Task 0017 — Phase 4b: abgeleitete 3D-Ansicht des Grundrisses**

1. **Drei Ansichten** im Tab „Räume & Grundriss": „2D-Editor", „3D-Ansicht", „Tabellen &
   Details" auf demselben Serverstand. Die 2D-Ansicht bleibt die einzige Autorenfläche;
   die 3D-Ansicht ist abgeleitet und schreibgeschützt.
2. **T8/T9 entschieden (ADR 0016):** Wandhöhe = effektive Raumhöhe, kein Wandtyp,
   „gemeinsam/außen" nur abgeleitet; deckungsgleiche Wände werden nur in der Darstellung
   gruppiert, nur bei exakt gleichen ganzzahligen Endpunkten. Keine Migration.
3. **Three.js 0.186.1** direkt, gekapselt in `modules/electrical/ansicht3d/`, lazy
   nachgeladen (eigener Chunk); kein React Three Fiber, keine CSG, kein
   `packages/3d-engine`.
4. **Reine Aufbereitung** (Transformation, Gruppierung, Wandzerlegung, Szenenmodell) ohne
   DOM/WebGL/React; **imperative Szenenschicht** mit injizierbarer Umgebung und
   vollständigem `entsorgen()`; Rendern nur auf Anforderung.
5. **Konflikte sichtbar:** einseitige oder widersprüchliche Öffnungen, abweichende Art,
   Stärke oder Höhe, Mehrfachwände, teilweise Überlagerungen — als verständliche Hinweise
   mit Darstellungsregel.
6. Backend, API, OpenAPI und Datenmodell **unverändert**.

Details: `docs/task-history.md`, Task 0017.

## 2a. Abnahme von Phase 4b — Ergebnis

| Bereich | Nachweis |
|---|---|
| Exit „Grundriss aus 4a in 3D navigierbar" | EFH aus dem Messlauf 4a (`PR-2026-0006`, 7 Räume, 30 Wände, 15 Öffnungen) im Browser mit echtem WebGL 2 dargestellt, gedreht, gezoomt |
| Exit „Szene und React-State entkoppelt" | Test: 40 Bilder Kamerabewegung, 0 React-Commits; Szene einmal je Mount; im Browser nach 10 Wechseln 2D ↔ 3D stets genau 1 Canvas und 0 Bildanforderungen im Ruhezustand |
| Automatisiert | 441 Frontendtests (vorher 319), davon 122 neu für 4b; 707 Backendtests unverändert grün |
| Browser (25 Punkte) | alle durchlaufen, siehe `docs/task-history.md`, Task 0017 |

**Ehrliche Einordnung:** Mit echtem WebGL geprüft wurde in einem einzigen Browser
(Chromium 152 im Browserbereich der Claude-Desktop-App, ANGLE/D3D11, NVIDIA RTX 3060).
Kein Touchgerät, kein Firefox/Safari, kein Mensch am Gerät. Der WebGL-Fallback und der
Kontextverlust sind nur automatisiert geprüft (im Browser nicht auslösbar). Maus-Pan
wurde über ein erzeugtes Umschalt+Ziehen (`PointerEvent`) und über die Pfeiltasten
geprüft; das Werkzeug überträgt beim Ziehen keine Modifier.

**Task 0016 — Phase 4.2: Benutzerverwaltung, Rollenvergabe und Startseite**

1. **Administration** im Plattformmodul: Benutzerliste (Mitglieder und offene
   Einladungen, Suche, Statusfilter, Vor/Zurück), Mitgliedsdetail (Zugang zum Betrieb
   sperren/freigeben, feste Systemrollen vergeben, effektive Rechte mit Herkunft),
   Rollenübersicht, Systeminformationen. Jede Route an ihr Leserecht gebunden.
2. **Einladungen** (ADR 0015): Token 256 Bit, nur als Hash, befristet, einmalig,
   widerrufbar, neu ausstellbar; Annahme für neue **und** bestehende Konten, ohne je ein
   bestehendes Konto zu verändern. Kein E-Mail-Versand: in der Entwicklung einmaliger
   Link (markiert), in Produktion verboten, ohne Zustellweg `503`.
3. **Letzter Administrator** unter Parallelität geschützt: Organisationszeile als
   Sperrwurzel, Handelnder wird unter der Sperre erneut geprüft. Selbstsperre und
   Entfernen der eigenen Adminrolle ausgeschlossen.
4. **Sofortige Wirkung:** Sperre widerruft Refresh Tokens nur dieser Mitgliedschaft;
   Refresh einer gesperrten Mitgliedschaft `401`.
5. **Startseite** arbeitsorientiert; Modulversionen jetzt unter Systeminformationen.
6. Migration **`0005_member_administration`**.

Details: `docs/task-history.md`, Task 0016.

**Task 0015 — Phase 4a.1: Navigationsschutz und Testdatenbank-Sicherheit**

1. **Browser-Zurück und -Vorwärts sind geschützt.** Die Anwendung läuft auf dem Data
   Router (`createBrowserRouter`, eine Splat-Route, darunter weiter die dynamischen
   Modulrouten). Der fachneutrale `Navigationsschutz` (`useBlocker`) hält jede
   Navigation innerhalb der Anwendung an, solange ein Modul ungespeicherte Änderungen
   meldet, und fragt genau einmal. Der frühere globale Link-Klick-Handler ist entfernt.
   Neuladen und Schließen: weiter `beforeunload`. Projekt-Tabs und Abmelden: weiter
   `verlassenBestaetigen`.
2. **Testdatenbank technisch abgesichert** (`tests/datenbankschutz.py`): Abbruch vor
   jeder Schemaänderung, wenn die Test-URL auf die Entwicklungsdatenbank zeigt oder
   die Datenbank nicht ausdrücklich als Testdatenbank benannt ist; Meldungen ohne
   Zugangsdaten. `CLAUDE.md` korrigiert.
3. **Offene Entscheidung T9** (deckungsgleiche Wände benachbarter Räume) verbindlich vor
   Phase 4b festgehalten. Keine Datenmodelländerung, keine Migration.

Details: `docs/task-history.md`, Task 0015.

**Task 0014 — Phase 4a: Grafischer 2D-Editor**

1. **Grafischer Grundrisseditor** im Tab „Räume & Grundriss" (SVG, ohne neue
   Abhängigkeit, ADR 0014): Rechteck- und Polygonräume, Eckpunkte ziehen, Wände
   bearbeiten, Türen/Fenster/Durchgänge platzieren und verschieben, Raster und Fang,
   Maße, Zoom/Pan/Einpassen, Undo/Redo, bewusstes Speichern. Die Tabellenansicht aus
   Phase 3 bleibt als zweite Ansicht auf demselben Serverstand.
2. **Zwei neue Endpunkte**: `GET /floors/{id}/plan` (ohne N+1) und
   `PUT /rooms/{id}/contour` (Raumgeometrie atomar, Zielzustand als Ganzes geprüft,
   genau ein Event). `POST …/rooms` nimmt optional die Wände.
3. **Raumversion = Version der Raumgeometrie** — Formular und Editor können sich nicht
   mehr still überschreiben.
4. **Nie stilles Verwerfen**: Raumwechsel bietet „speichern und wechseln", Geschoss- und
   Ansichtswechsel fragen, Browser warnt beim Verlassen.
5. **Exit-Kriterium gemessen**: 7 Räume, 30 Wände, 15 Öffnungen in 126,7 s
   (automatisierter Durchlauf). 200 Segmente bleiben bedienbar.
6. Keine Migration.

Details: `docs/task-history.md`, Task 0014.

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

> **Abgelöst durch Phase 4d ([ADR 0020](decisions/0020-data-lifecycle-deletion-and-reopen.md)):**
> Soft Delete für Kunden und Projekte ist abgeschafft; `customers.deleted_at` und
> `projects.deleted_at` sind mit Migration `0006` entfernt. Archivierung erfolgt
> ausschließlich über den Projektstatus `archived`. Archivierte Projekte bleiben
> endgültig bestehen und verhindern daher weiterhin die physische Löschung des
> zugehörigen Kunden.
> Die damalige Ausnahme „archiviertes Projekt ausblenden“ gibt es deshalb nicht mehr;
> `DELETE /projects/{id}` antwortet für archivierte Projekte mit `409`. Eine
> Wiederherstellung aus `archived` gibt es weiterhin nicht.

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

> Zeilen 2 und 3 beschreiben den damaligen Stand. Seit Phase 4d gibt es weder
> Ausblenden noch Anonymisierung; die Kundenzeilensperre schützt jetzt die physische
> Kundenlöschung gegen die Projektanlage (ADR 0020).

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
   *(Abgelöst in Phase 4d durch die physische Kundenlöschung, ADR 0020.)*
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

## 3. Abnahme von Phase 4a — Ergebnis

| Kriterium | Nachweis |
|---|---|
| Einfamilienhausgeschoss mit 6–8 Räumen in unter 20 Minuten | 7 Räume (davon ein Polygon-Flur in L-Form), 30 Wände, 7 Türen, 8 Fenster, 103,25 m² in **126,7 s** über die Oberfläche; danach über die API geprüft: alle Konturen `valid` |
| Browser-Smoke-Test (20 Schritte) | vollständig durchlaufen, inklusive 422 mit Markierung, Versionskonflikt über zweiten Zugriff, archiviertes Projekt, Abmelden |
| 200 Segmente | Eckpunkt ziehen Median 5 ms, Zoom Median 23 ms je Schritt (Entwicklungsbuild) |

**Ehrliche Einordnung:** Der Messlauf war **automatisiert** — Klickpunkte wurden aus der
Viewport-Transformation berechnet. Er belegt die technische Erfassbarkeit mit wenigen
Aktionen, nicht die Dauer für einen Menschen. Ein Usability-Test steht aus.

---

## 3a. Abnahme von Phase 3 — Ergebnis

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
ausblenden (`409`). *(Damaliger Stand – Anonymisierung und Ausblenden sind seit Phase 4d
durch die physische Löschung ersetzt.)*

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

Stand nach Task 0019 (Phase 4b.2): **736 Backendtests, 0 übersprungen** (unverändert, keine
Backendänderung), **622 Frontendtests** (vorher 536), weiterhin nur Alembic-Head `0005`,
keine neue Migration, kein API-Drift. Stand nach Task 0018 (Bedienungsnacharbeit 1): 736
Backendtests (vorher 707), 536 Frontendtests (vorher 441). Davor, nach Task 0017 (Phase 4b), ein Lauf von `tasks.ps1 check` gegen echtes
PostgreSQL 17 (`elektroplan_test`) und MinIO — alle Schranken grün: **707
Backendtests, 0 übersprungen**, **441 Frontendtests** (Phase 4.2: 319), genau ein
Alembic-Head (`0005_member_administration`, keine neue Migration), mypy 93 Dateien,
import-linter 4 Contracts / 0 verletzt, kein API-Drift, Build grün. Die Tabelle unten
nennt den Stand nach Phase 3.

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
- **Endgültiges Löschen** von Kunden (nur Administrator, nur ohne Projekte) und Projekten
  (leer: Bearbeiter; mit Inhalt: Administrator mit Projektnummer), **Wiedereröffnung**
  abgeschlossener Projekte, Löschschutz-Protokoll und Storage-Aufräumwarteschlange
  (Phase 4d, ADR 0020). Die Anonymisierung aus Phase 2 ist entfallen.
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
| Kunde löschen gegen Projekt anlegen (bis 4d: ausblenden) | Paralleltest prüft den Datenbankzustand; die verbotene Kombination kann nicht entstehen |
| Kundenzeile wird wirklich gesperrt | mitgeschriebenes SQL belegt `SELECT … FOR UPDATE` bei Anlage, Neuzuordnung und Löschung |
| ~~Anonymisierter Kunde für neue Zuordnungen gesperrt~~ (entfallen mit Phase 4d) | Tests für Anlage und Umhängen; bestehendes Projekt bleibt lesbar, Liste zeigt nur den Platzhalter |
| Parallele Geschossebene | Paralleltest plus threadfreier Test des Index-Pfads; genau ein Datensatz in der Datenbank |
| `If-Match`-Syntax | 35 parametrisierte Fälle |
| Nummernvergabe nebenläufigkeitssicher | Test mit zwei echten Threads und Barrier: zwei verschiedene Nummern |
| Optimistisches Sperren | Tests für fehlenden Header (`428`), veraltete Version (`409`) und ETag-Schreibweise |
| ~~Anonymisierung nach Art. 17 DSGVO~~ (ersetzt durch physische Löschung, Phase 4d) | Felder in der Datenbank geprüft; Protokoll enthält die gelöschten Werte nachweislich nicht; Berechtigung liegt nur beim Administrator |
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
| `packages/ui`, `packages/3d-engine` | erst bei zweitem Consumer (Three.js hat seit Phase 4b genau einen: `electrical/ansicht3d`) |
| Freier Rolleneditor, einzelne Berechtigungen vergeben | offen, frühestens nach dem Pilot (Benutzerverwaltung mit festen Rollen seit Phase 4.2) |
| E-Mail-Versand für Einladungen, Passwortwiederherstellung | vor Produktivbetrieb; bis dahin sind Einladungen in Produktion abgeschaltet |
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
| Editor-Entwurf umfasst genau einen Raum | Raumwechsel verlangt Speichern; kein geschossweites Speichern | wenn der Messlauf mit Menschen es als Bremse zeigt |
| Öffnungen können nicht an eine andere Wand umziehen | entfernen und neu setzen | bei Bedarf |
| Performance nur im Entwicklungsbuild und in einem Browser gemessen | Zahlen sind konservativ, aber nicht allgemein | bei Bedarf mit Produktionsbuild wiederholen (die 3D-Ansicht ist seit Phase 4b auch im Produktionsbuild gemessen, ein Rechner, ein Browser) |
| ~~3D: teilweise überlappende Wände werden nicht zusammengeführt~~ | **Behoben in 4b.2:** exakte atomare Abschnitte, realer Grundriss ohne doppelte Körper | — |
| Nachbarschaft von Öffnungen ist nur abgeleitet (4b.2) | Leitungsrouting und Materialermittlung dürfen sich nicht darauf stützen; vorhandene beidseitige Dubletten werden nur gemeldet, kein Bereinigungswerkzeug | mit T10 vor Phase 6 |
| 3D-Abnahme 4b.2 nicht visuell | Browserbereich war verborgen – WebGL-Bild und 3D-Auswahl der gemeinsamen Tür nur automatisiert und über Texte/Zahlen geprüft | bei der Abnahme durch den Auftraggeber |
| ~~Kontrast der hellen Warnfarbe und der Rahmen~~ | **Behoben in 4c.2:** Warnung 5,3 : 1, Kontrollrahmen 3,3/3,4 : 1 | — |
| ~~3D-Szene folgt den Theme-Tokens nicht~~ | **Behoben in 4c.2:** Farben aus `--ep-plan3d-*`, Wechsel über `darstellungAbonnieren` | — |
| ~~Waagrechte Überbreite bei schmalen Fenstern~~ | **Behoben in 4c.2** und manuell abgenommen: Kopfzeile bricht um; Tabellenhüllen, Kartenköpfe und Blätterleiste begrenzt. Die Dokumentbreiten bei 320/360/420 px wurden nicht automatisiert gemessen | — |
| 4c.2 ohne automatisierte Browserabnahme | Browserbereich war nicht erreichbar; Abnahme manuell durch den Auftraggeber. Keine Bildschirmfotos, keine automatisierte Breitenmessung | bei der nächsten Browserabnahme mitprüfen (kein Blocker) |
| Kurzes Standard-Theme beim Laden | Vor der Sitzungsprüfung gilt „Wie das System", Blau; eine abweichende Wahl erscheint erst nach der Anmeldung (ADR 0019) | bewusst so |
| 3D-Szene erst nach dem Laden des Electrical-Chunks eingefärbt | Die 3D-Tokens liegen im Electrical-CSS-Chunk, der vor der 3D-Ansicht geladen wird; fehlt ein Token, gilt der helle Standard | nur bei Umbau der Chunks |
| `hover:` nur auf Geräten mit Zeigerhover | Tailwind 4 kapselt Hover in `@media (hover: hover)`; auf Touch entfällt der Hover-Zustand (vorher klebte er nach Antippen) | keine Absicht, das zu ändern |
| 3D: Ecken bei nicht rechtwinkligen Wänden | Eckschluss über Verlängerung um halbe Stärke; bei spitzen/stumpfen Winkeln kleine Überstände | nur bei Bedarf (reine Darstellung) |
| 3D: WebGL-Fallback und Kontextverlust nur automatisiert geprüft | im verwendeten Browser nicht auslösbar | bei einem Browser ohne WebGL nachprüfen |
| 3D: Chunk der 3D-Ansicht ≈ 588 kB (≈ 152 kB gzip) | lazy geladen, Haupt-Bundle unberührt; `chunkSizeWarningLimit` auf 650 kB gesetzt | bei Bedarf Three.js-Teilimporte prüfen |
| Vite im Planner-Container bemerkt Dateiänderungen unter Windows nicht | nach Frontend-Änderungen `docker restart elektroplan-planner` | Polling (`server.watch.usePolling`) prüfen |
| Anmeldung mit ausschließlich gesperrter Mitgliedschaft antwortet `404` „Keine aktive Mitgliedschaft in diesem Betrieb“ | Bestand seit Phase 1; verrät nach richtigem Passwort, dass das Konto existiert. Kein Sicherheitsverlust gegenüber vorher | bei der Überarbeitung der Anmeldung (Phase 4.2 hat den Refresh, nicht den Login angepasst) |
| `purge-invitations` ist ein Werkzeug, kein geplanter Job | Abgeschlossene Einladungen bleiben bis zum manuellen Lauf gespeichert | mit dem ersten Betriebs-Scheduler |
| Benutzerliste sortiert mit Datenbank-Collation `C` | Namen mit Umlaut am Anfang stehen hinter „Z“ | bei Bedarf ICU-Collation |
| Rechtebeschreibung der Elektroplanung in ASCII („Raeume, Waende") | kosmetisch, Teil der bekannten ASCII-Schuld | mit der Entscheidung zur Schreibweise der Servermeldungen |
| `organization.member.read`/`write` ohne Verwendung | Planer und Kalkulator haben „Kollegen ansehen“, es gibt dafür noch keine Ansicht | wenn eine Mitarbeiterauswahl (z. B. Monteur für einen Auftrag) gebraucht wird |
| Die Projektsperre serialisiert **alle** Schreibvorgänge eines Projekts | Im Baualltag (ein bis zwei Bearbeiter je Projekt) unkritisch; nicht gemessen | wenn mehrere Personen gleichzeitig an einem Projekt arbeiten |
| Offset-Seiten bei Kunden und Projekten (ADR 0017) | Ändert sich die Liste zwischen zwei Seitenaufrufen, verschiebt sich ein Eintrag um eine Position; `COUNT` je Seite nicht gemessen | bei Bedarf (Export/Sync bleiben Cursor-Sache) |
| Nativer `beforeunload`-Dialog im Browser nicht visuell bestätigt | Handler nachweislich aktiv (Test, Konsole: Chromium blockiert ihn ohne Benutzergeste); der Browserdialog erscheint nicht im Screenshot | bei einer Abnahme mit Mensch am Gerät |
| ~~Anonymisieren fragt noch per `window.confirm`~~ | **Erledigt in 4d:** Anonymisierung entfallen, alle Lösch- und Statusdialoge nutzen `Bestaetigung` | — |
| `storage_cleanup_jobs` wird nicht zeitgesteuert abgearbeitet (4d) | fehlgeschlagene Storage-Löschungen bleiben bis zum CLI-Lauf stehen | mit dem ersten Betriebs-Scheduler |
| Verwaiste Objekte aus fehlgeschlagenem Upload-Commit laufen noch nicht über `storage_cleanup_jobs` (4d) | weiterhin nur Log `orphan_object_cleanup_failed` | Upload-Pfad bei Gelegenheit an die Warteschlange anschließen |
| Servermeldungen in ASCII-Umschrift | Die Oberfläche zeigt für Lösch-Sperrgründe eigene deutsche Texte (4d), Meldungen wie `customer-has-projects` erscheinen weiter in Umschrift | mit der Entscheidung zur Schreibweise der Servermeldungen |
| `lint-imports` lokal durch Windows-Anwendungssteuerung blockiert (4d) | die native `grimp`-DLL darf nicht laden; import-linter lief deshalb in einem Wegwerf-Container | Ausnahme für `.venv` oder Lauf in CI |
| Ein Datei-Upload kann nach vollständiger Übertragung noch mit `409` scheitern | Bewusster Tausch: Die Sperre wird nicht über die Übertragung gehalten. Das Objekt wird verworfen | keine Absicht, das zu ändern |

### Offene fachliche Entscheidungen

| # | Frage | Spätestens vor |
|---|---|---|
| T6 | **Projektarten** (Neubau, Sanierung, Service): Braucht es sie, und was unterscheidet sie? Bis dahin deckt die abwählbare Startstruktur den Serviceauftrag ab | vor Phase 8 |
| T1 | Symbolbibliothek: eigene SVGs oder DIN EN 60617 (Phase 4a platziert keine Geräte) | Phase 5 |
| T7 | **Raumtyp** (`living`, `kitchen`, …): Wird er für Ausstattungsvorlagen gebraucht, und mit welcher Werteliste? In Phase 3 bewusst nicht angelegt | vor Phase 5 |
| T10 | **Physische Wandidentität** (Neubewertung aus ADR 0016): Brauchen Leitungsrouting und Materialermittlung eine persistente Wand, auf die sich beide Raumseiten beziehen (Querungen, keine Doppelzählung, einseitig erfasste Öffnungen, teilweise überlappende Wände)? | vor Phase 6 |

**Entschieden in Phase 4b** ([ADR 0016](decisions/0016-derived-3d-view-wall-height-and-coincident-walls.md)):
~~T8 Wandhöhe und Wandtyp~~ — effektive Raumhöhe gilt für alle Wände, kein Wandtyp,
„gemeinsam/außen" nur abgeleitet. ~~T9 Deckungsgleiche Wände~~ — nur in der Darstellung
gruppiert, nur bei exakt gleichen Endpunkten, keine Migration.
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
| 5 | Löschung | **umgesetzt und getestet** – seit Phase 4d physische Löschung aus der operativen Datenbank; Backups behalten Daten bis zum Fristablauf |
| 6 | Aufbewahrungspflichten | offen (Festlegung je Dokumentart) |
| 7 | Trennung löschbar / aufbewahrungspflichtig | teilweise: für `customers` entschieden, für spätere Belegtabellen offen |
| 8 | Backup- und Restore-Wirkung auf Löschungen | offen |
| 9 | Protokoll- und Audit-Aufbewahrung | offen (Frist festgelegt, Umsetzung fehlt) |
| 10 | AV-Verträge | offen |
| 11 | Verarbeitungsverzeichnis | offen |
| 12 | TOM-Dokumentation | offen |

**Bis alle zwölf Punkte erfüllt sind gilt: ausschließlich synthetische Testdaten.**
Das gilt seit Phase 4.2 ausdrücklich auch für **Benutzer und Einladungen** (Mitarbeiter
sind betroffene Personen). Zweck, Aufbewahrung und offene Punkte: `docs/security.md`,
Abschnitt 13 „Benutzerverwaltung“ und Abschnitt 18.

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

**Nach Phase 4d (Stand 2026-10-01):** Phase 4d ist abgeschlossen und mit diesem Checkpoint
committet (nicht gepusht). Nach dem Aktualisieren anderer Umgebungen: Migration `0006`,
dann Seed. Phase 5 ist **nicht begonnen** und erst nach ausdrücklicher Freigabe.

**Nach Phase 4c.2 (Stand 2026-09-30):** Phase 4c.2 ist abgenommen und mit diesem
Checkpoint committet (nicht gepusht). Phase 5 ist **nicht begonnen** und erst nach
ausdrücklicher Freigabe.

Phase 4b, 4b.1 (Bedienungsnacharbeit 1) und 4b.2 (Bedienungsnacharbeit 2) sind umgesetzt und
mit einem gemeinsamen Checkpoint-Commit committet (nicht gepusht). Phase 5 ist **nicht begonnen**.
Weiteres Vorgehen:

1. **Visuelle Abnahme** der 3D-Ansicht mit sichtbarem Browserfenster (gemeinsame Türen in
   Teilwänden) durch den Auftraggeber – funktional und automatisiert bereits geprüft.
2. ~~Wände an gemeinsamen Eckpunkten teilen~~ – mit 4b.2 nicht mehr nötig: Teilüberlappungen
   werden exakt erkannt.
3. **Phase 5** (Electrical Devices) erst nach ausdrücklicher Freigabe; offen davor T1
   (Symbolbibliothek) und T7 (Raumtyp). T10 (physische Wandidentität) vor Phase 6.

> Phase 5 wird erst nach ausdrücklicher Freigabe begonnen.

---

## 10. Hinweise für die nächste Session

1. Zuerst `CLAUDE.md`, dieses Dokument und `docs/roadmap.md` lesen.
2. Umgebung: `.\tasks.ps1 install` (installiert aus `uv.lock` und `package-lock.json`),
   dann `docker compose up -d` und `.\tasks.ps1 check`.
3. Für Datenbanktests `ELEKTROPLAN_TEST_DATABASE_URL` setzen — sonst überspringen sie
   sichtbar. **Auf `…/elektroplan_test` zeigen lassen**, nie auf die
   Entwicklungsdatenbank: Die Tests führen `drop_all` aus. Seit Phase 4a.1 bricht der
   Lauf in diesem Fall selbst ab (`tests/datenbankschutz.py`).
3a. Nach Frontend-Änderungen den Planner-Container neu starten
   (`docker restart elektroplan-planner`); Vite bemerkt die Änderungen über den
   Windows-Mount nicht. Nach Änderungen an `package.json` oder `vite.config.ts` das Image
   neu bauen (`docker compose build planner`). Läuft zusätzlich ein lokaler Vite auf 5173,
   bedient er `localhost` über IPv6, der Container `127.0.0.1`.
3b. Oberfläche mit Tailwind: Farben nur über semantische Tokens, Rezepte aus
   `core/ui/stil.ts`, Klassen vollständig im Quelltext (ADR 0018,
   `docs/architecture.md` Abschnitt 13). Keine eigene Hell/Dunkel-Abfrage in Komponenten –
   Farbschema und Akzent setzt allein `core/theme/darstellung.ts` (ADR 0019).
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
