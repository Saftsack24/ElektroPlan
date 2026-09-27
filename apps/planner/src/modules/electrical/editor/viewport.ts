/**
 * Drei Koordinatenräume, sauber getrennt:
 *
 * 1. **Welt** - fachliche Koordinaten des Geschosses in ganzen Millimetern,
 *    `y` nach oben (ADR 0013). Nur diese Werte werden gespeichert.
 * 2. **Viewport** - Maßstab (Pixel je Millimeter) und Lage des Weltursprungs
 *    auf dem Bildschirm. Reine Ansicht, nie gespeichert.
 * 3. **Bild** - Bildschirmpixel relativ zur Zeichenfläche, `y` nach unten,
 *    Gleitkomma.
 *
 * Zoom, Pan und Größenänderung ändern **nur** den Viewport. Eine Weltkoordinate
 * entsteht aus Bildpixeln ausschließlich über {@link aufMillimeter} - und erst
 * im Moment einer fachlichen Änderung.
 */
import type { Punkt } from "./geometrie";

export interface Viewport {
  /** Pixel je Millimeter. */
  readonly massstab: number;
  /** Bildposition des Weltursprungs. */
  readonly ursprungX: number;
  readonly ursprungY: number;
}

export interface Bildpunkt {
  readonly x: number;
  readonly y: number;
}

export interface Groesse {
  readonly breite: number;
  readonly hoehe: number;
}

export interface Grenzen {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** 1 px = 200 mm: ein ganzes Gebäude passt auf eine kleine Fläche. */
export const MIN_MASSSTAB = 0.005;
/** 1 mm = 2 px: genug für Detailarbeit an Öffnungen. */
export const MAX_MASSSTAB = 2;
/** 1 m = 50 px - ein Einfamilienhaus füllt eine übliche Fläche. */
export const START_MASSSTAB = 0.05;

export const START_VIEWPORT: Viewport = { massstab: START_MASSSTAB, ursprungX: 60, ursprungY: 500 };

export function begrenzeMassstab(massstab: number): number {
  return Math.min(MAX_MASSSTAB, Math.max(MIN_MASSSTAB, massstab));
}

export function weltZuBild(v: Viewport, p: Punkt): Bildpunkt {
  return { x: v.ursprungX + p.x * v.massstab, y: v.ursprungY - p.y * v.massstab };
}

/** Bildpixel in Weltmillimeter - **Gleitkomma**, noch keine fachliche Koordinate. */
export function bildZuWelt(v: Viewport, b: Bildpunkt): Punkt {
  return { x: (b.x - v.ursprungX) / v.massstab, y: (v.ursprungY - b.y) / v.massstab };
}

/**
 * Deterministische Überführung in ganze Millimeter.
 *
 * `Math.round` rundet halbe Werte Richtung +∞ (−2,5 → −2, 2,5 → 3). Das ist
 * eindeutig und plattformunabhängig; `-0` wird zu `0`.
 */
export function aufMillimeter(p: Punkt): Punkt {
  return { x: Math.round(p.x) + 0, y: Math.round(p.y) + 0 };
}

/** Zoomt um einen Bildpunkt: Der Weltpunkt darunter bleibt, wo er ist. */
export function zoomen(v: Viewport, faktor: number, anker: Bildpunkt): Viewport {
  const massstab = begrenzeMassstab(v.massstab * faktor);
  const welt = bildZuWelt(v, anker);
  return {
    massstab,
    ursprungX: anker.x - welt.x * massstab,
    ursprungY: anker.y + welt.y * massstab,
  };
}

export function verschieben(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, ursprungX: v.ursprungX + dx, ursprungY: v.ursprungY + dy };
}

/** Passt die Grenzen mittig in die Fläche ein, mit Rand in Pixeln. */
export function einpassen(grenzen: Grenzen | null, groesse: Groesse, rand = 40): Viewport {
  if (grenzen === null || groesse.breite <= 0 || groesse.hoehe <= 0) {
    return { ...START_VIEWPORT, ursprungY: Math.max(groesse.hoehe - 60, 60) };
  }
  const breiteMm = Math.max(grenzen.maxX - grenzen.minX, 1_000);
  const hoeheMm = Math.max(grenzen.maxY - grenzen.minY, 1_000);
  const nutzbarB = Math.max(groesse.breite - 2 * rand, 1);
  const nutzbarH = Math.max(groesse.hoehe - 2 * rand, 1);
  const massstab = begrenzeMassstab(Math.min(nutzbarB / breiteMm, nutzbarH / hoeheMm));
  const mitteX = (grenzen.minX + grenzen.maxX) / 2;
  const mitteY = (grenzen.minY + grenzen.maxY) / 2;
  return {
    massstab,
    ursprungX: groesse.breite / 2 - mitteX * massstab,
    ursprungY: groesse.hoehe / 2 + mitteY * massstab,
  };
}

/**
 * Größenänderung der Zeichenfläche: Die Weltmitte bleibt in der Mitte, der
 * Maßstab bleibt gleich. Kein Springen, keine Geometrieänderung.
 */
export function groesseAendern(v: Viewport, alt: Groesse, neu: Groesse): Viewport {
  const mitte = bildZuWelt(v, { x: alt.breite / 2, y: alt.hoehe / 2 });
  return {
    massstab: v.massstab,
    ursprungX: neu.breite / 2 - mitte.x * v.massstab,
    ursprungY: neu.hoehe / 2 + mitte.y * v.massstab,
  };
}

/** Sichtbarer Weltausschnitt - etwa für das Raster. */
export function sichtbareGrenzen(v: Viewport, groesse: Groesse): Grenzen {
  const a = bildZuWelt(v, { x: 0, y: groesse.hoehe });
  const b = bildZuWelt(v, { x: groesse.breite, y: 0 });
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

export function grenzenVon(punkte: readonly Punkt[]): Grenzen | null {
  if (punkte.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of punkte) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** SVG-Transformation Welt → Bild (y gespiegelt). */
export function transformation(v: Viewport): string {
  return `matrix(${v.massstab} 0 0 ${-v.massstab} ${v.ursprungX} ${v.ursprungY})`;
}
