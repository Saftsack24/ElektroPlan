/**
 * Leitungen im Grundriss (Phase 6b.5, Entwurf §5.5/§9.2) - reine Hilfen.
 *
 * Der Grundriss ist die Draufsicht auf die FFB-Ebene. Hier entstehen
 * Fußbodenpunkte, grobe Wand- und Deckenpunkte, Bodenübergänge, neue
 * Durchführungen und Steigwegnutzungen. Gerechnet wird ausschließlich mit der
 * gemeinsamen Längenfunktion (`laenge.ts`); diese Datei liefert nur Lagen,
 * Fangziele und Zeichenstrecken. Nichts ergänzt still einen Wegpunkt.
 */
import type { Punkt } from "../editor/geometrie";
import { punktImPolygon } from "../geraete/geraetepruefung";
import type { Leitungsergebnis, VorbereiteterPlan, Wegpunkt } from "./laenge";
import { gerundeteLage } from "./laenge";

/** Ebene, auf der ein Klick im Grundriss einen Wegpunkt setzt. Ändert nie vorhandene Punkte. */
export type Ebene = "fussboden" | "wand" | "decke";

export const EBENE_LABEL: Record<Ebene, string> = { fussboden: "Fußboden", wand: "Wand", decke: "Decke" };

/**
 * Höhe neuer Wandpunkte im Grundriss: fest über dem Boden, an der Decke (Übergang) oder in der
 * oberen Zone 300 mm unter der Decke - dieselben Werte wie die Zonenhilfslinien der Wandansicht.
 */
export type Wandhoehe = number | "decke" | "obere-zone";

/** Abstand der oberen Zone unter der Decke (wie `zonenlinien`). */
export const OBERE_ZONE_MM = 300;

/** Höhe in mm für einen Raum dieser Höhe - nie über der Raumhöhe, nie unter 0. */
export function wandhoeheIn(h: Wandhoehe, raumHoeheMm: number): number {
  const wert = h === "decke" ? raumHoeheMm : h === "obere-zone" ? raumHoeheMm - OBERE_ZONE_MM : h;
  return Math.max(0, Math.min(wert, raumHoeheMm));
}

type Wandinfo = VorbereiteterPlan["waende"] extends ReadonlyMap<string, infer W> ? W : never;

/** Punkt auf der Wandachse bei `abstandMm` ab Wandanfang (Zeichnung; darf gebrochen sein). */
export function achsenpunkt(info: Wandinfo, abstandMm: number): Punkt {
  const { start, ende } = info.wand;
  const t = info.laengeMm === 0 ? 0 : abstandMm / info.laengeMm;
  return { x: start.x + (ende.x - start.x) * t, y: start.y + (ende.y - start.y) * t };
}

/**
 * Nächster **ganzzahliger** Achspunkt einer Wand (Gitter der Wandschritte) mit
 * seinem Abstand ab Wandanfang - nur dort gelingt ein exakter Übergang
 * Wand ↔ Fußboden/Decke. `abstandMm` ist `null`, wenn er nicht ganzzahlig ist.
 */
export function achsgitterpunkt(info: Wandinfo, p: Punkt): { punkt: Punkt; abstandMm: number | null; querMm: number } {
  const s = { x: info.schrittX, y: info.schrittY };
  const m = info.teilung.mass.m;
  const dx = p.x - info.wand.start.x;
  const dy = p.y - info.wand.start.y;
  const j = Math.min(info.schritte, Math.max(0, Math.round((dx * s.x + dy * s.y) / m)));
  const punkt = { x: info.wand.start.x + j * s.x, y: info.wand.start.y + j * s.y };
  const wurzel = info.teilung.mass.wurzel;
  const abstandMm = j === info.schritte ? info.laengeMm : wurzel === null ? (j === 0 ? 0 : null) : j * wurzel;
  const querMm = Math.abs(dx * s.y - dy * s.x) / Math.sqrt(m);
  return { punkt, abstandMm, querMm };
}

/** Räume eines Geschosses, deren geschlossene Kontur den Punkt enthält (Rand zählt). */
export function raeumeAn(v: VorbereiteterPlan, floorId: string, p: Punkt): string[] {
  const treffer: string[] = [];
  for (const raum of v.raeume.values()) {
    if (raum.geschossId !== floorId || v.konturGueltig.get(raum.id) !== true) continue;
    const polygon = v.polygone.get(raum.id) ?? [];
    if (punktImPolygon(p, polygon) || aufRand(polygon, p)) treffer.push(raum.id);
  }
  return treffer;
}

function aufRand(polygon: readonly Punkt[], p: Punkt): boolean {
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i] as Punkt;
    const b = polygon[(i + 1) % polygon.length] as Punkt;
    const quer = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (quer !== 0) continue;
    if (Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)) return true;
  }
  return false;
}

/**
 * Raum eines neuen Fußboden- oder Deckenpunkts: eindeutig, sonst der Raum, in
 * dem der Zeiger wirklich liegt, sonst der des Vorgängers. Liegt der Punkt in
 * keinem Raum, gibt es keinen - nie einen geratenen.
 */
export function raumFuer(v: VorbereiteterPlan, floorId: string, punkt: Punkt, roh: Punkt, vorgaengerRaum: string | null): string | null {
  const kandidaten = raeumeAn(v, floorId, punkt);
  if (kandidaten.length === 1) return kandidaten[0] as string;
  if (kandidaten.length === 0) return null;
  // Strikt innen: Auf dem Rand liegt der Zeiger in keinem der beiden Räume wirklich.
  const echt = kandidaten.filter((id) => {
    const polygon = v.polygone.get(id) ?? [];
    return punktImPolygon(roh, polygon) && !aufRand(polygon, roh);
  });
  if (echt.length === 1) return echt[0] as string;
  if (vorgaengerRaum !== null && kandidaten.includes(vorgaengerRaum)) return vorgaengerRaum;
  return null;
}

/** Raum eines Wegpunkts - für „derselbe Raum wie vorher“; `null` bei Steigweg/Übergang. */
export function raumVon(v: VorbereiteterPlan, wp: Wegpunkt | undefined): string | null {
  if (wp === undefined) return null;
  if (wp.art === "floor" || wp.art === "ceiling") return wp.raumId;
  if (wp.art === "wand") return v.waende.get(wp.wandId)?.raum.id ?? null;
  return null;
}

/** Geschoss eines Wegpunkts - Steigwege verbinden zwei, darum dort das Zielgeschoss. */
export function geschossVon(v: VorbereiteterPlan, wp: Wegpunkt, steigwegZiel: (wp: Extract<Wegpunkt, { art: "steigweg" }>) => string | null): string | null {
  switch (wp.art) {
    case "floor":
    case "ceiling":
      return v.raeume.get(wp.raumId)?.geschossId ?? null;
    case "wand":
    case "uebergang":
      return v.waende.get(wp.wandId)?.raum.geschossId ?? null;
    case "durchfuehrung": {
      const d = v.durchfuehrungen.get(wp.durchfuehrungId);
      const k = d === undefined ? undefined : v.kopplungen.get(d.kopplungId);
      return k === undefined ? null : (v.waende.get(k.wandA)?.raum.geschossId ?? null);
    }
    case "steigweg":
      return steigwegZiel(wp);
  }
}

// ------------------------------------------------------------------ Fang

export interface Fangpunkt {
  readonly punkt: Punkt;
  readonly text: string;
}

export interface Fangergebnis {
  readonly punkt: Punkt;
  /** Eingerastetes Ziel - `null` bei Raster oder freiem Punkt. */
  readonly text: string | null;
}

/**
 * Fang im Grundriss: das nächste ausdrückliche Ziel im Radius, sonst Raster,
 * sonst ganze Millimeter. Alt (bzw. ausgeschalteter Fang) setzt ihn aus.
 */
export function grundrissFangen(roh: Punkt, ziele: readonly Fangpunkt[], f: { aktiv: boolean; ausgesetzt: boolean; radiusMm: number; rasterMm: number }): Fangergebnis {
  if (f.aktiv && !f.ausgesetzt) {
    let bestes: Fangpunkt | null = null;
    let abstand = f.radiusMm;
    for (const z of ziele) {
      const d = Math.hypot(z.punkt.x - roh.x, z.punkt.y - roh.y);
      if (d <= abstand) {
        bestes = z;
        abstand = d;
      }
    }
    if (bestes !== null) return { punkt: bestes.punkt, text: bestes.text };
    return { punkt: { x: Math.round(roh.x / f.rasterMm) * f.rasterMm + 0, y: Math.round(roh.y / f.rasterMm) * f.rasterMm + 0 }, text: null };
  }
  return { punkt: { x: Math.round(roh.x) + 0, y: Math.round(roh.y) + 0 }, text: null };
}

// ------------------------------------------------------------------ Zeichnen

export type Planflaeche = "wand" | "decke" | "fussboden";

export interface Planstrecke {
  readonly flaeche: Planflaeche;
  readonly a: Punkt;
  readonly b: Punkt;
  /** Wand der Strecke - für die Raumseite. */
  readonly wandId: string | null;
}

/**
 * Läufe eines Ergebnisses auf diesem Geschoss - abgeleitet, nie gespeichert.
 * Wandläufe auf der Achse (einmal gerundet wie die Länge), Flächenläufe exakt.
 * Senkrechte Läufe (Wand, Steigweg, Schacht) erscheinen im Grundriss nicht als
 * Strecke; Steigwege zeigt der Grundriss als Übergang an ihrem Halt.
 */
export function grundrissstrecken(v: VorbereiteterPlan, ergebnis: Leitungsergebnis, floorId: string): Planstrecke[] {
  const strecken: Planstrecke[] = [];
  for (const s of ergebnis.strecken) {
    for (const l of s.laeufe) {
      if (l.typ === "wand") {
        const info = v.waende.get(l.wandId);
        if (info === undefined || info.raum.geschossId !== floorId) continue;
        const a = achsenpunkt(info, gerundeteLage(l.vonLage, l.mass));
        const b = achsenpunkt(info, gerundeteLage(l.bisLage, l.mass));
        if (a.x === b.x && a.y === b.y) continue;
        strecken.push({ flaeche: "wand", a, b, wandId: l.wandId });
      } else if (l.typ === "flaeche") {
        if (v.raeume.get(l.raumId)?.geschossId !== floorId) continue;
        if (l.start.x === l.ende.x && l.start.y === l.ende.y) continue;
        strecken.push({ flaeche: l.flaeche === "floor" ? "fussboden" : "decke", a: l.start, b: l.ende, wandId: null });
      }
    }
  }
  return strecken;
}

/**
 * Richtung zur Raumseite einer Wand (Einheitsvektor) - Wandwege liegen im
 * Grundriss an der Raumseite, nicht auf der Achse. `null` bei ungültiger Kontur.
 */
export function raumseite(v: VorbereiteterPlan, wandId: string): Punkt | null {
  const info = v.waende.get(wandId);
  const polygon = info === undefined ? undefined : v.polygone.get(info.raum.id);
  if (info === undefined || polygon === undefined || polygon.length < 3) return null;
  const { start, ende } = info.wand;
  const laenge = Math.hypot(ende.x - start.x, ende.y - start.y);
  if (laenge === 0) return null;
  const n = { x: -(ende.y - start.y) / laenge, y: (ende.x - start.x) / laenge };
  const mitte = { x: (start.x + ende.x) / 2, y: (start.y + ende.y) / 2 };
  const probe = Math.min(20, laenge / 4);
  if (punktImPolygon({ x: mitte.x + n.x * probe, y: mitte.y + n.y * probe }, polygon)) return n;
  if (punktImPolygon({ x: mitte.x - n.x * probe, y: mitte.y - n.y * probe }, polygon)) return { x: -n.x, y: -n.y };
  return null;
}
