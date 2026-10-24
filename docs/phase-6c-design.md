# Phase 6c – Entwurf: Bedienungsüberarbeitung, zentrale Planungsvorgaben und Verteilungsplanung

**Status:** **3. Fassung (2026-10-16): Planungslayout und Leitungsablauf überarbeitet (§18); F6–F8 entschieden. L1 Planungslayout umgesetzt und am 2026-10-22 nachgearbeitet (§19.9: schmale Werkzeugleiste, gesperrte Knöpfe, Decke und 3D-Rückkehr im Browser) – **technisch geprüft** (2026-10-22, nach Senkung der Mehrkosten §19.9.6: regulärer Frontend-Gesamtlauf grün: 1 188/1 188 Tests in 55 s (Projekteinstellungen, allein, Last 26 %); die früher kritischen langen Tests 1,3–3,8 s); **L1 als Checkpoint `331bfbd` committet (2026-10-23)**, persönliche Layoutabnahme offen. **V1 Vorgaben-Backend technisch umgesetzt und geprüft (2026-10-23, §20), als Checkpoint `39386c4` committet (Task 0059).** **L2/L3 (Zeichenablauf, Abschlussdialog, Verwaltung der Vorgaben) technisch umgesetzt, automatisiert und im laufenden Stack funktional geprüft (2026-10-24, §21), Bedienungslücken aus §21.5 nachgearbeitet (§21.6), Höhe der Arbeitsfläche (§21.7); als Checkpoint committet (Task 0062); persönliche Abnahme offen.**** 6c.0 ist **überarbeitungsbedürftig und nicht abgenommen**; 6c.1–6c.8 zurückgestellt; neue Reihenfolge L1 → V1 → L2/L3 → P (§18.7, F6–F8 entschieden). Vorher: **2. Fassung (2026-10-15)** – Entscheidungen **F1–F5 vom Auftraggeber getroffen** (§14; F1 abweichend
von der Empfehlung, F2–F5 bestätigt). **6c.0 zur Umsetzung freigegeben** – **6c.0 technisch umgesetzt, automatisiert und im laufenden Stack funktional und optisch geprüft** (§17.5; nicht committet, manuelle Abnahme durch den Auftraggeber offen); alle übrigen
Schritte bleiben bis zu ihrer jeweiligen Freigabe unangetastet. ADR 0027–0029 weiterhin *proposed*.
**Einordnung:** eingeschobene Phase **vor Phase 7**. Phase 7 bleibt zurückgestellt, bis 6c bearbeitet ist.
**Grundlage:** Checkpoint `62a1cc9` (6b.5) und der **uncommittete** Arbeitsstand 6b.6 (§1.1);
[ADR 0021](decisions/0021-user-lifecycle-account-locks-password-reset-preferences.md),
[ADR 0026](decisions/0026-circuits-cables-and-cable-paths.md), [`phase-6b-design.md`](phase-6b-design.md),
[`phase-6-pruefliste.md`](phase-6-pruefliste.md).
**ADR-Entwürfe (proposed):**
[ADR 0027 – Planungsvorgaben, Kabelvorlagen und Leitungsreserve](decisions/0027-planning-defaults-cable-templates-and-reserve.md),
[ADR 0028 – Lage und Aufbau einer Verteilung](decisions/0028-distribution-board-placement-and-layout.md),
[ADR 0029 – Modulbezogene persönliche Anzeigeeinstellungen](decisions/0029-module-display-preference-flags.md).

> Dieser Entwurf beschreibt, **was** gebaut werden soll und **warum**. Alle Beispiele sind synthetisch.
> ElektroPlan übernimmt vom Betrieb hinterlegte technische Vorgaben, rechnet und dokumentiert; es
> dimensioniert keine Anlage, prüft keine Norm und bescheinigt keine Konformität
> ([`security.md`](security.md) §17). Die Wünsche des Auftraggebers sind **keine** Abnahme von Phase 6;
> die manuelle Gesamtprüfung nach der Prüfliste bleibt offen.

---

## 0. Kurzfassung

| Thema | Empfehlung |
|---|---|
| Dialogrichtlinie | Anlegen/Bearbeiten von Stammdaten und Einstellungen **immer im Dialog** (`core/ui/Dialog`, ein Scrollbereich, angeheftete Aktionen); grafische Arbeit auf der Zeichenfläche mit **Kontextleiste** statt wachsender Seitenformulare; konkret sechs bestehende Abläufe umstellen (§3.3) |
| Arbeitsfläche | eine gemeinsame **Planungsarbeitsfläche** für Grundriss, Wand- und Deckenansicht: Eigenschaften standardmäßig eingeklappt, aufgeklappt 280–340 px, Maximieren (M), schmal als Überlagerung; Layoutwechsel nur per CSS am **selben** Element – Viewport, Auswahl und Entwurf bleiben (§4) |
| Undo/Redo | `Undo2`/`Redo2` aus `lucide-react` über einen neuen `SymbolKnopf` mit Namen, Tooltip, `aria-keyshortcuts`, erkennbarem Sperrzustand (§4.6) |
| 3D „Leitungen anzeigen“ | eigener Schalter; nur Darstellung und Treffer; Auswahl einer Leitung wird beim Ausblenden ausdrücklich aufgehoben; persönlich gespeichert über die **bestehende** `/me/preferences`-Ressource mit modulbezogenen, typisierten Schaltern (ADR 0029) (§5) |
| Verteilung platzieren | „Im Plan platzieren“ / „Im Plan zeigen“ / „Position ändern“; **ein** Endpunkt `PUT /distribution-boards/{id}/placement` legt Lagegerät und Verknüpfung **atomar** an; das Lagegerät „Verteilung“ entsteht nur noch über diesen Ablauf (§6, ADR 0028) |
| Leitungsablauf | „Neue Leitung“ → Startgerät → Verlauf → Zielgerät (oder Doppelklick) → **Abschlussdialog** mit vorbelegten Angaben und Herkunft → „Leitung speichern“; Stromkreis aus Zuordnungen abgeleitet, Konflikte als ausdrückliche Entscheidung; Endgerät darf fehlen (§7) |
| Vorgaben | **Betriebsstandard → Projektvorgabe → Leitung**, technische **Kabelvorlagen**, Vorlage je Gerätetyp **vor** einer nur ausdrücklich aktivierten Stromkreisvorgabe (F1), Reserve in **Prozent der geometrischen Länge** (aufgerundet auf ganze mm), feste Anschlusszugaben je Endpunktart; keine Laufzeitvererbung; zentrale Anwendung nur ausdrücklich mit Vorschau, atomar (§8, ADR 0027) |
| Verteilungsaufbau | Reihen mit Teilungseinheiten (TE), Komponenten (Hauptschalter, FI, LS, FI/LS, Überspannungsschutz, Klemme, Sonstiges) an festen Plätzen, Zuordnung LS → Stromkreis, FI-Gruppen, freie TE, Aufbauvorlagen und Komponentenvorgaben; nur nutzerdefinierte **Hinweise**, keine Auslegung (§9, ADR 0028) |
| Architektur | alles Fachliche im Modul `electrical`; Core nur generisch erweitert (Präferenzschalter, `writable_project_context`); keine Events; drei Migrationen über die Schritte verteilt; Altleitungen bleiben bit-genau gleich lang (§10) |
| Erster Auftrag | **ersetzt durch §18.10: L1 Planungslayout** · *bisher:* 6c.0 Planungsarbeitsfläche und Werkzeugleiste – reines Frontend, keine Migration, sofort spürbar, Grundlage aller weiteren grafischen Abläufe (§12) |

---

## 1. Ausgangsstand

### 1.1 Git und Arbeitsstand (geprüft 2026-10-15)

* Zweig `main`, letzter Commit `62a1cc9` (6b.5). **6b.6 liegt uncommittet im Arbeitsbaum**: 23 geänderte
  Dateien (Backend `electrical`/`core/projects`, OpenAPI, API-Client, Planner, Dokumentation) und
  5 neue (`cabling_summary.py`, zwei Testdateien, `planner/.../mengen/`, `phase-6-pruefliste.md`).
* Dieser Entwurf **bewahrt** den Arbeitsstand: nichts gestaged, committet, zurückgesetzt oder gepusht.
  Geändert werden ausschließlich Dokumentationsdateien (§16).
* Phase 6 ist technisch umgesetzt und geprüft; die **manuelle Gesamtprüfung durch den Auftraggeber
  steht aus**. Empfehlung: 6b.6 nach dieser Prüfung (oder auf ausdrückliche Freigabe vorher) als eigenen
  Checkpoint committen, **bevor** 6c-Code entsteht – sonst vermischen sich zwei Änderungsstände.

### 1.2 Befunde am Code

| # | Befund | Beleg | Folge für 6c |
|---|---|---|---|
| B1 | Hauptbereich der App ist auf **1 100 px** begrenzt; der Grundriss teilt ihn mit einer festen **300-px-Spalte** → Zeichenfläche höchstens ≈ 750 px breit | `app/Layout.tsx` (`max-w-[1100px]`), `GrundrissEditor.tsx` (`split:grid-cols-[minmax(0,1fr)_300px]`) | Arbeitsfläche darf die Seitenbreite verlassen; Eigenschaften eingeklappt (§4) |
| B2 | Wand-/Deckenansicht sind große Dialoge (bis 1 600 px) mit fester **320-px-Spalte**; Umbruch erst unter `split` = 60 rem | `Wandansicht.tsx`, `Deckenansicht.tsx`, `tokens.css` | dieselbe Arbeitsfläche im Dialog (§4) |
| B3 | Viewport: Größenänderung erhält **Maßstab und Weltmitte** (`groesseAendern` über `ResizeObserver`); Wand-/Deckenansicht passen nur **beim ersten Messen** ein; der Grundriss hält den Viewport im Editor, Wand/Decke im Komponentenzustand | `editor/viewport.ts`, `Zeichenflaeche.tsx`, `WandZeichenflaeche.tsx`, `Deckenansicht.tsx` | Layoutwechsel ohne Neueinpassen ist möglich – **solange die Zeichenfläche nicht neu eingehängt wird** (§4.4) |
| B4 | Serverfehler und Konfliktaktionen stehen in der **Seitenspalte** | `GrundrissEditor.tsx` (Kommentar „Rückmeldungen des Servers stehen in der Seitenleiste“) | eingeklappt wären sie unsichtbar → Statuszeile an der Aktion (§4.5) |
| B5 | Rückgängig/Wiederholen sind Textknöpfe; `SymbolKnopf` ist in `Symbol.tsx` beschrieben, aber **nicht vorhanden**; `lucide-react` 1.49 enthält `Undo2Icon`/`Redo2Icon` | `Werkzeugleiste.tsx`, `core/ui/Symbol.tsx` | `SymbolKnopf` anlegen, Einträge in `aktionssymbole.ts` (§4.6) |
| B6 | 3D-Schalter Wandgeräte/Deckengeräte/Beschriftungen sind **nur Komponentenzustand** (und in `Rueckkehr3d`); Leitungen werden immer gezeigt | `ansicht3d/Ansicht3d.tsx` | neuer Schalter, gespeichert (§5) |
| B7 | Persönliche Einstellungen: Core-Tabelle `user_preferences` mit **genau drei** typisierten Spalten und CHECKs, `PUT` als Ganzes mit `If-Match`, Cache je Mitgliedschaft `elektroplan.einstellungen.<member_id>` (Version 2) | `core/preferences/*`, `core/einstellungen/persoenlich.ts` | Erweiterung ohne Electrical-Wissen im Core (§5.3, ADR 0029) |
| B8 | Verteilung: Lage = `placement_device_id`; das Lagegerät entsteht nur im **Raumentwurf** (`PUT /rooms/{id}/contour`, `plan.write`), verknüpft wird getrennt per `PATCH /distribution-boards/{id}` (`circuit.write`) → **zwei Entwürfe, zwei Transaktionen**; Lagewechsel mit Leitungen `409 board-placement-has-cables`; Löschen des Lagegeräts `409 device-is-distribution-board` | `distribution.py`, `VerteilungDialog.tsx`, `schemas.py` | atomarer Platzierungsendpunkt (§6) |
| B9 | Leitung: `end_device_id` **NOT NULL**; Endgeräte müssen dem Stromkreis zugeordnet oder Lagegerät seiner Verteilung sein (`cable-endpoint-not-in-circuit`); Zugaben/Reserve fest in mm (0–20 m), keine Vorgaben (D5) | `models.py`, `cables.py`, `schemas.py` | Endgerät optional, Zuordnung im selben Speichervorgang, Vorgaben (§7, §8) |
| B10 | Neue Leitung beginnt mit der **Wahl des Stromkreises** in einem langen Seitenformular (`Leitungsbereich.tsx`, 865 Zeilen: Bezeichnung, Endgeräte, Kabelangaben, Zugaben, Wegpunkte, Ergebnis) | `leitung/Leitungsbereich.tsx`, `GrundrissLeitungsfeld.tsx` | Kontextleiste + Abschlussdialog (§7) |
| B11 | Formulare unter Listen bzw. auf Seiten: „Neues Gebäude“, „Neues Geschoss“ und Höhenlage inline (`ProjectStructureTab.tsx`), Steigweg-Editor als Abschnitt unter der Liste (`Steigwege.tsx`), Stammdaten als Seitenformular (`CustomerDetailPage.tsx`, `ProjectMasterDataTab.tsx`) | Dateien genannt | Umstellung nach Richtlinie (§3.3) |
| B12 | `FloorPlanningAccess` kennt Geschoss- und Gebäudekontext, aber **keinen projektweiten Schreibkontext** | `core/projects/planning.py` | generische Ergänzung für Projektvorgaben (§10.4) |
| B13 | Phase-7-Planung: `planned_quantity = required × (1 + waste_percent)` je Material, danach Verpackungsrundung | `modules/materials.md` §4 | Leitungsreserve und Verschnitt sauber trennen (§8.9) |
| B14 | Freie Tastenkürzel im Editor: `M`, `E`, `I` sind unbelegt (belegt: V H R P T N D L U Z G F 1 2 3, Strg+Z/Y/S) | Editor-Quellen | `M` Maximieren, `E` Eigenschaften (§4.3) |

---

## 2. Ziele und Nicht-Ziele

**Ziele:** spürbar größere und ruhigere Zeichenfläche; einheitliche, vorhersehbare Dialoge; schneller
Leitungsablauf ohne Vorab-Formular; zentrale, nachvollziehbare Vorgaben statt Einzeleingaben;
Verteilungen direkt platzierbar und im Aufbau planbar – ohne bestehende Daten still zu verändern.

**Nicht-Ziele:** Materialstamm, Artikel, Preise, Kalkulation (Phase 7+); Bemessung, Selektivität,
Spannungsfall, Normprüfung; automatische Wegfindung; allgemeine Regel-Engine oder Skriptsprache;
Stromlaufplan, Beschriftungsdruck; Neugestaltung aller Formulare.

---

## 3. Richtlinie: Dialoge für Anlegen und Bearbeiten

### 3.1 Regeln (verbindlich ab 6c)

| # | Regel |
|---|---|
| R1 | **Anlegen und Bearbeiten** von Stammdaten, Einstellungen, Vorgaben und Vorlagen öffnet einen **Dialog** (`core/ui/Dialog`, Größe `normal`). Kein Formular wird unter eine Liste oder an das Seitenende gehängt. |
| R2 | Ein Dialog hat **genau einen Scrollbereich** (`data-dialog-scrollbereich`); Titel oben fest, Aktionen in `DialogAktionen` unten angeheftet. Lange Inhalte werden gegliedert (Abschnitte, aufklappbare „Weitere Angaben“), nicht auf zwei Scrollflächen verteilt. |
| R3 | **Aktionen eindeutig benannt:** Primär „Anlegen“ bzw. „Speichern“ (bei grafischen Abschlüssen fachlich: „Leitung speichern“, „Platzierung speichern“), daneben „Abbrechen“. Folgenreiche Aktionen („Entfernen“, „Entwurf verwerfen“) räumlich getrennt und mit Rückfrage. Enter löst nur die Primäraktion eines Formulars aus, in Rückfragen nie die folgenreiche. |
| R4 | **Schließen mit ungespeicherten Eingaben** (X, Escape, Backdrop) fragt: „Änderungen verwerfen?“ – „Weiter bearbeiten“ (Fokus) / „Verwerfen“. Ohne Änderungen schließt der Dialog sofort. |
| R5 | **Fehler** des Servers erscheinen **im Dialog** über den Aktionen (`role="alert"`), Eingaben bleiben erhalten, der Fokus geht auf das erste betroffene Feld. Versionskonflikt: „Neu laden“ ausdrücklich, nie automatisch. |
| R6 | **Keine Dialogketten:** Ein Formulardialog öffnet keinen weiteren Formulardialog. Erlaubt ist höchstens eine Rückfrage (`Rueckfrage`/`Bestaetigung`). Folgeaktionen werden nach dem Schließen angeboten (Statuszeile, Knopf). |
| R7 | **Detailseiten** zeigen Stammdaten lesend mit „Bearbeiten“ → Dialog (vorhandene `CustomerFormDialog`/`ProjectFormDialog` wiederverwenden). |
| R8 | **Grafische Bearbeitung** bleibt auf der Zeichenfläche: Konfiguration (falls nötig) und **Abschluss** im Dialog; **während** des Zeichnens nur die kompakte **Kontextleiste** (§4.2); Eigenschaften im einklappbaren Panel; kein ständig wachsendes Seitenmenü. |
| R9 | Fokus: beim Öffnen `data-autofocus` bzw. erstes Feld; beim Schließen zurück zum Auslöser (vorhanden). Navigationsschutz (`Navigationsschutz`, `useVerlassenBestaetigen`) gilt unverändert für offene Entwürfe. |
| R10 | Ausnahmen ohne Dialog: Such- und Filterfelder, Umschalter der Darstellung, Eigenschaftenpanels grafischer Auswahl (Maße einer gewählten Wand/eines Geräts), Anmelde- und Einladungsseiten. |

### 3.2 Was die vorhandenen Bausteine bereits leisten

`core/ui/Dialog.tsx` bringt natives `<dialog>` mit Fokusfalle, Escape über `onEscape`, Fokusrückgabe,
Scrollsperre der Seite, einen Scrollbereich und `DialogAktionen` mit. **Fehlend** ist nur R4 als
wiederverwendbare Hilfe: `useDialogVerwerfenSchutz(geaendert)` liefert `onClose`, der bei Änderungen die
vorhandene Rückfrage zeigt. Kein neues Dialogsystem.

### 3.3 Betroffene bestehende Abläufe (konkret)

| Ablauf | heute | Anpassung | Schritt |
|---|---|---|---|
| Gebäude anlegen (`ProjectStructureTab`) | Eingabezeile über der Liste | Knopf „Gebäude anlegen“ → Dialog | 6c.2 |
| Geschoss anlegen (`ProjectStructureTab`) | Formular **unter** der Geschosstabelle | Knopf → Dialog (Name, Höhenlage, Standardhöhe) | 6c.2 |
| Höhenlage bestätigen/ändern | Formular in der Tabellenzeile | Zeilenaktion „Höhenlage …“ → Dialog | 6c.2 |
| Steigweg anlegen/bearbeiten (`Steigwege.tsx`) | Bearbeitungsabschnitt **unter** der Liste | großer Dialog wie die Wandansicht: Fläche links, Angaben im einklappbaren Panel, Abschluss „Steigweg speichern“ | 6c.2 |
| Kunden-/Projektstammdaten (`CustomerDetailPage`, `ProjectMasterDataTab`) | Seitenformular | lesende Ansicht + „Bearbeiten“ → vorhandener Formulardialog | 6c.2 |
| Leitung anlegen/bearbeiten (`Leitungsbereich`, `GrundrissLeitungsfeld`) | langes Formular in der Seitenspalte | Kontextleiste + Abschlussdialog, Panel nur für Liste/Befunde (§7) | 6c.5 |
| Verteilung: Lage wählen (`VerteilungDialog`) | Auswahl eines vorhandenen Geräts | Platzierungsablauf (§6); im Dialog nur noch Code/Name/Notiz | 6c.3 |

**Bleiben wie sie sind** (bereits Dialoge nach R1–R6): Raum, Wand, Öffnung, Verteilung, Stromkreis,
Kunde, Projekt, Einladen, Kontoaktionen, Einstellungen. Eigenschaftenpanels der Editoren (R10).

---

## 4. Planungsarbeitsfläche: größere Zeichenfläche, kompakte Werkzeuge

### 4.1 Gemeinsamer Baustein

Neu `modules/electrical/arbeitsflaeche/Planungsarbeitsflaeche.tsx` (Modul, nicht Core – nur Electrical
nutzt ihn; R „Keine Abstraktion ohne zweiten Anwendungsfall“ ist mit drei Ansichten erfüllt) mit den
Bereichen **Werkzeugleiste**, **Zeichenfläche**, **Kontextleiste**, **Eigenschaften**. Grundriss,
Wandansicht und Deckenansicht verwenden ihn; der Inhalt der Bereiche bleibt ansichtsspezifisch.

### 4.2 Skizze

Normal (breites Fenster, Eigenschaften eingeklappt – **Standard**):

```
┌ Projektkopf · Reiter · Ansichten (Editor | 3D | Tabellen | Steigwege | Stromkreise | Mengen) ──────────┐
│ [Auswählen][Verschieben] [Raum ▾][Öffnung ▾] [Leitung][Zuordnen]  │↶│↷│  │−│+│Einpassen│  Fang ☑ Raster ▾  │⛶│ │☰ 2│ │
├────────────────────────────────────────────────────────────────────────────────────────────────┬──┤
│                                                                                                │▸ │
│                                         ZEICHENFLÄCHE                                          │Ei│
│                                     (volle Inhaltsbreite)                                      │ge│
│                                                                                                │n.│
├────────────────────────────────────────────────────────────────────────────────────────────────┴──┤
│ Leitung zeichnen · Start UV1 · 4 Punkte · Teilsumme 7,40 m   [Abschließen …] [Verwerfen]   ⚠ 1 Befund │ ← Kontextleiste
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Eigenschaften aufgeklappt (breit): Panel rechts, **280–340 px** (`clamp`), eigener Scrollbereich,
Kopf mit Titel und „Einklappen“; die Zeichenfläche wird schmaler (Mitte bleibt, §4.4).

Schmal (< `split` = 60 rem): Panel **überlagert** die Zeichenfläche von rechts (max. 90 % Breite),
mit „Schließen“; die Zeichenfläche ändert ihre Größe dabei **nicht**.

Maximiert: Arbeitsfläche füllt das Fenster (`position: fixed; inset: 0`), Kopf, Reiter und
Ansichtsleiste sind ausgeblendet, Werkzeugleiste und Kontextleiste bleiben; rechts oben deutlich
„Normale Ansicht“ (`Minimize2`) – zusätzlich `M` und am Ende der Escape-Kette. In der Wand-/Deckenansicht
nutzt der Dialog dann die volle Fensterfläche (ohne 16-px-Rand).

### 4.3 Bedienabläufe

| Ablauf | Bedienung | Ergebnis |
|---|---|---|
| Eigenschaften öffnen | Knopf `☰` mit Zähler offener Befunde, `E`, oder Doppelklick auf ein Objekt | Panel öffnet; Fokus in den Panelkopf; Auswahl, Zoom, Ausschnitt unverändert |
| Eigenschaften schließen | Knopf im Panelkopf, `E`, Escape (wenn Panel den Fokus hat) | Fokus zurück auf `☰` |
| Maximieren | `⛶`, `M` | wie Skizze; laufendes Zeichnen, Vorschau und Auswahl laufen weiter |
| Zurück zum normalen Layout | „Normale Ansicht“, `M`, Escape (letzte Stufe der Kette) | Layout wie vorher (Panelzustand gemerkt) |
| Serverfehler beim Speichern | Kontextleiste zeigt Meldung **an der Aktion**, „Details“ öffnet das Panel am Fehler | Entwurf bleibt; Konflikt bietet „Serverstand laden“ ausdrücklich |

Der Panel- und Maximierungszustand ist **reine Ansicht** im Komponentenzustand der Sitzung (je Ansicht),
nicht gespeichert – keine weitere Ablage neben den persönlichen Einstellungen.

Escape-Kette (präzisiert, bisherige Reihenfolge bleibt): Bewegung → Vorschau/Werkzeug → Wegpunktauswahl
→ Leitungsauswahl → **Panel (schmal)** → **Maximierung** → Ansicht schließen.

### 4.4 Erhalt von Entwurf, Auswahl, Zoom und Ausschnitt

Geprüft am Code (B3): Zoom und Ausschnitt sind ein `Viewport` (Maßstab, Lage des Weltursprungs). Ändert
sich die Größe der Zeichenfläche, ruft der `ResizeObserver` `groesseAendern` auf: **Maßstab gleich,
Weltmitte bleibt in der Bildmitte**. Eingepasst wird nur beim ersten Laden bzw. beim ersten Messen einer
Wand/Decke und auf ausdrücklichen Wunsch (F). Daraus folgen verbindliche Umsetzungsregeln:

1. **Kein Neueinhängen der Zeichenfläche.** Normal/aufgeklappt/überlagert/maximiert werden nur über
   Klassen am **selben** Element geschaltet – kein Portal, kein bedingter anderer Elternknoten, kein
   wechselnder `key`. Sonst verlören Wand- und Deckenansicht ihren Viewport (Komponentenzustand) und
   laufende Zeigerbewegungen.
2. **Kein Einpassen bei Layoutwechsel** – nur `groesseAendern`. Überlagerndes Panel ändert die Größe nicht.
3. **Zustand außerhalb des Layouts:** Raum-, Leitungs-, Zuordnungs- und Platzierungsentwurf, Auswahl,
   Werkzeug, Undo-Historie liegen wie heute im Editor bzw. `LeitungsplanungProvider` – das Layout hält
   keinen fachlichen Zustand.
4. **Laufende Bewegung:** Ein Layoutwechsel während des Ziehens wird erst nach dem Loslassen wirksam
   (Tastenkürzel während `pointer capture` ignoriert), damit Bild- und Weltkoordinaten nicht springen.

Prüfbar: Test „Viewport vor/nach Umschalten gleich (Maßstab exakt, Weltmitte ±0,5 px)“, „kein Aufruf von
`einpassen`“, „Auswahl und Entwurf identisch“, „Zeichenfläche nicht neu eingehängt“ (Ref-Identität).

### 4.5 Status und Fehler an der Aktion

Die **Kontextleiste** unter der Zeichenfläche ersetzt die Hinweisleiste über der Fläche und die
Fehlerkarte in der Seitenspalte für alles, was zur laufenden Aktion gehört: aktueller Schritt („Startgerät
anklicken“), Entwurfsstatus („ungespeichert“), Länge/Teilsumme, Befundzähler, Primäraktion und die
**letzte Server- oder Prüfmeldung** (`role="status"` bzw. `role="alert"`). Lange Listen (alle Befunde,
Wegpunkte) bleiben im Panel. Die Fläche springt nicht: Die Leiste hat eine feste Höhe und kürzt Text
mit vollständigem Titel. Der Hinweis „Raumbearbeitung ruht, Leitungsentwurf offen“ (heute über dem
Grundriss) wandert ebenfalls in die Kontextleiste.

### 4.6 Rückgängig und Wiederholen

* `AKTION.rueckgaengig = Undo2Icon`, `AKTION.wiederholen = Redo2Icon` (`aktionssymbole.ts`).
* Neuer `core/ui/SymbolKnopf.tsx` (die in `Symbol.tsx` beschriebene Regel): `aria-label`, `title` mit
  Kürzel („Rückgängig (Strg+Z)“, „Wiederholen (Strg+Y oder Strg+Umschalt+Z)“), `aria-keyshortcuts`,
  sichtbarer Fokusring, gesperrt mit `disabled` **und** `aria-disabled`, deutlich blasser und
  `cursor-not-allowed`; der Tooltip nennt im gesperrten Zustand „– nichts rückgängig zu machen“.
* Gleich in Grundriss, Wand- und Deckenansicht; Kürzel unverändert. Weitere Symbolknöpfe der Leiste
  (Zoom, Maximieren, Eigenschaften) nutzen denselben Baustein – zweiter Anwendungsfall gegeben.

---

## 5. 3D: „Leitungen anzeigen“

### 5.1 Verhalten

| Thema | Regel |
|---|---|
| Schalter | „Leitungen“ in der Gruppe „Anzeigen:“ neben Wandgeräte/Deckengeräte/Beschriftungen, mit Anzahl; **unabhängig** von „Beschriftungen“ |
| Wirkung | nur Darstellung: Linienzüge, Fortsetzungsmarken und **unsichtbare Trefferkörper** werden aus der Szene genommen – ausgeblendete Leitungen sind nicht anklickbar; 2D, Mengen, Daten unberührt |
| Beschriftung | Fortsetzungstexte („Fortsetzung in OG“) erscheinen nur, wenn Leitungen **und** Beschriftungen sichtbar sind |
| Auswahl beim Ausblenden | eine gewählte **Leitung** wird ausdrücklich abgewählt; Statustext „Leitungsauswahl aufgehoben – Leitungen sind ausgeblendet“; der Fokus bleibt am Schalter; eine Geräte- oder Wandauswahl bleibt |
| Liste in der Seitenleiste | bleibt mit Hinweis „ausgeblendet“ und Knopf „Einblenden“; Wahl einer Leitung aus der Liste bei ausgeblendeten Leitungen blendet **nicht** still ein, sondern bietet „Leitungen einblenden und auswählen“ |
| Rückkehr aus Wand-/Deckenansicht | Kamera und Auswahl wie bisher; ist eine Leitung in `Rueckkehr3d` gewählt, die Darstellung aber aus, gilt die Regel „Auswahl beim Ausblenden“ |
| Standard | eingeblendet |

### 5.2 Speicherung

Persönlich je Mitgliedschaft, **über die bestehende Ressource** `GET/POST/PUT /me/preferences`, dieselbe
Version (`If-Match`), denselben Cache (`elektroplan.einstellungen.<member_id>`, Cache-Version 3) und
denselben Konfliktablauf (`EinstellungsKonflikt` → Serverstand anwenden). Das Umschalten wirkt sofort;
gespeichert wird im Hintergrund (entprellt, der letzte Stand gewinnt). Schlägt das Speichern fehl, bleibt
der Wert für die Sitzung, Hinweis „Anzeige nicht gespeichert“. **Keine** zweite Ablage (kein eigener
`localStorage`-Schlüssel).

### 5.3 Wie die Einstellung in den Core kommt, ohne Electrical-Wissen dort (ADR 0029)

Die Core-Tabelle kennt bewusst nur drei typisierte Werte (B7). Eine Spalte `show_cables_3d` im Core wäre
Electrical-Wissen im Core. **Empfehlung:** Module **deklarieren** typisierte Ja/Nein-Anzeigeschalter im
`ModuleDescriptor` (wie heute ihre Berechtigungen), der Core speichert sie generisch:

```text
ModuleDescriptor.display_flags = (DisplayFlagDef(key="electrical.plan3d.show_cables", default=True,
                                                 label="3D: Leitungen anzeigen"),)
user_preference_flags (Core)
  organization_id, member_id, key varchar(64), value boolean, timestamps
  PK (organization_id, member_id, key) · FK member CASCADE
PreferencesIn/Out: zusätzlich flags: {key: bool}
```

* Nur registrierte Schlüssel aktiver Module (`422` sonst), nur `bool`, keine JSON-Ablage, keine Freitexte.
* `PUT` ersetzt wie bisher den **ganzen** Stand; fehlende Schalter gelten als Standard. Jede Änderung
  zählt `user_preferences.version` hoch – eine Version für den ganzen Stand.
* Zweiter Anwendungsfall: die vorhandenen 3D-Schalter Wandgeräte/Deckengeräte/Beschriftungen (heute nach
  Neuladen verloren) werden ebenso gespeichert (**F4 bestätigt**, Umsetzung in 6c.1).

---

## 6. Verteilung direkt im Plan platzieren

### 6.1 Begriffe (unverändert, präzisiert)

Die **Verteilung** (`electrical_distribution_boards`) ist die einzige Identität. Ihr **Lagegerät** ist ein
Gerät vom Typ `distribution_board` und nur ihre räumliche Lage (ADR 0026 D1). Es gibt keine zweite
Verteilungsidentität und keine zweite Geometrie.

### 6.2 Abläufe

**„Im Plan platzieren“** (Ansicht „Stromkreise“, Zeile mit Marke „Noch nicht im Plan platziert“):

1. Dialog „UV1 im Plan platzieren“: Gebäude (fest, das der Verteilung), **Geschoss**, **Raum** (nur Räume
   mit mindestens einer Innenwand), „Weiter zur Wandwahl“.
2. Der Grundriss des Geschosses öffnet sich, der Raum ist gewählt; Kontextleiste: „UV1 platzieren – Wand
   des Raums anklicken“. Andere Räume sind gedimmt. Klick auf eine Wand öffnet deren **Wandansicht**
   (Innenseite).
3. In der Wandansicht hängt das Symbol der Verteilung (550 × 700 mm, Mitte 1 400 mm) am Zeiger; Prüfung,
   Fang und Hilfslinien sind die vorhandenen der Geräteplatzierung (`geraetepruefung.ts`). Klick setzt;
   Ziehen, Pfeiltasten und die Maßfelder im Panel korrigieren; Undo/Redo im Platzierungsentwurf.
4. Kontextleiste: „UV1 · Wand Süd (Diele, EG) · Mitte 0,50 m / 1,40 m“ **[Platzierung speichern]**
   **[Abbrechen]** – „Andere Wand wählen“ führt zurück zu Schritt 2 (Entwurf bleibt).
5. Erfolg: Statusmeldung „UV1 platziert: Diele (EG), Wand Süd“ mit „Zurück zu Stromkreise“ und
   „Neue Leitung ab UV1“.

**„Im Plan zeigen“** (platzierte Verteilung): öffnet die Wandansicht der Wand mit gewähltem Lagegerät
(wie „An Wand bearbeiten“ aus 3D); Schließen führt zurück zur Ansicht „Stromkreise“.

**„Position ändern“**: derselbe Ablauf ab Schritt 2 mit vorhandener Lage vorbelegt. Gleiche Wand →
Verschieben; andere Wand/anderer Raum → Umsetzen (§6.4).

**Gerätepalette:** Der Typ „Verteilung“ wird in der allgemeinen Gerätepalette der Wandansicht **nicht
mehr frei gesetzt**. An seiner Stelle steht „Verteilung platzieren …“ mit der Liste der noch nicht
platzierten Verteilungen. So entsteht nie ein Lagegerät ohne Verteilung. Vorhandene, nicht verknüpfte
Geräte dieses Typs (Altbestand) zeigt die Ansicht „Stromkreise“ als „Lagegerät ohne Verteilung“ mit
„Mit Verteilung verknüpfen“ (vorhandener `PATCH`) bzw. „Entfernen“.

### 6.3 Zusammenspiel mit dem Raumentwurf

* Die Platzierung ist ein **eigener kleiner Entwurf** (wie Leitung, Zuordnung) und unterliegt der Regel
  „höchstens ein offener Entwurf je Planungskontext“.
* Ist im Zielgeschoss ein **Raumentwurf mit ungespeicherten Änderungen** offen, startet die Platzierung
  nicht still: Rückfrage „Im Raum ‚Diele‘ gibt es ungespeicherte Änderungen. Die Platzierung speichert
  nur die Verteilung.“ – **[Zum Raumentwurf zurück]** / **[Änderungen verwerfen und platzieren]**.
  Es wird nie etwas anderes mitgespeichert.
* Offener Leitungs- oder Zuordnungsentwurf: vorhandener Entwurfsschutz („erst speichern oder schließen“).
* **Abbrechen** verwirft nur den Platzierungsentwurf; serverseitig ist nichts entstanden.
* **Speicherfehler**: Entwurf bleibt, Meldung an der Aktion. Lagefehler (`422`, z. B. „überschneidet
  Tür T1“) mit Ort; Versionskonflikt (`409`): „Verteilung oder Raum wurde inzwischen geändert“ –
  **[Neu laden]** (Lage bleibt als Vorschlag erhalten).

### 6.4 API und Transaktion (kleinste konsistente Lösung)

```text
PUT    /distribution-boards/{board_id}/placement      If-Match: Version der Verteilung
       { room_id, wall_id, center_offset_mm, center_height_mm, label?, expected_room_version }
DELETE /distribution-boards/{board_id}/placement      If-Match   (nur ohne Leitungen am Lagegerät)
Rechte: electrical.circuit.write UND electrical.plan.write
Antwort: Verteilung (neue Version), betroffene Raumversionen, Lagegerät
```

Ablauf in **einer** Transaktion, Sperrreihenfolge wie überall „Projekt zuerst“:

1. Projekt sperren, Schreibschutz (`writable_building_context`; `completed`/`archived` → `409`).
2. Verteilung `FOR UPDATE`, `If-Match`.
3. Betroffene Räume (Ziel, ggf. bisheriger Raum) nach ID geordnet `FOR UPDATE`; `expected_room_version`
   des Zielraums prüfen.
4. Wände, Öffnungen, Geräte frisch lesen; Lage mit **denselben** Geräteregeln wie der Raumentwurf prüfen
   („keine neuen Befunde“, `device_rules.py`).
5. Fälle:
   * keine Lage → Gerät `distribution_board` (`wall_interior`) anlegen, `placement_device_id` setzen;
   * gleiche Wand → Lagegerät verschieben (Anschlussstrecken werden wie bei jeder Geräteverschiebung neu
     abgeleitet; Leitungsbefunde vorher/nachher wie im Raumentwurf);
   * andere Wand → **nur ohne Leitungen am Lagegerät**: neues Gerät anlegen, umhängen, altes Gerät
     entfernen; mit Leitungen `409 board-placement-has-cables` (**F5 bestätigt**); die Meldung nennt jede betroffene
     Leitung verständlich („F3 · L2: UV1 → Steckdose Arbeitsplatte“), nichts wird geändert.
6. Raumversion(en) und Verteilungsversion hochzählen; vorhandenes Event `electrical.plan.updated`
   (`devices_changed`) je betroffenem Raum **nach** dem Commit.

**Doppelte Verteilung ausgeschlossen:** `If-Match` der Verteilung – ein zweiter, gleichzeitiger oder
wiederholter Aufruf mit derselben Version scheitert mit `409`, ohne Gerät; zusätzlich die vorhandene
Eindeutigkeit `UNIQUE (organization_id, placement_device_id)`. **Keine verlorene Zuordnung:** Gerät und
Verknüpfung entstehen/ändern sich gemeinsam oder gar nicht. Keine Migration nötig.

---

## 7. Neuer Leitungsablauf

### 7.1 Zeichnen

„Neue Leitung“ (Werkzeug `L`) startet **ohne** Formular. Kontextleiste je Schritt:

| Schritt | Kontextleiste | Eingabe |
|---|---|---|
| 1 Start | „Startgerät anklicken – Verteilung, Abzweigdose oder Gerät“ | Klick auf ein Gerät übernimmt es als Start; außen montierte Geräte und Datendosen werden mit Grund abgelehnt |
| 2 Verlauf | „Verlauf setzen – Zielgerät anklicken oder doppelklicken zum Beenden“ · Ebene (Grundriss: Fußboden/Wand/Decke `1/2/3`, Höhe) · Länge/Teilsumme · [Abschließen …] | Klick auf freie Fläche setzt einen Wegpunkt; Fang, Hilfslinien, Bodenübergang, Durchführung (`U`), Steigweg, Flächen- und Geschosswechsel wie bisher; `Alt`+Klick setzt einen Punkt **ohne** Gerätefang |
| 3 Ziel | – | Klick auf ein Gerät übernimmt es als Ziel, **beendet das Zeichnen** und öffnet den Abschlussdialog |
| 3' Offen beenden | – | **Doppelklick** oder Enter oder „Abschließen …“ beendet ohne Zielgerät und öffnet den Dialog; die Leitung ist dann ausdrücklich „unvollständig – Endgerät fehlt“ |

**Doppelklick ohne doppelten Wegpunkt:** Der erste Klick setzt den Punkt; ein Klick mit
`event.detail ≥ 2` setzt **keinen** weiteren Punkt; `dblclick` beendet. Ergebnis: genau ein Wegpunkt an
der Doppelklickstelle. Auf Touch übernimmt „Abschließen …“ diese Rolle. Test: Doppelklick erzeugt genau
einen Punkt, Rückgängig danach entfernt genau diesen.

Gerätetreffer haben Vorrang vor Wegpunkten; Undo/Redo bleibt je Entwurf (ein Schritt je Punkt, Start- und
Zielgerät je ein Schritt). Der gebäudeweite Entwurf (`LeitungsplanungProvider`) bleibt: Geschosswechsel
über einen Steigweg erhalten ihn; Start in EG, Ziel in OG ist der Normalfall eines geschossübergreifenden
Entwurfs – der Dialog öffnet sich im Zielgeschoss.

### 7.2 Abschlussdialog

Titel „Leitung abschließen“ (bzw. „Leitung L7 – Angaben“ beim Bearbeiten). Ein Scrollbereich, drei
Abschnitte, Aktionen unten:

```
Stromkreis       [F3 Küche Steckdosen ▾]   aus Zuordnung des Zielgeräts
Start → Ziel     UV1 (Diele, EG) → Steckdose „Arbeitsplatte“ (Küche, EG)
                 ☑ Steckdose „Arbeitsplatte“ dem Stromkreis F3 zuordnen   (nur wenn nicht zugeordnet)
Bezeichnung      [L7]

Kabel            Vorlage [NYM-J 3×1,5 ▾]   aus: Gerätetyp Steckdose (Projektvorgabe)
                 Typ [NYM-J]  Leiter [3]  Querschnitt [1,5] mm²         · abweichend: –
Reserve          [20] %                     aus: Betriebsstandard
Anschlusszugaben Start [0,50 m] (Verteilung) · Ende [0,20 m] (Gerät)   aus: Projektvorgabe

Ergebnis         Weg 8,50 m · Reserve 20 % = 1,70 m · Zugaben 0,70 m · Gesamt 10,90 m (bestätigt)
Hinweise         keine  |  „Querschnitt fehlt – Leitung unvollständig spezifiziert“  |  Konflikte mit Ort
                 Vorgaben des Betriebs sind Planungsangaben – keine Bemessung, keine Normprüfung.

[Leitung speichern]   [Weiterzeichnen]                                   [Entwurf verwerfen …]
```

* **Vorbelegt** nach §8.4; jede Angabe zeigt ihre **Herkunft**; eine Änderung macht sie „abweichend“
  (Marke), „Vorgabe wiederherstellen“ setzt sie zurück.
* **„Leitung speichern“** speichert Weg, Angaben und – falls angehakt – die Zuordnung des Endgeräts
  **in einem Aufruf** (§7.4). Gesperrt nur bei echten Hindernissen (Stromkreis unentschieden, ungültige
  Eingabe); unvollständige Wege oder fehlende Angaben sind speicherbar und bleiben sichtbar unvollständig.
* **„Weiterzeichnen“**, **X** und **Escape** führen zum unveränderten Entwurf zurück (Fläche und Geschoss
  des letzten Punkts, Viewport wie vorher). Nichts geht verloren.
* **„Entwurf verwerfen …“** nur mit Rückfrage.
* Einheiten nach persönlicher Einstellung; Prozent mit Komma; Querschnitt in mm².

### 7.3 Stromkreis ableiten

Grundsatz: Eine Leitung gehört zu genau **einem** Stromkreis; beide Endgeräte müssen ihm zugeordnet oder
Lagegerät seiner Verteilung sein (bestehende Regel). **Nie stilles Umhängen.**

| Start | Ziel | Ergebnis im Dialog |
|---|---|---|
| Lagegerät UV1 | zugeordnet zu F3 (an UV1) | F3, „aus Zuordnung des Zielgeräts“ |
| Lagegerät UV1 | zugeordnet zu F9 an **UV2** | Konflikt: „Zielgerät gehört zu F9 an UV2 – eine Leitung ab UV1 kann es nicht versorgen.“ Speichern gesperrt; Wege: anderes Ziel (Weiterzeichnen) |
| Lagegerät UV1 | nicht zugeordnet | **Wahl** eines Stromkreises von UV1 (Pflichtfeld, nichts vorgewählt außer bei genau einem Stromkreis) + angehakte Zuordnung des Zielgeräts |
| Abzweigdose (F3) | zugeordnet zu F3 / nicht zugeordnet | F3 / F3 mit angehakter Zuordnung |
| Gerät (F3) | Gerät (F5) | Konflikt: „Start gehört zu F3, Ziel zu F5.“ Wahl: Ziel ändern, oder **ausdrücklich** eines der Geräte umhängen – nur wenn es keine Leitung im bisherigen Stromkreis hat; die Rückfrage nennt Gerät, alten und neuen Stromkreis |
| beliebig | kein Ziel (offen) | Stromkreis aus dem Start (bei Lagegerät: Wahl) |

### 7.4 API-Ergänzungen für den Ablauf

* `CableIn.end_device_id` wird **optional** (Migration: Spalte `NULL`, CHECK angepasst). Status
  `incomplete` mit Befund „Endgerät fehlt“; keine Länge, nur Teilsumme.
* `CableIn.assign_devices: [device_id]` (höchstens die beiden Endgeräte): **nur nicht zugeordnete**
  Geräte werden dem Stromkreis der Leitung zugeordnet – in derselben Transaktion; ein anderweitig
  zugeordnetes Gerät → `409 device-assigned-elsewhere`, nichts gespeichert. Verlangt zusätzlich
  `electrical.circuit.write` (Muster `acknowledged_cable_ids`) und `expected_circuit_version`.
* Herkunftsangaben und Vorgabenbasis (§8.6) im selben Körper.

### 7.5 Bestehende Leitungen bearbeiten

Auswahl (Liste im Panel oder Klick) zeigt in der Kontextleiste: **[Verlauf bearbeiten]** **[Angaben …]**
**[Entfernen …]**.

* **Verlauf bearbeiten** öffnet den grafischen Entwurf (wie heute). Speichern über Kontextleiste oder
  Strg+S **direkt**, wenn sich nur der Verlauf geändert hat; eine prozentuale Reserve folgt der neuen
  Länge automatisch (gespeichert ist der Prozentsatz, nicht der Betrag). Klick auf ein anderes Gerät als
  Ziel öffnet den Abschlussdialog.
* **Angaben …** öffnet denselben Dialog ohne Zeichnen („Verlauf bearbeiten“ statt „Weiterzeichnen“).
* „Vorschlag übernehmen“ (6b) bleibt für einzelne Leitungen erhalten; die zentrale Anwendung (§8.7)
  deckt den Massenfall ab.

---

## 8. Zentrale Planungsvorgaben und Kabelvorlagen

### 8.1 Ebenen und Eigentum

| Ebene | Inhalt | Eigentümer, Speicherort | Recht |
|---|---|---|---|
| **Betriebsstandard** | Reserve %, Anschlusszugaben je Endpunktart, Standard-Kabelvorlage, Kabelvorlage je Gerätetyp | `electrical`, je Organisation | `electrical.defaults.manage` (neu) |
| **Kabelvorlagen** | Name, Leitungstyp, Leiteranzahl, Querschnitt, aktiv, Sortierung – **ohne Preise** | `electrical`, je Organisation | `electrical.defaults.manage` |
| **Projektvorgabe** | dieselben Felder, je Feld leer = „Betriebsstandard übernehmen“; Vorlage je Gerätetyp abweichend | `electrical`, je Projekt | `electrical.route.write` |
| **Stromkreisvorgabe** | vorhanden (`proposed_*`); neu wählbar „aus Vorlage“; **wirkt nur mit** dem ausdrücklichen Schalter `proposal_overrides_templates` („Für neue Leitungen dieses Stromkreises diese Kabelvorgabe verwenden“, Standard **aus**) | `electrical`, je Stromkreis | `electrical.circuit.write` |
| **Leitung** | tatsächliche Werte + Herkunft je Gruppe | `electrical`, je Leitung | `electrical.route.write` |

Vorgaben sind **Vorschlagsquellen**, keine Laufzeitvererbung (ADR 0026 Nr. 4 bleibt): Für eine Leitung gilt
nur, was an ihr steht.

### 8.2 Felder

* **Reserve:** Prozentsatz 0–100 mit höchstens zwei Nachkommastellen (`numeric(5,2)`, API-String, ADR 0005).
* **Anschlusszugaben** (fest, mm, 0–20 000) je **Endpunktart**: an einer Verteilung, an einer Abzweigdose,
  an einem sonstigen Gerät. Start- und Endzugabe der Leitung ergeben sich aus der Art des jeweiligen
  Endgeräts.
* **Kabelvorlage** = vollständiges Tripel (Typ, Leiter, Querschnitt) als **Einheit** – nie gemischt aus
  zwei Quellen.

### 8.3 Priorität – eine Kette je Wertegruppe

Drei Wertegruppen mit je **einer** eindeutigen Kette; die erste Stufe mit Wert gewinnt, spätere Stufen
werden nicht eingemischt:

| Gruppe | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **Kabelangaben** | Leitung (ausdrücklich abweichend) | Stromkreisvorgabe – **nur wenn ausdrücklich aktiviert** | Vorlage je Gerätetyp – Projekt, sonst Betrieb | allgemeine Standardvorlage – Projekt, sonst Betrieb | keine → sichtbar fehlende Angaben („unvollständig spezifiziert“) |
| **Reserve %** | Leitung (abweichend) | Projektvorgabe | Betriebsstandard | – | 0 % |
| **Anschlusszugaben** | Leitung (abweichend) | Projektvorgabe | Betriebsstandard | – | 0 mm |

**F1 – entschieden (2026-10-15):** Standardmäßig greift die **Gerätetypvorlage** des maßgeblichen Geräts
(§8.4). Eine Stromkreisvorgabe hat nur Vorrang, wenn am Stromkreis ausdrücklich „Für neue Leitungen dieses
Stromkreises diese Kabelvorgabe verwenden“ aktiviert ist (`proposal_overrides_templates = true`). Ohne
Aktivierung bleiben die Stromkreiswerte reine Information („Vorschlag am Stromkreis“) und werden **nicht**
vorbelegt. Eine aktivierte, nur teilweise ausgefüllte Stromkreisvorgabe gilt als Einheit (fehlende Felder
bleiben fehlend und werden sichtbar gemeldet, nicht aus einer Vorlage ergänzt); der Stromkreisdialog weist
beim Aktivieren auf fehlende Felder hin.

**Migration:** Die neue Spalte `electrical_circuits.proposal_overrides_templates` entsteht mit `false` für
**alle** vorhandenen Stromkreise – vorhandene Stromkreiswerte gelten nie automatisch als aktivierter Vorrang.
Bestehende Leitungen behalten ihre tatsächlichen Angaben (Herkunft `legacy`). Die bisherige Einzelaktion
„Vorschlag übernehmen“ (6b) bleibt als ausdrückliche Aktion je Leitung bestehen und hängt nicht vom Schalter ab.

### 8.4 Welches Gerät bestimmt die Vorlage

1. Maßgeblich ist das **Zielgerät**.
2. Ist das Ziel eine Verteilung oder fehlt es, ist das **Startgerät** maßgeblich – sofern es kein Lagegerät
   einer Verteilung ist.
3. **Start an einer Verteilung:** Die Verteilung selbst bestimmt nie die Vorlage; maßgeblich ist das Ziel
   (eine Abzweigdose kann eine eigene Gerätetypvorlage haben).
4. Ergeben Start- und Zielgerät **verschiedene** Vorlagen (z. B. Schalter → Leuchte), gilt das Ziel; der
   Dialog nennt die andere als Hinweis („Startgerät ‚Schalter‘ würde NYM-J 5×1,5 vorschlagen“) mit
   „stattdessen übernehmen“ (dann „abweichend“).
5. Eine **inaktive** Vorlage wird nie vorgeschlagen; Hinweis „Vorlage für Gerätetyp Leuchte ist
   deaktiviert“.

Vorgeschlagen wird beim **Öffnen des Abschlussdialogs** (neue Leitung) und bei einem Ziel- oder
Stromkreiswechsel im Dialog – für Gruppen, die nicht „abweichend“ sind. Die Gerätetypvorlage nach dieser Regel
wird nur übersprungen, wenn der Stromkreis der Leitung seine Vorgabe ausdrücklich aktiviert hat (§8.3).

### 8.5 Herkunft sichtbar machen und manuelle Abweichung

Jede Leitung speichert je Gruppe eine **Herkunft**: `circuit_override` (aktivierte Stromkreisvorgabe), `device_type_template`,
`default_template`, `project_default`, `office_default`, `manual`, `legacy` (vor 6c), dazu
`cable_template_id` (falls aus einer Vorlage). Anzeige im Dialog, im Panel und in der Mengenübersicht
(Filter „abweichend“). „Abweichend“ (`manual`) bedeutet: von der zentralen Anwendung standardmäßig
ausgenommen. Anzeigetexte: „aus Stromkreis F3 (aktivierte Vorgabe)“, „Gerätetyp Steckdose (Projektvorgabe)“,
„Gerätetyp Steckdose (Betriebsstandard)“, „Standardvorlage (Betrieb)“, „abweichend“, „vor 6c erfasst“. Hat ein
Stromkreis Werte **ohne** Aktivierung und weichen sie von der übernommenen Vorlage ab, nennt der Dialog sie als
Hinweis („Am Stromkreis F3 steht NYM-J 3×2,5 – nicht als Vorgabe aktiviert“) mit „stattdessen übernehmen“
(dann „abweichend“).

### 8.6 Vorgaben ändern sich während eines offenen Entwurfs

* Der Dialog lädt die Vorgaben beim Öffnen frisch (`staleTime 0`) und merkt sich ihre **Basis**
  (Versionen von Betriebsstandard, Projektvorgabe und verwendeter Vorlage).
* Der Speicheraufruf sendet diese Basis für alle Gruppen, deren Herkunft eine Vorgabe ist. Hat sich eine
  davon geändert, antwortet der Server `409 planning-defaults-changed` – **nichts gespeichert**. Der Dialog
  zeigt „Vorgaben wurden geändert: Reserve jetzt 15 % (vorher 20 %)“ mit **[Neue Vorgaben übernehmen]**
  oder **[Bisherige Werte als Abweichung behalten]**. Nie still.
* Abweichende Gruppen sind von Vorgabenänderungen nicht betroffen.

### 8.7 Reserveberechnung und Rundung

```
geometrisch   g   (ganze mm, aus der Längenfunktion)
Reserve       r = ⌈ g · p / 100 ⌉        p = Prozentsatz mit ≤ 2 Nachkommastellen
              ganzzahlig gerechnet: r = (g · P + 9 999) div 10 000,  P = p · 100 (ganze Zahl)
Zugaben       z = Startzugabe + Endzugabe  (fest, mm)
Gesamt        L = g + r + z                nur bei Status confirmed
```

* **Aufrunden** auf ganze Millimeter (**F2 bestätigt**): Die Reserve unterschreitet nie den Prozentsatz;
  ganzzahlig, plattformgleich in Backend und Frontend (gemeinsame Fixture), ohne Gleitkomma.
* Prozent nur auf die **geometrische** Länge – nie auf Zugaben, nie auf eine feste Reserve.
* **Unvollständig/Konflikt:** keine prozentuale Reserve, keine Gesamtmenge. Angezeigt: „Teilsumme Weg
  6,40 m + Zugaben 0,70 m – Reserve 20 % wird bei vollständigem Weg berechnet.“
* Beispiele: g = 8 500, p = 20 → r = 1 700, z = 500 + 200 → **L = 10 900 mm**. g = 8 333, p = 20 →
  1 666,6 → **r = 1 667**. g = 4 001, p = 12,5 → 500,125 → **r = 501**.
* Die Reserve wird **abgeleitet, nicht gespeichert** (wie die Länge); gespeichert ist der Prozentsatz.

### 8.8 Altwerte und neue Prozentvorgaben nebeneinander

| Feld (Leitung) | bisher | ab 6c |
|---|---|---|
| `reserve_mm` | feste Reserve | bleibt: **feste Reserve** bei `reserve_mode = fixed` |
| `reserve_mode` | – | `fixed` \| `percent` (Bestand: `fixed`) |
| `reserve_percent` | – | Prozentsatz bei `percent`, sonst `NULL` (CHECK) |
| `start_/end_allowance_mm` | Zugaben | unverändert (Werte), Herkunft neu |
| `*_origin` | – | Bestand: `legacy` |

Die Migration ändert **keinen** Wert: Jede Bestandsleitung hat danach dieselbe Länge (Testfall: Mengen
vor/nach Migration identisch). Eine feste Reserve wird nie still in Prozent umgerechnet; die Umstellung
erfolgt nur über die zentrale Anwendung (§8.9) und ist dort als „Altbestand – feste Reserve 0,50 m →
20 % (= 1,70 m)“ einzeln sichtbar und standardmäßig **nicht** angehakt. API: `allowance_mm` behält seine
Bedeutung (Summe aller Zusätze); neu `reserve_effective_mm` und `connection_allowance_mm` getrennt.

### 8.9 Zentrale Anwendung mit Vorschau

„Vorgaben auf Leitungen anwenden“ (Projekt oder Gebäude), Wahl der Gruppen (Kabelangaben / Reserve /
Zugaben):

1. **Vorschau** (`POST …/planning-defaults/preview`, nur lesend unter geteilter Projektsperre):
   je Leitung bisherige und neue Werte, Längenwirkung (nur bestätigte), Summen je Kabelgruppe vorher/nachher.
   Abschnitte: **ändert sich** (angehakt) · **unverändert** · **abweichend** (nicht angehakt, einzeln
   wählbar) · **Altbestand** (nicht angehakt, einzeln wählbar) · **nicht anwendbar** (z. B. keine Vorlage
   für den Gerätetyp).
2. **Anwenden** (`POST …/planning-defaults/apply`) mit `{cables: [{id, version, groups}], basis}`.
3. **Atomar:** Projekt sperren (schreibbar) → Vorgabenbasis prüfen → Leitungen nach ID `FOR UPDATE` →
   Versionen prüfen → schreiben. Weicht **eine** Version oder die Basis ab: `409` mit Liste,
   **nichts** geändert; die Oberfläche lädt die Vorschau neu. Kein Teilerfolg, keine Teilfehlerlogik.
4. Höchstens 500 Leitungen je Aufruf (größer: je Gebäude). Danach ist die Herkunft der geänderten Gruppen
   die jeweilige Vorgabe; `manual` bleibt nur, wo nicht angehakt.

Keine Regel-Engine: Die Anwendung wertet ausschließlich die Kette aus §8.3/§8.4 aus.

### 8.10 Abgrenzung zu Phase 7/8: Reserve, Verschnitt, Verpackung

| Schritt | Eigentümer | Wirkung |
|---|---|---|
| geometrische Länge + Anschlusszugaben | Electrical | **Bedarf** (`required`) |
| Leitungsreserve (Prozent oder fest) | Electrical | **Planungsreserve** – getrennt übergeben |
| Material-Verschnitt (`waste_percent`) | Materials (Phase 7) | **nicht** auf Leitungen mit Planungsreserve |
| Verpackungsrundung | Materials (Phase 7) | danach, auf die geplante Menge |

Verbindliche Vorgabe für den Phase-7-Entwurf: `ElectricalMaterialProvider` übergibt Bedarf und
Planungsreserve **getrennt**; die Material Engine wendet für Positionen mit Planungsreserve keinen
Verschnitt an (`planned = required + planning_reserve`) und meldet, wenn eine Verschnittregel sonst gegriffen
hätte. So entsteht keine doppelte Reserve. Die genaue Contract-Änderung (`MaterialRequirementDraft`)
entscheidet ein Phase-7-ADR.

### 8.11 Spätere Verbindung zu Materialartikeln

Kabelvorlagen bleiben technische Angaben ohne Preis. In Phase 7 erhält eine Vorlage eine **optionale**
Artikelreferenz über den öffentlichen Contract von `materials` (Electrical hängt dann von `materials` ab,
wie in der Roadmap vorgesehen). Die Leitung bleibt bei ihren **tatsächlichen** Angaben; die Zuordnung zum
Artikel erfolgt im Provider über Vorlage bzw. das Tripel. Kein zweiter Materialstamm in 6c.

---

## 9. Verteilungen vollständig planen (Aufbau)

### 9.1 Vier Dinge – klar getrennt

| Begriff | Was | Wo gespeichert |
|---|---|---|
| **Lagegerät** | räumliche Lage (Wand, Mitte, Maße) | `electrical_devices` (Typ `distribution_board`) |
| **Verteilung** | elektrischer Bezugspunkt, Identität (UV1) | `electrical_distribution_boards` |
| **Eingebaute Komponente** | Hauptschalter, FI, LS, FI/LS, Überspannungsschutz, Klemme, Sonstiges – an einem Platz in einer Reihe | neu: `electrical_board_components` (an der Verteilung) |
| **Stromkreis / Zuordnung** | logische Einheit; „LS F3 schützt Stromkreis F3“, „F3 liegt hinter FI 1“ | Stromkreis vorhanden; Zuordnung als Bezug der Komponente |

Keine zweite Verteilungsidentität: Reihen und Komponenten hängen an der vorhandenen Verteilung.

### 9.2 Modell (erste Version)

```text
electrical_distribution_boards  + layout_version int (Version des Aufbaus)
                                + reserve_te_target smallint NULL, max_circuits_per_rcd smallint NULL  (Hinweisregeln)
electrical_board_rows
  id, organization_id, board_id, seq, capacity_te smallint (1–48), label varchar(40) NULL
electrical_board_components
  id, organization_id, board_id, row_id, position_te smallint (0-basiert), width_te smallint (1–24),
  kind  main_switch | rcd | mcb | rcbo | surge_protection | terminal | other
  label varchar(40) NULL          -- z. B. „F3“, „FI 1“
  rating_text varchar(40) NULL    -- Freitext, z. B. „B16“, „40 A / 30 mA“ – nicht ausgewertet
  poles smallint NULL, note varchar(200) NULL,
  circuit_id NULL                 -- geschützter Stromkreis (nur mcb, rcbo, other)
  upstream_component_id NULL      -- vorgeschaltete Komponente (z. B. FI) derselben Verteilung
  preset_id NULL                  -- Herkunft aus Komponentenvorgabe
  UNIQUE (organization_id, circuit_id) WHERE circuit_id IS NOT NULL
```

**Harte Regeln** (`422`, strukturell, keine Elektrotechnik): Komponente innerhalb der Reihenkapazität,
keine Überlappung, Stromkreis derselben Verteilung, höchstens eine Komponente je Stromkreis,
vorgeschaltete Komponente derselben Verteilung, keine Zyklen.

**Speichern:** Aufbau als **Ganzes** (`PUT /distribution-boards/{id}/layout`, `If-Match` =
`layout_version`), stabile Komponenten-IDs (bekannte ändern, neue mit Client-UUID) – Zuordnungen bleiben
nachvollziehbar. Stromkreis löschen entfernt seine Zuordnung an der Komponente in derselben Transaktion
(mit Hinweis in der vorhandenen Rückfrage).

### 9.3 Bedienung

Ansicht „Stromkreise“ → Verteilung → **„Aufbau“** öffnet eine große Arbeitsansicht (Dialog `gross`, gleiche
Arbeitsfläche §4): Reihen als Hutschienen mit TE-Raster; Palette aus **Komponentenvorgaben**; Ziehen auf
freie Plätze, Verschieben, Entfernen; Panel „Komponente“ (Bezeichnung, Angabe, Pole, Stromkreis wählen,
„hinter FI …“); FI-Gruppen als Klammer über den nachgeschalteten LS; Zähler „frei 7 von 48 TE“.
Undo/Redo, Entwurf, Navigationsschutz, ausdrückliches „Aufbau speichern“.

Die vorhandenen Freitextfelder am Stromkreis (`protective_device`, `rcd_group`) bleiben. Ist ein Stromkreis
einer Komponente zugeordnet, zeigt die Oberfläche beide Angaben; bei Abweichung Hinweis „Angabe am
Stromkreis weicht vom Aufbau ab“ mit **[Aus Aufbau übernehmen]** – nie automatisch.

### 9.4 Vorlagen und zentrale Vorgaben

* **Komponentenvorgaben** (Betrieb): Name, Art, Breite TE, Pole, Angabe – z. B. „LS B16 1-polig, 1 TE“.
  Grundlage der Palette; ohne Preis.
* **Aufbauvorlagen** (Betrieb): Reihen mit Kapazität und Komponenten an Plätzen (ohne Stromkreise),
  Hinweisregeln. „Als Vorlage speichern“ aus einer vorhandenen Verteilung.
* **Vorlage anwenden:** auf eine Verteilung **ohne** Aufbau direkt; mit Aufbau nur nach **Vorschau**
  („entfernt 12 Komponenten, löst 9 Zuordnungen“) und Bestätigung. Stromkreise werden nicht angelegt und
  nicht zugeordnet.

### 9.5 Regeln: jetzt einfach, später eigene Erweiterung

| Jetzt (nutzerdefiniert, als Hinweis, nie blockierend) | Später (eigene fachliche Erweiterung, eigener ADR) |
|---|---|
| freie TE unter der Zielreserve der Verteilung | Phasenzuordnung, Lastverteilung auf L1–L3 |
| mehr Stromkreise hinter einem FI als hinterlegt | Bemessung, Kennlinien, Selektivität, Kurzschlussfestigkeit |
| Stromkreis ohne Komponente / LS ohne Stromkreis | automatische Erzeugung eines Aufbaus aus Stromkreisen |
| Angabe am Stromkreis ≠ Aufbau | FI-Typanforderungen, Normprüfung jeder Art |
| Vorlage weicht vom aktuellen Aufbau ab | Beschriftungsdruck, Stromlaufplan, Artikel/Preise (Phase 7/8) |

Jeder Hinweis trägt den Text „Vorgabe des Betriebs – keine elektrotechnische Prüfung“. Die App behauptet
nie, ein gezeichneter Aufbau sei geprüft. Keine Standardauslegungen werden mitgeliefert: Komponenten- und
Aufbauvorlagen sind anfangs **leer**.

### 9.6 Abgrenzung zu Material und Kalkulation

Komponenten sind technische Planungsobjekte. Artikelbezug (Komponentenvorgabe → Material) und Leistung
(ServiceTemplate je Verteilung, `electrical.md` §6) folgen in Phase 7/8 über die öffentlichen Contracts;
6c legt nur stabile Schlüssel (`preset_id`, `kind`) an, an die das später anknüpft.

---

## 10. Architektur, Datenbestand und Rechte

### 10.1 Eigentümer

| Daten/Einstellung | Eigentümer | Ebene |
|---|---|---|
| Anzeigeschalter (z. B. 3D-Leitungen) | Core speichert generisch, Modul deklariert | Mitgliedschaft |
| Panel/Maximierung | nur Komponentenzustand | Sitzung |
| Betriebsstandard, Kabelvorlagen, Gerätetypzuordnung, Komponenten- und Aufbauvorlagen | `electrical` | Organisation |
| Projektvorgabe | `electrical` | Projekt |
| Kabelwerte, Herkunft, Reservemodus | `electrical` | Leitung |
| Lagegerät, Verteilung, Aufbau | `electrical` | Gebäude/Verteilung |

Core bleibt frei von Electrical-Begriffen; fachliche Vorlagen und Verteilungsregeln liegen im Modul.

### 10.2 Öffentliche Schnittstellen (unter `/api/v1/modules/electrical`, Pydantic/OpenAPI als Quelle)

```text
GET/PUT   /planning-defaults                                   If-Match (Betrieb)
GET/POST  /cable-templates · PATCH /cable-templates/{id}       If-Match; Löschen nur ungenutzt, sonst deaktivieren
GET/PUT   /projects/{project_id}/planning-defaults             If-Match (Projekt)
GET       /projects/{project_id}/planning-defaults/effective   aufgelöste Werte + Herkunft (für den Dialog)
POST      /projects/{project_id}/planning-defaults/preview     nur lesend
POST      /projects/{project_id}/planning-defaults/apply       atomar
PUT/DELETE /distribution-boards/{id}/placement                 If-Match (Verteilung)
GET/PUT   /distribution-boards/{id}/layout                     If-Match (layout_version)
GET/POST  /board-component-presets · PATCH/DELETE …/{id}
GET/POST  /board-layout-templates · PATCH/DELETE …/{id}
POST      /distribution-boards/{id}/layout/apply-template      {template_id, expected_layout_version}
Core:     /me/preferences  + flags
Erweitert: CableIn (end_device_id optional, assign_devices, reserve_mode/percent, *_origin, cable_template_id, defaults_basis),
           CableOut (reserve_effective_mm, connection_allowance_mm, Herkunft), Mengenübersicht (Reserve getrennt)
```

Keine neuen Events (kein Konsument); `electrical.plan.updated` bei Platzierung wie bisher. Alle
Konsistenzprüfungen synchron in derselben Transaktion.

### 10.3 Migrationen (ein Alembic-Strang)

| Schritt | Migration | Bestand |
|---|---|---|
| 6c.1 | Core `user_preference_flags` | keine Daten berührt |
| 6c.4 | `electrical_cable_templates`, `electrical_planning_defaults`, `electrical_device_type_cable_templates`, `electrical_project_planning_defaults`, `electrical_project_device_type_cable_templates`; `electrical_circuits.proposal_overrides_templates` (boolean, **für alle vorhandenen Stromkreise `false`**); `electrical_cables`: `end_device_id` NULL, `reserve_mode` (Default `fixed`), `reserve_percent`, `spec_origin`/`reserve_origin`/`allowance_origin` (Default `legacy`), `cable_template_id`; Recht `electrical.defaults.manage` per Seed | Leitungen unverändert lang; Herkunft `legacy` |
| 6c.7 | `electrical_board_rows`, `electrical_board_components`, `electrical_board_component_presets`, `electrical_board_layout_templates` (+ Reihen/Komponenten), Spalten an Verteilungen | Verteilungen ohne Aufbau |

Alle Tabellen mit `organization_id`, zusammengesetzten Fremdschlüsseln (ADR 0006), ganzzahligen mm
(ADR 0007), Prozent/Querschnitt als `numeric` (ADR 0005). Vorlagen werden bei Nutzung nicht gelöscht
(`RESTRICT`), sondern deaktiviert. Projektlöschung (`ProjectContentParticipant`): Projektvorgaben,
Komponenten, Reihen vor den Verteilungen.

### 10.4 Rechte

| Vorgang | Recht |
|---|---|
| Betriebsstandard, Kabelvorlagen, Gerätetypzuordnung, Komponenten- und Aufbauvorlagen | `electrical.defaults.manage` (neu; Standard: nur Administrator – Annahme, siehe §14) |
| Projektvorgabe ändern, zentrale Anwendung, Leitungsabweichung | `electrical.route.write` |
| Endgerät beim Speichern zuordnen | zusätzlich `electrical.circuit.write` |
| Verteilung platzieren/umsetzen | `electrical.circuit.write` **und** `electrical.plan.write` |
| Aufbau bearbeiten, Vorlage anwenden | `electrical.circuit.write` |
| Lesen aller Vorgaben/Vorlagen | `electrical.plan.read` |
| Anzeigeschalter | eigene Mitgliedschaft (kein Recht nötig, wie Einstellungen) |

### 10.5 Versionen, Sperren, Transaktionen, Schutz

* Eigene Versionen: Betriebsstandard, Kabelvorlage, Projektvorgabe, Leitung, Verteilung, Aufbau
  (`layout_version`), Vorlagen.
* Projektbezogene Schreibvorgänge sperren **zuerst das Projekt**. Für Projektvorgaben braucht der Core
  einen generischen `FloorPlanningAccess.writable_project_context(project_id)` (B12; neben
  `writable_building_context`, ohne Fachwissen; Eintrag in `CORE_PUBLIC_SURFACE`).
* Betriebsweite Vorgaben sperren nur ihre eigene Zeile; sie ändern **keine** Projektdaten – deshalb auch
  für abgeschlossene/archivierte Projekte folgenlos.
* `completed`/`archived`: Projektvorgabe, zentrale Anwendung, Platzierung, Aufbau, Leitungen → `409`
  über die Projektsperre; Lesen und Vorschau bleiben möglich (Vorschau zeigt „schreibgeschützt“).
* Vorschau und effektive Vorgaben lesen unter der geteilten Projektsperre (`consistent_building_context`
  bzw. projektweite Entsprechung) – ein Planungsstand je Antwort.

### 10.6 Browser-Cache und Kontextwechsel

* Vorgaben, Vorlagen und Aufbau liegen im **sitzungsgebundenen** Query-Client, Schlüssel mit Organisation
  bzw. Projekt; `signal` wird weitergereicht; Dialoge laden beim Öffnen frisch.
* Benutzer- oder Betriebswechsel baut den Sitzungsraum ab – mit ihm Entwürfe, Platzierungs- und
  Aufbauentwürfe (wie bisher).
* Anzeigeschalter nur im Einstellungscache je Mitgliedschaft (§5.2).
* Nach Vorgabenänderung werden `effective`-Abfragen der Projekte invalidiert; offene Dialoge verhalten sich
  nach §8.6.

---

## 11. Abgelöste und präzisierte Entscheidungen

| Bisher | Ab 6c (vorbehaltlich Freigabe) | Wo |
|---|---|---|
| ADR 0026 **D5**: Zugaben/Reserve nur ausdrücklich je Leitung, keine Projektstandardwerte | **abgelöst:** Betriebs- und Projektvorgaben als Vorschlagsquellen; prozentuale Reserve; weiterhin keine Laufzeitvererbung und keine stille Änderung bestehender Leitungen | ADR 0027 |
| ADR 0026 Nr. 9: Zugaben/Reserve ausschließlich aus der Leitung, nur feste mm | **präzisiert:** Reserve aus gespeichertem Prozentsatz abgeleitet oder fest; Zugaben fest | ADR 0027 |
| ADR 0026 Nr. 4 / §3.2 / 6b.4: neue Leitungen werden aus dem **aktuellen Stromkreisvorschlag** vorbelegt | **abgelöst (F1):** vorbelegt wird aus der Gerätetypvorlage; der Stromkreis nur bei ausdrücklich aktivierter Vorgabe (Stufe 2 der Kette §8.3) | ADR 0027 |
| ADR 0026 Nr. 4: Leitung zwischen **zwei** Geräten | **präzisiert:** Endgerät darf fehlen; Leitung dann `incomplete` | ADR 0027 |
| 6b §9.1 / §19.1: neue Leitung beginnt mit Stromkreiswahl und Seitenformular | **abgelöst:** §7 (Start → Verlauf → Ziel → Abschlussdialog) | dieser Entwurf |
| ADR 0026 D1 / 6b.1: Lage über ein frei gesetztes Gerät, Verknüpfung im Verteilungsdialog | **präzisiert:** Lagegerät nur über den Platzierungsablauf, atomar | ADR 0028 |
| ADR 0021: persönliche Einstellungen = genau drei Werte | **erweitert:** modulbezogene Ja/Nein-Anzeigeschalter in derselben Ressource | ADR 0029 |
| Roadmap: Phase 7 hängt von Phase 6 ab | Phase 7 hängt von **6c** ab | `roadmap.md` |

---

## 12. Umsetzungsschritte

| Schritt | Inhalt | Grenze | Aufwand (relativ) |
|---|---|---|---|
| **6c.0** | Planungsarbeitsfläche (Grundriss, Wand, Decke): Eigenschaften einklappbar/überlagernd, Maximieren, Kontextleiste mit Status und Fehlern, `SymbolKnopf`, Undo/Redo-Icons, Kürzel `M`/`E`; `useDialogVerwerfenSchutz`; Richtlinie in `architecture.md` | nur Frontend, keine API | M |
| **6c.1** | 3D „Leitungen anzeigen“; Core-Präferenzschalter (ADR 0029), Migration, Cache-Version 3; Wandgeräte/Deckengeräte/Beschriftungen ebenso (F4) | keine Fachdaten | S–M |
| **6c.2** | Formulare nach Richtlinie: Gebäude/Geschoss/Höhenlage, Steigweg-Editor als großer Dialog, Stammdaten lesend + Dialog | keine API | M |
| **6c.3** | Verteilung platzieren/zeigen/umsetzen: Endpunkt `placement`, Platzierungsentwurf, Palette ohne freien Typ „Verteilung“, Altbestand-Hinweis | keine Migration | M |
| **6c.4** | Vorgaben und Kabelvorlagen (Backend): Migration, Dienste, API, Recht, Seed; `end_device_id` optional; Längenfunktion mit Prozentreserve (Backend, Frontend-Spiegel, Fixture); Mengenübersicht mit getrennter Reserve; `writable_project_context` | Oberfläche nur Lesen | L |
| **6c.5** | Neuer Leitungsablauf: Zeichnen ohne Vorab-Formular, Abschlussdialog mit Herkunft, Stromkreisableitung, Zuordnung beim Speichern; Verwaltung Betriebsstandard/Kabelvorlagen/Projektvorgabe als Dialoge; `Leitungsbereich` zurückgebaut | – | L |
| **6c.6** | Zentrale Anwendung mit Vorschau (Backend + Oberfläche) | – | M |
| **6c.7** | Verteilungsaufbau: Migration, Aufbau-API, Komponenten- und Aufbauvorlagen, Aufbaueditor, Hinweisregeln, Abgleich Stromkreisangaben | – | L–XL |
| **6c.8** | Gemeinsame Prüfung (Prüfliste 6c), Nachkorrekturen, Dokumentation | Exit 6c | S–M |

**Begründung der Reihenfolge:** 6c.0 zuerst, weil Platzierung, Leitungsablauf und Aufbaueditor die
Kontextleiste und die Arbeitsfläche voraussetzen. 6c.1 und 6c.2 sind unabhängig und klein und liefern
früh Nutzen (Bevorzugung des Auftraggebers: Layout, Dialoge, Werkzeuge, 3D zuerst). Die Platzierung
(6c.3) kommt vor dem Leitungsablauf, weil der typische Start „ab UV1“ eine platzierte Verteilung braucht
und der Platzierungsentwurf das Muster „kleiner Entwurf + Kontextleiste“ erprobt. Die Vorgaben (6c.4)
müssen im Backend stehen, bevor der Abschlussdialog (6c.5) sie vorbelegen kann; die zentrale Anwendung
(6c.6) braucht die Herkunft an den Leitungen. Der Verteilungsaufbau (6c.7) ist fachlich unabhängig, aber
der größte Schritt; er nutzt `defaults.manage` und die Arbeitsfläche und steht deshalb am Ende.
Jeder Schritt ist für sich nutzbar und einzeln abnehmbar.

---

## 13. Abnahmekriterien und Tests

**Bedienung**
1. Grundriss, Wand- und Deckenansicht: Eigenschaften beim Öffnen eingeklappt; aufgeklappt ≤ 340 px;
   maximiert ohne Kopf/Reiter; „Normale Ansicht“, `M`, Escape führen zurück; schmal überlagert das Panel
   und ist schließbar; bei 375 px kein horizontales Scrollen der Seite.
2. Umschalten (Panel, Maximieren, Fenstergröße) erhält Maßstab exakt und Weltmitte, Auswahl, Werkzeug,
   Entwurf und Undo-Historie; **kein** Einpassen; Zeichenfläche nicht neu eingehängt (Komponententest mit
   Ref-Identität und Viewport-Vergleich; Browserprüfung).
3. Speicherfehler und Konflikte erscheinen in der Kontextleiste auch bei eingeklapptem Panel.
4. Rückgängig/Wiederholen: gebogene Pfeile, zugänglicher Name, Tooltip mit Kürzel, `aria-keyshortcuts`,
   gesperrt erkennbar; Kürzel unverändert.
5. Dialoge nach §3.1: ein Scrollbereich, Schließen mit Änderungen fragt, Fehler im Dialog, keine
   Dialogketten (Tests je umgestelltem Ablauf aus §3.3).
6. Leitungsablauf: Start → Punkte → Ziel öffnet den Dialog; Doppelklick beendet mit **genau einem** Punkt;
   Enter/„Abschließen“ ebenso; Fang, Hilfslinien, Undo/Redo, Flächen- und Geschosswechsel unverändert;
   „Weiterzeichnen“/X/Escape verlieren nichts; Speichern mit Standardwerten in **einem** Klick.
7. Platzierung: „Im Plan platzieren“ → Geschoss/Raum → Wand → Lage → speichern; „Im Plan zeigen“;
   „Position ändern“; Palette bietet keinen freien Typ „Verteilung“.
8. 3D: Schalter „Leitungen“ unabhängig von Beschriftungen; ausgeblendete Leitungen nicht anklickbar;
   gewählte Leitung wird beim Ausblenden abgewählt (Statustext); Liste bietet „Einblenden“.

**Datenbestand**
9. Migration 6c.4: jede Bestandsleitung behält Werte und Länge; Mengenübersicht vor/nach identisch;
   Herkunft `legacy`, Modus `fixed`.
10. Platzierung: nie zwei Lagegeräte für eine Verteilung, nie Lagegerät ohne Verknüpfung (auch bei
    Doppelklick, Abbruch, Fehler); Raumentwurf mit fremden Änderungen wird nie mitgespeichert.
11. Vorgabenänderung ändert keine Leitung; zentrale Anwendung ändert genau die angehakten Gruppen der
    angehakten Leitungen; „abweichend“ und „Altbestand“ nur bei ausdrücklicher Wahl.
12. Aufbau: Komponenten-IDs stabil über Speichern; Stromkreis löschen löst Zuordnung sichtbar;
    Vorlage auf belegte Verteilung nur nach Vorschau.

**Berechnung** (gemeinsame Fixture Backend/Frontend)
13. Reserve: 8 500 / 20 % → 1 700; 8 333 / 20 % → 1 667; 4 001 / 12,5 % → 501; 0 % → 0; 100 % → g.
14. Nur bestätigte Leitungen haben Gesamtlänge; unvollständig/Konflikt: Teilsumme ohne Prozentreserve,
    ausdrücklich gekennzeichnet; feste Altreserve unverändert.
15. Kette §8.3/§8.4: je Stufe ein Test; Start an Verteilung; Start/Ziel mit verschiedenen Vorlagen;
    inaktive Vorlage; aktivierte, teilweise Stromkreisvorgabe ohne Mischung; **Stromkreiswerte ohne Aktivierung
    werden nicht vorbelegt** (nur Hinweis); Aktivierung schlägt Gerätetypvorlage; Leitungsabweichung schlägt
    aktivierte Stromkreisvorgabe.
15a. Migration: alle vorhandenen Stromkreise `proposal_overrides_templates = false`, auch solche mit
    vollständigem Vorschlag; Bestandsleitungen unverändert (Angaben, Herkunft `legacy`).
16. Mengenübersicht: Weg, Reserve, Zugaben getrennt; Gruppen weiterhin nach tatsächlichen Angaben.

**Rechte und Mandanten**
17. `defaults.manage`, `route.write`, `circuit.write`, `plan.write` je Schreibweg getrennt (`403`);
    Endgerätzuordnung beim Speichern ohne `circuit.write` → `403`, nichts gespeichert.
18. Fremde Organisation: Vorlagen, Vorgaben, Aufbau, Platzierung → `404` ohne Existenzauskunft; Sweep
    über alle neuen Routen; DB-FK-Probe.
19. `completed`/`archived`: Projektvorgabe, Anwendung, Platzierung, Aufbau, Leitungen → `409`; Lesen und
    Vorschau möglich.
20. Anzeigeschalter: nur eigene Mitgliedschaft; unbekannter Schlüssel `422`; anderer Betrieb eigener Stand.

**Parallelität (PostgreSQL)**
21. Zwei Platzierungen derselben Verteilung gleichzeitig → genau eine gewinnt, ein Lagegerät.
22. Platzierung gegen Raumentwurf desselben Raums → eine `409`, nichts inkonsistent.
23. Zentrale Anwendung gegen Leitungsänderung → `409`, nichts geändert; gegen Vorgabenänderung → `409`.
24. Leitung speichern gegen Vorgabenänderung → `409 planning-defaults-changed`, Entwurf bleibt.
25. Aufbau speichern zweimal mit gleicher `layout_version` → eine `409`; Aufbau gegen Stromkreis löschen.
26. Einstellungen von zwei Geräten → vorhandener Konfliktablauf, Schalter inklusive.

**Rückkehr- und Entwurfsschutz**
27. Navigationsschutz für Platzierungs-, Leitungs-, Aufbauentwurf; Geschosswechsel im Leitungsentwurf
    ohne Rückfrage; anderes Gebäude/Projekt/Abmelden mit Rückfrage.
28. Rückkehr aus 3D und aus der Mengenübersicht unverändert; „Im Plan zeigen“ führt zurück zu
    „Stromkreise“; Maximierung und Panel stören die Rückkehr nicht.

**Architektur**
29. import-linter grün; Core ohne Electrical-Begriffe (Test: keine `electrical`-Strings im Core außer
    Registrierungen); ein Alembic-Head; OpenAPI-Drift grün; keine neuen Events; keine gespeicherten Längen
    oder Reservebeträge.

---

## 14. Entscheidungen (getroffen 2026-10-15)

| # | Frage | Entscheidung |
|---|---|---|
| **F1** | Vorrang zwischen Stromkreisvorschlag und Gerätetypvorlage | **entschieden, abweichend von der Empfehlung:** Standard ist die **Gerätetypvorlage**; eine Stromkreisvorgabe hat nur Vorrang, wenn am Stromkreis ausdrücklich „Für neue Leitungen dieses Stromkreises diese Kabelvorgabe verwenden“ aktiviert ist. Kette: Leitungsabweichung → aktivierte Stromkreisvorgabe → Gerätetypvorlage (Projekt/Betrieb) → allgemeine Standardvorlage → sichtbar fehlend. Migration: vorhandene Stromkreise nie aktiviert; Bestandsleitungen unverändert (§8.3, §8.5, §10.3) |
| **F2** | Rundung der Prozentreserve | **bestätigt:** Prozent auf die geometrische Länge, auf ganze mm **aufgerundet**; Prozentsatz mit höchstens zwei Nachkommastellen (§8.7) |
| **F3** | erste Komponentenarten | **bestätigt:** Hauptschalter, FI, LS, FI/LS, Überspannungsschutz, Klemme, Sonstiges; manuell bedienbarer Aufbau mit konfigurierbaren Teilungseinheiten, Freitextangaben und wiederverwendbaren Vorlagen; keine automatische elektrische Auslegung (§9) |
| **F4** | weitere 3D-Schalter speichern | **bestätigt:** auch Wandgeräte, Deckengeräte und Beschriftungen über die bestehende persönliche Einstellungsstruktur; Umsetzung in 6c.1 (§5) |
| **F5** | Umsetzen einer Verteilung mit Leitungen | **bestätigt:** an eine andere Wand abgelehnt, solange Leitungen am Lagegerät hängen; die Meldung nennt die betroffenen Leitungen verständlich (Stromkreis, Bezeichnung, Endgeräte) (§6.4) |

**Dokumentierte Annahmen** (ohne erhebliche Auswirkung, änderbar): `electrical.defaults.manage` erhält
standardmäßig nur der Administrator; Anschlusszugaben je Endpunktart (Verteilung/Abzweigdose/Gerät) statt
je Gerätetyp; Projektvorgaben können keine eigenen Vorlagen anlegen, nur Betriebsvorlagen wählen;
Kürzel `M` (Maximieren) und `E` (Eigenschaften).

---

## 15. Ausdrücklich nicht in 6c

Materialstamm, Artikel, Preise, Kalkulation, Verschnitt- und Verpackungsregeln (Phase 7/8) ·
Bemessung, Kennlinien, Selektivität, Spannungsfall, Phasenverteilung, Normprüfung, Konformitätsaussagen ·
automatische Wegfindung oder automatische Aufbauerzeugung · allgemeine Regel-Engine, Skriptsprache,
Bedingungsausdrücke · Stromlaufplan, Beschriftungs- und PDF-Druck · freie 3D-Bearbeitung · mehrere
Stromkreise in einer Leitung · Umhängen von Leitungen beim Umsetzen einer Verteilung (F5 bestätigt).

---

## 17. Umsetzungsstand 6c.0 (2026-10-15)

> **Stand 2026-10-16:** vom Auftraggeber **nicht abgenommen** – überarbeitungsbedürftig (§18). Der Baustein bleibt Grundlage (Panel, Maximieren, Erhalt des Viewports, Undo-Symbole); Breite, Kopf, Werkzeugleiste und Leitungsablauf werden mit L1/L2 neu gefasst.

**Status:** technisch umgesetzt, automatisiert geprüft (Frontend) und im laufenden Entwicklungsstack geprüft
(§17.5, zwei Befunde behoben), **nicht committet**; die manuelle Abnahme durch den Auftraggeber steht aus. Keine Backendänderung, keine Migration, keine API-Änderung (`openapi.json` unverändert).

### 17.1 Umfang

| Thema | Umsetzung |
|---|---|
| Gemeinsamer Baustein | `arbeitsflaeche/Planungsarbeitsflaeche.tsx` mit `useArbeitsflaeche()` für Grundriss, Wand- und Deckenansicht: Kopf (Status, Speichern), Werkzeugleiste, Zeichenbereich, Eigenschaftenpanel, Kontextleiste |
| Breite | nur die Karte des Grundrisseditors tritt aus der 1 100-px-Spalte heraus (`.ep-arbeitsflaeche-breit`, `min(100vw − 2,5 rem, 120 rem)`, mittig); Verwaltungsseiten unverändert; Wand-/Deckenansicht nutzen wie bisher den großen Dialog |
| Eigenschaften | standardmäßig eingeklappt; Knopf „Eigenschaften“ (Symbol, Text, `aria-expanded`, `aria-controls`, Kürzel E, Markierung „Leitung“/„Zuordnung“ bei offenem Entwurf); aufgeklappt 280–340 px mit eigenem Scrollbereich; schmal (< 60 rem) überlagernd und schließbar; eingeklappt bleibt das Panel eingehängt (Eingaben behalten ihren Stand), ist aber `inert` und `aria-hidden` |
| Maximieren | „Zeichenfläche maximieren“ (M) – Arbeitsfläche füllt das Fenster, Seitenkopf und Reiter verdeckt, Seite gesperrt; die Zeichenfläche ist maximiert nie kleiner als normal (mindestens `max(62dvh, 420px)`, sonst der Rest des Fensters), die Kontextleiste dort höchstens 25 % hoch, bei Platzmangel scrollt der Rahmen; Rückweg „Normale Ansicht“ mit sichtbarem Text, M oder Escape als letzte Stufe |
| Erhalt | Layoutwechsel schalten nur Klassen an denselben Elementen – kein Portal, kein anderer Elternknoten, kein Schlüsselwechsel; die Flächen behalten ihren Viewport, eine Größenänderung läuft über `groesseAendern` (Maßstab und Weltmitte), eingepasst wird nicht. Während einer Zeigerbewegung wechselt das Layout nicht. Panel- und Maximierungszustand des Grundrisses hält der Projekt-Tab – er übersteht Geschoss- und Ansichtswechsel |
| Kontextleiste | Raumentwurf: Speicherfehler/Konflikt mit „Serverstand laden“ / „Entwurf vorerst behalten“ (vorher nur in der Seitenspalte); Grundriss: Leitungs-/Zuordnungsentwurf mit Speichern, Schließen, „Angaben und Wegpunkte“ und kompaktem Fehler; Ebenen-/Höhenwahl und Steigwegwahl beim Zeichnen; Wand/Decke: Statuszeile, „Raum bearbeiten“-Hinweis, Außenseiten-Hinweis, Entwurfsleiste mit Speichern/Schließen und Fehlern, solange das Panel zu ist |
| Undo/Redo | `RueckgaengigKnoepfe` mit `Undo2`/`Redo2` über den neuen `core/ui/SymbolKnopf.tsx`: zugänglicher Name, eigener Hinweis bei Zeigen **und** Fokus mit Kürzel, `aria-keyshortcuts`; gesperrt fokussierbar (`aria-disabled`), deutlich blasser, Grund im Hinweis. Der Hinweis
hängt bündig am Knopfrand (links, bei Knöpfen am rechten Rand rechts) – nie mittig, sonst ragte er aus dem Fenster. Ein Paar je Fläche, wirkt auf den aktiven Entwurf (Leitung vor Raum) – in der Wand-/Deckenansicht ersetzt es die bisherigen zwei Textpaare |
| Tastatur | M/E nur ohne Modifikator, nicht bei Wiederholung, nicht in Eingabefeldern, nicht wenn ein Dialog offen ist, der die Arbeitsfläche nicht enthält (Rückfragen, darüberliegende Ansichten). Escape-Kette: Bewegung → Werkzeug → Auswahl (Wand, Ecke, Öffnung, Gerät) → überlagerndes Panel → Maximierung → bisheriges Verhalten (Raumauswahl bzw. Ansicht schließen) |

### 17.2 Präzisierungen (ohne neue fachliche Entscheidung)

* Das Panel öffnet sich **nicht** von selbst – auch nicht, wenn eine Ansicht mit gewählter Öffnung geöffnet
  wird; der Zustand bleibt vorhersehbar. Die Kontextleiste bietet „Angaben und Wegpunkte“ bzw. „Details“.
* Fokus: Öffnen per Knopf setzt den Fokus in den Panelkopf, Schließen gibt ihn an den Auslöser zurück; E
  verschiebt den Fokus nicht.
* Höhe des Grundrisses: die Höhe der Fläche ist `max(62vh, 420px)` (vorher fest im
  Zeichenflächenelement), maximiert die volle verbleibende Höhe.

### 17.3 Tests

Neu: `arbeitsflaeche/Planungsarbeitsflaeche.test.tsx` (11: Standard eingeklappt/inert/verborgen, Fokus beim
Öffnen und Schließen, Markierung, kein Neueinhängen samt erhaltenem Komponentenzustand, M/E und deren
Sperren in Feldern, bei Modifikator, Wiederholung und fremdem Dialog, kein Layoutwechsel während einer
Zeigerbewegung, Escape-Reihenfolge schmal/breit, Undo/Redo-Namen, -Hinweise, -Kürzel und gesperrter Zustand,
Entwurfsleiste mit Konflikt und Speichern bei geschlossenem Panel), `arbeitsflaeche/Arbeitsflaeche.editor.test.tsx`
(7, echter Grundrisseditor: dieselbe Zeichenfläche und Viewport-Transformation, Werkzeug, Auswahl, Raumentwurf
und Undo-Verlauf über Ein-/Ausklappen und Maximieren; gesperrtes Undo; Escape zuletzt; Kürzel unter einer
Rückfrage; Konflikt bei geschlossenem Panel sichtbar und außerhalb des Panels; Erhalt über Geschosswechsel),
`Leitungsplanung.test.tsx` (1: Wandansicht mit Leitungsentwurf über Ein-/Ausklappen und Maximieren,
Speichern und Fehler aus der Kontextleiste, „Details“ öffnet das Panel).

**Angepasste Bestandstests:** Weil das eingeklappte Panel für Hilfstechnik verborgen ist, öffnen Tests, die dort
etwas bedienen, es jetzt wie ein Benutzer (`arbeitsflaeche/testhilfe.ts`: `eigenschaftenOeffnen`,
`raumInListe`). Keine Prüfung entfernt oder abgeschwächt. Ein neuer Integrationstest erhielt ein ausdrückliches
Zeitlimit (20 s) für den langen Ablauf und setzt seinen Ablehnungs-Mock im eigenen `afterEach` zurück – ohne das
hatte ein Zeitüberschreitungslauf den Folgetest beeinflusst.

**jsdom ist kein geometrischer Nachweis:** Ohne Layout und `ResizeObserver` belegen die Tests Erhalt im Baum und
unveränderte Transformation, nicht Pixelmaße beim echten Größenwechsel.

Läufe: Frontend **1 159 Tests** (100 Dateien) grün, Typecheck, ESLint, Frontend-Modulgrenzen, Build grün;
API-Drift: OpenAPI exportiert, unverändert, „API-Client ist aktuell“. Kein Backendlauf (Backend unverändert).

### 17.4 Grenzen

* Die übrigen Formulare (Gebäude, Geschoss, Steigweg, Stammdaten) sind unverändert – Schritt 6c.2.
* Der Leitungsablauf ist der bisherige (Stromkreis zuerst, Formular im Panel) – Schritt 6c.5.
* Zoom-Knöpfe `+`/`−` und „Ansicht zurücksetzen“ bleiben Textknöpfe.

### 17.5 Prüfung im laufenden Stack (2026-10-15)

Entwicklungsstack per Docker, Planner-Container nach den Änderungen regulär neu gestartet (keine Daten,
Volumes oder Migrationen verändert). Angemeldet hat sich der Auftraggeber selbst im Browser-Bereich. Prüfprojekt
PR-2026-0010; ein Prüf-Leitungsentwurf wurde am Ende über die vorhandene Rückfrage verworfen – nichts gespeichert.
Messwerte aus dem Browser (`getBoundingClientRect`, Transformation der Zeichenfläche):

| Ablauf | Ergebnis |
|---|---|
| Breite, Fenster 1 600 × 950 | Karte des Editors 1 545 px breit, mittig (20 px Rand), Zeichenfläche 1 519 × 589 px (vorher ≈ 750 px breit); kein waagerechtes Scrollen; Verwaltungsseiten unverändert 1 100 px |
| Grundriss: Zoom geändert, Ausschnitt verschoben, dann Panel auf/zu, maximieren, Panel im maximierten Zustand, zurück | Maßstab 0,14467 und Weltmitte (5 244 / 2 197 mm) in **jedem** Zustand gleich; dasselbe SVG-Element; Panel 340 px; maximiert 1 585 × 950 px |
| Fenster 1 600 → 731 px | Maßstab und Mitte unverändert; schmal überlagert das Panel, die Fläche behält ihre Breite |
| Offener Leitungsentwurf (2 Fußbodenpunkte) durch Panel auf/zu, Maximieren, M zurück | 2 Wegpunkte, Undo aktiv, Entwurf offen, Maßstab und Mitte gleich; Markierung „Leitung“ am Eigenschaftenknopf; Speichern in der Kontextleiste |
| Escape im maximierten Grundriss | beendet die Maximierung, der Entwurf bleibt |
| Wandansicht mit Leitungsentwurf (2 Wandpunkte), Zoom, Panel, Maximieren, zurück | Maßstab gleich, Verschiebung wächst um genau die halbe Größenänderung (Mitte erhalten), Rückkehr stellt die Transformation exakt her; Entwurfsleiste mit Speichern/Schließen/„Angaben und Wegpunkte“ bei geschlossenem Panel |
| Wechsel Wand → Decke im Entwurf | Deckenansicht mit eigenem (geschlossenem) Panel, Entwurfsleiste, Undo-Paar; Layoutwechsel wie in der Wand (Mitte erhalten, exakte Rückkehr) |
| 375 × 740, dunkles Theme (Theme-Attribut vorübergehend gesetzt, nichts gespeichert) | lesbar; Panel überlagert 300 px mit eigenem Scrollbereich und Schließen-Knopf; keine Seitenverbreiterung; nach dem Verkleinern bleibt der vorher vergrößerte Ausschnitt (kein Einpassen) |
| Hinweise | Undo gesperrt erkennbar blass, Hinweis „Rückgängig (Strg+Z) – nichts rückgängig zu machen“ bei Zeigen und Fokus |
| Rückfrage „Leitungsentwurf schließen?“ | vorhandener Dialog, kein Browser-`confirm`; Taste M bleibt darunter wirkungslos |

**Behobene Befunde:**

1. Der Hinweis hing mittig unter dem Knopf und ragte am linken Rand aus dem Fenster („Rückgängig (Strg+Z)“
   abgeschnitten) → bündig am Knopfrand (`hinweisAm`).
2. Maximiert bekam die Zeichenfläche in einem schmalen, niedrigen Fenster nur 275 px Höhe – weniger als normal
   (460 px), weil Kopf, umbrechende Werkzeuge und Kontextleiste den Platz nahmen → Mindesthöhe wie normal,
   Kontextleiste maximiert höchstens 25 %, der Rahmen scrollt bei Platzmangel (gemessen: 460 px).

**Nicht im Browser geprüft:** Speicherkonflikt des Raumentwurfs bei geschlossenem Panel (braucht eine
gleichzeitige Änderung; durch den Integrationstest abgedeckt), echte Touch-Bedienung, Fokusrückgabe nach dem
Schließen per echtem Klick (im Browser nur per Skript ausgelöst, wobei kein Fokus im Panel lag; durch den
Komponententest abgedeckt).

## 18. Überarbeitung (3. Fassung, 2026-10-16): Planungslayout und Leitungsablauf

**Anlass:** Der Auftraggeber hat 6c.0 **nicht abgenommen**. Die größere Zeichenfläche allein löst die
Bedienungsprobleme nicht. Die Schritte 6c.1–6c.8 sind zurückgestellt; Vorrang haben ein stimmiges
Planungslayout und der neue Leitungsablauf. Dieser Abschnitt **ersetzt** für Layout und Leitungsablauf §4,
§7.1–§7.2 und die Reihenfolge in §12. §3, §7.3–§7.5, §8–§11 und §14 gelten weiter, soweit hier nichts anderes
steht. **Nur Entwurf** – kein Produktivcode, keine Migration.

### 18.1 Befunde am bisherigen Ablauf

Grundlage: Code (`Leitungsbereich.tsx`, `useLeitungsplanung.ts`, `Wandleitungen.tsx`, `Deckenleitungen.tsx`,
`Grundrissleitungen.tsx`, `GrundrissLeitungsfeld.tsx`, `flaechen.ts`, `Wandansicht.tsx`, `Deckenansicht.tsx`)
und die Messungen im laufenden Stack vom 2026-10-15 (§17.5) auf genau diesem Stand. Eine erneute Browsersitzung am
2026-10-16 war abgelaufen (Anmeldeseite) – es wurde nicht neu angemeldet.

| # | Auslöser | Wirkung / Problem |
|---|---|---|
| A1 | Grundriss bei 1 600 × 950 öffnen | Projektkopf, Projektreiter, Gebäude-/Geschosswahl und Ansichtsleiste stehen in der 1 100-px-Spalte und reichen bis **y ≈ 720 px**; die Editorkarte darunter ist 1 545 px breit. Die Fläche liegt fast ganz unterhalb des Fensters und wirkt als isolierter, überbreiter Block – zwei verschiedene Breiten, zwei Fluchten |
| A2 | Werkzeugleiste Grundriss bei 731 px | 4 Zeilen: 7 Raum-/Öffnungswerkzeuge, Undo-Paar, Zoom (+, −, Ansicht zurücksetzen), Fang, Raster, dann Eigenschaften/Maximieren. Darüber eine Statuszeile mit Speichern/Verwerfen und dem langen Satz „Raumbearbeitung ruht, solange …“. Sekundäres (Raster, Fang, Ansicht zurücksetzen) steht gleichrangig neben Hauptwerkzeugen |
| A3 | Leitung beginnen | **Kein Leitungswerkzeug in der Werkzeugleiste.** Weg: Eigenschaften öffnen → in der Leitungsliste Stromkreis wählen → „Neue Leitung“. In der Wand-/Deckenansicht erscheint das Werkzeug „Leitung“ erst, **nachdem** ein Entwurf besteht (`leitungErlaubt = leitungsentwurf !== null …`) |
| A4 | „Neue Leitung“ | Stromkreis muss **vorher** gewählt werden; Startgerät wird still auf das Lagegerät der Verteilung gesetzt; Kabelangaben werden aus dem Stromkreis vorbelegt (entspricht nicht mehr F1) |
| A5 | Klick auf ein Gerät beim Zeichnen | nur Geräte des gewählten Stromkreises: sonst „weder die Verteilung noch dem Stromkreis zugeordnet – erst zuordnen“. Ist der Start gesetzt, wird ein Gerät **Endgerät, das Zeichnen läuft aber weiter**; kein Abschluss |
| A6 | Abschluss | nur Enter (beendet das Werkzeug) bzw. „Leitung speichern“ im langen Formular rechts (Bezeichnung, Start/Ende als Auswahllisten, drei Kabelfelder, drei Zugaben, Wegpunktliste, Ergebnis, Befunde, Arbeitsflächen, Modellgrenzen). **Kein Doppelklick**, kein Abschlussdialog |
| A7 | Klick auf die Fläche | der Punkt entsteht beim **Loslassen** (Drücken–Bewegen–Loslassen); eine kleine Mausbewegung verändert die Lage noch |
| A8 | rechtwinklige Führung an der Wand | automatisch: `rechtwinkligeLagen` wählt waagerecht oder senkrecht **nach Nähe des Zeigers** („der nähere Fall gewinnt“). Die Richtung kippt beim Bewegen; nicht wählbar, nicht vorher erkennbar. Eine Ecke entsteht nie von selbst – zwei Klicks nötig |
| A9 | Klick auf vorhandenen Wegpunkt | wählt ihn; **danach folgen neue Punkte diesem Punkt** (werden dahinter eingefügt). Wer nur kontrollieren oder verschieben wollte, zeichnet danach an falscher Stelle weiter |
| A10 | Fang | Vorrang: Anschlusspunkt → rechtwinklig → Fangziel (Geräteachse, Öffnungskante, Trasse, Zone, Raster); ist das Ergebnis ungültig, wird **still ohne Fang** gesetzt. Angezeigt wird das Ziel nur als Text in der Statuszeile |
| A11 | Grundriss, Ebene | vor jedem Punkt muss die Ebene Fußboden/Wand/Decke (1/2/3) passend gewählt sein; Wandpunkte nur in 5 festen Höhen (Auswahlliste). Klick auf eine Wand bei Ebene „Fußboden“ setzt einen Fußbodenpunkt auf der Achse – nicht naheliegend |
| A12 | Raumseite an Ecken | entscheidet der Raum unter dem Zeiger; auf der Linie selbst „mehrdeutig“ ohne sichtbare Wahl |
| A13 | Wechsel Wand → Nachbarwand/Decke | nur über „Arbeitsfläche wechseln (Entwurf bleibt erhalten)“ – zugeklapptes `details` im Seitenformular; in der Fläche gibt es keinen Hinweis an Wandende oder Oberkante |
| A14 | Steigweg im Grundriss | erst einen Fußboden-/Deckenpunkt genau am Halt setzen, dann Halt anklicken, dann Zielhalt im Seitenfeld wählen, dann ausdrücklich ins Zielgeschoss wechseln |
| A15 | Meldungen | Statuszeile unter der Wandfläche bzw. schwebender Hinweis oben rechts im Grundriss; ungültige Klicks werden erklärt, aber **erst nach** dem Klick („Nicht gesetzt: …“), die Vorschau zeigt rot ohne Text am Zeiger |
| A16 | Abbrechen/Schließen | „Entwurf schließen“ fragt bei Änderungen (gut); Escape beendet zuerst das Werkzeug, nicht die Leitung; „Weiterzeichnen“ gibt es nicht, weil es keinen Abschluss gibt |
| A17 | Wand-/Deckenansicht | eigene **modale Dialoge** mit eigener Kopfzeile, Werkzeugleiste und Panel: ein zweites Layout für dieselbe Arbeit; der Grundriss mit Projektkopf bleibt dahinter |

**Fazit:** Das Zeichnen ist technisch vollständig, verlangt aber vorab Stromkreiswahl und Formular, kennt keinen
Abschluss, entscheidet Richtungen und Einfügestellen unsichtbar und versteckt Flächenwechsel im Seitenformular.

### 18.2 Layout

**Ein Arbeitsbereich, eine Flucht.** Solange im Projekt „Räume & Grundriss“ mit einer zeichnenden Ansicht
(2D-Editor, Wand, Decke) aktiv ist, nutzt die **ganze Projektseite** dieselbe Breite (Projektkopf, Reiter,
Ansichtsleiste, Werkzeugleiste, Fläche – höchstens 120 rem, gleicher Rand). Keine Karte tritt mehr allein aus
der Spalte heraus (`.ep-arbeitsflaeche-breit` an der Editorkarte entfällt). Verwaltungsseiten bleiben bei
1 100 px. Die Höhe der Fläche ist **die restliche Fensterhöhe** unter Kopf und Werkzeugleiste (gemessen,
mindestens 420 px) – der ganze Arbeitsbereich passt ohne Seitenscrollen ins Fenster.

Breit (≥ 60 rem):

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Projekte  Gesamtprüfung Phase 6 · PR-2026-0010 · Entwurf          [In Bearbeitung nehmen] [⋯] │ Kopf, 1 Zeile
│ Stammdaten  Gebäude & Geschosse  Dateien  [Räume & Grundriss]                                   │ Projektreiter
│ Haus · EG ▾   [2D-Editor] 3D  Tabellen  Steigwege  Stromkreise  Mengen   ·  Grundriss › Diele › Wand 1 │ Ansicht + Pfad
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ [↖ Auswählen][✋] │ [▭ Raum ▾] [▯ Öffnung ▾] [⊕ Gerät] │ [⚡ Leitung hinzufügen] │ ↶ ↷ │ − 69 px/m + ⤢ │ [Ansicht ▾] [☰ Eigenschaften] [⛶] │
├───────────────────────────────────────────────────────────────────────────────────┬───────────┤
│                                                                                   │ Eigen-    │
│                              ZEICHENFLÄCHE                                        │ schaften  │
│                           (restliche Fensterhöhe)                                 │ (kontext- │
│                                                                                   │  bezogen) │
├───────────────────────────────────────────────────────────────────────────────────┴───────────┤
│ ① Startgerät ✓  ② Verlauf zeichnen  ③ Zielgerät oder Doppelklick · Nächster Klick: Wandpunkt 3,   │ Kontextleiste
│   Wand 1, 2,20 m · Länge bisher 7,40 m                [Abschließen …] [Abbrechen]  ⚠ Hinweis    │ (1–2 Zeilen)
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

Schmal (< 60 rem):

```
┌──────────────────────────────────────┐
│ ← PR-2026-0010 · Entwurf         [⋯] │ Kopf: Nummer, Status, Menü (Name im Menü/Titel)
│ Räume & Grundriss ▾  Haus · EG ▾     │ Reiter und Geschoss als Auswahl
│ 2D ▾   Grundriss › Diele › Wand 1    │ Ansicht als Auswahl, Pfad gekürzt
├──────────────────────────────────────┤
│ [↖][✋][▭▾][▯▾][⊕][⚡ Leitung] [⋯]     │ Hauptwerkzeuge als Symbole, Rest im Menü „⋯“
├──────────────────────────────────────┤
│                                      │
│            ZEICHENFLÄCHE             │  Eigenschaften als Überlagerung von rechts,
│                                      │  schließbar (wie 6c.0)
├──────────────────────────────────────┤
│ ② Verlauf zeichnen · nächster Klick: │
│ Wandpunkt 3 · [Abschließen][⋯]       │
└──────────────────────────────────────┘
```

**Werkzeugleiste – Gruppen (links nach rechts):** *Auswahl* (Auswählen V, Verschieben H) · *Bauen*
(Raum ▾: Rechteck R / Polygon P; Öffnung ▾: Tür T / Fenster N / Durchgang D; Gerät G – im Grundriss öffnet die
Wahl der Wand die Wandfläche) · *Elektro* (**Leitung hinzufügen** L; Durchführung U und Zuordnen Z im Menü
„Elektro ▾“ daneben) · *Verlauf* (↶ ↷) · *Ansicht* (− Maßstab + und „Ganz zeigen“ F) · rechts: *Ansicht ▾*,
*Eigenschaften*, *Maximieren*. Jede Schaltfläche: Symbol + kurzer Text (breit) bzw. nur Symbol mit Hinweis
(schmal), aktives Werkzeug deutlich hervorgehoben.

**Was entfällt, wird zusammengeführt oder verschoben:**

| Bisher | Neu |
|---|---|
| Projektkopf als große Karte (Kennwerte, Bearbeitungsinfo, Aktionen) über dem Editor | einzeilig; Details über „⋯“ bzw. Reiter „Stammdaten“ |
| Gebäude-/Geschosswahl als eigene Karte, Ansichtsleiste als zweite Reiterzeile | eine Zeile „Geschoss ▾ · Ansichten · Pfad“ |
| Editorkarte breiter als der Rest (`.ep-arbeitsflaeche-breit`) | ganze Seite in gemeinsamer Breite |
| Statuszeile „Kein Raum in Bearbeitung“ / „Raumbearbeitung ruht …“ mit Speichern/Verwerfen über der Leiste | Raumentwurf: Speichern/Verwerfen in der Kontextleiste, sobald ein Raum geändert ist; ohne Entwurf keine Zeile |
| Fang (Checkbox), Raster (Auswahl), „Ansicht zurücksetzen“ als Textknopf | Menü „Ansicht ▾“: Fang an/aus, Raster, Hilfslinien, Beschriftungen, Legende, Tastenkürzel; „Ganz zeigen“ als Symbol |
| „Bedienung und Tastenkürzel“ (aufklappbar unter der Fläche) | Menü „Ansicht ▾ → Tastenkürzel“ (Dialog) |
| Leitungsliste mit Stromkreiswahl und „Neue Leitung“ im Panel | „Leitung hinzufügen“ oben; Leitungsliste bleibt im Panel (Auswählen, Bearbeiten, Entfernen) |
| langes Leitungsformular im Panel (Entwurfsfeld) | **entfällt**; Angaben im Abschlussdialog, Wegpunkte nur in der Fläche (Liste optional im Panel „Wegpunkte“, nur lesen/auswählen) |
| Grundriss-Leitungsleiste (Werkzeug Grundriss/Leitung/Durchführung, Ebene 1/2/3, Höhenliste, Steighalt-Text, Legende) | Ebene entfällt (Fläche ergibt sich aus dem Klickziel, §18.4); verbleibende Wahl „Raumpunkt: Fußboden | Decke“ als Umschalter in der Kontextleiste; Legende im Menü „Ansicht“ |
| Wand- und Deckenansicht als **modale Dialoge** mit eigener Leiste | dieselbe Arbeitsfläche, Fläche wechselt **an Ort und Stelle** (Pfad „Grundriss › Diele › Wand 1“, Zurück mit Escape oder Pfad); Werkzeugleiste und Panel bleiben; jede Fläche behält ihren Viewport (F8) |
| „Arbeitsfläche wechseln“ im Formular | Wechselziele **in der Fläche**: Pfeile an Wandanfang/-ende („→ Wand 2“), Oberkante („↑ Decke“), Unterkante („↓ Fußboden im Grundriss“) |
| Maximieren | bleibt (M), wird seltener nötig |

**Eigenschaften kontextbezogen:** Das Panel zeigt, was gewählt ist (Raum, Wand, Öffnung, Gerät, Leitung, Wegpunkt),
sonst die Listen (Räume, Leitungen). Während des Zeichnens zeigt es höchstens die **Wegpunkte** der laufenden Leitung
(lesen, auswählen) – kein Formular. Standard eingeklappt, Zustand bleibt je Sitzung erhalten (6c.0).

**Erhalt bei Layoutwechseln:** unverändert verbindlich (§4.4): Klassenwechsel am selben Element, kein Einpassen;
beim Flächenwechsel bleibt die verlassene Fläche eingehängt und behält Viewport und Auswahl.

### 18.3 Leitungsablauf (verbindlich)

| Schritt | Anzeige (Kontextleiste) | Nutzer | Wirkung |
|---|---|---|---|
| A | „① Startgerät wählen“ | oben **Leitung hinzufügen** (L) | Werkzeug aktiv (hervorgehoben, Fadenkreuz); kein Formular, keine Stromkreiswahl. Geräte, die Start sein können, sind markiert; andere gedimmt mit Grund im Hinweis |
| B | „① Startgerät wählen“ | Klick auf ein Gerät | wird Startgerät; Kontext: „Start: UV1 (Diele, EG)“ |
| C | „② Verlauf zeichnen – nächster Klick: …“ | Klicks auf Fläche | je Klick genau ein Wegpunkt (oder eine sichtbar angekündigte Ecke + Punkt, §18.4) |
| D | „③ Zielgerät wählen oder offen abschließen“ | Klick auf ein Gerät | Zeichnen endet, **Abschlussdialog** öffnet |
| E | dto. | Doppelklick, Enter oder „Abschließen …“ | Zeichnen endet ohne Zielgerät, Abschlussdialog öffnet; Leitung ausdrücklich **offen** |
| F | Dialog | Angaben prüfen/ändern | Vorbelegung nach §18.6 |
| G | Dialog | **Leitung speichern** oder **Weiterzeichnen** | Speichern: gespeichert, Werkzeug bleibt aktiv für die nächste Leitung (Escape beendet); Weiterzeichnen: zurück zu ②, Verlauf, Eingaben und Ziel bleiben (Ziel wird beim Weiterzeichnen gelöst, der letzte Punkt bleibt) |

Der Stromkreis wird nicht vorab gewählt, sondern im Dialog aus den Zuordnungen abgeleitet (§7.3). Die
Werkzeugwirkung ist immer sichtbar: Mauszeiger, hervorgehobenes Werkzeug, Schrittanzeige und die Zeile
„Nächster Klick: …“ (z. B. „setzt Wandpunkt 3 · Wand 1 · 1,20 m von links · 2,20 m hoch“ bzw. „beendet am
Zielgerät Steckdose Arbeitsplatte“).

**Bestehende Leitung bearbeiten:** in Liste oder Fläche wählen → Kontextleiste „Verlauf bearbeiten“ (Gesten wie
oben, ohne Startschritt; Klick auf ein anderes Gerät = neues Ziel → Dialog) · „Angaben …“ (derselbe Dialog) ·
„Entfernen …“. Nur-Verlaufsänderungen speichern über Kontextleiste/Strg+S ohne Dialog.

### 18.4 Zeichengesten

| Thema | Regel |
|---|---|
| Vorschau | folgt dem Zeiger ab Schritt ②: gestrichelte Strecke vom letzten Punkt bis zur Zeigerlage **nach** Fang und Rechtwinkligkeit; Maße an der Strecke; gültig = Akzentfarbe, ungültig = Fehlerfarbe **mit Grund am Zeiger** („Strecke läuft durch Tür T1“) |
| Punkt setzen | **Klick** (Drücken und Loslassen ohne nennenswerte Bewegung, < 4 px) setzt den Punkt an der **angezeigten** Vorschaulage. Ungültige Vorschau: Klick setzt nichts, der Grund bleibt sichtbar |
| Gerät vs. Punkt | liegt der Zeiger auf einem Gerät, wird das Gerät hervorgehoben und „Nächster Klick: Zielgerät …“ angezeigt – Klick = Gerät. In Schritt ① reagieren nur Geräte. Einen Punkt **auf** einem Gerät setzt man mit „frei setzen“ (Alt, siehe Belegung unten) |
| Rechtwinklig an der Wand | zwingend (Modell). Liegt der Zeiger nicht auf einer Achse des letzten Punkts, zeigt die Vorschau eine **L-Führung mit sichtbarem Eckpunkt**: Standard **erst waagerecht, dann senkrecht**; **„Ecke wechseln“** (Knopf in der Kontextleiste, zusätzlich Taste K) schaltet auf „erst senkrecht“ und bleibt bis zum nächsten gesetzten Punkt. Ein Klick setzt Ecke und Punkt als **einen** Undo-Schritt. Keine Richtung kippt nach Zeigernähe |
| Fußboden/Decke | **F6 bestätigt:** Standard **rechtwinklige L-Führung** wie an der Wand; sichtbare Auswahl **„Rechtwinklig | Gerade“** in der Kontextleiste (zusätzlich Taste W), gilt bis zur nächsten Änderung; „Ecke wechseln“ wie an der Wand. Die Vorschau zeigt genau den entstehenden Verlauf. **Beide Teilstrecken** einer Ecke müssen gültig sein (in der Kontur, keine Raumgrenze ohne Übergang); ist eine ungültig, ist die Vorschau rot mit Grund („Teilstrecke 2 verlässt die Raumkontur“) und – falls zutreffend – „Andere Ecke wäre gültig: Ecke wechseln (K)“. Nichts wird still ersetzt |
| Fangziele | Gerätemitten und -achsen, Wandkanten/Ecken, Öffnungskanten, vorhandene Trassen, Durchführungen, Steighalte, Zonenhilfslinien, Raster. Das aktive Ziel wird **in der Fläche** markiert (Linie/Kreuz mit kurzem Text); „frei setzen“ (Alt) setzt es aus. Führt ein Fangziel zu einer ungültigen Lage, wird es nicht angeboten (Vorschau ohne dieses Ziel, Text „Fang ausgesetzt: …“) – nie still anders gesetzt als angezeigt |
| Punkt korrigieren | Ziehen eines vorhandenen Punkts (in jedem Werkzeug) verschiebt ihn – ein Undo-Schritt. Klick auf einen Punkt **wählt ihn nur** (Entf entfernt, Pfeiltasten verschieben); **neue Punkte werden immer am Ende** angefügt. Einfügen zwischen zwei Punkten nur ausdrücklich über den „+“-Griff in der Streckenmitte |
| Escape | bricht die **aktuelle Aktion** ab, in dieser Reihenfolge: Ziehen → Vorschau/Eckenangebot → Punktauswahl → (Schritt ① ohne Punkte) Werkzeug beenden. Mit Punkten fragt Escape **nicht** und verwirft nicht – „Abbrechen“ in der Kontextleiste fragt bei ungespeicherten Änderungen |
| Undo/Redo | Strg+Z/Y und ↶ ↷ wirken auf den Leitungsentwurf: Startgerät, jeder Punkt, jede Ecke+Punkt, jede Verschiebung, Bodenübergang, Durchführung je ein Schritt; Flächen- und Geschosswechsel sind kein Schritt |
| Doppelklick | erster Klick setzt den Punkt; ein Klick mit `detail ≥ 2` setzt **keinen** weiteren; `dblclick` öffnet den Abschlussdialog. Ergebnis: genau ein Punkt an der Stelle |
| Flächenwechsel | an der Wand: nahe Wandanfang/-ende erscheint „→ Wand 2“; ein Punkt an der Kante + Klick auf den Pfeil wechselt in die Nachbarwand und setzt dort den Anschlusspunkt (Ecke, gleiche Höhe) – sichtbar angekündigt. Oberkante: „↑ Decke“ (Übergang an derselben Stelle). Unterkante im Grundriss: „↓ Fußboden“. Im Grundriss: Klick **auf eine Wandlinie** = Wandpunkt (Höhe = Höhe des vorigen Wandpunkts; nach Fußboden 0, nach Decke Raumhöhe; nach Gerät dessen Mitte – vor dem Klick angezeigt; genaue Höhe in der Wandfläche), Klick **im Raum** = Fußboden- bzw. Deckenpunkt nach Umschalter „Raumpunkt“. Raumseite an Ecken: der Raum, in dem der Zeiger liegt; ist er nicht eindeutig, zeigt die Vorschau „Raum wählen“ und der Klick setzt nichts |
| Bodenübergang, Durchführung, Steigweg | Tür/Durchgang anklicken (Raumpunkt Fußboden) = Bodenübergang; Durchführung über „Elektro ▾ → Durchführung“ oder Alt+U an gemeinsamer Bauwand; Steighalt anklicken = setzt bei Bedarf den Punkt am Halt **sichtbar angekündigt** mit und öffnet die Steigwegwahl als kleinen Dialog (Zielhalt, Ausstieg, Vorschau), danach automatisch die Fläche im Zielgeschoss mit Fortsetzungspunkt am Halt (kein Speichern, Entwurf bleibt) |
| Ungültige Aktionen | Hinweis **an der Arbeitsfläche** (am Zeiger und in der Kontextleiste), bevor geklickt wird; was gezeigt wird, wird gesetzt |
| **Belegung der Zusatztasten (eindeutig)** | **Alt** = „frei setzen“: für diesen Klick weder Fangziel noch Gerät noch Anschlusspunkt – eine einzige Bedeutung. **Umschalt** hat beim Zeichnen keine eigene Wirkung (bleibt nur bei Pfeiltasten: 10 cm). **K** = Ecke wechseln, **W** = Rechtwinklig/Gerade, **Enter** = offen abschließen. Jede Taste hat einen sichtbaren Knopf in der Kontextleiste; keine Taste ist einziger Bedienweg |

### 18.5 Abschlussdialog

```
Leitung abschließen                                                    [×]
───────────────────────────────────────────────────────────────────────────
Verlauf     UV1 (Diele, EG) → Steckdose Arbeitsplatte (Küche, EG) · 6 Punkte
            ⚠ offen – kein Zielgerät (nur bei offenem Abschluss)
Stromkreis  [F3 Küche Steckdosen ▾]  aus Zuordnung des Zielgeräts
            ☑ Steckdose „Arbeitsplatte“ F3 zuordnen   (nur wenn nicht zugeordnet)
Bezeichnung [L7]
Kabel       Vorlage [NYM-J 3×1,5 ▾]  Gerätetyp Steckdose (Projektvorgabe)
            Typ [NYM-J]  Leiter [3]  Querschnitt [1,5] mm²            ⟲ Vorgabe
Reserve     [20] %   Betriebsstandard
Zugaben     Start [0,50 m] Verteilung · Ende [0,20 m] Gerät   Projektvorgabe
Ergebnis    Weg 8,50 m · Reserve 1,70 m · Zugaben 0,70 m · Gesamt 10,90 m  (bestätigt)
            offen/Konflikt: „Teilsumme 6,40 m – keine Gesamtlänge“
Hinweise    fehlende Angaben, Konflikte mit Ort; „Vorgaben sind Planungsangaben – keine Bemessung“
───────────────────────────────────────────────────────────────────────────
[Leitung speichern]  [Weiterzeichnen]                       [Entwurf verwerfen …]
```

* Ein Scrollbereich; Fokus auf „Leitung speichern“, wenn nichts fehlt, sonst auf das erste fehlende Feld.
* **Herkunft** an jeder vorbelegten Gruppe (§8.5); Änderung macht sie „abweichend“, „⟲ Vorgabe“ setzt zurück.
* Offener Verlauf: nie „bestätigt“, keine Gesamtlänge; Speichern erlaubt (Leitung bleibt `incomplete`).
* **×, Escape, Klick daneben = Weiterzeichnen** (nichts verloren). Verwerfen nur über „Entwurf verwerfen …“ mit
  Rückfrage. Versionskonflikt: Meldung im Dialog, Eingaben bleiben, „Serverstand laden“ ausdrücklich.
* Prioritätskette unverändert bestätigt: Leitungsabweichung → aktivierte Stromkreisvorgabe → Gerätetypvorlage
  (Projekt/Betrieb) → allgemeine Standardvorlage → sichtbar fehlend (§8.3, F1).

### 18.6 Was aus 6c.4 vorgezogen werden muss

Für einen **vollständigen** Ablauf (offener Abschluss, Zuordnung des Zielgeräts beim Speichern, Vorbelegung nach
F1, Reserve in %) braucht es Backend. Ohne Platzhalter oder Zwischenspeicher:

| Teil | nötig für | Schritt |
|---|---|---|
| `end_device_id` NULL, Status „Endgerät fehlt“ | E (offen abschließen) | V1 |
| `CableIn.assign_devices` (+ `circuit.write`, Stromkreisversion) | Ziel nicht zugeordnet | V1 |
| Kabelvorlagen, Betriebsstandard, Gerätetyp-Zuordnung, Projektvorgabe (Tabellen, API, Recht `defaults.manage`) | Vorbelegung F1 | V1 |
| `electrical_circuits.proposal_overrides_templates` (Bestand `false`) | Stufe 2 der Kette | V1 |
| Leitung: `reserve_mode`, `reserve_percent`, Herkunftsspalten, `cable_template_id`, Vorgabenbasis-Prüfung (`409 planning-defaults-changed`) | Reserve %, Herkunft, Versionsprüfung | V1 |
| Längenfunktion + Fixture: Prozentreserve aufgerundet (Backend/Frontend), Mengenübersicht mit getrennter Reserve | Ergebnis im Dialog, Mengen | V1 |
| `GET /projects/{id}/planning-defaults/effective` | Vorbelegung im Dialog | V1 |
| Verwaltungsdialoge Betriebsstandard/Kabelvorlagen/Gerätetypzuordnung, Projektvorgabe | Vorgaben überhaupt pflegen | L3 |
| zentrale Anwendung (6c.6), Verteilungsaufbau (6c.7), Platzierung (6c.3), 3D-Schalter (6c.1), Formulare (6c.2) | – | zurückgestellt |

### 18.7 Neue Reihenfolge (begrenzt, F7 entschieden 2026-10-16)

| Schritt | Inhalt | Backend | Aufwand |
|---|---|---|---|
| **L1 Planungslayout** | gemeinsame Seitenbreite und Höhenregel, kompakter Projektkopf, Ansichtszeile, gruppierte Werkzeugleiste mit „Leitung hinzufügen“, Menüs, Kontextleiste nur mit dem Nötigen; Wand/Decke in der Arbeitsfläche mit Pfad und Rückweg (F8). **Der bestehende Leitungsablauf bleibt**: „Leitung hinzufügen“ öffnet bis L2 das Panel an der Leitungsliste mit Stromkreiswahl und „Neue Leitung“ | nein | M–L |
| **V1 Vorgaben-Backend (aus 6c.4)** | §18.6: Kabelvorlagen, Vorgaben (Betrieb, Projekt, Gerätetyp), Stromkreis-Aktivierung, Prozentreserve, Herkunft, `end_device_id` NULL, `assign_devices`, Vorgabenbasis, `effective`-Endpunkt, Längenfunktion, Mengen; Migration, Seed, Tests gegen PostgreSQL | ja | L |
| **L2 Zeichenablauf** | Ablauf §18.3 Schritte A–E, Gesten §18.4, Flächenwechsel in der Fläche; Abschluss öffnet bereits den Dialog aus L3 – deshalb L2 und L3 als zwei Arbeitspakete, die gemeinsam ausgeliefert werden | nein | L |
| **L3 Abschlussdialog und Verwaltung** | Dialog §18.5 mit Kette F1, Herkunft, Reserve %, offenem Abschluss, Zielgerät zuordnen; Verwaltungsdialoge Betriebsstandard/Kabelvorlagen/Gerätetypen und Projektvorgabe; langes Formular entfällt | – | M–L |
| **P Gemeinsame Bedienungsprüfung** | Layout + Leitungsablauf im Stack, Abnahme | – | S–M |

**Begründung:** L1 ist unabhängig vom Backend und behebt A1, A2, A13, A17 sowie die Auffindbarkeit (A3). V1 vor
L2/L3, damit der Abschlussdialog von Anfang an nach der bestätigten Vorgabenkette vorbelegt und kein Zwischenstand
gebaut wird. Die übrigen 6c-Schritte (6c.1–6c.3, 6c.6, 6c.7, Formulare) folgen danach in neu zu vereinbarender
Reihenfolge; Phase 7 bleibt zurückgestellt.

### 18.8 Zusammenspiel mit Bestehendem

* **Vorhandene Leitungen** bleiben unverändert (Herkunft `legacy` erst mit V1); Bearbeiten mit denselben Gesten.
* **Geschossübergreifend:** Entwurf weiter am Gebäude (`LeitungsplanungProvider`); Steigweg wie §18.4, Abschluss im
  Zielgeschoss; Weiterzeichnen kehrt auf die Fläche des letzten Punkts zurück.
* **Durchführungen, Bodenübergänge, Steigwege:** dieselben Prüfungen (gemeinsame Längenfunktion); nur die Bedienung
  ändert sich.
* **Höchstens ein Entwurf** (Raum, Zuordnung, Leitung, Platzierung); „Leitung hinzufügen“ bei offenem Raumentwurf
  fragt mit der vorhandenen Rückfrage („Raumänderungen speichern/verwerfen“) – kein Autospeichern.
* **Unverändert:** Versionskonflikte, Navigationsschutz, Rechte (ohne `route.write` kein Werkzeug, Hinweis), Schreib-
  schutz abgeschlossener/archivierter Projekte (Werkzeug gesperrt mit Grund), persönliche Einheiten und Themes.

### 18.9 Rückfragen

| # | Frage | Empfehlung |
|---|---|---|
| **F6** | Fußboden/Decke: Standard rechtwinklig oder gerade? | **bestätigt (2026-10-16): rechtwinklig**; „Rechtwinklig/Gerade“ sichtbar wählbar, „Ecke wechseln“ als Aktion, Tasten zusätzlich, Vorschau = tatsächlicher Verlauf, beide Teilstrecken gültig, nichts still ersetzt (§18.4) |
| **F7** | L2 vor V1 oder V1 zuerst? | **entschieden (2026-10-16): V1 vor L2/L3**, abweichend von der Empfehlung. Kein vorübergehender Abschlussdialog mit veralteter Vorgabenlogik; der bestehende Ablauf bleibt bis dahin funktionsfähig |
| **F8** | Wand und Decke in derselben Arbeitsfläche? | **bestätigt (2026-10-16)** – Wechsel über Pfad und sichtbare Aktionen, keine modalen Dialoge mit eigener vollständiger Werkzeugleiste |

### 18.10 Empfehlung für den ersten Implementierungsschritt

**L1 Planungslayout** – nur Frontend, ohne Backend und ohne Änderung der Fachlogik: gemeinsame Breite und
Fensterhöhe, einzeiliger Kopf und Ansichtszeile, gruppierte Werkzeugleiste mit „Leitung hinzufügen“ (führt in L1
noch in den bisherigen Ablauf über die Leitungsliste; der neue Ablauf folgt mit L2), Menüs „Ansicht ▾“/„Elektro ▾“, Wand/Decke in der Arbeitsfläche (bei
Zustimmung zu F8). Abnahme mit Messung im Stack (Kopfhöhe, Fläche im Fenster ohne Seitenscrollen, Viewport-Erhalt).

## 19. Umsetzungsstand L1 Planungslayout (2026-10-16)

Nur Frontend; kein Backend, kein Schema, keine Migration, OpenAPI unverändert. Die Fachlogik (Raum-, Öffnungs-,
Geräte-, Zuordnungs- und Leitungsentwürfe, Speichern, Konflikte, Rückfragen) ist unverändert. **Nicht committet.**

### 19.1 Sichtbare Anordnung

Von oben nach unten, alles in einer gemeinsamen Flucht (Seitenbreite bis 120 rem, solange eine Planungsansicht
– Grundriss oder 3D – gezeigt wird; Verwaltungsseiten bleiben bei 1 100 px):

1. **Projektkopf, einzeilig** – Zurück „Alle Projekte“, Projektname, „Nummer · Status“, ggf. Marke
   „schreibgeschützt“, die *nächste* Statusaktion als Knopf, Menü „Projekt ▾“ (übrige Statuswechsel, Wiederaufnahme,
   Löschen, „Stammdaten und Bearbeitungsinfo“ → bestehender Verwaltungsreiter mit vollständigem Kopf).
2. **Reiter** des Projekts (unverändert).
3. **Ansichtszeile**, eine Zeile: „Geschoss“ (kompakte Auswahl) und die Ansichtsumschaltung. Keine Karte, kein
   Statusblock darüber.
4. **Arbeitsfläche**: Kopfzeile (Ort, kurzer Status, kleine Speichern/Verwerfen), **Werkzeugleiste** in Gruppen –
   Auswahl (Auswählen V, Verschieben H) · Raum (Rechteck R, Polygon P) · Öffnung (Tür T, Fenster N, Durchgang D) ·
   Gerät (G) · **„Leitung hinzufügen“ (L)**, hervorgehoben · Verlauf (gebogene Pfeile, Rückgängig/Wiederholen) ·
   Zoom (Verkleinern, Vergrößern, Ansicht zurücksetzen) · Menü „Ansicht ▾“ (Fang, Raster, „Bedienung,
   Tastenkürzel und Legende …“) · rechts Eigenschaften (E) und Maximieren (M).
5. **Zeichenfläche** bis zum Fensterrand; das Eigenschaften-Panel klappt rechts daneben auf.
6. **Kontextleiste** unter der Fläche nur bei Bedarf (offener Entwurf, Leitungswerkzeuge, Rückmeldung zum Raum).

### 19.2 Höhenregel

Die Arbeitsfläche erhält die Höhe *Fensterhöhe − Oberkante − 12 px*, sofern dabei mindestens Kopf + Werkzeuge +
Kontext + 220 px Zeichenfläche bleiben. **Sonst (Nachtrag 2026-10-22)** füllt sie nach einmaligem Scrollen der Seite
das ganze Fenster (*Fensterhöhe − 2 × 12 px*), statt dauerhaft nur die Mindestfläche zu zeigen. Werkzeuge bleiben
erreichbar, es gibt keine verschachtelten Scrollbereiche. Maximiert füllt die Fläche das Fenster (eigener, einziger
Scrollbereich).

### 19.3 Wand und Decke in der Arbeitsfläche (F8)

Kein modaler Dialog mehr: Die Wand- bzw. Deckenfläche ersetzt den Grundriss **an derselben Stelle**, mit Pfad
„Grundriss · Geschoss › Raum › Wand n“ bzw. „… › Decke“ und sichtbarem Rückweg „Zurück zum Grundriss“ (aus 3D:
„Zurück zur 3D-Ansicht“). Die Fläche hat dieselbe Werkzeugleisten-Gliederung (Auswahl, Öffnung, Gerät, Leitung,
Verlauf, Zoom, Menü „Ansicht ▾“ mit „Einrasten“), Panel und Maximierung gelten für die ganze Arbeitsfläche.

* Der Grundriss wird währenddessen **ausgehängt** (kein verstecktes SVG, keine zweiten Tastenhandler, nichts
  fokussierbar). Sein Ausschnitt lebt im Editor und wird beim Zurückkehren unverändert übernommen – kein Einpassen.
* **Jede besuchte Fläche behält ihren Ausschnitt** (Wand je Seite innen/außen, Decke je Raum), begrenzt auf die
  16 zuletzt benutzten; erstmals besuchte Flächen werden eingepasst.
* Entwürfe, Undo-Verlauf, Werkzeug und Auswahl des Grundrisses bleiben erhalten, ebenso geschossübergreifende
  Leitungsentwürfe (Provider am Gebäude) und die Rückkehr in die 3D-Ansicht.
* **Escape**, je Tastendruck genau eine Wirkung: offenes Menü schließen → Werkzeug/Auswahl zurücksetzen →
  Maximierung/Panel → zurück zum Grundriss.

### 19.4 Zwischenstand „Leitung hinzufügen“ (ehrlich benannt)

„Leitung hinzufügen“ startet in L1 **noch nicht** den neuen Zeichenablauf (§18.3, kommt mit L2). Ohne offenen
Entwurf öffnet der Knopf das Eigenschaften-Panel an der **bestehenden Leitungsliste** und setzt den Fokus auf die
Stromkreiswahl; von dort führt „Neue Leitung“ in das bisherige Formular. Bei offenem Leitungsentwurf wählt er das
Leitungswerkzeug. Die Hilfe nennt diesen Zwischenstand. Der bestehende Leitungsablauf ist vollständig funktionsfähig.

### 19.5 Abweichungen und Präzisierungen gegenüber §18.2

* Das in §18.10 skizzierte Menü „Elektro ▾“ entfällt in L1: Stromkreise, Verteilungen und Leitungen erreicht man
  wie bisher über das Panel; ein eigenes Menü lohnt erst mit dem neuen Leitungsablauf (L2/L3).
* „Gerät“ ist ein eigenes Werkzeug (G); es wählt wie bisher eine Wand und öffnet deren Fläche zum Setzen.
* Leistung: Die Werkzeugleisten werden nur bei sichtbaren Änderungen neu gezeichnet (stabile Rückrufe, `memo`);
  der gemessene Mehraufwand einer Zeigerbewegung gegenüber 6b.6 ist dadurch weitgehend aufgehoben.

### 19.6 Tests

Neu: `core/ui/Menue.test.tsx` (Rollen, Pfeiltasten, Escape schließt nur das Menü, Arbeitsbereich-Modus),
`platform/Projektkopf.test.tsx` (kompakter Kopf, Menü, Schreibschutz), `arbeitsflaeche/ansichtsgedaechtnis.test.ts`
(je Fläche/Seite, begrenzt), Höhenregel in `Planungsarbeitsflaeche.test.tsx`, und in
`Arbeitsflaeche.editor.test.tsx`: Erreichbarkeit der Hauptwerkzeuge und Menü, „Leitung hinzufügen“ ohne
Vorauswahl, Grundriss → Wand → zurück (Pfad, Fokus, Grundriss ausgehängt, Ausschnitt, Entwurf und Undo erhalten),
Escape-Kette mit offenem Menü, gemeinsame Maximierung, Decke mit Pfad/Fokus/Rückweg, Benutzer-/Betriebswechsel
(neuer Baum und Cache: keine alte Fläche, kein Entwurf), Ausschnitt je Wand und Decke beim erneuten Öffnen (auch im
StrictMode), nicht stauchbarer Kopf. Frontend 1 179 Tests: Nach den Korrekturen aus der Browserprüfung lief die Suite unter Volllast der Maschine (CPU 100 %, fremde Anwendung) mit `--maxWorkers=4 --testTimeout=30000` – 1 178/1 179 grün; rot nur der bekannte lastabhängige 3D-Nachladetest (Task 0043), einzeln grün. Im Standardlauf unter dieser Last nur Zeitüberschreitungen. Vor der Browserprüfung im Standardlauf ohne Last 1 174/1 174 grün. Angepasst: Wand-, Decken-, Leitungs- und Editortests
(Region statt Dialog, Rückweg, Raster über das Menü). Rückkehr aus 3D und sichtbare Fehler bei geschlossenem
Panel decken die bestehenden Tests ab.

### 19.7 Offen

Beurteilung des Layouts und manuelle Abnahme durch den Auftraggeber. Optisch offen (nicht Teil von L1): Gesperrte
neutrale Knöpfe werden nicht blasser (zentraler Knopfstil `stil.ts`, betrifft die ganze Anwendung); bei Telefonbreite
belegt die Werkzeugleiste sechs Zeilen (bedienbar, Seite scrollt einmal) – eine Symbol-Variante wäre zu entscheiden.

### 19.8 Prüfung im laufenden Stack (2026-10-16)

Mit PR-2026-0010 (synthetisch), angemeldet durch den Auftraggeber, unter http://localhost:5173. Gemessen per Skript
(Lage, Höhen, Scrollbereiche), optisch per Bildschirmfoto.

| Fenster | Ergebnis |
|---|---|
| 1600 × 950 (breit) | Kopf 34 px, Werkzeugleiste einzeilig, Arbeitsfläche bis 12 px vor den Fensterrand, Zeichenfläche 628 px, kein Seitenscroll |
| 1280 × 800 (mittel) | Leiste einzeilig, Zeichenfläche 437 px, kein Seitenscroll |
| 1280 × 560 (niedrig) | Zeichenfläche hält 221 px, Seite scrollt einmal um 23 px, Werkzeuge erreichbar |
| 633 × 744 (Browser-Bereich) | Leiste dreizeilig, Zeichenfläche 221 px, ein Seitenscroll |
| 375 × 812 (schmal) | Leiste sechszeilig, Zeichenfläche 220 px, ein Seitenscroll, kein Querscroll |

Innere Scrollbereiche gibt es nur im (geschlossenen, `inert`) Eigenschaften-Panel – nicht verschachtelt mit der
Zeichenfläche. Hell und dunkel (vorübergehend über `data-theme`, danach zurückgesetzt) lesbar.

**Abläufe:** Grundriss zoomen → Tür-Werkzeug → Wand anklicken: Fläche an Ort und Stelle (kein Dialog), Pfad
„Grundriss · Haus · EG › 0.01 Diele › Wand 4“, Fokus in der Fläche, Grundriss-SVG ausgehängt. Wand zoomen → „Zurück zum
Grundriss“: Grundriss-Transformation exakt wie vorher, Werkzeug Tür weiter aktiv. Dieselbe Wand erneut: ihr gezoomter
Ausschnitt kommt zurück. „Leitung hinzufügen“ in der Wand: Panel öffnet an der Leitungsliste, Fokus auf der
Stromkreiswahl (Zwischenstand §19.4); „Neue Leitung“ → zwei Wegpunkte auf der Wand → Rückgängig aktiv → zurück zum
Grundriss: Entwurf und Punkte sichtbar, Rückgängig aktiv → Maximieren, dunkles Theme: Maßstab unverändert → Escape: je
Tastendruck eine Wirkung, der zweite beendet die Maximierung, Entwurf bleibt → Testentwurf über die Rückfrage verworfen,
nichts gespeichert. Rückkehr aus 3D und die Decke im Browser nicht erneut durchgespielt (automatisiert abgedeckt).

**Befunde und Behebung:**

1. *Schmale Breite:* Die Kopfzeile der Arbeitsfläche wurde bei fester Höhe gestaucht, „Speichern“ lag über
   „Verschieben“. Behoben: Kopf in einem nicht stauchbaren Rahmen; Test ergänzt.
2. *Ausschnitt je Fläche:* Dieselbe Wand wurde beim erneuten Öffnen neu eingepasst. Ursachen: Die Fläche meldete ihren
   ungemessenen Startwert und überschrieb so den gemerkten Ausschnitt; der Updater las die Messmarke erst verspätet;
   die Decke verbrauchte den gemerkten Wert, was im StrictMode (doppelte Effekte) zum Einpassen führte. Behoben in Wand
   und Decke; Tests für Wand und Decke, jeweils auch im StrictMode, ergänzt.
3. *Umgebung, kein Produktfehler:* Der Vite-Server im Docker-Container erkennt unter Windows Änderungen über den
   Bind-Mount nicht und lieferte zunächst einen veralteten Modulstand aus (Absturz „Element type is invalid“). Nach
   `docker restart elektroplan-planner` korrekt.


### 19.9 Nacharbeiten L1 (2026-10-22)

Auftrag: offene Korrekturen und Prüfungen von L1 abschließen; kein V1, kein L2/L3, nichts committet. Der bestehende
Leitungsablauf ist funktionsgleich: **„Leitung hinzufügen“ ist oben erreichbar, öffnet aber noch den alten Ablauf**
(Leitungsliste im Panel, §19.4). Der neue Zeichenablauf und der Abschlussdialog folgen nach V1.

#### 19.9.1 Schmale Darstellung (unter 60 rem)

* **Werkzeuge als Symbolknöpfe** (`Werkzeugknopf` mit Symbol, `WERKZEUGSYMBOL`): zugänglicher Name, Kürzel und
  Erklärung im Hinweis bei Zeigen **und** Tastaturfokus (`role="tooltip"`, `aria-describedby`); gewähltes Werkzeug
  hervorgehoben. Knopfmaß unverändert (etwa 30 × 34 px) – keine winzigen Ziele, keine abgeschnittenen Texte.
* **Gruppen als Menü** (`Werkzeugwahl`): „Raum zeichnen ▾“ (Rechteck R, Polygon P) und „Öffnung setzen ▾“ (Tür T,
  Fenster N, Durchgang D); der Menüknopf zeigt das Symbol des gewählten Werkzeugs und nennt es im Namen
  („Raum zeichnen: Rechteckraum“). Kürzel wirken unverändert. Breit bleiben die einzelnen Knöpfe mit Text.
* **„Leitung hinzufügen“** bleibt oben mit Symbol **und** Text („Leitung“; Name „Leitung hinzufügen“) – nicht im Panel,
  nicht in einem Menü.
* Seltenes: Menü „Ansicht“ als Symbol; Eigenschaften und Maximieren als Symbol mit Namen und Hinweis.
* **Eigenschaften und Maximieren stehen oben rechts neben den Werkzeugen** (alle Breiten); die Werkzeuge brechen
  daneben um, statt den beiden Knöpfen eine eigene Zeile zu lassen.
* **Ansichtszeile:** Geschoss und Ansicht als zwei Auswahlfelder in einer Zeile (statt sechs umbrechender Reiter);
  Beschriftungen bleiben für Screenreader.
* **Kopf und Pfad:** Überschrift „Grundriss · Geschoss“ schmal nur für Screenreader (das Geschoss steht in der
  Ansichtszeile); „Verwerfen“, „Außenseite“, „Speichern“, „Schließen“, „Angaben“, „Weiter“ als kurze sichtbare Texte
  mit vollem zugänglichem Namen; Rückweg als Symbol mit Namen; Pfad ohne Geschoss. Speichern, Verwerfen, Abbrechen
  und Fehlerrückmeldungen bleiben sichtbar.
* **Höhenregel** siehe §19.2 (Fenster füllen nach einmaligem Scrollen).

**Gemessen (Grundriss, PR-2026-0010, Browser-Bereich mit emulierten Größen):**

| Fenster | Werkzeugzeilen (inkl. Eigenschaften/Maximieren) | Zeichenfläche | Seite |
|---|---|---|---|
| 375 × 812 | **3** (vorher 6), 106 px | **626 px** (vorher 220) | ein Scroll, dann füllt die Arbeitsfläche das Fenster (788 px); kein Querscroll |
| 633 × 744 | 2 (vorher 3 und eine eigene Zeile für Eigenschaften) | 263 px | ohne Scroll |
| 1038 × 934 | 2 (vorher 3) | 493 px | ohne Scroll |
| 1280 × 800 | 2 | 442 px | ohne Scroll |
| 1280 × 560 | 2 | 408 px (vorher 221) | ein Scroll um 206 px |
| 1600 × 950 | 1 | 631 px | ohne Scroll |

Bei 375 px stehen über der Arbeitsfläche weiterhin App-Kopf (3 Zeilen), Projektkopf (4 Zeilen) und Projektreiter
(2 Zeilen) – nicht Teil von L1, als offener Punkt vermerkt.

#### 19.9.2 Gesperrte Aktionen

Zentraler Knopfstil (`stil.ts`, kleine Änderung, kein neues System): gesperrte Knöpfe aller Varianten **ohne
Füllfarbe, mit gedämpftem Text und Rahmen und Zeiger „nicht erlaubt“**. Vorher wirkte ein gesperrtes „Speichern“
blassorange, „Änderungen verwerfen“ unverändert bedienbar, und der Lade-Zeiger (`cursor-progress`) suggerierte
„lädt“. Hover nur an bedienbaren Knöpfen (`enabled:`). Native `disabled`-Semantik unverändert. Geprüft hell und dunkel
in der Planung (Speichern/Verwerfen ohne Raumentwurf) und im Formular „Stammdaten“ (Speichern ohne Änderung).

#### 19.9.3 Weitere Befunde der Browserprüfung (behoben)

* **Menüeinträge** zeigten die Browserdarstellung eines Knopfs (Rahmen, schmale Kästen) – betraf alle Menüs seit L1.
  Behoben: Menüzeilen über die volle Breite ohne Rahmen (`Menue.tsx`).
* **Eigenschaften/Maximieren in eigener Zeile** (siehe oben) – behoben.

#### 19.9.4 Decke und 3D-Rückkehr im laufenden Stack

| Ablauf | Ergebnis |
|---|---|
| Grundriss → Diele wählen → „Deckenansicht“ | Fläche an Ort und Stelle, Pfad „Grundriss · Haus · EG › 0.01 Diele › Decke“, Fokus in der Fläche, Grundriss ausgehängt, kein Dialog, Panel bleibt offen |
| Decke zweimal vergrößern → Escape | **ein** Escape führt zurück; Grundriss-Ausschnitt exakt unverändert |
| dieselbe Decke erneut | gezoomter Ausschnitt exakt wiederhergestellt |
| Decke: „Neue Leitung“, zwei Punkte → Escape, Escape, Escape | 1. Werkzeug „Leitung“ → Auswählen; 2. Auswahl des Wegpunkts aufgehoben; 3. zurück zum Grundriss – je Druck eine Wirkung; Entwurf „offen – ungespeichert“, Punkte im Grundriss, Rückgängig aktiv |
| Grundriss → 3D → 2D mit diesem Entwurf | 3D meldet den offenen Entwurf; zurück im Grundriss unverändert; nichts gespeichert |
| 3D: Draufsicht, zweimal „Näher“, Leitung L1 gewählt → „In der Wandansicht bearbeiten“ → „Zurück zur 3D-Ansicht“ | Wandfläche mit Pfad „3D-Ansicht › 0.01 Diele › Wand 1“; zurück: Kamera, Zoom und Auswahl L1 im Bild unverändert; kein Dialog, keine Speicherung |
| Menü offen → Escape | schließt nur das Menü, Fokus zurück am Menüknopf, Werkzeug unverändert |

**Nicht im Browser geprüft:** 3D → *Decke* → 3D. Die synthetischen Projekte PR-2026-0009 und PR-2026-0010 enthalten
weder Deckengeräte noch Leitungen mit Deckenabschnitt; um nichts anzulegen, deckt diesen Weg weiterhin nur die
automatisierte Prüfung ab (gleiche Rückkehrlogik wie die Wand).

Testentwürfe wurden über die vorhandene Rückfrage verworfen; das dunkle Theme nur vorübergehend über `data-theme`.

#### 19.9.5 Tests und Gesamtlauf

* **Neu/angepasst:** schmale Darstellung (Symbolknöpfe mit Namen und Hinweis, Raum/Öffnung als Menü, Kürzel,
  „Leitung“ mit Text, Ansicht als Auswahl, Kopf und Pfad gekürzt mit vollem Namen) in `Arbeitsflaeche.editor.test.tsx`;
  Höhenregel „Fenster füllen“ in `Planungsarbeitsflaeche.test.tsx`; gesperrter Knopfstil in `core/ui/stil.test.ts`.
* **3D-Nachladetest** (`GrundrissEditor.test.tsx` › „fragt beim Wechsel zur 3D-Ansicht …“) scheiterte erneut. Der
  festgehaltene Zustand beim Abbruch zeigte den Suspense-Hinweis „3D-Ansicht wird geladen …“ – kein Fehler, kein
  Dialog: Das Nachladen des 3D-Moduls (kalt, nur dieser Test der Datei lädt es) war nach der 1-s-Suchfrist nicht
  fertig. Behoben wie in Task 0043: Der Test hält das Nachladen fest und wartet darauf (`vi.mock` mit
  `importActual`) – keine längere Frist, keine Pause. Danach in keinem Lauf mehr rot.
* **Gezielt:** `modules/electrical`, `core/ui`, `modules/platform` – 993/993 grün (bei niedriger Last).
* **Regulärer Gesamtlauf (Projekteinstellungen, allein, ohne Build/Lint daneben): nicht grün.** Vier Läufe mit
  1 188 Tests: jeweils 1–2 Zeitüberschreitungen an der 5-s-Testfrist, wechselnd in langen Integrationstests
  (`Grundrissleitungen` › „Einstieg, Vorschau …“ und „Fußbodenpunkte …“, `WandansichtGeraete` › „setzen per Zeiger …“);
  bester Lauf 1 187/1 188 in 67 s (Last 24 %). Einzeln brauchen diese Tests 1,3–2,5 s.
  - **HEAD-Vergleich** (Stand vor 6c.0/L1, vorübergehender Worktree, danach entfernt): Der reguläre Gesamtlauf auf
    HEAD scheiterte unter denselben Bedingungen ebenso an einem langen Leitungstest (5,9 s; 1 139/1 140). Die knappe
    5-s-Frist dieser Tests besteht also unabhängig von L1.
  - **Anteil L1:** A/B-Messung, abwechselnd je vier Läufe: Median HEAD → L1 „Einstieg, Vorschau …“ 1,93 → 2,26 s,
    „Fußbodenpunkte …“ 1,56 → 1,96 s, „setzen per Zeiger …“ 1,98 → 2,18 s (+10–26 %). 6c.0 und L1 erhöhen damit die
    Wahrscheinlichkeit der Fristüberschreitung. Die Werkzeugleiste zeichnet dabei nicht übermäßig neu (gemessen:
    7 Leistendurchläufe in einem ganzen Leitungstest); ein CPU-Profil der Test-Worker ließ sich mit Vitest 4 nicht
    erzeugen – **die genaue Quelle der Mehrkosten ist nicht belegt.**
  - Last: während der Läufe 24–60 % Grundlast durch andere Programme (zeitweise eine Installation des
    Spiele-Launchers); keine Programme beendet.
* Typprüfung, ESLint, Modulgrenzen, Build, API-Drift (OpenAPI unverändert) und `git diff --check` grün.

**Damit gilt L1 noch nicht als technisch geprüft.** Entschieden (2026-10-22): Mehrkosten analysieren und Renderkosten
senken, ohne Fristverlängerung (§19.9.6).

#### 19.9.6 Analyse und Senkung der Mehrkosten (2026-10-22, Nachtrag)

**Messverfahren:** CPU-Profil der Test-Worker über eine vorübergehende Setup-Datei (Node-Inspector, Start vor dem
ersten, Ende nach dem letzten Test einer Datei) – `Grundrissleitungen.test.tsx` und `WandansichtGeraete.test.tsx`,
ein Worker, für die Messläufe lange Testfrist; HEAD in einem vorübergehenden Worktree. Ausgewertet nach Eigenzeit
je Bibliothek und einschließlicher Zeit je Quelldatei/Funktion. Nichts davon liegt im Repository.

**Befund (aktive Zeit HEAD 31,7 s → L1 38,2 s, +20 %):**

| Posten | Mehrzeit | Art |
|---|---|---|
| Testhelfer `eigenschaftenOeffnen` (seit 6c.0: Panel standardmäßig zu) | +3,2 s, davon 2,6 s Rollenabfragen von Testing Library (`findByRole` über das ganze Dokument), 0,56 s Klick und Rendern | Test |
| jsdom/Selektoren/Stilberechnung (`nwsapi`, `cssstyle`) durch Abfragen über ein größeres DOM | in den Posten oben und unten enthalten | Test |
| `Planungsarbeitsflaeche` + `SymbolKnopf` (Eigenschaften/Maximieren bei jedem Neuzeichnen) | +0,64 s / +0,60 s | Anwendung |
| `HilfeDialog` rendert seinen Inhalt (Bedienliste, Gerätelegende) auch geschlossen | +0,17 s | Anwendung |

**Maßnahmen (ohne Fristverlängerung, ohne abgeschwächte Prüfungen):**

1. `testhilfe.eigenschaftenOeffnen` findet Arbeitsfläche und Knopf über ihre festen Markierungen
   (`[data-arbeitsflaeche]`, `[data-eigenschaften-knopf]`) statt per Rollenabfrage über das Dokument; der zugängliche
   Name „Eigenschaften“ wird weiterhin geprüft (`toHaveAccessibleName`).
2. `HilfeDialog` erzeugt seinen Inhalt nur bei offenem Dialog; der Dialog bleibt eingehängt (Fokus und Rückgabe
   unverändert).
3. Eigenschaften und Maximieren als gemerkter Baustein `Flaechenknoepfe` mit stabilen Rückrufen – sie zeichnen nur
   noch bei sichtbaren Änderungen neu.

**Ergebnis (gleiche Bedingungen, abwechselnd profiliert): HEAD 27,3 s → L1 27,8 s, +1,7 %** (vorher +20 %). Der Rest
entfällt vor allem auf das Erzeugen der JSX-Elemente in der Entwicklungsfassung von React (`jsxDEV`, im
Produktionsbuild ohne Bedeutung) und auf das tatsächliche Aufklappen des Panels in den Tests.

**Regulärer Gesamtlauf danach: grün.** Während der Messung lief zunächst ein Spiel (CPU 77–96 %); ein gezielter Lauf
mit zwei Workern geriet dabei in Zeitüberschreitungen (2 von 993) und war nicht aussagekräftig. Bei normaler Last
(26 %) lief der reguläre Frontend-Gesamtlauf mit den Projekteinstellungen, allein und ohne Build/Lint daneben:
**1 188/1 188 Tests, 104 Dateien, 55 s.** Die früher kritischen Tests: „setzen per Zeiger …“ 3,4 s, „Einstieg,
Vorschau …“ und „Fußbodenpunkte …“ 1,3–3,1 s, der 3D-Nachladetest 3,8 s – alle unter der 5-s-Frist, ohne
Fristverlängerung. Danach Typprüfung, ESLint, Modulgrenzen, Build, API-Drift (OpenAPI unverändert) und
`git diff --check` grün. **L1 gilt damit als technisch geprüft.**

Die beiden Anwendungsänderungen dieser Runde (Inhalt des Hilfedialogs nur geöffnet, gemerkte Knöpfe Eigenschaften/
Maximieren) sind nur automatisiert geprüft (Hilfe öffnen/schließen, Ein-/Ausklappen, Maximieren mit Taste und
Escape); im Browser nicht erneut, weil die Sitzung abgelaufen war. Sichtbar ändert sich dadurch nichts.

## 20. Umsetzungsstand V1 Vorgaben-Backend (2026-10-23)

**Freigabe:** Der Auftraggeber hat V1 am 2026-10-23 freigegeben, ohne das Layout L1 selbst angesehen zu haben.
Die Freigabe ist **keine** nachträgliche Layoutabnahme; die persönliche Abnahme von L1 bleibt offen. L1 wurde
vorher als Checkpoint `331bfbd` gesichert (technisch geprüfter Stand, §19.9). V1 ist **uncommittet**.

### 20.1 Umfang (umgesetzt)

* **Technische Kabelvorlagen** je Betrieb (`electrical_cable_templates`): Name, Leitungstyp, Leiteranzahl,
  Querschnitt (`numeric`, API-String), aktiv, Reihenfolge, Version; kein Preis. Ändern mit `If-Match`;
  Löschen nur ungenutzt (`409`, Code `cable-template-in-use`), sonst deaktivieren.
* **Betriebsstandard** (`electrical_planning_defaults`, eine Zeile je Betrieb) mit Vorlage je Gerätetyp
  (`electrical_type_templates`), **Projektvorgabe** (`electrical_project_defaults`) mit eigener Vorlage je
  Gerätetyp (`electrical_proj_type_templates`). Felder: Reserve %, Zugabe an Verteilung, Abzweigdose, Gerät,
  allgemeine Standardvorlage. **`NULL` = nicht gesetzt** (erbt), **`0` = ausdrücklich null** (gewinnt).
* **Stromkreisvorrang** `electrical_circuits.proposal_overrides_templates` (Bestand `false`), über
  `POST`/`PATCH` des Stromkreises setzbar; ohne Aktivierung nur Hinweis `circuit-proposal-not-activated`.
* **Kette je Wertegruppe** als reine Funktion `defaults_chain.py`: Kabelangaben 1 Leitung (manuell) →
  2 aktivierter Stromkreis → 3 Gerätetypvorlage (Projekt vor Betrieb) → 4 Standardvorlage (Projekt vor Betrieb)
  → 5 sichtbar fehlend. Das Tripel stammt immer aus **einer** Quelle; eine teilweise Stromkreisvorgabe bleibt
  teilweise (Hinweis `circuit-override-incomplete`). Inaktive Vorlagen werden nie vorgeschlagen (Hinweis
  `template-inactive`, die Kette fällt weiter). Maßgeblich ist das Zielgerät; ohne Ziel das Startgerät, nie eine
  Verteilung (Hinweis `start-template-differs`, wenn Start und Ziel verschiedene Vorlagen hätten). Reserve und
  Zugaben je Feld: Projekt → Betrieb → 0.
* **Prozentreserve** an der Leitung (`reserve_mode` `fixed`/`percent`, `reserve_percent numeric(5,2)`):
  `r = ⌊(g·P + 9 999) / 10 000⌋` mit `P = p·100` ganzzahlig – aufgerundet, ohne Gleitkomma, nur auf den
  geometrischen Weg und **nur bei `confirmed`**. Offen/Konflikt: keine Reserve, keine Gesamtlänge
  (`reserve_pending`). Gespeichert wird der Prozentsatz, nie das Ergebnis. Zugaben getrennt
  (`connection_allowance_mm`); `allowance_mm` behält seine Bedeutung (Anschlusszugaben + Reserve, soweit
  bekannt).
* **Herkunft und Basis** je Gruppe an der Leitung: `spec_origin`, `reserve_origin`, `allowance_origin`
  (`legacy`, `manual`, `circuit_override`, `device_type_template`, `default_template`, `project_default`,
  `office_default`, `none`), `cable_template_id`/`_version`, `defaults_office_version`/`_project_version`.
* **Leitung ohne Endgerät** zulässig: `incomplete`, Befund `end-device-missing` („Endgerät fehlt“).
* **Ausdrückliche Zuordnung beim Speichern** (`assign_devices`, höchstens 2): zusätzlich
  `electrical.circuit.write` und `expected_circuit_version`; nur Endgeräte dieser Leitung, gleiches Gebäude und
  Betrieb, zuordenbare Kategorie, nie Umhängen; atomar mit der Leitung.
* **Längenfunktion, Fixture, Frontend-Spiegel, Mengenübersicht**: gemeinsame Fälle in
  `testdata/geometry/leitung.v1.json` (`reserve`-Abschnitt, Fall „V1 Prozentreserve“). Die Mengenübersicht
  weist Anschlusszugaben, Reserve und die Zahl offener Prozentreserven je Eimer getrennt aus; die Reserve ist
  Teil von `allowance_mm`/`total_mm`, nie zusätzlich.
* **Bestehende Oberflächen** arbeiten weiter: Der Leitungseditor übernimmt `reserve_mode`/`reserve_percent`
  unverändert beim Speichern (sonst würde eine Prozentreserve still zu 0 mm), zeigt eine Prozentreserve als
  Text mit „Feste Reserve eingeben“ und „Prozentreserve erst mit vollständigem Weg“. Kein neuer Zeichenablauf,
  kein Dialog, keine Verwaltungsoberfläche.

### 20.2 API-Verträge für L2/L3 (unter `/api/v1/modules/electrical`)

```text
GET    /cable-templates                                   plan.read      → {templates: CableTemplateOut[]}
POST   /cable-templates                                   defaults.manage
PATCH  /cable-templates/{template_id}       If-Match      defaults.manage  (Teiländerung; deaktivieren)
DELETE /cable-templates/{template_id}       If-Match      defaults.manage  (409 cable-template-in-use)
GET    /planning-defaults                                 plan.read      → PlanningDefaultsOut (version 0 = nicht angelegt)
PUT    /planning-defaults                                 defaults.manage  Körper mit expected_version, alle Felder
GET    /projects/{project_id}/planning-defaults           plan.read
PUT    /projects/{project_id}/planning-defaults           route.write    (409 project-completed/-archived)
GET    /projects/{project_id}/planning-defaults/effective plan.read
       ?circuit_id&start_device_id&end_device_id         → EffectivePlanningDefaultsOut (+ for_cable)
POST   /circuits/{id}/cables · PUT /cables/{id}           CableIn erweitert (s. u.)
```

* `PUT` der Vorgaben ersetzt alle Felder; Versionsprüfung über `expected_version` im Körper (`0` = noch
  keine Zeile; `If-Match: 0` lehnt der Core ab). Unbekannte/fremde Vorlage `422 cable-template-unknown`,
  neu gewählte inaktive `422 cable-template-inactive`, Gerätetyp doppelt/unbekannt/nicht zuordenbar `422`.
* `effective` liefert `basis` (`office_version`, `project_version`), wirksame Reserve, Zugaben je
  Endpunktart, Standard- und Gerätetypvorlagen mit Ebene, alle Vorlagen, und mit `circuit_id` je Leitung
  `for_cable`: `spec` (Herkunft, Tripel, Vorlage, Ebene, maßgebliches Gerät), `reserve`, `allowances`
  (`start_mm`/`end_mm` mit Herkunft je Seite), `hints`, `basis` inkl. `cable_template_id`/`_version` und
  `circuit_version`.
* `CableIn`: `end_device_id` optional; `reserve_mode` (`fixed` Standard), `reserve_percent` (nur bei `percent`,
  dann `reserve_mm = 0`); `spec_source`/`reserve_source`/`allowance_source` (`defaults`, `manual` oder
  weglassen); `defaults_basis` (Pflicht bei `defaults`, genau `for_cable.basis` übernehmen); `assign_devices`
  mit `expected_circuit_version`.
* **Der Server vertraut keiner Client-Herkunft:** Bei `defaults` löst er die Kette selbst auf; Werte, Basis,
  Vorlagenversion oder (bei aktiviertem Vorrang) Stromkreisversion abweichend → **`409
  planning-defaults-changed`**, Felder in `errors`, nichts gespeichert. `manual` speichert die Werte mit
  Herkunft `manual`. Ohne Angabe (bisherige Clients) behält eine unveränderte Gruppe ihre gespeicherte
  Herkunft (`legacy` bleibt `legacy`), eine geänderte wird `manual`.
* `CableOut`/Mengenübersicht: `reserve_mode`, `reserve_percent`, `reserve_effective_mm` (`null` = offen),
  `reserve_pending`, `connection_allowance_mm`, Herkunft und Basis; Eimer mit `connection_allowance_mm`,
  `reserve_mm`, `reserve_pending_count`.

### 20.3 Präzisierungen gegenüber §10 (ohne neue fachliche Entscheidung)

* **Tabellennamen** gekürzt, weil die abgeleiteten Constraint-Namen sonst über 63 Zeichen lägen:
  `electrical_type_templates`, `electrical_project_defaults`, `electrical_proj_type_templates` statt der in
  §10.3 genannten Langformen.
* **Sperre der betriebsweiten Vorgaben** (präzisiert §10.5 „nur ihre eigene Zeile“): eine transaktionsgebundene
  PostgreSQL-Advisory-Sperre je Betrieb, weil eine Zeilensperre eine gleichzeitige Erstanlage nicht aufhält.
  Schreiben (Betriebsstandard, Vorlagen) **exklusiv** und nie mit Projektsperre; Lesen/Prüfen (wirksame
  Vorgaben, Speichern mit Vorgabenherkunft, Projektvorgabe) **erst Projektsperre, dann geteilt**. Kein Zyklus,
  die Reihenfolge „Projekt zuerst“ bleibt. Tests belegen beide Richtungen (Speichern wartet auf eine laufende
  Betriebsänderung und sieht sie → `409`; Betriebsänderung wartet auf ein laufendes Speichern).
* **Core**: `FloorPlanningAccess.project_context`/`consistent_project_context`/`writable_project_context` und
  `ProjectPlanningContext` – generisch, ohne Fachwissen.
* **Seed**: Recht `electrical.defaults.manage`, Standardrollen keine – nur der Administrator erhält es (über die
  Registry). Nach der Migration den Seed ausführen.
* Synthetische Beispielwerte (`TEST-*`, 20 %) sind ausschließlich Testdaten; es gibt **keine** ausgelieferte
  Vorlage und keinen Standardwert.

### 20.4 Übergabe an Phase 7/8 (dokumentiert, nicht umgesetzt)

Electrical liefert je Leitung getrennt: geometrischen Bedarf, Anschlusszugaben und Planungsreserve
(`reserve_effective_mm`, Herkunft, Modus). Eine Materialberechnung darf auf Leitungen mit Planungsreserve keinen
weiteren Verschnitt aufschlagen; Verpackungsrundung erst danach. Die Vertragsänderung entscheidet ein
Phase-7-ADR; der `ProjectRequirementsProvider` bleibt in V1 unverändert.

### 20.5 Tests

* **Neu:** `test_defaults_chain.py` (11, reine Kette: jede Stufe, Aktivierung an/aus, keine Mischung, inaktive
  Vorlage, maßgebliches Gerät, ausdrückliche 0 gegen Vererbung), `test_electrical_planning_defaults.py` (21 gegen
  PostgreSQL: wirksame Vorgaben mit Herkunft und Basis, Projekt vor Betrieb, aktivierter Stromkreisvorrang mit
  Stromkreisbasis, 10 900 mm mit Herkunft und Mengenübersicht ohne Doppelzählung, veraltete Basis beim Anlegen und
  Ersetzen → `409`, nichts gespeichert, Bestand unverändert, falsche Werte unter „aus Vorgaben“, manuell/gemischt/
  bisherige Clients, `legacy` bleibt, Vorlage ändern/deaktivieren/Löschschutz, Eingabeprüfung, offene Leitung,
  Zuordnung atomar/veraltet/kein Endgerät/nie umhängen/ohne `circuit.write`/Datendose, Rechte, fremde Vorlage und
  fremdes Projekt, `completed`/`archived`, Projektlöschung, **beide Sperrrichtungen**),
  `test_migration_planning_defaults.py` (5, Wegwerf-Datenbank: Bestand unverändert, Mengen wie vorher,
  Autogenerate ohne Unterschied, CHECKs, Downgrade-Schutz und erneutes Upgrade).
* **Gemeinsame Fixture:** 12 Rundungsfälle (u. a. 8 500/20 → 1 700, 8 333/20 → 1 667, 4 001/12,5 → 501, 0 % → 0,
  100 % → g, 1/0,01 → 1, 9 999/99,99 → 9 999) und ein Planfall (L1 mit 20 % → 10 900; offener Weg und Leitung ohne
  Endgerät ohne Reserve und Gesamtlänge) – Backend und Frontend prüfen dieselbe Datei.
* **Angepasst:** Modulregistrierung (Tabellen, Recht, Untermodule), Mandanten-Sweep (Vorlage je Betrieb),
  Tabellenzahl (42), Migrationstest `0013` (Bestand per SQL, Head dynamisch); Frontend: Längenspiegel, Editor
  (Prozentreserve bleibt beim Speichern, feste Reserve nur ausdrücklich), Mengenübersicht (Reserve getrennt).
* **Gesamtlauf `tasks.ps1 check`** gegen PostgreSQL und MinIO, allein bei normaler Last (CPU ≈ 12 %): erster Lauf
  rot nur an der beabsichtigten Tabellenzahl-Wache (`test_architecture`, 37 → 42), nach der Anpassung
  **vollständig grün**: Ruff, Format, mypy `--strict`, Modulgrenzen, ein Alembic-Head, Lockfile, **1 382
  Backendtests** (18 min), API-Client aktuell (kein Drift), Frontend-Typprüfung, ESLint, **1 205/1 205
  Frontendtests in 56 s**, Build.
* **Entwicklungsstack:** Datenbank vorher gesichert (`pg_dump -Fc`, Scratchpad), `alembic upgrade head` → `0014`,
  Seed: 1 neues Recht. Alle 12 vorhandenen Leitungen mit unveränderten Werten (Vorher/Nachher-Vergleich), `fixed`/
  `legacy`; 5 Stromkreise `false`; keine Vorlage, kein Standard. Backend neu gestartet. **Synthetischer
  API-Durchlauf 15/15** (Entwicklungskonto aus `docker-compose.yml`, eigenes Projekt): Vorlagen und Standard
  anlegen → wirksame Werte mit Herkunft → Leitung 8 500 + 700 + 1 700 = 10 900 speichern → Standard auf 25 % →
  alte Basis `409 planning-defaults-changed`, nichts gespeichert, Leitung unverändert → neue Vorgabe 25 % gelesen →
  Mengenübersicht getrennt → Projekt, Kunde und Vorlagen entfernt. Danach bleibt eine leere Betriebsstandard-Zeile
  (alle Felder nicht gesetzt, Version 3) – sie wirkt wie „keine Vorgabe“.
* **Nicht im Browser geprüft:** Die sichtbaren Editor- und Mengenänderungen sind nur automatisiert geprüft
  (keine neue Oberfläche in V1).

### 20.6 Offen

* ~~Oberfläche für Vorgaben, neuer Zeichenablauf und Abschlussdialog~~ – mit L2/L3 umgesetzt (§21).
* Persönliche Layoutabnahme L1 durch den Auftraggeber.
* Zentrale Anwendung (6c.6), Verteilungsaufbau, Phase 7 – zurückgestellt.

## 21. Umsetzungsstand L2/L3 – Zeichenablauf, Abschlussdialog, Verwaltung der Vorgaben (2026-10-23/24)

**Freigabe:** Der Auftraggeber hat am 2026-10-23 V1 als Checkpoint (`39386c4`) sichern lassen und L2/L3
freigegeben (Arbeitspakete A–D). L2/L3 ist **technisch umgesetzt, automatisiert und im laufenden Stack
funktional geprüft, uncommittet**. Die persönliche Layoutabnahme L1 bleibt offen, ebenso die Abnahme von L2/L3.
Keine Backendänderung, keine Migration, kein neuer API-Vertrag – alle Aufrufe nutzen die V1-Verträge (§20.2).

### 21.1 A – Verwaltung der Vorgaben (Dialoge)

* **Seite „Elektro-Vorgaben“** (Hauptnavigation, Route `/elektro-vorgaben`, Lesen mit `electrical.plan.read`):
  Tabelle der Kabelvorlagen (Name, Typ, Leiter, Querschnitt, aktiv/deaktiviert, „in Verwendung“) mit Anlegen/
  Bearbeiten im Dialog, Deaktivieren/Aktivieren, Entfernen nur ungenutzt; Zusammenfassung des Betriebsstandards
  („nicht gesetzt“ ≠ 0) mit Dialog „Betriebsstandard für neue Leitungen“. Ohne `electrical.defaults.manage`
  nur ansehen.
* **Projekt:** Knopf „Planungsvorgaben“ (schmal: „Vorgaben“) in der Ansichtszeile von „Räume & Grundriss“; Dialog
  je Angabe „Betriebsstandard übernehmen (Wert)“ oder „abweichender Projektwert“, darunter „Wirksam im Projekt:
  Wert (Herkunft)“. Abgeschlossene oder archivierte Projekte: nur lesen, mit Grund.
* **Stromkreis:** Schalter „Für neue Leitungen dieses Stromkreises diese Kabelvorgabe verwenden“
  (`proposal_overrides_templates`) – nur ausdrücklich; unvollständige Angaben werden beim Aktivieren benannt.
* Gemeinsam: 0 % / 0 mm sind ausdrückliche Werte; keine erfundenen Vorgaben, Preise oder Bemessungen;
  Versionsprüfung (`expected_version` bzw. `If-Match`); beim Konflikt bleiben die Eingaben, „Serverstand laden
  (Eingaben verwerfen)“ nur auf Wunsch. Vorgaben schreiben keine bestehende Leitung um.

### 21.2 B – Direkter Einstieg und Zeichenablauf

* **„Leitung hinzufügen“** (Taste L) startet sofort das Zeichnen – ohne Stromkreiswahl, ohne Formular. Die
  Zeichenleiste zeigt die Schritte **1 Startgerät wählen → 2 Verlauf zeichnen → 3 Zielgerät anklicken oder offen
  abschließen** (`aria-current="step"`).
* **Schritt 1:** Nur Geräte reagieren; mögliche Startgeräte sind markiert, andere gedimmt mit Grund beim Zeigen
  (z. B. Datendose, außen montiert). **Schritt 2:** Vorschau bis zum Zeiger mit Wirkung des nächsten Klicks (Fang,
  Ecke, Übergang, Höhe) und Grund vor dem Klick bei ungültiger Lage. Ein Klick (Drücken/Loslassen unter 4 px)
  setzt genau die Vorschau; ein Klick auf einen Wegpunkt wählt nur; neue Punkte kommen ans Ende, Einfügen nur
  ausdrücklich („Nächsten Punkt nach Wegpunkt N einfügen“); Ziehen = ein Rückgängig-Schritt; Ecke und Punkt = ein
  Schritt.
* **L-Führung** an der Wand und standardmäßig auf Fußboden/Decke („Rechtwinklig“/„Gerade“, Taste W),
  „Ecke wechseln“ (K) statt Kippen; beide Schenkel werden geprüft („Teilstrecke k: …“); eine gültige andere Ecke
  wird angeboten. Doppelklick, Enter oder „Abschließen …“ öffnen den Dialog ohne doppelten Punkt.
* **Grundriss:** Das Klickziel bestimmt die Punktart (Wandlinie = Wandpunkt, Raum = Fußboden-/Deckenpunkt,
  Tür = Bodenübergang). Die Höhe neuer Wandpunkte ist ausdrücklich wählbar („Höhe wie zuvor“, 0 cm, Zonen,
  Raumhöhe). Übergänge Raum↔Wand liegen auf der Achse und werden angekündigt mitgesetzt; der Wechsel Wand→Raum
  ist zusätzlich als Knopf vorhanden. *(Präzisierung gegenüber §18.4: Ohne ausdrückliche Höhe wäre ein
  Fußbodenpunkt an der Wand nicht eindeutig.)*
* **Flächen und Geschosse:** ein gebäudeweiter Entwurf; Wechsel Wand/Decke/Grundriss (Knöpfe „→ Wand …“,
  „↑ Decke dieses Raums“; aus dem Grundriss „Weiterzeichnen“ an den letzten Punkt) behalten Verlauf, Eingaben und
  Rückgängig; nichts wird automatisch gespeichert. Escape: Ziehen → Vorschau → Auswahl → Einfügen → Werkzeug
  beenden (Entwurf bleibt). „Abbrechen“ verwirft nur mit Rückfrage.
* **Entfallen:** das lange Leitungsformular im Panel (jetzt Übersicht mit Status, Start → Ziel, Länge, Befunden
  und lesbaren Wegpunkten), Stromkreiswahl und „Neue Leitung“ in der Leitungsliste (Stromkreiswahl dort nur noch
  für „Geräte einem Stromkreis zuordnen“), die Ebenen-Knöpfe der Grundrissleiste und das eigene Leitungswerkzeug
  in Wand- und Deckenansicht.

### 21.3 C – Abschlussdialog und Vorbelegung

* **Ein Dialog** für neue und bestehende Leitungen („Leitung abschließen“ bzw. „… – Angaben“): Verlauf
  (Start → Ziel bzw. „offen“), Stromkreis (abgeleitet nach §7.3 aus der Zuordnung; Wahl bei mehreren; Konflikt bei
  fremder Verteilung, nie umhängen), Kabel (Vorlage/Typ/Leiter/Querschnitt), Reserve (Prozent oder Bestandsmodus
  „fest“), Anschlusszugaben, Ergebnis getrennt (Weg · Reserve · Zugaben = Gesamtbedarf), Status und Befunde,
  **Herkunft** je Teil (z. B. „Standardvorlage (Betriebsstandard)“, „Projektvorgabe“, „abweichend“).
* Vorbelegung über `…/planning-defaults/effective` (sitzungsgebunden, abbrechbar, `staleTime 0`); „⟲ Vorgabe
  übernehmen“ je Teil; eine Abweichung bleibt eine Abweichung. Speichern sendet `spec_source`/`reserve_source`/
  `allowance_source` und `defaults_basis`; bei einer unveränderten Bestandsleitung wird nichts umgeschrieben.
* **Nicht zugeordnetes Ziel:** Die Zuordnung wird deutlich angezeigt, nur ausdrücklich bestätigt und nur mit
  `circuit.write` ausgeführt (`assign_devices` + `expected_circuit_version`, atomar).
* **Konflikte:** Versionskonflikt → Eingaben bleiben, „Serverstand laden (Änderungen verwerfen)“ oder „Entwurf
  vorerst behalten“. Geänderte Vorgabenbasis (`409 planning-defaults-changed`) → nichts gespeichert, Vergleich
  „bisher → jetzt“ in Anzeigeeinheiten, „Neue Vorgaben übernehmen“ oder „Bisherige Werte als Abweichung
  behalten“.
* Schließen, Escape oder Klick daneben verlieren nichts („Weiterzeichnen“ löst das Ziel einer neuen Leitung ohne
  Rückgängig-Schritt); Verwerfen nur mit Rückfrage. Nach dem Speichern bleibt das Werkzeug für die nächste
  Leitung aktiv.

### 21.4 D – Prüfung

* **Automatisiert (Frontend):** neu `Leitungsablauf.test.tsx` (13), `stromkreisableitung.test.ts` (11),
  `vorgaben/formular.test.ts` (5), `vorgaben/Vorgaben.test.tsx` (6); erweitert bzw. angepasst Leitungsplanung,
  Grundrissleitungen (+2 aus den Browserbefunden), Stromkreise (+1), Arbeitsfläche, Mengen, 3D, Modulindex.
  **Gesamtlauf 1 242/1 242 grün** (108 Dateien, `--maxWorkers=6`, 82 s); ESLint, `tsc`, Modulgrenzen
  (Front- und Backend), Build, API-Drift grün. Mit 16 parallelen Workern liefen 31 lange Integrationstests in die
  5-s-Frist (reine Lastfolge, einzeln grün; Vergleich mit V1 im temporären Worktree ohne Regression).
* **Im laufenden Stack** (Entwicklungskonto aus `docker-compose.yml`, PR-2026-0010, synthetische Werte):
  Vorlage „TEST Steckdosen“ und Betriebsstandard (Standardvorlage, Verteilung 50 cm) über die Seite, Projektvorgabe
  20 % über den Projektdialog; „Leitung hinzufügen“ → Verteilung → Wandpunkt (220 cm) → Steckdose → Dialog:
  F1 abgeleitet, Herkunft korrekt, Weg 520 + Reserve 104 + Zugaben 50 = **674 cm**; Server identisch (5 200/
  1 040/500 → 6 740 mm, Herkünfte, Basisversionen). Abweichung 15 % → „abweichend“, 78 cm, „Vorgabe übernehmen“;
  Escape, Weiterzeichnen, offener Abschluss; nach Neuladen derselbe Dialog für die bestehende Leitung, unverändertes
  Speichern ohne neue Version; Versions- und Vorgabenkonflikt (Projektvorgabe an anderer Stelle geändert) wie
  beschrieben; Wechsel Grundriss → Wand → Decke mit erhaltenem Entwurf; Verwerfen mit Rückfrage. Danach
  aufgeräumt (Vorgaben wieder „nicht gesetzt“, Vorlage gelöscht, sechs Bestandsleitungen unverändert).
* **Browserbefunde behoben:** (1) Ein Startgerät unter einer bestehenden Leitung oder Wandlinie wurde nicht
  erkannt – jetzt Ersatz über den Markierungsring (in Schritt 1 immer, beim Zeichnen nur über bestehenden
  Leitungen); (2) nach „Ansicht verschieben“ führten „Leitung hinzufügen“ und Taste L nicht zurück zum Zeichnen;
  (3) rohe Serverzeilen („geaendert“, „25.00 %“) im Vorgabenkonflikt – ersetzt durch den Vergleich; (4) die
  Betriebsstandard-Liste lief bei 375 px über den Kartenrand.
* **Optisch geprüft:** 1024×640, 1280×800, ~780 px Breite und 375 px (Seite und Dialoge), hell und dunkel
  (dunkel nur vorübergehend im Browser gesetzt; die gespeicherte Darstellung des Kontos blieb unverändert).

### 21.5 Offen (Stand nach §21.6)

* ~~Layout beim Zeichnen~~, ~~veraltete Statuszeile / „ungespeichert“ beim leeren Einstieg~~, ~~Werte erst beim
  Verlassen des Felds~~, ~~Wand aus dem Grundriss nur über „Weiterzeichnen“~~ – mit §21.6 behoben.
* Backendtexte aus V1 (`cables.py`, `planning-defaults-changed`) ohne Umlaute und mit Dezimalpunkt – im
  Frontend nicht sichtbar; bewusst keine Aufgabe dieser Runde.
* Persönliche Abnahme L1 und L2/L3; zentrale Anwendung (6c.6), Verteilungsaufbau, Phase 7 – zurückgestellt.

### 21.6 Nacharbeit: vier Bedienungslücken (2026-10-24)

**Auftrag:** die vier relevanten Punkte aus §21.5 innerhalb von L1/L2/L3 schließen. Nur Frontend; kein Backend,
keine Migration, kein neuer API-Vertrag. Uncommittet; Beurteilung von Layout und Leitungsbedienung offen.

**1 – Zeichenfläche.** Die Zeichenleiste ist eine Zeile (bei mittlerer Breite zwei): aktueller Schritt (nur er),
eine Rückmeldung, die Aktionen des Schritts und ein Hilfeknopf (?). Schritt 1 zeigt nur Schritt, Anweisung,
Abbrechen und Hilfe. Entfallen sind die drei Schrittchips, der Block „Leitungsentwurf offen“ während des
Zeichnens (Rückwege zu Mengen/3D stehen in der Leiste), die Dauertexte der Grundrissleitung (Klickziel,
Steighalte, Durchführung → Hilfedialog) und die eigene Statuszeile von Wand/Decke während des Zeichnens.
Höhenoptionen sind kurz („obere Zone“), schmal kürzere Knopftexte. Die L1-Höhenregel bleibt unverändert (Kopf,
Werkzeuge, Kontext natürliche Höhe, Fläche den Rest, Mindesthöhe 220 px, bei Platzmangel füllt die Arbeitsfläche
nach einem Scrollen das Fenster); neu: **„Leitung hinzufügen“ rollt die nicht vollständig sichtbare
Arbeitsfläche einmal ins Bild** (`arbeitsflaecheZeigen`). Zoom und Weltmitte bleiben bei Größenänderungen
(`groesseAendern`), Einpassen (F, „Ansicht zurücksetzen“) bleibt bewusst.

Gemessen im laufenden Stack, Schritt 2 aktiv (SVG-Höhe; „frei“ = nicht von Leiste, Hinweis oder Maßstab verdeckt):

| Fenster | bisher normal | bisher maximiert | jetzt normal | jetzt maximiert |
|---|---|---|---|---|
| 1280 × 800 | 220 px (≈187 frei), Leiste 120 px | 424 px (≈398) | **370 px (≈346)**, Leiste 74 px, ohne Scrollen | **600 px (≈576)** |
| 1024 × 640 | 228 px, erst nach 323 px Scrollen | 220 px (≈187), Leiste 156 px + Hilfetexte | **440 px (≈416)**, Start rollt ein | **400 px (≈376)**, Leiste 87 px |
| 390 × 844 | 531 px, Leiste (302 px) außerhalb des Bildes | 220 px (≈184) | **471 px (≈447)**, Leiste 220 px sichtbar | **471 px (≈447)** |

Optisch: bei 1280 × 800 und 1024 × 640 bleibt der Plan beim Zeichnen sichtbar und eingepasst groß genug, um
Wände und Geräte sicher zu treffen; schmal sind Schritt, Rückmeldung und alle Aktionen ohne Scrollen
erreichbar (sieben kurze Zeilen). Schritt 1 ist eine Zeile.

**2 – Direkter Flächenwechsel.** In der Zeichenleiste stehen sichtbare Knöpfe „Fläche:“ – im Grundriss
„→ Wand n“ (Wand des gewählten bzw. letzten Punkts oder des Startgeräts) und „↑ Decke“, in Wand/Decke
„Grundriss“, die Nachbarwände bzw. alle Wände und „↑ Decke“ (`leitung/Flaechenwechsel.tsx`, `zumGrundriss` im
Kontext). Ein Wechsel speichert nichts, setzt keinen Punkt, behält Entwurf, Start/Ziel, Wegpunkte, Angaben,
Rückgängig und Schritt; jede Fläche behält ihren Ausschnitt (`ansichten`, Grundriss-Viewport im Editor). Ein Klick
in die Zeichenfläche wechselt nie die Ansicht.

**3 – Status und Änderungszustand.** Eine Rückmeldung je Ablauf in der Zeichenleiste: die letzte Meldung der
Fläche, sonst Ergebnis der letzten Aktion („… gespeichert.“) und die aus dem Zustand abgeleitete Anweisung
(`anweisung`). `ablaufSchluessel` (Entwurf neu/bestehend/keiner · Schritt · Dialog) verwirft Meldungen bei jedem
Übergang (Escape, Dialog, Weiterzeichnen, Speichern, Verwerfen, nächste Leitung) und beim Flächenwechsel.
`leitungUngespeichert` gilt für neue Leitungen erst mit Eingaben: Der leere Einstieg zeigt kein „ungespeichert“,
fragt beim Abbrechen nicht und löst den Verlassen-Schutz nicht aus; ab dem Startgerät greifen Markierung,
Rückfrage und Navigationsschutz. Fehlgeschlagenes Speichern behält den Entwurf (unverändert).

**4 – Aktuelles Ergebnis.** Gültige Eingaben in Reserve, Zugaben, Kabelangaben und Bezeichnung gehen beim Tippen
in den Entwurf; die Rechnung bleibt die gemeinsame Längenfunktion. Tippen im selben Feld ist **ein**
Rückgängig-Schritt (`eingabeFeld`). Leer, „12,“ oder Text sind nie eine stille Null: Das Ergebnis heißt dann
„Ergebnis nicht aktuell“ (gedimmt, ohne Statusmarke), Speichern ist mit Grund gesperrt; der Feldfehler erscheint
nach Verlassen oder Enter. Ein leeres Prozentfeld wurde bisher als 0 % übernommen – behoben. Wer beim Tippen
wieder beim Vorgabewert ankommt, behält die Herkunft „Vorgabe“. Nachweis „Zahl ändern → sofort speichern“:
Browser (12,5 % getippt, Fokus im Feld, „Leitung speichern“ → Server `12.50`, 650 mm, 5 850 mm = Anzeige 585 cm)
und Test.

**Tests.** Neu: Flächenwechsel Grundriss → Wand → Decke → Grundriss mit unveränderten Wegpunkten, ohne Speichern;
Rückmeldung nach Start, Zeichnen, Dialog, Weiterzeichnen, Escape, Speichern und nächster Leitung; leerer
Einstieg ohne Änderungszustand, mit Startgerät Rückfrage; sofortige Rechnung, Zwischenstände ohne Null, letzte
Eingabe ohne Feldwechsel gespeichert; Rückkehr zur Vorgabe; feste und prozentuale Bestandsreserve beim
sofortigen Speichern; Reducer: ein Rückgängig-Schritt je Feld. Angepasst: Struktur der Leiste (Statusblock,
Hilfetexte, Wechselknöpfe). Frontend **1 250/1 250** (`--maxWorkers=6`, 72 s); ESLint, `tsc`, Modulgrenzen,
Build, API-Drift grün. Browser: oben genannte Abläufe mit synthetischen Werten, Daten danach entfernt.

**Offen** (zwei Punkte mit §21.7 behoben): ~~maximiert weniger Fläche als normal bei 1024 × 640~~, ~~Plansprung
beim Übergang Schritt 1 → 2~~. Sehr kleine Fenster (unter ~450 px Höhe) erreichen weiter nur die Mindesthöhe.

### 21.7 Nacharbeit: Höhe der Planungsarbeitsfläche (2026-10-24)

**Auftrag:** die beiden verbliebenen Höhenprobleme aus §21.6 beheben, dann L1/L2/L3 als Checkpoint sichern. Nur
Frontend, keine neue Zeichenlogik, kein Backend, keine Migration. Die persönliche Beurteilung von Layout und
Leitungsbedienung bleibt offen; es wird keine Abnahme dokumentiert.

**Ursachen.** (1) Maximiert trug der Knopf rechts oben den Text „Normale Ansicht“, normal nur das Symbol – bei
1024 px brach die Werkzeugzeile dadurch um, die Fläche begann 39 px tiefer. Zusätzlich setzte der Browser beim
Maximieren die Scrollposition auf 0 (ohne feste Höhe ist die Seite kurz); zurück in der normalen Ansicht stand
die eingerollte Arbeitsfläche nicht mehr im Bild. (2) Die Zeichenleiste war in Schritt 1 eine Zeile, in
Schritt 2 zwei (bei 1024 px drei) – die Fläche verlor beim Startklick 34–47 px, der Plan rückte um die Hälfte.

**Korrekturen.**
* **Gleiche Aufteilung normal und maximiert:** „Normale Ansicht“ als Text erst ab 80 rem (1 280 px), darunter
  Symbol mit Name und Kürzel M wie „Zeichenfläche maximieren“ (`SEHR_BREIT`, `useMedium` in `kompakt.ts`).
  Die Scrollposition vor dem Maximieren wird gemerkt und nach dem Zurückschalten wiederhergestellt, sobald die
  Höhenregel die Seite wieder verlängert hat (Knopf, Taste M und Escape).
* **Höhenstabile Zeichenleiste:** Zwei feste Zeilen auf breiten Fenstern – oben Schritt, Rückmeldung (einzeilig,
  voller Text im Hinweis und für Screenreader) und Abschluss/Abbrechen/Hilfe; unten die Werkzeuge des Schritts. In
  Schritt 1 belegt die untere Zeile eine kurze Vorschau („Danach: Verlauf zeichnen – Wandlinie = Wandpunkt …“),
  ihre Mindesthöhe entspricht der Werkzeugzeile. Unter 80 rem kurze Texte („Ecke: waagerecht“, „Durchführung“;
  Name und Hinweis bleiben vollständig), damit Schritt 2 auch bei 1 024 px in eine Zeile passt. Schmal (unter
  60 rem) darf die Leiste weiterhin umbrechen.

**Messung im laufenden Stack** (synthetische Daten, PR-2026-0010). Jede Messung erst nach stabiler Größe: Fläche,
Planmatrix, Leistenhöhe und Scrollposition über acht Animationsframes unverändert (keine festen Pausen).
„frei“ = sichtbare und nicht verdeckte Zeichenfläche.

| Fenster | normal | maximiert | vorher normal / maximiert (§21.6) |
|---|---|---|---|
| 1280 × 800 | 366 px (336 frei) | 610 px (586 frei) | 370 / 600 px |
| 1024 × 640 | 450 px (420 frei), eingerollt | **450 px (420 frei)** | 440 / **400 px** |
| 390 × 844 | 467 px (437 frei) in Schritt 2 | 467 px (437 frei) | 471 / 471 px |

Übergang „Leitung hinzufügen“ → Startgerät → Wegpunkt → Ziel (Dialog) → Weiterzeichnen → Abschluss und Speichern
→ nächste Leitung → nächster Start: bei **1 280 × 800 und 1 024 × 640 unverändert** – Bezugspunkt (Südwand der
Diele) y 591,2 bzw. 389,1 px, Zoom 0,0255, Weltmitte (4 000 | 2 750) mm, Flächen- und Leistenhöhe (366/76 bzw.
450/76 px) in allen neun Zuständen gleich; der Wegpunkt lag an der vor dem Startklick berechneten Stelle.
Maximieren und zurück (M, Knopf, Escape): Planlage, Zoom und Weltmitte gleich, Scrollposition (325 px)
wiederhergestellt. Schmal (390 × 844): keine Überlappung von Fläche und Leiste, alle Knöpfe im Bild und
unverdeckt, keine Querbreite; die Leiste wächst dort beim Startklick weiterhin (Umbruch zulässig).

**Optische Prüfung:** In dieser Runde **nicht** zuverlässig möglich – die Bildschirmfotos des eingebetteten
Browsers zeigten die emulierten Größen nur verkleinert oder als Ausschnitt; sie gelten nicht als Sichtprüfung.
Belegt sind die Messwerte oben; die optische Beurteilung bleibt offen (persönliche Abnahme).

**Tests.** Neu: Verhaltenstest „Maximieren und zurück (Knopf oder Escape) lässt die eingerollte Arbeitsfläche
dort, wo sie war“ – scheitert ohne die Korrektur (Gegenprobe). Die Höhenstabilität der Leiste ist in jsdom ohne
Layout nicht sinnvoll prüfbar und durch die Browsermessung belegt; kein Test, der nur Klassen festschreibt.
Typprüfung, ESLint, Modulgrenzen, Build, API-Drift grün. Frontend-Gesamtlauf (6 Worker, reguläre Fristen):
**1 251/1 251 grün** (75 s). Ein erster Lauf unter fremder Last (CPU 76 %, 213 s) hatte zwei
5-s-Zeitüberschreitungen langer Integrationstests (`Leitung3d`, `WandansichtGeraete`, allein grün); nach Ende der
Last einmal wiederholt.

**Checkpoint:** L1/L2/L3 mit allen Nachkorrekturen (§21–§21.7) als technisch geprüfter Stand committet
(Task 0062); persönliche Beurteilung von Layout und Leitungsbedienung sowie die optische Prüfung offen.

## 16. Geänderte Dokumentation durch diesen Entwurf

Neu: dieser Entwurf, ADR 0027–0029 (proposed). Aktualisiert: `current-status.md` (Phase 6c, Phase 7
zurückgestellt), `roadmap.md` (Phase 6c, Abhängigkeit Phase 7), `decisions/README.md` (Index),
`glossary.md` (Begriffe „Entwurf 6c“), `task-history.md` (Task 0051). Keine Änderung an Code, Migrationen,
OpenAPI oder API-Client.
