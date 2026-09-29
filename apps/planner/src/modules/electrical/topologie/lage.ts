/**
 * Exakte Lagen entlang einer Wandlinie - ohne Fließkommatoleranz.
 *
 * Alle Wandendpunkte sind ganze Millimeter (ADR 0007). Liegen mehrere Wände
 * auf derselben Geraden, trennen sich ihre Endpunkte um ganzzahlige Vielfache
 * des kleinsten Gitterschritts `(dx, dy)` dieser Geraden; ein Schritt ist
 * `√m` Millimeter lang mit `m = dx² + dy²`. Eine Lage entlang einer Wand ist
 * deshalb immer von der Form
 *
 *     ganz + stufen · √m
 *
 * mit ganzen Zahlen `ganz` (Öffnungsabstände, gerundete Wandlänge) und
 * `stufen` (Gitterschritte bis zu einer inneren Abschnittsgrenze). Für
 * achsenparallele Wände ist `m = 1`, für ein 3-4-5-Dreieck `m = 25` - dann ist
 * `√m` ganz und jede Lage wird zu einer reinen Ganzzahl normalisiert. Nur auf
 * schrägen Linien mit irrationalem `√m` bleibt ein Stufenanteil.
 *
 * Verglichen wird exakt über Quadrate. Alle Zwischenwerte bleiben weit unter
 * 2^53: Koordinaten sind auf ±1 km begrenzt, Längen also auf ≈ 2,9 · 10^6 mm.
 * Erst die fertige Darstellung rechnet eine Lage in eine Gleitkommazahl um.
 */
import { ganzzahligeWurzel } from "../editor/geometrie";

export interface Lage {
  readonly ganz: number;
  readonly stufen: number;
}

/** Schrittlänge einer Linie: `√m`, ganzzahlig (`wurzel`) oder irrational (`null`). */
export interface Linienmass {
  readonly m: number;
  readonly wurzel: number | null;
}

export const NULL_LAGE: Lage = { ganz: 0, stufen: 0 };

export function linienmass(m: number): Linienmass {
  const w = ganzzahligeWurzel(m);
  return { m, wurzel: w * w === m ? w : null };
}

/** Normalisierte Lage: Ist `√m` ganz, wandert der Stufenanteil in `ganz`. */
export function lage(ganz: number, stufen: number, mass: Linienmass): Lage {
  return mass.wurzel === null ? { ganz: ganz + 0, stufen: stufen + 0 } : { ganz: ganz + stufen * mass.wurzel + 0, stufen: 0 };
}

export function ganzeLage(ganz: number): Lage {
  return { ganz: ganz + 0, stufen: 0 };
}

export function plus(a: Lage, b: Lage, mass: Linienmass): Lage {
  return lage(a.ganz + b.ganz, a.stufen + b.stufen, mass);
}

export function minus(a: Lage, b: Lage, mass: Linienmass): Lage {
  return lage(a.ganz - b.ganz, a.stufen - b.stufen, mass);
}

function vorzeichen(zahl: number): -1 | 0 | 1 {
  return zahl > 0 ? 1 : zahl < 0 ? -1 : 0;
}

/** Vorzeichen von `d + e·√m` - exakt. */
function vorzeichenVon(d: number, e: number, m: number): -1 | 0 | 1 {
  if (e === 0) return vorzeichen(d);
  if (d === 0) return vorzeichen(e);
  if (vorzeichen(d) === vorzeichen(e)) return vorzeichen(d);
  // Verschiedene Vorzeichen: Beträge über Quadrate vergleichen.
  const links = d * d;
  const rechts = e * e * m;
  if (links === rechts) return 0;
  return d > 0 ? (links > rechts ? 1 : -1) : rechts > links ? 1 : -1;
}

/** `-1`, `0` oder `1` - wie `a − b`. */
export function vergleichen(a: Lage, b: Lage, mass: Linienmass): -1 | 0 | 1 {
  return vorzeichenVon(a.ganz - b.ganz, a.stufen - b.stufen, mass.m);
}

export function gleicheLage(a: Lage, b: Lage, mass: Linienmass): boolean {
  return vergleichen(a, b, mass) === 0;
}

/** Nächstkleinere oder gleiche ganze Zahl - exakt. */
export function abgerundet(a: Lage, mass: Linienmass): number {
  if (a.stufen === 0) return a.ganz;
  const n = a.stufen * a.stufen * mass.m;
  return a.stufen > 0 ? a.ganz + ganzzahligeWurzel(n) : a.ganz - aufgerundeteWurzel(n);
}

/** Nächstgrößere oder gleiche ganze Zahl - exakt. */
export function aufgerundet(a: Lage, mass: Linienmass): number {
  if (a.stufen === 0) return a.ganz;
  const n = a.stufen * a.stufen * mass.m;
  return a.stufen > 0 ? a.ganz + aufgerundeteWurzel(n) : a.ganz - ganzzahligeWurzel(n);
}

function aufgerundeteWurzel(n: number): number {
  const w = ganzzahligeWurzel(n);
  return w * w === n ? w : w + 1;
}

/** Nur für die Darstellung: Gleitkommawert der Lage in Millimetern. */
export function alsZahl(a: Lage, mass: Linienmass): number {
  return a.stufen === 0 ? a.ganz : a.ganz + a.stufen * Math.sqrt(mass.m);
}
