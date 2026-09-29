# 0016 — Abgeleitete 3D-Ansicht: Wandhöhe und Wandlage (T8), deckungsgleiche Wände (T9)

Status: accepted (präzisiert 2026-09-28 in Phase 4b.2 – siehe „Präzisierung 4b.2")
Datum: 2026-09-27
Betrifft: Phase 4b (3D-Ansicht), Phase 4b.2 (gemeinsame Wandabschnitte, direkte Öffnungsplatzierung)
Baut auf: [ADR 0007](0007-identifiers-and-geometry-units.md) (ganzzahlige Millimeter),
[ADR 0010](0010-2d-first-editor-with-installation-zones.md) (2D als Autorenfläche, 3D als
Ansicht), [ADR 0013](0013-room-contour-as-ordered-wall-segments.md) (Kontur = geordnete,
gerichtete Wände je Raum), [ADR 0014](0014-2d-editor-svg-and-atomic-contour.md) (2D-Editor)

## Context

Phase 4b stellt den Grundriss aus Phase 4a dreidimensional dar. Das Raummodell kennt
keine Wandhöhe und keinen Wandtyp, und jeder Raum beschreibt seine Kontur **selbst**
(ADR 0013). Zwei benachbarte Räume beschreiben deshalb dieselbe physische Wand doppelt —
mit eigener Richtung, eigener Stärke und eigenen Öffnungen. Im Messlauf der Phase 4a
lagen Türen zwischen Räumen jeweils nur an einer Raumseite.

Zwei fachliche Fragen waren offen und sind jetzt verbindlich entschieden:

* **T8** — Braucht es eine Wandhöhe und einen Wandtyp je Wand?
* **T9** — Wie werden deckungsgleiche Wände benachbarter Räume behandelt?

Dazu kommt die technische Frage, wie Three.js in das Frontend eingebunden wird, ohne
die Modulgrenzen und die Entkopplung von React-State und Szene aufzugeben.

## Problem

1. Welche Höhe hat eine Wand, und woran erkennt die Darstellung Innen- und Außenwände,
   ohne das Datenmodell vorwegzunehmen?
2. Wie wird eine doppelt beschriebene Wand dargestellt — einmal, zweimal, zusammengeführt
   —, und was geschieht mit widersprüchlichen Angaben beider Seiten?
3. Wie bleibt die 3D-Ansicht rein lesend, deterministisch und frei von Speicherlecks?

## Considered Options

**T8 — Wandhöhe und Wandtyp**

* **A) Spalten `height_mm` und `wall_type` an `electrical_walls`.** Flexibel (Kniestock,
  Dachschräge), aber eine Migration, eine zweite Höhenquelle neben der Raumhöhe und eine
  Werteliste (`exterior`, `interior`, `partition` …), die fachlich noch niemand braucht.
* **B) Raumhöhe gilt für alle Wände des Raums; Innen/Außen wird abgeleitet.** Keine
  Migration, eine Höhenquelle, keine voreilige Enum.

**T9 — deckungsgleiche Wände**

* **C) Nichts zusammenführen.** Jede logische Wand wird extrudiert. Deckungsgleiche Körper
  durchdringen sich, flimmern und verdecken einseitig erfasste Türen.
* **D) Darstellung gruppiert exakt deckungsgleiche Wände.** Nur in der abgeleiteten Szene,
  ohne Datenänderung; Konflikte werden als Warnung gezeigt.
* **E) Neue persistente physische Wandidentität**, auf die sich beide Raumseiten
  beziehen. Fachlich sauber, aber eine Migration, ein neues Aggregat, neue
  Schreibregeln im Editor und eine Vorentscheidung für Leitungsrouting — alles für eine
  reine Ansicht.
* **F) Gruppieren mit Toleranz** (nahe beieinanderliegende, parallele, teilweise
  überlappende Wände). Wirkt bequem, ist aber eine geometrische Vermutung: Sie würde
  Fehler im Grundriss verstecken und ist nicht reproduzierbar erklärbar.

**Einbindung von Three.js**

* **G) React Three Fiber.** Deklarativ, aber ein Szenengraph im React-Baum: Renders und
  Szenenzustand koppeln sich, und ein zweites Objektmodell entsteht neben den Fachdaten.
* **H) Three.js direkt, gekapselt im Fachmodul, imperative Szenenschicht.**
* **I) Eigenes Paket `packages/3d-engine`.** Erst bei einem zweiten Consumer sinnvoll
  (`docs/architecture.md`, Abschnitt 13) — es gibt keinen.

## Decision

**B, D und H.**

### T8 — Wandhöhe und Wandtyp

* Die **effektive Raumhöhe** (`effective_height_mm`: Raumhöhe, sonst Standardhöhe des
  Geschosses) ist die Höhe **aller** Wände dieses Raums.
* Es gibt **keine** Wandhöhen-Spalte und **keinen** gespeicherten Wandtyp.
* „Innenwand"/„gemeinsame Wand" und „Außenwand" sind in Phase 4b **abgeleitete
  Darstellungsbegriffe**: Eine exakt mit einer Wand eines **anderen** Raums
  zusammenfallende Wand ist gemeinsam (innen); jede nicht geteilte Wand wird als Außenwand
  dargestellt.
* Bauarten (Mauerwerk, Beton, Trockenbau, Installationswand) sind ein späteres,
  eigenständiges Fachkonzept und werden nicht als Enum vorweggenommen. Kniestock,
  Dachschräge und individuelle Wandhöhen gehören nicht in Phase 4b.

### T9 — deckungsgleiche Wände

> **Präzisiert in Phase 4b.2:** Die folgende Gruppierungsregel „nur identische
> Endpunkte" ist durch die exakte kollineare Teilüberlappung ersetzt – siehe
> Abschnitt „Präzisierung 4b.2". Die übrigen Grundsätze gelten unverändert.

* Jeder Raum behält seine eigene gerichtete Kontur. Keine neue persistente Wandentität,
  keine Datenmigration.
* Deckungsgleiche Wände werden **ausschließlich in der abgeleiteten 3D-Darstellung** zu
  einem Wandkörper gruppiert.
* **Gruppierungsregel (exakt):** gleicher Geschossschlüssel **und** exakt dieselben
  ganzzahligen Millimeter-Endpunkte, gleich oder entgegengesetzt gerichtet. Der Schlüssel
  ist `floor_id | (x,y)klein | (x,y)groß`, die Endpunkte lexikografisch sortiert (erst x,
  dann y). Keine Toleranz, kein Runden, keine Vermutung. Teilweise überlappende,
  parallele oder nur annähernd gleiche Wände werden **nicht** zusammengeführt;
  dieselbe Wand (gleiche ID) wird nie mit sich selbst gruppiert.
* Die Gruppierung verändert keine gespeicherten Raum-, Wand- oder Öffnungsdaten.

### Konflikt- und Darstellungsregeln

Alle Vergleiche laufen auf den gespeicherten ganzen Millimetern; erst das fertige
Szenenmodell wird in Meter umgerechnet. Jede Regel ist **reine Darstellung** und erscheint
als nachvollziehbare Warnung — sie wird nie als fachliche Bereinigung ausgegeben.

| Befund | Darstellung | Warnung |
|---|---|---|
| Wand in zwei Räumen exakt gleich | ein Wandkörper, „gemeinsam" | — |
| unterschiedliche Wandstärken | größere Stärke | „Unterschiedliche Wandstärke" mit beiden Werten |
| unterschiedliche Raumhöhen | größere Höhe | „Unterschiedliche Raumhöhe" mit beiden Werten |
| drei oder mehr deckungsgleiche Wände | ein Körper | „Wand mehr als zweimal erfasst" (ungewöhnlicher Konflikt) |
| zwei gleiche Wände im selben Raum | ein Körper, nicht „gemeinsam" | „Wand im selben Raum doppelt" |
| Öffnung auf beiden Seiten mit gleichem Rechteck | eine Öffnung (dedupliziert) | — |
| gleiches Rechteck, abweichende Art | eine Aussparung | „Öffnungsart widersprüchlich" |
| Öffnung nur auf einer Raumseite | schneidet den **ganzen** gemeinsamen Körper | „Öffnung nur auf einer Raumseite erfasst" |
| Öffnungen beider Seiten überlappen, sind aber verschieden | Vereinigung beider Rechtecke | „Öffnung auf beiden Seiten verschieden erfasst" |
| unerwartet ungültige Öffnung | ausgelassen | „Öffnung nicht darstellbar" |
| nicht gruppierte Wände überlagern sich teilweise auf einer Linie | beide Körper, nicht zusammengeführt | „Wände überlagern sich teilweise" |

**Öffnungen in kanonischer Richtung:** Läuft eine Quellwand entgegen der kanonischen
Richtung, gilt `kanonischer Abstand = Wandlänge − ursprünglicher Abstand − Öffnungsbreite`.
Wandlänge ist die kaufmännisch gerundete Länge nach ADR 0013.

**Räume ohne gültige Kontur** (`contour_status ≠ valid`, oder defensiv erkannte Lücken)
werden **nicht** dargestellt und samt Grund aufgelistet; ihre Wände nehmen an keiner
Gruppierung teil. Ein leerer Plan ist ein normaler Zustand.

### Technik — Three.js im Fachmodul

* Three.js wird direkt verwendet und bleibt vollständig in
  `apps/planner/src/modules/electrical/ansicht3d/` gekapselt. Kein React Three Fiber,
  keine allgemeine 3D-Engine, kein `packages/3d-engine`, keine CSG-Bibliothek. Core und
  Plattformmodul kennen Three.js nicht; die Frontend-Modulgrenzen sind unverändert.
* Schichten: reine Aufbereitung (`transformation.ts`, `wandgruppen.ts`,
  `wandzerlegung.ts`, `szenenmodell.ts` — ohne DOM, WebGL, React) → Geometrie
  (`geometrien.ts`) → imperative Szenenschicht (`szene.ts`, Umgebung injizierbar in
  `umgebung.ts`) → React (`Ansicht3d.tsx`, `Seitenleiste.tsx`), lazy nachgeladen über
  `Ansicht3dLaden.tsx`.
* **Koordinaten:** Millimeter werden einmal in Meter umgerechnet; Grundriss-x → +X,
  Grundriss-y → −Z, Höhe → +Y. So ist die Draufsicht nicht gespiegelt und der Umlaufsinn
  erhalten. Der Grundriss wird um den (auf ganze mm abgerundeten) Mittelpunkt seiner
  Ausdehnung zentriert; die Transformation steht im Szenenmodell.
* **Wandkörper ohne CSG:** Die Wand wird in lokalen Koordinaten entlang aller Öffnungs-
  kanten in ein Raster zerlegt; verbleibende Wandzellen werden zu Rechtecken
  zusammengefasst und als Quader extrudiert. Überlappende Aussparungen ergeben dadurch von
  selbst ihre Vereinigung.
* **Lebenszyklus:** eine Szene je Mount; `setzePlan` ersetzt nur die Planobjekte und gibt
  ersetzte Geometrien frei; Materialien gehören der Szene; Rendern nur auf Anforderung
  (Bewegung, Dämpfung, Größe, Plan, Auswahl); `entsorgen()` gibt Canvas, Listener,
  `ResizeObserver`, Bildanforderung, Controls, Renderer (inkl. `forceContextLoss`),
  Geometrien und Materialien frei. In React landet nur die fachliche Auswahlreferenz.
* **Schreibschutz:** Die 3D-Ansicht hat keine Eingabefelder, keinen Schreibendpunkt und
  keinen eigenen Datenstand; sie liest denselben Query-Eintrag wie der 2D-Editor.

## Präzisierung 4b.2 (2026-09-28): exakte Teilwände, eine Öffnung als Quelle

### Warum vollständige Segmentgleichheit nicht ausreichte

Die Browserabnahme von Phase 4b mit dem realen Grundriss aus dem Messlauf 4a
(`PR-2026-0006`, 7 Räume, 30 Wände) zeigte: Nur **4** Wandpaare waren exakt
deckungsgleich, **7** Paare lagen nur **teilweise** übereinander – typisch für
Flur-/Raumgrundrisse: Die lange Flurwand (0–9000) liegt neben drei kürzeren
Raumwänden (Bad, Schlafen, Kind); die Nordwand des Wohnzimmers neben Küche und Flur.
Diese Paare wurden doppelt extrudiert, durchdrangen sich und erzeugten 7 Hinweise; die
drei Türen auf den kurzen Raumwänden galten als „nur auf einer Raumseite erfasst". Die
Abhilfe „Eckpunkte angleichen" hätte die Raumkonturen künstlich zerstückelt.

### Neue Erkennungsregel (ersetzt „identische Endpunkte")

Gemeinsame Wandabschnitte werden erkannt, wenn Wände **verschiedener Räume**

* im selben Geschoss liegen,
* **exakt auf derselben unendlich gedachten Geraden** liegen – geprüft über die durch
  den größten gemeinsamen Teiler gekürzte, kanonisch orientierte ganzzahlige Richtung
  `(dx, dy)` und den ganzzahligen Geradenabstand `dy·x − dx·y`,
* sich über eine **positive Länge** überlappen.

Die Gerade wird an **allen** Wandendpunkten in **atomare Abschnitte** zerlegt; jeder
Abschnitt kennt die Wände, die ihn vollständig überdecken. Beispiel: Flurwand 0–6000,
Raum A 0–3000, Raum B 3000–6000 ergibt die Abschnitte 0–3000 (Flur ↔ A) und
3000–6000 (Flur ↔ B); die drei gespeicherten Wände bleiben unverändert. Zwei Räume auf
einem Abschnitt: gemeinsam. Drei oder mehr: Konflikt („mehrdeutig"), keine willkürliche
Zuordnung. Wände desselben Raums: nie gemeinsam, als Doppelung gemeldet. Berührung nur an
einem Endpunkt (Fortsetzung, T-Stoß): keine gemeinsame Wand.

**Weiterhin verboten:** Toleranzsuche, Runden nahe beieinanderliegender Linien,
Zusammenführen nur ungefähr paralleler Wände, verschiedener Geschosse oder ohne echte
Überlappung, stilles Verändern gespeicherter Konturen.

**Exaktheit:** Alle Entscheidungen fallen auf ganzen Millimetern. Innere
Abschnittsgrenzen auf schrägen Wänden liegen bei `k·√m` (k Gitterschritte,
`m = dx² + dy²`) und werden als exakte Lage `ganz + stufen·√m` verglichen (über
Quadrate, alle Werte < 2^53); die Wandenden liegen wie bisher bei 0 und der
kaufmännisch gerundeten Wandlänge (ADR 0013). Erst die fertige Darstellung wird für SVG
bzw. Three.js in Gleitkomma umgerechnet.

**Stabile IDs:** Deckt jede Quellwand genau den Abschnitt ab, ist die ID wie bisher die
Gruppen-ID der Wände (`a+b`); sonst zusätzlich mit den kanonischen Endpunkten
(`a+b@0,0~3000,0`). Das Ergebnis ist unabhängig von der Reihenfolge der Eingabe.

### Eine gemeinsame, reine Topologieschicht für 2D und 3D

`apps/planner/src/modules/electrical/topologie/` (`lage.ts`, `wandtopologie.ts`,
`oeffnungen.ts`) – ohne DOM, React oder Three.js, intern im Fachmodul, keine
Core-Abhängigkeit. Der 2D-Editor (aktiver Raum aus dem Entwurf, übrige vom Server) und die
3D-Ansicht (nur gültige Konturen) verwenden **dieselbe** Ableitung; ein Test prüft auf dem
realen 4a-Grundriss identische Abschnitte und Raumverbindungen.

### Verbindliche Modellentscheidung: eine Öffnung, keine Dublette

Eine Tür, ein Fenster oder ein Durchgang wird **genau einmal** als `electrical_opening` an
**genau einer** Wand gespeichert – der Eigentümerwand. Liegt ihr gesamter waagerechter
Bereich in **genau einem** gemeinsamen atomaren Abschnitt mit genau zwei Räumen, gilt sie
fachlich und in der Darstellung als Öffnung zwischen beiden Räumen:

* sie erscheint in 2D und 3D auf beiden Raumseiten, der zweite Raum ist **abgeleitet**,
* sie schneidet den gemeinsamen 3D-Wandkörper vollständig,
* keine zweite Öffnungszeile, kein zweiter Schreibvorgang, keine Paar-ID, keine
  Migration; Verschieben, Bearbeiten und Löschen betreffen die eine gespeicherte Entität.

**Nicht eingeführt:** `paired_opening_id`, `connection_id`, Öffnungspaar-Tabelle,
physische Wandtabelle, gespiegelte zweite Öffnungszeile, Events für die abgeleitete
Nachbarschaft. Die Backendvalidierung bleibt Autorität für die einzelne Öffnung an ihrer
Wand; eine Backendänderung war nicht nötig – eine halb gespeicherte Raumverbindung kann
es deshalb nicht geben.

**Keine Nachbarschaft wird geraten**, wenn eine Öffnung nur teilweise in einen
gemeinsamen Abschnitt ragt (`teilweise`), die Grenze zwischen zwei verschiedenen
Nachbarn überschreitet (`grenze`), auf einem Abschnitt mit mehr als zwei Räumen liegt
(`mehrdeutig`) oder der Gegenseite widerspricht. Dann: sichtbarer Konflikt, Aussparung in
3D trotzdem, keine Raumverbindung. Eine Öffnung auf einem nicht geteilten Abschnitt bleibt
eine Außenöffnung ohne zweiten Raum.

**Vorhandene beidseitige Erfassungen** werden nicht verändert oder gelöscht:

| Befund (nach Richtungsumrechnung) | Darstellung | Hinweis |
|---|---|---|
| gleiche Art, Lage, Breite, Höhe, Brüstung | einmal gezeigt, weiter „verbindet A und B" | „Öffnung auf beiden Raumseiten erfasst" – zur späteren Bereinigung |
| gleiche Geometrie, andere Art | eine Aussparung | Konflikt „Öffnungsart widersprüchlich" |
| nur teilweise überlappend | Vereinigung | Konflikt „auf beiden Seiten verschieden erfasst" |
| gleiche Lage, andere Höhe oder Brüstung | Vereinigung | Konflikt |

Neue Öffnungen werden ausschließlich einmal gespeichert; der Editor verhindert beim
Platzieren und Verschieben auch die Überlappung mit einer auf der Gegenseite gespeicherten
Öffnung. Ein automatisches Bereinigungswerkzeug gibt es nicht.

### Geänderte Darstellungsregeln (ersetzen die entsprechenden Zeilen oben)

* Ein Wandkörper **je atomarem Abschnitt**; jeder gemeinsame Teil wird genau einmal
  extrudiert, nicht geteilte Reststücke bleiben eigene Körper.
* Verlängerung um die halbe Stärke nur an **freien** Enden; setzt sich die Gerade in
  einem weiteren Abschnitt fort, stoßen die Körper stumpf und ohne Überlagerung
  aneinander (kein Flimmern).
* Entfallen: „Öffnung nur auf einer Raumseite erfasst" (für eindeutig abgeleitete
  gemeinsame Öffnungen) und „Wände überlagern sich teilweise" (Teilüberlappungen werden
  jetzt zusammengeführt).
* Neu: „Öffnung auf beiden Raumseiten erfasst" (Dublette), „Öffnung über der Grenze
  zweier Nachbarräume", „Öffnung nur teilweise in der gemeinsamen Wand",
  „Raumverbindung nicht eindeutig".
* Unverändert: größere Stärke, größere Höhe (jetzt je Abschnitt), Vereinigung
  überlappender Aussparungen, ungültige Öffnungen werden ausgelassen.

### Grenzen der Ableitung

* Die Nachbarschaft ist eine **Ansicht**, keine fachliche Entität. Kein Fachmodul und
  kein Port darf sich darauf stützen.
* Nur exakt kollineare Wände werden erkannt; eine um 1 mm versetzte Nachbarwand bleibt
  getrennt (gewollt).
* Die Darstellungshöhe eines Abschnitts zwischen unterschiedlich hohen Räumen bleibt die
  größere.
* Die 3D-Ansicht berücksichtigt nur Räume mit gültiger Kontur; der 2D-Editor auch
  Entwürfe. Für gültige Räume sind die Ergebnisse identisch.
* **T10 (physische Wandidentität) bleibt vor Phase 6 offen.**

## Consequences

**Positiv**

* Keine Migration, keine API-Änderung, keine zweite Höhen- oder Wandquelle.
* Gemeinsame Wände erscheinen einmal; einseitig erfasste Türen schneiden sichtbar durch.
* Widersprüche in den Daten werden sichtbar statt versteckt — mit Text, der die Regel
  nennt. Korrigiert wird im 2D-Editor.
* Deterministisch und exakt prüfbar: Die gesamte Aufbereitung ist reine, ganzzahlige
  Logik mit Unit-Tests.

**Negativ / Grenzen**

* ~~**Teilweise überlappende Wände** werden **nicht** zusammengeführt.~~ **Überholt mit
  Phase 4b.2:** Exakt kollineare Teilüberlappungen werden in atomare Abschnitte zerlegt
  und je Abschnitt einmal dargestellt (siehe „Präzisierung 4b.2").
* Die Darstellungshöhe einer gemeinsamen Wand zwischen unterschiedlich hohen Räumen ist
  die größere — eine Stufe in der Decke ist nicht abbildbar (es gibt keine Decke).
* Ecken werden durch Verlängern der Wandkörper um die halbe Stärke geschlossen; bei
  spitzen oder stumpfen Winkeln entstehen kleine Überstände. Reine Darstellung.
* Kein Kniestock, keine Dachschräge, keine Bauart.
* Three.js vergrößert den lazy nachgeladenen Chunk der 3D-Ansicht auf rund 590 kB
  (≈ 152 kB gzip); das Haupt-Bundle ist unberührt.

## Spätere Neubewertung

Vor **Leitungsrouting (Phase 6)** und **Materialermittlung (Phase 7/8)** ist neu zu
bewerten, ob eine **physische Wandidentität** (Option E) gebraucht wird:

* Ein Leitungsweg, der eine Wand quert oder in ihr verläuft, braucht eine eindeutige
  Wand — nicht zwei logische Seiten mit womöglich verschiedener Stärke.
* Materialmengen je Wand (Schlitze, Durchbrüche, Dosen je Wandseite) dürfen eine
  gemeinsame Wand nicht doppelt zählen.
* Abgeleitete Raumverbindungen von Öffnungen und atomare Teilabschnitte (Phase 4b.2)
  sind dann keine Darstellungsfrage mehr, sondern eine fachliche.

Bis dahin gilt: Die Gruppierung ist Darstellung. Kein Fachmodul und kein Port darf sich
auf sie stützen. Wird eine physische Wandidentität eingeführt, entsteht ein neuer ADR,
der diesen ausdrücklich ergänzt oder ersetzt.
