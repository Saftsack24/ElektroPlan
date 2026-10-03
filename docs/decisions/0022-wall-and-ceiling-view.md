# 0022 — Wand- und Deckenansicht: Blickrichtung, Maßbezug, gemeinsamer Entwurf; Geschosshöhe als Teilnehmer-Prüfung

Status: accepted
Datum: 2026-10-02
Betrifft: Phase 4f (Wand- und Deckenansicht)
Baut auf: [ADR 0007](0007-identifiers-and-geometry-units.md) (ganze Millimeter),
[ADR 0013](0013-room-contour-as-ordered-wall-segments.md) (gerichtete Wände, `offset_mm` ab
Wandanfang), [ADR 0014](0014-2d-editor-svg-and-atomic-contour.md) (SVG, ein Entwurf je Raum,
`PUT …/contour`), [ADR 0016](0016-derived-3d-view-wall-height-and-coincident-walls.md)
(Wandhöhe = Raumhöhe, exakte Teilwände, eine Öffnung als Quelle),
[ADR 0020](0020-data-lifecycle-deletion-and-reopen.md) (Schreibschutz, Teilnehmer-Contract) –
erweitert um den Schreibschutz für `completed`

## Context

Öffnungen werden bisher im Grundriss als Strich auf einer Wand gesetzt und in der
Seitenleiste über „Abstand vom Anfang der gerichteten Wand“ bearbeitet. Für einen
Handwerker ist diese Richtung bedeutungslos: Sie folgt aus dem Umlaufsinn der Raumkontur,
und eine umgekehrte Kontur ändert alle Abstände. Phase 4f soll eine Wand **frontal wie auf
einem Blatt** zeigen, mit „links/rechts“, Brüstung und Abstand zur Decke – und eine
Deckenansicht als Grundlage für die Geräteplatzierung in Phase 5.

Bei der Analyse fielen zwei fachliche Lücken auf, die der Auftraggeber ausdrücklich als
Voraussetzung innerhalb von 4f freigegeben hat:

1. `completed` war serverseitig beschreibbar (nur `archived` war geschützt).
2. Eine abgesenkte **Standard-Deckenhöhe des Geschosses** konnte Öffnungen in Räumen ohne
   eigene Höhe ungültig machen – ohne Prüfung. Der Raum-PATCH war dagegen geschützt.
   Dazu ein Rennen: `FloorPlanningAccess.writable_context` las die Geschosshöhe **vor** der
   Projektsperre.

## Decision

### 1. Blickrichtung und Links/Rechts

Die Wandansicht zeigt eine Wand **aus ihrem Raum**: Man steht im Raum und blickt auf die
Wand. Links und rechts folgen allein daraus, nie aus der Speicherrichtung:

| Umlaufsinn der (geschlossenen) Kontur | Rauminneres | Links in der Ansicht |
|---|---|---|
| gegen den Uhrzeigersinn (Fläche > 0) | links der Wandrichtung | **Wandende** |
| im Uhrzeigersinn | rechts der Wandrichtung | **Wandanfang** |

Eine offene Kontur hat kein eindeutiges Innen – dann gibt es keine Wandansicht (Knopf
gesperrt, mit Begründung). Die Ansicht nennt zusätzlich die Blickrichtung im Grundriss
(„nach rechts“ …) und die anschließenden Wände links und rechts.

### 2. Die eine Transformation

`wandansicht/wandbezug.ts`, ganzzahlig, verlustfrei, eigene Umkehrung:

```
links  = anfangLinks ? offset : L − offset − breite
offset = anfangLinks ? links  : L − links  − breite
h      = Höhe über Fertigfußboden (Brüstung = Unterkante)
```

`L` ist die kaufmännisch gerundete Wandlänge (ADR 0013). Bildschirmkoordinaten entstehen
mit den unveränderten Viewport-Funktionen des Grundrisses (`x = u`, `y = h`). Gespeichert
bleibt `offset_mm` ab Wandanfang – keine neue Datenbedeutung, keine Migration.

### 3. Maßdefinitionen

| Maß | Bedeutung |
|---|---|
| Abstand von links / rechts | Wandkante bis **Öffnungskante** (lichtes Maß) |
| Breite, Höhe | Kante bis Kante |
| Brüstung über Boden | Fertigfußboden bis Unterkante |
| Abstand zur Decke | Oberkante bis effektive Raumhöhe (ADR 0016) |
| frei zu … | freier Abstand Kante zu Kante zur **nächsten** Öffnung links bzw. rechts derselben Wand (eigene oder abgeleitete) |
| Achsmaß | nur in den Eigenschaften, ausdrücklich so benannt |

Öffnungen einer Wand liegen nebeneinander (der Server verbietet überlappende Bereiche);
deshalb ist die waagerechte Nachbarschaft die räumlich relevante. Eine Überschneidung (nur
in einem ungültigen Entwurf möglich) heißt „überschneidet“, nie positiver Abstand.

### 4. Einrasten

Zentral in `wandansicht/wandfang.ts`: Toleranz 10 Bildschirmpixel (zoomunabhängig),
Ergebnis ganze Millimeter, exakt aus dem Ziel berechnet (halbe Millimeter runden aufwärts).
Prioritäten bei gleichem Abstand: Wandkante → Kante einer Öffnung → gleiche Höhe
(Brüstung, Oberkante, Decke) → Wandmitte → Mitte einer Öffnung; danach Verschiebung und
Ziel-ID (unabhängig von der Eingabereihenfolge). Hysterese: Das vorige Ziel bleibt bis zur
1,5-fachen Toleranz, solange kein anderes um mehr als die halbe Toleranz näher liegt.
Rückfall Benutzerraster (ab linker Wandkante bzw. Fußboden), aus per Schalter oder `Alt`.
Ein Fangziel darf keine ungültige Lage erzwingen: Ist die gefangene Lage unzulässig, gilt
die ungefangene, sonst bleibt die letzte gültige. **Exakte Zahleneingaben werden nie
gefangen.**

### 5. Gemeinsame Öffnungen

Unverändert ADR 0016: eine Öffnung, eine Zeile an der Eigentümerwand. Die Wandansicht der
Gegenseite zeigt sie über die bestehende Topologie (`fremdeBereiche`) gespiegelt, mit
derselben ID, gestrichelt und beschriftet „aus …“. Bearbeitbar ist nur die Quelle: „In
„Raum“ bearbeiten“ wechselt über den **bestehenden Raumwechsel** (Rückfrage: speichern und
wechseln, verwerfen, bleiben) und zeigt danach die Quellwand. Ein Ziehen auf der
abgeleiteten Seite gibt es nicht. Mehrdeutige Abschnitte (> 2 Räume) werden benannt, nicht
geraten. Keine physische Wandidentität (**T10 bleibt vor Phase 6 offen**).

### 6. Ein Entwurf, ein Speicherweg

Die Wandansicht ist ein großer Dialog **innerhalb** des Grundrisseditors und arbeitet mit
dessen Reducer (`editor/zustand.ts`) – derselbe Entwurf, dieselbe Auswahl, dieselbe
Undo-Historie, derselbe `PUT …/contour` mit der Raumversion. Eine Ziehbewegung ist ein
Undo-Schritt (`ziehen-beginnen`/`-vorschau`/`-beenden`), Escape und `pointercancel` setzen
zurück. Speichern und Verwerfen in der Wandansicht rufen **dieselben** Funktionen wie der
Grundriss; es gibt keinen zweiten Entwurf. Schließen speichert nie und meldet einen offenen
Entwurf. Bearbeitbar ist nur eine Wand des aktiven Raums; andere Wände sind Ansicht.

### 7. Regeln – nicht schärfer, nicht lockerer

Die Ansicht prüft mit denselben Funktionen wie Grundriss und Server: Größe 100 mm bis 20 m,
`opening_height_problems` (jetzt im Editor gespiegelt, Fixture `oeffnungshoehen`), ganz in
der Wand, eindeutige Raumverbindung, keine Überlappung – auch nicht mit der Gegenseite
(`bereichPruefen`, aus `platzierung.ts` herausgelöst). Türen und Durchgänge stehen nach den
bestehenden Regeln auf dem Boden; nur Fenster haben eine Brüstung. Unzulässige
Zahleneingaben ändern nichts und nennen den Grund. Die Wandlänge im Grundriss lässt sich
nicht mehr unter eine Öffnung kürzen (verständliche Ablehnung statt späterem `422`).

### 8. Deckenansicht

Reale Kontur in der Ausrichtung des Grundrisses (Deckenspiegel: wie in einem Spiegel auf
dem Fußboden, **nicht seitenverkehrt**), Wandnummern und -längen, Fläche, Umfang,
Deckenhöhe (eigene oder vom Geschoss), Raster, Zoom, Verschieben, „Ansicht zurücksetzen“.
Raummaß „Breite × Tiefe“ nur für achsparallele Rechtecke; sonst nur Wandlängen und am
Zeiger der senkrechte Abstand zur **tatsächlich** nächsten Wand. Nichts wird gespeichert.

### 9. `completed` ist schreibgeschützt (Erweiterung von ADR 0020)

`_require_writable` lehnt neben `archived` (`409 project-archived`) jetzt auch `completed`
ab (`409 project-completed`) – für Stammdaten, Gebäude, Geschosse, Dateien und alle
Electrical-Schreibwege. Weiter erlaubt: Lesen und Herunterladen, die administrative
Wiedereröffnung `completed → active` (eigener Endpunkt, `lock_project`), die Archivierung
`completed → archived`. Löschregeln unverändert (`409 project-not-deletable`). Die
Oberfläche spiegelt die Regel.

### 10. Standard-Deckenhöhe: Teilnehmer-Prüfung

Neuer synchroner Contract `FloorCeilingHeightParticipant`
(`app/contracts/v1/floor_planning.py`), gebunden über `ModuleDescriptor.provides`:

* Core `update_floor` sperrt das Projekt, liest das Geschoss **nach** der Sperre neu, prüft
  die Version und fragt bei geänderter Standardhöhe jeden Teilnehmer mit
  `FloorCeilingHeightChange(organization_id, floor_id, current, proposed)`.
* Electrical prüft nur Räume ohne eigene Höhe mit `opening_height_problems`. **Regel
  (nachgeschärft 2026-10-02, entscheidet den früheren Punkt T11):** Abgelehnt wird jede
  **Absenkung**, nach der eine Öffnung höher als ihr Raum wäre – gleich, ob sie bisher
  passte (die Änderung machte sie ungültig) oder schon bisher zu hoch war (die Absenkung
  vergrößerte den Konflikt; die Meldung sagt das ausdrücklich). Eine **unveränderte oder
  höhere** Standardhöhe ist immer zulässig, auch wenn ein Bestandskonflikt danach noch
  nicht ganz behoben ist – eine Verbesserung wird nie blockiert. Verbleibende Konflikte
  bleiben unverändert gespeichert und werden in Wand-/Deckenansicht erklärt.
* Ein Konflikt → gesamter PATCH `422 validation-failed`, `errors[].field =
  default_ceiling_height_mm`, Meldung nennt Raum und Wand, `keys` = Raum und Öffnung.
  Nichts wird verschoben, verkleinert oder gelöscht. Der Teilnehmer liest nur.
* Transaktionsgrenze: Prüfung und Änderung in einer Transaktion unter der Projektsperre.
  `writable_context` liest das Geschoss jetzt nach der Sperre neu; damit sieht eine
  wartende Öffnungsänderung die neue Höhe (vorher: Rennen).

### 11. Raumwand statt Abschnitt; Wandansicht als Standardweg (Nachtrag 2026-10-03)

Aus der manuellen Abnahme:

* **Auswahl der raumseitigen Wand.** Gewählt wird immer die ganze **gespeicherte Wand des
  angeklickten Raums** (volle Länge), nicht der atomare Abschnitt hinter einem Nachbarn.
  Die Abschnitte bleiben Zusatzinformation (Nachbar, Deckenhöhe, Öffnungsspiegelung). In
  3D gibt es dafür die Auswahl `raumwand` (`ansicht3d/raumwand.ts`): Die Normale der
  getroffenen Fläche bestimmt die Seite, der Umlaufsinn des Raums dessen Innenseite. Krone
  oder Stirnseite einer gemeinsamen Wand → Auswahl `wandseite` mit ausdrücklicher
  Raumwahl, nie geraten. Ein Wandkörper wird hervorgehoben, wenn sein Abschnitt oder eine
  ihn überdeckende Raumwand gewählt ist. Im Grundriss entscheidet die Seite der Wandlinie,
  auf der der Zeiger steht (`raumwandUnterZeiger`); genau auf der Linie gilt der
  bearbeitete Raum, sonst Hinweis. Keine Zusammenfassung über Räume, keine physische
  Wandidentität (T10 unberührt).
* **Standardweg für Öffnungen.** Werkzeuge Tür (T), Fenster (N), Durchgang (D): Der Klick
  im Grundriss wählt nur die Wand und öffnet ihre Wandansicht mit diesem Werkzeug; erst
  dort entsteht die Öffnung. Klick mit dem Werkzeug oder Doppelklick auf eine vorhandene
  Öffnung öffnet die Wandansicht mit ihr ausgewählt; die Seitenleiste bietet „In der
  Wandansicht bearbeiten“ als ersten Weg, das Formular „Werte ab Wandanfang“ nur noch
  eingeklappt. Aus der 3D-Auswahl führt „In der Wandansicht öffnen“ in den Editor.
  Entwurf, Undo/Redo, Speichern, Raumwechsel-Rückfrage und Lesemodus unverändert.
* **Fassade (Nachtrag 2026-10-03).** Von **außen** auf eine nicht geteilte Wand geklickt,
  wählt die 3D-Ansicht die durchgehende geradlinige Außenwand (`fassade`, `fassadenAus` in
  `ansicht3d/raumwand.ts`): nicht geteilte Abschnitte auf derselben exakten Geraden, die
  lückenlos aneinanderstoßen. Sie endet an Gebäudeecken, Lücken und gemeinsamen
  Abschnitten; Öffnungen unterbrechen sie nicht. Von innen bleibt es die Raumwand, von oben
  ebenso. Die Seitenleiste zeigt die Gesamtlänge und die Raumabschnitte; „In der Wandansicht
  öffnen“ nutzt den angeklickten Abschnitt (in der Auswahl mitgeführt), sonst Raumwahl. Reine
  Ansichtsgruppe, keine physische Wandidentität (T10 unberührt).

### 12. Wandseite als Ansichtskontext; Rückkehr zur Ausgangsansicht (Nachtrag 2026-10-03)

* **Wandseite** `innen | aussen` (`Wandseite` in `wandansicht/wandbezug.ts`): typisierter
  Ansichtskontext für die Wandansicht, vorbereitet für Phase 5 (innen z. B. Steckdosen, außen
  Fassadenleuchten). Von außen ist `anfangLinks` umgekehrt, die Blickrichtung zeigt zum Raum,
  die anschließenden Wände links/rechts sind vertauscht. Dieselbe Raumwand, dieselben
  Öffnungen, gespiegelt dargestellt - ein Seitenwechsel ändert keinen gespeicherten Wert;
  eine Bearbeitung von außen wirkt auf dieselbe Öffnung (Test: von außen 10 cm nach rechts =
  `offset_mm` +100). Kennzeichnung „Innenseite – Raum“ bzw. „Außenseite – Fassade“; Umschalten
  in der Wandansicht. Übergabekette: 3D-Raumwand → innen, 3D-Fassade → außen (angeklickter
  Abschnitt bestimmt die Raumwand), Krone/Stirnseite einer Außenwand → Seitenwahl
  (`wandseite`, „Innenseite – …“ / „Außenseite – Fassade“). Keine physische Wandidentität,
  kein Geräteobjektmodell.
* **Rückkehr:** Aus 3D geöffnet, führt Schließen zurück nach 3D; Kamera (`kamerastand`) und
  Auswahl werden beim Öffnen abgegeben und bei der Rückkehr wiederhergestellt (reine Ansicht,
  in `RoomsTab`). Aus 2D geöffnet bleibt es beim Grundriss. Der Wechsel nutzt den bestehenden
  Ansichtswechsel samt Rückfrage bei ungespeicherten Änderungen - kein zweiter Entwurf,
  nichts wird still gespeichert oder verworfen.

## Considered Options

* **Wandansicht mit eigenem Entwurf und eigenem Speichern** – verworfen: zwei Wahrheiten,
  konkurrierende Speicherknöpfe, Undo-Brüche.
* **Gespeicherte „Ansichtsseite“ oder Links/Rechts-Bezug an der Öffnung** – verworfen:
  ableitbar, eine Migration ohne fachlichen Gewinn.
* **Bearbeitung abgeleiteter Öffnungen direkt auf der Gegenseite** (Schreiben in einen
  fremden Raumentwurf) – verworfen: Der Entwurf umfasst einen Raum (ADR 0014); ein
  stilles Speichern eines anderen Raums wäre möglich.
* **Geschosshöhe ohne Prüfung lassen, nur anzeigen** – vom Auftraggeber verworfen.
* **Electrical liest die Geschosstabelle bzw. Core die Öffnungen** – verboten (ADR 0001).

## Consequences

**Positiv:** Handwerkliche Begriffe statt Wandrichtung; ein Entwurf, ein Speicherweg; keine
Migration, keine neue API-Route; die Lücken `completed` und Geschosshöhe sind geschlossen
und unter Parallelität getestet.

**Negativ / Grenzen:** Wandansicht nur für geschlossene Konturen. Ein Wechsel zur
Quellöffnung ist ein Raumwechsel (Rückfrage, neue Undo-Historie – wie bisher). Neue
Fehlerart `project-completed` für Clients. Auf schrägen Wänden werden irrationale
Abschnittsgrenzen nur zur Anzeige in Gleitkomma umgerechnet. Keine Anschlag- oder
Öffnungsrichtung (eigene fachliche Erweiterung).

**Phase 5:** Die Deckenansicht (Weltkoordinaten = Grundriss) und die Wandansicht
(`u`, `h` über FFB) sind die Platzierungsgrundlage für Geräte; Geräte selbst gibt es noch
nicht.
