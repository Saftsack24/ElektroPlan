/**
 * Deckenansicht eines Raums - reine Geometrie (Phase 4f, ADR 0022).
 *
 * **Orientierung:** wie der Grundriss - x nach rechts, y nach oben, dieselben
 * Weltkoordinaten in Millimetern. Gezeigt wird die Decke wie ein
 * **Deckenspiegel**: so, wie sie sich in einem Spiegel auf dem Fußboden zeigt -
 * also nicht seitenverkehrt gegenüber dem Grundriss. Ein Punkt der Deckenansicht liegt damit exakt
 * über demselben Punkt des Grundrisses; spätere Leuchten (Phase 5) erscheinen
 * dort, wo sie im Grundriss stehen.
 *
 * Für nicht rechteckige Räume gibt es **kein** Raummaß „Länge × Breite“ und
 * keinen Abstand zu einer gedachten Rechteckkante - nur Wandlängen und den
 * senkrechten Abstand zur tatsächlich nächsten Wand.
 */
import type { EntwurfWand } from "../editor/entwurf";
import { ende, segmenteAus, start } from "../editor/entwurf";
import type { Punkt } from "../editor/geometrie";
import { konturbericht, streckenlaenge } from "../editor/geometrie";

export interface Deckenwand {
  readonly id: string;
  readonly nummer: number;
  readonly start: Punkt;
  readonly ende: Punkt;
  readonly laengeMm: number;
  /** Lage der Beschriftung: Wandmitte, um `einzugMm` ins Rauminnere versetzt. */
  readonly beschriftung: Punkt;
}

export interface Deckenmodell {
  readonly waende: readonly Deckenwand[];
  readonly flaecheMm2: number | null;
  readonly umfangMm: number | null;
  readonly geschlossen: boolean;
  /** Nur für achsparallele Rechtecke: Raummaß. Sonst `null`. */
  readonly rechteck: { readonly breiteMm: number; readonly tiefeMm: number } | null;
}

/** Achsparalleles Rechteck aus genau vier Wänden? */
function rechteckMasse(walls: readonly EntwurfWand[]): { breiteMm: number; tiefeMm: number } | null {
  if (walls.length !== 4) return null;
  if (!walls.every((w) => w.x1_mm === w.x2_mm || w.y1_mm === w.y2_mm)) return null;
  const xs = walls.flatMap((w) => [w.x1_mm, w.x2_mm]);
  const ys = walls.flatMap((w) => [w.y1_mm, w.y2_mm]);
  return { breiteMm: Math.max(...xs) - Math.min(...xs), tiefeMm: Math.max(...ys) - Math.min(...ys) };
}

export function deckenmodell(walls: readonly EntwurfWand[], einzugMm = 0): Deckenmodell {
  const bericht = konturbericht(segmenteAus(walls));
  const geschlossen = bericht.status === "valid";
  const flaeche = walls.reduce((s, w, i) => {
    const n = walls[(i + 1) % walls.length] ?? w;
    return s + (w.x1_mm * n.y1_mm - n.x1_mm * w.y1_mm);
  }, 0);
  const innenLinks = flaeche > 0; // gegen den Uhrzeigersinn: innen links der Wandrichtung
  return {
    waende: walls.map((w, i) => {
      const a = start(w);
      const b = ende(w);
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = ((innenLinks ? -1 : 1) * (b.y - a.y)) / l;
      const ny = ((innenLinks ? 1 : -1) * (b.x - a.x)) / l;
      return {
        id: w.id,
        nummer: i + 1,
        start: a,
        ende: b,
        laengeMm: streckenlaenge(a, b),
        beschriftung: { x: (a.x + b.x) / 2 + nx * einzugMm, y: (a.y + b.y) / 2 + ny * einzugMm },
      };
    }),
    flaecheMm2: geschlossen ? bericht.flaecheMm2 : null,
    umfangMm: bericht.umfangMm,
    geschlossen,
    rechteck: geschlossen ? rechteckMasse(walls) : null,
  };
}

/** Liegt ein Punkt im Raum? (Strahlverfahren, Rand zählt nicht sicher - nur Anzeige.) */
export function imRaum(waende: readonly Deckenwand[], p: Punkt): boolean {
  let innen = false;
  for (const w of waende) {
    const { start: a, ende: b } = w;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) innen = !innen;
  }
  return innen;
}

/** Senkrechter Abstand zur nächsten tatsächlichen Wand (auf ganze mm gerundet). */
export function naechsteWand(waende: readonly Deckenwand[], p: Punkt): { nummer: number; abstandMm: number } | null {
  let bester: { nummer: number; abstandMm: number } | null = null;
  for (const w of waende) {
    const dx = w.ende.x - w.start.x;
    const dy = w.ende.y - w.start.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - w.start.x) * dx + (p.y - w.start.y) * dy) / l2));
    const abstand = Math.hypot(p.x - (w.start.x + t * dx), p.y - (w.start.y + t * dy));
    if (bester === null || abstand < bester.abstandMm) bester = { nummer: w.nummer, abstandMm: abstand };
  }
  return bester === null ? null : { nummer: bester.nummer, abstandMm: Math.round(bester.abstandMm) };
}
