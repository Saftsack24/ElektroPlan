import type { Abschnittstatus, Halt, Steigwegauswertung, Verlaufspunkt } from "./verlauf";

/**
 * Was ein Steigweg auf **einem** Geschoss zeigt - abgeleitet aus derselben
 * Polylinie wie Länge und 3D-Vorschau (`verlauf.ts`), ohne eigene Geometrie.
 *
 * * Halt auf diesem Geschoss → Übergabepunktsymbol; führt ein Abschnitt von
 *   hier nach oben, zusätzlich ein Pfeil „nach oben".
 * * Endet ein Abschnitt hier (oberes Geschoss) → der waagerechte Versatz als
 *   Linie vom Durchstoßpunkt der Senkrechten zum Halt, mit Pfeil „von unten".
 * * Wird das Geschoss durchquert → nur der Durchstoßpunkt, gestrichelt, ohne
 *   Anschluss.
 */

export interface Versatzlinie {
  punkte: { x_mm: number; y_mm: number }[];
  status: Abschnittstatus;
}

export interface Geschossansicht {
  halt: Halt | null;
  /** Ein Abschnitt verlässt diesen Halt nach oben. */
  nachOben: Abschnittstatus | null;
  /** Abschnitte, die auf diesem Geschoss ankommen (waagerechter Versatz). */
  versatz: Versatzlinie[];
  /** Durchstoßpunkte ohne Anschluss. */
  durchquert: { x_mm: number; y_mm: number; status: Abschnittstatus }[];
}

export function geschossansicht(auswertung: Steigwegauswertung, floorId: string): Geschossansicht {
  const halt = auswertung.halte.find((h) => h.floor_id === floorId) ?? null;
  const nachOben = auswertung.abschnitte.find((a) => a.unten.floor_id === floorId)?.status ?? null;
  const versatz = auswertung.abschnitte
    .filter((a) => a.oben.floor_id === floorId)
    .map((a) => ({ punkte: waagerechterTeil(a.verlauf), status: a.status }));
  const durchquert = auswertung.abschnitte
    .filter((a) => a.durchquert.includes(floorId))
    .map((a) => ({ x_mm: a.unten.x_mm, y_mm: a.unten.y_mm, status: a.status }));
  return { halt, nachOben, versatz, durchquert };
}

/** Die Punkte auf der Ebene des oberen FFB - der waagerechte Versatz. */
export function waagerechterTeil(verlauf: readonly Verlaufspunkt[]): { x_mm: number; y_mm: number }[] {
  const ende = verlauf[verlauf.length - 1];
  if (ende === undefined) return [];
  return verlauf.filter((p) => p.z_mm === ende.z_mm).map((p) => ({ x_mm: p.x_mm, y_mm: p.y_mm }));
}

export interface Rahmen {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Standardfläche ohne Räume und Punkte: 10 m × 7,5 m ab Ursprung. */
export const LEERE_FLAECHE: Rahmen = { minX: 0, minY: 0, maxX: 10_000, maxY: 7_500 };

/** Umgebender Rahmen mit Rand, mindestens die Standardfläche groß, Seitenverhältnis 4 : 3. */
export function sichtrahmen(punkte: readonly { x_mm: number; y_mm: number }[], rand = 1_000): Rahmen {
  if (punkte.length === 0) return LEERE_FLAECHE;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of punkte) {
    minX = Math.min(minX, p.x_mm);
    minY = Math.min(minY, p.y_mm);
    maxX = Math.max(maxX, p.x_mm);
    maxY = Math.max(maxY, p.y_mm);
  }
  minX -= rand;
  minY -= rand;
  maxX += rand;
  maxY += rand;
  let breite = Math.max(maxX - minX, 4_000);
  let hoehe = Math.max(maxY - minY, 3_000);
  if (breite / hoehe > 4 / 3) hoehe = (breite * 3) / 4;
  else breite = (hoehe * 4) / 3;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  return { minX: mx - breite / 2, minY: my - hoehe / 2, maxX: mx + breite / 2, maxY: my + hoehe / 2 };
}

/**
 * Bildschirmpunkt → Weltkoordinate in ganzen Millimetern (`preserveAspectRatio`
 * `xMidYMid meet`, y nach oben). Gerundet auf `raster` mm; Grenzen ±1 km
 * wie im Backend.
 */
export function zeigerZuWelt(
  flaeche: { left: number; top: number; width: number; height: number },
  rahmen: Rahmen,
  clientX: number,
  clientY: number,
  raster = 10,
): { x_mm: number; y_mm: number } | null {
  const breite = rahmen.maxX - rahmen.minX;
  const hoehe = rahmen.maxY - rahmen.minY;
  if (flaeche.width <= 0 || flaeche.height <= 0 || breite <= 0 || hoehe <= 0) return null;
  const massstab = Math.min(flaeche.width / breite, flaeche.height / hoehe);
  const links = flaeche.left + (flaeche.width - breite * massstab) / 2;
  const oben = flaeche.top + (flaeche.height - hoehe * massstab) / 2;
  const x = rahmen.minX + (clientX - links) / massstab;
  const y = rahmen.maxY - (clientY - oben) / massstab;
  const runden = (v: number) => Math.max(-1_000_000, Math.min(1_000_000, Math.round(v / raster) * raster));
  return { x_mm: runden(x), y_mm: runden(y) };
}
