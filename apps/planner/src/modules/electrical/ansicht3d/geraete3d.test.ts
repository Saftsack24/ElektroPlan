import { describe, expect, it } from "vitest";

import { szenenmodellAus } from "./szenenmodell";
import { plan, raum, rechteck } from "./testplan";

describe("Geräte in 3D (Phase 5)", () => {
  const typen = new Map([
    ["light_ceiling", { key: "light_ceiling", label: "Deckenleuchte (Auslass)", category: "light" as const, symbol_key: "light_ceiling", allows_wall_interior: false, allows_wall_exterior: false, allows_ceiling: true, default_center_height_mm: null, width_mm: 100, height_mm: 100, sort_order: 80, is_active: true }],
  ]);

  it("Deckengeräte sitzen auf der effektiven Höhe ihres Raums - unterschiedlich hohe Räume", () => {
    const modell = szenenmodellAus(
      plan([
        rechteck("a", "Flur", [0, 0], [4000, 3000], { hoehe: 2500, geraete: [{ id: "d1", typ: "light_ceiling", x: 2000, y: 1500 }] }),
        rechteck("b", "Schlafen", [4000, 0], [8000, 3000], { hoehe: 2700, geraete: [{ id: "d2", typ: "light_ceiling", x: 6000, y: 1500 }] }),
      ]),
      undefined,
      typen,
    );
    expect(modell.geraete.map((g) => [g.id, g.hoeheMm])).toEqual([
      ["d1", 2500],
      ["d2", 2700],
    ]);
    expect(modell.geraete[0]?.name).toBe("Deckenleuchte (Auslass)");
  });

  it("innen und außen an derselben Wand: entgegengesetzte Montageseite, gleiche Lage entlang der Wand", () => {
    const modell = szenenmodellAus(
      plan([
        rechteck("a", "Wohnen", [0, 0], [5000, 4000], {
          geraete: [
            { id: "i", typ: "socket_single", wand: 0, mitte: 2000, hoehe: 300 },
            { id: "o", typ: "light_outdoor", wand: 0, seite: "aussen", mitte: 2000, hoehe: 2000 },
          ],
        }),
      ]),
    );
    const innen = modell.geraete.find((g) => g.id === "i");
    const aussen = modell.geraete.find((g) => g.id === "o");
    // Wand (0,0)->(5000,0), Raum darüber: innen +y, außen -y, je halbe Wandstärke.
    expect(innen?.normale).toEqual({ x: -0, y: 1 });
    expect(aussen?.normale).toEqual({ x: 0, y: -1 });
    expect(innen?.anker).toEqual({ x: 2000, y: 57.5 });
    expect(aussen?.anker).toEqual({ x: 2000, y: -57.5 });
  });

  it("Räume ohne geschlossene Kontur tragen in 3D keine Geräte", () => {
    const modell = szenenmodellAus(
      plan([raum("offen", "Entwurf", [[0, 0], [3000, 0], [3000, 3000]], { offen: true, geraete: [{ id: "x", typ: "light_ceiling", x: 1000, y: 500 }] })]),
    );
    expect(modell.geraete).toEqual([]);
  });
});
