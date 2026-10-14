import { describe, expect, it } from "vitest";

import { leitung } from "../leitung/testdaten";
import type { Leitungsumgebung } from "./leitungen3d";
import { geschossband, kappen, leitungen3d } from "./leitungen3d";

/**
 * 3D-Leitungen (6b.5): aus den Teilstrecken des Servers abgeleitet - keine
 * Verbindung, die der Server nicht liefert, Steigwege an der Geschossgrenze
 * gekappt und dort ausdrücklich fortgesetzt.
 */
const EG = { id: "eg", name: "Erdgeschoss", level: 0, elevation_mm: 0, default_ceiling_height_mm: 2500 };
const OG = { id: "og", name: "Obergeschoss", level: 1, elevation_mm: 2800, default_ceiling_height_mm: 2500 };

function umgebung(floorId: string): Leitungsumgebung {
  return {
    floorId,
    geschosse: [EG, OG],
    raumseite: (wandId) => (wandId === "diele-w0" ? { x: 0, y: 1, halbeStaerkeMm: 50 } : null),
    raumDerWand: (wandId) => (wandId === "diele-w0" && floorId === "eg" ? "diele" : null),
    bezeichnung: (c) => `F3 · ${c.label ?? ""}`,
  };
}

const pt = (x: number, y: number, z: number) => ({ x_mm: x, y_mm: y, z_mm: z });

const L = leitung({
  status: "incomplete",
  length_mm: null,
  known_mm: 7000,
  segments: [
    { kind: "wall", ref: "w0-w1", owner_id: "diele-w0", floor_id: "eg", length_mm: 500, known_mm: 500, points: [pt(500, 0, 0), pt(1000, 0, 0)] },
    { kind: "wall-floor", ref: "w1-w2", owner_id: "diele-w0", floor_id: "eg", length_mm: 0, known_mm: 0, points: [pt(1000, 0, 0), pt(1000, 0, 0)] },
    { kind: "floor", ref: "w2-w3", owner_id: "diele", floor_id: "eg", length_mm: 2000, known_mm: 2000, points: [pt(1000, 0, 0), pt(1000, 2000, 0)] },
    { kind: "riser", ref: "w4", owner_id: "s1", floor_id: null, length_mm: 2800, known_mm: 2800, points: [pt(1000, 2000, 0), pt(1000, 2000, 2800)] },
    { kind: "floor", ref: "w4-w5", owner_id: "flur", floor_id: "og", length_mm: 2236, known_mm: 2236, points: [pt(1000, 2000, 2800), pt(2000, 0, 2800)] },
    { kind: "ceiling", ref: "w6-w7", owner_id: "flur", floor_id: "og", length_mm: 1000, known_mm: 1000, points: [pt(2000, 1000, 5300), pt(3000, 1000, 5300)] },
  ],
});

describe("Ableitung je Geschoss", () => {
  it("EG: Wand an der Raumseite, Fußboden knapp darüber, Steigweg bis zur Grenze mit Fortsetzung nach oben", () => {
    const [l] = leitungen3d([L], umgebung("eg"));
    expect(l?.bezeichnung).toBe("F3 · L1");
    expect(l?.status).toBe("incomplete");
    expect(l?.stuecke).toEqual([
      // halbe Wandstärke 50 + 15 zur Raumseite (+y)
      { flaeche: "wand", punkte: [{ x: 500, y: 65, h: 0 }, { x: 1000, y: 65, h: 0 }], wandId: "diele-w0", raumId: "diele" },
      { flaeche: "fussboden", punkte: [{ x: 1000, y: 0, h: 15 }, { x: 1000, y: 2000, h: 15 }], wandId: null, raumId: "diele" },
      { flaeche: "steigweg", punkte: [{ x: 1000, y: 2000, h: 0 }, { x: 1000, y: 2000, h: 2800 }], wandId: null, raumId: null },
    ]);
    expect(l?.fortsetzungen).toEqual([{ punkt: { x: 1000, y: 2000, h: 2800 }, floorId: "og", text: "Fortsetzung in „Obergeschoss“" }]);
  });

  it("OG: nur die eigenen Läufe; der Steigweg kommt als Fortsetzung von unten - nie als Linie durch das EG", () => {
    const [l] = leitungen3d([L], umgebung("og"));
    expect(l?.stuecke.map((s) => s.flaeche)).toEqual(["fussboden", "decke"]);
    // Höhen relativ zum FFB des OG; Decke knapp darunter.
    expect(l?.stuecke[0]?.punkte[0]).toEqual({ x: 1000, y: 2000, h: 15 });
    expect(l?.stuecke[1]?.punkte[0]).toEqual({ x: 2000, y: 1000, h: 2485 });
    expect(l?.fortsetzungen).toEqual([{ punkt: { x: 1000, y: 2000, h: 0 }, floorId: "eg", text: "Fortsetzung in „Erdgeschoss“" }]);
  });

  it("jede Teilstrecke bleibt ein eigener Linienzug - Übergänge der Länge 0 zeichnen nichts", () => {
    const [l] = leitungen3d([L], umgebung("eg"));
    expect(l?.stuecke).toHaveLength(3);
    expect(leitungen3d([leitung({ segments: [] })], umgebung("eg"))).toEqual([]);
  });
});

describe("Kappung an Geschossgrenzen", () => {
  it("Band des Geschosses: bis zum nächsthöheren FFB, im obersten bis zur Standardhöhe", () => {
    expect(geschossband([EG, OG], "eg")).toEqual({ unten: 0, oben: 2800 });
    expect(geschossband([EG, OG], "og")).toEqual({ unten: 2800, oben: 5300 });
    expect(geschossband([EG, OG], "fehlt")).toBeNull();
  });

  it("durchfährt ein Zwischengeschoss: Teil im Band, Fortsetzung an beiden Grenzen", () => {
    const { teile, grenzen } = kappen(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 9000 },
      ],
      2800,
      5600,
    );
    expect(teile).toEqual([
      [
        { x: 0, y: 0, z: 2800 },
        { x: 0, y: 0, z: 5600 },
      ],
    ]);
    expect(grenzen.map((g) => g.seite)).toEqual(["unten", "oben"]);
  });

  it("schräger Verlauf (direkt) wird an der Grenze geschnitten, nicht verlängert", () => {
    const { teile } = kappen(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1000, y: 0, z: 4000 },
      ],
      0,
      2000,
    );
    expect(teile).toEqual([
      [
        { x: 0, y: 0, z: 0 },
        { x: 500, y: 0, z: 2000 },
      ],
    ]);
  });
});
