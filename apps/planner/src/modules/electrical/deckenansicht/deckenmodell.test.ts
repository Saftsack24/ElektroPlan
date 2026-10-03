import { describe, expect, it } from "vitest";

import { raum, rechteck } from "../ansicht3d/testplan";
import { basisAus } from "../editor/entwurf";
import { deckenmodell, imRaum, naechsteWand } from "./deckenmodell";

const L_FORM = basisAus(
  raum("r", "Flur", [
    [0, 0],
    [4000, 0],
    [4000, 1500],
    [1500, 1500],
    [1500, 4000],
    [0, 4000],
  ]),
).entwurf.walls;

describe("Deckenansicht - Geometrie (Phase 4f)", () => {
  it("Rechteck: Raummaß, Fläche, Wandnummern in Konturreihenfolge", () => {
    const m = deckenmodell(basisAus(rechteck("r", "Bad", [0, 0], [3000, 2000])).entwurf.walls);
    expect(m.geschlossen).toBe(true);
    expect(m.rechteck).toEqual({ breiteMm: 3000, tiefeMm: 2000 });
    expect(m.flaecheMm2).toBe(6_000_000);
    expect(m.waende.map((w) => [w.nummer, w.laengeMm])).toEqual([
      [1, 3000],
      [2, 2000],
      [3, 3000],
      [4, 2000],
    ]);
  });

  it("L-Form: kein Rechteckmaß, Abstand zur tatsächlich nächsten Wand", () => {
    const m = deckenmodell(L_FORM);
    expect(m.rechteck).toBeNull();
    expect(m.flaecheMm2).toBe(4000 * 1500 + 1500 * 2500);
    // Im schmalen Schenkel der L-Form: Zur gedachten Rechteckkante (x = 4000) wären es
    // 3 m - die nächste echte Wand ist Wand 4 (x = 1500), 50 cm entfernt.
    const p = { x: 1000, y: 2000 };
    expect(imRaum(m.waende, p)).toBe(true);
    expect(naechsteWand(m.waende, p)).toEqual({ nummer: 4, abstandMm: 500 });
    expect(imRaum(m.waende, { x: 3000, y: 3000 })).toBe(false);
  });

  it("Beschriftungen liegen innen - auch im Uhrzeigersinn", () => {
    const umgekehrt = [...L_FORM].reverse().map((w) => ({ ...w, x1_mm: w.x2_mm, y1_mm: w.y2_mm, x2_mm: w.x1_mm, y2_mm: w.y1_mm }));
    for (const walls of [L_FORM, umgekehrt]) {
      const m = deckenmodell(walls, 100);
      for (const w of m.waende) expect(imRaum(m.waende, w.beschriftung)).toBe(true);
    }
  });

  it("offene Kontur: keine Fläche, kein Rechteck", () => {
    const m = deckenmodell(L_FORM.slice(0, 4));
    expect(m.geschlossen).toBe(false);
    expect(m.flaecheMm2).toBeNull();
    expect(m.rechteck).toBeNull();
  });
});
