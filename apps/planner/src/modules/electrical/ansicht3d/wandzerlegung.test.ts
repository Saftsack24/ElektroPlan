import { describe, expect, it } from "vitest";

import type { Wandrechteck } from "./wandzerlegung";
import { beschneiden, ueberlappen, wandZerlegen } from "./wandzerlegung";

const flaeche = (r: Wandrechteck) => (r.s1 - r.s0) * (r.h1 - r.h0);
const summe = (teile: readonly Wandrechteck[]) => teile.reduce((s, r) => s + flaeche(r), 0);

/**
 * Unabhängige Vergleichsrechnung: Wandfläche minus Vereinigung der Löcher,
 * über die Zellmittelpunkte eines komprimierten Rasters.
 */
function erwarteteFlaeche(l: number, h: number, loecher: readonly Wandrechteck[]): number {
  const xs = [...new Set([0, l, ...loecher.flatMap((r) => [r.s0, r.s1])])].sort((a, b) => a - b);
  const ys = [...new Set([0, h, ...loecher.flatMap((r) => [r.h0, r.h1])])].sort((a, b) => a - b);
  let frei = 0;
  for (let i = 0; i + 1 < xs.length; i += 1) {
    for (let j = 0; j + 1 < ys.length; j += 1) {
      const s = (xs[i]! + xs[i + 1]!) / 2;
      const z = (ys[j]! + ys[j + 1]!) / 2;
      if (!loecher.some((r) => s > r.s0 && s < r.s1 && z > r.h0 && z < r.h1)) {
        frei += (xs[i + 1]! - xs[i]!) * (ys[j + 1]! - ys[j]!);
      }
    }
  }
  return frei;
}

function pruefeZerlegung(l: number, h: number, loecher: readonly Wandrechteck[]) {
  const teile = wandZerlegen(l, h, loecher);
  for (const t of teile) {
    // Keine negativen oder Null-Flächen, alles innerhalb der Wand.
    expect(t.s1).toBeGreaterThan(t.s0);
    expect(t.h1).toBeGreaterThan(t.h0);
    expect(t.s0).toBeGreaterThanOrEqual(0);
    expect(t.h0).toBeGreaterThanOrEqual(0);
    expect(t.s1).toBeLessThanOrEqual(l);
    expect(t.h1).toBeLessThanOrEqual(h);
    // Kein Teil ragt in eine Aussparung.
    for (const loch of loecher) expect(ueberlappen(t, loch)).toBe(false);
  }
  // Teile überdecken sich nicht …
  for (let i = 0; i < teile.length; i += 1) {
    for (let j = i + 1; j < teile.length; j += 1) expect(ueberlappen(teile[i]!, teile[j]!)).toBe(false);
  }
  // … und füllen genau die Restfläche.
  expect(summe(teile)).toBe(erwarteteFlaeche(l, h, loecher));
  return teile;
}

describe("Wandzerlegung ohne CSG", () => {
  it("geschlossene Wand ist ein einziges Teil", () => {
    expect(wandZerlegen(5000, 2500, [])).toEqual([{ s0: 0, s1: 5000, h0: 0, h1: 2500 }]);
  });

  it("Tür ab Fertigfußboden: zwei Pfeiler und ein Sturz", () => {
    const teile = pruefeZerlegung(5000, 2500, [{ s0: 1000, s1: 1885, h0: 0, h1: 2010 }]);
    expect(teile).toEqual([
      { s0: 0, s1: 1000, h0: 0, h1: 2500 },
      { s0: 1000, s1: 1885, h0: 2010, h1: 2500 },
      { s0: 1885, s1: 5000, h0: 0, h1: 2500 },
    ]);
  });

  it("Fenster mit Brüstung: Brüstung und Sturz bleiben stehen", () => {
    const teile = pruefeZerlegung(4000, 2500, [{ s0: 1400, s1: 2660, h0: 900, h1: 2285 }]);
    expect(teile).toContainEqual({ s0: 1400, s1: 2660, h0: 0, h1: 900 });
    expect(teile).toContainEqual({ s0: 1400, s1: 2660, h0: 2285, h1: 2500 });
    expect(teile).toHaveLength(4);
  });

  it("Öffnung bis exakt zur Wandhöhe: kein Sturz, kein Nullteil", () => {
    const teile = pruefeZerlegung(3000, 2500, [{ s0: 1000, s1: 2000, h0: 0, h1: 2500 }]);
    expect(teile).toEqual([
      { s0: 0, s1: 1000, h0: 0, h1: 2500 },
      { s0: 2000, s1: 3000, h0: 0, h1: 2500 },
    ]);
  });

  it("Öffnung am Wandanfang und -ende erzeugt keine Nullteile", () => {
    pruefeZerlegung(3000, 2500, [
      { s0: 0, s1: 900, h0: 0, h1: 2010 },
      { s0: 2100, s1: 3000, h0: 1000, h1: 2000 },
    ]);
  });

  it("mehrere nicht überlappende Öffnungen, auch mit gemeinsamer Kante", () => {
    pruefeZerlegung(8000, 2500, [
      { s0: 500, s1: 1385, h0: 0, h1: 2010 },
      { s0: 1385, s1: 2270, h0: 0, h1: 2010 },
      { s0: 3000, s1: 4260, h0: 900, h1: 2285 },
      { s0: 5000, s1: 7000, h0: 300, h1: 2400 },
    ]);
  });

  it("überlappende Aussparungen ergeben ihre Vereinigung", () => {
    const a = { s0: 1000, s1: 1885, h0: 0, h1: 2010 };
    const b = { s0: 1200, s1: 2210, h0: 0, h1: 2100 };
    const teile = pruefeZerlegung(4000, 2500, [a, b]);
    expect(summe(teile)).toBe(4000 * 2500 - (2210 - 1000) * 2010 - (2210 - 1200) * (2100 - 2010));
  });

  it("identische Aussparungen zählen einmal", () => {
    const tuer = { s0: 1000, s1: 1885, h0: 0, h1: 2010 };
    expect(wandZerlegen(5000, 2500, [tuer, tuer])).toEqual(wandZerlegen(5000, 2500, [tuer]));
  });

  it("ist deterministisch unabhängig von der Reihenfolge der Öffnungen", () => {
    const loecher = [
      { s0: 3000, s1: 4260, h0: 900, h1: 2285 },
      { s0: 500, s1: 1385, h0: 0, h1: 2010 },
    ];
    expect(wandZerlegen(6000, 2500, loecher)).toEqual(wandZerlegen(6000, 2500, [...loecher].reverse()));
  });

  it("beschneidet Aussparungen außerhalb der Wand und verwirft leere", () => {
    expect(beschneiden({ s0: -100, s1: 500, h0: 0, h1: 3000 }, 400, 2500)).toEqual({
      s0: 0,
      s1: 400,
      h0: 0,
      h1: 2500,
    });
    expect(beschneiden({ s0: 500, s1: 900, h0: 0, h1: 100 }, 400, 2500)).toBeNull();
    pruefeZerlegung(1000, 2500, [{ s0: 800, s1: 1200, h0: 0, h1: 2010 }].map((r) => beschneiden(r, 1000, 2500)!));
  });

  it("liefert bei ungültigen Wandmaßen nichts - ohne Absturz oder Endlosschleife", () => {
    expect(wandZerlegen(0, 2500, [])).toEqual([]);
    expect(wandZerlegen(5000, -1, [])).toEqual([]);
    expect(wandZerlegen(Number.NaN, 2500, [])).toEqual([]);
    expect(wandZerlegen(5000.5, 2500, [])).toEqual([]);
    expect(wandZerlegen(1000, 2500, [{ s0: 600, s1: 400, h0: 0, h1: 2000 }])).toEqual([
      { s0: 0, s1: 1000, h0: 0, h1: 2500 },
    ]);
  });
});
