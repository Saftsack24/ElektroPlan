import { describe, expect, it } from "vitest";

import { basisAus } from "../editor/entwurf";
import { editorTopologie } from "../editor/platzierung";
import { RAUM } from "../editor/testdaten";
import type { Geraetetyp } from "../geraete/katalog";
import { wandbezug } from "./wandbezug";
import type { Wandbezug } from "./wandbezug";
import { geraeteInAnsicht, geraetLage, geraetLagePruefen, geraetemasslinien, mitteAusAnsicht, mitteInAnsicht } from "./wandgeraete";

const STECKDOSE: Geraetetyp = {
  key: "socket_single",
  label: "Steckdose",
  category: "socket",
  symbol_key: "socket_single",
  allows_wall_interior: true,
  allows_wall_exterior: false,
  allows_ceiling: false,
  default_center_height_mm: 300,
  width_mm: 80,
  height_mm: 80,
  sort_order: 10,
  is_active: true,
  origin: "system",
  description: null,
  version: 1,
  device_count: 0,
  template_count: 0,
};
const AUSSENLEUCHTE: Geraetetyp = { ...STECKDOSE, key: "light_outdoor", label: "Außenleuchte (Wand)", category: "light", allows_wall_interior: false, allows_wall_exterior: true, default_center_height_mm: 2000, width_mm: 100, height_mm: 100 };
const TYPEN = new Map([STECKDOSE, AUSSENLEUCHTE].map((t) => [t.key, t]));

function bezug(seite: "innen" | "aussen"): Wandbezug {
  const walls = basisAus(RAUM).entwurf.walls;
  const e = wandbezug(RAUM.id, walls, "w1", 2500, seite);
  if (!e.ok) throw new Error(e.grund);
  return e.bezug;
}

function teilungMitTuer() {
  const walls = basisAus(RAUM).entwurf.walls.map((w) =>
    w.id === "w1" ? { ...w, openings: [{ id: "t1", kind: "door" as const, offset_mm: 1000, width_mm: 900, height_mm: 2000, sill_height_mm: 0 }] } : w,
  );
  const topo = editorTopologie("geschoss-1", [{ id: RAUM.id, walls }]);
  const teilung = topo.teilung.get("w1");
  if (teilung === undefined) throw new Error("keine Teilung");
  return teilung;
}

describe("Gerätemitte in der Wandansicht (Phase 5)", () => {
  it("u = L − Mitte innen, u = Mitte außen - und die Formel ist ihre eigene Umkehrung", () => {
    const innen = bezug("innen");
    const aussen = bezug("aussen");
    // Rechteck gegen den Uhrzeigersinn: innen steht das Wandende links.
    expect(innen.anfangLinks).toBe(false);
    expect(mitteInAnsicht(innen, 400)).toBe(4600);
    expect(mitteInAnsicht(aussen, 400)).toBe(400);
    for (const c of [0, 1, 400, 2500, 4999]) {
      expect(mitteAusAnsicht(innen, mitteInAnsicht(innen, c))).toBe(c);
      expect(mitteAusAnsicht(aussen, mitteInAnsicht(aussen, c))).toBe(c);
    }
  });

  it("die Seite ist die Montagefläche: innen und außen an derselben Wand bleiben getrennt", () => {
    const geraete = [
      { id: "i", device_type_key: "socket_single", mounting_surface: "wall_interior" as const, wall_id: "w1", center_offset_mm: 2000, center_height_mm: 300, x_mm: null, y_mm: null, label: null },
      { id: "a", device_type_key: "light_outdoor", mounting_surface: "wall_exterior" as const, wall_id: "w1", center_offset_mm: 2000, center_height_mm: 2000, x_mm: null, y_mm: null, label: null },
    ];
    expect(geraeteInAnsicht(bezug("innen"), geraete, TYPEN, new Map()).map((g) => g.id)).toEqual(["i"]);
    expect(geraeteInAnsicht(bezug("aussen"), geraete, TYPEN, new Map()).map((g) => g.id)).toEqual(["a"]);
    // Gleiche gespeicherte Mitte, gespiegelt angezeigt - gespeichert bleibt 2000.
    expect(geraeteInAnsicht(bezug("aussen"), geraete, TYPEN, new Map())[0]?.mitteMm).toBe(2000);
  });

  it("prüft wie der Server: Rand, Öffnung, Decke, Fläche, Überdeckung", () => {
    const b = bezug("innen");
    const teilung = teilungMitTuer();
    const wand = teilung.wand;
    expect(geraetLagePruefen(b, wand, teilung, STECKDOSE, 2500, 300, [])).toEqual({ ok: true, mitte: 2500, mittelhoehe: 300 });
    expect(geraetLagePruefen(b, wand, teilung, STECKDOSE, 30, 300, [])).toMatchObject({ ok: false });
    // Tür bei 1000..1900 ab Anfang = u 3100..4000 innen.
    expect(geraetLagePruefen(b, wand, teilung, STECKDOSE, 3500, 1000, [])).toEqual({ ok: false, grund: expect.stringContaining("Durchgangsöffnung") as string });
    expect(geraetLagePruefen(b, wand, teilung, STECKDOSE, 4040, 1000, []).ok).toBe(true);
    expect(geraetLagePruefen(b, wand, teilung, STECKDOSE, 2500, 2470, []).ok).toBe(false);
    expect(geraetLagePruefen(b, wand, teilung, AUSSENLEUCHTE, 2500, 2000, [])).toEqual({ ok: false, grund: expect.stringContaining("Außenseite") as string });
    const andere = geraeteInAnsicht(b, [{ id: "x", device_type_key: "socket_single", mounting_surface: "wall_interior", wall_id: "w1", center_offset_mm: 2500, center_height_mm: 300, x_mm: null, y_mm: null, label: null }], TYPEN, new Map());
    expect(geraetLagePruefen(b, wand, teilung, STECKDOSE, 2540, 300, andere)).toMatchObject({ ok: false });
    expect(geraetLagePruefen(b, wand, teilung, STECKDOSE, 2540, 300, andere, "x").ok).toBe(true);
  });

  it("rastet an Standardhöhe und Wandmitte ein; ohne Fang ganze Millimeter", () => {
    const fang = { aktiv: true, ausgesetzt: false, massstab: 0.2, rasterMm: 100 };
    const k = { laengeMm: 5000, hoeheMm: 2500, typ: STECKDOSE, oeffnungen: [], geraete: [], fang };
    expect(geraetLage(2510, 320, k)).toMatchObject({ u: 2500, h: 300 });
    expect(geraetLage(2510, 320, k).zielSenkrecht?.text).toBe("Standardhöhe Steckdose");
    expect(geraetLage(2510.4, 320.6, { ...k, fang: { ...fang, ausgesetzt: true } })).toMatchObject({ u: 2510, h: 321, zielWaagerecht: null });
  });

  it("Hilfslinien sind Achsmaße zur Mitte und freie Abstände zum Nachbarn", () => {
    const linien = geraetemasslinien({ links: 960, rechts: 1040, unten: 260, oben: 340, u: 1000, h: 300 }, 5000, 2500, [{ id: "o", name: "Tür 1", links: 1200, rechts: 2100, unten: 0, oben: 2000 }], (mm) => `${mm}`);
    expect(linien.map((l) => [l.id, l.text])).toEqual([
      ["mitte-links", "1000"],
      ["mitte-rechts", "4000"],
      ["nachbar-rechts", "frei 160"],
      ["mitte-boden", "300"],
      ["decke", "2160"],
    ]);
  });
});
