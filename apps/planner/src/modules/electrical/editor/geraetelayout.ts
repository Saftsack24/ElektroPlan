/**
 * Lage der Gerätesymbole im Grundriss (Phase 5) - reine Bildschirmdarstellung.
 *
 * Getrennt werden ausdrücklich:
 *
 * - der **Montagepunkt**: die tatsächliche, gespeicherte Lage, in den
 *   Grundriss projiziert (Wandgerät: auf der Wandoberfläche seiner
 *   Montageseite, innen bzw. außen; Deckengerät: seine x/y-Lage), und
 * - die **Symbolposition**: wo das Symbol lesbar gezeichnet wird.
 *
 * Ohne Konflikt steht das Symbol direkt am Montagepunkt (Wand: knapp davor auf
 * der Montageseite). Würden sich Symbole decken, rücken sie innerhalb einer
 * kleinen Gruppe entlang der Wand auseinander; jedes versetzte Symbol erhält
 * eine **Zuordnungslinie** zu seinem markierten Montagepunkt. Mehr als
 * {@link MAX_FAECHER} Symbole an einer Stelle werden zu einem **Gruppensymbol**
 * mit Anzahl zusammengefasst - statt immer weiterer Verschiebung. Aufgeklappt
 * stehen die Mitglieder in Ringen dicht um die Gruppe, jedes mit Linie.
 *
 * Nichts davon wird gespeichert oder an die API gesendet; die Berechnung ist
 * deterministisch (Sortierung nach Geräte-ID) und hängt nur von Gerätedaten
 * und Viewport ab. Innen- und Außengeräte derselben Wand fallen nie in eine
 * Gruppe: Ihre Symbole stehen auf verschiedenen Seiten der Wand.
 */

import type { Punkt } from "./geometrie";
import { weltZuBild, type Bildpunkt, type Viewport } from "./viewport";

/** Kantenlänge eines Symbols in Bildpixeln. */
export const SYMBOLGROESSE = 18;
/** Abstand der Symbolmitten innerhalb einer aufgefächerten Gruppe. */
export const SYMBOLABSTAND = SYMBOLGROESSE + 4;
/** Bis zu so vielen Symbolen wird eine Stelle aufgefächert, darüber gruppiert. */
export const MAX_FAECHER = 4;
/** Abstand des Wandsymbols von der Wandoberfläche (Mitte), Bildpixel. */
const VOR_DER_WAND = SYMBOLGROESSE / 2 + 3;
/**
 * Aufgefächerte Symbole rücken zusätzlich so weit vom Montagepunkt ab
 * (Wand: weiter in die Montageseite, Decke: nach oben) - damit die
 * Zuordnungslinie lang genug ist, um sie zu erkennen.
 */
const ABRUECKEN = 14;

/** Eingabe je Gerät - aus {@link Geraetedarstellung}. */
export interface LayoutGeraet {
  readonly id: string;
  /** Lage auf der Wandachse bzw. Deckenlage, Weltkoordinaten. */
  readonly anker: Punkt;
  /** Halbe Wandstärke zur Montageseite in mm; Decke: 0. */
  readonly versatzMm: number;
  /** Einheitsvektor zur Montageseite im Grundriss; Decke oder unbekannt: (0, 0). */
  readonly richtung: Punkt;
  readonly decke: boolean;
}

export interface Symbollage {
  readonly id: string;
  /** Tatsächlicher Montagepunkt im Bild. */
  readonly montage: Bildpunkt;
  /** Wo das Symbol gezeichnet wird. */
  readonly symbol: Bildpunkt;
  /** Symbol zur Kollisionsvermeidung verschoben - Linie und Markierung zeigen. */
  readonly versetzt: boolean;
}

export interface Geraetegruppe {
  /** Stabiler Schlüssel: kleinste Geräte-ID der Gruppe. */
  readonly schluessel: string;
  /** Lage des Gruppensymbols (Schwerpunkt der eigentlichen Symbolpositionen). */
  readonly lage: Bildpunkt;
  /** Mitglieder, sortiert nach ID, mit Montagepunkt und aufgeklappter Lage. */
  readonly mitglieder: readonly Symbollage[];
}

export interface Geraetelayout {
  /** Einzeln gezeichnete Symbole (auch aufgefächerte). */
  readonly einzeln: readonly Symbollage[];
  /** Zusammengefasste Stellen. */
  readonly gruppen: readonly Geraetegruppe[];
}

interface Basis {
  readonly g: LayoutGeraet;
  readonly montage: Bildpunkt;
  readonly natuerlich: Bildpunkt;
  /** Richtung entlang der Wand im Bild (Auffächerung). */
  readonly entlang: Bildpunkt;
  /** Richtung weg vom Montagepunkt im Bild (Wand: Montageseite, Decke: oben). */
  readonly weg: Bildpunkt;
}

function abstand(a: Bildpunkt, b: Bildpunkt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function basisVon(viewport: Viewport, g: LayoutGeraet): Basis {
  const montage = weltZuBild(viewport, { x: g.anker.x + g.richtung.x * g.versatzMm, y: g.anker.y + g.richtung.y * g.versatzMm });
  const wand = !g.decke && (g.richtung.x !== 0 || g.richtung.y !== 0);
  // Bild-y zeigt nach unten: y der Grundrissrichtung spiegeln.
  const natuerlich = wand ? { x: montage.x + g.richtung.x * VOR_DER_WAND, y: montage.y - g.richtung.y * VOR_DER_WAND } : montage;
  // Wandrichtung im Bild = Normale um 90° gedreht; eindeutig ausgerichtet (nach rechts bzw. unten).
  let entlang: Bildpunkt = wand ? { x: g.richtung.y, y: g.richtung.x } : { x: 1, y: 0 };
  if (entlang.x < 0 || (entlang.x === 0 && entlang.y < 0)) entlang = { x: -entlang.x, y: -entlang.y };
  const weg = wand ? { x: g.richtung.x, y: -g.richtung.y } : { x: 0, y: -1 };
  return { g, montage, natuerlich, entlang, weg };
}

/** Auffächerung um den Schwerpunkt entlang der Wand - Reihenfolge nach Lage, dann ID. */
function faecher(gruppe: readonly Basis[]): Symbollage[] {
  if (gruppe.length === 1) {
    const b = gruppe[0] as Basis;
    return [{ id: b.g.id, montage: b.montage, symbol: b.natuerlich, versetzt: false }];
  }
  const { entlang: e, weg } = gruppe[0] as Basis;
  const schwer = schwerpunkt(gruppe.map((b) => b.natuerlich));
  const mitte = { x: schwer.x + weg.x * ABRUECKEN, y: schwer.y + weg.y * ABRUECKEN };
  const geordnet = [...gruppe].sort((a, b) => {
    const d = (a.montage.x - b.montage.x) * e.x + (a.montage.y - b.montage.y) * e.y;
    return Math.abs(d) > 1e-9 ? d : a.g.id < b.g.id ? -1 : 1;
  });
  return geordnet.map((b, i) => {
    const s = (i - (geordnet.length - 1) / 2) * SYMBOLABSTAND;
    return { id: b.g.id, montage: b.montage, symbol: { x: mitte.x + e.x * s, y: mitte.y + e.y * s }, versetzt: true };
  });
}

function schwerpunkt(punkte: readonly Bildpunkt[]): Bildpunkt {
  const n = punkte.length || 1;
  return { x: punkte.reduce((s, p) => s + p.x, 0) / n, y: punkte.reduce((s, p) => s + p.y, 0) / n };
}

/**
 * Aufgeklappte Lage der Gruppenmitglieder: Ringe um das Gruppensymbol
 * (erster Ring 8 Plätze, jeder weitere 8 mehr) - kompakt, nahe am Ort.
 */
export function aufgeklappt(lage: Bildpunkt, anzahl: number): Bildpunkt[] {
  const lagen: Bildpunkt[] = [];
  let ring = 0;
  while (lagen.length < anzahl) {
    const plaetze = 8 * (ring + 1);
    const radius = 2 * SYMBOLABSTAND * (ring + 1) * 0.75 + 4;
    for (let i = 0; i < plaetze && lagen.length < anzahl; i += 1) {
      const w = -Math.PI / 2 + (2 * Math.PI * i) / plaetze;
      lagen.push({ x: lage.x + radius * Math.cos(w), y: lage.y + radius * Math.sin(w) });
    }
    ring += 1;
  }
  return lagen;
}

/**
 * Symbollagen für alle Geräte. Stellen, deren Symbole sich decken würden,
 * werden zusammengefasst (transitiv); eine aufgefächerte Stelle, die dadurch
 * eine andere berührt, wird mit ihr vereinigt - solange, bis nichts mehr
 * kollidiert. Endlich: Jede Runde verringert die Zahl der Stellen.
 */
export function geraetelayout(geraete: readonly LayoutGeraet[], viewport: Viewport): Geraetelayout {
  const basen = [...geraete].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((g) => basisVon(viewport, g));
  // Union-Find über die natürlichen Symbollagen.
  const eltern = basen.map((_, i) => i);
  const wurzel = (i: number): number => {
    let r = i;
    while (eltern[r] !== r) r = eltern[r] as number;
    eltern[i] = r;
    return r;
  };
  const vereinige = (a: number, b: number): boolean => {
    const ra = wurzel(a);
    const rb = wurzel(b);
    if (ra === rb) return false;
    eltern[Math.max(ra, rb)] = Math.min(ra, rb);
    return true;
  };
  for (let i = 0; i < basen.length; i += 1) {
    for (let j = i + 1; j < basen.length; j += 1) {
      if (abstand((basen[i] as Basis).natuerlich, (basen[j] as Basis).natuerlich) < SYMBOLGROESSE) vereinige(i, j);
    }
  }

  for (;;) {
    const stellen = new Map<number, number[]>();
    basen.forEach((_, i) => {
      const r = wurzel(i);
      stellen.set(r, [...(stellen.get(r) ?? []), i]);
    });
    // Je Stelle: aufgefächert (bis MAX_FAECHER) oder ein Gruppensymbol.
    const belegung: { stelle: number; punkt: Bildpunkt }[] = [];
    for (const [r, idx] of stellen) {
      const gruppe = idx.map((i) => basen[i] as Basis);
      if (gruppe.length > MAX_FAECHER) belegung.push({ stelle: r, punkt: schwerpunkt(gruppe.map((b) => b.natuerlich)) });
      else for (const s of faecher(gruppe)) belegung.push({ stelle: r, punkt: s.symbol });
    }
    let geaendert = false;
    for (let i = 0; i < belegung.length; i += 1) {
      for (let j = i + 1; j < belegung.length; j += 1) {
        const a = belegung[i] as { stelle: number; punkt: Bildpunkt };
        const b = belegung[j] as { stelle: number; punkt: Bildpunkt };
        if (a.stelle !== b.stelle && abstand(a.punkt, b.punkt) < SYMBOLGROESSE) geaendert = vereinige(a.stelle, b.stelle) || geaendert;
      }
    }
    if (!geaendert) break;
  }

  const stellen = new Map<number, Basis[]>();
  basen.forEach((b, i) => {
    const r = wurzel(i);
    stellen.set(r, [...(stellen.get(r) ?? []), b]);
  });
  const einzeln: Symbollage[] = [];
  const gruppen: Geraetegruppe[] = [];
  for (const gruppe of stellen.values()) {
    if (gruppe.length <= MAX_FAECHER) {
      einzeln.push(...faecher(gruppe));
      continue;
    }
    const lage = schwerpunkt(gruppe.map((b) => b.natuerlich));
    const plaetze = aufgeklappt(lage, gruppe.length);
    gruppen.push({
      schluessel: (gruppe[0] as Basis).g.id,
      lage,
      mitglieder: gruppe.map((b, i) => ({ id: b.g.id, montage: b.montage, symbol: plaetze[i] as Bildpunkt, versetzt: true })),
    });
  }
  return { einzeln, gruppen };
}
