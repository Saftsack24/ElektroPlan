# 0013 — Raumkontur als geordnete Wandsegmente, keine Polygonspalte

Status: accepted
Datum: 2026-09-26
Betrifft: Phase 3 (Electrical Room Model) · verfeinert die Entwurfsfassung in
`docs/database.md`, Abschnitt 4 und `docs/modules/electrical.md`, Abschnitt 4
Baut auf: [ADR 0007](0007-identifiers-and-geometry-units.md) (ganzzahlige Millimeter),
[ADR 0010](0010-2d-first-editor-with-installation-zones.md) (2D zuerst)

## Context

Phase 0 hat das Datenmodell der Elektroplanung **entworfen**, nicht umgesetzt. Der
Entwurf sah für einen Raum ein JSONB-Feld `floor_polygon_mm` vor, dazu eine gespeicherte
Fläche `area_mm2`, und Wände hingen am Geschoss statt am Raum (`electrical_walls.floor_id`,
„im MVP nicht zwingend an Räume gebunden").

Mit Phase 3 wird das Modell erstmals gebaut, und drei Dinge daran halten der Umsetzung
nicht stand:

1. **Zwei Geometriequellen.** Das Polygon des Raums und die Wandsegmente beschreiben
   dieselbe Kontur. Sobald beides existiert, kann es auseinanderlaufen — und es gibt
   keine Regel, welche Seite dann gilt.
2. **Öffnungen brauchen die Wand, an der sie hängen.** Eine Tür wird über den Abstand vom
   Wandanfang beschrieben. Ohne feste Zuordnung Wand → Raum ist nicht bestimmbar, welche
   Raumhöhe für die Plausibilität der Öffnung gilt und welche Kontur zu prüfen ist.
3. **`area_mm2` ist ein berechneter Wert.** Gespeichert wäre er eine zweite Wahrheit, die
   nach jeder Wandänderung nachgezogen werden müsste.

## Problem

Wie wird die Geometrie eines Raums gespeichert, geprüft und ausgewertet — so dass ein
späterer 2D-Editor (Phase 4a) sie ohne Neumodellierung benutzen kann?

## Considered Options

**A) Polygon als JSONB am Raum, Wände separat am Geschoss** (Entwurf aus Phase 0).
Schnell zu schreiben, ein Aufruf liefert die Kontur. Aber: zwei Quellen für dieselbe
Aussage, keine Constraint auf den Inhalt, keine Eindeutigkeit einzelner Segmente, und
Öffnungen hängen an Wänden, die kein Raum kennt.

**B) Normalisierte Wandsegmente als einzige Konturquelle.** Ein Raum hat geordnete
Wände; die Kontur **ist** die Folge dieser Wände. Mehr Zeilen, mehr Prüflogik im Service,
dafür genau eine Wahrheit und Constraints, die greifen.

**C) PostGIS.** Fertige Prädikate für Selbstüberschneidung und Fläche. Aber eine
Erweiterung, ein Geometrietyp mit Fließkomma, ein zusätzliches Betriebsrisiko — für eine
geschossbezogene Geometrie, die nie geografisch abgefragt wird.

## Decision

**Option B.**

### Modell

```
floors (Core)  ──1:n──▶  electrical_rooms  ──1:n──▶  electrical_walls  ──1:n──▶  electrical_openings
```

* Ein Raum gehört zu **genau einem** Geschoss, eine Wand zu **genau einem** Raum, eine
  Öffnung zu **genau einer** Wand.
* `electrical_rooms` trägt **kein** `project_id`: Es ergibt sich aus
  `floor → building → project`. Der Core liefert diese Auflösung über den
  Erweiterungspunkt `app/core/projects/planning.py`.
* **Kein** Polygonfeld, **keine** gespeicherte Fläche, **kein** gespeicherter
  Konturzustand. Fläche, Umfang, Wandzahl und Zustand werden bei jedem Lesen aus den
  Wänden berechnet.
* Die Reihenfolge der Wände ist **explizit** (`sort_order`, lückenlos ab 0, je Raum
  eindeutig) und nicht aus der Geometrie abgeleitet. Sie ist damit auch nach einer
  späteren Synchronisation stabil (`docs/offline-sync.md`).

### Koordinatensystem

* Kartesisch, **je Geschoss**, Ursprung `(0, 0)` frei wählbar (üblicherweise die linke
  untere Ecke des Grundrisses).
* `x` nach rechts, `y` in der Draufsicht nach oben. Positiver Umlaufsinn: gegen den
  Uhrzeigersinn.
* Alle Maße sind **ganzzahlige Millimeter** mit Spaltensuffix `_mm` (ADR 0007). Keine
  geografischen Koordinaten, keine Transformationsmatrix, kein `z` in Phase 3 —
  die Höhe kommt mit den Leitungswegen (ADR 0010).
* Eine Wand ist **gerichtet**: `(x1_mm, y1_mm) → (x2_mm, y2_mm)`. Die Richtung ist
  fachlich bedeutsam, weil der Abstand einer Öffnung vom Startpunkt zählt.

### Rundungsregel

Streckenlängen werden **kaufmännisch auf ganze Millimeter** gerundet, rein ganzzahlig:

```
länge = round(sqrt(dx² + dy²)) = (isqrt(4·(dx² + dy²)) + 1) // 2
```

Ein exakter Halbwert kann nicht auftreten (`(k − ½)² = k² − k + ¼` ist für ganzzahlige
`k` nie ganzzahlig), die Regel ist also eindeutig. **Jeder Vergleich läuft gegen diesen
gerundeten Wert** — insbesondere „liegt die Öffnung innerhalb der Wand?". Backend, Tests
und späterer Editor benutzen dieselbe Funktion
(`app/modules/electrical/geometry.py::segment_length_mm`).

Die Fläche wird aus der **doppelten** Gauß-Trapezfläche gebildet (exakt ganzzahlig) und
erst am Ende halbiert, aufwärts bei genau einem halben Quadratmillimeter. Über die API
geht sie zusätzlich als Dezimalstring in Quadratmetern mit drei Nachkommastellen
(ADR 0005).

### Zwei Prüfstufen

| Stufe | Wann | Regeln |
|---|---|---|
| **Entwurf** | bei **jedem** Schreibvorgang | Start ≠ Endpunkt · Koordinaten und Wandstärke im Bereich · Länge 100 mm bis 100 m · Reihenfolge je Raum eindeutig · keine doppelte Strecke · keine Überschneidung und keine Berührung zweier Wände (außer im gemeinsamen Punkt zyklischer Nachbarn) |
| **Geschlossene Kontur** | im Prüfbericht `GET /rooms/{id}/contour` | mindestens 3 Wände · jede Wand endet, wo die nächste beginnt · die letzte endet am Anfang der ersten · Fläche ≠ 0 |

**Der Konturzustand ist abgeleitet, nicht gespeichert.** `draft` heißt: noch keine
geschlossene, einfache Kontur — der normale Zwischenstand beim Erfassen. `valid` heißt:
geschlossen und überschneidungsfrei. Es gibt deshalb **keinen** Abschlussvorgang, der
einen Zustand festschreibt; der Prüfbericht ist eine reine Auskunft und beliebig
wiederholbar. Damit kann kein gespeicherter Zustand veralten, und es entsteht keine
Workflow-Engine für einen Wert, der aus zwei Zeilen Geometrie folgt.

### Weitere Festlegungen

* **Berührung zweier Öffnungen an einer Kante ist erlaubt** (`[a, b)` und `[b, c)`): Zwei
  Türen mit gemeinsamem Rahmenpfosten sind übliche Praxis. Jede echte Überdeckung ist ein
  Fehler.
* **Ein Fenster verlangt eine Brüstungshöhe > 0**, Tür und Durchgang haben `0`.
  Unterkante + Höhe darf die geltende Raumhöhe nicht überschreiten.
* **Die Raumhöhe ist optional.** `NULL` bedeutet: Standardhöhe des Geschosses
  (`floors.default_ceiling_height_mm`). Damit steht die Höhe nur dort doppelt, wo sie
  wirklich abweicht.
* **Löschregeln, ausdrücklich:** Ein Raum wird samt Wänden und Öffnungen gelöscht
  (`CASCADE`) — eine Wand ohne Raum hat keine Bedeutung. Eine **einzelne** Wand mit
  Öffnungen lässt sich **nicht** löschen (`409`): Eine Tür verschwindet nicht als
  Nebenwirkung. Ein Geschoss mit Planungsdaten lässt sich nicht löschen (`RESTRICT`,
  vom Core als `409` übersetzt).
* **Nebenläufigkeit:** Jede Änderung an der Kontur sperrt zuerst die Raumzeile
  (`SELECT … FOR UPDATE`). Ohne diese Sperre könnten zwei gleichzeitige Anfragen jede für
  sich gültig sein und gemeinsam eine ungültige Kontur erzeugen.
* **Keine Trigger.** Die zeilenlokalen Invarianten sichern Check-Constraints, die
  konturweiten Regeln der Service. Eine Regel in einem Trigger wäre eine dritte Stelle,
  an der Geometrie entschieden wird.
* **Kein PostGIS** (Option C verworfen).

## Consequences

**Positiv**
- Genau eine Geometriequelle. Fläche und Umfang können nicht veralten.
- Der spätere 2D-Editor bedient dieselben Tabellen: Er verschiebt Wandpunkte und
  ordnet Wände um — beides ist vorhanden. Ein Datenmodellwechsel entfällt.
- Öffnungen hängen eindeutig an einer Wand, die zu einem Raum mit bekannter Höhe gehört.
- Die Geometrie ist in einer Datei ohne Datenbankbezug prüfbar
  (`geometry.py`), exakt und plattformunabhängig.
- Constraints greifen: Eine entartete Wand oder eine unbekannte Öffnungsart kommt nicht
  einmal in die Datenbank.

**Negativ**
- Die Kontur eines Raums braucht `n` Zeilen statt eines Feldes. Für Grundrisse mit
  Dutzenden Räumen unkritisch; die Abfragen sind auf `(organization_id, room_id)`
  indiziert.
- Die Überschneidungsprüfung ist quadratisch in der Zahl der Wände. Deshalb die Grenze
  von 200 Wänden je Raum — ein Raum mit mehr Wänden ist ein Erfassungsfehler.
- Fläche und Umfang werden bei jedem Lesen berechnet. Sollte das je spürbar werden, ist
  ein Cache möglich; ein gespeicherter Wert bleibt ausgeschlossen, solange er nicht
  nachweislich gebraucht wird.
- Ein Raum ohne geschlossene Kontur ist ein zulässiger Dauerzustand. Das ist gewollt
  (Erfassung in Schritten), heißt aber: Wer eine gültige Kontur **braucht** — etwa die
  Materialermittlung ab Phase 7 —, muss sie selbst prüfen und darf sie nicht voraussetzen.

## Abweichung von der Entwurfsfassung

`docs/database.md`, Abschnitt 4 und `docs/modules/electrical.md`, Abschnitt 4 sind auf
diesen Stand nachgezogen. Betroffen sind:

| Entwurf (Phase 0) | Umsetzung (Phase 3) | Grund |
|---|---|---|
| `electrical_rooms.floor_polygon_mm` (JSONB) | entfällt | zweite Geometriequelle |
| `electrical_rooms.area_mm2` | entfällt, berechnet | berechneter Wert |
| `electrical_rooms.project_id` | entfällt, über `floor` auflösbar | zweite Wahrheit |
| `electrical_rooms.room_type` | **noch nicht** angelegt | erst mit Ausstattungsvorlagen (nach Phase 5) nötig |
| `electrical_walls.floor_id`, Wände ohne Raum | `room_id`, Wand gehört zum Raum | Öffnungen brauchen Raumbezug |
| `electrical_walls.start_x_mm` … | `x1_mm`, `y1_mm`, `x2_mm`, `y2_mm` | kürzer, gleiche Bedeutung |
| `electrical_walls.height_mm`, `wall_type` | **noch nicht** angelegt | Phase 3 braucht sie nicht; die Raumhöhe gilt |
| — | `electrical_walls.sort_order` | Konturreihenfolge muss explizit sein |
| — | `electrical_rooms.room_number` (optional, je Geschoss eindeutig) | Raumkennzeichnung im Baualltag |

Die Entitäten und ihre Beziehungen sind damit **nicht** stillschweigend geändert, sondern
mit diesem ADR.
