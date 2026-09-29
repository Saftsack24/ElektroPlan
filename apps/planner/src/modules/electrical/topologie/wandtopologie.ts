/**
 * Exakte Wandtopologie eines Geschosses - die gemeinsame, reine Ableitung für
 * 2D-Editor und 3D-Ansicht (ADR 0016, präzisiert in Phase 4b.2).
 *
 * Jeder Raum beschreibt seine Kontur selbst (ADR 0013). Zwei Nachbarräume
 * beschreiben eine physische Wand deshalb doppelt - im realen Grundriss aber
 * selten mit denselben Endpunkten: Eine lange Flurwand liegt typischerweise
 * neben mehreren kürzeren Raumwänden. Diese Schicht erkennt solche Lagen
 * **exakt** und zerlegt sie für die Darstellung in **atomare Abschnitte**:
 *
 * * nur innerhalb desselben Geschosses (der Schlüssel enthält es),
 * * nur für Wände auf exakt derselben unendlich gedachten Geraden -
 *   geprüft über die gekürzte ganzzahlige Richtung und den ganzzahligen
 *   Geradenabstand, ohne Toleranz und ohne Runden,
 * * zerlegt an **allen** Wandendpunkten dieser Geraden; jeder Abschnitt
 *   zwischen zwei aufeinanderfolgenden Endpunkten kennt die Wände, die ihn
 *   vollständig überdecken,
 * * ein Abschnitt mit Wänden aus zwei Räumen ist „gemeinsam", mit drei oder
 *   mehr Räumen ein Konflikt („mehrdeutig"); eine bloße Berührung an einem
 *   Endpunkt (T-Stoß, Fortsetzung) ergibt keinen gemeinsamen Abschnitt.
 *
 * Die gespeicherten Wände bleiben unverändert; nichts hier wird je
 * zurückgeschrieben. Eine persistente physische Wandidentität ist bewusst
 * **nicht** Teil dieser Ableitung (T10, vor Phase 6).
 */
import { streckenlaenge } from "../editor/geometrie";
import type { Punkt } from "../editor/geometrie";
import type { Lage, Linienmass } from "./lage";
import { ganzeLage, lage, linienmass } from "./lage";

// ------------------------------------------------------------ Eingabe

export type Oeffnungsart = "door" | "window" | "passage";

/** Eine gespeicherte Öffnung an ihrer Wand - Abstand ab Wandanfang. */
export interface TopoOeffnung {
  readonly oeffnungId: string;
  readonly art: Oeffnungsart;
  readonly offsetMm: number;
  readonly breiteMm: number;
  readonly hoeheMm: number;
  readonly bruestungMm: number;
}

/** Eine gespeicherte, gerichtete Wand eines Raums. */
export interface TopoWand {
  readonly id: string;
  readonly raumId: string;
  readonly start: Punkt;
  readonly ende: Punkt;
  readonly oeffnungen: readonly TopoOeffnung[];
}

// ------------------------------------------------------------ kanonisch

/** Lexikografisch: zuerst x, dann y. */
function kleiner(a: Punkt, b: Punkt): boolean {
  return a.x < b.x || (a.x === b.x && a.y < b.y);
}

export interface KanonischeRichtung {
  readonly start: Punkt;
  readonly ende: Punkt;
  /** `true`, wenn die gespeicherte Wand entgegen der kanonischen Richtung läuft. */
  readonly umgekehrt: boolean;
}

/** Stabile Richtung einer Strecke: der lexikografisch kleinere Endpunkt zuerst. */
export function kanonisch(start: Punkt, ende: Punkt): KanonischeRichtung {
  return kleiner(ende, start) ? { start: ende, ende: start, umgekehrt: true } : { start, ende, umgekehrt: false };
}

/** Stabile ID aus fachlichen IDs - unabhängig von der Reihenfolge. */
export function gruppenId(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join("+");
}

function ggt(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

/** Die unendlich gedachte Gerade einer Strecke - exakt ganzzahlig beschrieben. */
export interface Gerade {
  /** Geschoss, gekürzte kanonische Richtung und Geradenabstand. */
  readonly schluessel: string;
  /** Kleinster Gitterschritt entlang der Geraden in kanonischer Richtung. */
  readonly dx: number;
  readonly dy: number;
  readonly mass: Linienmass;
}

/**
 * Gerade durch zwei verschiedene ganzzahlige Punkte, oder `null` für eine
 * Strecke ohne Länge. Die Richtung wird durch den größten gemeinsamen Teiler
 * gekürzt und so orientiert, dass sie der kanonischen Richtung entspricht;
 * `dy·x − dx·y` ist dann für jeden Punkt der Geraden dieselbe ganze Zahl.
 */
export function geradeVon(floorId: string, a: Punkt, b: Punkt): Gerade | null {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;
  const g = ggt(dx, dy);
  dx /= g;
  dy /= g;
  if (dx < 0 || (dx === 0 && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  const abstand = dy * a.x - dx * a.y;
  return {
    schluessel: `${floorId}|${dx + 0},${dy + 0}|${abstand + 0}`,
    dx: dx + 0,
    dy: dy + 0,
    mass: linienmass(dx * dx + dy * dy),
  };
}

// ------------------------------------------------------------ Ergebnis

export interface Abschnittsquelle<W extends TopoWand> {
  readonly wand: W;
  /** Läuft die Quellwand entgegen der kanonischen Richtung des Abschnitts? */
  readonly umgekehrt: boolean;
  /**
   * Bereich des Abschnitts auf der Quellwand, gemessen ab deren Anfang.
   * Die Wandenden liegen - wie in ADR 0013 - bei 0 und der kaufmännisch
   * gerundeten Wandlänge; innere Grenzen sind exakte Lagen.
   */
  readonly von: Lage;
  readonly bis: Lage;
}

export type Abschnittslage = "gemeinsam" | "aussen";

/** Atomarer Darstellungsabschnitt: ein Stück Gerade mit festen überdeckenden Wänden. */
export interface Wandabschnitt<W extends TopoWand> {
  /**
   * Stabil und reihenfolgeunabhängig. Deckt jede Quellwand genau diesen
   * Abschnitt ab, ist es die Gruppen-ID der Wände (`a+b`); sonst trägt sie
   * zusätzlich die kanonischen Endpunkte (`a+b@0,0~3000,0`).
   */
  readonly id: string;
  readonly gerade: string;
  readonly mass: Linienmass;
  /** Kanonische Richtung: lexikografisch kleinerer Endpunkt zuerst. */
  readonly start: Punkt;
  readonly ende: Punkt;
  /** Kaufmännisch gerundete Länge (ADR 0013) - für Anzeige und Darstellung. */
  readonly laengeMm: number;
  /** Nach Wand-ID sortiert. */
  readonly quellen: readonly Abschnittsquelle<W>[];
  /** Beteiligte Räume, sortiert. */
  readonly raumIds: readonly string[];
  readonly lage: Abschnittslage;
  /** Mehr als zwei Räume auf demselben Abschnitt - keine eindeutige Nachbarschaft. */
  readonly mehrdeutig: boolean;
  /** Zwei Wände desselben Raums überdecken den Abschnitt. */
  readonly doppeltImRaum: boolean;
  /** Setzt sich die Gerade am Anfang bzw. Ende in einem weiteren Abschnitt fort? */
  readonly fortgesetztAmStart: boolean;
  readonly fortgesetztAmEnde: boolean;
}

/** Eine Wand, geteilt an allen inneren Abschnittsgrenzen - in Wandrichtung. */
export interface Wandteilung<W extends TopoWand> {
  readonly wand: W;
  /** Kaufmännisch gerundete Wandlänge - wie beim Server (ADR 0013). */
  readonly laengeMm: number;
  readonly mass: Linienmass;
  /** Grenzen ab Wandanfang, aufsteigend: 0, innere Grenzen, Wandlänge. */
  readonly grenzen: readonly Lage[];
  /** `abschnitte[i]` liegt zwischen `grenzen[i]` und `grenzen[i + 1]`. */
  readonly abschnitte: readonly Wandabschnitt<W>[];
}

export interface Wandtopologie<W extends TopoWand> {
  readonly floorId: string;
  /** Alle atomaren Abschnitte, nach ID sortiert. */
  readonly abschnitte: readonly Wandabschnitt<W>[];
  /** Teilung je Wand-ID; Wände ohne Länge fehlen. */
  readonly teilung: ReadonlyMap<string, Wandteilung<W>>;
}

// ------------------------------------------------------------ Zerlegung

interface Eintrag<W extends TopoWand> {
  readonly wand: W;
  /** Gitterindex von Anfang und Ende auf der Geraden. */
  readonly kStart: number;
  readonly kEnde: number;
  readonly laengeMm: number;
}

/**
 * Zerlegt die Wände **eines** Geschosses in atomare Abschnitte. Rein und
 * deterministisch: Das Ergebnis hängt nicht von der Reihenfolge der
 * Eingabe ab; dieselbe Wand-ID wird nur einmal berücksichtigt.
 */
export function wandtopologie<W extends TopoWand>(floorId: string, waende: readonly W[]): Wandtopologie<W> {
  const geraden = new Map<string, { gerade: Gerade; waende: W[] }>();
  const gesehen = new Set<string>();
  for (const wand of waende) {
    if (gesehen.has(wand.id)) continue;
    gesehen.add(wand.id);
    const gerade = geradeVon(floorId, wand.start, wand.ende);
    if (gerade === null) continue;
    const gruppe = geraden.get(gerade.schluessel);
    if (gruppe === undefined) geraden.set(gerade.schluessel, { gerade, waende: [wand] });
    else gruppe.waende.push(wand);
  }

  const abschnitte: Wandabschnitt<W>[] = [];
  const teilung = new Map<string, Wandteilung<W>>();
  for (const schluessel of [...geraden.keys()].sort()) {
    const { gerade, waende: aufGerade } = geraden.get(schluessel) as { gerade: Gerade; waende: W[] };
    const ergebnis = geradeZerlegen(gerade, aufGerade);
    abschnitte.push(...ergebnis.abschnitte);
    for (const t of ergebnis.teilung) teilung.set(t.wand.id, t);
  }
  abschnitte.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { floorId, abschnitte, teilung };
}

function geradeZerlegen<W extends TopoWand>(
  gerade: Gerade,
  waende: readonly W[],
): { abschnitte: Wandabschnitt<W>[]; teilung: Wandteilung<W>[] } {
  const { dx, dy, mass } = gerade;
  const t = (p: Punkt) => dx * p.x + dy * p.y;
  const tMin = Math.min(...waende.flatMap((w) => [t(w.start), t(w.ende)]));
  // Zwei Gitterpunkte derselben Geraden unterscheiden sich um ein ganzzahliges
  // Vielfaches von (dx, dy); die Division ist deshalb exakt.
  const k = (p: Punkt) => (t(p) - tMin) / mass.m;

  const punkte = new Map<number, Punkt>();
  const eintraege: Eintrag<W>[] = [...waende]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((wand) => {
      punkte.set(k(wand.start), wand.start);
      punkte.set(k(wand.ende), wand.ende);
      return { wand, kStart: k(wand.start), kEnde: k(wand.ende), laengeMm: streckenlaenge(wand.start, wand.ende) };
    });
  const grenzen = [...punkte.keys()].sort((a, b) => a - b);

  // 1. Atomare Intervalle mit ihren vollständig überdeckenden Wänden.
  const intervalle: { ka: number; kb: number; ueber: Eintrag<W>[] }[] = [];
  for (let i = 0; i + 1 < grenzen.length; i += 1) {
    const ka = grenzen[i] as number;
    const kb = grenzen[i + 1] as number;
    const ueber = eintraege.filter((e) => Math.min(e.kStart, e.kEnde) <= ka && Math.max(e.kStart, e.kEnde) >= kb);
    if (ueber.length > 0) intervalle.push({ ka, kb, ueber });
  }
  const abgedeckt = new Set(intervalle.map((iv) => iv.ka));
  const endetBei = new Set(intervalle.map((iv) => iv.kb));

  // 2. Abschnitte bilden.
  const abschnitte: Wandabschnitt<W>[] = intervalle.map(({ ka, kb, ueber }) => {
    const start = punkte.get(ka) as Punkt;
    const ende = punkte.get(kb) as Punkt;
    const quellen = ueber.map((e) => quelleVon(e, ka, kb, mass));
    const raumIds = [...new Set(ueber.map((e) => e.wand.raumId))].sort();
    const vollstaendig = ueber.every((e) => Math.min(e.kStart, e.kEnde) === ka && Math.max(e.kStart, e.kEnde) === kb);
    const basis = gruppenId(ueber.map((e) => e.wand.id));
    return {
      id: vollstaendig ? basis : `${basis}@${start.x},${start.y}~${ende.x},${ende.y}`,
      gerade: gerade.schluessel,
      mass,
      start,
      ende,
      laengeMm: streckenlaenge(start, ende),
      quellen,
      raumIds,
      lage: raumIds.length >= 2 ? "gemeinsam" : "aussen",
      mehrdeutig: raumIds.length > 2,
      doppeltImRaum: raumIds.length < ueber.length,
      fortgesetztAmStart: endetBei.has(ka),
      fortgesetztAmEnde: abgedeckt.has(kb),
    };
  });

  // 3. Teilung je Wand in ihrer eigenen Richtung.
  const teilung: Wandteilung<W>[] = eintraege.map((e) => {
    const vorwaerts = e.kStart < e.kEnde;
    const eigene = abschnitte
      .filter((a) => a.quellen.some((q) => q.wand.id === e.wand.id))
      .sort((a, b) => (vorwaerts ? 1 : -1) * (k(a.start) - k(b.start)));
    const innen = eigene.slice(1).map((a) => {
      const kGrenze = vorwaerts ? k(a.start) : k(a.ende);
      return lage(0, Math.abs(kGrenze - e.kStart), mass);
    });
    return {
      wand: e.wand,
      laengeMm: e.laengeMm,
      mass,
      grenzen: [ganzeLage(0), ...innen, ganzeLage(e.laengeMm)],
      abschnitte: eigene,
    };
  });

  return { abschnitte, teilung };
}

/** Bereich des Intervalls `[ka, kb]` auf der Quellwand, ab deren Anfang gemessen. */
function quelleVon<W extends TopoWand>(e: Eintrag<W>, ka: number, kb: number, mass: Linienmass): Abschnittsquelle<W> {
  const umgekehrt = e.kStart > e.kEnde;
  // Wandenden gelten als 0 bzw. gerundete Wandlänge (ADR 0013).
  const stelle = (kPunkt: number): Lage =>
    kPunkt === e.kStart ? ganzeLage(0) : kPunkt === e.kEnde ? ganzeLage(e.laengeMm) : lage(0, Math.abs(kPunkt - e.kStart), mass);
  return umgekehrt
    ? { wand: e.wand, umgekehrt, von: stelle(kb), bis: stelle(ka) }
    : { wand: e.wand, umgekehrt, von: stelle(ka), bis: stelle(kb) };
}

/** Die Quelle einer bestimmten Wand in einem Abschnitt. */
export function quelleIn<W extends TopoWand>(abschnitt: Wandabschnitt<W>, wandId: string): Abschnittsquelle<W> | undefined {
  return abschnitt.quellen.find((q) => q.wand.id === wandId);
}
