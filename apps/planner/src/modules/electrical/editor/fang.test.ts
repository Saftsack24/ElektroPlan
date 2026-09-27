import { describe, expect, it } from "vitest";

import { STANDARD_RASTER_MM, abstandFangen, aufRaster, fangen } from "./fang";

const basis = { aktiv: true, ausgesetzt: false, rasterMm: 100, massstab: 0.05, endpunkte: [] };

describe("Fangfunktion", () => {
  it("hat einen praxisgerechten Standard", () => {
    expect(STANDARD_RASTER_MM).toBe(100);
  });

  it("fängt auf das Raster und liefert ganze Millimeter", () => {
    const e = fangen({ x: 1_049.7, y: -951.2 }, basis);
    expect(e).toEqual({ punkt: { x: 1_000, y: -1_000 }, ziel: "raster" });
    expect(aufRaster({ x: 1_249, y: 1_251 }, 500)).toEqual({ x: 1_000, y: 1_500 });
  });

  it("fängt auf einen Wandendpunkt innerhalb des Pixelradius", () => {
    // 12 px bei 0,05 px/mm entsprechen 240 mm.
    const e = fangen({ x: 5_180, y: 3_950 }, { ...basis, endpunkte: [{ x: 5_123, y: 4_007 }] });
    expect(e).toEqual({ punkt: { x: 5_123, y: 4_007 }, ziel: "endpunkt" });
  });

  it("beurteilt den Radius in Pixeln - unabhängig vom Zoom", () => {
    const punkt = { x: 5_180, y: 4_007 };
    const endpunkte = [{ x: 5_000, y: 4_007 }];
    // 180 mm Abstand: bei 0,05 px/mm = 9 px (Treffer), bei 0,2 px/mm = 36 px (kein Treffer).
    expect(fangen(punkt, { ...basis, endpunkte, massstab: 0.05 }).ziel).toBe("endpunkt");
    expect(fangen(punkt, { ...basis, endpunkte, massstab: 0.2 }).ziel).toBe("raster");
  });

  it("bevorzugt den Endpunkt vor dem Raster, den nächsten vor dem ferneren", () => {
    const e = fangen(
      { x: 1_010, y: 0 },
      { ...basis, endpunkte: [{ x: 1_150, y: 0 }, { x: 1_030, y: 7 }] },
    );
    expect(e.punkt).toEqual({ x: 1_030, y: 7 });
  });

  it("lässt sich abschalten und vorübergehend aussetzen", () => {
    const endpunkte = [{ x: 1_000, y: 1_000 }];
    expect(fangen({ x: 1_012.4, y: 998.6 }, { ...basis, endpunkte, aktiv: false })).toEqual({
      punkt: { x: 1_012, y: 999 },
      ziel: "frei",
    });
    expect(fangen({ x: 1_012.4, y: 998.6 }, { ...basis, endpunkte, ausgesetzt: true }).ziel).toBe("frei");
  });

  it("fängt Öffnungsabstände auf das Raster", () => {
    expect(abstandFangen(1_057.5, 100, true)).toBe(1_100);
    expect(abstandFangen(1_057.5, 100, false)).toBe(1_058);
  });
});
