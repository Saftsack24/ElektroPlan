import { describe, expect, it } from "vitest";

import type { EntwurfGeraet, Raumentwurf } from "../editor/entwurf";
import { alsKonturanfrage, basisAus, gleicherStand } from "../editor/entwurf";
import { RAUM } from "../editor/testdaten";
import { konturUmkehren, wandEntfernen, wandTeilen, wandlaengeSetzen } from "../editor/werkzeuge";
import { geraetAendern, geraetEinfuegen, geraetEntfernen, neuesDeckengeraet, neuesWandgeraet } from "./geraeteentwurf";

const TYP = { key: "socket_single" };

function entwurfMit(...geraete: EntwurfGeraet[]): Raumentwurf {
  return geraete.reduce((e, g) => geraetEinfuegen(e, g), basisAus(RAUM).entwurf);
}

describe("Geräte im Raumentwurf (Phase 5)", () => {
  it("gehört zum Zielzustand von PUT …/contour - samt ausdrücklich entfernter Geräte", () => {
    const g = neuesWandgeraet("g1", TYP, "w1", "wall_interior", 1000, 300);
    const e = entwurfMit(g);
    expect(alsKonturanfrage(e).devices).toEqual([{ ...g }]);
    const ohne = geraetEntfernen(e, "g1", new Set(["g1"]));
    expect(alsKonturanfrage(ohne).devices).toEqual([]);
    expect(alsKonturanfrage(ohne).removed_device_ids).toEqual(["g1"]);
    // Ein nie gespeichertes Gerät verschwindet ohne Vermerk.
    expect(geraetEntfernen(e, "g1", new Set()).entfernteGeraete).toEqual([]);
  });

  it("eine Geräteänderung ist eine Entwurfsänderung (Vergleich für „ungespeichert“)", () => {
    const e = entwurfMit(neuesDeckengeraet("d1", { key: "light_ceiling" }, 2500, 2000));
    expect(gleicherStand(e, geraetAendern(e, "d1", { x_mm: 2500 }))).toBe(true);
    expect(gleicherStand(e, geraetAendern(e, "d1", { x_mm: 2600 }))).toBe(false);
  });

  it("Umlaufrichtung umkehren: Mitte zählt vom anderen Ende, innen bleibt innen", () => {
    const e = entwurfMit(neuesWandgeraet("g1", TYP, "w1", "wall_exterior", 1200, 300), neuesDeckengeraet("d1", { key: "light_ceiling" }, 100, 100));
    const umgekehrt = konturUmkehren(e);
    const g = umgekehrt.geraete.find((x) => x.id === "g1");
    expect(g?.center_offset_mm).toBe(5000 - 1200);
    expect(g?.mounting_surface).toBe("wall_exterior");
    expect(umgekehrt.geraete.find((x) => x.id === "d1")?.x_mm).toBe(100);
    // Zweimal umgekehrt ist der Ausgangsstand.
    expect(konturUmkehren(umgekehrt).geraete).toEqual(e.geraete);
  });

  it("eine Wand mit Gerät wird nicht nebenbei entfernt, geteilt oder unter das Gerät gekürzt", () => {
    const e = entwurfMit(neuesWandgeraet("g1", TYP, "w1", "wall_interior", 4000, 300));
    expect(wandEntfernen(e, "w1")).toEqual({ fehler: expect.stringContaining("Geräte") as string });
    expect(wandTeilen(e, "w1", "neu")).toEqual({ fehler: expect.stringContaining("Gerät") as string });
    expect(wandlaengeSetzen(e, "w1", 3000)).toEqual({ fehler: expect.stringContaining("Gerät") as string });
    expect("wert" in wandlaengeSetzen(e, "w1", 4500)).toBe(true);
  });
});
