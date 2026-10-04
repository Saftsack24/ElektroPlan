import { describe, expect, it } from "vitest";

import type { EntwurfWand } from "../editor/entwurf";
import type { Geraetetyp } from "../geraete/katalog";
import { deckenlage, deckenlagePruefen, wandabstaende } from "./deckengeraete";
import { deckenmodell } from "./deckenmodell";

const LEUCHTE: Geraetetyp = {
  key: "light_ceiling",
  label: "Deckenleuchte (Auslass)",
  category: "light",
  symbol_key: "light_ceiling",
  allows_wall_interior: false,
  allows_wall_exterior: false,
  allows_ceiling: true,
  default_center_height_mm: null,
  width_mm: 100,
  height_mm: 100,
  sort_order: 80,
  is_active: true,
};

function waende(punkte: readonly [number, number][]): EntwurfWand[] {
  return punkte.map(([x1, y1], i) => {
    const [x2, y2] = punkte[(i + 1) % punkte.length] as [number, number];
    return { id: `w${i + 1}`, x1_mm: x1, y1_mm: y1, x2_mm: x2, y2_mm: y2, thickness_mm: 115, openings: [] };
  });
}

const L_RAUM = deckenmodell(waende([[0, 0], [6000, 0], [6000, 3000], [3000, 3000], [3000, 6000], [0, 6000]]));
const RECHTECK = deckenmodell(waende([[0, 0], [4000, 0], [4000, 3000], [0, 3000]]));

describe("Deckengeräte (Phase 5)", () => {
  it("misst zur tatsächlich ersten Wand - im L-Raum bis zur einspringenden Wand", () => {
    const a = wandabstaende(L_RAUM.waende, { x: 1500, y: 4500 });
    expect(a.rechts).toMatchObject({ abstand: 1500, wandNummer: 4 });
    expect(a.links).toMatchObject({ abstand: 1500, wandNummer: 6 });
    expect(a.oben).toMatchObject({ abstand: 1500 });
    expect(a.unten).toMatchObject({ abstand: 4500, wandNummer: 1 });
  });

  it("lehnt die Aussparung des L-Raums ab, nicht nur das umschließende Rechteck", () => {
    expect(deckenlagePruefen(LEUCHTE, 4500, 4500, L_RAUM.waende, [])).toEqual({ ok: false, grund: expect.stringContaining("nicht vollständig") as string });
    expect(deckenlagePruefen(LEUCHTE, 2950, 4500, L_RAUM.waende, []).ok).toBe(true);
    expect(deckenlagePruefen(LEUCHTE, 3000, 3000, L_RAUM.waende, []).ok).toBe(false);
  });

  it("Rechteck: Kante an Wand erlaubt, darüber hinaus nicht; keine Überdeckung", () => {
    expect(deckenlagePruefen(LEUCHTE, 50, 1500, RECHTECK.waende, []).ok).toBe(true);
    expect(deckenlagePruefen(LEUCHTE, 49, 1500, RECHTECK.waende, []).ok).toBe(false);
    const andere = [{ id: "a", typ: LEUCHTE, schluessel: "light_ceiling", x: 2000, y: 1500, label: null, befunde: [] }];
    expect(deckenlagePruefen(LEUCHTE, 2050, 1500, RECHTECK.waende, andere).ok).toBe(false);
    expect(deckenlagePruefen(LEUCHTE, 2100, 1500, RECHTECK.waende, andere).ok).toBe(true);
    expect(deckenlagePruefen({ ...LEUCHTE, allows_ceiling: false }, 2000, 1500, RECHTECK.waende, []).ok).toBe(false);
  });

  it("rastet bündig an achsparallelen Wänden und in der Flucht anderer Geräte ein", () => {
    const fang = { aktiv: true, ausgesetzt: false, massstab: 0.2, rasterMm: 100 };
    const andere = [{ id: "a", typ: LEUCHTE, schluessel: "light_ceiling", x: 2000, y: 1500, label: null, befunde: [] }];
    expect(deckenlage(58, 1512, LEUCHTE, RECHTECK.waende, andere, fang)).toMatchObject({ x: 50, y: 1500 });
    expect(deckenlage(58, 1512, LEUCHTE, RECHTECK.waende, andere, fang).zielX?.text).toBe("an Wand 4");
    expect(deckenlage(58, 1512, LEUCHTE, RECHTECK.waende, andere, fang).zielY?.text).toContain("Flucht");
  });
});
