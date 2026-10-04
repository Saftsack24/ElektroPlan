# 0023 — Elektrogeräte: Montagefläche, Geräteprüfung, Symbolbibliothek (T1), Raumtypen (T7)

Status: accepted
Datum: 2026-10-04
Betrifft: Phase 5 (Electrical Devices)
Baut auf: [ADR 0007](0007-identifiers-and-geometry-units.md) (ganze Millimeter),
[ADR 0013](0013-room-contour-as-ordered-wall-segments.md) (gerichtete Wände),
[ADR 0014](0014-2d-editor-svg-and-atomic-contour.md) (ein Entwurf je Raum, `PUT …/contour`),
[ADR 0016](0016-derived-3d-view-wall-height-and-coincident-walls.md) (eine Öffnung als Quelle,
exakte Teilwände), [ADR 0020](0020-data-lifecycle-deletion-and-reopen.md) (Teilnehmer-Contracts),
[ADR 0022](0022-wall-and-ceiling-view.md) (Wand- und Deckenansicht, Wandseite)

## Context

Phase 5 bringt die ersten Elektrogeräte: Steckdosen, Schalter, Leuchten, Netzwerkdosen. Vorher
offen waren zwei fachliche Entscheidungen – **T1** (Symbolbibliothek) und **T7** (Raumtyp). Dazu
kommen Architekturfragen: Wo und wie wird ein Gerät gespeichert, worauf bezieht sich seine Lage,
wie bleibt es bei Geometrieänderungen gültig, und wie wird es gespeichert, ohne einen zweiten
Entwurf neben dem Raumentwurf zu erzeugen? Die Wandseite aus Phase 4f war nur Ansichtskontext.
**T10** (physische Wandidentität) bleibt bis vor Phase 6 offen.

## Decision

### 1. T1 – eigene Planungssymbole

* Eigene, einfache SVG-Symbole je Gerätetyp in `apps/planner/src/modules/electrical/geraete/symbole.tsx`,
  eine Legende dazu. **Keine** Emojis, keine Menü-Icons, **keine** behauptete DIN-Konformität
  (die Legende sagt das ausdrücklich).
* Der Server liefert je Typ einen `symbol_key`; die Zuordnung zur Zeichnung steht nur in dieser
  einen Datei. Ein unbekannter Schlüssel fällt auf das Symbol der Kategorie zurück. Austausch der
  Bibliothek = diese Datei ersetzen.
* Nur mitgelieferte Zeichnungen, kein Upload, kein SVG-/HTML-Text von außen.
* Symbole haben eine **feste Bildgröße**; die Prüfung nutzt das Planungsmaß des Typs (Abschnitt 3),
  nie die Symbolgröße.

### 2. T7 – Raumtyp

Optionales Feld `electrical_rooms.room_type` mit zwölf festen Schlüsseln (`living_room`,
`bedroom`, `children_room`, `kitchen`, `bathroom`, `hallway`, `office`, `utility_room`,
`technical_room`, `basement`, `garage`, `other`) und deutschen Anzeigenamen in der Oberfläche
(`texte.ts`). Bestehende Räume bleiben `NULL`, es wird nichts klassifiziert. Der Typ dient **nur
der Einordnung**: keine Ausstattungsvorlagen, keine automatisch gesetzten Geräte in Phase 5.

### 3. Gerätekatalog

* `electrical_device_types` ist ein **globaler Systemkatalog** ohne `organization_id` (keine
  Mandantendaten), Schlüssel als Primärschlüssel. 13 Typen im Startumfang (Steckdose einfach,
  zweifach, dreifach, außen geeignet; Aus-, Wechsel-, Serienschalter; Decken-, Einbau-,
  Wand-, Außenleuchte; Netzwerkdose einfach/zweifach). Kein Herstellerartikel, keine
  Materialposition.
* Je Typ: zulässige Montageflächen, **Planungsmaß** in geraden mm (vereinfachtes Rahmen- bzw.
  Auslassmaß, an der Wand Breite × Höhe, an der Decke x × y), Standard-Montagehöhe als bloßer
  Startwert (keine Normvorgabe), Symbolschlüssel, Reihenfolge, `is_active`.
* Gepflegt nur vom **idempotenten Seed** über einen neuen synchronen Teilnehmer-Contract
  `ReferenceDataSeeder` (`app/contracts/v1/reference_data.py`), gebunden über
  `ModuleDescriptor.provides`. Der Core-Seed ruft alle Teilnehmer nach Modul-ID sortiert auf und
  kennt keine Tabelle. Ein Typ, der aus dem Katalog entfällt, wird **deaktiviert, nie gelöscht**
  (`RESTRICT` von den Geräten); vorhandene Geräte behalten ihn, neue können ihn nicht wählen
  (`422 device-type-inactive`).
* Betriebseigene Typen sind nicht Teil von Phase 5 (bräuchten einen eigenen ADR).

### 4. Geräte, Montagefläche und Bezugspunkt

`electrical_devices` (mandantenbezogen, zusammengesetzte FKs) gehört immer zu **einem Raum**.
Die tatsächliche **Montagefläche** wird dauerhaft gespeichert:

| `mounting_surface` | Lage | Höhe |
|---|---|---|
| `wall_interior` | `wall_id` (Wand dieses Raums), `center_offset_mm` | `center_height_mm` (Mitte über FFB) |
| `wall_exterior` | dieselbe Raumwand, Fassadenseite | `center_height_mm` |
| `ceiling` | `x_mm`, `y_mm` im Grundriss | **keine** – immer die effektive Raumhöhe |

* **Bezugspunkt ist die Gerätemitte.** `center_offset_mm` zählt vom Anfang der gerichteten Wand
  (ADR 0013). In der Wandansicht gilt `u = anfangLinks ? c : L − c` – ohne Breite, eigene
  Umkehrung, ganzzahlig (anders als bei Öffnungen, deren Abstand die Kante meint).
* Innen und außen sind **getrennte Flächen** derselben Raumwand: Ein Gerät innen und eines außen
  sind zwei Geräte; nichts wird gespiegelt oder auf die Gegenseite übertragen. Der Seitenwechsel
  der Ansicht ändert keinen gespeicherten Wert. Montagefläche und Wand eines Geräts ändern sich
  nicht (`422 device-surface-changed`).
* Deckengeräte haben **keine gespeicherte Höhe**: Sie folgen jeder Änderung der Raum- bzw.
  Geschosshöhe und können dadurch nicht veralten.
* Keine neue physische Wandidentität: Bezug ist die vorhandene Raumwand mit Seite (T10 offen).
  Keine Drehung, kein Stromkreis, kein ServiceTemplate in Phase 5.

### 5. Geräteprüfung (Server verbindlich, Editor spiegelt)

Rein und ganzzahlig in `devices.py`; das Planungsmaß ist ein achsparalleles Rechteck um die Mitte.
Berührung an einer Kante ist erlaubt, **keine erfundenen Sicherheitsabstände**:

1. Typ bekannt und für die Fläche zulässig.
2. Wand: Rechteck ganz in `0..Wandlänge` × `0..Raumhöhe`; keine Überdeckung mit einer eigenen
   Öffnung **oder einer abgeleiteten** (vom Nachbarraum auf dem deckungsgleichen Wandstück
   gespeichert, ADR 0016); außen kein geteiltes Wandstück (dort ist die andere Seite der Innenraum
   des Nachbarn).
3. Decke: geschlossene Kontur; Rechteck **vollständig in der echten Kontur** (Liang-Barsky mit
   Brüchen und Strahlverfahren, exakt) – auch im L-Raum, nicht nur im umschließenden Rechteck.
4. Keine Überdeckung zweier Geräte derselben Fläche.

Die abgeleiteten Öffnungen und geteilten Stücke berechnet das Backend mit einer **Portierung der
exakten Topologie** des Frontends (`topology.py`, Lagen `ganz + stufen·√m`, Wandenden = gerundete
Länge). Gegen Drift prüfen Backend und Frontend dieselbe Fixture `testdata/geometry/geraete.v1.json`.
Die Raumkontur (Wandachse) ist die Raumgrenze – wie bei der Flächenberechnung (ADR 0013).

### 6. Keine neuen und keine größeren Konflikte bei Änderungen

Jeder Schreibweg, der Geometrie, Öffnungen, Höhen oder Geräte eines Geschosses ändert, vergleicht
die Gerätebefunde des **ganzen Geschosses** vor und nach der Änderung, unter der Projektsperre in
derselben Transaktion (`device_rules.py`):

* Neue oder direkt geänderte Geräte (auch nur die Beschriftung) müssen **ganz zulässig** sein.
* Alle anderen dürfen keinen **neuen** Befund erhalten – auch nicht durch einen Nachbarraum.
* Ein **bestehender** Befund darf bleiben oder kleiner werden, aber **nicht größer**. Eine
  Teilverbesserung ist zulässig, auch wenn der Konflikt danach noch besteht.

Ein gleicher Fehlercode beweist nicht, dass ein Konflikt unverändert ist (*Nachkorrektur vor der
Abnahme*: der erste Stand verglich nur Paare aus Gerät und Code – eine weiter abgesenkte Raumhöhe
wäre durchgegangen). Jeder Befund trägt deshalb eine **Identität** aus Gerät, Code und
**Konfliktpartnern** und ein exaktes **Ausmaß** (`devices.py`, `DeviceFinding`/`Severity`):

| Code | Ausmaß | Partner |
|---|---|---|
| `device-outside-wall` | Überstand über beide Wandenden, mm | – |
| `device-below-floor` | Überstand unter den Boden, mm | – |
| `device-exceeds-room-height` | Überstand über die Raumhöhe, mm | – |
| `device-in-opening` | überdeckte Fläche, mm² (abgeleitete Öffnung exakt `ganz + stufen·√m`) | Öffnung |
| `device-exterior-on-shared-wall` | Länge auf geteilten Stücken, mm | alle beteiligten Nachbarräume |
| `device-outside-room` | Fläche außerhalb der echten Kontur, mm² (exakt, rational) | – |
| `devices-overlap` | überdeckte Fläche, mm² | anderes Gerät |
| übrige (Typ, Fläche, Raum, Wand, Lage, offene Kontur) | kein Ausmaß | – |

Derselbe Code mit einem anderen oder zusätzlichen Partner ist ein **neuer** Befund. Befunde ohne
Ausmaß bleiben zulässig, solange derselbe Befund besteht (konservativ: sie entstehen über den
Schreibweg nicht neu). Zwei irrationale Ausmaße mit verschiedenen Schrittlängen (Wandrichtung
geändert) gelten als nicht vergleichbar und damit als Verschlechterung. Abgelehnt wird mit `422`,
Ort und Gerätetyp; eine Vergrößerung trägt den Zusatz „Der bestehende Konflikt würde dadurch
größer.“ Die ganze Transaktion wird zurückgerollt, nichts wird verschoben oder gelöscht.

Der Editor zeigt dieselben Befunde (gleiche Codes, gemeinsame Fixture), entscheidet aber nicht
über die Zulässigkeit einer Änderung – das tut allein der Server. Es gibt also keine zweite,
abweichende Regel im Frontend. Betroffen: Raum anlegen (mit
Wänden), Raumhöhe, Wand anlegen/ändern/umordnen/löschen, Öffnung anlegen/ändern, Konturspeichern.
Die neue Geschoss-Standardhöhe prüft der bestehende Teilnehmer `FloorCeilingHeightParticipant`
jetzt auch für Wandgeräte (dieselbe Regel wie bei Öffnungen: keine Absenkung, nach der eine
Oberkante über der Decke läge).

Löschregeln: Raum löschen nimmt Geräte mit (`CASCADE`); eine Wand mit Geräten lässt sich weder
einzeln noch im Konturspeichern nebenbei entfernen (`409 wall-has-devices`); Projektlöschung zählt
und löscht Geräte über den bestehenden `ProjectContentParticipant` (`electrical.devices`).

### 7. Speichern: ein Entwurf, ein Vorgang

Geräte sind **Teil des bestehenden Raumentwurfs** (`editor/zustand.ts`): derselbe Reducer,
dieselbe Undo-Historie (eine Ziehbewegung = ein Schritt), derselbe Speicherweg. `PUT
/rooms/{id}/contour` nimmt zusätzlich `devices` (vollständige Liste) und `removed_device_ids`; fehlt
`devices`, bleiben die gespeicherten Geräte unverändert und werden trotzdem gegen die neue
Geometrie geprüft. **Geometrie und Geräte werden gemeinsam und atomar gespeichert** – Geräte
können also nie gespeichert werden, während die Raumgeometrie des Entwurfs ungespeichert ist. Die
Raumversion schützt beides (`If-Match`); Geräte haben keine eigene Version. Schließen einer
Wand-/Deckenansicht speichert und verwirft nichts; Navigationsschutz und Konfliktbehandlung sind
unverändert. Event: `electrical.plan.updated` mit neuem `change_kind = devices_changed`, wenn nur
Geräte geändert wurden.

### 8. Berechtigungen

Geräte fallen unter **`electrical.plan.write`** (Lesen `electrical.plan.read`). Ein eigenes
`electrical.device.write` würde einen atomaren Speichervorgang in Teilrechte zerlegen; ohne
fachlichen Bedarf wird es nicht angelegt. `completed`/`archived` bleiben schreibgeschützt
(Projektsperre wie bisher).

### 9. Darstellung

* **Grundriss:** Symbole in fester Bildgröße auf der Montageseite neben der Wand bzw. an der
  Deckenlage; Klick wählt, Doppelklick öffnet die passende Ansicht. Verschoben wird dort, nicht
  von oben. **Montagepunkt und Symbolposition sind getrennt** (`editor/geraetelayout.ts`, reine
  Darstellung, nichts wird gespeichert): Würden sich Symbole decken, werden bis zu vier an einer
  Stelle entlang der Wand aufgefächert und etwas abgerückt; jedes versetzte Symbol zeigt mit einer
  gestrichelten **Zuordnungslinie** auf seinen markierten Montagepunkt (Wand: Quadrat auf der
  Wandoberfläche der Montageseite, Decke: Ring). Mehr als vier werden zu einem **Gruppensymbol**
  mit Anzahl; ein Klick klappt es in Ringen um die Stelle auf, die Gruppe des gewählten Geräts
  bleibt aufgeklappt. Innen- und Außengeräte stehen auf verschiedenen Wandseiten und fallen nie in
  eine Gruppe. Deterministisch (nach Geräte-ID), abhängig nur von Daten und Zoom.
* **Wandansicht:** Platzieren (Vorschau, Einrasten an Wandmitte/-kanten, Achsen anderer Geräte,
  Standardhöhe, Boden, Decke; `Alt` setzt aus), Ziehen, Pfeiltasten, Hilfslinien als Achsmaße zur
  Mitte und freie Abstände, exakte Felder „Mitte von links/rechts“, „Höhe Mitte über Boden“.
* **Deckenansicht:** dasselbe Bedienmodell; Maße von der Mitte in vier Achsrichtungen bis zur
  **ersten tatsächlichen Wand**.
* **3D:** Wandgeräte als flache Quader auf ihrer Wandfläche, Deckengeräte als Scheiben knapp unter
  der effektiven Raumhöhe ohne geschlossene Decke; gewähltes Deckengerät mit gestrichelter Linie
  zum Boden und Bodenmarker. Schalter „Wandgeräte“, „Deckengeräte“, „Beschriftungen“ direkt über
  der Ansicht (Standard: Wand und Decke an, Beschriftungen aus); ausgeblendete Geräte sind **keine
  Klickziele** (Raycasting nur gegen sichtbare Objekte). „An Wand/Decke bearbeiten“ öffnet die
  Ansicht mit gewähltem Gerät; Schließen führt mit Kamera, Auswahl und Schaltern zurück. Keine
  Platzierung in 3D, keine Lichtsimulation.

## Considered Options

* **Gerät mit eigenem Speichervorgang und eigener Version** – verworfen: zweiter Entwurf neben dem
  Raumentwurf, Geräte könnten gegen ungespeicherte Geometrie gespeichert werden.
* **Gespeicherte Höhe auch für Deckengeräte** – verworfen: veraltet still bei Höhenänderungen.
* **Abstand der Gerätekante statt Mitte, wie bei Öffnungen** – verworfen: Handwerker messen
  Dosen auf Achse; die Mitte macht die Spiegelung zwischen innen und außen ohne Breite möglich.
* **Betriebsbezogener Katalog (je Mandant kopiert)** – verworfen für Phase 5: keine
  Mandantendaten, doppelte Pflege; bei Bedarf eigener ADR.
* **Gerät an einer physischen Wand statt an der Raumwand mit Seite** – vertagt (T10).
* **Prüfung nur gegen eigene Öffnungen** – verworfen: eine vom Nachbarn gespeicherte Tür ist
  physisch dieselbe Öffnung.
* **DIN-EN-60617-Symbole** – verworfen für Phase 5: keine Konformitätszusage möglich und nötig.

## Consequences

**Positiv:** ein Entwurf, ein Speichervorgang, eine Version; exakte, gespiegelte Prüfung mit
gemeinsamer Fixture; Deckengeräte folgen der Raumhöhe; Geometrieänderungen können keine
Gerätelage still ungültig machen; Katalog idempotent und austauschbar.

**Negativ / Grenzen:** Jede Geometrieänderung prüft die Geräte des ganzen Geschosses
(nicht gemessen, bei EFH-Größen unkritisch). Raumgrenze ist die Wandachse, nicht die innere
Wandfläche. Ein Gerät wechselt seine Wand nicht (entfernen und neu setzen). Planungsmaße eines
bestehenden Typs dürfen im Katalog nicht ohne Bestandsprüfung vergrößert werden. Migration `0008`;
nach dem Upgrade **Seed ausführen**, sonst ist der Katalog leer.
