import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Versatzart } from "../steigweg/verlauf";
import { lage, linienmass } from "../topologie/lage";
import { lageUebertragen } from "../topologie/oeffnungen";
import type { Oeffnungsart, TopoWand } from "../topologie/wandtopologie";
import type { Geraeteflaeche, Leitung, Leitungsplan, Steigweglauf, Wegpunkt } from "./laenge";
import {
  LEITUNG_BEFUND_TEXT,
  gemeinsameQuellen,
  gerundeteLage,
  leitungAuswerten,
  leitungenAuswerten,
  planVorbereiten,
  streckeInKontur,
} from "./laenge";
import { trassenAbleiten } from "./trassen";

/**
 * Parität von Leitungsweg, Länge, Status und Trassen zur Serverreferenz
 * (Phase 6b.2): Dieselbe Datei prüft `apps/backend/tests/test_cable_length.py`
 * gegen `cable_length.py`/`cable_traces.py`.
 */
type Roh = Record<string, unknown>;
interface Plandaten {
  basis?: string;
  ersetzen?: Record<string, { id: string }[]>;
  entfernen?: Record<string, string[]>;
  [schluessel: string]: unknown;
}
interface Fixture {
  version: number;
  plaene: Record<string, Plandaten>;
  faelle: {
    name: string;
    plan: string;
    leitungen: {
      id: string;
      start: string | null;
      ende: string | null;
      zugaben?: [number, number, number];
      kabel?: [string | null, number | null, string | null];
      wegpunkte: unknown[][];
    }[];
    erwartet: {
      leitungen: Record<
        string,
        {
          status: string;
          geometrisch: number;
          zugaben: number;
          laenge: number | null;
          bekannt: number;
          spezifiziert: boolean;
          strecken: [string, string, number | null, number][];
          befunde: [string, string, string][];
          durchfuehrungen: string[];
          bodenuebergaenge: number;
          verlauf?: [number, number, number][][];
        }
      >;
      trassen?: {
        flaechen: Record<string, number>;
        leitungsmeter: Record<string, number>;
        durchfuehrungen: string[];
        bodenuebergaenge: number;
        liste: [string, string, string, number, number, boolean, [number, number][]][];
      };
    };
  }[];
  gegenlagen: {
    name: string;
    waende: { id: string; raum: string; von: [number, number]; bis: [number, number] }[];
    abstand: number;
    erwartet: { lage: [number, number]; gerundet: number } | null;
  }[];
  rundung: { lage: [number, number]; m: number; erwartet: number }[];
}

const pfad = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../testdata/geometry/leitung.v1.json");
const daten = JSON.parse(readFileSync(pfad, "utf-8")) as Fixture;

function plandaten(name: string): Plandaten {
  const roh = daten.plaene[name] as Plandaten;
  if (roh.basis === undefined) return structuredClone(roh);
  const plan = plandaten(roh.basis);
  for (const [schluessel, items] of Object.entries(roh.ersetzen ?? {})) {
    const liste = ((plan[schluessel] as { id: string }[] | undefined) ?? []).slice();
    for (const item of items) {
      const i = liste.findIndex((alt) => alt.id === item.id);
      if (i < 0) liste.push(item);
      else liste[i] = item;
    }
    plan[schluessel] = liste;
  }
  for (const [schluessel, ids] of Object.entries(roh.entfernen ?? {})) {
    plan[schluessel] = ((plan[schluessel] as { id: string }[] | undefined) ?? []).filter((item) => !ids.includes(item.id));
  }
  return plan;
}

function planAus(name: string): Leitungsplan {
  const d = plandaten(name) as unknown as {
    geschosse: { id: string; ebene: number; hoehe: number; bestaetigt: boolean; decke: number }[];
    raeume: {
      id: string;
      geschoss: string;
      hoehe: number;
      waende: {
        id: string;
        von: [number, number];
        bis: [number, number];
        oeffnungen?: { id: string; art: Oeffnungsart; abstand: number; breite: number; bruestung: number; hoehe: number }[];
      }[];
    }[];
    kopplungen: { id: string; a: string; b: string; beziehung: "shared" | "separate" }[];
    geraete: (Roh & { id: string; raum: string; flaeche: Geraeteflaeche })[];
    durchfuehrungen: { id: string; kopplung: string; abstand: number; hoehe: number }[];
    steigwege: { id: string; versatz: Versatzart; halte: { id: string; geschoss: string; x: number; y: number }[] }[];
  };
  return {
    geschosse: d.geschosse.map((g) => ({
      id: g.id,
      level: g.ebene,
      elevation_mm: g.hoehe,
      elevation_confirmed: g.bestaetigt,
      default_ceiling_height_mm: g.decke,
    })),
    raeume: d.raeume.map((r) => ({
      id: r.id,
      geschossId: r.geschoss,
      hoeheMm: r.hoehe,
      waende: r.waende.map(
        (w): TopoWand => ({
          id: w.id,
          raumId: r.id,
          start: { x: w.von[0], y: w.von[1] },
          ende: { x: w.bis[0], y: w.bis[1] },
          oeffnungen: (w.oeffnungen ?? []).map((o) => ({
            oeffnungId: o.id,
            art: o.art,
            offsetMm: o.abstand,
            breiteMm: o.breite,
            hoeheMm: o.hoehe,
            bruestungMm: o.bruestung,
          })),
        }),
      ),
    })),
    kopplungen: d.kopplungen.map((k) => ({ id: k.id, wandA: k.a, wandB: k.b, beziehung: k.beziehung })),
    geraete: d.geraete.map((g) => ({
      id: g.id,
      raumId: g.raum,
      flaeche: g.flaeche,
      wandId: (g.wand as string | undefined) ?? null,
      abstandMm: (g.abstand as number | undefined) ?? null,
      hoeheMm: (g.hoehe as number | undefined) ?? null,
      x: (g.x as number | undefined) ?? null,
      y: (g.y as number | undefined) ?? null,
    })),
    durchfuehrungen: d.durchfuehrungen.map((x) => ({ id: x.id, kopplungId: x.kopplung, abstandMm: x.abstand, hoeheMm: x.hoehe })),
    steigwege: d.steigwege.map((s) => ({
      id: s.id,
      versatz: s.versatz,
      halte: s.halte.map((h) => ({ schluessel: h.id, floor_id: h.geschoss, x_mm: h.x, y_mm: h.y })),
    })),
  };
}

function wegpunkt(roh: unknown[]): Wegpunkt {
  const [art, a, b, c, d, e] = roh as [string, string, unknown, unknown, unknown, unknown];
  switch (art) {
    case "wand":
      return { art: "wand", wandId: a, abstandMm: b as number, hoeheMm: c as number };
    case "decke":
    case "boden":
      return { art: art === "decke" ? "ceiling" : "floor", raumId: a, x: b as number, y: c as number };
    case "durchfuehrung":
      return { art: "durchfuehrung", durchfuehrungId: a };
    case "uebergang":
      return { art: "uebergang", wandId: a, abstandMm: b as number, oeffnungId: c as string | null };
    default:
      return {
        art: "steigweg",
        steigwegId: a,
        vonHalt: b as string,
        vonHoeheMm: c as number,
        nachHalt: d as string,
        nachHoeheMm: e as number,
      };
  }
}

function leitungAus(roh: Fixture["faelle"][number]["leitungen"][number]): Leitung {
  const [s, e, r] = roh.zugaben ?? [0, 0, 0];
  const [typ, leiter, querschnitt] = roh.kabel ?? [null, null, null];
  return {
    id: roh.id,
    startGeraetId: roh.start,
    endGeraetId: roh.ende,
    wegpunkte: roh.wegpunkte.map(wegpunkt),
    startzugabeMm: s,
    endzugabeMm: e,
    reserveMm: r,
    kabeltyp: typ,
    leiterzahl: leiter,
    querschnittMm2: querschnitt,
  };
}

describe("Leitungslänge - Parität zur Serverreferenz", () => {
  it("liest Version 1", () => {
    expect(daten.version).toBe(1);
  });

  it.each(daten.faelle.map((fall) => [fall.name, fall] as const))("%s", (_name, fall) => {
    const ergebnisse = leitungenAuswerten(planAus(fall.plan), fall.leitungen.map(leitungAus));
    expect(ergebnisse.map((e) => e.leitungId)).toEqual(Object.keys(fall.erwartet.leitungen));
    for (const e of ergebnisse) {
      const soll = fall.erwartet.leitungen[e.leitungId];
      expect(soll).toBeDefined();
      if (soll === undefined) continue;
      expect(e.status, e.leitungId).toBe(soll.status);
      expect(e.strecken.map((s) => [s.art, s.ort, s.laengeMm, s.bekanntMm]), e.leitungId).toEqual(soll.strecken);
      expect(e.befunde.map((b) => [b.code, b.art, b.ort])).toEqual(soll.befunde);
      expect(e.geometrischMm).toBe(soll.geometrisch);
      expect(e.zugabenMm).toBe(soll.zugaben);
      expect(e.laengeMm).toBe(soll.laenge);
      expect(e.bekanntMm).toBe(soll.bekannt);
      expect(e.vollstaendigSpezifiziert).toBe(soll.spezifiziert);
      expect(e.durchfuehrungen).toEqual(soll.durchfuehrungen);
      expect(e.bodenuebergaenge).toBe(soll.bodenuebergaenge);
      if (soll.verlauf !== undefined) {
        const laeufe = e.strecken.flatMap((s) => s.laeufe).filter((l): l is Steigweglauf => l.typ === "steigweg");
        expect(laeufe.map((l) => l.verlauf.map((p) => [p.x_mm, p.y_mm, p.z_mm]))).toEqual(soll.verlauf);
      }
      // Ungültig ist nie eine gültige Null: Länge nur bei `confirmed`.
      expect(e.laengeMm !== null).toBe(e.status === "confirmed");
      for (const b of e.befunde) expect(LEITUNG_BEFUND_TEXT[b.code]).toBeTruthy();
    }
    const sollTrassen = fall.erwartet.trassen;
    if (sollTrassen !== undefined) {
      const uebersicht = trassenAbleiten(ergebnisse);
      expect(uebersicht.trassenMm).toEqual(sollTrassen.flaechen);
      expect(uebersicht.leitungsMm).toEqual(sollTrassen.leitungsmeter);
      expect(uebersicht.durchfuehrungen).toEqual(sollTrassen.durchfuehrungen);
      expect(uebersicht.bodenuebergaenge).toBe(sollTrassen.bodenuebergaenge);
      expect(
        uebersicht.trassen.map((t) => [
          t.flaeche,
          t.besitzerId,
          t.richtung,
          t.laengeMm,
          t.leitungsMm,
          t.vollstaendig,
          t.stuecke.map((s) => [s.laengeMm, s.leitungen.length]),
        ]),
      ).toEqual(sollTrassen.liste);
    }
  });

  it.each(daten.gegenlagen.map((fall) => [fall.name, fall] as const))("Gegenlage: %s", (_name, fall) => {
    const raeume = new Map<string, TopoWand[]>();
    for (const w of fall.waende) {
      const liste = raeume.get(w.raum) ?? [];
      liste.push({
        id: w.id,
        raumId: w.raum,
        start: { x: w.von[0], y: w.von[1] },
        ende: { x: w.bis[0], y: w.bis[1] },
        oeffnungen: [],
      });
      raeume.set(w.raum, liste);
    }
    const kopplung = { id: "k", wandA: "a", wandB: "b", beziehung: "shared" as const };
    const vorbereitet = planVorbereiten({
      geschosse: [{ id: "eg", level: 0, elevation_mm: 0, elevation_confirmed: true, default_ceiling_height_mm: 2500 }],
      raeume: [...raeume].map(([id, waende]) => ({ id, geschossId: "eg", hoeheMm: 2500, waende })),
      kopplungen: [kopplung],
      geraete: [],
      durchfuehrungen: [],
      steigwege: [],
    });
    const stelle = lage(fall.abstand, 0, linienmass(1));
    const paar = gemeinsameQuellen(vorbereitet, kopplung, stelle);
    if (fall.erwartet === null) {
      expect(paar).toBeNull();
      return;
    }
    expect(paar).not.toBeNull();
    if (paar === null) return;
    const mass = vorbereitet.waende.get("a")?.teilung.mass ?? linienmass(1);
    const gegen = lageUebertragen(stelle, paar[0], paar[1], mass);
    expect([gegen.ganz, gegen.stufen]).toEqual(fall.erwartet.lage);
    expect(gerundeteLage(gegen, mass)).toBe(fall.erwartet.gerundet);
    // Hin- und Rücktransformation ohne Positionsänderung.
    const zurueck = lageUebertragen(gegen, paar[1], paar[0], mass);
    expect([zurueck.ganz, zurueck.stufen]).toEqual([fall.abstand, 0]);
  });

  it.each(daten.rundung.map((fall) => [JSON.stringify(fall.lage), fall] as const))("Rundung %s", (_name, fall) => {
    const mass = linienmass(fall.m);
    expect(gerundeteLage({ ganz: fall.lage[0], stufen: fall.lage[1] }, mass)).toBe(fall.erwartet);
  });
});

describe("Leitungslänge - Eigenschaften", () => {
  it("hängt nicht von der Reihenfolge der Eingabe ab", () => {
    const plan = planAus("diele-kueche");
    const roh = daten.faelle[0]?.leitungen[0];
    expect(roh).toBeDefined();
    if (roh === undefined) return;
    const leitung = leitungAus(roh);
    const vorwaerts = leitungAuswerten(planVorbereiten(plan), leitung);
    const umgedreht = leitungAuswerten(
      planVorbereiten({
        ...plan,
        raeume: [...plan.raeume].reverse(),
        geraete: [...plan.geraete].reverse(),
        durchfuehrungen: [...plan.durchfuehrungen].reverse(),
      }),
      leitung,
    );
    expect(umgedreht).toEqual(vorwaerts);
  });

  it("Kontur: Rand zählt als innen, Aussparung als außen - in beiden Umlaufrichtungen", () => {
    const l = [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6000, y: 3000 },
      { x: 3000, y: 3000 },
      { x: 3000, y: 6000 },
      { x: 0, y: 6000 },
    ];
    expect(streckeInKontur(l, 1, { x: 0, y: 1000 }, { x: 0, y: 5000 })).toBe(true);
    expect(streckeInKontur(l, 1, { x: 1000, y: 5000 }, { x: 5000, y: 1000 })).toBe(true);
    expect(streckeInKontur(l, 1, { x: 5000, y: 1000 }, { x: 1000, y: 5000 })).toBe(true);
    expect(streckeInKontur(l, 1, { x: 3000, y: 3000 }, { x: 4000, y: 4000 })).toBe(false);
    expect(streckeInKontur(l, 1, { x: 4000, y: 3000 }, { x: 2000, y: 3000 })).toBe(true);
    expect(streckeInKontur(l, 1, { x: 6000, y: 3000 }, { x: 3000, y: 6000 })).toBe(false);
    const cw = [...l].reverse();
    expect(streckeInKontur(cw, -1, { x: 1000, y: 5000 }, { x: 5000, y: 1000 })).toBe(true);
    expect(streckeInKontur(cw, -1, { x: 6000, y: 3000 }, { x: 3000, y: 6000 })).toBe(false);
  });
});
