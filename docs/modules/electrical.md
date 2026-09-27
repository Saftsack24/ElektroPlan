# Modul: electrical (Elektroplanung)

Art: Fachmodul · Präfix: `electrical_` · Status: **Raummodell umgesetzt (Phase 3)**,
**grafischer 2D-Editor umgesetzt (Phase 4a)**, 3D-Ansicht (4b) und
Geräte/Stromkreise/Leitungswege geplant (Phasen 5–6)
Abhängig von: **Phasen 3–6 nur `core`** · ab Phase 7 zusätzlich `materials`

> Die Module Registry verweigert den Start bei einer Abhängigkeit auf ein nicht
> registriertes Modul. `materials` entsteht erst in Phase 7 — bis dahin wird
> `electrical` mit `depends_on = ("core",)` registriert, und die Provider-Ports
> bleiben unimplementiert. Ein leeres Platzhaltermodul wird nicht angelegt.

---

## 1. Zweck

Technische Planung der Elektroinstallation eines Projekts: Räume, Wände, Öffnungen,
Elektroelemente, Verteilungen, Stromkreise und Leitungswege. Das Modul liefert den
**technischen Bedarf** — Material und Arbeitszeit — an die Plattform.

## 2. Abgrenzung

| Das Modul … | … tut es nicht |
|---|---|
| beschreibt Geometrie und Technik | kennt keine Preise, keine Margen, keine Stundensätze |
| erzeugt Bedarfs-Drafts | schreibt keine `material_requirements` selbst |
| berechnet Leitungslängen | bucht keine Bestände |
| schlägt Angebotspositionen vor | erzeugt keine Angebote |
| bildet Stromkreise ab | **prüft keine Normkonformität und dimensioniert keine Schutzorgane** |

Die letzte Zeile ist eine bewusste Sicherheitsgrenze (siehe `docs/security.md`, Abs. 17).

---

## 3. Koordinatensystem

Verbindlich seit [ADR 0013](../decisions/0013-room-contour-as-ordered-wall-segments.md).

- Kartesisches System **je Geschoss**. Ursprung `(0,0)` frei wählbar (üblicherweise die
  linke untere Ecke des Grundrisses).
- **x** nach rechts, **y** in der Draufsicht nach oben; **z** in der Höhe. Alles in
  ganzzahligen Millimetern (ADR 0007), Spaltensuffix `_mm`.
- `z = 0` ist der Fertigfußboden des jeweiligen Geschosses.
  Die absolute Höhe ergibt sich aus `floors.elevation_mm + z`.
- Positiver Umlauf- und Drehsinn mathematisch (gegen den Uhrzeigersinn),
  `rotation_deg` ganzzahlig.
- In Phase 3 kommt `z` **nicht** vor: Das Raummodell ist zweidimensional, die Höhe
  kommt mit den Leitungswegen (ADR 0010).
- Keine geografischen Koordinaten, keine Transformationsmatrix, kein PostGIS.

**Längen- und Flächenrundung** (verbindlich, ADR 0013): Streckenlängen werden
kaufmännisch auf ganze Millimeter gerundet, rein ganzzahlig über
`(isqrt(4·(dx²+dy²)) + 1) // 2`. **Jeder** Vergleich läuft gegen diesen gerundeten Wert —
insbesondere die Frage, ob eine Öffnung in ihre Wand passt. Flächen entstehen aus der
doppelten Gauß-Trapezfläche und werden erst am Ende halbiert. Eine einzige Funktion
(`geometry.py::segment_length_mm`) bedient Backend, Tests und späteren Editor.

---

## 4. Entitäten

### `electrical_rooms` — umgesetzt (Phase 3)
Raum auf **genau einem** Geschoss: Name, optionale Raumnummer (je Geschoss eindeutig),
optionale Raumhöhe. Ohne eigene Höhe gilt `floors.default_ceiling_height_mm`.

**Kein Polygonfeld.** Die Kontur **sind** die geordneten Wände des Raums. Fläche, Umfang,
Wandzahl und Konturzustand werden berechnet und nicht gespeichert (ADR 0013).

**Validierung:** Höhe zwischen 1500 und 6000 mm; die Konturregeln siehe unten.

Der Raumtyp (`living`, `kitchen`, …) ist **noch nicht** angelegt: Er wird erst mit den
Ausstattungsvorlagen gebraucht (offener Punkt 1).

### `electrical_walls` — umgesetzt (Phase 3)
**Gerichtetes** Wandsegment eines Raums: `(x1_mm, y1_mm) → (x2_mm, y2_mm)`, Wandstärke und
`sort_order` als Position in der Raumkontur (ab 0, lückenlos, je Raum eindeutig). Die
Richtung ist fachlich bedeutsam — `offset_mm` einer Öffnung zählt vom Startpunkt.

Eine Wand gehört **immer** zu einem Raum. Wandhöhe und Wandtyp (`exterior`, `interior`,
`partition`) sind noch nicht angelegt; Phase 3 braucht sie nicht, und die Raumhöhe gilt.

### `electrical_openings` — umgesetzt (Phase 3)
Tür, Fenster oder Durchgang an einer Wand (`kind`), beschrieben über den Abstand vom
Wandanfang (`offset_mm`), Breite, Höhe und Brüstungshöhe. Türen und Fenster sind
zusammengefasst, weil Geometrie und Bearbeitung identisch sind.

Ein Fenster verlangt eine Brüstungshöhe > 0; Tür und Durchgang haben `0`.

### Geometrieinvarianten (Phase 3)

Zwei Stufen, weil eine Kontur schrittweise entsteht (ADR 0013):

| Stufe | Wann geprüft | Regeln |
|---|---|---|
| **Entwurf** | bei **jedem** Schreibvorgang | Start ≠ Endpunkt · Koordinaten in ±1 km · Länge 100 mm bis 100 m · Wandstärke 20–1000 mm · Reihenfolge je Raum eindeutig · keine doppelte Strecke · keine Überschneidung und keine Berührung zweier Wände außer im gemeinsamen Punkt zyklischer Nachbarn |
| **Geschlossene Kontur** | im Prüfbericht `GET …/rooms/{id}/contour` | mindestens 3 Wände · jede Wand endet, wo die nächste beginnt · die letzte endet am Anfang der ersten · Fläche ≠ 0 |

**Unvollständige Kontur ist ein zulässiger Zustand.** Wer eine Wand nach der anderen
erfasst, hat zwischendurch eine offene Kontur — das ist kein Fehler. Der Konturzustand
(`draft` / `valid`) ist **abgeleitet** und nicht gespeichert; es gibt deshalb keinen
Abschlussvorgang, der ihn festschreibt, sondern nur einen wiederholbaren Prüfbericht.

**Öffnungen:** Breite und Höhe > 0, Abstand ≥ 0, Öffnung vollständig innerhalb der
(gerundeten) Wandlänge, keine Überlappung mit einer anderen Öffnung derselben Wand.
**Berührung an einer Kante ist ausdrücklich erlaubt** — zwei Türen mit gemeinsamem
Rahmenpfosten sind übliche Praxis. Unterkante + Höhe darf die geltende Raumhöhe nicht
überschreiten.

**Folgen einer Änderung:** Würde eine Wandänderung oder eine neue Raumhöhe eine
vorhandene Öffnung ungültig machen, wird die Änderung mit `422` **abgelehnt** und die
betroffene Öffnung benannt. Eine Tür wird nicht stillschweigend ungültig.

**Löschregeln:**

| Vorgang | Verhalten |
|---|---|
| Raum löschen | Wände und Öffnungen gehen mit (`CASCADE`) — eine Wand ohne Raum hat keine Bedeutung |
| Wand mit Öffnungen löschen | `409` — zuerst die Öffnungen entfernen |
| Wand ohne Öffnungen löschen | erlaubt; die Reihenfolge wird lückenlos nachgezogen |
| Geschoss mit Räumen löschen | `409` (Fremdschlüssel `RESTRICT`, vom Core übersetzt) |

**Nebenläufigkeit:** Jede Änderung an einer Kontur sperrt zuerst die Projektzeile, dann
die Raumzeile (`SELECT … FOR UPDATE`). Zwei gleichzeitige Anfragen können damit keine
gemeinsam ungültige Kontur erzeugen.

**Raumversion = Version der Raumgeometrie (seit Phase 4a, ADR 0014).** Jede wirksame
Änderung an Wänden oder Öffnungen eines Raums zählt die Raumversion weiter — über die
Einzelendpunkte ebenso wie über `PUT …/contour`, dort genau einmal je Vorgang. Nur so
bemerkt der grafische Editor eine zwischenzeitliche Formularänderung als
Versionskonflikt, statt sie zu überschreiben. Wand- und Öffnungsversionen bleiben
unverändert in Kraft; eine beim Konturspeichern unveränderte Wand behält ihre Version.

**Neulesen nach der Sperre:** Wand und Öffnung werden zuerst ungesperrt aufgelöst (sie
nennen erst den Raum). Nach der Sperre werden sie neu gelesen; wer auf die Sperre
gewartet hat, prüft also gegen den aktuellen Stand und erhält einen Versionskonflikt
statt eines irreführenden Geometriefehlers (Befund der Parallelitätstests in Phase 4a).

### `electrical_device_types`
Katalog der Elementtypen: Steckdose, Doppelsteckdose, Schalter, Wechselschalter, Taster,
Leuchtenauslass, Netzwerkdose, Abzweigdose, Bewegungsmelder, Unterverteilung.
Je Typ: Standard-Montagehöhe, Symbolschlüssel, Standard-ServiceTemplate.
Systemtypen werden als Seed ausgeliefert; die Organisation kann eigene ergänzen.

### `electrical_devices`
Konkretes Element im Raum: Position (`x_mm`, `y_mm`), Montagehöhe, Drehung, optionale
Wandzuordnung, Stromkreis, abweichendes ServiceTemplate, freie `properties` (JSONB).

### `electrical_distribution_boards`
Verteilungen mit Code (`HV`, `UV1`, …), Standort und Hauptabsicherung.

### `electrical_circuits`
Stromkreis: Nummer, Bezeichnung, Verteilung, Leitungstyp, Querschnitt, Schutzorgantyp und
-nennstrom, RCD-Gruppe, Phasenzahl. **Werte werden erfasst, nicht berechnet.**

### `electrical_cable_routes` und `electrical_cable_route_points`
Leitungsweg zwischen zwei Punkten (Verteilung ↔ Gerät, Gerät ↔ Gerät) mit Zone,
Verlegeart und normalisierter Punktliste. Gespeichert werden `computed_length_mm`
(Geometrie) und `allowance_mm` (Zugaben) getrennt.

---

## 5. Installationszonen und Längenberechnung

Der zentrale Mechanismus des MVP (siehe
[ADR 0010](../decisions/0010-2d-first-editor-with-installation-zones.md)): Der Weg wird in
2D gezeichnet, die Höhe ergibt sich aus der Zone.

| `zone_key` | Höhe (Standard) |
|---|---|
| `horizontal_lower` | 300 mm über FFB |
| `horizontal_middle` | 1050 mm |
| `horizontal_upper` | 300 mm unter Rohdecke |
| `vertical` | senkrecht zum Gerät |
| `ceiling` | Raumhöhe |
| `floor` | 0 mm |
| `custom` | freie Eingabe |

### Formel

```
computed_length_mm = Σ_i  round( sqrt( (x₂−x₁)² + (y₂−y₁)² + (z₂−z₁)² ) )
allowance_mm       = Zugabe(Startpunkt) + Zugabe(Endpunkt)
total_length_mm    = computed_length_mm + allowance_mm
```

Standardzugaben (konfigurierbar): 200 mm je Geräteanschluss, 500 mm je Verteilung.

### Beispiel

Verteilung `UV1` in der Diele bei `(500, 500)`, Montagehöhe 1400 mm.
Steckdose in der Küche bei `(4200, 2600)`, Montagehöhe 300 mm.
Zone `horizontal_upper`, Raumhöhe 2500 mm → Zonenhöhe 2200 mm.

| Segment | Berechnung | Länge |
|---|---|---|
| Aufstieg Verteilung → Zone | 2200 − 1400 | 800 mm |
| waagerecht in der Zone | Polygonzug (500,500) → (4200,500) → (4200,2600) | 5800 mm |
| Abstieg Zone → Steckdose | 2200 − 300 | 1900 mm |
| **computed_length_mm** | | **8500 mm** |
| Zugaben | 500 (UV) + 200 (Gerät) | 700 mm |
| **total_length_mm** | | **9200 mm = 9,200 m** |

Die Berechnung ist vollständig ganzzahlig und damit exakt reproduzierbar — Grundlage der
Tests aus §39 des Masterplans.

---

## 6. Erzeugter Bedarf (Provider) — ab Phase 7

### `ElectricalMaterialProvider`

| Quelle | Ergebnis |
|---|---|
| jedes `electrical_device` | Draft mit `service_template_id` (aus Gerät oder Gerätetyp), Menge 1 Stück |
| jeder `electrical_cable_route` | Draft mit dem Material des Leitungstyps, Menge = `total_length_mm / 1000` m |
| jede Verteilung | Draft mit dem ServiceTemplate der Verteilung |

**Doppelzählungsschutz:** Leitungsmaterial entsteht **ausschließlich** aus
`source_entity_type = "cable_route"`. Ein ServiceTemplate mit `includes_cable = true` wird
von der Material Engine beanstandet, sobald für dasselbe Projekt Leitungswege existieren.

### `ElectricalLaborProvider`

Arbeitszeit je Gerät aus dem ServiceTemplate (`labor_minutes`), Arbeitszeit je Leitung aus
Meter × Minuten-pro-Meter des Verlegeart-Schlüssels.

---

## 7. Permissions

| Key | Bedeutung | Stand |
|---|---|---|
| `electrical.plan.read` | Planung ansehen | **registriert (Phase 3)** |
| `electrical.plan.write` | Räume, Wände, Öffnungen bearbeiten | **registriert (Phase 3)** |
| `electrical.device.write` | Elektroelemente bearbeiten | ab Phase 5 |
| `electrical.circuit.write` | Stromkreise und Verteilungen bearbeiten | ab Phase 6 |
| `electrical.route.write` | Leitungswege bearbeiten | ab Phase 6 |
| `electrical.settings.write` | Gerätetypen und Zonen-Standardwerte pflegen | ab Phase 5 |

Phase 3 registriert bewusst nur **zwei** Schlüssel: ansehen und bearbeiten. Wer die
Kontur eines Raums erfassen darf, darf auch die Öffnungen darin erfassen — eine feinere
Trennung hätte keinen Nutzen und wäre nicht pflegbar. Die weiteren Schlüssel entstehen
mit der Phase, die sie braucht.

Die Verteilung an die ausgelieferten Systemrollen steht im Modul selbst
(`PermissionDef.default_roles`): `plan.read` für Planer, Kalkulator und Monteur,
`plan.write` für den Planer. Der Administrator erhält ohnehin jede registrierte
Berechtigung. Der Core kennt dabei keine Modulschlüssel; er liest sie aus der Registry.

---

## 8. Events

**Erzeugt:** `electrical.plan.updated` (**ab Phase 3**),
`electrical.circuit.changed` (ab Phase 6)
**Konsumiert:** keine

Beide Events sind reine Benachrichtigungen ("Materialbedarf könnte veraltet sein").
Die verbindliche Neuberechnung läuft über den Recompute-Endpunkt des Materialmoduls.

`electrical.plan.updated` entsteht in Phase 3 bei jeder wirksamen Änderung am Raummodell.
`change_kind` unterscheidet `room_created`, `room_updated`, `room_deleted`,
`walls_changed` und `openings_changed`. Nutzlast: `project_id`, `floor_id`, `room_id`,
`change_kind` — nur IDs und ein Schlüssel, keine Namen, keine Raumnummern.

Seit Phase 4a: Das atomare Konturspeichern (`PUT …/contour`) erzeugt **genau ein**
`walls_changed` — auch wenn es Öffnungen mitändert —, das Anlegen eines Raums samt
Wänden nur `room_created`. Abgelehnte Vorgänge erzeugen kein Event.

**Grenzen, ausdrücklich:** Die Zustellung ist *at most once*, und `domain_events` ist
keine transaktionale Outbox (ADR 0012). In Phase 3 gibt es **keinen** Empfänger;
`materials` entsteht erst in Phase 7. Bis dahin ist der Nutzen die Nachvollziehbarkeit im
Ereignisprotokoll. Der reine Konturbericht erzeugt **kein** Event: Er ändert nichts, und
ein Event ist eine Tatsache.

---

## 9. API

### Umgesetzt (Phase 3)

Alle Pfade unter `/api/v1/modules/electrical`. Änderungen an versionierten Entitäten
verlangen `If-Match` (docs/api.md, Abschnitt 5).

```
GET    /floors/{floor_id}/rooms            Räume des Geschosses
POST   /floors/{floor_id}/rooms            Raum anlegen
GET    /rooms/{room_id}
PATCH  /rooms/{room_id}                    If-Match
DELETE /rooms/{room_id}                    If-Match  (Hard Delete, kaskadiert)
GET    /rooms/{room_id}/contour            Prüfbericht der Kontur (reine Auskunft)
GET    /rooms/{room_id}/walls              in Konturreihenfolge
POST   /rooms/{room_id}/walls              hängt hinten an
POST   /rooms/{room_id}/walls/reorder      If-Match (Version des **Raums**)
PATCH  /walls/{wall_id}                    If-Match
DELETE /walls/{wall_id}                    If-Match  (409, falls Öffnungen vorhanden)
GET    /walls/{wall_id}/openings
POST   /walls/{wall_id}/openings
PATCH  /openings/{opening_id}              If-Match
DELETE /openings/{opening_id}              If-Match
```

### Ergänzt in Phase 4a

```
GET    /floors/{floor_id}/plan             Planungsstand eines Geschosses (Räume, Wände, Öffnungen)
PUT    /rooms/{room_id}/contour            If-Match (Raumversion) - Raumgeometrie atomar ersetzen
POST   /floors/{floor_id}/rooms            nimmt optional `walls` - Raum samt Kontur atomar anlegen
```

**`GET …/plan`** liefert je Raum die gespeicherten Werte, die berechnete Kontur (Fläche,
Umfang, Zustand, Einzelbefunde mit Wand-IDs), die Wände in Konturreihenfolge mit Länge
und Version und je Wand die Öffnungen. Sechs Abfragen, unabhängig von der Raumzahl (drei
für den Geschosskontext im Core, je eine für Räume, Wände, Öffnungen) — ein Test
vergleicht die Abfragezahl für einen und sieben Räume. Lesbar mit `electrical.plan.read`,
auch bei archivierten Projekten. Bewusst **geschossbezogen** statt des in Phase 0
skizzierten `GET /projects/{id}/plan` (ADR 0014).

**`PUT …/contour`** nimmt den vollständigen Zielzustand:

```json
{
  "walls": [
    { "id": "…", "x1_mm": 0, "y1_mm": 0, "x2_mm": 5000, "y2_mm": 0, "thickness_mm": 115,
      "openings": [ { "id": "…", "kind": "door", "offset_mm": 1000, "width_mm": 885,
                      "height_mm": 2010, "sill_height_mm": 0 } ] }
  ],
  "removed_opening_ids": []
}
```

| Regel | Antwort bei Verstoß |
|---|---|
| Listenposition = `sort_order`; bekannte IDs ändern, neue/fehlende IDs anlegen, fehlende Wände entfernen | — |
| doppelte Wand- oder Öffnungs-ID | `422 wall-id-duplicate` / `opening-id-duplicate` |
| ID gehört zu einem anderen Raum (oder Mandanten) | `422 wall-foreign` / `opening-foreign` |
| Öffnung wechselt die Wand | `422 opening-wall-changed` |
| zu entfernende Wand trägt noch Öffnungen, die nicht in `removed_opening_ids` stehen | `409 wall-has-openings` |
| vorhandene Öffnung fehlt ohne ausdrückliche Entfernung | `422 opening-missing` |
| Zielzustand verletzt Entwurfs- oder Öffnungsregeln | `422` mit den bekannten Codes |
| `If-Match` fehlt / ungültig / veraltet | `428` / `428` / `409 version-conflict` |
| Projekt archiviert | `409 project-archived` |

Jeder Befund trägt in `errors[].keys` die IDs der betroffenen Wände oder Öffnungen.
Geprüft wird der Zielzustand **als Ganzes**; geschrieben wird in einer Transaktion;
bei jedem Fehler bleibt der Raum unverändert (Wände, Reihenfolge, Öffnungen, Version).
Erfolg: Raumversion genau einmal weiter, genau ein Event `walls_changed`, Antwort ist der
gespeicherte Stand im Format des Plans.

Die Reihenfolge beim Umordnen (`POST …/walls/reorder`) wird als **vollständige**
Permutation gesetzt; eine Teilliste wäre mehrdeutig. `sort_order` nimmt der Server selbst — `POST …/walls` hängt die Wand hinten
an, damit keine Anfrage eine Lücke oder Dublette erzeugen kann.

Es gibt **keine** Cursor-Pagination: Ein Geschoss hat Räume in zweistelliger Anzahl, ein
Raum Wände in einstelliger. Die Sortierung ist trotzdem deterministisch (Raumnummer, dann
Name, dann ID; Wände nach `sort_order`, dann ID).

### Geplant (Phasen 5–6)

```
POST   /rooms/{room_id}/devices
GET    /projects/{project_id}/circuits
POST   /projects/{project_id}/cable-routes
PUT    /cable-routes/{route_id}/points   (gesamte Punktliste)
GET    /projects/{project_id}/summary    Mengenübersicht
```

Punktlisten werden als Ganzes ersetzt (`PUT`), nicht punktweise gepatcht — wie die
Raumkontur seit Phase 4a.

---

## 10. Editor

### 2D-Editor (Phase 4a) — umgesetzt

Projekt-Tab „Räume & Grundriss" mit zwei Ansichten auf **denselben** Serverstand:
„Grafischer Editor" (Standard) und „Tabellen & Details" (die Formulare aus Phase 3). Die
zuletzt gewählte Ansicht merkt sich der Browser. Code:
`apps/planner/src/modules/electrical/editor/`. Entscheidung: [ADR 0014](../decisions/0014-2d-editor-svg-and-atomic-contour.md).

**Darstellung:** SVG ohne Zusatzbibliothek. Die Geometrie liegt in einer transformierten
Gruppe; Maßtexte, Raumnamen, Eckgriffe, Raster und Vorschau im Bildraum. Wände werden in
ihrer Stärke gezeichnet, Öffnungen als Lücke mit einfacher Markierung (Tür:
durchgezogen, Fenster: gestrichelt blau, Durchgang: gestrichelt grau). Kein Türanschlag
und keine Fenstergrafik — fachlich nicht definiert. Keine Electrical-Device-Symbole
(offene Entscheidung T1, vor Phase 5). Wandlängen in Metern mit drei Nachkommastellen
(= Millimeter), zu kurze Wände bleiben unbeschriftet.

**Koordinaten:** Welt (ganze mm, y nach oben) · Viewport (px/mm, Ursprung) · Bild (px).
Reine Funktionen in `viewport.ts`; Zoom und Pan ändern nie Geometrie. Maßstab 0,005 bis
2 px/mm; Zoom um den Zeiger (Mausrad) oder die Mitte (Schaltflächen, `+`/`−`); Pan per
Werkzeug „Verschieben" (`H`) oder mittlerer Maustaste; „Einpassen" (`F`) auf alle Räume.
Eine Größenänderung hält Maßstab und Mitte.

**Raster und Fang (`fang.ts`):** Raster 10/50/100/250/500 mm, Standard 100 mm. Fang auf
Wandendpunkte vor Raster; der Fangradius (12 px) wird in Bildschirmpixeln beurteilt, das
Ergebnis liegt exakt auf dem Raster bzw. Endpunkt. Fang abschaltbar; `Alt` setzt ihn beim
Zeichnen und Ziehen vorübergehend aus. Das aktive Fangziel wird markiert und in der
Statuszeile genannt. Das angezeigte Raster wird bei kleinem Maßstab gröber, der Fang
nicht. Keine CAD-Constraints.

**Werkzeuge:** Auswählen (`V`), Verschieben (`H`), Rechteckraum (`R`: zwei Ecken, Name),
Polygonraum (`P`: Punkte; schließen per Klick auf den Startpunkt, Doppelklick oder
`Enter`; `Rücktaste`/`Strg+Z` entfernt den letzten Punkt, `Escape` bricht ab), Öffnung
(`O`: Art wählen, auf eine Wand klicken — die Mitte liegt unter dem Zeiger, der Abstand
zählt vom Anfang der **gerichteten** Wand und wird auf das Raster gefangen). Zeichnen
reagiert auf den **abgeschlossenen Klick**, damit der Namensdialog nicht den Rest
desselben Klicks abfängt. Eckpunkt ziehen verschiebt alle Wandenden an diesem Punkt —
bei geschlossener Kontur die beiden Nachbarwände, ohne Lücke. Öffnungen werden entlang
ihrer Wand gezogen. In der Seitenleiste: präzise Koordinaten, Länge, Stärke; Wand teilen,
Eckpunkt entfernen, Wand entfernen (nur ohne Öffnungen), Umlaufrichtung umkehren
(Öffnungsabstände werden auf das andere Wandende umgerechnet), Öffnungsart und -maße,
Öffnung entfernen (`Entf`).

**Editorzustand (`zustand.ts`):** ein Reducer. Getrennt: Serverstand (`basis`), lokaler
Entwurf, Auswahl, Werkzeug und laufende Zeichnung, Undo/Redo, Speicherstatus
(`sauber`, `geaendert`, `speichert`, `gespeichert`, `konflikt`, `validierung`, `fehler`),
Serverfehler. Der Viewport liegt bewusst außerhalb. Der Entwurf umfasst **einen** Raum;
neue Räume werden nach der Namensvergabe sofort angelegt (`POST …/rooms` mit `walls`).

**Undo/Redo:** nur ungespeicherte Entwurfsänderungen; eine Ziehbewegung ist ein Schritt;
Auswahl und Ansicht erzeugen keinen; ein neuer Schritt verwirft den Redo-Zweig; höchstens
100 Schritte; nach dem Speichern neue Basis. `Strg+Z`, `Strg+Y` oder `Strg+Umschalt+Z`
(auch `Cmd`). In Text- und Auswahlfeldern greifen die Kürzel nicht; `Strg+S` speichert
auch aus einem Feld der Seitenleiste.

**Speichern:** kein Autosave. „Speichern" (`Strg+S`) prüft minimal (nur ganze
Millimeter), ruft `PUT …/contour` mit der Raumversion auf und übernimmt die Antwort als
neue Basis. `409 version-conflict`: Entwurf bleibt, Hinweis mit zwei Wegen — „Serverstand
laden (lokale Änderungen verwerfen)" nach Rückfrage oder „Entwurf vorerst behalten".
`422` und `409 wall-has-openings`: Entwurf bleibt, deutsche Meldung je Fehlercode,
betroffene Wände und Öffnungen rot markiert (`keys`). Netzwerkfehler: Entwurf bleibt.
Rückmeldungen stehen in der Seitenleiste, damit die Zeichenfläche nicht springt.

**Nie stilles Verwerfen:** Raumwechsel mit ungespeicherten Änderungen fragt „jetzt
speichern und wechseln?" (sonst bleibt der Raum aktiv). Geschoss- und Ansichtswechsel
fragen nach dem Verwerfen. Neuladen und Schließen des Browsers: `beforeunload`.
Interne Links, Browser-Zurück und Browser-Vorwärts: fachneutraler
`core/ui/Navigationsschutz.tsx` auf dem Data-Router-Blocker (seit Phase 4a.1), genau eine
Rückfrage, bei Ablehnung bleiben URL, Entwurf und Undo-Historie erhalten. Projekt-
Tabwechsel und Abmelden: `core/ui/ungespeichert.ts` (`verlassenBestaetigen`).

**Lokale Prüfung als Bedienhilfe:** `geometrie.ts` spiegelt die Serverregeln (Länge,
Fläche, Entwurfs- und Konturregeln, Öffnungen). Überschneidungen im laufenden Polygonzug
werden sofort rot gezeigt, fehlerhafte Wände und Öffnungen im Entwurf orange. Die
Serverprüfung bleibt verbindlich. Gegen Drift prüfen Backend und Frontend dieselbe
versionierte Fixture `testdata/geometry/raumgeometrie.v1.json` (kein API-Vertrag).

**Berechtigungen:** Ansicht mit `electrical.plan.read`, Bearbeitung mit
`electrical.plan.write`. Ohne Schreibrecht oder bei archiviertem Projekt: nur Auswählen,
Verschieben, Zoom; keine Griffe, kein Speichern („Nur Ansicht").

**Barrierearmer Weg:** Die Ansicht „Tabellen & Details" bleibt vollständig nutzbar; die
Seitenleiste des Editors bietet alle Werte als Formular und die Raumliste als Knöpfe.

**Performance (gemessen 2026-09-26, Details in `docs/task-history.md`, Task 0014):** 200
Wandsegmente, 25 Öffnungen, Entwicklungsbuild: Eckpunkt ziehen Median 5 ms je
Zeigerbewegung (p95 17 ms), Zoomschritt Median 23 ms (p95 41 ms), Plan-Anfrage 62 ms.
Ein einzelner Lauf auf einem Rechner — keine allgemeine Zusage.

**Exit-Kriterium (gemessen, automatisierter Durchlauf):** Einfamilienhaus-Erdgeschoss mit
7 Räumen, 30 Wänden, 15 Öffnungen vom leeren Geschoss bis zum letzten erfolgreichen
Speichern in 126,7 s. Kein Usability-Test mit Menschen.

### 3D-Ansicht (Phase 4b) — geplant

Extrudierte Räume aus Kontur und Höhe, Wände, Öffnungen als Aussparungen, Geräte als
Symbole, Leitungswege als Linienzüge; Orbit, Zoom, Pan, Auswahl.
**Keine Geometriebearbeitung in 3D im MVP.**

Performance-Regel: Die Three.js-Szene wird **nicht** an den React-State gekoppelt.
React hält die fachlichen Daten, eine imperative Szenenschicht hält Objekte und wird über
gezielte Aktualisierungen synchronisiert.

### Ausdrücklich nicht in Phase 4a

Keine 3D-Ansicht, kein Three.js, keine Elektrogeräte oder Symbolbibliothek, keine
Leitungen, Stromkreise oder Installationszonen, keine Materialermittlung oder
Kalkulation, keine Grundrissimporte (PDF, DWG, Bild), keine Raumerkennung, kein AR, kein
Offline-Sync, kein gemeinsames Echtzeitbearbeiten, kein `materials`-Modul.

---

## 11. Ausdrücklich nicht in Phase 3

Kein 2D-Editor, kein Canvas, keine 3D-Darstellung, kein AR-Aufmaß, keine Elektrobauteile,
keine Stromkreise, keine Verteilerplanung, keine Leitungswege, keine Materialermittlung,
keine Kalkulation, kein Offline-Synchronisationsmechanismus und kein leeres
`materials`-Modul als Platzhalter.

Die Oberfläche der Phase 3 ist formular- und listenbasiert: Geschoss wählen, Räume
pflegen, Wände in ihrer Reihenfolge erfassen, Öffnungen pflegen, Konturzustand und
Geometriefehler lesen. Die Wandtabelle ist die Konturvorschau.

---

## 12. Offene Punkte

1. Ausstattungsvorlagen pro Raumtyp ("Küche Standard" setzt n Steckdosen) — sinnvoll, aber
   erst nach Phase 5 zu entscheiden.
2. Mehrgeschossige Steigezonen: Leitungswege über Geschossgrenzen brauchen einen
   definierten Übergabepunkt. Entwurf offen, Datenmodell erlaubt es bereits
   (Punkte tragen z, Route ist nicht an ein Geschoss gebunden).
3. Import bestehender Grundrisse (PDF/DWG) — nicht im MVP.
4. Symbolbibliothek: eigene SVG-Symbole oder Anlehnung an DIN EN 60617 — offene
   Entscheidung T1, **vor Phase 5** zu klären (Phase 4a platziert keine Geräte).
5. **Deckungsgleiche Wände benachbarter Räume (T9, verbindlich vor Phase 4b).** Jeder
   Raum besitzt seine eigene gerichtete Kontur (ADR 0013). Zwei Nachbarräume beschreiben
   dieselbe physische Wand deshalb geometrisch doppelt — mit eigener Richtung, Stärke und
   eigenen Öffnungen. Eine naive 3D-Extrusion erzeugte deckungsgleiche, sich
   durchdringende Wandkörper; eine Tür oder ein Durchgang zwischen zwei Räumen kann auf
   beiden Seiten unterschiedlich oder nur einseitig erfasst sein (im Messlauf der Phase 4a
   lagen Türen zwischen Räumen jeweils nur an einer Raumseite). Vor Phase 4b ist zu
   entscheiden: (a) der Renderer führt deckungsgleiche Wände zusammen (reine Darstellung,
   kein Modellwechsel), (b) eine zusätzliche physische Wandidentität, auf die sich beide
   Raumseiten beziehen, oder (c) ein anderes ausdrückliches Modell. Die Entscheidung
   betrifft auch Leitungswege (Phase 6), die Wände queren. Bis dahin: keine stille
   Datenmodelländerung, keine Migration.
6. Kanäle, Rohre und Verlegesysteme als eigene Materialposition je Meter — Entwurf mit
   Phase 7 abstimmen.
