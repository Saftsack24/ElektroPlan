# 0018 — Frontend-Styling: Tailwind CSS mit semantischen Laufzeit-Tokens

Status: accepted
Datum: 2026-09-29
Betrifft: Phase 4c.1 (Migration), Grundlage für Phase 4c.2 (persönliche Darstellung)
Baut auf: [ADR 0001](0001-modular-monolith.md) (Modulgrenzen),
[ADR 0014](0014-2d-editor-svg-and-atomic-contour.md) (SVG-Editor),
[ADR 0016](0016-derived-3d-view-wall-height-and-coincident-walls.md) (3D-Ansicht)

## Context

Bis Phase 4b.2 lag die gesamte Gestaltung des Planners in einer globalen, handgeschriebenen
Datei `apps/planner/src/styles.css` (553 Zeilen, rund 267 Regelblöcke) mit BEM-artigen
Klassen (`.button--primary`, `.grundriss__wand--fehler`, `.ansicht3d__overlay` …). Die Datei
mischte fachneutrale Bausteine, Plattformseiten und die Darstellung des Electrical-Editors;
Farben standen als elf Variablen mit hellem und dunklem Satz darin.

Zwei Dinge stehen an:

1. Neue Oberflächenarbeit soll einen einheitlichen, verständlichen Weg haben, statt die
   globale Datei weiter wachsen zu lassen.
2. Phase 4c.2 soll Benutzern erlauben, Farben und Darstellungsoptionen persönlich
   einzustellen – **ohne** Komponenten umzuschreiben und ohne Neubau des CSS.

## Problem

* Eine globale Datei kennt keine Modulgrenzen: Electrical-spezifische Regeln lagen im
  selben Namensraum wie Core-Bausteine.
* Klassen und Regeln drifteten auseinander (tote Regeln, Varianten per String-Interpolation
  wie `marke--${art}`).
* Utility-CSS löst das Wachstumsproblem, bringt aber eigene Risiken: Klassennamen, die zur
  Laufzeit zusammengesetzt werden, fehlen im Produktionsbuild; konkrete Farbwerte in
  Komponenten (`bg-blue-600`) machen eine Laufzeitänderung der Farben unmöglich.
* Tailwinds Preflight setzt Überschriften, Listen, Absätze und Knöpfe zurück und hätte das
  bestehende Erscheinungsbild verändert.

## Considered Options

1. **Globale CSS-Datei beibehalten**, nur aufteilen. Kein neues Werkzeug, aber kein
   gemeinsamer Wortschatz für Abstände und Zustände; das Wachstumsproblem bleibt.
2. **CSS Modules je Komponente.** Gute Kapselung, aber jede Variante bleibt handgeschrieben;
   keine gemeinsame Skala.
3. **Komponentenbibliothek** (MUI, Chakra, shadcn …). Bringt ein fremdes Designsystem und
   eine zweite Gestaltungslogik neben die vorhandene – ein Redesign durch die Hintertür.
4. **Tailwind CSS mit konkreten Farben** (`bg-slate-800`). Schnell, aber Farben sind zur
   Build-Zeit eingebrannt; Phase 4c.2 müsste Komponenten ändern.
5. **Tailwind CSS über semantische CSS-Variablen.** Utilities für Layout und Abstände,
   Farben ausschließlich als semantische Namen, die auf zur Laufzeit überschreibbare
   Custom Properties zeigen.

## Decision

**Option 5.**

### Einbindung

* **Tailwind CSS 4** (4.3.3) über das offizielle Vite-Plugin `@tailwindcss/vite`,
  CSS-first konfiguriert – es gibt **keine** `tailwind.config.js`. Keine CDN-Einbindung,
  Version im Lockfile.
* Eingebunden werden nur `tailwindcss/theme.css` und `tailwindcss/utilities.css`,
  **kein Preflight**. Die wenigen global nötigen Grundregeln stehen in
  `core/theme/basis.css` (Box-Modell, Body-Schrift, Formularelemente erben die Schrift,
  Fokusring, Dialog-Backdrop).
* Quellscan explizit auf `src/` (`source("./")`). Es gibt **keine** Ausschlussliste für
  Utilities (`@source not inline(...)`): Wörter im Quelltext wie `container`, `table` oder
  `hidden` erzeugen zwar einige ungenutzte Regeln, aber eine globale Sperrliste würde
  gültige Utilities stillschweigend aus dem Produktionsbuild entfernen – ein später im JSX
  verwendetes `hidden` oder `fixed` bliebe dann ohne Wirkung. Diese wenigen Regeln
  (≈ 2 kB) sind bewusst akzeptiert.

### Zwei Token-Ebenen

```
Komponente ── bg-accent ──▶ @theme inline { --color-accent: var(--ep-accent) }
                                                   │
                                   :root { --ep-accent: #14507d }   ◀── Laufzeit (4c.2)
```

1. **Laufzeit-Tokens** `--ep-*` auf `:root` (`core/theme/tokens.css`) tragen die Werte,
   heller und dunkler Satz über `prefers-color-scheme` wie bisher. Sie decken Flächen
   (Seite, Oberfläche, Dialog, Navigation), Rahmen, Text, Akzent mit Hover und Kontrast,
   Fokus, Auswahl, Erfolg, Warnung, Fehler, Zeichenfläche und Raster, Backdrop und Radius ab.
2. **`@theme inline`** ordnet sie Tailwind-Namen zu (`bg-surface`, `text-muted`,
   `border-line`, `bg-accent`, `outline-selected` …). `inline` bewirkt, dass jede Utility
   direkt `var(--ep-…)` ausgibt – eine Änderung der Variablen wirkt sofort.

Die **Standardpalette von Tailwind ist abgeschaltet** (`--color-*: initial`). `bg-gray-500`
existiert nicht; wer eine Farbe braucht, braucht einen Token. Die Standardwerte entsprechen
exakt den bisherigen Farben (hell und dunkel).

### Regeln für Core und Fachmodule

* Theme-Infrastruktur und Klassenrezepte sind **fachneutral** und liegen im Core
  (`core/theme/`, `core/ui/stil.ts`).
* Fachliche Darstellungsregeln bleiben im Fachmodul. Electrical besitzt seine Tokens
  (`--ep-plan-wall`, `--ep-plan-door`, `--ep-plan-window` …) und die Gestaltung der
  SVG-Zeichenfläche in `modules/electrical/editor/grundriss.css`, geladen mit dem
  Editor-Chunk.
* Wiederkehrende Muster (Knopf, Eingabefeld, Meldung, Karte, Tabelle, Reiter,
  Formularraster) sind **typisierte Klassenrezepte** in `core/ui/stil.ts`, einmalige
  Layouts stehen als Utilities am Element. Kein universeller UI-Baustein.
* Klassen stehen **immer vollständig und statisch** im Quelltext; Varianten über
  `Record<Art, string>`, nie über `` `bg-${farbe}` ``. Benutzerwerte gelangen nie in
  Klassennamen – sie sind Werte von Custom Properties.
* Inline-Styles nur für berechnete Werte (Popup-Lage der Combobox, SVG-Cursor,
  Three.js/Canvas).

### Bewusst verbleibendes Spezial-CSS

| Datei | Inhalt | Grund |
|---|---|---|
| `core/theme/basis.css` | Box-Modell, Body, `font: inherit` für Formularelemente, `code`, `:focus-visible`, `dialog::backdrop` | globale Grundregeln ohne Preflight; Pseudoelement des nativen Dialogs |
| `modules/electrical/editor/grundriss.css` | SVG-Striche, Füllungen, `paint-order`, `vector-effect`, Zustandsselektoren wie `.grundriss__raum--aktiv .grundriss__wand` | gilt für hunderte gleichartige SVG-Elemente abhängig vom Zustand der Raumgruppe; die Klassen sind zugleich Prüfpunkte der Editor-Tests |

### Wie Phase 4c.2 darauf aufbaut

* Eine Einstellung setzt Werte auf `document.documentElement.style` (`--ep-accent`,
  `--ep-page` …) oder schaltet ein Attribut, unter dem ein vordefinierter Satz gilt. Keine
  Komponente, kein Build, kein Tailwind-Lauf ist betroffen.
* Die Liste der einstellbaren Tokens ist `core/theme/tokens.css` (fachneutral) plus die
  `--ep-plan-*`-Tokens von Electrical. Ob Fachmodule ihre Tokens dafür über einen
  Beitragspunkt anmelden, entscheidet 4c.2.
* Die 3D-Szene setzt ihre Farben heute in Three.js (hell/dunkel über `matchMedia`) und
  folgt den Tokens **noch nicht**. 4c.2 muss sie an die Tokens anbinden.

## Consequences

* Neue Oberfläche entsteht mit Utilities und Rezepten; `styles.css` ist nur noch der
  Einstiegspunkt. Die frühere globale Datei ist vollständig entfernt.
* Produktions-CSS: 17,4 kB im Hauptbundle + 3,8 kB im Editor-Chunk (vorher 20,2 kB in einem
  Bundle).
* Tests prüfen Verhalten und Semantik (Rollen, `data-*`-Attribute, Rezepte), nicht
  Tailwind-Klassennamen. `DialogAktionen` trägt dafür `data-dialog-aktionen`.
* `hover:`-Utilities gelten in Tailwind 4 nur auf Geräten mit Zeigerhover
  (`@media (hover: hover)`); auf Touchgeräten entfällt der Hover-Zustand.
* Kontraste: Die übernommenen Werte erfüllen WCAG AA für Text, gedämpften Text, Akzent,
  Fehler und Erfolg. Die helle Warnfarbe (3,3 : 1 auf Weiß) und die Rahmen (~1,3 : 1)
  liegen darunter – unverändert aus dem Bestand, zu klären mit 4c.2.
* Ein Docker-Image des Planners muss nach Änderungen an `package.json` oder
  `vite.config.ts` neu gebaut werden (wie bisher).
