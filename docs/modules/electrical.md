# Modul: electrical (Elektroplanung)

Art: Fachmodul · Präfix: `electrical_` · Status: **Raummodell umgesetzt (Phase 3)**,
**grafischer 2D-Editor umgesetzt (Phase 4a)**, **abgeleitete 3D-Ansicht umgesetzt
(Phase 4b)**, Geräte/Stromkreise/Leitungswege geplant (Phasen 5–6)
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

Eine Wand gehört **immer** zu einem Raum. **Entschieden (T8, ADR 0016):** Es gibt keine
Wandhöhe und keinen gespeicherten Wandtyp. Die effektive Raumhöhe ist die Höhe aller
Wände des Raums; „gemeinsam/innen" und „außen" sind nur abgeleitete Darstellungsbegriffe.
Bauarten (Mauerwerk, Trockenbau …), Kniestock und Dachschräge sind spätere Fachkonzepte.

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

Projekt-Tab „Räume & Grundriss" mit Ansichten auf **denselben** Serverstand:
„2D-Editor" (Standard; bis Phase 4b „Grafischer Editor"), seit Phase 4b „3D-Ansicht" und
„Tabellen & Details" (die Formulare aus Phase 3). Die zuletzt gewählte Ansicht merkt sich
der Browser; unbekannte gespeicherte Werte fallen auf den 2D-Editor. Code:
`apps/planner/src/modules/electrical/editor/`. Entscheidung: [ADR 0014](../decisions/0014-2d-editor-svg-and-atomic-contour.md).

**Darstellung:** SVG ohne Zusatzbibliothek. Die Geometrie liegt in einer transformierten
Gruppe; Maßtexte, Raumnamen, Eckgriffe, Raster und Vorschau im Bildraum. Wände werden in
ihrer Stärke gezeichnet, Öffnungen als Lücke mit einfacher Markierung (Tür:
durchgezogen, Fenster: gestrichelt blau, Durchgang: gestrichelt grau). Kein Türanschlag
und keine Fenstergrafik — fachlich nicht definiert. Keine Electrical-Device-Symbole
(offene Entscheidung T1, vor Phase 5). Wandlängen in der persönlichen Anzeigeeinheit
(Standard Zentimeter, siehe „Maßeinheit" unten), zu kurze Wände bleiben unbeschriftet.

**Koordinaten:** Welt (ganze mm, y nach oben) · Viewport (px/mm, Ursprung) · Bild (px).
Reine Funktionen in `viewport.ts`; Zoom und Pan ändern nie Geometrie. Maßstab 0,005 bis
2 px/mm; Zoom um den Zeiger (Mausrad) oder die Mitte (Schaltflächen, `+`/`−`); Pan per
Werkzeug „Verschieben" (`H`) oder mittlerer Maustaste; „Ansicht zurücksetzen" (`F`,
seit der Bedienungsnacharbeit 1; vorher „Einpassen") setzt Zoom und Ausschnitt auf den
gesamten Grundriss zurück.
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

**Nie stilles Verwerfen:** Alle Rückfragen laufen über den eigenen, zentralen Dialog
(`core/ui/Rueckfrage.tsx`) – kein `window.confirm` mehr. Raumwechsel mit ungespeicherten
Änderungen bietet „Speichern und wechseln", „Änderungen verwerfen und fortfahren" und
„Beim Raum bleiben". Geschoss- und Ansichtswechsel, „Änderungen verwerfen" und
„Serverstand laden" fragen mit konkreter Situation; der Anfangsfokus liegt auf der
sicheren Wahl, Escape bricht ab, der Fokus kehrt zurück. Interne Links, Browser-Zurück
und -Vorwärts: fachneutraler `core/ui/Navigationsschutz.tsx` auf dem Data-Router-Blocker,
genau eine Rückfrage, bei Ablehnung bleiben URL, Entwurf und Undo-Historie erhalten.
Projekt-Tabwechsel und Abmelden: `useVerlassenBestaetigen`. **Einzige Ausnahme:**
Neuladen, Tab schließen oder Verlassen der Website zeigen weiter den **browsernativen**
Dialog (`beforeunload`) – Browser lassen dort keinen eigenen Dialog und keinen eigenen
Text zu.

**Maßeinheit (Bedienungsnacharbeit 1):** Gespeichert, übertragen und gerechnet wird
unverändert in ganzen Millimetern (`_mm`-Felder, SVG- und 3D-Geometrie). Angezeigt und
eingegeben wird in der persönlichen Einheit – Standard Zentimeter, wahlweise Millimeter
(„Einstellungen" in der Kopfleiste, lokal im Browser). Zentimeter akzeptieren Komma oder
Punkt und höchstens eine Nachkommastelle (`11,5` → 115 mm); feinere Werte werden
abgelehnt, nie gerundet. Umgerechnet wird ausschließlich in `core/masse.ts`; offene
Formulare rechnen ihre Eingabetexte bei einem Einheitenwechsel um. Flächen bleiben m².
Betroffen: Eigenschaften, Statuszeile, Maßtexte und Raster der Zeichenfläche,
Raum-/Wand-/Öffnungsdialoge, Tabellen, Geschosshöhen im Core-Strukturtab, 3D-Seitenleiste
und 3D-Hinweistexte. **Seit 4b.2 je Benutzer:** gespeichert unter
`elektroplan.masseinheit.<user_id>`; zwei Benutzer desselben Browsers haben getrennte
Einheiten, ein Betriebswechsel behält die Wahl, beim Laden und nach dem Abmelden gilt der
Standard. Der frühere browserweite Schlüssel wird beim ersten Anmelden einmalig
übernommen und entfernt.

**Öffnungen direkt mit der Maus (Phase 4b.2):** Werkzeug „Öffnung" (O), Art wählen,
über eine Wand fahren: Eine Vorschau folgt der auf die Wand projizierten Zeigerposition
(Mitte der Öffnung unter dem Zeiger, Standardmaße der Art), rastet mit **5 cm** ab
Wandanfang ein (unabhängig vom Zeichenraster; Alt oder „Fang" aus: ganze Millimeter) und
nennt „verbindet „A" und „B"" bzw. „nicht geteilte Wand – kein zweiter Raum" oder den
Grund, warum es hier nicht geht. Die Vorschau bleibt vollständig in der Wand **und im
atomaren Wandabschnitt unter dem Zeiger** – nie halb über der Grenze eines gemeinsamen
Stücks; sie überlappt weder Öffnungen derselben Wand noch eine auf der Gegenseite
gespeicherte Öffnung. Passt die Standardbreite nicht, erscheint eine Meldung. Ein Klick
setzt genau diese Lage in den lokalen Entwurf und wählt die neue Öffnung sofort aus;
Position und Maße bleiben in der Seitenleiste exakt bearbeitbar. Liegen zwei Wände
übereinander, gehört die neue Öffnung der Wand des aktiven Raums.

**Öffnung verschieben:** Eine Öffnung des aktiven Raums lässt sich im Auswahl- und im
Öffnungswerkzeug greifen und **nur entlang ihrer Wand** ziehen (Projektion, 5-cm-Fang,
Vorschau). Eine Kollision oder Grenze verändert nichts – die letzte gültige Lage bleibt,
die Vorschau nennt den Grund. Wechselt die Öffnung zwischen gemeinsamem und nicht
geteiltem Wandstück, meldet ein Hinweis den Wechsel. Nie Wechsel auf eine andere Wand.
Escape bricht das Ziehen ab (Entwurf zurück, Zeiger freigegeben); `pointercancel` und ein
unerwarteter Verlust des eingefangenen Zeigers ebenso. Gespeichert wird nur über
„Speichern" (atomarer Konturvorgang).

**Gemeinsame Öffnungen im 2D-Editor:** Alle Öffnungen liegen in **einer** Ebene über den
Wänden und werden genau einmal an ihrer Eigentümerwand gezeichnet – dadurch sind sie auch
auf der Seite des Nachbarraums sichtbar, ohne zweiten Datensatz und ohne doppelte Linien.
Ist der Nachbarraum aktiv, erscheint sie gestrichelt als abgeleitet (Tooltip nennt beide
Räume und die Quellwand); ein Klick führt zur einen gespeicherten Öffnung (bei
ungespeicherten Änderungen mit der üblichen Rückfrage). Die Seitenleiste nennt
„Verbindet „A" und „B"" und „Gespeichert einmal an Wand n von „A"", bei einer Wand des
Nachbarraums „Abgeleitet aus dem Nachbarraum (dort gespeichert)" mit Sprung zur Öffnung.
Eine abgeleitete Darstellung lässt sich weder separat bearbeiten noch löschen.

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

### 3D-Ansicht (Phase 4b) — umgesetzt

Dritte Ansicht im Tab „Räume & Grundriss": **„2D-Editor" · „3D-Ansicht" · „Tabellen &
Details"**, alle auf demselben Serverstand. Entscheidung:
[ADR 0016](../decisions/0016-derived-3d-view-wall-height-and-coincident-walls.md).
Code: `apps/planner/src/modules/electrical/ansicht3d/`.

**Rolle:** Die 2D-Ansicht bleibt die **einzige Autorenfläche**. Die 3D-Ansicht ist
vollständig abgeleitet und schreibgeschützt: Darstellung, Navigation, Kontrolle, Auswahl.
Keine Eingabefelder, kein Speichern, kein Schreibendpunkt, kein eigener Datenstand — sie
liest denselben Query-Eintrag `["electrical","plan",floorId]` (`plan.ts`) wie der Editor
und zeigt nach dem Speichern im Editor deshalb beim nächsten Aufruf den neuen Stand.
Lesbar mit `electrical.plan.read`, auch bei archivierten Projekten.

**Schichten:**

| Datei | Aufgabe | braucht |
|---|---|---|
| `transformation.ts` | mm → m, Achsen, Zentrierung | nichts |
| `wandgruppen.ts` | exakte Gruppierung (T9), Öffnungen in kanonischer Richtung, Konflikte | nichts |
| `wandzerlegung.ts` | Wand minus Aussparungen → Rechtecke (ohne CSG) | nichts |
| `szenenmodell.ts` | Plan → unveränderliches Szenenmodell mit Warnungen und Auswahl-IDs | nichts |
| `geometrien.ts` | Szenenmodell → `BufferGeometry` (Boden per `ShapeUtils`, Wandquader, Öffnungsflächen) | Three.js |
| `szene.ts` | imperative Szenenschicht, Lebenszyklus | Three.js, injizierte `Umgebung` |
| `umgebung.ts` | `WebGLRenderer`, `OrbitControls`, rAF, `ResizeObserver` | Browser |
| `Ansicht3d.tsx`, `Seitenleiste.tsx` | React: Laden, Zustände, Auswahl, Knöpfe, Text | React |
| `Ansicht3dLaden.tsx` | Lazy-Grenze mit Fehlerfang (enthält kein Three.js) | React |

**Koordinaten:** Grundriss-x → Three.js +X, Grundriss-y → −Z, Höhe → +Y, Millimeter
einmalig in Meter. Draufsicht: Norden oben, Osten rechts — wie im 2D-Editor. Zentriert um
den auf ganze Millimeter abgerundeten Mittelpunkt der Ausdehnung; die Transformation steht
im Szenenmodell. Nichts wird zurückgeschrieben.

**Darstellung:** Böden gültiger Konturen (auch konkave, trianguliert mit Earcut über
`ShapeUtils`) in ruhigen Farben mit Umriss; Wände in ihrer Stärke, Höhe = effektive
Raumhöhe (T8), Wandkörper an den Enden um die halbe Stärke verlängert (geschlossene
Ecken); Öffnungen als echte Aussparungen; Fenster mit leicht sichtbarer Glasfläche, Tür
und Durchgang mit unsichtbarer, treffbarer Auswahlfläche. Gemeinsame Wände hell, nicht
geteilte Wände grau-blau, Wandkronen dunkel. Keine Decke, keine Texturen, keine Schatten.
Orientierungsraster 1 m.

**Gemeinsame Wände (T9, präzisiert in 4b.2):** Wände verschiedener Räume desselben
Geschosses, die **exakt auf derselben Geraden** liegen und sich über eine positive Länge
überlappen, werden an allen Wandendpunkten in **atomare Abschnitte** zerlegt; je Abschnitt
entsteht **ein** Wandkörper (Verlängerung um die halbe Stärke nur an freien Enden). Eine
einmal gespeicherte Öffnung auf einem gemeinsamen Abschnitt schneidet den Körper
vollständig und gilt für beide Räume. Konfliktregeln (größere Stärke, größere Höhe,
Vereinigung überlappender Aussparungen, Dubletten, Grenz- und Teilkonflikte) stehen in
ADR 0016. Räume ohne gültige Kontur werden mit Grund unter „Nicht dargestellt" genannt.

### Gemeinsame Wandtopologie (Phase 4b.2)

Reine Geometrieschicht in `apps/planner/src/modules/electrical/topologie/`, verwendet von
2D-Editor **und** 3D-Ansicht; keine Core-Abhängigkeit, keine Persistenz.

| Datei | Aufgabe |
|---|---|
| `lage.ts` | exakte Lagen `ganz + stufen·√m` auf einer Wandgeraden, Vergleich über Quadrate |
| `wandtopologie.ts` | Geraden (gekürzte Richtung + ganzzahliger Abstand), atomare Abschnitte mit Quellwänden, Räumen, kanonischer Richtung, Länge, Lage `gemeinsam`/`aussen`, Konflikt `mehrdeutig`, Fortsetzung; Teilung je Wand |
| `oeffnungen.ts` | Einordnung jeder gespeicherten Öffnung: `gemeinsam` (mit abgeleitetem Nachbarraum), `aussen`, `konflikt` (`mehrdeutig`, `grenze`, `teilweise`, `widerspruch`, `art`), `ungueltig`; Dubletten der Gegenseite; Übertragung zwischen Wänden |

Eine Öffnung ist genau eine Zeile an ihrer Eigentümerwand; der zweite Raum wird nur
abgeleitet (ADR 0016, „Präzisierung 4b.2"). Keine Paar-ID, keine Migration, keine
Backendänderung. **T10** (physische Wandidentität) bleibt vor Phase 6 offen.

**Kamera und Bedienung:** Perspektivkamera, OrbitControls (Drehen, Zoomen, Verschieben,
Pfeiltasten, Touch mit ein/zwei Fingern), Dämpfung, nie unter den Fußboden, Distanz
begrenzt. Startansicht isometrisch und eingepasst; Knöpfe „Ansicht zurücksetzen" (ganzer
Grundriss, Blickrichtung bleibt; Tooltip erklärt es),
„Isometrische Ansicht", „Draufsicht", „Näher", „Weiter weg". Auswahl per Klick
(Raycasting nur gegen Böden, Wände, Öffnungsflächen), Hervorhebung, Escape hebt auf.
Seitenleiste: Raum (Name, Nummer, Höhe, Fläche, Wände), Wand (Länge, Stärke,
Darstellungshöhe, Lage, Räume), Öffnung (Art, Maße, Brüstung, Wand, erfasst in) samt
Hinweisen; darunter „Nicht dargestellt" und „Hinweise zur Darstellung" mit „In der
Ansicht zeigen".

**Lebenszyklus (`Grundrissszene`):** Konstruktor (wirft `WebGLNichtVerfuegbar`),
`setzePlan(modell, { einpassen })`, `setzeAuswahl`, `einpassen`, `standardansicht`,
`draufsicht`, `zoomen`, `groesseSetzen`, `pausieren`/`fortsetzen`, `entsorgen`. Gerendert
wird nur auf Anforderung (Bewegung inkl. Dämpfungsnachlauf, Größe, Plan, Auswahl); ohne
Interaktion läuft keine Schleife. Verborgenes Dokument pausiert. Pixel Ratio höchstens 2.
Eine Szene je Mount; ein Geschosswechsel ersetzt nur den Plan und passt neu ein.
`entsorgen()` gibt Canvas, Listener, `ResizeObserver`, Bildanforderung, Controls,
Renderer (samt `forceContextLoss`), Geometrien und Materialien frei — auch unter
`StrictMode` bleibt genau eine Szene.

**Zustände:** Plan lädt · Ladefehler mit „Erneut laden" · Geschoss ohne Räume · kein Raum
darstellbar · teilweise darstellbar mit Hinweisen · WebGL nicht verfügbar (Verweis auf
2D-Editor und Tabelle) · WebGL-Kontext verloren („Ansicht neu starten") · 3D-Modul nicht
ladbar („Erneut versuchen") · Behälter ohne Größe (kein Rendern, kein Fehler).

**Lazy Loading:** Three.js steckt nur im Chunk `Ansicht3d` (Produktionsbuild ≈ 588 kB,
≈ 152 kB gzip) und wird erst beim ersten Öffnen der 3D-Ansicht geladen.

**Performance (gemessen 2026-09-27, ein Rechner: AMD Ryzen 7 2700, 24 GB, NVIDIA RTX
3060; Chromium 152 im Browserbereich der Claude-Desktop-App, ANGLE/D3D11, Canvas ca.
700 × 560 px, Pixel Ratio 1,25; Messpunkte über `performance.measure`, Bildkosten als
Dauer des rAF-Callbacks):**

| Szene | Build | Szenenmodell | Geometrie | erstes Bild | Drehen/Zoomen je Bild (Median / p95 / max) |
|---|---|---|---|---|---|
| EFH aus 4a (7 Räume, 30 Wände, 15 Öffnungen) | Produktion | 3,8 ms | 9,9 ms | 76 ms (inkl. Shader) | 1,8 / 3,7 / 4,2 ms |
| Belastungsprobe (30 Räume, 120 Wände, 60 Öffnungen) | Produktion | 4,5 ms | 11,4 ms | 23,5 ms | 3,9 / 5,0 / 6,4 ms |
| Abnahmegeschoss (3 Räume, 14 Wände) | Entwicklung | 0,7 ms | 3,0 ms | 6,6 ms | 0,8 / 1,3 / 1,9 ms |
| Belastungsprobe | Entwicklung | 3,6 ms | 33 ms | — | 3,2 / 5,4 / 14 ms |

Erstes Öffnen im Produktionsbuild vom Klick bis zum ersten Bild: 444 ms (Chunk 148 kB
übertragen in 30 ms, Planabfrage, Aufbau). Der Browserbereich taktete mit rund 32 Bildern
je Sekunde; die Bildkosten liegen weit darunter. Im Ruhezustand keine Bildanforderung.
Ein einzelner Rechner und Browser — keine allgemeine Leistungszusage, keine Aussage zur
späteren Android-App.

**Barrierefreiheit — Grenzen:** Die Szene selbst ist nicht barrierefrei. Textliche
Alternative sind Seitenleiste, Hinweisliste und die Tabellenansicht. Szenenbereich als
beschriftete `application` mit Beschreibung, sichtbare Bedienhilfe, alle Kameraknöpfe per
Tastatur, sichtbarer Fokus, Warnungen mit Zeichen und dem Wort „Hinweis", keine
automatisch kreisende Kamera, kein Vollbild, Seitenleiste unter 960 px unter der Szene.

**Ausdrücklich nicht in Phase 4b:** Geometriebearbeitung in 3D, Geräte, Symbole,
Stromkreise, Leitungswege, Installationszonen, Materialermittlung, Kalkulation, AR,
Offline-Sync, Grundrissimport, Decken, Dachformen, Kniestock, Wandbauarten, Texturen,
Schatten, physische Wandidentität.

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
5. ~~Deckungsgleiche Wände benachbarter Räume (T9).~~ **Entschieden** mit
   [ADR 0016](../decisions/0016-derived-3d-view-wall-height-and-coincident-walls.md),
   **präzisiert in Phase 4b.2**: exakt kollineare Teilüberlappungen werden in atomare
   Abschnitte zerlegt; eine Öffnung ist genau einmal gespeichert, ihr Nachbarraum
   abgeleitet; keine Migration. **Neu zu bewerten vor Phase 6/7:** ob Leitungsrouting und
   Materialermittlung eine persistente physische Wandidentität brauchen (Querungen,
   Doppelzählung, einseitig erfasste Öffnungen, teilweise überlappende Wände).
6. Kanäle, Rohre und Verlegesysteme als eigene Materialposition je Meter — Entwurf mit
   Phase 7 abstimmen.
