# Phase 6b – Entwurf: Verteilungen, Stromkreise, Leitungen und Leitungslängen

**Status:** **2. Fassung, vom Auftraggeber als Umsetzungsgrundlage freigegeben (2026-10-11)** ·
D1, D2, D4, D5, D11 bestätigt · **6b.0 und 6b.1 umgesetzt** (technisch geprüft, Checkpoint vom 2026-10-12) ·
6b.2–6b.6 NOT STARTED · Umsetzungsstand: **§15, §16** (vor §14)
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
POST   /circuits/{id}/apply-proposal                          {cables: [{cable_id, version}]} – ausdrückliche Übertragung

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

## 14. Ausdrücklich nicht in 6b

Materialstamm, Artikel, Preise, Kalkulation, `MaterialRequirement`-Drafts, Arbeitszeiten (Phase
7/8) · automatische Dimensionierung, Spannungsfall, Selektivität, Normprüfung, Konformitätsaussagen,
KI-Auslegung · automatische Wegfindung · gebäudeübergreifende, Außen- und Erdleitungen ·
Estrich-/Schichtenmodell, Leerrohre, Fußbodenheizung · Unterqueren geschlossener Wände (D11) ·
Durchführungen durch getrennte Wände · mehrere Stromkreise in einer Leitung · freie 3D-Bearbeitung ·
Stromlauf-/Schaltplan · Druck/PDF.
