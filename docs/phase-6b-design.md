# Phase 6b – Entwurf: Verteilungen, Stromkreise, Leitungen und Leitungslängen

**Status:** **2. Fassung, vom Auftraggeber als Umsetzungsgrundlage freigegeben (2026-10-11)** ·
D1, D2, D4, D5, D11 bestätigt · **6b.0 und 6b.1 umgesetzt** (technisch geprüft, Checkpoint `541bae9` vom 2026-10-12) ·
**6b.2 und 6b.3 technisch umgesetzt und geprüft** (Checkpoint `53fdc19` vom 2026-10-13; manuelle Gesamtprüfung nach Phase 6
offen) · **6b.4 technisch umgesetzt und funktional geprüft** (Checkpoint `0c07604` vom 2026-10-13) ·
**6b.5 technisch umgesetzt und funktional geprüft** (Checkpoint `62a1cc9` vom 2026-10-14 inklusive Nachkorrekturen §20.7) ·
**6b.6 technisch umgesetzt und geprüft** (Checkpoint vom 2026-10-15, §21) · Umsetzungsstand: **§15–§21** (vor §14) ·
**Phase 6 technisch umgesetzt und geprüft; manuelle Gesamtprüfung durch den Auftraggeber ausstehend**
**Grundlage:** Checkpoint `686316c` (Phase 6a.0–6a.5, gepusht), [ADR 0024](decisions/0024-wall-links-physical-wall-assignment.md),
[ADR 0025](decisions/0025-risers-between-floors.md), [`phase-6a-design.md`](phase-6a-design.md)
**ADR:** [ADR 0026 – Stromkreise, Leitungen und Leitungswege](decisions/0026-circuits-cables-and-cable-paths.md) (**accepted**)

> Dieser Entwurf beschreibt, **was** gebaut werden soll und **warum**. Er enthält keine
> Implementierung, keine Migration und keinen Schema-Platzhalter. Alle Beispiele sind synthetisch.
> ElektroPlan rechnet, dokumentiert und schlägt vor; es dimensioniert nichts und bescheinigt
> keine Normkonformität (`security.md` §17). Material, Preise und Kalkulation bleiben Phase 7+.

**Freigabe (2026-10-11):** D11 bestätigt, Bodenübergang präzisiert (§5.6); der Entwurf ist
Umsetzungsgrundlage. Spätere Präzisierungen stehen im Umsetzungsstand §15.

**Änderungen gegenüber der 1. Fassung:** D1, D2, D4, D5 vom Auftraggeber bestätigt (§13);
**vereinfachte Fußbodenführung** bereits in 6b (§5.5); **tatsächliche Kabelangaben je Leitung**
statt Leitungstyp am Stromkreis, Stromkreis nur noch Vorschlag (§3.2, §6.5, D6 geändert);
**Gegenseite einer Durchführung** über die vorhandene exakte Abschnittstransformation statt
pauschal `L − offset` (§5.2); Umsetzungsschritte, Tests und offene Fragen angepasst.

---

## 0. Kurzfassung und MVP-Empfehlung

| Thema | Festlegung |
|---|---|
| Verteilung | elektrischer Bezugspunkt je **Gebäude**, **mehrere je Gebäude möglich**; Lage über ein Gerät `distribution_board` (**D1, D2 bestätigt**) |
| Stromkreis | gehört zu genau einer Verteilung; Kabelangaben sind **Vorschläge** für neue Leitungen, ausdrücklich so bezeichnet |
| Gerätezuordnung | eigene Tabelle, ein Gerät in höchstens einem Stromkreis; nicht zugeordnete Geräte sind ein sichtbarer Zustand |
| Leitung | physisches Kabel eines Stromkreises zwischen zwei Geräten; trägt ihre **tatsächlichen** Kabelangaben selbst |
| Leitungsweg | Wegpunktliste je Leitung auf **Wand, Decke, Fußboden**, Durchführung, Bodenübergang an einer Tür/einem Durchgang und Steigweg; gemeinsame Trassen **abgeleitet** |
| Durchführung | einmal an der Eigentümerwand einer aktiven `shared`-Kopplung; Gegenseite über die exakte Abschnittstransformation |
| Steigweg | wird genutzt, nicht kopiert |
| Länge | eine reine Funktion (Backend Quelle, Frontend Spiegel, gemeinsame Fixture); geometrisch, Zugaben, bestätigt, Teilsumme, Konflikt getrennt |
| Zugaben | nur ausdrücklich je Leitung, keine Projektstandardwerte (**D5 bestätigt**) |
| Wandänderung bricht Leitung | nur nach ausdrücklicher Bestätigung mit verständlicher Liste; danach Konflikt ohne Länge (**D4 bestätigt**); Durchführungen hart geschützt |
| Mengen | Leitungsmeter je **tatsächlicher** Kabelangabe, unvollständig spezifizierte Leitungen eigens; Trassenmeter einmal; Durchführungen; Geräte – ohne Material/Preise |
| Events / Core | keine neuen Events, keine Core-Änderung |
| Arbeitsflächen | Wand-/Deckenansicht präzise, **Grundriss für Fußboden** und Überblick, 3D nur Darstellung |

---

## 1. Befund zum vorhandenen Stand

Geprüft am Code (`686316c`) und an `electrical.md`, ADR 0010, 0016, 0022–0025.

| Befund | Beleg | Folge für 6b |
|---|---|---|
| Gerätekatalog: 13 Typen in vier Kategorien, **keine Verteilung, keine Abzweigdose**; `category` per CHECK begrenzt | `catalog.py`, `models.py` | neue Typen und Kategorien (Migration + Seed) |
| Gerät: Montagefläche, Wand + Abstand + Höhe der Mitte über FFB bzw. Decke `x/y`; wechselt nie die Wand | ADR 0023 | Geräte sind die Endpunkte einer Leitung |
| „keine neuen, keine größeren Befunde“ unter der Projektsperre | `device_rules.py` | trägt die Prüfung von Leitungswegen (§7) |
| Wandtopologie: exakte Lagen `whole + steps·√m`, Abschnitte mit Quellen je Wand, Abbildung Quellwand → Abschnitt → Partnerwand (`_local`, `_back`; Frontend `lokalerBereich`, `wandbereich`) | `topology.py`, `topologie/oeffnungen.ts` | dieselbe Abbildung für die Gegenseite einer Durchführung (§5.2) |
| Kopplungen, Zustände und Status; 6a §4.1: Durchführungen werden ab 6b hart geschützt | `link_rules.py` | übernommen |
| Steigweg-Polylinie aus `riser_course`, stabile Halt-IDs | 6a.4 | Leitungen referenzieren Steigweg und Halte |
| Raumhöhe = lichte Höhe; **keine Rohdecke, kein Fußbodenaufbau** | ADR 0016, 6a §1.2 | Decke und Fußboden sind Planungsflächen in lichter Höhe bzw. auf FFB |
| Grundriss-Editor: Welt-/Bildkoordinaten, Fang (Raster, Endpunkte), Werkzeuge, Raumseite beim Wandklick | `editor/` | reicht für Fußbodenwege – keine neue Editoroberfläche (§5.5) |
| Phase-0-Planung: Leitungstyp am Stromkreis, gespeicherte Längen, stille Standardzugaben | `electrical.md` §4–§5 | präzisiert: Angaben je Leitung, keine gespeicherten Längen, keine stillen Zugaben |
| Event `electrical.circuit.changed` geplant | `events.md` §6 | nicht einführen ohne Konsumenten |

---

## 2. Begriffe

| Begriff | Bedeutung | Ist **nicht** |
|---|---|---|
| **Verteilung** | elektrischer Bezugspunkt (Code `UV1`, Name) | ihre Lage – die ist ein Gerät `distribution_board` |
| **Stromkreis** | logische Einheit an einer Verteilung; Kabelangaben dort sind **Vorschläge** | eine Leitung |
| **Gerätezuordnung** | „Gerät hängt an diesem Stromkreis“ | eine Leitungsverbindung |
| **Leitung** | ein physisches Kabelstück zwischen zwei Geräten mit **eigenen** Kabelangaben | eine Trasse |
| **Kabelangaben** | Leitungstyp, Leiteranzahl, Querschnitt – manuell, ungeprüft | eine Dimensionierung |
| **Leitungsweg / Wegpunkt** | Führung einer Leitung über verankerte Punkte | eine freie 3D-Koordinate |
| **Planungsfläche** | Wand (Innenseite), Decke (lichte Raumhöhe), **Fußboden** (FFB-Ebene) eines Raums | ein Bauteilaufbau |
| **Trasse** (abgeleitet) | Strecke mit mindestens einer Leitung; exakt aufeinanderliegende Wege bilden eine Trasse | gespeichert |
| **Durchführung** | Durchquerung einer bestätigten gemeinsamen Bauwand, einmal an der Eigentümerwand gespeichert | eine Öffnung |
| **Bodenübergang** | Fußbodenweg, der unter einer Tür oder einem Durchgang in den Nachbarraum führt | ein Weg unter einer geschlossenen Wand |
| **Anschlussstrecke** | abgeleitete Strecke vom letzten Wegpunkt zur Gerätemitte | gespeichert |
| **Anschlusszugabe / Reserve** | ausdrücklich je Leitung eingetragene Zusatzlänge | ein stiller Zuschlag |

Aufnahme in `glossary.md` als „Entwurf 6b“ ist erfolgt; endgültig mit 6b.0.

---

## 3. Datenmodell (Eigentümer: Modul `electrical`)

Alle Tabellen mit `organization_id`, zusammengesetzten FKs `(organization_id, id)` (ADR 0006),
ganzzahligen Millimetern (ADR 0007), Zeitstempeln. **Keine gespeicherten Längen.** Keine Core-Tabelle,
kein neuer Contract.

### 3.1 Verteilung, Stromkreis, Zuordnung

```text
electrical_distribution_boards
  id, organization_id, building_id, code varchar(16), name varchar(120), note varchar(500) NULL,
  placement_device_id NULL, version, timestamps
  UNIQUE (organization_id, building_id, code)            -- mehrere Verteilungen je Gebäude
  UNIQUE (organization_id, placement_device_id)
  FK building RESTRICT · FK placement_device -> electrical_devices RESTRICT

electrical_circuits
  id, organization_id, board_id, designation varchar(16), name varchar(120), sort_order int,
  proposed_cable_type varchar(40) NULL,                 -- Vorschlag für neue Leitungen
  proposed_conductor_count smallint NULL,
  proposed_cross_section_mm2 numeric(6,2) NULL,          -- API: String (ADR 0005)
  protective_device varchar(40) NULL, rcd_group varchar(40) NULL, phase_count smallint NULL,
  note varchar(500) NULL, version, timestamps
  UNIQUE (organization_id, board_id, designation)
  FK board RESTRICT                                      -- Verteilung mit Stromkreisen: 409

electrical_circuit_devices
  organization_id, device_id, circuit_id, timestamps
  PK (organization_id, device_id)                        -- höchstens ein Stromkreis je Gerät
  FK device CASCADE · FK circuit CASCADE
```

### 3.2 Leitung mit tatsächlichen Kabelangaben

```text
electrical_cables
  id, organization_id, circuit_id, label varchar(60) NULL,
  start_device_id, end_device_id,
  cable_type varchar(40) NULL, conductor_count smallint NULL, cross_section_mm2 numeric(6,2) NULL,
  start_allowance_mm int DEFAULT 0, end_allowance_mm int DEFAULT 0, reserve_mm int DEFAULT 0,
  version, timestamps
  CHECK (start_device_id <> end_device_id), CHECK (Zugaben 0 … 20 000)
  FK circuit CASCADE · FK start/end_device RESTRICT
```

**Was für eine Leitung gilt:** ausschließlich die drei Spalten **an der Leitung**. Es gibt keine
Vererbung zur Laufzeit.

| Vorgang | Wirkung |
|---|---|
| Leitung anlegen | Die Oberfläche füllt die Felder mit dem **aktuellen** Stromkreisvorschlag vor und kennzeichnet sie „aus Vorschlag“; gespeichert wird, was im Formular steht (auch leer). Der Server ergänzt nichts. |
| Abweichen | jederzeit je Leitung, z. B. 5-adrig statt 3-adrig für eine Schalterleitung |
| Stromkreisvorschlag später ändern | **ändert keine bestehende Leitung.** Die Liste markiert Leitungen „weicht vom aktuellen Vorschlag ab“. Eine Übernahme ist eine **ausdrückliche** Aktion „Vorschlag auf ausgewählte Leitungen übertragen“ mit Rückfrage, die die Leitungen namentlich nennt (§8.2) |
| Fehlende Angabe | Leitung gilt als **unvollständig spezifiziert**; ihre Länge kann trotzdem bestätigt sein, sie wird aber nie unter einem erfundenen Typ gezählt (§6.5) |

Keine Prüfung, ob Querschnitt, Leiteranzahl oder Schutzorgan zusammenpassen.

### 3.3 Durchführung und Wegpunkte

```text
electrical_wall_penetrations
  id, organization_id, wall_link_id, offset_mm int, height_mm int, note varchar(200) NULL,
  version, timestamps
  -- Lage an der Eigentümerwand = wall_a der Kopplung
  FK wall_link RESTRICT

electrical_cable_waypoints                              (Liste wird als Ganzes ersetzt)
  id, organization_id, cable_id, seq int, kind varchar(16)
  -- wall:             wall_id, offset_mm, height_mm
  -- ceiling | floor:  room_id, x_mm, y_mm
  -- penetration:      penetration_id
  -- opening_crossing: wall_id, offset_mm, opening_id NULL   (Lage auf der Achse der Quellwand;
  --                   opening_id ist nur der fachliche Bezug, nicht die Lage – §5.6)
  -- riser:            riser_id, from_stop_id, from_height_mm, to_stop_id, to_height_mm
  UNIQUE (organization_id, cable_id, seq); CHECK je kind genau die zugehörigen Spalten
  FK cable CASCADE · übrige RESTRICT
```

**Neue Katalogtypen (Seed):** `distribution_board` (Kategorie `distribution`, Wand innen,
550 × 700 mm, Standardmitte 1 400 mm) und `junction_box` (Kategorie `junction`, Wand innen und
Decke, 80 × 80 mm, Standardmitte 2 200 mm). Verteilung und Abzweigdose nutzen dieselbe
Platzierung, Prüfung und Bedienung wie jedes Gerät. Eine Verteilung ohne Platzierung ist zulässig;
ihre Leitungen haben dann keinen Startpunkt und **keine** Länge.

---

## 4. Bezugssysteme und Verankerung

| Größe | Bezug |
|---|---|
| `x_mm`, `y_mm` | Geschosskoordinaten (ADR 0013) – Decke, Fußboden, Steigweghalt |
| `offset_mm` an einer Wand | ab **Wandanfang** der gerichteten Raumwand, auf der Wandachse |
| `height_mm` | **lokal** über dem Fertigfußboden (FFB) des Geschosses |
| Decke | effektive lichte Raumhöhe |
| **Fußboden** | **Höhe 0 = FFB**; Wege liegen modellhaft auf der FFB-Ebene |
| absolute Höhe `z` | `floors.elevation_mm + height_mm` – nur für Steigweganteile und 3D |

* Innerhalb eines Geschosses rechnet jede Länge mit **lokalen** Höhen und hängt **nie** von der
  Bestätigung der Höhenlage ab.
* Gemessen wird auf der **Wandachse**; an einer Innenecke liegt das Achsmaß um höchstens eine
  Wandstärke über dem Oberflächenweg – dokumentiert, kein Zuschlag (D10).
* Wandwege nur auf der **Innenseite** der Raumwand. Außen- und Erdleitungen sowie
  gebäudeübergreifende Leitungen sind spätere Erweiterungen (**D2**).

---

## 5. Leitungsweg

### 5.1 Zulässige Teilstrecken

```
Startgerät ─Anschlussstrecke─ W1 ─ … ─ Wn ─Anschlussstrecke─ Endgerät
```

| Art | Bedingung | Länge |
|---|---|---|
| **Wand** | beide Punkte auf derselben Raumwand; waagerecht **oder** senkrecht | exakt |
| **Ecke** | Wand A Ende ↔ Wand B Anfang (zyklische Nachbarn), gleiche Höhe | 0 |
| **Wand ↔ Decke** | Wandpunkt auf Raumhöhe, Deckenpunkt exakt an derselben Stelle der Wandachse | 0 |
| **Wand ↔ Fußboden** | Wandpunkt auf Höhe 0, Fußbodenpunkt exakt an derselben Stelle der Wandachse | 0 |
| **Decke** / **Fußboden** | beide Punkte auf derselben Fläche **desselben Raums**; gerade Strecke vollständig in der **echten** Raumkontur (exakt, auch L-Raum) | einmal gerundet (ADR 0013) |
| **Durchführung** | Wandpunkt Seite A → Durchführung → Wandpunkt Seite B an der transformierten Lage (§5.2) | 0 (auf der Achse) |
| **Bodenübergang** | Fußbodenpunkt Raum A → Übergang innerhalb einer Tür/eines Durchgangs → Fußbodenpunkt Raum B (§5.5) | Teil der beiden geraden Fußbodenstrecken |
| **Steigweg** | Ein-/Ausstieg auf dem Verlauf (§5.3) | Teil der Steigweg-Polylinie |
| **Schachtfortsetzung** | senkrecht über/unter einem Halt zu einem Wand- oder Deckenpunkt genau darüber | exakt |
| **Anschlussstrecke** (abgeleitet) | Wandgerät: senkrecht auf Wegpunkthöhe, dann waagerecht, auf **derselben** Wand; Deckengerät: gerade in der Decke | exakt bzw. einmal gerundet |

**Nicht zulässig:** schräge Strecken auf Wänden, Wandwechsel ohne Ecke, Luftlinien durch den Raum,
**Raumwechsel ohne Durchführung oder Bodenübergang**, Fußboden- oder Deckenstrecken über die
Raumkontur hinaus, Wandstrecken durch eine Öffnung. Ablehnung beim Speichern mit `422`, Code und Ort.

### 5.2 Durchführung und ihre Gegenseite

* Nur in einem Abschnitt im Zustand `shared` mit Kopplungsstatus `active` – nicht bei
  `undecided`, `ambiguous`, `broken`, `separate` (6a D9 bleibt zurückgestellt).
* Gespeichert **einmal** an der Eigentümerwand `wall_a` (`offset_mm`, `height_mm`).
* **Gegenseite:** nicht pauschal `L_b − offset`. Die Wände können entgegengesetzt oder gleich
  gerichtet sein, versetzt beginnen, verschieden lang sein und nur teilweise überlappen. Die Lage
  wird mit der vorhandenen exakten Abschnittstransformation abgebildet:

  ```
  Lage auf wall_a  --(_local)-->  Lage im gemeinsamen Abschnitt (kanonische Richtung)
                   --(_back)--->  Lage auf wall_b, ab deren Wandanfang
  ```

  Die Lagen sind exakt `whole + steps·√m` (`topology.py`, Frontend `lokalerBereich`/`wandbereich`).
  Für achsparallele Wände ist die Gegenlage immer ganzzahlig. Bei schrägen Wänden kann sie
  irrational sein; eine Wandstrecke auf der Gegenseite zwischen der Durchführung und einem
  ganzzahligen Wegpunkt wird dann **einmal** kaufmännisch gerundet (exakter Betrag über Quadrate) –
  dieselbe Konvention wie Wandlängen. Die Höhe ist auf beiden Seiten gleich (gleiches Geschoss,
  gleicher FFB).
* Die Durchführung muss im gemeinsamen Abschnitt liegen, unter **beiden** Raumhöhen und außerhalb
  jeder eigenen oder abgeleiteten Öffnung.
* Mehrere Leitungen nutzen eine Durchführung; gezählt wird sie **einmal**. Eine ungenutzte bleibt
  sichtbar bestehen und wird nie still gelöscht.

**Beispiele (Testfälle der Fixture, achsparallel):**

| Fall | wall_a | wall_b | Durchführung an wall_a | Lage an wall_b |
|---|---|---|---|---|
| entgegengesetzt, gleich lang | (4200,0)→(4200,3000) | (4200,3000)→(4200,0) | 2 100 | 900 |
| gleich gerichtet, versetzter Anfang | (0,3000)→(9000,3000) | (3000,3000)→(6000,3000) | 4 000 | 1 000 |
| entgegengesetzt, verschieden lang, teilweise Überlappung | (0,3000)→(5000,3000) | (8000,3000)→(3000,3000) | 4 000 | 4 000 |
| außerhalb des gemeinsamen Abschnitts | (0,3000)→(5000,3000) | (8000,3000)→(3000,3000) | 1 000 | – (`422`, nicht im Abschnitt) |

Rückweg: Lage an wall_b über dieselbe Transformation zurück ergibt **exakt** die gespeicherte Lage
an wall_a (Hin- und Rücktransformation ohne Positionsänderung, auch für schräge Wände über
`whole + steps·√m`). Ein Fixture-Fall prüft eine schräge Wand mit irrationaler Gegenlage.

### 5.3 Steigweg nutzen

* **Einstieg** auf der Senkrechten am unteren Halt eines Abschnitts in Höhe `from_height_mm`
  (0 ≤ h < Δz) über dessen FFB; die Leitung nutzt den Steigweg erst **ab** h – keine Doppelzählung.
  Über einen **Fußbodenweg** gelingt der Einstieg direkt mit h = 0 am Halt (Fußbodenpunkt exakt
  auf dem Halt).
* **Ausstieg** am oberen Halt (FFB oben); weiter auf dem Fußboden des oberen Raums (Halt innerhalb
  der Raumkontur) oder per Schachtfortsetzung nach oben.
* Zwischenhalte dürfen durchfahren werden. Die genutzte Länge ist der Abschnitt der **einen**
  `riser_course`-Polylinie; nichts wird kopiert.

Beispiel (6a §3.4, orthogonal, bestätigt): Einstieg EG bei h = 2 200, Ausstieg OG →
700 + 750 = **1 450 mm**.

### 5.4 Verzweigung und gemeinsame Trasse

Ein Stromkreis ist ein Baum aus Leitungen; eine Leitung verzweigt nie, verzweigt wird an Geräten
(Abzweigdose, Verbraucher). Exakt aufeinanderliegende Wege **auf derselben Planungsfläche**
(dieselbe Wand und Höhe bzw. Gerade; dieselbe Decke; derselbe Fußboden) bilden eine Trasse,
abgeleitet wie die Wandtopologie, nie gespeichert.

Zählbeispiel: drei Leitungen auf einer Flurwand in 2 200 mm Höhe – L1 und L2 über 0–4 000,
L3 über 1 000–3 000.

| Größe | Wert |
|---|---|
| Trassenmeter (Vereinigung) | **4 000 mm** |
| Leitungsmenge | 4 000 + 4 000 + 2 000 = **10 000 mm** |
| Belegung | 0–1 000: 2 · 1 000–3 000: 3 · 3 000–4 000: 2 |

Eine Fußbodenstrecke und eine Deckenstrecke mit gleichem Grundriss sind **zwei** Trassen.

### 5.5 Vereinfachte Fußbodenführung

**Zweck:** In Bestandsbauten und bei Bodentanks oder Kücheninseln wird oft im Fußboden verlegt.
Ohne Fußbodenfläche wären solche Leitungen nur über Wände planbar und ihre Länge falsch.

**Modell:**

* Je Raum eine Fußboden-Planungsfläche auf **Höhe 0 = FFB**. Kein Estrich-, Dämm-, Rohdecken- oder
  Schichtenmodell, keine Leerrohre, keine Fußbodenheizung.
* Fußbodenstrecke: gerade, vollständig in der echten Raumkontur, einmal gerundet.
* Übergang **Wand ↔ Fußboden** an der Wandunterkante (Wandpunkt Höhe 0, Fußbodenpunkt auf der
  Wandachse an derselben Stelle). Ein Wandgerät erreicht den Fußboden über seine Anschlussstrecke
  (senkrecht bis 0, waagerecht 0) und einen Wandpunkt auf Höhe 0.
* Übergang **Fußboden ↔ Steigweg** am Halt, wenn er in der Kontur des Raums liegt (h = 0).
* **Raumwechsel** im Fußboden **nicht** automatisch unter Wänden hindurch (**D11 bestätigt**).
  Zulässig nur
  * über eine ausdrücklich geplante **Durchführung** (Regeln §5.2) mit Übergang Wand ↔ Fußboden
    auf beiden Seiten, oder
  * über einen ausdrücklich gesetzten **Bodenübergang** (§5.6).
  Eine vorhandene Tür erzeugt **nie** von selbst einen Übergang. Der Bodenübergang ist eine
  vereinfachte Planungsannahme, keine Aussage über bauliche Machbarkeit oder Normkonformität.
* Fußbodenwege beeinflussen weder Wand- noch Gerätebefunde.

### 5.6 Bodenübergang – Bedingungen und Änderungen

**Bedingungen** (alle beim Speichern der Leitung unter der Projektsperre geprüft, sonst `422`
mit Code und Ort):

1. Wegpunkt `opening_crossing` mit `opening_id` und `offset_mm` an der **Wand, an der die Öffnung
   gespeichert ist** (Quellwand, ab deren Wandanfang).
2. Art der Öffnung `door` oder `passage` – **kein** Fenster (`opening-crossing-window`).
3. `offset_mm` liegt **innerhalb** der Öffnungsbreite, Kanten eingeschlossen
   (`offset ≤ x ≤ offset + width`) (`opening-crossing-outside`).
4. Die Öffnung verbindet **genau die beiden Räume** der angrenzenden Fußbodenwegpunkte: An der
   Stelle `x` liegt auf der Wandachse genau ein Abschnitt mit genau zwei Raumwänden (der
   Quellwand und einer Wand des Nachbarraums), Zustand `shared` oder `undecided` – die Öffnung
   gilt dann für beide Räume (eigene + abgeleitete). Bei `separate` (Öffnung nur einseitig), bei
   drei oder mehr Wänden (mehrdeutig) und ohne Nachbarraum (Außenseite) ist kein Übergang möglich
   (`opening-crossing-not-connecting`).
5. Unmittelbar davor und danach liegt je ein **Fußbodenwegpunkt** in je einem der beiden Räume;
   beide Fußbodenstrecken enden genau im Übergangspunkt (Wandachse an `x`) und liegen vollständig
   in ihrer Raumkontur (`opening-crossing-sequence`).
6. Übergänge werden vom Benutzer gesetzt (Klick auf die Tür im Grundriss, Werkzeug „Leitung“,
   Ebene „Fußboden“) – die Oberfläche schlägt keine Tür automatisch vor und legt nichts an.

Die Lage wird nur einmal gespeichert (Quellwand); die Gegenseite ergibt sich über dieselbe
Abschnittstransformation wie bei Durchführungen (§5.2). Gezählt wird ein Bodenübergang je Leitung
(er ist kein gemeinsames Bauteil wie eine Durchführung).

**Änderungen an Öffnung oder Zuordnung** – betroffene Leitungen bleiben **nie** unbemerkt gültig.
Alle folgenden Fälle laufen über die Leitungsbefunde vor/nach dem Schreiben (§7) und brauchen die
ausdrückliche Bestätigung `acknowledged_cable_ids` (D4); ohne sie `409 cables-would-break` mit
der verständlichen Liste. Nach der Bestätigung ist die Leitung `conflict` (Befund
„Bodenübergang ungültig“ mit Grund), ohne Gesamtlänge und nicht in bestätigten Mengen:

| Änderung | Befund |
|---|---|
| Öffnung verschoben oder verkleinert, Übergangspunkt liegt nicht mehr in der Breite | außerhalb der Öffnung |
| Öffnung entfernt | Öffnung fehlt (Speicherstrategie unten) – die Leitung bleibt bestehen und ist `conflict` |
| Art in `window` geändert | Fenster |
| Wand verschoben, Abschnitt nicht mehr gemeinsam, dritte Wand, Nachbarraum entfernt | verbindet die Räume nicht mehr |
| Zuordnung auf `separate` geändert | Öffnung gilt nur einseitig (bei Durchführungen dagegen harte Ablehnung, §5.2) |
| Kopplung gelöst (`undecided`) | **kein** Befund – die Öffnung gilt weiterhin beidseitig |

**Speicherstrategie für eine entfernte Referenzöffnung** (festgelegt 2026-10-11, Umsetzung 6b.3):

1. Der Wegpunkt `opening_crossing` speichert seine **Lage selbst**: `wall_id` (Quellwand der
   Öffnung) und `offset_mm` auf deren Achse. Die Geometrie hängt damit nie an einer weiterhin
   existierenden Öffnung. `opening_id` ist nur der fachliche Bezug (nullable,
   Fremdschlüssel `RESTRICT`).
2. Entfernt ein Konturspeichern eine Öffnung, auf die ein Bodenübergang verweist, verlangt der
   Server die ausdrückliche Bestätigung `acknowledged_cable_ids` (sonst
   `409 cables-would-break` mit der verständlichen Liste, D4).
3. **Mit** Bestätigung setzt derselbe Speichervorgang – in derselben Transaktion, unter der
   Projektsperre, vor dem Löschen der Öffnung – `opening_id = NULL` an genau diesen Wegpunkten
   und zählt die Version der betroffenen Leitungen weiter. Das ist die bestätigte Wirkung, kein
   stiller Nebeneffekt; der Fremdschlüssel `RESTRICT` sichert, dass es keinen anderen Weg gibt.
4. Danach bleibt die Leitung **mit allen Wegpunkten** bestehen; kein Wegpunkt wird entfernt oder
   verschoben. Die Längenfunktion meldet am Wegpunkt den Befund
   `opening-crossing-opening-removed` („Bodenübergang ohne Tür/Durchgang“); Status `conflict`,
   **keine** Gesamtlänge, nicht in bestätigten Mengen; die Teilsumme der gültigen Teile wird nur
   ausdrücklich als solche gezeigt.
5. Gelöst wird der Konflikt nur durch Neuplanung des Übergangs (neue Öffnung wählen,
   Durchführung oder anderer Weg) im Leitungsentwurf. Eine später an derselben Stelle neu angelegte
   Öffnung wird **nicht** automatisch wieder verknüpft.
6. Wand entfernen, an der ein Bodenübergang liegt: `409 wall-has-cables` (wie Wandwegpunkte);
   Raum entfernen: `409 room-has-cables`.

Keine neue fachliche Entscheidung nötig: Die Strategie folgt aus D4 (Bestätigung, danach
Konflikt) und D11 (Übergang nur an einer Öffnung, die beide Räume verbindet).

**Länge, Status, Trassen, Mengen:** Fußbodenstrecken zählen wie Deckenstrecken (lokal, unabhängig
von der Höhenlage). Status wie §6.3. Trassen werden auf dem Fußboden eines Raums abgeleitet
(gleiche Gerade, überlappende Intervalle). Mengen weisen Trassenmeter „Fußboden“ getrennt aus.

**Sichtbare Modellgrenzen** (Hinweis an der Leitung und in der Mengenübersicht): „Fußbodenwege
liegen modellhaft auf Höhe des Fertigfußbodens. Aufbau, Estrichdicke, Leerrohre und tatsächliche
Lage unter dem Belag sind nicht abgebildet; der Übergang in den Nachbarraum ist nur an einer Tür,
einem Durchgang oder einer Durchführung geplant – keine Aussage über Ausführbarkeit.“

**Bedienung im Grundriss – keine neue Editoroberfläche:** Der vorhandene Grundriss ist bereits die
Draufsicht auf die FFB-Ebene mit Weltkoordinaten, Raster, Fang und Raumbezug. Im Werkzeug
„Leitung“ wählt eine Ebenenwahl **Fußboden / Wand / Decke**. Auf „Fußboden“ setzt ein Klick in
einen Raum einen Fußbodenpunkt; Fang auf Raster, Wandachsen (Übergang zur Wand), Gerätefußpunkte,
Steigweghalte und Türmitten/-kanten (Bodenübergang). Klick außerhalb der Kontur oder über eine
geschlossene Wand: Statuszeile nennt den Grund, nichts wird gesetzt. Darstellung: Fußbodenwege
**gestrichelt grob** in der Leitungsfarbe, Deckenwege gestrichelt fein, Wandwege durchgezogen an
der Raumseite; Legende. Die Deckenansicht bleibt für präzise Deckenarbeit.

**Mehraufwand (knapp):** eine Wegpunktart, eine Übergangsart, die vorhandene exakte
Konturprüfung (wie Deckengeräte) und die Grundrissinteraktion – grob **+1 Teilschritt** in 6b.2
und 6b.5, keine neue Tabelle, keine neue Ansicht. Der Nutzen ist hoch, weil Fußbodenführung
häufig ist und sonst falsche Längen entstünden.

---

## 6. Längen und Mengen

### 6.1 Eine reine Funktion

`electrical/cable_length.py` (Quelle), `leitung/laenge.ts` (Spiegel), gemeinsame Fixture
`testdata/geometry/leitung.v1.json`. Ausgabe je Leitung:

```
segments[]     Art, Fläche (wall/ceiling/floor/penetration/opening/riser/shaft/connection),
               3D-Punkte (ganzzahlige mm, bei schräger Gegenlage exakt + gerundet), Länge, Status
geometric_mm   Summe der bekannten Teilstrecken
allowance_mm   start_allowance + end_allowance + reserve      (nur aus der Leitung)
status         confirmed | incomplete | conflict
length_mm      nur bei confirmed: geometric + allowance
known_mm       bekannte Teile + Zugaben, ausdrücklich Teilsumme
spec_complete  cable_type, conductor_count und cross_section_mm2 gesetzt
problems[]     Ort, Code, Text
```

Dieselben Punkte bedienen Grundriss, Wand-/Deckenansicht und 3D.

### 6.2 Rundung

Ganze Millimeter gespeichert; achsparallele Strecken exakt; gerade Decken-/Fußbodenstrecken,
`direct`-Steigwegversätze und schräge Gegenlagen je Strecke **einmal** kaufmännisch gerundet;
danach nur ganzzahlige Summen. Anzeige mm/cm/m nach persönlicher Einheit. Mengen in 6b in mm;
Meter als `Decimal`-String erst mit Phase 7.

### 6.3 Status

| Status | Bedingung |
|---|---|
| `confirmed` | Endgeräte platziert, alle Strecken gültig, genutzte Steigweganteile mit bestätigten, konsistenten Höhenlagen |
| `incomplete` | Verteilung ohne Platzierung, Weg nicht bis zum Ende geplant, Höhenlage im genutzten Steigweg unbestätigt |
| `conflict` | ungültige oder unterbrochene Strecke (z. B. nach bestätigter Wandänderung, D4), widersprüchliche Höhenlage, Durchführung oder Bodenübergang nicht mehr gültig |

`length_mm` nur bei `confirmed`; sonst „Teilsumme … – keine vollständige Leitungslänge“ mit den
fehlenden bzw. konflikthaften Stellen. Keine Luftlinie als Ersatz.

### 6.4 Längenbeispiel aus `electrical.md` §5 – präzisiert

Das alte Beispiel (Polygonzug im Grundriss, ohne Raumwechsel, „Rohdecke“, stille Zugaben) passt
nicht zum Modell. Präzisiert mit gleichen Zahlen:

```
Diele (0,0)–(4200,3000), Küche (4200,0)–(8000,3000), Raumhöhe je 2500
Diele.ost (4200,0)→(4200,3000) = wall_a, Küche.west (4200,3000)→(4200,0); shared, active
UV1: distribution_board an Diele.süd (0,0)→(4200,0), Mitte 500 / 1400
Steckdose: socket_single an Küche.west, Mitte 900 / 300   (≙ y = 2100)
Durchführung an Diele.ost: 2100 / 2200 → Gegenlage an Küche.west 900 (§5.2)
Wegpunkte: Diele.süd 500/2200 · Diele.süd 4200/2200 · Diele.ost 0/2200 · Durchführung
Zugaben eingetragen: Start 500, Ende 200
```

| Teilstrecke | Länge |
|---|---|
| Anschluss UV1 senkrecht 2 200 − 1 400 | 800 |
| Diele.süd 500 → 4 200 | 3 700 |
| Ecke | 0 |
| Diele.ost 0 → 2 100 | 2 100 |
| Durchführung | 0 |
| Anschluss Steckdose: waagerecht 900 − 900, senkrecht 2 200 − 300 | 1 900 |
| **geometrisch** | **8 500** |
| Zugaben (eingetragen) | 700 |
| **Leitungslänge** (`confirmed`) | **9 200 mm = 9,200 m** |

`electrical.md` §5 wird mit 6b.3 auf dieses Beispiel umgestellt.

### 6.5 Mengenübersicht (fachlich, ohne Material und Preise)

Je Gebäude (`GET /buildings/{id}/cabling-summary`), gruppiert nach den **tatsächlichen**
Kabelangaben der Leitungen (`cable_type`, `conductor_count`, `cross_section_mm2`):

* je Gruppe: **bestätigte** Menge (Summe `length_mm`), Anzahl Leitungen; getrennt **offen**
  (`incomplete`: Anzahl, Teilsumme) und **Konflikt** (Anzahl, Teilsumme der gültigen Teile – nie in
  die bestätigte Menge eingerechnet, D4);
* Zeile **„unvollständig spezifiziert“** je Leitung mit fehlender Angabe, mit vorhandenen Angaben
  und Länge – **nie** einem Standardtyp zugeschlagen;
* Trassenmeter je Fläche (Wand, Decke, Fußboden) und Steigweganteil, einmal gezählt;
* Durchführungen (genutzt/ungenutzt), Bodenübergänge;
* Geräte je Stromkreis und Typ, **nicht zugeordnete** Geräte, zugeordnete Geräte ohne Leitung;
* Zugaben getrennt ausgewiesen.

**Beispiel** – Stromkreis F3 „Küche Steckdosen“, Vorschlag NYM-J 3 × 1,5:

| Leitung | Angaben an der Leitung | Status | Länge |
|---|---|---|---|
| L1 UV1 → Abzweigdose | NYM-J 3 × 1,5 (aus Vorschlag) | confirmed | 9 200 |
| L2 Abzweigdose → Steckdose 1 | NYM-J 3 × 1,5 (aus Vorschlag) | confirmed | 2 400 |
| L3 Abzweigdose → Schalter | NYM-J 5 × 1,5 (abweichend) | confirmed | 3 100 |
| L4 Steckdose 1 → Steckdose 2 | NYM-J 3 × – (Querschnitt fehlt) | confirmed | 1 800 |
| L5 Abzweigdose → Steckdose 3 | NYM-J 3 × 1,5 (aus Vorschlag) | incomplete (Weg nicht fertig) | Teilsumme 1 200 |

Mengenübersicht:

| Gruppe | bestätigt | offen | Konflikt |
|---|---|---|---|
| NYM-J 3 × 1,5 | **11 600 mm** (2 Leitungen) | 1 Leitung, Teilsumme 1 200 | – |
| NYM-J 5 × 1,5 | **3 100 mm** (1 Leitung) | – | – |
| **unvollständig spezifiziert** | L4: NYM-J, 3 Leiter, Querschnitt fehlt – 1 800 mm | – | – |

Wird der Vorschlag von F3 danach auf NYM-J 3 × 2,5 geändert, bleiben L1–L5 unverändert; L1, L2,
L5 erscheinen als „weicht vom aktuellen Vorschlag ab“, bis jemand ausdrücklich überträgt.

---

## 7. Änderungs- und Lebenszyklusregeln

Grundsatz: **nichts wird still verschoben, umgehängt oder gelöscht.** Jeder Schreibweg mit
Wirkung auf Leitungswege berechnet unter der Projektsperre die **Leitungsbefunde** des betroffenen
Geschosses vorher und nachher (Muster `device_rules.py`).

| Vorgang | Wirkung |
|---|---|
| Wand verschieben/verlängern/kürzen | Wegpunkte gehen relativ mit. Neuer Befund (Punkt außerhalb, Ecke nicht mehr gemeinsam, Strecke durch Öffnung, Fußboden-/Deckenstrecke außerhalb der neuen Kontur) → `409 cables-would-break` mit Liste; erst mit `acknowledged_cable_ids` gespeichert (**D4**). Rückfrage nennt je Leitung Stromkreis, Bezeichnung und Endgeräte („F3 · L2: Abzweigdose Küche → Steckdose 1“). Danach `conflict`, keine Länge, nicht in bestätigten Mengen |
| Durchführung würde den aktiven `shared`-Abschnitt verlassen (Wandänderung, Kopplung lösen, `shared → separate`, dritter Raum) | **`422 penetration-outside-shared-section`**, keine Bestätigung möglich |
| Öffnung mit Bodenübergang verkleinern/verschieben/entfernen, sodass der Übergang außerhalb liegt, oder Abschnitt wird `separate` | `409 cables-would-break` (Bestätigung wie Wandänderung) |
| Wand teilen | abgelehnt, wenn ein Wegpunkt, eine Durchführung oder ein Bodenübergang in das neue Stück fiele |
| Kontur umkehren | Abstände im Entwurf umgerechnet (`L − x`), wie Öffnungen |
| Wand entfernen | mit Wegpunkten `409 wall-has-cables`; Kopplung mit Durchführung `409 wall-link-has-penetrations` |
| Öffnung so setzen, dass eine Wandstrecke oder Durchführung darin liegt | `422` |
| Gerät verschieben (gleiche Wand) | Anschlussstrecke neu abgeleitet, Länge ändert sich sichtbar |
| Gerät entfernen | Endpunkt `409 device-has-cables`; Verteilungsplatzierung `409 device-is-distribution-board`; Zuordnung entfällt mit dem Gerät, Rückfrage nennt den Stromkreis |
| Raumhöhe / Geschoss-Standardhöhe senken | Wandwegpunkte oder Durchführungen darüber `422` (interne Erweiterung `FloorCeilingHeightParticipant`); Deckenwege folgen sichtbar |
| Raum löschen | mit Wegen, Durchführungen, Bodenübergängen oder Endgeräten von Leitungen `409 room-has-cables` |
| Höhenlage, Bestätigung, Geschossebene | nur Status/Länge der Steigweganteile |
| Halt verschieben / entfernen | Verschieben: Längen ändern sich sichtbar; liegt ein Fußbodeneinstieg danach nicht mehr auf dem Halt → `409 cables-would-break` mit Bestätigung; genutzten Halt oder Steigweg entfernen `409 riser-stop-in-use` / `riser-in-use` |
| Stromkreisvorschlag ändern | keine Wirkung auf Leitungen (§3.2) |
| Stromkreis löschen | Leitungen und Zuordnungen `CASCADE`, nur nach Rückfrage mit Anzahl |
| Verteilung löschen | mit Stromkreisen `409 board-has-circuits` |
| Geschoss/Gebäude löschen | vorhandenes `409` |
| Projekt löschen | Reihenfolge: Leitungen → Durchführungen → Zuordnungen/Stromkreise → Verteilungen → Steigwege → Räume |

---

## 8. Architektur und Kommunikation

### 8.1 Grenzen

* Alles Fachliche in `app/modules/electrical/` (`distribution.py`, `circuits.py`, `cables.py`,
  `cable_length.py`, `cable_rules.py`, `penetrations.py`).
* Core unverändert; Zugang über `FloorPlanningAccess` (`building_context`,
  `writable_building_context`, `context`, `writable_context`, `building_ids_of_project`).
* Pydantic/OpenAPI ist Quelle, TS-Client generiert, keine neue Contract-Paketstruktur.

### 8.2 HTTP-Schnittstellen (unter `/api/v1/modules/electrical`)

```
GET    /buildings/{building_id}/distribution-boards
POST   /buildings/{building_id}/distribution-boards          {code, name, note?, placement_device_id?}
PATCH  /distribution-boards/{id}                              If-Match
DELETE /distribution-boards/{id}                              If-Match

GET    /buildings/{building_id}/circuits                      inkl. Zuordnungen, Leitungsstatus
POST   /distribution-boards/{id}/circuits                     {designation, name, proposed_*, …}
PATCH  /circuits/{id}                                         If-Match – ändert keine Leitung
DELETE /circuits/{id}                                         If-Match
PUT    /circuits/{id}/devices                                 {device_ids[]}, If-Match
POST   /cables/{id}/apply-proposal                            If-Match (Leitung), {expected_circuit_version} – ausdrückliche Übertragung (präzisiert 6b.3)

GET    /floors/{floor_id}/penetrations                        inkl. transformierter Gegenlage, Nutzung
PATCH  /penetrations/{id}                                     If-Match
DELETE /penetrations/{id}                                     If-Match, 409 wenn genutzt

GET    /buildings/{building_id}/cables                        Verlauf, Längen, Befunde, Spezifikationsstatus
POST   /circuits/{id}/cables                                  {start/end_device_id, cable_type?, conductor_count?,
                                                               cross_section_mm2?, waypoints[], allowances, new_penetrations[]}
PUT    /cables/{id}                                           ganze Leitung inkl. Wegpunkte, If-Match
DELETE /cables/{id}                                           If-Match

GET    /buildings/{building_id}/cabling-summary
PUT    /rooms/{room_id}/contour                               zusätzlich acknowledged_cable_ids
```

`apply-proposal` prüft je Leitung die Version (`409` bei Abweichung, nichts geändert) und schreibt
genau die übergebenen Leitungen. Neue Durchführungen entstehen atomar mit der ersten Leitung, die
sie nutzt (`new_penetrations[]` mit Client-Schlüssel).

### 8.3 Synchrone Teilnehmer (vorhandene Contracts)

| Contract | Erweiterung (intern) |
|---|---|
| `ProjectContentParticipant` | meldet `electrical.distribution_boards`, `.circuits`, `.cables`, `.penetrations`; löscht in der Reihenfolge aus §7 |
| `FloorCeilingHeightParticipant` | prüft zusätzlich Wandwegpunkte und Durchführungen |
| `ReferenceDataSeeder` | Katalogtypen `distribution_board`, `junction_box` |

Alle Konsistenzprüfungen synchron in derselben Transaktion; keine hängt von einem Event ab.

### 8.4 Events

Keine neuen Events (`events.md` §6: nur mit realem Konsumenten). Raumänderungen erzeugen weiter
`electrical.plan.updated`. `electrical.circuit.changed` bleibt „geplant für Phase 7“.

### 8.5 Transaktionen, Sperren, Versionen

Jeder Schreibvorgang eine Transaktion, **Projekt zuerst**:

| Vorgang | Reihenfolge |
|---|---|
| Verteilung/Stromkreis | Projekt (`writable_building_context`) → Zeile `FOR UPDATE` + `If-Match` → prüfen → schreiben |
| Zuordnung ersetzen | Projekt → Stromkreis `If-Match` → Geräte frisch (gleiches Gebäude, Kategorie zulässig, nicht anderweitig zugeordnet → `409 device-assigned-elsewhere`) |
| Vorschlag übertragen | Projekt → Stromkreis → betroffene Leitungen nach ID geordnet `FOR UPDATE` + Versionen |
| Leitung anlegen/ersetzen | Projekt → Leitung `If-Match` → Wände, Räume, Öffnungen, Geräte, Kopplungen, Durchführungen, Steigwege frisch → Weg prüfen → neue Durchführungen → schreiben |
| Durchführung ändern/entfernen | Projekt → Durchführung `If-Match` → Leitungsbefunde vorher/nachher |
| Konturspeichern, Kopplung, Höhe, Halt | wie heute + Leitungsbefunde und Durchführungsregel |

Eigene Versionen für Verteilung, Stromkreis (inkl. Zuordnung), Leitung (inkl. Wegpunkte und
Kabelangaben), Durchführung. Leitungsänderungen zählen keine Raumversion weiter.

### 8.6 Rechte

`electrical.circuit.write` (Verteilungen, Stromkreise, Zuordnung, Vorschlag übertragen) und
`electrical.route.write` (Leitungen, Wegpunkte, Kabelangaben, Durchführungen); Lesen
`electrical.plan.read`. Konturspeichern mit `acknowledged_cable_ids` verlangt zusätzlich
`route.write`. Nach der Migration den Seed ausführen.

---

## 9. Bedienung

### 9.1 Arbeitsablauf

1. **Verteilung wählen/anlegen** (Seitenleiste „Stromkreise“); Lage über ein Gerät „Verteilung“.
2. **Stromkreis anlegen** – Vorschlagsfelder ausdrücklich „Vorschlag für neue Leitungen – wird
   nicht geprüft“.
3. **Geräte zuordnen** – Modus „Zuordnen“ in Grundriss, Wand- und Deckenansicht; Entwurf.
4. **Leitung planen** – Start- und Endgerät, Kabelangaben (vorgefüllt aus dem Vorschlag, als
   solche markiert, änderbar), Wegpunkte:
   * **Wandansicht** präzise: Fang auf Zonenhilfslinien (Planungshilfe, keine
     Konformitätsprüfung), Gerätemitten, Öffnungs-/Wandkanten, Ecken, Trassen, Durchführungen,
     Unterkante (Übergang Fußboden) und Oberkante (Decke); Abstandsangaben wie bei Öffnungen.
   * **Deckenansicht** für Deckenwege.
   * **Grundriss** mit Ebenenwahl Fußboden/Wand/Decke: Fußbodenwege direkt, Wandpunkte grob in
     Zonenhöhe, Bodenübergang an Türen, „Durchführung hier“ an gemeinsamen Bauwänden,
     „Steigweg nutzen bis …“ mit Wechsel ins Zielgeschoss.
5. **Länge und Konflikte prüfen** – Liste mit Status, Länge/Teilsumme, Spezifikationsstatus,
   Befunden; Klick springt an den Ort.

Exakte Maße zusätzlich in den Eigenschaften, nie als einziger Weg.

### 9.2 Darstellung

* Grundriss: Wandwege durchgezogen an der Raumseite, Decke fein gestrichelt, **Fußboden grob
  gestrichelt**, Belegungszahl an Trassen, Durchführungs- und Bodenübergangssymbole,
  Steigwegübergang mit Pfeil; ausgewählter Stromkreis hervorgehoben.
* Wand-/Deckenansicht: Wegpunkte, Strecken, Anschlussstrecken, Hilfslinien, Maßketten; Innenseite
  deutlich.
* 3D: abgeleitete Polylinien (Fußboden knapp über FFB gezeichnet), Auswahl → „In der Wandansicht
  bearbeiten“, Rückkehr mit Kamera (`Rueckkehr3d`). Keine 3D-Bearbeitung.
* Verlässlichkeit: bestätigt durchgezogen, unvollständig gestrichelt (Warnfarbe), Konflikt
  strichpunktiert (Fehlerfarbe), immer mit Text. Token `--ep-plan-cable` hell/dunkel.

### 9.3 Entwurf, Speichern, Undo

| Änderung | Speicherung |
|---|---|
| Verteilung, Stromkreis | Dialog, sofort |
| Vorschlag übertragen | ausdrückliche Aktion mit Rückfrage, sofort |
| Gerätezuordnung | eigener Entwurf |
| Leitung (Kabelangaben, Wegpunkte, neue Durchführungen, Zugaben) | eigener Entwurf je Leitung |
| Durchführung verschieben/entfernen | eigene Aktion mit Rückfrage, nur ohne offenen Leitungsentwurf |
| Raum, Wände, Öffnungen, Geräte | Raumentwurf wie bisher |

Höchstens **ein** offener Entwurf (Raum, Zuordnung oder Leitung); Undo/Redo je Entwurf, eine
Ziehbewegung ein Schritt; Navigationsschutz; Geschosswechsel innerhalb eines Leitungsentwurfs
(Steigweg) erlaubt; Rückkehr aus 3D mit Kamera, aus der Liste an den Befund und zurück.

---

## 10. Sicherheit

* Mandantentrennung: alle Abfragen nach `organization_id`; fremde IDs in Pfad und Körper `404`/`422`
  ohne Existenzauskunft; zusammengesetzte FKs; Sweep um alle neuen Routen.
* Gleiches Gebäude für alle Bezüge einer Leitung (`422`).
* Rechte je Schreibweg; `completed`/`archived` über die Projektsperre schreibgeschützt; `If-Match`
  überall.
* Frontend: sitzungsgebundener Query-Client, `signal` weitergereicht, keine Autospeicherung;
  Anfragegrenzen unverändert.
* Größengrenzen: ≤ 500 Wegpunkte je Leitung, ≤ 200 Leitungen je Stromkreis, ≤ 200 Leitungen je
  `apply-proposal`.

---

## 11. Abnahmekriterien und Tests

**Modell, Zuordnung, Kabelangaben**
1. Mehrere Verteilungen je Gebäude; Code eindeutig je Gebäude; Lage nur über `distribution_board`.
2. Gerät höchstens in einem Stromkreis (`409`, nichts geändert); Datendosen nicht zuordenbar.
3. Leitung speichert ihre Kabelangaben; Stromkreisvorschlag ändern ändert keine Leitung;
   „abweichend“ wird angezeigt; `apply-proposal` nur für genannte Leitungen mit Versionsprüfung.
4. Mengen gruppieren nach tatsächlichen Angaben; unvollständig spezifizierte Leitungen eigens;
   Beispiel §6.5 exakt.

**Weg und Länge** (Fixture, Backend/Frontend-Parität)
5. Beispiel §6.4: 8 500 / 9 200 mm, `confirmed`.
6. Ungültig: schräg auf der Wand, Wandwechsel ohne Ecke, Decke/Fußboden außerhalb der Kontur
   (L-Raum), Strecke durch Öffnung, Raumwechsel ohne Durchführung/Bodenübergang → `422`.
7. Trasse §5.4: 4 000 Trasse, 10 000 Leitung, Belegung 2/3/2; Fußboden und Decke getrennte Trassen.
8. Verzweigung über Abzweigdose.
9. Steigweg 1 450 mm; Fußbodeneinstieg am Halt mit h = 0; unbestätigt → `incomplete`;
   widersprüchlich → `conflict`; Leitung im Geschoss bleibt bei unbestätigter Höhenlage bestätigt.

**Fußboden**
10. Fußbodenstrecke gerade in der Kontur, einmal gerundet; Übergang Wand ↔ Fußboden an der
    Unterkante; Bodenübergang an Tür/Durchgang (eigene + abgeleitete Öffnung) gültig; an Fenster,
    an `separate`-Abschnitt, unter geschlossener Wand ungültig; Mengen „Fußboden“ getrennt.

**Durchführungen**
11. Nur aktives `shared`; sonst `422`; eine Zeile, mehrfach genutzt, einmal gezählt.
12. Gegenlage: entgegengesetzte Richtung, versetzter Anfang, verschiedene Längen, Teilüberlappung,
    Lage außerhalb des Abschnitts (`422`), schräge Wand mit irrationaler Gegenlage; Hin- und
    Rücktransformation ohne Positionsänderung – Backend und Frontend gegen dieselbe Fixture.
13. Wand-/Kopplungsänderung, die die Durchführung herausschiebt → `422`; Kopplung lösen → `409`.

**Abhängigkeiten**
14. Wand verschieben mit Leitung → `409 cables-would-break` mit verständlicher Liste; mit
    Bestätigung gespeichert, Leitung `conflict`, keine Länge, nicht in bestätigten Mengen.
15. Gerät als Endpunkt entfernen `409`; Raum mit Leitung `409`; Höhe unter Wegpunkt `422`; genutzten
    Halt entfernen `409`; Öffnung mit Bodenübergang verkleinern → Bestätigung; Projektlöschung
    entfernt alles.

**Sicherheit und Parallelität (PostgreSQL)**
16. Mandantentrennung inkl. Sweep, fremde IDs im Körper, DB-FK-Probe.
17. Rechte getrennt (`circuit.write`, `route.write`, Lesen).
18. `completed`/`archived`: alle neuen Schreibwege `409`.
19. Parallel: zwei Leitungsersetzungen gleicher Version; Leitung gegen Wand verschieben;
    Zuordnung gegen Gerät entfernen; Durchführung gegen Kopplung lösen; `apply-proposal` gegen
    Leitungsänderung – nie inkonsistent.

**Bedienung**
20. Leitung in Wand-, Decken- und Grundrissansicht (Ebenenwahl, Fang); Bodenübergang;
    Durchführung; Steigweg mit Geschosswechsel; Kabelangaben vorgefüllt und markiert;
    Speichern/Verwerfen/Undo; höchstens ein Entwurf; Navigationsschutz; Rückkehr aus 3D;
    Einheiten, Themes, schmale Breite.
21. Sichtprüfung im sichtbaren Browser durch den Auftraggeber nach Phase 6.

**Architektur**
22. import-linter grün, Core unverändert, ein Alembic-Head, OpenAPI-Drift grün, keine
    gespeicherten Längen, keine neuen Events.

---

## 12. Umsetzungsschritte (nach Freigabe)

| Schritt | Inhalt | Grenze |
|---|---|---|
| **6b.0** | Migration `0012`: Verteilungen, Stromkreise (mit Vorschlagsfeldern), Zuordnung; Kategorie-CHECK `distribution`/`junction`; Katalogtypen per Seed; Rechte; Löschteilnehmer; API Verteilung/Stromkreis/Zuordnung | keine Leitungen |
| **6b.1** | Oberfläche Verteilungen, Stromkreise, Zuordnung (Seitenleiste, Zuordnungsentwurf, nicht zugeordnete Geräte) | keine Wege |
| **6b.2** | Reine Längenfunktion + Fixture: Wand, Ecke, Decke, **Fußboden**, Anschlussstrecken, **Durchführungs-Gegenlage** über die Abschnittstransformation, Bodenübergang, Steigweg, Trassenableitung – Backend und Frontend | keine API |
| **6b.3** | Migration `0013`: Leitungen (mit Kabelangaben), Wegpunkte (inkl. `floor`, `opening_crossing`), Durchführungen; Service/API inkl. `apply-proposal`; Leitungsbefunde in Konturspeichern/Kopplung/Höhe/Halt; `acknowledged_cable_ids`; `electrical.md` §5 umgestellt | Oberfläche nur Liste |
| **6b.4** | Leitungsentwurf in Wand- und Deckenansicht (Fang, Zonenhilfslinien, Maße, Undo, Kabelangaben) | kein Grundriss-Zeichnen |
| **6b.5** | Grundriss mit Ebenenwahl: **Fußbodenwege**, Bodenübergang, Durchführung setzen, Steigweg nutzen mit Geschosswechsel; 3D-Darstellung und Rückkehr | |
| **6b.6** | Mengenübersicht nach tatsächlichen Kabelangaben, Dokumentation, Gesamtprüfung der Phase 6 durch den Auftraggeber | Exit Phase 6 |

---

## 13. Entscheidungen

| # | Frage | Stand |
|---|---|---|
| D1 | Lage der Verteilung über ein Gerät `distribution_board`, ohne zweite Geometrie | **bestätigt** (2026-10-11) |
| D2 | Verteilungen/Stromkreise gebäudebezogen, **mehrere Verteilungen je Gebäude**; gebäudeübergreifende sowie Außen-/Erdleitungen später | **bestätigt** |
| D3 | Leitung mit eigener Wegpunktliste, Trasse abgeleitet (kein gespeicherter Graph) | mit dem Gesamtentwurf freigegeben |
| D4 | Wandänderung, die Leitungen bricht: nur nach Bestätigung mit verständlicher Liste; danach Konflikt ohne Gesamtlänge und ohne bestätigte Menge; Durchführungen hart geschützt | **bestätigt** |
| D5 | Zugaben/Reserve nur ausdrücklich je Leitung, keine Projektstandardwerte | **bestätigt** |
| D6 | ~~Leitungstyp am Stromkreis~~ → **tatsächliche Kabelangaben je Leitung**, Stromkreis nur Vorschlag; keine stille Nachführung | **geändert auf Vorgabe des Auftraggebers** |
| D7 | ~~nur Wand und Decke~~ → Wand, Decke und **vereinfachter Fußboden** in 6b; Außenwege später | **geändert auf Vorgabe des Auftraggebers** |
| D8 | keine neuen Events in 6b | mit dem Gesamtentwurf freigegeben |
| D9 | Durchführung durch `separate` | zurückgestellt (6a D9) |
| D10 | Messung auf der Wandachse, dokumentiert | mit dem Gesamtentwurf freigegeben |
| D11 | Raumwechsel im Fußboden nur über ausdrücklich geplante Durchführung (aktives `shared`) oder ausdrücklich gesetzten Bodenübergang an Tür/Durchgang, der beide Räume verbindet; kein Unterqueren geschlossener Wände; nie automatisch aus einer Tür | **bestätigt** (2026-10-11), Bedingungen §5.6 |

---

## 15. Umsetzungsstand 6b.0 (2026-10-11)

Umgesetzt und automatisiert geprüft, mit dem Checkpoint vom 2026-10-12 committet: Migration `0012_boards_and_circuits`
(Revision-ID ≤ 32 Zeichen), Modelle, Katalogtypen `distribution_board`/`junction_box` per Seed,
Recht `electrical.circuit.write`, Service `distribution.py`, API (§8.2, ohne `apply-proposal` –
das gehört zu den Leitungen in 6b.3), Löschteilnehmer, Schutz von Lagegerät und Zuordnung im
Raumentwurf und bei der Raumlöschung, Tests.

| Präzisierung | Umsetzung |
|---|---|
| Stromkreis → Verteilung | Fremdschlüssel `RESTRICT` (statt `CASCADE` in der 1. Skizze von §3.1): Verteilung mit Stromkreisen `409 board-has-circuits` |
| Zuordenbare Kategorien | `socket`, `switch`, `light` und – korrigiert in 6b.1 – `junction` (Abzweigdose als Verzweigungspunkt eines Stromkreises); nicht `data` und nicht `distribution` (das Lagegerät ist der Bezugspunkt der Verteilung selbst) |
| Gebäudebezug | Lagegerät und zugeordnete Geräte müssen in einem Geschoss des Gebäudes der Verteilung liegen; fremder Mandant, anderes Gebäude, unbekannte ID: dieselbe `422`-Antwort |
| Raumentwurf | Lagegerät nicht entfernbar/umtypbar; zugeordnetes Gerät nicht in nicht zuordenbare Art; Entfernen eines zugeordneten Geräts nimmt die Zuordnung mit (Rückfrage folgt mit 6b.1) |
| Unveränderte Änderung | gleiche Werte bzw. gleiche Geräteliste: keine Versionserhöhung, kein Projektvermerk |
| Oberfläche | nur Typverträglichkeit: Kategorienamen und Symbole für „Verteilung“ und „Abzweigdose“, damit sie als Geräte gesetzt werden können; **keine** Verwaltung von Verteilungen/Stromkreisen (6b.1) |

Tests: `tests/test_electrical_circuits.py`, `tests/test_circuit_concurrency.py`,
`tests/test_tenant_isolation.py` (Sweep + Fremdbezüge + DB-Fremdschlüssel),
`tests/test_archive_concurrency.py`/`test_completed_concurrency.py` (Schreibweg
`stromkreis-anlegen`), `tests/test_migration_acceptance.py` (ORM = Migration), Inventartests.

## 16. Umsetzungsstand 6b.1 (2026-10-11, Nacharbeit 2026-10-12)

Umgesetzt und automatisiert geprüft, mit dem Checkpoint vom 2026-10-12 committet:

| Thema | Umsetzung |
|---|---|
| Korrektur 6b.0 | Abzweigdosen sind zuordenbar (`ASSIGNABLE_CATEGORIES` + `junction`) mit denselben Regeln: gleicher Betrieb und gleiches Gebäude, ein Stromkreis je Gerät, kein stilles Umhängen, `If-Match`, Projektsperre, keine Umtypisierung in eine nicht zuordenbare Art |
| Ansicht | „Stromkreise“ im Tab „Räume & Grundriss“ für das Gebäude des gewählten Geschosses (Kopf nennt das Gebäude) |
| Verteilungen | anzeigen, anlegen, bearbeiten, entfernen per Dialog (sofort gespeichert); Code, Bezeichnung, Notiz; Lage optional über ein freies Gerät „Verteilung“ desselben Gebäudes (belegte werden nicht angeboten); Zustand „Noch nicht im Plan platziert“; Entfernen mit Stromkreisen wird verständlich verweigert |
| Stromkreise | je Verteilung anzeigen, anlegen, bearbeiten, entfernen (Rückfrage nennt den Verlust der Zuordnungen); Kabelangaben als „Vorschlag für neue Leitungen“ mit Hinweis ohne Dimensionierung/Normaussage; Querschnitt mit Komma oder Punkt |
| Gerätezuordnung | eigener Entwurf je Stromkreis: Liste (zuordenbare gespeicherte Geräte, gruppiert nach Geschoss/Raum) und grafische Auswahl im Grundriss des gewählten Geschosses; Geräte anderer Stromkreise gesperrt mit dessen Bezeichnung; „Zuordnung speichern“, „Verwerfen“, „Schließen“; Änderungszustand sichtbar; Versionskonflikt mit „Zuordnung verwerfen und neu laden“ |
| Entwurfsschutz | Navigationsschutz, Ansichts- und Gebäudewechsel fragen nach; Geschosswechsel im selben Gebäude behält den Entwurf; die Zuordnung ist ein eigener Entwurf und nie Teil des Raumentwurfs |
| Löschrückfrage | Die **bestehende** Speicher-Rückfrage des Raumentwurfs (Grundriss, Wand- und Deckenansicht) nennt bei entfernten zugeordneten Geräten Gerät, Stromkreis und den Verlust der Zuordnung – zusammen mit Wandzuordnungen in **einer** Rückfrage; ebenso die Raumlöschung in „Tabellen & Details“ |
| Rechte, Status | Schreibaktionen nur mit `electrical.circuit.write` und nicht bei `completed`/`archived`; der Server prüft unabhängig |
| Sitzung | alle Abfragen im sitzungsgebundenen Query-Client, `signal` weitergereicht |
| Katalog | Symbole „Verteilung“ und „Abzweigdose“ in Textfarbe (Theme-fähig) |
| Projektkopf (Nacharbeit) | Nach erfolgreichen Schreibvorgängen an Verteilungen, Stromkreisen, Zuordnungen und Steigwegen lädt die Seite gezielt `["project", projectId]` im sitzungsgebundenen Query-Client nach – nicht nach Fehlschlägen; eine verspätete Antwort nach Sitzungsende landet nicht im Cache |

**Bewusste Grenze:** Die grafische Zuordnung liegt in der Stromkreisansicht (Grundriss des
Geschosses); ein Zuordnungsmodus in Wand- und Deckenansicht folgt mit den Leitungen (6b.4), wo
diese Ansichten ohnehin die Arbeitsfläche werden.

## 17. Umsetzungsstand 6b.2 (2026-10-12)

Umgesetzt und automatisiert geprüft, **nicht committet**: die reine, deterministische
Berechnungsgrundlage für Leitungsweg, Länge, Status und Trassen – ohne Migration, ohne
Leitungstabellen, ohne API und ohne Oberfläche.

| Teil | Backend (Referenz) | Frontend (Spiegel) |
|---|---|---|
| Weg, Teilstrecken, Länge, Status | `electrical/cable_length.py` | `leitung/laenge.ts` |
| Trassen, Belegung, Summen je Fläche | `electrical/cable_traces.py` | `leitung/trassen.ts` |
| Gegenlage einer Lage (Punkt) | `topology.transfer` (neben `_local`/`_back`) | `lageUebertragen` (neben `lokalerBereich`/`wandbereich`) |
| Gemeinsame Fixture | `testdata/geometry/leitung.v1.json` (Version 1) | dieselbe Datei |

**Wiederverwendet, nicht kopiert:** Wandteilung und Abschnittszustände (`topology.partition`,
`wandtopologie`), Kopplungsstatus (`link_status`, `kopplungsstatus`), Fremdöffnungen
(`foreign_openings`, `fremdeBereiche`), Konturprüfung und Rundung (`contour_report`,
`rounded_sqrt`, `konturbericht`, `gerundeteWurzel`), Punkt im Polygon (`devices.point_in_polygon`,
`punktImPolygon`), Steigwegverlauf und -status (`analyse_riser`, `steigwegAuswerten`).

### 17.1 Eingabe und Ausgabe

Eingabe: Planungsstand eines Gebäudes (Geschosse mit Höhenlage, Räume mit Wänden in
Konturreihenfolge und Öffnungen samt Art, Kopplungen, Geräte, Durchführungen, Steigwege) und je
Leitung Start-/Endgerät (oder keines), Wegpunkte, Zugaben und Kabelangaben. Wegpunktarten wie
§3.3: Wand (`wall_id`, Abstand, Höhe), Decke/Fußboden (Raum, x, y), Durchführung, Bodenübergang
(Quellwand, Abstand, Öffnung oder `null`), Steigweg (Ein- und Ausstiegshalt mit **lokaler** Höhe in
Leitungsrichtung).

Ausgabe je Leitung wie §6.1: Teilstrecken (Art, Ort, Besitzer, Läufe, Länge, bekannter Teil),
`geometric_mm`, `allowance_mm`, Status, `length_mm` nur bei `confirmed`, `known_mm` als
ausdrückliche Teilsumme, `spec_complete`, Befunde (Code, Art `conflict`/`missing`, Ort
`start`/`end`/`route`/`w3`/`w2-w3`), genutzte Durchführungen und Zahl der Bodenübergänge.

### 17.2 Präzisierungen gegenüber §5/§6 (ohne neue fachliche Entscheidung; vom Auftraggeber bestätigt 2026-10-12)

| Thema | Festlegung in 6b.2 | Begründung |
|---|---|---|
| Lage der Teilstrecken | Läufe tragen **flächenlokale, exakte** Koordinaten: **Wand** – Raumwand (`wall_id`), Lage ab Wandanfang der gerichteten Wand auf der Achse (`whole + steps·√m`), Höhe über FFB, Richtung = Leitungsrichtung (`from` → `to`); **Decke/Fußboden** – Raum, Geschoss-x/y; **Steigweg** – die eine `riser_course`-Polylinie mit absoluten Höhen, in Leitungsrichtung; **Schacht** – Halt, lokale Höhe von → bis. Räumliche Punkte leitet `segment_points`/`run_points` daraus ab (je Koordinate einmal kaufmännisch gerundet, Wandenden exakt, `z` = gespeicherte Höhenlage + lokale Höhe); Längen kommen nie aus diesen Punkten | eine Quelle; Darstellung ohne zweite Geometrie |
| Weg erreicht ein Endgerät nicht | Erster bzw. letzter Wegpunkt nicht auf der Montagefläche des Geräts (andere Wand, anderer Raum): **fehlt** (`incomplete`), keine Luftlinie. Liegt er dort, die abgeleitete Anschlussstrecke ist aber unzulässig (durch eine Öffnung, außerhalb der Kontur): **Konflikt** | „Weg nicht bis zum Ende geplant“ (§6.3) |
| Leitung ohne Wegpunkte | `route-empty`, `incomplete`, Länge 0 nur als Teilsumme | ein Weg braucht mindestens einen Wegpunkt |
| Außen montiertes Endgerät | `endpoint-exterior`, `conflict` | Wandwege nur innen, Außenleitungen später (D2) |
| Unterkante bodentiefer Öffnungen | Eine Wandstrecke auf Höhe 0 durch eine Tür (Brüstung 0) gilt als Strecke durch die Öffnung | dort ist keine Wand; sonst liefe ein Weg „über die Schwelle“ |
| Kanten von Öffnungen | Berührung der übrigen Kanten (z. B. Strecke genau über dem Sturz) ist zulässig | wie bei Geräten (Phase 5) |
| Durchführungshöhe | `0 ≤ h < min(Raumhöhen)`; h = 0 erlaubt den Übergang Wand ↔ Fußboden auf beiden Seiten | §5.2/§5.5 |
| Seite einer Durchführung | Eintrittsseite nach dem Nachbarn davor (Wandpunkt bzw. Startgerät), sonst danach; passt keiner: `penetration-sequence` | Richtung ergibt sich aus dem Weg, gespeichert bleibt nur `wall_a` |
| Bodenübergang auf schrägen Wänden | Nur wenn der Achspunkt auf ganzen Millimetern liegt (achsparallel immer), sonst `opening-crossing-off-grid` | Fußbodenpunkte sind ganzzahlig (ADR 0007) |
| Steigwegnutzung | Einstieg am Halt auf lokaler Höhe h (`0 ≤ h < Δz` des ersten genutzten Abschnitts, prüfbar nur bei bestätigter Höhenlage); genutzt ab h, Zwischenhalte durchfahren; Ausstieg am Halt auf FFB; eine Ausstiegshöhe > 0 ist die **Schachtfortsetzung** (eigene Teilstrecke `shaft`, lokal, immer bekannt). Rückwärts (abwärts) gleich lang. Der Wegpunkt davor/danach muss **genau** am Halt liegen (Wandachse, Fußboden h = 0, Decke h = Raumhöhe), sonst `riser-transfer` | §5.3 |
| Steigweghalte | Reihenfolge nach Ebene, bei gleicher Ebene nach Halt-ID – Backend und Frontend gleich, nie nach Eingabereihenfolge. Gespeicherte Halte haben je Steigweg verschiedene Ebenen (`UNIQUE(riser_id, floor_id)`, `UNIQUE(building_id, level)`); die Regel schützt ungespeicherte Entwürfe und widersprüchliche Geschossdaten, die dadurch nicht scheinbar gültig werden | Parität, Determinismus |
| Trasse | zusammenhängende Vereinigung je Planungsfläche (Wand: je Raumwand waagerecht je Höhe bzw. senkrecht je Lage; Decke/Fußboden: je Raum und Gerade; Steigweg: je Abschnitt; Schacht: je Halt); auch an einem Punkt anschließende Stücke gehören zu derselben Trasse; die zwei Seiten einer gemeinsamen Wand sind zwei Flächen | §5.4 |

### 17.3 Status- und Befundregeln

* `conflict`: mindestens ein Befund der Art `conflict` – ungültige Strecke (schräg, ohne Ecke,
  Raumwechsel ohne Übergang, durch eine Öffnung, außerhalb der Kontur, falscher Übergang Wand ↔
  Decke/Fußboden), ungültige Durchführung (unbekannt, Kopplung nicht `active`, nicht im
  `shared`-Abschnitt dieser Kopplung, Höhe, in einer Öffnung), ungültiger Bodenübergang (Öffnung
  entfernt, Fenster, außerhalb, verbindet nicht – auch bei `separate` –, Reihenfolge), widersprüchliche
  Höhenlage, Einstieg zu hoch, Wegpunkt nicht am Halt, unbekanntes oder außen montiertes Endgerät.
* `incomplete`: sonst mindestens ein Befund der Art `missing` – Endgerät nicht platziert, kein
  Weg, Weg erreicht ein Endgerät nicht, Höhenlage im genutzten Steigweg unbestätigt.
* `confirmed`: keine Befunde. Nur dann `length_mm = geometric_mm + allowance_mm`.
* Eine ungültige Strecke trägt **nichts** bei – sie ist nie eine gültige Null; ein ungültiger
  Wegpunkt unterbricht die Kette, die angrenzenden Schritte werden nicht bewertet (kein
  Folgebefund). `known_mm` ist dann ausdrücklich eine Teilsumme der gültigen Teile.
* Leitungen innerhalb eines Geschosses hängen **nie** von der Höhenlage ab; nur genutzte
  Steigweganteile folgen dem Steigwegstatus (senkrechte Länge nur bei bestätigter, konsistenter
  Höhenlage; waagerechter Versatz immer bekannt).
* Kopplung `undecided` (gelöst): Bodenübergang bleibt gültig (Öffnung gilt beidseitig);
  Durchführung braucht eine aktive `shared`-Kopplung.

### 17.4 Rundung

Ganze Millimeter. Achsparallele Wand- und Steigwegstrecken exakt. Gerade Decken-/Fußbodenstrecken
und Anschlussstrecken an der Decke `rounded_sqrt` je Strecke; Wandstrecken zu einer irrationalen
Gegenlage (`whole + steps·√m`) **einmal** kaufmännisch gerundet über
`rounded_position`/`gerundeteLage` (`round(x) = ⌊(2x + 1)/2⌋`, exakt über `isqrt`; ein Halbwert
kann bei irrationalem x nicht auftreten); danach nur ganzzahlige Summen. Trassen: je
zusammenhängender Trasse und je Belegungsstück einmal gerundet – die Summe gerundeter Stücke kann
bei schrägen Strecken um wenige Millimeter von der gerundeten Trassenlänge abweichen
(dokumentiert, keine Korrektur). Randfälle der Fixture: negative Lagen, kleine Wurzeln
(√2 → 1, √3 → 2), Werte knapp an ,5 (√13 → 4, √20 → 4), große Werte (10⁶·√2 → 1 414 214).

### 17.5 Modellgrenzen (sichtbar zu machen ab 6b.4)

Messung auf der Wandachse (D10); Fußbodenwege auf FFB-Höhe ohne Aufbau, Estrich, Leerrohre;
Bodenübergang und Durchführung sind Planungsannahmen ohne Aussage zur Ausführbarkeit;
keine Wegfindung, keine Bemessung, keine Normaussage; Durchführungen nicht durch `separate`
(D9 zurückgestellt); Außen- und gebäudeübergreifende Leitungen später (D2); Schachtfortsetzung nur
senkrecht über dem Halt; ein Wechsel direkt von Steigweg zu Steigweg wird nicht unterstützt
(`riser-transfer`).

### 17.6 Testabdeckung (Fixture-Fälle → Anforderung)

| Anforderung | Fixture-Fall / Test |
|---|---|
| Beispiel §6.4: 8 500 / 9 200, Rückweg, Durchführung einmal gezählt | „§6.4 Diele -> Kueche …“ (inkl. Trassen) |
| 3 Leitungen: 4 000 Trasse / 10 000 Leitung, Belegung 2/3/2 | „§5.4 Trasse …“ |
| Verzweigung über Abzweigdose (getrennte Leitungen) | „§5.4 Trasse …“ (L0 → j1, j1 → L1/L2) |
| Gegenlage: entgegengesetzt, versetzter Anfang, Teilüberlappung, außerhalb, Kante, schräg irrational, Hin-/Rückweg | `gegenlagen` (6 Fälle) |
| L-Raum Decke/Fußboden verlässt die Kontur; Diagonale durch die Innenecke gültig | „L-Raum …“ + Konturtest (beide Umlaufrichtungen) |
| Öffnung im Wandweg (durch, Schwelle, Wegpunkt in der Tür, über dem Sturz) | „Oeffnung im Wandweg …“, §6.4-Fall |
| Unzulässiger Raumwechsel (Wand und Fußboden) | „Ungueltige Wandwege …“, „Bodenuebergang …“ (`unter-wand`) |
| Bodenübergang fehlt/verschoben/Fenster/Reihenfolge; eigene + abgeleitete Öffnung | „Bodenuebergang …“, „… verschoben“, „… abgeleitete Oeffnung“ |
| Abschnitt undecided/separate/ambiguous/broken | Bodenübergang ungekoppelt/getrennt; Durchführung getrennt/mehrdeutig/unterbrochen |
| Steigweg vorwärts/rückwärts, Teilnutzung, Zwischenhalt, Schacht | „Steigweg EG -> OG …“, „Steigweg rueckwaerts …“ |
| unbestätigte/widersprüchliche Höhenlage; Geschossleitung bleibt bestätigt | „… unbestaetigter Hoehenlage …“, „… widerspruechlicher …“, „… Einstieg an der Decke …“ |
| keine Doppelzählung am Einstieg (700 + 750 = 1 450) | „Steigweg EG -> OG …“ |
| Nullstrecken, Rundungsgrenzen | „L-Raum …“ (`rundung`), `rundung` (10 Fälle) |
| Wand, Decke, Fußboden getrennte Trassen | „Decke und Fussboden …“ |
| Endpunkte fehlen/außen/unbekannt, Weg leer/nicht erreicht | „Endpunkte und unvollstaendige Wege …“ |
| Identische Ergebnisse Backend/Frontend | `tests/test_cable_length.py` (42) und `leitung/laenge.test.ts` (41) lesen dieselbe Fixture; Reihenfolgeunabhängigkeit je Seite |

Alle Sollwerte sind von Hand fachlich hergeleitet (Strecke für Strecke, siehe Fallnamen) und
nicht aus der Implementierung übernommen; eine beim Gegenrechnen gefundene Sollsumme der
Fixture wurde vor dem ersten Lauf korrigiert.

## 18. Umsetzungsstand 6b.3 (2026-10-12)

**Implementiert und technisch geprüft, im Checkpoint `53fdc19` vom 2026-10-13 committet** (Tasks 0042–0044):
Datenbankabnahme gegen PostgreSQL und MinIO bestanden (neue Datenbanktests, Mandanten-Sweep,
Fremdschlüsselproben, Migration `0013` mit Downgrade auf Wegwerf-Datenbank, `alembic check`,
Entwicklungsdatenbank migriert, synthetischer API-Durchlauf im laufenden System). Nach der
Ursachenbehebung des fremden, lastabhängigen 3D-Frontendtests (Task 0043) lief `tasks.ps1 check`
vollständig grün (Backend 1 319/1 319, Frontend 1 038/1 038, Build). Manuelle Gesamtprüfung nach
Phase 6 und Produktions-/Echtdatenfreigabe offen.

### 18.1 Datenmodell (Migration `0013_cables_and_penetrations`)

| Tabelle | Inhalt | Bezüge |
|---|---|---|
| `electrical_wall_penetrations` | Lage einmal an `wall_a` der Kopplung (`offset_mm`, `height_mm`), Notiz, Version | Kopplung `RESTRICT` |
| `electrical_cables` | Stromkreis, Bezeichnung, Start-/Endgerät, **tatsächliche** Kabelangaben (`cable_type`, `conductor_count`, `cross_section_mm2 numeric(6,2)`), Zugaben und Reserve (je 0–20 000), Version – **keine Längenspalte** | Stromkreis `CASCADE`, Geräte `RESTRICT`, `start <> end` |
| `electrical_cable_waypoints` | Wegpunktliste (`seq` eindeutig je Leitung), `kind` ∈ `wall`, `ceiling`, `floor`, `penetration`, `opening_crossing`, `riser`; CHECK „je Art genau die zugehörigen Spalten“ | alle `RESTRICT`; Leitung `CASCADE` |

Alle Fremdschlüssel zusammengesetzt mit `organization_id`. Halte verweisen über
`(organization_id, riser_id, stop_id)`; dafür erhält `electrical_riser_stops` die Eindeutigkeit
`(organization_id, riser_id, id)` – ein Halt gehört auch auf Datenbankebene zum genannten
Steigweg. Der Bodenübergang speichert seine Lage selbst; `opening_id` ist nullable
(Speicherstrategie §5.6). Downgrade bricht ab, solange Leitungen oder Durchführungen existieren.
Neues Recht `electrical.route.write` (Rolle Planer) legt der Seed an.

### 18.2 Speichern einer Leitung

* **Endgeräte:** das Lagegerät der Verteilung des Stromkreises oder ein diesem Stromkreis
  zugeordnetes Gerät, im Gebäude, nicht gleich; außen montiert `422 cable-endpoint-exterior`
  (bestehende Geräte bleiben unverändert). `start_device_id` leer nur, solange die Verteilung
  keine Lage hat (`cable-start-required`); eine spätere Platzierung hängt nichts still an.
* **Bezüge:** jede Wand, jeder Raum, jede Öffnung, Durchführung und jeder Steigweg liegt im
  Gebäude, jeder Halt gehört zum genannten Steigweg – sonst `422 cable-reference-unknown`, ohne
  Existenzauskunft (fremder Betrieb, anderes Gebäude, unbekannte ID gleich).
* **Unvollständig erlaubt, unzulässig nicht:** Befunde der Art `missing` werden gespeichert
  (`incomplete`), Befunde der Art `conflict` lehnen ab (`422 cable-route-invalid` mit Code und
  Ort je Befund). Ausnahme `riser-elevation-inconsistent` (Geschossdaten, nicht der Weg). Bleiben
  Weg und Endgeräte unverändert, gilt nur „kein **neuer** Konflikt“ – eine bestätigt
  unterbrochene Leitung lässt sich weiter beschriften, wird aber nie still repariert.
* **Neue Durchführungen** (`new_penetrations` mit Schlüssel) entstehen in derselben Transaktion
  wie die Leitung, nur wenn sie gültig sind und genutzt werden (`penetration-unused`); jeder Fehler
  verwirft beides.
* **Berechnung** ausschließlich über `analyse_cable`; die API liefert Teilstrecken mit Länge,
  bekanntem Teil und räumlichen Punkten (`segment_points`, §17.2), Status, Länge nur bei
  `confirmed`, sonst Teilsumme, Befunde und „weicht vom Vorschlag ab“.

### 18.3 Vorschlag übernehmen (vom Auftraggeber bestätigt 2026-10-12)

`POST /cables/{cable_id}/apply-proposal` (Recht `electrical.circuit.write`, §8.6) – **eine Leitung
je Aufruf**, zwei getrennt benannte Versionen: **`If-Match`** ist die Version der Zielleitung,
**`expected_circuit_version`** (Körper) die Version des Stromkreises, dessen Vorschlag der Anwender
gesehen hat. Beide werden unter der Projektsperre geprüft (Sperrreihenfolge Projekt → Stromkreis →
Leitung); weicht eine ab, `409` (`version-conflict` bzw. `circuit-proposal-changed`) ohne jede
Teiländerung. Mehrere Leitungen überträgt die Oberfläche mit je einem Aufruf (jeder für sich
atomar). Übernommen werden genau `cable_type`, `conductor_count`,
`cross_section_mm2` – so, wie sie im Vorschlag stehen, auch leer. Weg, Endgeräte, Zugaben und
Bezeichnung bleiben. Eine spätere Vorschlagsänderung ändert keine Leitung.

### 18.4 Abhängige Planungsdaten (Entwurf §7)

Jeder Schreibweg hält unter der Projektsperre den Leitungsstand des **Gebäudes** vorher fest und
vergleicht danach (`cable_rules.CableGuard`). Neuer Befund = Code und Ort, die vorher fehlten.

| Schreibweg | Regel |
|---|---|
| Raumentwurf (Kontur, Öffnungen, Geräte) | Endgerät entfernen `409 device-has-cables`, Wand mit Bezug entfernen `409 wall-has-cables`, Kopplung mit Durchführung lösen `409 wall-link-has-penetrations`; Wandteilung mit Bezug im neuen Stück `422 wall-split-with-cables`; umgekehrte Wand: Bezüge behalten ihren Ort (`L − x`, Versionen zählen weiter); Öffnung über Wandstrecke/Wegpunkt `422 opening-over-cable` (auch mit Bestätigung); entfernte Öffnung mit Bodenübergang: `opening_id = NULL` an genau diesen Wegpunkten – nur mit Bestätigung; jede andere Unterbrechung nur mit `acknowledged_cable_ids` |
| Einzelwege Wand, Öffnung, Reihenfolge, Raum anlegen | wie oben, aber **ohne** Bestätigungsfeld: eine Unterbrechung ist `409 cables-would-break` mit Hinweis auf den Raumentwurf; Öffnung mit Bodenübergang einzeln entfernen `409 opening-has-cables` |
| Raum löschen | `409 room-has-cables` (Wege, Bodenübergänge, Endgeräte, Durchführungen) |
| Raumhöhe | Wegpunkt oder Durchführung über einer abgesenkten Höhe `422`; Unterbrechung durch Anheben (Übergang zur Decke) mit Bestätigung |
| Geschoss-Standardhöhe (Core-Teilnehmer) | jede Unterbrechung oder ungültige Durchführung `422` – über den Core-Weg gibt es keine Bestätigung |
| Wandkopplung | `shared → separate`/dritte Wand mit Durchführung `422`; Bodenübergang einseitig: mit Bestätigung; Kopplung mit Durchführung lösen `409` |
| Durchführung ändern | neue Lage muss gültig sein (`422`); unterbrochene Leitungen nur mit Bestätigung; entfernen nur ungenutzt (`409 penetration-in-use`) |
| Steigweg | genutzter Halt entfällt nicht (`409 riser-stop-in-use`), genutzter Steigweg nicht (`409 riser-in-use`); verschobener Halt, an dem ein Übergang nicht mehr liegt: mit Bestätigung |
| Zuordnung, Verteilungslage | Endgerät einer Leitung bleibt zugeordnet (`409 circuit-device-has-cables`); Lage mit Leitungen nicht ändern (`409 board-placement-has-cables`) |
| Höhenlage, Bestätigung, Ebene | nur Status/Länge der Steigweganteile, keine Prüfung (§7) |
| Stromkreis löschen | Leitungen per `CASCADE` (Rückfrage mit Anzahl in der Oberfläche, 6b.4); Durchführungen bleiben |
| Projekt löschen | Leitungen → Durchführungen → Stromkreise → Verteilungen → Steigwege → Räume |

**Bestätigung** (`acknowledged_cable_ids`, verlangt zusätzlich `electrical.route.write`): muss
**genau** die betroffenen Leitungen nennen. Fehlt eine: `409 cables-would-break` (je Leitung
Stromkreis, Bezeichnung, Endgeräte, Grund); nennt sie eine nicht betroffene, fremde oder veraltete
ID: `409` mit `cable-not-affected` je ID; doppelt: `422 acknowledged-cable-duplicate`. Durchführungen
bleiben hart geschützt; eine Bestätigung umgeht das nie. Ein veralteter Raumentwurf mit gleicher
Raumversion (Leitungen zählen keine Raumversion) trifft beim Speichern auf diese Prüfung.

**Auslegung ohne neue fachliche Entscheidung:** Für „Durchführung verschieben“ nennt §7 keine
eigene Zeile; §8.5 („Leitungsbefunde vorher/nachher“) und D4 legen dieselbe Regel wie beim
Verschieben einer Wand fest – gültige Lage Pflicht, Unterbrechung nur mit Bestätigung; die
betroffenen Leitungen bleiben als Konflikt sichtbar, harte Schutzregeln gelten weiter (vom
Auftraggeber bestätigt 2026-10-12). Für den Halt gilt §7 wörtlich.

### 18.5 Grenzen

Keine Oberfläche (Stand 6b.3; seit 6b.4 Leitungsliste, Wand-/Deckenwerkzeuge und Bestätigungsrückfrage,
§19): Die grafischen Werkzeuge folgten mit 6b.4/6b.5; in der Oberfläche gab es noch keine Bestätigungsrückfrage (der Raumentwurf zeigt eine `409`
`cables-would-break` als Fehlermeldung). Keine Mengenübersicht (6b.6), keine Materialintegration,
keine Events, keine Bemessung oder Normaussage.

### 18.6 Tests

| Datei | Inhalt | Stand |
|---|---|---|
| `test_cable_length.py`, `leitung/laenge.test.ts` | Fixture inkl. Anschluss fehlt/unzulässig, Raumpunkte | grün |
| `test_riser_course.py`, `steigweg/verlauf.test.ts` | gleiche Ebene, Eingabereihenfolge | grün |
| `test_electrical_cables.py` | Beispiel 8 500/9 200, Atomarität, unvollständig/unzulässig, Endgeräte und gebäudefremde Bezüge, Versionen, getrennte Rechte, Schreibschutz, Vorschlag (beide Versionen), Löschschutz, Projektlöschung, Bodenübergang mit entfernter Tür (genaue/falsche/doppelte Bestätigung), veralteter Entwurf, Öffnung über Wandstrecke, Kopplung/Höhe/Durchführung, Steigweghalt | bestanden (PostgreSQL) |
| `test_cable_concurrency.py` | parallele Ersetzung, Anlegen gegen Gerät entfernen, Ersetzen gegen Wand verkürzen, archiviert/abgeschlossen je Schreibweg, Schreibweg vor Archivierung | bestanden |
| `test_tenant_isolation.py` | Sweep um die neuen Routen, fremde Bezüge, DB-Fremdschlüssel | bestanden |
| `test_migration_cables.py` | Wegwerf-Datenbank: Bestand 0012 → 0013 unverändert, Modellabgleich, Wegpunktform und Bezüge in der Datenbank, Downgrade bricht mit Leitungen ab und gelingt ohne | bestanden |

## 19. Umsetzungsstand 6b.4 (2026-10-13)

**Technisch umgesetzt und funktional im Browser geprüft (§19.8), im 2. Checkpoint vom 2026-10-13 committet.** Dunkles Theme, mm/m im Browser, Zuordnungsmodus und Durchführung verschieben im Browser stehen auf der Gesamtprüfliste; die vollständige manuelle Abnahme nach Phase 6 bleibt offen. Keine Backendänderung, keine Migration, keine API-Erweiterung.

### 19.1 Umfang

| Thema | Umsetzung |
|---|---|
| Ort | bestehende Wand- und Deckenansicht des 2D-Editors; Seitenfeld „Leitungen“ und Werkzeuge „Leitung“ (L) und „Zuordnen“ (Z) – keine zweite Editorplattform |
| Liste | Leitungen dieser Arbeitsfläche (Läufe, Wegpunkte oder Endgeräte hier), umschaltbar auf alle des Gebäudes; je Leitung Stromkreis, Bezeichnung, Endgeräte, Status, Länge bzw. ausdrückliche Teilsumme |
| Auswahl | Kabelangaben, „weicht vom aktuellen Stromkreisvorschlag ab“, Weg/Zugaben/Gesamtlänge getrennt, Befunde mit verständlichem Ort („Wegpunkt 3“, „Strecke 2 – 3“, „Anschluss Endgerät“) |
| Neue Leitung | Stromkreis wählen; Kabelangaben aus dem **aktuellen** Vorschlag vorgefüllt und „aus Vorschlag“ gekennzeichnet; Startgerät = Lage der Verteilung (falls platziert); Bezeichnung `L<n>` vorgeschlagen |
| Entwurf | Bezeichnung, Start-/Endgerät (Lagegerät der Verteilung und zugeordnete Geräte, **nicht** außen montierte), Kabelangaben je Feld mit „aus Vorschlag“/„abweichend vom Vorschlag“, Zugaben Start/Ende/Reserve (0 … 20 m), Wegpunktliste, Ergebnis, nächster Schritt des Ablaufs |
| Speichern | nur ausdrücklich: `POST /circuits/{id}/cables` bzw. `PUT /cables/{id}` mit `If-Match`; lokale Prüfung von Endgerät, Leiterzahl, Querschnitt; Serverantwort wird neue Basis |
| Konflikt | `409 version-conflict`: nichts überschrieben, Entwurf bleibt; „Entwurf vorerst behalten“ oder „Entwurf verwerfen und Serverstand laden“ |
| Vorschlag übernehmen | ausdrücklich mit Rückfrage (nennt Leitung und neue Angaben) über den bestehenden Vertrag: `If-Match` der Leitung, `expected_circuit_version` des gesehenen Stromkreises; bei `409` nichts übernommen, Hinweis, Neuladen |
| Entfernen | Leitung mit Rückfrage (`If-Match`); Durchführungen bleiben |
| Durchführungen | vorhandene als Symbol an beiden Wänden (Gegenlage aus der geprüften Transformation des Servers), als Wegpunkt aufnehmbar; Verschieben (nur an der Eigentümerwand, nur ohne offenen Leitungsentwurf) mit genauer Bestätigung; Entfernen nur ungenutzt |
| Zuordnung | Modus „Zuordnen“ in Wand- und Deckenansicht mit **demselben** Zuordnungsentwurf (`stromkreise/zuordnung.ts`, auch von der Stromkreisansicht genutzt) |
| Bestätigung | gemeinsame Rückfrage `leitung/bestaetigung.tsx` für Konturspeichern, Raumdaten (Editor und Tabellen), Wandzuordnung anlegen/ändern, Steigweg ändern, Durchführung verschieben |

### 19.2 Gesten und Tastatur

| Aktion | Bedienung |
|---|---|
| Wegpunkt setzen | Werkzeug „Leitung“ (L), Klick auf die Fläche; Vorschau folgt dem Zeiger und zeigt Gültigkeit, Maße und Fangziel; ein neuer Punkt folgt dem gewählten, sonst ans Ende |
| Start-/Endgerät | Werkzeug „Leitung“, Klick auf ein Gerät des Stromkreises: ohne Startgerät wird es Startgerät, sonst Endgerät; fremde Geräte werden mit Grund abgelehnt; gleichwertig über die Auswahlfelder |
| Auswählen / Ziehen | Klick auf einen Wegpunkt (jedes Werkzeug) wählt ihn; Ziehen verschiebt ihn – **eine Bewegung = ein Rückgängig-Schritt**; ungültige Lagen bleiben ungespeichert (letzte gültige Lage bleibt) |
| Feinverschieben | Pfeiltasten 1 cm, mit Umschalt 10 cm – je Druck ein Schritt |
| Entfernen | Entf/Rücktaste oder „Entfernen“ in der Liste – nur Wand-, Decken- und Durchführungspunkte |
| Abschluss | Enter beendet das Zeichnen (Werkzeug „Auswählen“) und nennt den nächsten Schritt |
| Escape | Bewegung → Werkzeug → Wegpunktauswahl → Leitungsauswahl → Ansicht schließen |
| Rückgängig/Wiederholen | Strg+Z / Strg+Y (Strg+Umschalt+Z) im Leitungsentwurf; Strg+S speichert ihn |
| Ausschluss | Während eines Leitungs- oder Zuordnungsentwurfs sind die Werkzeuge für Räume, Öffnungen und Geräte ausgeblendet; Alt setzt den Fang aus |

### 19.3 Fang, Hilfslinien, Prüfung

* **Wand:** Raumecken (Wandkanten), Decke (Übergang), Gerätemitten (Achse und Höhe), Durchführungen,
  Öffnungskanten und Oberkanten, vorhandene Trassen (Höhen waagerechter, Lagen senkrechter Läufe),
  Raster. Strecken auf derselben Wand bleiben **waagerecht oder senkrecht**: Nachbarpunkte derselben
  Wand legen die Achse fest (der nähere Fall gewinnt). **Anschlusspunkte** am vorhandenen Weg: Ecke
  zur Nachbarwand auf gleicher Höhe, Übergang von der Decke an derselben Stelle der Wandachse.
* **Decke:** Raumecken, Gerätemitten, Flucht der Nachbarpunkte, vorhandene Trassen, Raster;
  Anschlusspunkt „Übergang von Wand n“ (nur ganzzahlig). Strecken liegen vollständig in der
  **echten** Kontur (auch L-Raum).
* **Hilfslinien** (nur mit Werkzeug „Leitung“, ausdrücklich „unverbindlich“): waagerecht 300 mm unter
  der Decke, 1 100 mm und 300 mm über dem Boden; senkrecht 200 mm neben Wandkanten und Öffnungen.
  Keine Prüfung, keine Normaussage (Annahme ohne erhebliche Auswirkung, hier dokumentiert).
* **Prüfung eines Kandidaten:** in den Entwurf eingesetzt und mit `leitung/laenge.ts` (Spiegel von
  `cable_length.py`, gemeinsame Fixture) ausgewertet; ein Konflikt am Punkt oder an seinen Strecken
  lehnt ihn ab (der Anschluss an das Endgerät zählt beim Zeichnen nicht). Ein Fangziel erzwingt nie
  eine ungültige Lage (dann ohne Fang). Vorschau, Länge und Befunde stammen aus derselben
  Auswertung – keine zweite Längenberechnung. Eingabe: derselbe gespeicherte Planungsstand wie beim
  Server (`leitung/daten.ts`, Spiegel von `build_plan`).

### 19.4 Entwürfe und Arbeitsflächen

* **Planungskontext** = Geschoss im 2D-Editor. Er hält höchstens **einen** aktiven Entwurf: Raum,
  Gerätezuordnung oder Leitung. Ein Leitungs- oder Zuordnungsentwurf beginnt nur ohne ungespeicherte
  Raumänderungen; solange er offen ist, ruht die Raumbearbeitung (Hinweisleiste im Grundriss mit
  „Leitung weiter bearbeiten“, „speichern“, „schließen“).
* **Arbeitsfläche** = eine Wand- oder Deckenansicht darin. Wechsel („Arbeitsfläche wechseln“:
  Nachbarwände, Decke, Wände der Decke) behalten den Entwurf, speichern und verwerfen nichts; die
  Herkunft (2D/3D) bleibt erhalten.
* **Verlassen** (Ansicht, Geschoss, Navigation, Abmelden) über den bestehenden Navigationsschutz;
  „Entwurf schließen“ fragt bei ungespeicherten Änderungen. Kein `alert`/`confirm`, kein Autospeichern.
* **Rückkehr aus 3D:** Schließen führt wie bisher zur 3D-Ansicht mit Kamera und Auswahl; ein
  ungespeicherter Entwurf wird dabei erfragt.
* **Benutzer-/Betriebswechsel:** Entwürfe sind Komponentenzustand im sitzungsgebundenen Baum – mit dem
  neuen Sitzungsraum sind sie fort; Abfragen liegen im sitzungsgebundenen Query-Client, `signal`
  wird weitergereicht.

### 19.5 Erhalt nicht bearbeiteter Wegpunkte

Fußboden-, Bodenübergangs- und Steigwegpunkte werden gelesen, mit Ort angezeigt, als „hier nicht
bearbeitbar – bleibt unverändert“ gekennzeichnet und beim Speichern **unverändert** mitgesendet; sie
lassen sich hier weder verschieben noch entfernen. Eine Leitung mit einem nicht lesbaren Wegpunkt wird
nicht bearbeitet (nichts ginge still verloren).

### 19.6 Präzisierungen (ohne neue fachliche Entscheidung)

* **Durchführung setzen** ordnet §12 dem Grundriss (6b.5) zu; in 6b.4 werden nur vorhandene
  Durchführungen genutzt, verschoben und (ungenutzt) entfernt – `new_penetrations` bleibt leer.
* Außen montierte Geräte werden nicht als Endgeräte angeboten (§18.2); auf der Außenseite einer Wand
  gibt es kein Werkzeug „Leitung“ und keine Wegpunkte.
* Das Bestätigungsfeld `acknowledged_cable_ids` wird nur gesendet, wenn wirklich bestätigt wurde;
  ohne Unterbrechung bleibt jede Anfrage wie bisher (kein `route.write` nötig).

### 19.7 Tests

`leitung/entwurf.test.ts` (Historie, ein Schritt je Ziehbewegung, Konflikt, Wegpunkte, Kabelangaben),
`leitung/daten.test.ts` (Beispiel §6.4 8 500/9 200 über die Vorschau, Erhalt aller Wegpunktarten),
`leitung/flaechen.test.ts` (Umrechnung, Fang, rechtwinklige Führung, Kontur L-Raum, Öffnung, Ecke,
Übergang Wand – Decke), `leitung/Leitungsplanung.test.tsx` über den echten Editor (neue Leitung von
Stromkreis bis Speichern, Ablehnungen, Ziehen/Undo/Redo, Pfeiltasten, Erhalt eines Fußbodenpunkts,
Versionskonflikt, Wand → Decke, Rückkehr aus 3D, Vorschlag mit beiden Versionen und Konflikt,
Unterbrechungsbestätigung mit genauen IDs und erneuter Frage, Durchführung verschieben, Zuordnung,
Navigationsschutz, Rechte, Schreibschutz, Sitzungswechsel, Einheiten, Theme-Tokens, außen montierte
Geräte); angepasst: `Wandzuordnung.test.tsx` (Rückfrage-Provider), Stromkreisansicht unverändert grün.

### 19.8 Abnahme

**Automatisiert (Task 0045/0046):** Frontend 1 095 Tests (92 Dateien) grün, Typecheck, ESLint,
Modulgrenzen, Build und API-Drift grün; keine Backendänderung, daher kein erneuter Backendlauf.

**Funktionaler Browserdurchlauf (Task 0046, 2026-10-13)** im laufenden Entwicklungsstack (Docker-Engine
wieder verfügbar, Entwicklungsdatenbank auf `0013`, Seed mit `electrical.route.write`), nur mit
synthetischen Daten. Voraussetzungen per API aufgebaut (Skript `browser_6b4_aufbau.py`): Diele und
Küche mit gemeinsamer Bauwand, Verteilung UV1 mit Lagegerät, Stromkreis F3 (Vorschlag NYM-J 3 × 1,5)
mit zwei zugeordneten Steckdosen, Leitung L1 mit **vorhandener** Durchführung (Durchführungen entstehen
über die Oberfläche erst in 6b.5). Über die Oberfläche ausgeführt und gegen Server und Neuladen geprüft:

| Ablauf | Ergebnis |
|---|---|
| Neue Leitung L2 in der Wandansicht: Start vorgefüllt, zwei Wegpunkte mit Fang, Endgerät per Klick, Zugaben 50/20 cm, Querschnitt abweichend 2,5 | Vorschau 520 cm geometrisch, 590 cm gesamt; `POST → 201`, Server 5 200/700/5 900 mm, „weicht ab“ |
| Seite neu geladen, L2 gewählt | Verlauf, Kabel (NYM-J · 3 · 2,5 mm²), Zugaben 70 cm, 590 cm, „weicht vom Vorschlag ab“ – identisch |
| Vorschlag übernehmen (Rückfrage) | `POST …/apply-proposal → 200`, 1,50 mm², Version 2, keine Abweichung mehr |
| Wegpunkt ziehen, Rückgängig, Wiederholen | eine Bewegung = ein Schritt (370 → 300 → 370 → 300 cm) |
| Versionskonflikt (Paralleländerung per API) | `PUT` mit `If-Match: 2 → 409`; Entwurf (300 cm) bleibt; erst „Entwurf verwerfen und Serverstand laden“ lädt „L2 extern“ |
| Wegpunkt entfernen, Änderungen verwerfen | ein Punkt, dann wieder der gespeicherte Stand |
| L3 Wand → Decke → Wand | Übergang von der Wand eingerastet, zwei Deckenpunkte, Rückweg zur Wand mit Übergang; Entwurf über beide Arbeitsflächenwechsel erhalten; 580 cm; `POST → 201`, Server mit zwei Übergängen Wand – Decke |
| Navigationsschutz | Ansichtswechsel „Ansicht wechseln?“, Router-Navigation „Seite verlassen? … ungespeicherten Leitungsentwurf“, „Entwurf schließen“ mit Rückfrage – nichts verworfen ohne Bestätigung |
| Raumhöhe 250 → 260 cm (unterbricht L3) | Rückfrage nennt genau „F3 · L3 …“ mit Grund; „Nicht speichern“: nichts gespeichert; bestätigt: `PATCH` mit genau der ID von L3 → 200; L3 als Konflikt mit Teilsumme und Befunden „Strecke 1 – 2/3 – 4“; per Pfeiltasten korrigiert, Strg+S → bestätigt 600 cm |
| Projekt archiviert | Wandansicht „Nur Ansicht“, keine Raum-, Leitungs- oder Zuordnungswerkzeuge, Leitungsangaben lesbar |

**Optisch geprüft** (Bildschirmfotos im Browser, nicht aus DOM-Messungen): Darstellung gespeicherter
Leitungen (blass) und des Entwurfs (Leitungsfarbe, Anschlüsse gestrichelt, nummerierte Wegpunkte),
Hilfslinien mit Beschriftung, Fangvorschau mit Fanglinie, unvollständige Deckenstrecke gestrichelt in
Warnfarbe, Konfliktleitung strichpunktiert in Fehlerfarbe, Seitenfeld (Marken „aus Vorschlag“/
„abweichend“, Länge/Teilsumme), Rückfragen (Vorschlag, Unterbrechung, Verlassen), Hinweisleiste im
Grundriss, Lesemodus. Nur helles Theme, Fensterbreiten 1 280 und 640 px.

**Im Durchlauf gefunden und behoben (mit Regressionstest):**

1. Konflikt- und Fehlermeldung des Leitungsentwurfs standen oben im Seitenfeld, rund 1 000 px über dem
   Knopf „Leitung speichern“ – nach dem Klick war keine Rückmeldung sichtbar. Jetzt direkt über den
   Speicherknöpfen; oben „Konflikt – nicht gespeichert“.
2. Hinweise der Leitungsplanung („Serverstand geladen …“) fehlten bei offenem Entwurf und blieben nach
   dem Schließen veraltet stehen. Jetzt im Entwurf sichtbar, beim Schließen gelöscht.
3. Kopf- und Werkzeugzeile der Wand- und Deckenansicht schrumpften in der Spalte fester Höhe auf ihre
   Mindesthöhe; umgebrochene Knöpfe („Speichern“) überdeckten „Auswählen“. Bestand schon vor 6b.4,
   verdeckt aber die Leitungswerkzeuge – jetzt `shrink-0`; sichtbar nachgeprüft.

**Keine Fehler:** einzelne `ERR_ABORTED` sind die abgebrochenen ersten Abfragen des React-StrictMode
im Entwicklungsmodus (Abbruchsignal wirkt); ein `401` in der Konsole stammt von der abgelaufenen
Sitzung vor der erneuten Anmeldung. **Nicht reproduzierbar:** ein winziger Grundriss-Maßstab nach dem
Neuladen bei ausgeblendetem Browserbereich; Öffnen/Schließen der Ansichten verändert den Maßstab nicht.

**Nicht ausgeführt:** dunkles Theme und Einheit mm/m im Browser (nur Tests), Zuordnungsmodus und
Durchführung verschieben im Browser (nur Tests), Abschluss-Status „abgeschlossen“ im Browser (Test;
im Browser „archiviert“). **Hinweis zum Stack:** Der Vite-Server im Planner-Container übernimmt
Dateiänderungen über die Windows-Bindung nicht; nach Codeänderungen den Container regulär neu starten.

**Prüfdaten:** Projekt PR-2026-0007 „Leitungsplanung 6b.4 (synthetisch)“ (archiviert) bleibt mit L1–L3
für die manuelle Prüfung erhalten; das zweite Prüfprojekt PR-2026-0008 ist samt Kunde entfernt.

### 19.9 Vorbereitung 6b.5 (umgesetzt, siehe §20)

Der Leitungsentwurf ist heute an den Planungskontext **Geschoss** gebunden; ein Geschosswechsel
verlässt ihn (Navigationsschutz). In 6b.5 muss der Entwurf beim Geschosswechsel über einen Steigweg
**erhalten bleiben**: Er wird dann an das Gebäude gebunden, jeder Wegpunkt behält seinen eindeutigen
Raum- bzw. Geschossbezug (Wand, Raum, Halt), und ein Wechsel der Arbeitsfläche – auch in ein anderes
Geschoss – speichert und verwirft nie automatisch.

## 20. Umsetzungsstand 6b.5 (2026-10-14)

**Status:** technisch umgesetzt, automatisiert und funktional im Browser geprüft; mit den Nachkorrekturen
(§20.7) als Checkpoint `62a1cc9` vom 2026-10-14 committet; manuelle Gesamtprüfung nach Phase 6 offen; keine Produktions- oder Echtdatenfreigabe. Keine
Backendänderung, keine Migration, keine API-Änderung (die API aus 6b.3 deckt Fußboden, Bodenübergang,
Steigweg und `new_penetrations` bereits ab).

### 20.1 Umfang

* **Gebäudeweiter Leitungsentwurf** (§19.9 umgesetzt): `leitung/LeitungsplanungProvider.tsx` hält die
  Leitungsplanung je Gebäude (Schlüssel: Gebäude) um Grundriss, Wand-, Decken-, 3D-, Steigweg- und
  Stromkreisansicht. Ein Geschosswechsel im selben Gebäude, 2D ↔ 3D ↔ Tabellen behalten den Entwurf
  ohne Rückfrage, speichern und verwerfen nichts. Steigwege und Stromkreise (eigene Entwürfe) sowie ein
  anderes Gebäude fragen ausdrücklich nach. Projekt- und Benutzerwechsel bauen ihn wie bisher ab
  (Navigationsschutz, sitzungsgebundener Query-Client).
* **Grundriss-Werkzeug** (`leitung/Grundrissleitungen.tsx`, `leitung/GrundrissLeitungsfeld.tsx`,
  reine Hilfen `leitung/grundriss.ts`): Werkzeuge „Leitung“ (L) und „Durchführung hier“ (U), Ebenenwahl
  **Fußboden / Wand / Decke** (1/2/3), Höhe neuer Wandpunkte (0, 30 cm, 1,10 m, obere Zone = Raumhöhe −
  300 mm wie die Zonenhilfslinien, Raumhöhe). Leitungsfeld und Legende in der Seitenleiste.
* **Fußbodenwege:** Klick in einen Raum setzt einen Fußbodenpunkt in der Kontur; außerhalb jeder
  Kontur oder bei Raumwechsel ohne Übergang steht der Grund in der Statuszeile, nichts wird gesetzt.
  Fang auf Raster, ganzzahlige Wandachspunkte (Übergang zur Wand), Gerätefußpunkte, Steighalte.
* **Bodenübergang:** nur ausdrücklich durch Klick auf eine Tür oder einen Durchgang (Ebene Fußboden),
  Fang auf Türmitte und -kanten im Fangradius; Fenster werden abgelehnt. Als letzter Punkt ist die
  fehlende Gegenseite ein Zwischenstand („jetzt den Fußbodenpunkt im Nachbarraum setzen“), keine
  Ablehnung; alle übrigen Bedingungen prüft die gemeinsame Längenfunktion.
* **Neue Durchführungen** (Grundriss und Wandansicht, Werkzeug „Durchführung“): nur in einem aktiven,
  eindeutigen `shared`-Abschnitt genau einer Kopplung (`leitung/durchfuehrung.ts`, `durchfuehrungsziel`);
  `undecided`, `separate`, mehrdeutig (mehr als zwei Räume), unterbrochen, Abschnittsgrenze und Wand
  ohne Nachbarraum werden mit Grund abgelehnt. Gespeichert wird die Lage einmal an `wall_a`; die
  Gegenlage folgt aus `lageUebertragen` (dieselbe Transformation wie im Server). Die Durchführung lebt nur
  im Entwurf (`neueDurchfuehrungen`, Schlüssel `neu-` + 32 Hex-Zeichen ≤ 40 Zeichen wie
  `NewPenetrationIn.key`) und entsteht atomar mit der Leitung über `new_penetrations`. Verwerfen,
  Rückgängig oder Entfernen des Wegpunkts hinterlässt nichts. Dieselbe Durchführung wird nie zweimal
  hintereinander aufgenommen.
* **Steigweg nutzen:** Klick auf einen Steighalt setzt – falls der Wegpunkt davor nicht genau am Halt
  liegt – ausdrücklich einen Fußboden- bzw. Deckenpunkt am Halt und öffnet die Steigwegwahl: Zielhalt,
  Ausstieg über dem Fußboden, Vorschau von Verlauf, Länge und Status mit der Längenfunktion (unbestätigte
  Höhen: „unvollständig“, Teilsumme; widersprüchliche Höhen: abgelehnt, nicht übernehmbar). „Steigweg
  übernehmen“ ist ein Rückgängig-Schritt; „Weiter in „OG““ wechselt das Geschoss (kein Schritt). Im
  Zielgeschoss setzt ein Klick auf den Halt ausdrücklich den Fortsetzungspunkt; dort zeigt der Grundriss
  „kommt aus EG (S1)“ bzw. „weiter in OG (S1)“. Einstiegshöhe aus dem Wegpunkt davor (Fußboden 0, Decke
  Raumhöhe, Wand dessen Höhe).
* **Darstellung im Grundriss** (§9.2): Strichart nennt die Fläche – Wand durchgezogen an der Raumseite,
  Decke fein, Fußboden grob gestrichelt; Status in Farbe und immer als Text (Titel, Seitenfeld, Legende).
  Gespeicherte Leitungen aus den Teilstrecken des Servers, der Entwurf aus den Läufen der Längenfunktion.
* **3D** (`ansicht3d/leitungen3d.ts`, `szene.ts`): gespeicherte Leitungen als Linienzüge je Teilstrecke
  (nie verbunden, was der Server nicht als Lauf liefert); Wand an der Raumseite, Fußboden knapp über FFB,
  Decke knapp darunter; Steigwege an den Geschossgrenzen gekappt mit ausdrücklicher Fortsetzung (Kugel,
  Text „Fortsetzung in „OG““). Status über Strichart (durchgezogen / gestrichelt / kurz gestrichelt) und
  Text, Farben aus `--ep-plan3d-cable*` (hell/dunkel). Auswahl über unsichtbare Trefferkörper, Liste der
  Leitungen in der Seitenleiste; „In der Wandansicht / Deckenansicht / Im Grundriss bearbeiten“ öffnet den
  Entwurf auf der passenden Fläche; Rückkehr mit Kamera und Auswahl. Ein offener Entwurf bleibt erhalten;
  3D zeigt ausdrücklich den gespeicherten Stand. Geometrien werden beim Ersetzen und Entsorgen freigegeben.

### 20.2 Gesten und Tastatur im Grundriss

| Eingabe | Wirkung |
|---|---|
| Klick (Werkzeug „Leitung“) | Punkt der gewählten Ebene nach dem gewählten Wegpunkt, sonst ans Ende |
| Klick auf Tür/Durchgang (Ebene Fußboden) | Bodenübergang |
| Klick auf Steighalt | Einstieg (ggf. Punkt am Halt) bzw. Fortsetzung nach einem Steigweg |
| Klick auf Gerät des Stromkreises | Start- bzw. Endgerät |
| Klick (Werkzeug „Durchführung hier“) | neue Durchführung an der angeklickten Raumwand |
| Ziehen eines Fußboden-/Deckenpunkts der gewählten Ebene | verschieben, ein Rückgängig-Schritt |
| L / U / 1 / 2 / 3 | Leitung / Durchführung / Fußboden / Wand / Decke |
| Entf | gewählten Wegpunkt entfernen (jede Art) |
| Strg+Z / Strg+Y | Rückgängig / Wiederholen im Leitungsentwurf |
| Enter / Escape | Werkzeug beenden / Vorschau, Bewegung oder Steigwegwahl abbrechen |

### 20.3 Präzisierungen (ohne neue fachliche Entscheidung)

* **Keine automatische Ecke oder Zwischenstrecke:** Es gibt keine vereinbarte deterministische
  Bedienhilfe dafür; jeder Punkt wird ausdrücklich gesetzt. Fang (Wandachse, Lage des vorigen Punkts,
  Wandenden) ist nur eine Lagehilfe.
* **Ebenenwahl** gilt nur für neue Punkte; vorhandene Wegpunkte werden nie umgewandelt, nicht
  bearbeitete Wegpunkte bleiben unverändert (wie §19.5).
* **Greifbare Marken:** Im Werkzeug sind nur die Punkte der gewählten Ebene (Fußboden bzw. Decke)
  greifbar; alle anderen Marken lassen den Klick durch, sonst verdeckten sie die Wandachse genau dort,
  wo der Übergang gesetzt wird. Gewählt werden sie über die Wegpunktliste.
* **Raumseite an Ecken:** Liegen im Fangradius Wände mehrerer Räume, entscheidet für das
  Leitungswerkzeug der Raum, in dem der Zeiger liegt; auf der Linie selbst bleibt es mehrdeutig.
  `raumwandUnterZeiger` selbst ist unverändert (Öffnungswerkzeug unberührt).
* **Undo/Redo:** Steigweg übernehmen, Punkt am Halt, Bodenübergang und neue Durchführung (mit Wegpunkt)
  sind je ein Schritt; ein reiner Geschoss- oder Ansichtswechsel ist kein Schritt.
* **Benennung:** Fußboden-/Deckenpunkte immer mit Raum und Geschoss („Diele (EG)“), Wände anderer
  Geschosse ebenso, Steigwege mit Halten und Höhen.

### 20.4 Tests

Frontend 97 Dateien, 1 129 Tests grün (vorher 1 095). Neu bzw. erweitert: `grundriss.test.ts`
(Achsgitter, Raumbestimmung, Fang, Zeichenstrecken, Durchführungsziel mit allen Ablehnungen, Gegenlage
hin und zurück, Höhenwahl), `durchfuehrung.test.ts` (Schlüssellänge gegen `openapi.json`),
`Grundrissleitungen.test.tsx` (Ebenenwahl, Fußboden in/außer Kontur, Raumwechsel ohne Übergang,
Bodenübergang inkl. Fenster, neue Durchführung speichern/verwerfen/Rückgängig ohne Serveraufruf,
Steigweg EG → OG mit Geschosswechsel, Fortsetzung, Länge, Undo/Redo über den Wechsel, unbestätigte und
widersprüchliche Höhen, Gebäudewechsel mit Rückfrage, schnelle Eingabe, Raumecke),
`Leitungsplanung.test.tsx` (Durchführung in der Wandansicht mit Gegenseite; Ansichtswechsel im
Gebäude), `leitungen3d.test.ts` (Ableitung, Kappung, keine falschen Verbindungen), `szene.test.ts`
(Strichart je Status, Auswahl, Freigabe, Theme-Farben), `Ansicht3d.test.tsx` (Rückkehr im StrictMode),
`Leitung3d.test.tsx` (3D → Grundriss → zurück mit Kamera und Auswahl, Entwurf bleibt, nichts
gespeichert), `entwurf.test.ts` (Durchführung nicht doppelt). Typecheck, ESLint, Modulgrenzen
(Frontend, import-linter Backend), Build, OpenAPI-Drift grün. Backend unverändert – keine
PostgreSQL-Tests nötig.

### 20.5 Abnahme im laufenden Stack (2026-10-13/14)

Docker-Stack lief; der Planner-Container wurde nach Codeänderungen regulär neu gestartet (kein
Dateibeobachten über den Windows-Bind-Mount – nicht behoben, wie beauftragt). Synthetische Daten per API
(`browser_6b5_aufbau.py` im Scratchpad): Projekt **PR-2026-0009 „Leitungsplanung 6b.5 (synthetisch)“**,
Gebäude „Haus“ mit EG (FFB 0) und OG (FFB 2 800), Diele mit Tür in der gemeinsamen Ostwand, Küche,
Flur OG, Steigweg S1, UV1, F3. Bedient wurde über echte DOM-Ereignisse an der Stelle unter dem Zeiger
(`elementFromPoint`), Prüfung gegen den Server per API.

**Funktional (bestanden):**

| Ablauf | Ergebnis |
|---|---|
| Fußbodenleitung L1 mit Bodenübergang EG Diele → Küche | Raumwechsel ohne Übergang abgelehnt; Tür-Klick rastet auf Türmitte; bestätigt 9 048 mm im Browser = Server (`opening_crossing` 1) |
| Neue Durchführung L2 in der oberen Zone | Ecke ohne Ablehnung; Gegenlage Küche 1 500 (Server ebenso); gespeichert 8 500 mm, genau eine Durchführung |
| Neue Durchführung verwerfen | nach Rückfrage verworfen; Server unverändert eine Durchführung |
| Geschossübergreifend L3 über S1 | Vorschau 280 cm „Verlauf gültig“; Wechsel ins OG ohne Rückfrage, Werkzeug und Entwurf bleiben; Fortsetzung am Halt; bestätigt 9 236 mm im Browser = Server |
| Neuladen | Listen, Längen, Status und Zeichnung (Wand/Fußboden) wie gespeichert |
| Versionskonflikt (Paralleländerung per API) | „Konflikt – nicht gespeichert“, nichts überschrieben, Entwurf behalten; Steigwege fragen nach, Abbrechen behält ihn; „verwerfen und Serverstand laden“ übernimmt Version 3 |
| 3D-Auswahl und Rückkehr | L3 mit „Fortsetzung in „OG““; „Im Grundriss bearbeiten“ öffnet Entwurf und Werkzeug; Rückkehr mit Draufsicht und Auswahl; ungespeicherte Änderung bleibt und wird benannt |
| mm / dunkles Token / 375 px | Länge „9.236 mm“, `--ep-plan3d-cable` #7cc0ff, `--ep-plan3d-cable-conflict` #ff7a7a (nur Vorschau, abgebrochen); keine waagerechte Überbreite |

**Optisch (Bildschirmfotos, helles Theme):** 3D isometrisch und Draufsicht: gewählte Leitung orange,
übrige in Leitungsfarbe; Fortsetzungskugel am Halt; Fußbodenwege sichtbar über dem Boden. Grundriss
bei 375 px: Werkzeugleiste, Ebenenwahl und Leitungsfeld ohne Überlauf, Fußboden grob gestrichelt.
**Optischer Befund:** Beschriftungen „S1“ / „weiter in OG (S1)“ überdeckten bei kleinem Maßstab
Raum- und Maßtexte – behoben mit §20.7 B. Das dunkle Theme ließ sich optisch nicht verlässlich prüfen (Bildschirmfoto vom
Einstellungsdialog verdeckt); funktional geprüft sind nur die Tokenwerte.

**Behobene Befunde der Abnahme** (Regressionstests zu 1–5 und 7; zu 6 siehe dort):

1. Loslassen las den Vorschaupunkt aus einem veralteten Stand, wenn zwischen Drücken und Loslassen kein
   Rendern lag → Kandidat zusätzlich in einer Ref.
2. Marken von Wand- bzw. Fußbodenpunkten verdeckten den Fangbereich der Wandachse → nur Punkte der
   gewählten Ebene greifbar (§20.3).
3. An Raumecken wurde die Wandwahl als mehrdeutig abgelehnt → Raum unter dem Zeiger entscheidet.
4. Die Marke einer neuen Durchführung fing den Klick auf die Gegenseite ab und nahm sie doppelt auf →
   Marke nur Anzeige, keine doppelte Aufnahme.
5. **Speichern scheiterte**: Schlüssel neuer Durchführungen war 54 Zeichen lang (Server: höchstens 40);
   atomar wurde nichts gespeichert, der Entwurf blieb → kürzerer Schlüssel, Test gegen `openapi.json`.
6. Rückkehr aus Grundriss/Wandansicht: Kamera neu eingepasst und Auswahl nicht hervorgehoben. Fehler und
   Korrektur wurden **im Browser** geprüft (vorher isometrisch und ohne Hervorhebung, nachher Draufsicht
   und orange hervorgehobene Leitung). Korrektur: Die gemerkte Rückkehr gilt für jedes neue Szenenexemplar
   des Geschosses (statt nach dem ersten verbraucht zu werden), und die Leitungen werden vor der Auswahl
   gesetzt. **Ursache vermutet, nicht nachgewiesen:** ein im Entwicklungsmodus (React StrictMode) zweites
   Szenenexemplar, das die bereits verbrauchte Kamera nicht mehr fand. Der ergänzte Komponententest
   („StrictMode mit bereits geladenem Plan“) erzeugt im Testlauf nur **ein** Szenenexemplar, bildet die
   Ursache also nicht nach und besteht auch ohne die Korrektur – er ist **kein vollständiger
   Regressionsnachweis**, sondern sichert nur die Rückkehr bei bereits geladenem Plan ab.
7. Grundriss ohne obere Zone → Höhenwahl „obere Zone – 30 cm unter der Decke“; Wände anderer Geschosse
   heißen „Wand 1 (Diele (EG))“ statt „anderes Geschoss“.

**Nicht ausgeführt:** Rückwärtsnutzung und Teilnutzung eines Steigwegs mit drei Halten im Browser (in der
gemeinsamen Fixture und Komponententests abgedeckt); Bodenübergang an einem Durchgang; Leitung in der
Deckenansicht aus 3D; dunkles Theme und Meter optisch; Mobilgerät mit echtem Touch.

**Prüfdaten:** PR-2026-0009 bleibt für die manuelle Gesamtprüfung erhalten (L1, L2 mit Durchführung,
„L3 parallel 2“ geschossübergreifend). Keine Echtdaten, keine Datenbank angelegt, keine Volumes gelöscht.

### 20.6 Grenzen und offene Punkte

* ~~Wand- und Deckenansicht lesen den Vorschaupunkt beim Loslassen aus dem Zustand~~ – behoben (§20.7 A).
* ~~Beschriftungsüberdeckung im Grundriss bei kleinem Maßstab~~ – behoben (§20.7 B).
* Gespeicherte Durchführungen erscheinen im Grundriss nicht als eigene Marke (Aufnahme in der
  Wandansicht); neue nur im Entwurf.
* Mengenübersicht und Gesamtprüfung Phase 6: 6b.6.

### 20.7 Nachkorrekturen vor dem Checkpoint (2026-10-14)

* **A – letzte Zeigerposition beim Loslassen:** Wand- und Deckenansicht führten denselben Fehler wie der
  Grundriss (Befund 1): Folgten Bewegung und Loslassen vor dem nächsten Rendern, wurde ein veralteter
  Vorschaupunkt übernommen. Jetzt hält eine Ref den zuletzt gültigen Kandidaten (mit Fang); Abbruch und
  Werkzeugwechsel leeren ihn. Ziehen lief schon über den Reducer und bleibt genau ein Rückgängig-Schritt.
  Regressionstests mit der Folge Drücken → Bewegen → Loslassen in einem Rendervorgang
  (`Leitungsplanung.test.tsx`, Wand und Decke, Decke mit Fang auf den Übergang); beide schlagen ohne die
  Korrektur fehl. Der Zieh-Test besteht auch ohne sie und sichert den einen Rückgängig-Schritt ab.
* **B – Steigwegbeschriftungen:** Unter 120 px/m zeigt der Grundriss am Halt keinen Namen und an der
  Fortsetzung nur einen Pfeil (↑/↓ zum anderen Geschoss). Ausgeschrieben bleibt die Angabe bei großem
  Maßstab, am gewählten Wegpunkt (auch per Tastatur über die Wegpunktliste wählbar), als Titel, in der
  Wegpunktliste und im Seitenfeld („Steighalte auf diesem Geschoss: S1“). Test bei kleinem Maßstab;
  optisch im Browser bei 29 px/m und 375 px geprüft: Raum- und Maßtexte lesbar, nur Haltquadrat und
  Punktmarke liegen weiterhin nahe am Raumnamen, weil der Halt dort liegt.
* **C – Dokumentation** der Kamera-Rückkehr präzisiert (§20.5 Punkt 6).
* **Prüfung vor dem Checkpoint:** Frontend 97 Dateien, 1 132 Tests grün; Typecheck, ESLint, Modulgrenzen, Build grün;
  Backend unverändert.

## 21. Umsetzungsstand 6b.6 (2026-10-14)

**Status:** technisch umgesetzt und geprüft (Gesamtlauf gegen PostgreSQL und MinIO, Abnahme im laufenden
Stack), mit dem Checkpoint vom 2026-10-15 committet. Damit ist **Phase 6 technisch umgesetzt und geprüft; die manuelle
Gesamtprüfung durch den Auftraggeber steht aus** (Prüfliste: [`phase-6-pruefliste.md`](phase-6-pruefliste.md)).
Keine Migration; neuer Lese-Endpunkt; Material, Artikel, Preise und Kalkulation bleiben Phase 7+.

### 21.1 Endpunkt und Architektur

`GET /api/v1/modules/electrical/buildings/{building_id}/cabling-summary` (`getElectricalCablingSummary`,
Recht `electrical.plan.read`). Aggregation in `electrical/cabling_summary.py` (rein) auf Basis des
vorhandenen Ladezustands (`CableStateLoader`, feste Zahl gebündelter Abfragen – keine Kette je
Leitung), der Ergebnisse von `analyse_cable` und der Trassen aus `derive_traces`. **Keine zweite
Berechnung, nichts gespeichert.** Gerätezuordnungen in einer zusätzlichen Abfrage.

**Ein konsistenter Stand je Antwort:** Die Abfrage nimmt zuerst eine **geteilte** Sperre auf die
Projektzeile (`FOR SHARE`, neue generische Methode `FloorPlanningAccess.consistent_building_context` bzw.
`ProjectService.lock_project_for_reading` im Core – ohne Electrical-Bezug). Jeder Schreibvorgang sperrt das
Projekt zuerst exklusiv; ein laufender Schreibvorgang wird abgewartet, und bis zum Ende der Lesetransaktion
kann keiner committen. Keine Seiteneffekte, kein Schreibschutz (abgeschlossene und archivierte Projekte
bleiben lesbar). Fremder Mandant oder unbekanntes Gebäude: `404`.

### 21.2 Zählweise (verbindlich)

| Menge | Regel |
|---|---|
| Gruppen | nach den **tatsächlichen** Angaben der Leitung (`cable_type`, `conductor_count`, `cross_section_mm2` als `Decimal`: `1.5` = `1.50`); der Stromkreisvorschlag spielt keine Rolle |
| Status je Gruppe | **bestätigt** (Anzahl, Weg, Zugaben, Summe = `length_mm`), **offen** und **Konflikt** (Anzahl, Weg, Zugaben, Teilsumme = `known_mm`) – getrennt, nie in die bestätigte Summe |
| Zugaben | genau einmal je Leitung, getrennt vom Weg ausgewiesen; keine Trasse |
| Unvollständig spezifiziert | Leitung mit fehlender Angabe – eigene Liste mit vorhandenen Angaben, fehlenden Feldern, Status und Länge; nie in einer Gruppe; Summen nur über vollständig angegebene Leitungen |
| Trassen | `derive_traces` zweimal: nur bestätigte Leitungen („bestätigt“) und alle gültigen Teilstrecken aller Leitungen („mit vorläufigen Teilen“); gemeinsame Abschnitte einmal, Leitungsmeter je Leitung; Wand, Decke, Fußboden, Steigweg, Schachtfortsetzung getrennt; Steigweg mit unbestätigter Höhe nur bekannter Teil und ausdrücklich so gekennzeichnet |
| Durchführungen | nach Identität (alle des Gebäudes), genutzt = von einem gespeicherten Wegpunkt referenziert, mit den nutzenden Leitungen; einmal gezählt |
| Bodenübergänge | **Nutzungen** je Leitung und Öffnung (auch „Öffnung entfernt“); keine Stückzahl von Bauteilen |
| Geräte | je Stromkreis und Typ (Stück); zugeordnet ohne Leitung = weder Start- noch Endgerät einer Leitung; nicht zugeordnet = nur zuordenbare Kategorien (keine Datendosen, kein Lagegerät einer Verteilung) – ohne Aussage über die elektrische Ausführung |

### 21.3 Oberfläche

Ansicht **„Mengen“** im Tab „Räume & Grundriss“ (gebäudebezogen, `mengen/Mengenuebersicht.tsx`):
Bezug (Gebäude, gespeicherter Stand, Hinweis auf einen offenen Entwurf – er ist nicht enthalten und wird
weder gespeichert noch verworfen), Leitungsmengen je Gruppe mit Summe, aufklappbar bis zur Leitung,
„Unvollständig spezifiziert“ mit konkret fehlender Angabe, „Noch offen oder im Konflikt“ mit Befundtexten,
Trassen- und Leitungsmeter je Fläche, Durchführungen (Stück) und Bodenübergänge (Nutzungen), Geräte je
Stromkreis, nicht zugeordnete Geräte, Modellgrenzen. „Bearbeiten“ öffnet den Leitungsentwurf im Grundriss
des Geschosses ihres ersten Laufs (Werkzeug „Leitung“); ein anderer offener Entwurf sperrt mit Grund.
„Zurück zur Mengenübersicht“ behält die aufgeklappten Gruppen. Laden, Fehler („keine Mengen“, nie „0“)
und leere Zustände getrennt; Abfrage `staleTime 0`, zusätzlich nach jedem Leitungsschreibvorgang
invalidiert; sitzungsgebundener Query-Client. Einheiten: Längen in der persönlichen Einheit, Geräte und
Durchführungen in Stück, Querschnitt in mm².

### 21.4 Tests

Backend (PostgreSQL): `test_electrical_cabling_summary.py` – Gruppen nach tatsächlichen Angaben inkl.
`1.5`/`1.50`, unvollständig spezifiziert bei bestätigter Geometrie, offen und Konflikt außerhalb der
bestätigten Summe, Zugaben einmal, bestätigte Unterbrechung (Tür entfernt) wechselt in den Konfliktbereich
(3 600 mm Teilsumme), Änderung und Löschung einer Leitung, unveränderte Angaben nach Vorschlagsänderung,
drei Leitungen mit 4 000 mm Trasse und 10 000 mm Leitungsmetern samt teilweiser Überdeckung, zweitem
Stromkreis und getrennter Fußbodenfläche, gemeinsamer Steigweganteil einmal (1 450 / 2 900 mm), vorläufige
Teilstrecken getrennt, genutzte/ungenutzte Durchführung, Bodenübergang als Nutzung, Geräte (nicht
zugeordnet, ohne Leitung, Datendose), keine Seiteneffekte, abgeschlossenes Projekt lesbar, fehlende Rechte
(`403`), unbekanntes Gebäude und fremder Betrieb (`404`). `test_cabling_summary_concurrency.py` – über
`lock_timeout` deterministisch: Die Übersicht liest nie an einem laufenden Schreibvorgang vorbei und
blockiert Schreibvorgänge bis zum Ende ihrer Transaktion. Frontend: `mengen/Mengenuebersicht.test.tsx`
(Anzeige, Einheiten mm/cm/m, Laden/Fehler, Aufschlüsselung, Bearbeiten und Rückkehr, Entwurfsschutz,
Sitzungswechsel), `Leitung3d.test.tsx` (Leitungstreffer bei Raumbearbeitung).

Gesamtlauf `tasks.ps1 check` gegen PostgreSQL und MinIO grün: Ruff, Format, mypy `--strict`, Modulgrenzen (4/4), ein Alembic-Head (`0013`), Lockfile, **1 331 Backendtests**, API-Client aktuell, Frontend-Typecheck, ESLint, **1 140 Frontendtests** (98 Dateien), Build. Zwei Zwischenläufe waren rot, weil Bestandstests die Liste der Modulbestandteile bzw. der Ansichten festschreiben – beide Listen um `cabling_summary` bzw. „Mengen“ ergänzt, keine Prüfung abgeschwächt.

Hinweis zum Beispiel §6.5: Die Tests bilden dessen Struktur (zwei Gruppen, abweichende Leiterzahl,
fehlender Querschnitt, offene Leitung) mit eigenen, von Hand hergeleiteten Längen nach; die Längen aus
§6.5 selbst sind illustrativ.

### 21.5 Abnahme im laufenden Stack (2026-10-14)

Docker Desktop nach einem Rechnerneustart regulär gestartet, Stack mit `docker compose up -d`; das
Backend-Image regulär neu gebaut und nur der Backend-Container neu gestartet (keine Migration, keine
Volumes oder Daten verändert); der Planner-Container nach Änderungen neu gestartet.

**Funktional (bestanden), Prüfprojekt PR-2026-0010:**

| Ablauf | Soll (von Hand) | Ist |
|---|---|---|
| NYM-J 3 × 1,5 bestätigt (L1 9 200, L2 5 200) | 14 400 mm, Weg 13 700 + Zugaben 700 | 1.440 cm, getrennt ausgewiesen |
| NYM-J 3 × 1,5 offen (L4) | Teilsumme 2 100 (2 000 + 100) | 210 cm |
| NYM-J 5 × 2,5 (L5 9 236, L6 12 036) | 21 272 mm | 2.127,2 cm |
| unvollständig spezifiziert (L3) | 8 284 mm, Querschnitt fehlt | wie erwartet |
| Steigweg-Trasse / -Leitungsmeter | 5 600 / 8 400 mm | 560 / 840 cm |
| Fußboden-Trasse / -Leitungsmeter | 12 856 / 14 856 mm | 1.285,6 / 1.485,6 cm |
| Durchführung, Bodenübergang, nicht zugeordnet | 1 Stück, 1 Nutzung, 1 Steckdose (keine Netzwerkdose) | wie erwartet |
| L3 über „Bearbeiten“ ergänzt (Querschnitt 1,5), gespeichert | Gruppe 22 684 mm, unvollständig 0 | 2.268,4 cm, 0 |
| Durchgang im Grundriss entfernt → Rückfrage nennt L3 → bestätigt | L3 Konflikt, Teilsumme 6 400; bestätigt wieder 14 400 | wie erwartet, Übergang „Öffnung entfernt“ |
| Konflikt aus der Übersicht in der Bearbeitung geöffnet, zurück | Befund im Entwurf, Gruppe aufgeklappt | wie erwartet |
| Neu laden und vergleichen | Summe 35 672 mm | 3.567,2 cm |

**Optisch:** helles Theme bei 375 px (Kopf, umbrechende Ansichtsleiste, Mengentabelle scrollt im Rahmen),
dunkles Theme (vorübergehend gesetztes Theme-Attribut, keine gespeicherte Einstellung) lesbar. Die Einheiten
mm/m sind durch Komponententests belegt, nicht optisch im Browser.

**Behobene Befunde der Abnahme:**

1. Im Grundriss verdeckte die Trefferfläche gespeicherter Leitungen Wände und Öffnungen (Durchgang mit
   Bodenübergang nicht wählbar) → bei Raumbearbeitung lassen Leitungen Klicks durch (Regressionstest).
2. Die Ansichtsleiste brach mit der sechsten Ansicht bei schmaler Breite nicht um (Überbreite schon mit
   „Stromkreise“) → umbrechend wie die übrigen Reiterleisten.
3. Mengenzellen wurden schmal Wort für Wort umbrochen → Mindestbreite, die Tabelle scrollt im Rahmen.

### 21.6 Prüfprojekt und Prüfliste

**PR-2026-0010 „Gesamtprüfung Phase 6 (synthetisch)“** (Kunde „Synthetik Phase 6“): EG/OG/DG mit
bestätigten Höhen; Diele mit Tür zur Küche (gemeinsame Bauwand) und Durchgang zum Bad; Flur OG, Studio DG;
Steigweg S1 mit drei Halten; UV1, F1/F2; L1 (Durchführung), L2 (`1.50`), L3 (Bodenübergang am Durchgang,
nach der Abnahme mit Querschnitt und im Konflikt), L4 (offen), L5 EG → OG, L6 EG → DG (Zwischenhalt
durchfahren); eine nicht zugeordnete Steckdose, eine Netzwerkdose. Prüfliste für die manuelle
Gesamtprüfung: [`phase-6-pruefliste.md`](phase-6-pruefliste.md).

### 21.7 Grenzen

* Keine Meter-Darstellung als `Decimal`-String und kein Export/Druck (Phase 7 bzw. nicht beauftragt).
* Servermeldungen einzelner Befunde in Rückfragen enthalten Umschreibungen ohne Umlaute
  („Bodenuebergang ohne Tuer …“) – vorhandener Stand aus 6b.3, nicht geändert.
* Echte Touch-Bedienung nicht prüfbar.

## 14. Ausdrücklich nicht in 6b

Materialstamm, Artikel, Preise, Kalkulation, `MaterialRequirement`-Drafts, Arbeitszeiten (Phase
7/8) · automatische Dimensionierung, Spannungsfall, Selektivität, Normprüfung, Konformitätsaussagen,
KI-Auslegung · automatische Wegfindung · gebäudeübergreifende, Außen- und Erdleitungen ·
Estrich-/Schichtenmodell, Leerrohre, Fußbodenheizung · Unterqueren geschlossener Wände (D11) ·
Durchführungen durch getrennte Wände · mehrere Stromkreise in einer Leitung · freie 3D-Bearbeitung ·
Stromlauf-/Schaltplan · Druck/PDF.
