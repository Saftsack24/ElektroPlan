/**
 * Trassen aus Leitungswegen - Spiegel von `cable_traces.py` (Phase 6b.2, Entwurf §5.4).
 *
 * Exakt aufeinanderliegende Teilstrecken auf derselben Planungsfläche bilden
 * eine Trasse; nichts wird gespeichert. Wand (je Raumwand, waagerecht je Höhe
 * bzw. senkrecht je Lage), Decke und Fußboden (je Raum und Gerade - gleicher
 * Grundriss ergibt **zwei** Trassen), Steigweg (je Abschnitt) und
 * Schachtfortsetzung (je Halt). Trassenmeter einmal, Leitungsmeter je Leitung.
 * Jede zusammenhängende Trasse und jedes Belegungsstück wird einmal gerundet.
 */
import { gerundeteWurzel } from "../editor/geometrie";
import type { Lage, Linienmass } from "../topologie/lage";
import { lage, vergleichen } from "../topologie/lage";
import type { Flaechenlauf, Leitungsergebnis, Planungsflaeche, Steigweglauf } from "./laenge";
import { gerundeteLage } from "./laenge";

export interface Trassenstueck {
  readonly laengeMm: number;
  readonly leitungen: readonly string[];
}

export interface Trasse {
  readonly flaeche: Planungsflaeche;
  readonly besitzerId: string;
  readonly richtung: "horizontal" | "vertical" | "straight" | "riser" | "shaft";
  /** Trassenmeter - bei unbestätigtem Steigweg nur der bekannte Teil. */
  readonly laengeMm: number;
  readonly vollstaendig: boolean;
  readonly leitungsMm: number;
  readonly leitungen: readonly string[];
  readonly stuecke: readonly Trassenstueck[];
}

export interface Trassenuebersicht {
  readonly trassen: readonly Trasse[];
  readonly trassenMm: Record<Planungsflaeche, number>;
  readonly leitungsMm: Record<Planungsflaeche, number>;
  readonly durchfuehrungen: readonly string[];
  readonly bodenuebergaenge: number;
}

interface Intervall<C> {
  readonly unten: C;
  readonly oben: C;
  readonly leitungId: string;
  readonly laengeMm: number;
}

type Vergleich<C> = (a: C, b: C) => number;

function linear<C>(
  flaeche: Planungsflaeche,
  besitzerId: string,
  richtung: Trasse["richtung"],
  alle: readonly Intervall<C>[],
  vgl: Vergleich<C>,
  laenge: (a: C, b: C) => number,
): Trasse[] {
  const items = alle.filter((i) => vgl(i.unten, i.oben) !== 0);
  if (items.length === 0) return [];
  const punkte: C[] = [];
  for (const wert of items.flatMap((i) => [i.unten, i.oben]).sort(vgl)) {
    const letzter = punkte[punkte.length - 1];
    if (letzter === undefined || vgl(letzter, wert) !== 0) punkte.push(wert);
  }
  const trassen: Trasse[] = [];
  let teil: [C, C, string[]][] = [];

  const abschliessen = () => {
    const erstes = teil[0];
    const letztes = teil[teil.length - 1];
    if (erstes === undefined || letztes === undefined) return;
    const unten = erstes[0];
    const oben = letztes[1];
    const mitglieder = items.filter((i) => vgl(unten, i.unten) <= 0 && vgl(i.oben, oben) <= 0);
    const zusammen: [C, C, string[]][] = [];
    for (const [a, b, ids] of teil) {
      const vorher = zusammen[zusammen.length - 1];
      if (vorher !== undefined && vorher[2].join("\u0000") === ids.join("\u0000")) vorher[1] = b;
      else zusammen.push([a, b, ids]);
    }
    trassen.push({
      flaeche,
      besitzerId,
      richtung,
      laengeMm: laenge(unten, oben),
      vollstaendig: true,
      leitungsMm: mitglieder.reduce((s, i) => s + i.laengeMm, 0),
      leitungen: [...new Set(mitglieder.map((i) => i.leitungId))].sort(),
      stuecke: zusammen.map(([a, b, ids]) => ({ laengeMm: laenge(a, b), leitungen: ids })),
    });
    teil = [];
  };

  for (let k = 1; k < punkte.length; k += 1) {
    const a = punkte[k - 1] as C;
    const b = punkte[k] as C;
    const ids = [...new Set(items.filter((i) => vgl(i.unten, a) <= 0 && vgl(b, i.oben) <= 0).map((i) => i.leitungId))].sort();
    if (ids.length === 0) {
      abschliessen();
      continue;
    }
    teil.push([a, b, ids]);
  }
  abschliessen();
  return trassen;
}

function zahlVergleich(a: number, b: number): number {
  return a > b ? 1 : a < b ? -1 : 0;
}

function textVergleich(a: string, b: string): number {
  return a > b ? 1 : a < b ? -1 : 0;
}

function tupelVergleich(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const x = a[i] as string | number;
    const y = b[i] as string | number;
    const c = typeof x === "number" && typeof y === "number" ? zahlVergleich(x, y) : textVergleich(String(x), String(y));
    if (c !== 0) return c;
  }
  return zahlVergleich(a.length, b.length);
}

function flaechenGerade(lauf: Flaechenlauf): { schluessel: number[]; m: number; t0: number; t1: number } | null {
  let dx = lauf.ende.x - lauf.start.x;
  let dy = lauf.ende.y - lauf.start.y;
  if (dx === 0 && dy === 0) return null;
  let x = Math.abs(dx);
  let y = Math.abs(dy);
  while (y !== 0) [x, y] = [y, x % y];
  dx /= x;
  dy /= x;
  if (dx < 0 || (dx === 0 && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  return {
    schluessel: [dx + 0, dy + 0, dy * lauf.start.x - dx * lauf.start.y + 0],
    m: dx * dx + dy * dy,
    t0: dx * lauf.start.x + dy * lauf.start.y,
    t1: dx * lauf.ende.x + dy * lauf.ende.y,
  };
}

/** Trassen aller gültigen Teilstrecken - Spiegel von `derive_traces`. */
export function trassenAbleiten(ergebnisse: readonly Leitungsergebnis[]): Trassenuebersicht {
  const waagerecht = new Map<string, { schluessel: (string | number)[]; wandId: string; mass: Linienmass; items: Intervall<Lage>[] }>();
  const senkrecht = new Map<string, { schluessel: (string | number)[]; wandId: string; items: Intervall<number>[] }>();
  const flaechen = new Map<
    string,
    { schluessel: (string | number)[]; flaeche: "ceiling" | "floor"; raumId: string; m: number; items: Intervall<number>[] }
  >();
  const steigwege = new Map<string, { schluessel: (string | number)[]; steigwegId: string; laeufe: [string, Steigweglauf][] }>();
  const schaechte = new Map<string, { steigwegId: string; hoehen: [string, number][] }>();
  const durchfuehrungen: string[] = [];
  let uebergaenge = 0;

  for (const ergebnis of ergebnisse) {
    uebergaenge += ergebnis.bodenuebergaenge;
    for (const id of ergebnis.durchfuehrungen) if (!durchfuehrungen.includes(id)) durchfuehrungen.push(id);
    const lid = ergebnis.leitungId;
    for (const strecke of ergebnis.strecken) {
      for (const lauf of strecke.laeufe) {
        if (lauf.typ === "wand") {
          if (lauf.vonHoeheMm === lauf.bisHoeheMm) {
            const [unten, oben] =
              vergleichen(lauf.vonLage, lauf.bisLage, lauf.mass) <= 0 ? [lauf.vonLage, lauf.bisLage] : [lauf.bisLage, lauf.vonLage];
            const schluessel = [lauf.wandId, lauf.vonHoeheMm];
            const k = JSON.stringify(schluessel);
            const eintrag = waagerecht.get(k) ?? { schluessel, wandId: lauf.wandId, mass: lauf.mass, items: [] };
            eintrag.items.push({ unten, oben, leitungId: lid, laengeMm: lauf.laengeMm });
            waagerecht.set(k, eintrag);
          } else {
            const schluessel = [lauf.wandId, lauf.vonLage.ganz, lauf.vonLage.stufen];
            const k = JSON.stringify(schluessel);
            const eintrag = senkrecht.get(k) ?? { schluessel, wandId: lauf.wandId, items: [] };
            eintrag.items.push({
              unten: Math.min(lauf.vonHoeheMm, lauf.bisHoeheMm),
              oben: Math.max(lauf.vonHoeheMm, lauf.bisHoeheMm),
              leitungId: lid,
              laengeMm: lauf.laengeMm,
            });
            senkrecht.set(k, eintrag);
          }
        } else if (lauf.typ === "flaeche") {
          const gerade = flaechenGerade(lauf);
          if (gerade === null) continue;
          const schluessel = [lauf.flaeche, lauf.raumId, ...gerade.schluessel];
          const k = JSON.stringify(schluessel);
          const eintrag = flaechen.get(k) ?? { schluessel, flaeche: lauf.flaeche, raumId: lauf.raumId, m: gerade.m, items: [] };
          eintrag.items.push({
            unten: Math.min(gerade.t0, gerade.t1),
            oben: Math.max(gerade.t0, gerade.t1),
            leitungId: lid,
            laengeMm: lauf.laengeMm,
          });
          flaechen.set(k, eintrag);
        } else if (lauf.typ === "steigweg") {
          const schluessel = [lauf.steigwegId, lauf.abschnitt];
          const k = JSON.stringify(schluessel);
          const eintrag = steigwege.get(k) ?? { schluessel, steigwegId: lauf.steigwegId, laeufe: [] };
          eintrag.laeufe.push([lid, lauf]);
          steigwege.set(k, eintrag);
        } else {
          const k = JSON.stringify([lauf.steigwegId, lauf.haltId]);
          const eintrag = schaechte.get(k) ?? { steigwegId: lauf.steigwegId, hoehen: [] };
          eintrag.hoehen.push([lid, lauf.hoeheMm]);
          schaechte.set(k, eintrag);
        }
      }
    }
  }

  const sortiert = <T extends { schluessel: (string | number)[] }>(m: Map<string, T>): T[] =>
    [...m.values()].sort((a, b) => tupelVergleich(a.schluessel, b.schluessel));

  const trassen: Trasse[] = [];
  for (const e of sortiert(waagerecht)) {
    trassen.push(
      ...linear<Lage>(
        "wall",
        e.wandId,
        "horizontal",
        e.items,
        (a, b) => vergleichen(a, b, e.mass),
        (a, b) => gerundeteLage(lage(b.ganz - a.ganz, b.stufen - a.stufen, e.mass), e.mass),
      ),
    );
  }
  for (const e of sortiert(senkrecht)) {
    trassen.push(...linear<number>("wall", e.wandId, "vertical", e.items, zahlVergleich, (a, b) => b - a));
  }
  for (const e of sortiert(flaechen)) {
    trassen.push(
      ...linear<number>(e.flaeche, e.raumId, "straight", e.items, zahlVergleich, (a, b) => {
        const k = (b - a) / e.m;
        return gerundeteWurzel(k * k * e.m);
      }),
    );
  }
  for (const e of sortiert(steigwege)) {
    const [, muster] = e.laeufe[0] as [string, Steigweglauf];
    const niedrigste = Math.min(...e.laeufe.map(([, l]) => l.abHoeheMm));
    const voll = muster.senkrechtMm === null ? null : muster.senkrechtMm + muster.abHoeheMm;
    trassen.push({
      flaeche: "riser",
      besitzerId: e.steigwegId,
      richtung: "riser",
      laengeMm: muster.waagerechtMm + (voll === null ? 0 : voll - niedrigste),
      vollstaendig: voll !== null,
      leitungsMm: e.laeufe.reduce((s, [, l]) => s + l.waagerechtMm + (l.senkrechtMm ?? 0), 0),
      leitungen: [...new Set(e.laeufe.map(([id]) => id))].sort(),
      stuecke: [],
    });
  }
  // Wie im Backend: je Steigweg in der Reihenfolge des ersten Auftretens.
  const schachtListe = [...schaechte.values()].sort((a, b) => textVergleich(a.steigwegId, b.steigwegId));
  for (const e of schachtListe) {
    trassen.push({
      flaeche: "shaft",
      besitzerId: e.steigwegId,
      richtung: "shaft",
      laengeMm: Math.max(...e.hoehen.map(([, h]) => h)),
      vollstaendig: true,
      leitungsMm: e.hoehen.reduce((s, [, h]) => s + h, 0),
      leitungen: [...new Set(e.hoehen.map(([id]) => id))].sort(),
      stuecke: [],
    });
  }

  const leer = (): Record<Planungsflaeche, number> => ({ wall: 0, ceiling: 0, floor: 0, riser: 0, shaft: 0 });
  const trassenMm = leer();
  const leitungsMm = leer();
  for (const t of trassen) {
    trassenMm[t.flaeche] += t.laengeMm;
    leitungsMm[t.flaeche] += t.leitungsMm;
  }
  return { trassen, trassenMm, leitungsMm, durchfuehrungen, bodenuebergaenge: uebergaenge };
}
