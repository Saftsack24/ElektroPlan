import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Flaeche, PruefGeraet, Pruefmass, PruefRaum } from "./geraetepruefung";
import { geraetebefunde, punktImPolygon, rechteckImPolygon, streckeImInneren } from "./geraetepruefung";

/**
 * Parität zur verbindlichen Serverregel (Phase 5): Dieselbe Datei prüft
 * `apps/backend/tests/test_electrical_devices_geometry.py` gegen `devices.py`.
 */
interface Fixture {
  version: number;
  typen: Record<string, { breite: number; hoehe: number; innen: boolean; aussen: boolean; decke: boolean }>;
  faelle: {
    name: string;
    raeume: {
      id: string;
      hoehe: number;
      waende: {
        id: string;
        w: [number, number, number, number];
        oeffnungen: { id: string; abstand: number; breite: number; bruestung: number; hoehe: number }[];
      }[];
    }[];
    geraete: {
      id: string;
      raum: string;
      typ: string;
      flaeche: Flaeche;
      wand?: string;
      mitte?: number;
      mittelhoehe?: number;
      x?: number;
      y?: number;
    }[];
    erwartet: Record<string, string[]>;
  }[];
}

const pfad = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../testdata/geometry/geraete.v1.json");
const daten = JSON.parse(readFileSync(pfad, "utf-8")) as Fixture;

const typen: ReadonlyMap<string, Pruefmass> = new Map(Object.entries(daten.typen));

describe("Geräteprüfung - Parität mit dem Backend (Fixture v1)", () => {
  it("liest die erwartete Fassung", () => {
    expect(daten.version).toBe(1);
  });

  for (const fall of daten.faelle) {
    it(fall.name, () => {
      const raeume: PruefRaum[] = fall.raeume.map((r) => ({
        id: r.id,
        hoeheMm: r.hoehe,
        waende: r.waende.map((w) => ({
          id: w.id,
          raumId: r.id,
          start: { x: w.w[0], y: w.w[1] },
          ende: { x: w.w[2], y: w.w[3] },
          oeffnungen: w.oeffnungen.map((o) => ({
            oeffnungId: o.id,
            art: "door" as const,
            offsetMm: o.abstand,
            breiteMm: o.breite,
            hoeheMm: o.hoehe,
            bruestungMm: o.bruestung,
          })),
        })),
      }));
      const geraete: PruefGeraet[] = fall.geraete.map((g) => ({
        id: g.id,
        raumId: g.raum,
        typ: g.typ,
        flaeche: g.flaeche,
        wandId: g.wand ?? null,
        mitte: g.mitte ?? null,
        mittelhoehe: g.mittelhoehe ?? null,
        x: g.x ?? null,
        y: g.y ?? null,
      }));
      const je = new Map<string, Set<string>>(fall.geraete.map((g) => [g.id, new Set<string>()]));
      for (const b of geraetebefunde("geschoss", raeume, geraete, typen)) je.get(b.keys[0] ?? "")?.add(b.code);
      const ergebnis = Object.fromEntries([...je].map(([id, codes]) => [id, [...codes].sort()]));
      expect(ergebnis).toEqual(fall.erwartet);
    });
  }
});

describe("exakte Bausteine", () => {
  const lRaum = [
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 3000 },
    { x: 3000, y: 3000 },
    { x: 3000, y: 6000 },
    { x: 0, y: 6000 },
  ];

  it("Rechteck im L-Raum: Aussparung und einspringende Ecke", () => {
    expect(rechteckImPolygon({ x0: 100, x1: 200, y0: 100, y1: 200 }, lRaum)).toBe(true);
    expect(rechteckImPolygon({ x0: 4000, x1: 4100, y0: 4000, y1: 4100 }, lRaum)).toBe(false);
    expect(rechteckImPolygon({ x0: 2950, x1: 3050, y0: 2950, y1: 3050 }, lRaum)).toBe(false);
    expect(rechteckImPolygon({ x0: 2900, x1: 3000, y0: 4000, y1: 4100 }, lRaum)).toBe(true);
  });

  it("Strecken und Punkte", () => {
    const quadrat = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const box = { x0: 0, x1: 10, y0: 0, y1: 10 };
    expect(punktImPolygon({ x: 5, y: 5 }, quadrat)).toBe(true);
    expect(punktImPolygon({ x: 15, y: 5 }, quadrat)).toBe(false);
    expect(streckeImInneren({ x: 0, y: 0 }, { x: 10, y: 0 }, box)).toBe(false);
    expect(streckeImInneren({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true);
    expect(streckeImInneren({ x: 0, y: 0 }, { x: 10, y: 10 }, box)).toBe(true);
  });
});
