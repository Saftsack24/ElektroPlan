import type { ReactNode } from "react";

import type { Bildpunkt } from "../editor/viewport";

/**
 * Zusatzebene einer Zeichenfläche (Wand- oder Deckenansicht, Phase 6b.4).
 *
 * Die Zeichenfläche bleibt Herrin ihrer Zeigerereignisse und ihres Viewports;
 * die Leitungsplanung hängt sich nur ein. Übernimmt die Ebene ein Drücken
 * (`true`), fängt die Fläche den Zeiger und reicht Bewegung, Loslassen und
 * Abbruch weiter. Sonst gilt das bisherige Verhalten der Fläche unverändert -
 * die Werkzeuge für Öffnungen und Geräte kommen sich so nicht in die Quere.
 */
export interface Zeigerereignis {
  /** Weltkoordinaten der Fläche: Wand (u, h), Decke (x, y). */
  readonly welt: { readonly x: number; readonly y: number };
  readonly ziel: Element | null;
  readonly altKey: boolean;
  /** Pixel je Millimeter - für Fangtoleranzen in Bildpunkten. */
  readonly massstab: number;
}

export interface Flaechenzusatz {
  druecken(e: Zeigerereignis): boolean;
  /** `laufend`: die Ebene hat das Drücken übernommen. `true` = Bewegung verarbeitet. */
  bewegen(e: Zeigerereignis, laufend: boolean): boolean;
  loslassen(): void;
  /** `true`, wenn eine laufende Bewegung abgebrochen wurde. */
  abbrechen(): boolean;
  zeichnen(b: (x: number, y: number) => Bildpunkt): ReactNode;
  /** Doppelklick auf die Fläche (Phase 6c, L2): offen abschließen. `true` = verarbeitet. */
  doppelklick?(): boolean;
  /** Zeigerform, solange ein Werkzeug der Ebene aktiv ist. */
  readonly cursor: string | null;
}
