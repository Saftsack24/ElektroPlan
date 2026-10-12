import { describe, expect, it } from "vitest";

import {
  freieLagegeraete,
  geraeteDesGebaeudes,
  kreisBezeichnung,
  querschnittAlsEingabe,
  querschnittAnzeigen,
  querschnittLesen,
  zuordnungAus,
  zuordnungGeaendert,
  zuordnungNachGeraet,
  zuordnungUmschalten,
} from "./daten";

const typ = (key: string, category: string) => ({
  key,
  label: key,
  category,
  symbol_key: key,
  allows_wall_interior: true,
  allows_wall_exterior: false,
  allows_ceiling: true,
  default_center_height_mm: 300,
  width_mm: 80,
  height_mm: 80,
  sort_order: 1,
  is_active: true,
});
const TYPEN = new Map(
  [
    typ("socket_single", "socket"),
    typ("data_single", "data"),
    typ("distribution_board", "distribution"),
    typ("junction_box", "junction"),
    typ("light_ceiling", "light"),
  ].map((t) => [t.key, t as never]),
);

const kreis = (id: string, board: string, devices: string[], version = 1) =>
  ({ id, board_id: board, designation: id.toUpperCase(), name: `Kreis ${id}`, device_ids: devices, version }) as never;

describe("Stromkreisdaten", () => {
  it("liest den Querschnitt mit Komma oder Punkt und lehnt Unsinn ab", () => {
    expect(querschnittLesen(" 1,5 ")).toEqual({ ok: true, wert: "1.5" });
    expect(querschnittLesen("2.50 mm²")).toEqual({ ok: true, wert: "2.50" });
    expect(querschnittLesen("")).toEqual({ ok: true, wert: null });
    for (const falsch of ["0", "0,0", "1,505", "-1", "abc", "12345"]) expect(querschnittLesen(falsch).ok).toBe(false);
    expect(querschnittAnzeigen("1.50")).toBe("1,5 mm²");
    expect(querschnittAnzeigen("16.00")).toBe("16 mm²");
    expect(querschnittAlsEingabe("2.50")).toBe("2,5");
    expect(querschnittAnzeigen(null)).toBe("—");
  });

  it("listet gespeicherte Geräte mit Grundrisslage und Zuordenbarkeit", () => {
    const plaene = new Map([
      [
        "eg",
        {
          floor_id: "eg",
          project_id: "p",
          wall_links: [],
          wall_link_candidates: [],
          rooms: [
            {
              id: "r1",
              name: "Küche",
              walls: [{ id: "w1", x1_mm: 0, y1_mm: 0, x2_mm: 4000, y2_mm: 0 }],
              devices: [
                { id: "s", device_type_key: "socket_single", wall_id: "w1", center_offset_mm: 1000, x_mm: null, y_mm: null, label: null },
                { id: "d", device_type_key: "data_single", wall_id: "w1", center_offset_mm: 2000, x_mm: null, y_mm: null, label: null },
                { id: "j", device_type_key: "junction_box", wall_id: null, center_offset_mm: null, x_mm: 500, y_mm: 700, label: "AD" },
                { id: "uv", device_type_key: "distribution_board", wall_id: "w1", center_offset_mm: 3000, x_mm: null, y_mm: null, label: null },
              ],
            },
          ],
        } as never,
      ],
    ]);
    const geraete = geraeteDesGebaeudes([{ id: "eg", name: "EG", level: 0 }], plaene, TYPEN);
    const nach = new Map(geraete.map((g) => [g.id, g]));
    expect([nach.get("s")?.x_mm, nach.get("s")?.y_mm]).toEqual([1000, 0]);
    expect([nach.get("j")?.x_mm, nach.get("j")?.y_mm]).toEqual([500, 700]);
    expect(geraete.filter((g) => g.zuordenbar).map((g) => g.id).sort()).toEqual(["j", "s"]);
    expect(nach.get("j")?.name).toBe("junction_box „AD“");

    // Lagegeräte: nur Verteilungsgeräte, die keine andere Verteilung platzieren.
    const boards = [
      { id: "b1", code: "UV1", placement_device_id: "uv" },
      { id: "b2", code: "UV2", placement_device_id: null },
    ] as never[];
    expect(freieLagegeraete(geraete, boards, "b2").map((g) => g.id)).toEqual([]);
    expect(freieLagegeraete(geraete, boards, "b1").map((g) => g.id)).toEqual(["uv"]);
  });

  it("führt die Zuordnung als Entwurf mit Änderungszustand", () => {
    const k = kreis("f1", "b1", ["a", "b"], 3);
    const entwurf = zuordnungAus(k);
    expect(zuordnungGeaendert(entwurf)).toBe(false);
    const ohneA = zuordnungUmschalten(entwurf, "a");
    expect(zuordnungGeaendert(ohneA)).toBe(true);
    expect(zuordnungGeaendert(zuordnungUmschalten(ohneA, "a"))).toBe(false);
    expect(ohneA.version).toBe(3);
    expect(zuordnungNachGeraet([k, kreis("f2", "b1", ["c"])]).get("c")?.id).toBe("f2");
    expect(kreisBezeichnung(k, [{ id: "b1", code: "UV1" }] as never[])).toBe("UV1 · F1 Kreis f1");
  });
});
