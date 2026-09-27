/**
 * Fangfunktion: Raster und Wandendpunkte.
 *
 * Der **Fangradius** wird in Bildschirmpixeln beurteilt, damit er bei jeder
 * Zoomstufe gleich bedienbar bleibt. Das **Ergebnis** liegt dagegen exakt auf
 * dem fachlichen Raster oder Endpunkt - in ganzen Millimetern.
 *
 * Priorität: Endpunkt vor Raster. Ein vorhandener Eckpunkt ist die präzisere
 * Absicht; ein Rasterpunkt daneben würde eine Lücke von wenigen Millimetern
 * erzeugen.
 */
import type { Punkt } from "./geometrie";
import { aufMillimeter } from "./viewport";

export const RASTERGROESSEN_MM = [10, 50, 100, 250, 500] as const;
export type Rastergroesse = (typeof RASTERGROESSEN_MM)[number];
/** 100 mm: grob genug zum schnellen Zeichnen, fein genug für Rohbaumaße. */
export const STANDARD_RASTER_MM: Rastergroesse = 100;
/** Fangradius für Endpunkte in Bildschirmpixeln. */
export const FANGRADIUS_PX = 12;

export type Fangziel = "endpunkt" | "raster" | "frei";

export interface Fangergebnis {
  readonly punkt: Punkt;
  readonly ziel: Fangziel;
}

export interface Fangoptionen {
  /** Fang eingeschaltet (Werkzeugleiste). */
  readonly aktiv: boolean;
  /** Vorübergehend ausgesetzt (Alt gedrückt). */
  readonly ausgesetzt: boolean;
  readonly rasterMm: number;
  /** Pixel je Millimeter des aktuellen Viewports. */
  readonly massstab: number;
  readonly endpunkte: readonly Punkt[];
  readonly radiusPx?: number;
}

export function aufRaster(p: Punkt, rasterMm: number): Punkt {
  return {
    x: Math.round(p.x / rasterMm) * rasterMm + 0,
    y: Math.round(p.y / rasterMm) * rasterMm + 0,
  };
}

/** Fängt einen Weltpunkt (Gleitkomma) auf einen ganzzahligen Zielpunkt. */
export function fangen(welt: Punkt, optionen: Fangoptionen): Fangergebnis {
  if (!optionen.aktiv || optionen.ausgesetzt) {
    return { punkt: aufMillimeter(welt), ziel: "frei" };
  }
  const radiusMm = (optionen.radiusPx ?? FANGRADIUS_PX) / optionen.massstab;
  let bester: Punkt | null = null;
  let besterAbstand = radiusMm * radiusMm;
  for (const e of optionen.endpunkte) {
    const dx = e.x - welt.x;
    const dy = e.y - welt.y;
    const abstand = dx * dx + dy * dy;
    if (abstand <= besterAbstand) {
      bester = e;
      besterAbstand = abstand;
    }
  }
  if (bester !== null) return { punkt: bester, ziel: "endpunkt" };
  return { punkt: aufRaster(welt, optionen.rasterMm), ziel: "raster" };
}

/** Abstand entlang einer Wand auf das Raster fangen (für Öffnungen). */
export function abstandFangen(abstand: number, rasterMm: number, aktiv: boolean): number {
  if (!aktiv) return Math.round(abstand) + 0;
  return Math.round(abstand / rasterMm) * rasterMm + 0;
}
