# 0014 — 2D-Editor: SVG-Zeichenfläche, lokaler Entwurf je Raum, atomares Konturspeichern

Status: accepted
Datum: 2026-09-26
Betrifft: Phase 4a (grafischer 2D-Editor)
Baut auf: [ADR 0007](0007-identifiers-and-geometry-units.md) (UUIDs, ganzzahlige
Millimeter), [ADR 0010](0010-2d-first-editor-with-installation-zones.md) (2D zuerst),
[ADR 0013](0013-room-contour-as-ordered-wall-segments.md) (Kontur = geordnete Wände)

## Context

Phase 3 hat das Raummodell über Einzelendpunkte und Formulare erfasst. Der grafische
Editor ändert dagegen viele Dinge auf einmal: Wer einen Eckpunkt zieht, ändert zwei
Wände; wer eine Wand kürzt, muss oft zugleich eine Tür verschieben. Über die
Einzelendpunkte gespeichert, entstünden halbfertige Konturen, Teilfehler und
Reihenfolgeprobleme (die Wand passt erst, wenn die Tür verschoben ist, die Tür erst,
wenn die Wand geändert ist).

Außerdem musste entschieden werden, womit gezeichnet wird. Die Roadmap spricht von
„Canvas-Editor" — gemeint ist die grafische Autorenfläche, nicht das HTML-Element.

## Problem

1. Womit wird der Grundriss dargestellt und bedient?
2. Wo lebt der ungespeicherte Stand, und wie wird er gespeichert, ohne Teilzustände oder
   verlorene Änderungen zu erzeugen?
3. Wie bemerkt der Editor eine zwischenzeitliche Änderung über die Formulare?

## Considered Options

**Darstellung**

* **A) SVG ohne Zusatzbibliothek.** Wände und Öffnungen bleiben echte DOM-Elemente;
  Treffer, Auswahl und Zeigerereignisse sind objektbezogen; Texte bleiben scharf; Tests
  laufen in jsdom deterministisch; Zugänglichkeit und Debugging über DOM-Werkzeuge.
* **B) Natives Canvas 2D.** Schneller bei zehntausenden Elementen, aber Trefferprüfung,
  Auswahl, Texte und Tests müssen selbst gebaut werden.
* **C) Editor- oder Szenenbibliothek (Konva, Fabric, Paper).** Bringt Szenengraph und
  Werkzeuge, aber eine schwere Abhängigkeit, ein eigenes Objektmodell neben den
  Fachdaten und eine Vorentscheidung für Phase 4b, bevor sie ansteht.

**Speichern**

* **D) Einzelendpunkte nacheinander.** Nicht atomar, Reihenfolgeprobleme, Teilfehler.
* **E) Ein atomarer Befehl je Raum mit vollständigem Zielzustand** (Wände samt
  Öffnungen).
* **F) Allgemeine Batch-Engine** über alle Ressourcen. Ausdrücklich nicht gewollt.

## Decision

**A und E.**

### Darstellung: SVG

* Die Zeichenfläche ist ein `<svg>`. Die Fachgeometrie liegt in **einer** Gruppe mit der
  Viewport-Transformation (`matrix(m 0 0 −m x₀ y₀)`, y gespiegelt). Zoom und Pan ändern
  nur diese Transformation; Wand- und Öffnungselemente werden dabei nicht neu erzeugt.
* Beschriftungen, Eckgriffe, Raster und Vorschau liegen im **Bildraum**: gleich groß und
  scharf in jeder Zoomstufe, nicht Teil der Geometrie.
* Messung (Abschnitt „Performance" in `docs/modules/electrical.md`): 200 Wandsegmente
  bleiben bedienbar. Canvas oder eine Bibliothek wären erst bei Größenordnungen nötig,
  die ein Geschoss nicht erreicht.

### Drei Koordinatenräume

Welt (ganze Millimeter, y nach oben) · Viewport (Maßstab px/mm, Lage des Ursprungs) ·
Bild (Pixel, y nach unten). Umrechnung in reinen Funktionen (`editor/viewport.ts`).
Eine Weltkoordinate entsteht aus Bildpixeln nur über Fang (`editor/fang.ts`) bzw.
`aufMillimeter` — also immer ganzzahlig, und erst im Moment einer fachlichen Änderung.

### Lokaler Entwurf je Raum

* Der Editor hält **genau einen Raum** als Entwurf — denselben Umfang, den der
  Speicherbefehl atomar schreibt. Alles andere zeigt er aus dem Serverstand.
* Der Entwurf entsteht aus dem zuletzt geladenen Serverstand und wird nach dem Speichern
  durch die **Serverantwort** ersetzt. Er ist keine zweite Geometriedatenhaltung.
* Undo/Redo gilt nur für den ungespeicherten Entwurf; nach dem Speichern beginnt die
  Historie neu. Zustand in einem Reducer (`editor/zustand.ts`), keine globale
  State-Bibliothek.
* Neue Räume (Rechteck, Polygon) werden **nach der Namensvergabe sofort** angelegt —
  `POST …/rooms` nimmt dafür optional die Wände entgegen, damit Raum und Kontur in
  einer Transaktion entstehen.

### `PUT /rooms/{room_id}/contour`

* Nimmt den **vollständigen Zielzustand** entgegen: geordnete Wände, je Wand die
  vollständige Öffnungsliste, dazu `removed_opening_ids`.
* Bekannte IDs werden geändert, fehlende oder neue angelegt — mit der vom Client
  erzeugten UUID. Fehlende Wände werden entfernt. Die Listenposition ist `sort_order`.
* Eine vorhandene Öffnung verschwindet **nie stillschweigend**: Sie steht im Zielzustand
  oder in `removed_opening_ids`. Sonst `422 opening-missing`, bzw. `409
  wall-has-openings`, wenn ihre Wand entfernt werden soll. Eine Öffnung wechselt ihre
  Wand nicht (`422 opening-wall-changed`).
* Geprüft wird der **Zielzustand als Ganzes** mit denselben reinen Regeln wie überall
  (`geometry.py`); ein technischer Zwischenzustand spielt keine Rolle. Danach wird in
  **einer** Transaktion geschrieben, Projekt vor Raum gesperrt, genau ein Event
  `electrical.plan.updated` (`walls_changed`) nach dem Commit.
* URL: Der `GET` auf derselben Adresse ist der Prüfbericht derselben Kontur. `PUT` ist
  hier bewusst gewählt — bisher galt „`PUT` wird nicht verwendet"; für das Ersetzen
  einer vollständigen Liste war er in `docs/modules/electrical.md` schon vorgesehen
  (Punktlisten der Leitungswege).

### Raumversion = Version der Raumgeometrie

Jede wirksame Änderung an Wänden oder Öffnungen eines Raums — auch über die
Einzelendpunkte der Formularansicht — zählt die **Raumversion** weiter. `PUT …/contour`
prüft `If-Match` gegen genau diese Version. Nur so fällt ein Editor mit altem Stand in
einen Versionskonflikt, statt eine zwischenzeitliche Formularänderung zu überschreiben.
Wand- und Öffnungsversionen bleiben bestehen und schützen die Einzelendpunkte wie bisher;
unveränderte Wände behalten beim Konturspeichern ihre Version.

### Geschossbezogener Planendpunkt

`GET /floors/{floor_id}/plan` statt des in Phase 0 skizzierten
`GET /projects/{project_id}/plan`: Der Editor zeigt ein Geschoss; die Antwort bleibt
begrenzt; der Geschosskontext kommt über den vorhandenen öffentlichen Core-Zugang
(`FloorPlanningAccess`), ohne die Core-Oberfläche zu erweitern. Die Geschossauswahl
liefert der Core ohnehin.

## Consequences

**Positiv**

* Ein Speichervorgang, eine Transaktion, eine Versionsprüfung, ein Event — keine
  Teilzustände.
* Formular und Editor können nicht gegenseitig still überschreiben.
* Keine neue Abhängigkeit im Frontend; Editorlogik als reine, testbare Funktionen.
* Keine Migration: Es entstehen keine neuen persistenten Daten.

**Negativ**

* Ein Raumwechsel mit ungespeicherten Änderungen verlangt eine Entscheidung (speichern
  und wechseln oder bleiben). Geschossweites Speichern mehrerer Räume gibt es nicht.
* Die Raumversion ändert sich jetzt auch bei Wand- und Öffnungsänderungen. Wer den Raum
  danach per `PATCH` ändert, braucht die aktuelle Version — so, wie es beim Umordnen der
  Wände schon galt.
* Öffnungen können nicht an eine andere Wand „umziehen"; sie werden entfernt und neu
  angelegt.
* SVG hat eine Obergrenze: Bei tausenden Elementen je Ansicht würde Canvas nötig. Für
  Phase 4a nicht absehbar; bei Bedarf neuer ADR.
