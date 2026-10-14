/**
 * Leitungen in der 3D-Ansicht (Phase 6b.5, Entwurf §9.2) - abgeleitet, nie gespeichert.
 *
 * Quelle sind ausschließlich die Teilstrecken des Servers (`CableOut.segments`,
 * absolute Höhen) des **gespeicherten** Stands. Jede Teilstrecke bleibt ein
 * eigener Linienzug: Nichts wird verbunden, was der Server nicht als Lauf
 * liefert - so entstehen keine falschen Verbindungen. Steigwege und
 * Schachtfortsetzungen werden an den Grenzen des gezeigten Geschosses gekappt;
 * an jeder Kappung steht eine ausdrückliche Fortsetzung ins Nachbargeschoss.
 *
 * Darstellung (ADR 0018): Wandläufe knapp vor der Raumseite der Wand,
 * Deckenläufe knapp unter, Fußbodenläufe knapp über der Fläche. Der Status
 * zeigt sich in Strichart und Farbe und steht immer auch als Text daneben.
 */
import type { components } from "@elektroplan/api-client";

type CableOut = components["schemas"]["CableOut"];

export type Leitungsstatus3d = "confirmed" | "incomplete" | "conflict";

export const LEITUNGSSTATUS_TEXT: Record<Leitungsstatus3d, string> = {
  confirmed: "bestätigt",
  incomplete: "unvollständig",
  conflict: "Konflikt",
};

/** Punkt im Grundriss (mm) mit Höhe über dem FFB des gezeigten Geschosses (mm). */
export interface Punkt3d {
  readonly x: number;
  readonly y: number;
  readonly h: number;
}

export type Leitungsflaeche3d = "wand" | "decke" | "fussboden" | "steigweg";

export interface Leitungsstueck3d {
  readonly flaeche: Leitungsflaeche3d;
  readonly punkte: readonly Punkt3d[];
  /** Wand bzw. Raum der Teilstrecke - für „passende Bearbeitungsfläche“. */
  readonly wandId: string | null;
  readonly raumId: string | null;
}

export interface Fortsetzung3d {
  readonly punkt: Punkt3d;
  readonly floorId: string;
  readonly text: string;
}

export interface Leitung3d {
  readonly id: string;
  readonly bezeichnung: string;
  readonly status: Leitungsstatus3d;
  readonly laengeMm: number | null;
  readonly bekanntMm: number;
  readonly stuecke: readonly Leitungsstueck3d[];
  readonly fortsetzungen: readonly Fortsetzung3d[];
}

export interface Geschoss3d {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly elevation_mm: number;
  readonly default_ceiling_height_mm: number;
}

/** Abstand der gezeichneten Linie von ihrer Fläche (mm) - sonst verschwände sie in Wand oder Boden. */
const VERSATZ_MM = 15;

export interface Leitungsumgebung {
  readonly floorId: string;
  readonly geschosse: readonly Geschoss3d[];
  /** Raumseite einer Wand (Einheitsvektor im Grundriss) und ihre halbe Stärke - sonst `null`. */
  raumseite(wandId: string): { readonly x: number; readonly y: number; readonly halbeStaerkeMm: number } | null;
  /** Raum einer Wand - `null`, wenn die Wand nicht auf diesem Geschoss liegt. */
  raumDerWand(wandId: string): string | null;
  bezeichnung(cable: CableOut): string;
}

/** Höhenband des Geschosses: vom eigenen FFB bis zum FFB des nächsthöheren (sonst Standardhöhe). */
export function geschossband(geschosse: readonly Geschoss3d[], floorId: string): { unten: number; oben: number } | null {
  const g = geschosse.find((x) => x.id === floorId);
  if (g === undefined) return null;
  const hoeher = geschosse.filter((x) => x.level > g.level).sort((a, b) => a.level - b.level)[0];
  return { unten: g.elevation_mm, oben: hoeher !== undefined && hoeher.elevation_mm > g.elevation_mm ? hoeher.elevation_mm : g.elevation_mm + g.default_ceiling_height_mm };
}

type P = { x: number; y: number; z: number };

/** Erster Punkt des Linienzugs auf Höhe `z` (Schnitt einer Teilstrecke oder ein Punkt genau dort). */
function aufHoehe(punkte: readonly P[], z: number): P | null {
  for (let i = 0; i < punkte.length; i += 1) {
    const a = punkte[i] as P;
    if (a.z === z) return a;
    const b = punkte[i + 1];
    if (b !== undefined && (a.z - z) * (b.z - z) < 0) {
      const t = (z - a.z) / (b.z - a.z);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z };
    }
  }
  return null;
}

/**
 * Linienzug in absoluten Höhen auf das Band `[unten, oben]` kappen. Liefert die
 * Teile im Band (ohne Nullstücke) und die Stellen, an denen er ins Nachbar-
 * geschoss weitergeht: nach oben, wenn er die obere Grenze erreicht; nach unten,
 * wenn er von unterhalb kommt. Ein Steigweg, der hier beginnt, hat unten keine Fortsetzung.
 */
export function kappen(punkte: readonly P[], unten: number, oben: number): { teile: P[][]; grenzen: { punkt: P; seite: "oben" | "unten" }[] } {
  const teile: P[][] = [];
  let aktuell: P[] = [];
  const innen = (z: number) => unten <= z && z <= oben;
  const schnitt = (a: P, b: P, z: number): P => {
    const t = (z - a.z) / (b.z - a.z);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z };
  };
  punkte.forEach((p, i) => {
    const vor = punkte[i - 1];
    if (vor !== undefined && !innen(vor.z) && !innen(p.z) && ((vor.z < unten && p.z > oben) || (vor.z > oben && p.z < unten))) {
      // Durch das ganze Band hindurch (Zwischengeschoss wird durchfahren).
      teile.push([schnitt(vor, p, vor.z < unten ? unten : oben), schnitt(vor, p, vor.z < unten ? oben : unten)]);
    } else if (vor !== undefined && innen(vor.z) !== innen(p.z)) {
      const s = schnitt(vor, p, vor.z < unten || p.z < unten ? unten : oben);
      if (innen(vor.z)) {
        aktuell.push(s);
        teile.push(aktuell);
        aktuell = [];
      } else aktuell = [s];
    }
    if (innen(p.z)) aktuell.push(p);
  });
  if (aktuell.length > 0) teile.push(aktuell);
  const gleich = (a: P, b: P) => a.x === b.x && a.y === b.y && a.z === b.z;
  const zs = punkte.map((p) => p.z);
  const min = Math.min(...zs);
  const max = Math.max(...zs);
  const grenzen: { punkt: P; seite: "oben" | "unten" }[] = [];
  const obenPunkt = max >= oben && min < oben ? aufHoehe(punkte, oben) : null;
  const untenPunkt = min < unten && max >= unten ? aufHoehe(punkte, unten) : null;
  if (untenPunkt !== null) grenzen.push({ punkt: untenPunkt, seite: "unten" });
  if (obenPunkt !== null) grenzen.push({ punkt: obenPunkt, seite: "oben" });
  return { teile: teile.filter((t) => t.length >= 2 && t.some((q) => !gleich(q, t[0] as P))), grenzen };
}

function nachbargeschoss(geschosse: readonly Geschoss3d[], floorId: string, seite: "oben" | "unten"): Geschoss3d | undefined {
  const g = geschosse.find((x) => x.id === floorId);
  if (g === undefined) return undefined;
  const andere = geschosse.filter((x) => (seite === "oben" ? x.level > g.level : x.level < g.level));
  return andere.sort((a, b) => (seite === "oben" ? a.level - b.level : b.level - a.level))[0];
}

/** Gespeicherte Leitungen als Linienzüge des gezeigten Geschosses. */
export function leitungen3d(cables: readonly CableOut[], u: Leitungsumgebung): Leitung3d[] {
  const band = geschossband(u.geschosse, u.floorId);
  if (band === null) return [];
  const ergebnis: Leitung3d[] = [];
  for (const c of cables) {
    const stuecke: Leitungsstueck3d[] = [];
    const fortsetzungen: Fortsetzung3d[] = [];
    for (const s of c.segments) {
      const punkte = s.points.map((p) => ({ x: p.x_mm, y: p.y_mm, z: p.z_mm }));
      if (punkte.length < 2) continue;
      if (s.kind === "riser" || s.kind === "shaft") {
        // Steigweg: absolute Höhen, an den Geschossgrenzen gekappt - nie über die Grenze verbunden.
        const { teile, grenzen } = kappen(punkte, band.unten, band.oben);
        for (const t of teile) stuecke.push({ flaeche: "steigweg", punkte: t.map((p) => ({ x: p.x, y: p.y, h: p.z - band.unten })), wandId: null, raumId: null });
        for (const g of grenzen) {
          const nachbar = nachbargeschoss(u.geschosse, u.floorId, g.seite);
          if (nachbar === undefined) continue;
          fortsetzungen.push({ punkt: { x: g.punkt.x, y: g.punkt.y, h: g.punkt.z - band.unten }, floorId: nachbar.id, text: `Fortsetzung in „${nachbar.name}“` });
        }
        continue;
      }
      if (s.floor_id !== u.floorId) continue;
      if (!["wall", "ceiling", "floor", "connection"].includes(s.kind)) continue;
      const lokal = punkte.map((p) => ({ x: p.x, y: p.y, h: p.z - band.unten }));
      if (lokal.every((p) => p.x === lokal[0]?.x && p.y === lokal[0]?.y && p.h === lokal[0]?.h)) continue;
      const wand = u.raumDerWand(s.owner_id) !== null ? s.owner_id : null;
      if (s.kind === "floor") {
        stuecke.push({ flaeche: "fussboden", punkte: lokal.map((p) => ({ ...p, h: p.h + VERSATZ_MM })), wandId: null, raumId: s.owner_id });
      } else if (s.kind === "ceiling" || (s.kind === "connection" && wand === null)) {
        stuecke.push({ flaeche: "decke", punkte: lokal.map((p) => ({ ...p, h: p.h - VERSATZ_MM })), wandId: null, raumId: s.owner_id });
      } else if (wand !== null) {
        const seite = u.raumseite(wand);
        const d = seite === null ? 0 : seite.halbeStaerkeMm + VERSATZ_MM;
        stuecke.push({
          flaeche: "wand",
          punkte: lokal.map((p) => ({ x: p.x + (seite?.x ?? 0) * d, y: p.y + (seite?.y ?? 0) * d, h: p.h })),
          wandId: wand,
          raumId: u.raumDerWand(wand),
        });
      }
    }
    if (stuecke.length === 0 && fortsetzungen.length === 0) continue;
    ergebnis.push({ id: c.id, bezeichnung: u.bezeichnung(c), status: c.status, laengeMm: c.length_mm, bekanntMm: c.known_mm, stuecke, fortsetzungen });
  }
  return ergebnis;
}
