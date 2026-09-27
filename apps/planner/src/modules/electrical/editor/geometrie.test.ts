import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ganzzahligeWurzel,
  konturbericht,
  oeffnungsBefunde,
  streckenlaenge,
} from "./geometrie";
import type { Segment } from "./geometrie";

/**
 * Parität zur verbindlichen Serverregel.
 *
 * Dieselbe Datei prüft `apps/backend/tests/test_geometry_parity.py` gegen
 * `geometry.py`. Weicht der Spiegel im Editor ab, fällt dieser Test - nicht
 * erst ein Benutzer, der eine andere Fläche sieht als der Server speichert.
 */
interface Fixture {
  version: number;
  laengen: { name: string; start: [number, number]; ende: [number, number]; laenge_mm: number }[];
  konturen: {
    name: string;
    waende: [number, number, number, number][];
    status: "draft" | "valid";
    flaeche_mm2: number | null;
    umfang_mm: number | null;
    codes: string[];
  }[];
  oeffnungen: {
    name: string;
    wandlaenge_mm: number;
    oeffnung: [number, number];
    andere: [number, number][];
    codes: string[];
  }[];
}

const pfad = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../testdata/geometry/raumgeometrie.v1.json",
);
const daten = JSON.parse(readFileSync(pfad, "utf-8")) as Fixture;

describe("Geometrieparität mit dem Backend (Fixture v1)", () => {
  it("liest die erwartete Fassung", () => {
    expect(daten.version).toBe(1);
  });

  it.each(daten.laengen)("Länge: $name", (fall) => {
    expect(
      streckenlaenge({ x: fall.start[0], y: fall.start[1] }, { x: fall.ende[0], y: fall.ende[1] }),
    ).toBe(fall.laenge_mm);
  });

  it.each(daten.konturen)("Kontur: $name", (fall) => {
    const segmente: Segment[] = fall.waende.map(([x1, y1, x2, y2], index) => ({
      key: `w${index}`,
      start: { x: x1, y: y1 },
      ende: { x: x2, y: y2 },
    }));
    const bericht = konturbericht(segmente);
    expect(bericht.status).toBe(fall.status);
    expect(bericht.flaecheMm2).toBe(fall.flaeche_mm2);
    expect(bericht.umfangMm).toBe(fall.umfang_mm);
    expect(bericht.befunde.map((befund) => befund.code)).toEqual(fall.codes);
  });

  it.each(daten.oeffnungen)("Öffnung: $name", (fall) => {
    const befunde = oeffnungsBefunde(
      { key: "o", abstand: fall.oeffnung[0], breite: fall.oeffnung[1] },
      fall.wandlaenge_mm,
      fall.andere.map(([abstand, breite], index) => ({ key: `a${index}`, abstand, breite })),
    );
    expect(befunde.map((befund) => befund.code)).toEqual(fall.codes);
  });
});

describe("ganzzahlige Wurzel", () => {
  it("ist auch für große Werte exakt", () => {
    const grenze = 4 * 8_000_000_000_000;
    const wurzel = ganzzahligeWurzel(grenze);
    expect(wurzel * wurzel).toBeLessThanOrEqual(grenze);
    expect((wurzel + 1) * (wurzel + 1)).toBeGreaterThan(grenze);
  });

  it("lehnt negative und gebrochene Werte ab", () => {
    expect(() => ganzzahligeWurzel(-1)).toThrow(RangeError);
    expect(() => ganzzahligeWurzel(2.5)).toThrow(RangeError);
  });
});
