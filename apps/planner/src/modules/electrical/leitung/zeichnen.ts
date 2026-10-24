/**
 * Gemeinsame Zeichenregeln der Leitungsflächen (Phase 6c, L2, Entwurf §18.4) - rein.
 *
 * * **L-Führung:** Liegt das Ziel nicht auf einer Achse des letzten Punkts, entsteht eine Ecke –
 *   standardmäßig erst waagerecht (erste Achse), dann senkrecht; „Ecke wechseln“ dreht das um. Die
 *   Richtung hängt nie davon ab, wo der Zeiger gerade näher liegt.
 * * **Klick:** Drücken und Loslassen ohne nennenswerte Bewegung (< 4 Bildpunkte) setzt genau die
 *   angezeigte Vorschau; sonst nichts.
 * * **Doppelklick:** Der zweite Klick eines Doppelklicks setzt keinen weiteren Punkt an derselben Stelle.
 * * **Gerät treffen:** Bestehende Leitungen und Wandlinien liegen im Bild über den Geräten. Trifft der
 *   Zeiger kein Gerätesymbol, gilt das nächste Gerät innerhalb seines Markierungsrings.
 */
import type { Wegpunkt } from "./laenge";

export type Eckenwahl = "waagerecht" | "senkrecht";

/** Zwei Koordinaten einer Fläche: Wand (u, h) bzw. Fußboden/Decke (x, y). */
export interface Flaechenpunkt {
  readonly a: number;
  readonly b: number;
}

/** Ecke der L-Führung von `von` nach `ziel` - `null`, wenn beide auf einer Achse liegen. */
export function lEcke(von: Flaechenpunkt, ziel: Flaechenpunkt, ecke: Eckenwahl): Flaechenpunkt | null {
  if (von.a === ziel.a || von.b === ziel.b) return null;
  return ecke === "waagerecht" ? { a: ziel.a, b: von.b } : { a: von.a, b: ziel.b };
}

export function andereEcke(ecke: Eckenwahl): Eckenwahl {
  return ecke === "waagerecht" ? "senkrecht" : "waagerecht";
}

/** Bewegung zwischen Drücken und Loslassen, ab der kein Klick mehr vorliegt (Bildpunkte). */
export const KLICK_TOLERANZ_PX = 4;

/** Ein Klick, solange sich der Zeiger kaum bewegt hat (Weltkoordinaten, Bildpunkte je Einheit). */
export function istKlick(start: { x: number; y: number }, jetzt: { x: number; y: number }, massstab: number): boolean {
  return Math.hypot(jetzt.x - start.x, jetzt.y - start.y) * massstab < KLICK_TOLERANZ_PX;
}

/** Wiederholt der neue Punkt den letzten genau? Dann nicht noch einmal setzen (Doppelklick). */
export function wiederholtLetzten(wegpunkte: readonly Wegpunkt[], neu: Wegpunkt): boolean {
  const letzter = wegpunkte[wegpunkte.length - 1];
  return letzter !== undefined && JSON.stringify(letzter) === JSON.stringify(neu);
}

/** Zeitfenster eines Doppelklicks: Ein zweiter Klick danach an derselben Stelle setzt nichts. */
export const DOPPELKLICK_MS = 450;

/**
 * Nächstes Gerät innerhalb von `radiusPx` Bildpunkten um `welt` - `null`, wenn keins. Ersatz, wenn ein
 * Klick auf ein Gerät im Bild zuerst eine darüberliegende Leitung oder Wandlinie trifft.
 */
export function geraetImRing(
  welt: { readonly x: number; readonly y: number },
  massstab: number,
  lagen: Iterable<{ readonly id: string; readonly x: number; readonly y: number }>,
  radiusPx: number,
): string | null {
  const grenze = radiusPx / massstab;
  let bestes: { id: string; abstand: number } | null = null;
  for (const g of lagen) {
    const abstand = Math.hypot(g.x - welt.x, g.y - welt.y);
    if (abstand <= grenze && (bestes === null || abstand < bestes.abstand)) bestes = { id: g.id, abstand };
  }
  return bestes?.id ?? null;
}
