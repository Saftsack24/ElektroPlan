/**
 * Geräteprüfung im Editor - Spiegel der verbindlichen Serverregeln (Phase 5, ADR 0023).
 *
 * Dieselben Regeln wie `apps/backend/app/modules/electrical/devices.py`,
 * dieselbe exakte Topologie wie 2D und 3D (`topologie/`). Gegen Drift prüfen
 * Backend und Frontend dieselbe Fixture `testdata/geometry/geraete.v1.json`.
 * Die Prüfung hier ist eine Bedienhilfe (Vorschau, Markierung); verbindlich
 * bleibt der Server.
 *
 * Bezugspunkt ist die Gerätemitte; die Gerätegeometrie ist das Planungsmaß des
 * Typs als achsparalleles Rechteck (gerade Millimeter). Berührung an einer
 * Kante ist erlaubt. Keine erfundenen Sicherheitsabstände.
 */
import type { Punkt } from "../editor/geometrie";
import { konturbericht, streckenlaenge } from "../editor/geometrie";
import { ganzeLage, vergleichen } from "../topologie/lage";
import type { LokalerBereich } from "../topologie/oeffnungen";
import { fremdeBereiche } from "../topologie/oeffnungen";
import type { TopoWand, Wandteilung } from "../topologie/wandtopologie";
import { wandtopologie } from "../topologie/wandtopologie";

export type Flaeche = "wall_interior" | "wall_exterior" | "ceiling";

/** Was die Prüfung von einem Gerätetyp braucht. */
export interface Pruefmass {
  readonly breite: number;
  readonly hoehe: number;
  readonly innen: boolean;
  readonly aussen: boolean;
  readonly decke: boolean;
}

export interface PruefGeraet {
  readonly id: string;
  readonly raumId: string;
  readonly typ: string;
  readonly flaeche: Flaeche;
  readonly wandId: string | null;
  readonly mitte: number | null;
  readonly mittelhoehe: number | null;
  readonly x: number | null;
  readonly y: number | null;
}

export interface PruefRaum {
  readonly id: string;
  readonly hoeheMm: number;
  /** Kontur in Reihenfolge. */
  readonly waende: readonly TopoWand[];
}

export interface Befund {
  readonly code: string;
  /** Zuerst das Gerät, ggf. danach die betroffene Öffnung oder das andere Gerät. */
  readonly keys: readonly string[];
}

/** Rechteck in Wandkoordinaten (Abstand, Höhe) oder im Grundriss (x, y). */
export interface Rechteck {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

export const BEFUND_TEXT: Record<string, string> = {
  "device-type-unknown": "Der Gerätetyp ist nicht bekannt.",
  "device-surface-not-allowed": "Dieser Gerätetyp ist für diese Montagefläche nicht vorgesehen.",
  "device-room-unknown": "Der Raum des Geräts fehlt.",
  "device-wall-unknown": "Das Wandgerät gehört zu keiner Wand dieses Raums.",
  "device-outside-wall": "Das Gerät ragt über den Rand der Wand hinaus.",
  "device-below-floor": "Das Gerät reicht unter den Fußboden.",
  "device-exceeds-room-height": "Das Gerät reicht über die Decke hinaus.",
  "device-in-opening": "Das Gerät liegt in einer Tür-, Fenster- oder Durchgangsöffnung.",
  "device-exterior-on-shared-wall":
    "Außen montiert, aber dieses Wandstück grenzt an einen anderen Raum – dort bitte innen im Nachbarraum setzen.",
  "device-position-missing": "Dem Deckengerät fehlt die Lage.",
  "device-ceiling-contour-open": "Deckengeräte brauchen eine geschlossene Raumkontur.",
  "device-outside-room": "Das Deckengerät liegt nicht vollständig im Raum.",
  "devices-overlap": "Zwei Geräte auf derselben Fläche überdecken sich.",
};

export function befundText(code: string): string {
  return BEFUND_TEXT[code] ?? "Die Lage des Geräts ist nicht zulässig.";
}

export function erlaubtAuf(mass: Pruefmass, flaeche: Flaeche): boolean {
  return flaeche === "ceiling" ? mass.decke : flaeche === "wall_exterior" ? mass.aussen : mass.innen;
}

export function ueberdecken(a: Rechteck, b: Rechteck): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Rechteck eines Wandgeräts in (Abstand ab Wandanfang, Höhe über FFB). */
export function wandrechteck(mitte: number, mittelhoehe: number, mass: Pick<Pruefmass, "breite" | "hoehe">): Rechteck {
  const hb = Math.floor(mass.breite / 2);
  const hh = Math.floor(mass.hoehe / 2);
  return { x0: mitte - hb, x1: mitte + hb, y0: mittelhoehe - hh, y1: mittelhoehe + hh };
}

/** Rechteck eines Deckengeräts im Grundriss. */
export function deckenrechteck(x: number, y: number, mass: Pick<Pruefmass, "breite" | "hoehe">): Rechteck {
  const hb = Math.floor(mass.breite / 2);
  const hh = Math.floor(mass.hoehe / 2);
  return { x0: x - hb, x1: x + hb, y0: y - hh, y1: y + hh };
}

// ------------------------------------------------------------------ Wand

/**
 * Befunde eines Wandgeräts auf seiner Wand. `teilung` ist die exakte Teilung
 * dieser Wand im gezeigten Stand des Geschosses (eigene und Nachbarwände).
 */
export function wandgeraetBefunde(
  id: string,
  flaeche: Flaeche,
  r: Rechteck,
  wand: { readonly start: Punkt; readonly ende: Punkt; readonly oeffnungen: TopoWand["oeffnungen"] },
  raumhoeheMm: number,
  teilung: Wandteilung<TopoWand> | undefined,
): Befund[] {
  const befunde: Befund[] = [];
  const laenge = streckenlaenge(wand.start, wand.ende);
  if (r.x0 < 0 || r.x1 > laenge) befunde.push({ code: "device-outside-wall", keys: [id] });
  if (r.y0 < 0) befunde.push({ code: "device-below-floor", keys: [id] });
  if (r.y1 > raumhoeheMm) befunde.push({ code: "device-exceeds-room-height", keys: [id] });
  for (const o of wand.oeffnungen) {
    const flaecheO = { x0: o.offsetMm, x1: o.offsetMm + o.breiteMm, y0: o.bruestungMm, y1: o.bruestungMm + o.hoeheMm };
    if (ueberdecken(r, flaecheO)) befunde.push({ code: "device-in-opening", keys: [id, o.oeffnungId] });
  }
  if (teilung === undefined) return befunde;
  const { mass } = teilung;
  const bereich: LokalerBereich = { s0: ganzeLage(r.x0), s1: ganzeLage(r.x1) };
  const ueberlappt = (b: LokalerBereich) => vergleichen(bereich.s0, b.s1, mass) < 0 && vergleichen(b.s0, bereich.s1, mass) < 0;
  for (const f of fremdeBereiche(teilung)) {
    const quelle = teilungsquelle(teilung, f.wandId, f.oeffnungId);
    if (quelle === undefined) continue;
    const senkrecht = r.y0 < quelle.bruestungMm + quelle.hoeheMm && quelle.bruestungMm < r.y1;
    if (senkrecht && ueberlappt(f.bereich)) befunde.push({ code: "device-in-opening", keys: [id, f.oeffnungId] });
  }
  if (flaeche === "wall_exterior") {
    const geteilt = teilung.abschnitte.some((a, i) => {
      if (a.lage !== "gemeinsam") return false;
      const s0 = teilung.grenzen[i];
      const s1 = teilung.grenzen[i + 1];
      return s0 !== undefined && s1 !== undefined && ueberlappt({ s0, s1 });
    });
    if (geteilt) befunde.push({ code: "device-exterior-on-shared-wall", keys: [id] });
  }
  return befunde;
}

function teilungsquelle(teilung: Wandteilung<TopoWand>, wandId: string, oeffnungId: string) {
  for (const a of teilung.abschnitte) {
    const q = a.quellen.find((x) => x.wand.id === wandId);
    const o = q?.wand.oeffnungen.find((x) => x.oeffnungId === oeffnungId);
    if (o !== undefined) return o;
  }
  return undefined;
}

// ----------------------------------------------------------------- Decke

/** Bruch `z / n` mit `n > 0` - für exakte Vergleiche ohne Gleitkomma. */
interface Bruch {
  readonly z: number;
  readonly n: number;
}

function bruch(z: number, n: number): Bruch {
  return n < 0 ? { z: -z, n: -n } : { z, n };
}

function kleiner(a: Bruch, b: Bruch): boolean {
  return a.z * b.n < b.z * a.n;
}

/** Berührt die Strecke `a-b` das **offene** Innere des Rechtecks? Exakt (Liang-Barsky). */
export function streckeImInneren(a: Punkt, b: Punkt, r: Rechteck): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let unten: Bruch = { z: 0, n: 1 };
  let oben: Bruch = { z: 1, n: 1 };
  const kanten: [number, number][] = [
    [-dx, a.x - r.x0],
    [dx, r.x1 - a.x],
    [-dy, a.y - r.y0],
    [dy, r.y1 - a.y],
  ];
  for (const [p, q] of kanten) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const grenze = bruch(q, p);
    if (p < 0) {
      if (kleiner(unten, grenze)) unten = grenze;
    } else if (kleiner(grenze, oben)) oben = grenze;
  }
  return kleiner(unten, oben);
}

/** Strahlverfahren, exakt ganzzahlig. Ein Punkt auf dem Rand gilt hier als außen. */
export function punktImPolygon(p: Punkt, polygon: readonly Punkt[]): boolean {
  let innen = false;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i] as Punkt;
    const b = polygon[(i + 1) % polygon.length] as Punkt;
    if (a.y > p.y === b.y > p.y) continue;
    const zaehler = (p.y - a.y) * (b.x - a.x);
    const nenner = b.y - a.y;
    const links = (p.x - a.x) * nenner;
    if (nenner > 0 ? links < zaehler : links > zaehler) innen = !innen;
  }
  return innen;
}

/** Liegt das Rechteck vollständig in der Kontur? Keine Kante durchs Innere, Mitte innen. */
export function rechteckImPolygon(r: Rechteck, polygon: readonly Punkt[]): boolean {
  for (let i = 0; i < polygon.length; i += 1) {
    if (streckeImInneren(polygon[i] as Punkt, polygon[(i + 1) % polygon.length] as Punkt, r)) return false;
  }
  return punktImPolygon({ x: Math.floor((r.x0 + r.x1) / 2), y: Math.floor((r.y0 + r.y1) / 2) }, polygon);
}

/** Befunde eines Deckengeräts in seinem Raum (Kontur in Reihenfolge). */
export function deckengeraetBefunde(id: string, r: Rechteck, waende: readonly { start: Punkt; ende: Punkt; id: string }[]): Befund[] {
  const bericht = konturbericht(waende.map((w) => ({ key: w.id, start: w.start, ende: w.ende })));
  if (bericht.status !== "valid") return [{ code: "device-ceiling-contour-open", keys: [id] }];
  return rechteckImPolygon(r, waende.map((w) => w.start)) ? [] : [{ code: "device-outside-room", keys: [id] }];
}

// ------------------------------------------------------------- Gesamtheit

/**
 * Alle Befunde der Geräte eines Geschosses - deterministisch nach Geräte-ID,
 * genau wie `device_problems` im Backend.
 */
export function geraetebefunde(
  floorId: string,
  raeume: readonly PruefRaum[],
  geraete: readonly PruefGeraet[],
  typen: ReadonlyMap<string, Pruefmass>,
): Befund[] {
  const nachRaum = new Map(raeume.map((r) => [r.id, r]));
  const topologie = wandtopologie(floorId, raeume.flatMap((r) => r.waende));
  const befunde: Befund[] = [];
  const flaechen = new Map<string, { id: string; r: Rechteck }[]>();

  for (const g of [...geraete].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const mass = typen.get(g.typ);
    if (mass === undefined) {
      befunde.push({ code: "device-type-unknown", keys: [g.id] });
      continue;
    }
    if (!erlaubtAuf(mass, g.flaeche)) {
      befunde.push({ code: "device-surface-not-allowed", keys: [g.id] });
      continue;
    }
    const raum = nachRaum.get(g.raumId);
    if (raum === undefined) {
      befunde.push({ code: "device-room-unknown", keys: [g.id] });
      continue;
    }
    let r: Rechteck | null = null;
    let schluessel = "";
    if (g.flaeche === "ceiling") {
      if (g.x === null || g.y === null) {
        befunde.push({ code: "device-position-missing", keys: [g.id] });
        continue;
      }
      const eigene = deckengeraetBefunde(g.id, deckenrechteck(g.x, g.y, mass), raum.waende);
      befunde.push(...eigene);
      if (eigene.some((b) => b.code === "device-ceiling-contour-open")) continue;
      r = deckenrechteck(g.x, g.y, mass);
      schluessel = `${raum.id}|ceiling`;
    } else {
      const wand = raum.waende.find((w) => w.id === g.wandId);
      if (wand === undefined || g.mitte === null || g.mittelhoehe === null) {
        befunde.push({ code: "device-wall-unknown", keys: [g.id] });
        continue;
      }
      r = wandrechteck(g.mitte, g.mittelhoehe, mass);
      befunde.push(...wandgeraetBefunde(g.id, g.flaeche, r, wand, raum.hoeheMm, topologie.teilung.get(wand.id)));
      schluessel = `${wand.id}|${g.flaeche}`;
    }
    const liste = flaechen.get(schluessel) ?? [];
    liste.push({ id: g.id, r });
    flaechen.set(schluessel, liste);
  }

  for (const liste of flaechen.values()) {
    liste.forEach((a, i) => {
      for (const b of liste.slice(i + 1)) {
        if (!ueberdecken(a.r, b.r)) continue;
        befunde.push({ code: "devices-overlap", keys: [a.id, b.id] }, { code: "devices-overlap", keys: [b.id, a.id] });
      }
    });
  }
  return befunde;
}
