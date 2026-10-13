/**
 * Leitungswege auf den Arbeitsflächen Wand und Decke (Phase 6b.4, Entwurf §9.1).
 *
 * Reine Funktionen: Umrechnung zwischen Ansicht und gespeichertem Wegpunkt,
 * Fangziele, rechtwinklige Führung auf der Wand und die Prüfung eines
 * Kandidaten. Geprüft wird **nie** mit einer zweiten Regelsammlung, sondern
 * mit der gemeinsamen Längenfunktion (`laenge.ts`, Spiegel des Servers): Ein
 * Kandidat wird in den Entwurf eingesetzt und ausgewertet. Ein neuer Konflikt
 * genau am neuen Punkt oder an seinen Strecken lehnt ihn ab - die Vorschau
 * zeigt damit, was tatsächlich gespeichert würde.
 *
 * Fangziele erzeugen nie still eine bauliche Verbindung: Übergänge (Ecke,
 * Wand – Decke, Durchführung) sind Anschlusspunkte am vorhandenen Weg und
 * werden wie jeder andere Kandidat geprüft. Zonenhilfslinien sind eine
 * unverbindliche Planungshilfe ohne Prüfung oder Normaussage.
 */
import type { Punkt } from "../editor/geometrie";
import type { Fangergebnis, Fangziel } from "../wandansicht/wandfang";
import { FANG_TOLERANZ_PX, fangen } from "../wandansicht/wandfang";
import type { Wandbezug } from "../wandansicht/wandbezug";
import { punktInAnsicht } from "../wandansicht/wandbezug";
import type { Leitungsbefund, Leitungsergebnis, VorbereiteterPlan, Wegpunkt } from "./laenge";
import { gerundeteLage, leitungAuswerten, leitungsbefundText } from "./laenge";
import type { Leitung } from "./laenge";

// ------------------------------------------------------------------ Wand

/** Wandwegpunkt → Ansichtskoordinaten (u von links, h über FFB). */
export function wandpunktInAnsicht(bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm">, abstandMm: number, hoeheMm: number) {
  return { u: punktInAnsicht(bezug, abstandMm), h: hoeheMm };
}

/** Ansichtskoordinaten → Wandwegpunkt (ganze Millimeter, dieselbe Formel rückwärts). */
export function wandpunktAusAnsicht(bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm" | "wandId">, u: number, h: number): Wegpunkt {
  return { art: "wand", wandId: bezug.wandId, abstandMm: punktInAnsicht(bezug, Math.round(u)) + 0, hoeheMm: Math.round(h) + 0 };
}

/**
 * Unverbindliche Hilfslinien für Leitungswege (Planungshilfe, keine Prüfung):
 * waagerecht 300 mm unter der Decke, 1 100 mm und 300 mm über dem Boden,
 * senkrecht 200 mm neben den Wandkanten und neben Öffnungen.
 */
export const ZONEN = { untenMm: 300, mitteMm: 1100, obenAbstandMm: 300, seitlichMm: 200 } as const;

export interface Hilfslinie {
  readonly achse: "u" | "h";
  readonly wert: number;
  readonly text: string;
}

export function zonenlinien(laengeMm: number, hoeheMm: number, oeffnungen: readonly { links: number; rechts: number }[]): Hilfslinie[] {
  const linien: Hilfslinie[] = [];
  const waagerecht = [
    { wert: hoeheMm - ZONEN.obenAbstandMm, text: "Hilfslinie oben" },
    { wert: ZONEN.mitteMm, text: "Hilfslinie Mitte" },
    { wert: ZONEN.untenMm, text: "Hilfslinie unten" },
  ];
  for (const l of waagerecht) if (l.wert > 0 && l.wert < hoeheMm) linien.push({ achse: "h", ...l });
  const senkrecht = new Map<number, string>();
  if (laengeMm > 2 * ZONEN.seitlichMm) {
    senkrecht.set(ZONEN.seitlichMm, "Hilfslinie neben Wandkante");
    senkrecht.set(laengeMm - ZONEN.seitlichMm, "Hilfslinie neben Wandkante");
  }
  for (const o of oeffnungen) {
    for (const wert of [o.links - ZONEN.seitlichMm, o.rechts + ZONEN.seitlichMm]) {
      if (wert > 0 && wert < laengeMm && !senkrecht.has(wert)) senkrecht.set(wert, "Hilfslinie neben Öffnung");
    }
  }
  for (const [wert, text] of [...senkrecht].sort((a, b) => a[0] - b[0])) linien.push({ achse: "u", wert, text });
  return linien;
}

export interface Wandfangquellen {
  readonly laengeMm: number;
  readonly hoeheMm: number;
  readonly geraete: readonly { id: string; name: string; u: number; h: number }[];
  readonly durchfuehrungen: readonly { id: string; u: number; h: number }[];
  readonly oeffnungen: readonly { id: string; name: string; links: number; rechts: number; unten: number; oben: number }[];
  /** Waagerechte (Höhe) und senkrechte (Lage) Trassen anderer Leitungen auf dieser Wand. */
  readonly trassen: readonly { achse: "u" | "h"; wert: number }[];
  readonly zonen: readonly Hilfslinie[];
}

/** Fangziele je Achse - Rang wie `wandfang.ts` (Kanten vor Höhen vor Mitten). */
export function wandFangziele(q: Wandfangquellen): { u: Fangziel[]; h: Fangziel[] } {
  const u: Fangziel[] = [
    { id: "wand-links", art: "wandkante", wert: 0, text: "Raumecke links" },
    { id: "wand-rechts", art: "wandkante", wert: q.laengeMm, text: "Raumecke rechts" },
  ];
  const h: Fangziel[] = [{ id: "decke", art: "wandkante", wert: q.hoeheMm, text: "Decke (Übergang)" }];
  for (const g of q.geraete) {
    u.push({ id: `geraet:${g.id}:u`, art: "oeffnungsmitte", wert: g.u, text: `über/unter ${g.name}` });
    h.push({ id: `geraet:${g.id}:h`, art: "oeffnungsmitte", wert: g.h, text: `Höhe ${g.name}` });
  }
  for (const d of q.durchfuehrungen) {
    u.push({ id: `durchfuehrung:${d.id}:u`, art: "oeffnungskante", wert: d.u, text: "Durchführung" });
    h.push({ id: `durchfuehrung:${d.id}:h`, art: "hoehe", wert: d.h, text: "Höhe Durchführung" });
  }
  for (const o of q.oeffnungen) {
    u.push({ id: `kante:${o.id}:links`, art: "oeffnungskante", wert: o.links, text: `Kante ${o.name}` });
    u.push({ id: `kante:${o.id}:rechts`, art: "oeffnungskante", wert: o.rechts, text: `Kante ${o.name}` });
    h.push({ id: `oberkante:${o.id}`, art: "hoehe", wert: o.oben, text: `Oberkante ${o.name}` });
  }
  q.trassen.forEach((t, i) =>
    (t.achse === "u" ? u : h).push({ id: `trasse:${t.achse}:${t.wert}:${i}`, art: "hoehe", wert: t.wert, text: "vorhandene Trasse" }),
  );
  for (const z of q.zonen) (z.achse === "u" ? u : h).push({ id: `zone:${z.achse}:${z.wert}`, art: "wandmitte", wert: z.wert, text: `${z.text} (unverbindlich)` });
  return { u, h };
}

export interface Fangeinstellung {
  readonly aktiv: boolean;
  readonly ausgesetzt: boolean;
  readonly massstab: number;
  readonly rasterMm: number;
}

/** Eine Achse fangen: Rohwert → ganze Millimeter, mit Ziel oder Raster. */
export function achseFangen(roh: number, ziele: readonly Fangziel[], f: Fangeinstellung, vorher: string | null = null): { wert: number; ziel: Fangziel | null } {
  const e: Fangergebnis = fangen([{ wert: roh, versatz: 0, ziele }], {
    aktiv: f.aktiv,
    ausgesetzt: f.ausgesetzt,
    massstab: f.massstab,
    rasterMm: f.rasterMm,
    rasterBezug: roh,
    vorher,
  });
  return { wert: Math.round(roh + e.verschiebung) + 0, ziel: e.ziel };
}

/** Ein ausdrücklicher Anschlusspunkt am vorhandenen Weg - etwa Ecke oder Übergang zur Decke. */
export interface Anschlusspunkt {
  readonly a: number;
  readonly b: number;
  readonly text: string;
}

/** Nächster Anschlusspunkt innerhalb der Toleranz (Bildpunkte) - sonst `null`. */
export function anschlussFangen(roh: { a: number; b: number }, punkte: readonly Anschlusspunkt[], f: Fangeinstellung): Anschlusspunkt | null {
  if (!f.aktiv || f.ausgesetzt) return null;
  const toleranz = (FANG_TOLERANZ_PX * 1.5) / f.massstab;
  let bester: Anschlusspunkt | null = null;
  let abstand = Infinity;
  for (const p of punkte) {
    const d = Math.hypot(p.a - roh.a, p.b - roh.b);
    if (d <= toleranz && d < abstand) {
      bester = p;
      abstand = d;
    }
  }
  return bester;
}

/**
 * Rechtwinklige Führung an der Wand: Nachbarpunkte **derselben** Wand legen
 * fest, dass der neue Punkt mit jedem von ihnen waagerecht oder senkrecht
 * verbunden ist. Liefert die Kandidaten (mit freier Achse) - der nächste
 * zum Zeiger gewinnt.
 */
export function rechtwinkligeLagen(
  roh: { u: number; h: number },
  nachbarn: readonly { u: number; h: number }[],
): { u: number | null; h: number | null }[] {
  if (nachbarn.length === 0) return [{ u: null, h: null }];
  const [n1, n2] = nachbarn;
  if (n1 === undefined) return [{ u: null, h: null }];
  if (n2 === undefined) {
    const lagen = [
      { u: null, h: n1.h },
      { u: n1.u, h: null },
    ];
    return lagen.sort((a, b) => abweichung(roh, a) - abweichung(roh, b));
  }
  const kandidaten: { u: number | null; h: number | null }[] = [
    { u: n1.u, h: n2.h },
    { u: n2.u, h: n1.h },
  ];
  if (n1.h === n2.h) kandidaten.push({ u: null, h: n1.h });
  if (n1.u === n2.u) kandidaten.push({ u: n1.u, h: null });
  return kandidaten.sort((a, b) => abweichung(roh, a) - abweichung(roh, b));
}

function abweichung(roh: { u: number; h: number }, k: { u: number | null; h: number | null }): number {
  return Math.abs((k.u ?? roh.u) - roh.u) + Math.abs((k.h ?? roh.h) - roh.h);
}

// ------------------------------------------------------------------ Prüfung

/**
 * Orte, an denen ein neuer oder verschobener Wegpunkt `index` Befunde
 * auslösen kann: der Punkt selbst und seine Strecken zu den Nachbarn. Der
 * Anschluss an das **Endgerät** gehört nicht dazu, solange gezeichnet wird -
 * der Weg kann danach noch weitergehen.
 */
export function betroffeneOrte(index: number, anzahl: number): string[] {
  const orte = [`w${index}`];
  orte.push(index === 0 ? "start" : `w${index - 1}-w${index}`);
  if (index + 1 < anzahl) orte.push(`w${index}-w${index + 1}`);
  return orte;
}

/** Erster Konflikt an diesen Orten - oder `null`. */
export function konfliktAn(ergebnis: Leitungsergebnis, orte: readonly string[]): Leitungsbefund | null {
  return ergebnis.befunde.find((b) => b.art === "conflict" && orte.includes(b.ort)) ?? null;
}

export type Kandidatenpruefung =
  | { readonly ok: true; readonly ergebnis: Leitungsergebnis }
  | { readonly ok: false; readonly grund: string; readonly ergebnis: Leitungsergebnis };

/** Prüft eine geänderte Wegpunktliste mit der gemeinsamen Längenfunktion. */
export function kandidatPruefen(vorbereitet: VorbereiteterPlan, leitung: Leitung, index: number): Kandidatenpruefung {
  const ergebnis = leitungAuswerten(vorbereitet, leitung);
  const konflikt = konfliktAn(ergebnis, betroffeneOrte(index, leitung.wegpunkte.length));
  return konflikt === null ? { ok: true, ergebnis } : { ok: false, grund: leitungsbefundText(konflikt.code), ergebnis };
}

/** Verständlicher Ort eines Befunds („Wegpunkt 3“, „Strecke 2 – 3“, „Anschluss Startgerät“). */
export function befundOrt(ort: string): string {
  if (ort === "start") return "Anschluss Startgerät";
  if (ort === "end") return "Anschluss Endgerät";
  if (ort === "route") return "Leitungsweg";
  const strecke = /^w(\d+)-w(\d+)$/.exec(ort);
  if (strecke !== null) return `Strecke ${Number(strecke[1]) + 1} – ${Number(strecke[2]) + 1}`;
  const punkt = /^w(\d+)$/.exec(ort);
  if (punkt !== null) return `Wegpunkt ${Number(punkt[1]) + 1}`;
  return ort;
}

// ------------------------------------------------------------------ Darstellung

export interface Ansichtsstrecke {
  readonly u1: number;
  readonly h1: number;
  readonly u2: number;
  readonly h2: number;
  readonly anschluss: boolean;
}

/** Wandläufe des Ergebnisses auf dieser Wand - exakt, einmal gerundet wie die Länge. */
export function wandstrecken(ergebnis: Leitungsergebnis, bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm" | "wandId">): Ansichtsstrecke[] {
  const strecken: Ansichtsstrecke[] = [];
  for (const s of ergebnis.strecken) {
    for (const l of s.laeufe) {
      if (l.typ !== "wand" || l.wandId !== bezug.wandId) continue;
      // Nullstrecken (etwa der waagerechte Teil einer senkrechten Anschlussstrecke) zeichnen nichts.
      if (l.vonHoeheMm === l.bisHoeheMm && gerundeteLage(l.vonLage, l.mass) === gerundeteLage(l.bisLage, l.mass)) continue;
      strecken.push({
        u1: punktInAnsicht(bezug, gerundeteLage(l.vonLage, l.mass)),
        h1: l.vonHoeheMm,
        u2: punktInAnsicht(bezug, gerundeteLage(l.bisLage, l.mass)),
        h2: l.bisHoeheMm,
        anschluss: s.art === "connection",
      });
    }
  }
  return strecken;
}

export interface Deckenstrecke {
  readonly a: Punkt;
  readonly b: Punkt;
  readonly anschluss: boolean;
}

/** Deckenläufe des Ergebnisses in diesem Raum. */
export function deckenstrecken(ergebnis: Leitungsergebnis, raumId: string): Deckenstrecke[] {
  const strecken: Deckenstrecke[] = [];
  for (const s of ergebnis.strecken) {
    for (const l of s.laeufe) {
      if (l.typ === "flaeche" && l.flaeche === "ceiling" && l.raumId === raumId) {
        strecken.push({ a: l.start, b: l.ende, anschluss: s.art === "connection" });
      }
    }
  }
  return strecken;
}

/** Trassen anderer Leitungen auf einer Wand: Höhen waagerechter und Lagen senkrechter Läufe. */
export function wandtrassen(strecken: readonly Ansichtsstrecke[]): { achse: "u" | "h"; wert: number }[] {
  const gesehen = new Set<string>();
  const ergebnis: { achse: "u" | "h"; wert: number }[] = [];
  for (const s of strecken) {
    const eintrag = s.h1 === s.h2 && s.u1 !== s.u2 ? { achse: "h" as const, wert: s.h1 } : s.u1 === s.u2 && s.h1 !== s.h2 ? { achse: "u" as const, wert: s.u1 } : null;
    if (eintrag === null) continue;
    const k = `${eintrag.achse}:${eintrag.wert}`;
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    ergebnis.push(eintrag);
  }
  return ergebnis;
}
