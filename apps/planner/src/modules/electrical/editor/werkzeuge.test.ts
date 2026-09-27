import { describe, expect, it } from "vitest";

import type { EntwurfWand, Raumentwurf } from "./entwurf";
import { alsKonturanfrage, segmenteAus } from "./entwurf";
import { konturbericht } from "./geometrie";
import {
  eckeEntfernen,
  eckeVerschieben,
  konturUmkehren,
  letztenPunktEntfernen,
  oeffnungEntfernen,
  oeffnungSetzen,
  oeffnungVerschieben,
  polygonWaende,
  projektion,
  punktAnhaengen,
  rechteckWaende,
  schliesstPolygon,
  wandEntfernen,
  wandTeilen,
  wandlaengeSetzen,
} from "./werkzeuge";

const IDS = ["w1", "w2", "w3", "w4"] as const;

function wert<T>(e: { wert: T } | { fehler: string }): T {
  if ("fehler" in e) throw new Error(e.fehler);
  return e.wert;
}

function rechteck(): Raumentwurf {
  return { roomId: "r", entfernteOeffnungen: [], walls: wert(rechteckWaende({ x: 0, y: 0 }, { x: 5000, y: 4000 }, 115, IDS)) };
}

describe("Rechteckraum", () => {
  it("erzeugt vier geordnete Wände gegen den Uhrzeigersinn - geschlossen", () => {
    const walls = wert(rechteckWaende({ x: 5000, y: 4000 }, { x: 0, y: 0 }, 115, IDS));
    expect(walls.map((w) => [w.x1_mm, w.y1_mm, w.x2_mm, w.y2_mm])).toEqual([
      [0, 0, 5000, 0],
      [5000, 0, 5000, 4000],
      [5000, 4000, 0, 4000],
      [0, 4000, 0, 0],
    ]);
    expect(walls.map((w) => w.id)).toEqual([...IDS]);
    const bericht = konturbericht(segmenteAus(walls));
    expect(bericht.status).toBe("valid");
    expect(bericht.flaecheMm2).toBe(20_000_000);
  });

  it("lehnt ein flaches Rechteck ab", () => {
    expect(rechteckWaende({ x: 0, y: 0 }, { x: 5000, y: 50 }, 115, IDS)).toHaveProperty("fehler");
  });
});

describe("Polygonraum", () => {
  it("fügt Punkte hinzu, ignoriert Doppelklicks auf denselben Punkt und schließt am Startpunkt", () => {
    let punkte = punktAnhaengen([], { x: 0, y: 0 });
    punkte = punktAnhaengen(punkte, { x: 4000, y: 0 });
    punkte = punktAnhaengen(punkte, { x: 4000, y: 0 });
    punkte = punktAnhaengen(punkte, { x: 0, y: 3000 });
    expect(punkte).toHaveLength(3);
    expect(schliesstPolygon(punkte, { x: 0, y: 0 })).toBe(true);
    expect(schliesstPolygon(punkte.slice(0, 2), { x: 0, y: 0 })).toBe(false);
    const walls = wert(polygonWaende(punkte, 115, ["a", "b", "c"]));
    expect(walls.map((w) => [w.x2_mm, w.y2_mm])).toEqual([
      [4000, 0],
      [0, 3000],
      [0, 0],
    ]);
    expect(konturbericht(segmenteAus(walls)).status).toBe("valid");
  });

  it("entfernt den letzten Punkt", () => {
    expect(letztenPunktEntfernen([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([{ x: 0, y: 0 }]);
  });

  it("braucht mindestens drei Punkte", () => {
    expect(polygonWaende([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 115, ["a", "b"])).toHaveProperty("fehler");
  });
});

describe("Kontur bearbeiten", () => {
  it("ein gemeinsamer Eckpunkt verschiebt beide angrenzenden Wände - ohne Lücke", () => {
    const neu = eckeVerschieben(rechteck(), { x: 5000, y: 4000 }, { x: 6000, y: 4500 });
    expect(neu.walls[1]).toMatchObject({ x2_mm: 6000, y2_mm: 4500 });
    expect(neu.walls[2]).toMatchObject({ x1_mm: 6000, y1_mm: 4500 });
    expect(konturbericht(segmenteAus(neu.walls)).status).toBe("valid");
    expect(neu.walls.map((w) => w.id)).toEqual([...IDS]);
  });

  it("setzt die Länge in Wandrichtung und zieht die Nachbarwand mit", () => {
    const neu = wert(wandlaengeSetzen(rechteck(), "w1", 6000));
    expect(neu.walls[0]).toMatchObject({ x2_mm: 6000, y2_mm: 0 });
    expect(neu.walls[1]).toMatchObject({ x1_mm: 6000, y1_mm: 0 });
  });

  it("teilt eine Wand und entfernt den Eckpunkt wieder", () => {
    const geteilt = wert(wandTeilen(rechteck(), "w1", "neu"));
    expect(geteilt.walls.map((w) => w.id)).toEqual(["w1", "neu", "w2", "w3", "w4"]);
    expect(geteilt.walls[0]).toMatchObject({ x2_mm: 2500, y2_mm: 0 });
    const zusammen = wert(eckeEntfernen(geteilt, "w1"));
    expect(alsKonturanfrage(zusammen)).toEqual(alsKonturanfrage(rechteck()));
  });

  it("entfernt eine Wand nur ohne Öffnungen", () => {
    const mitTuer = wert(oeffnungSetzen(rechteck(), "w1", "door", { x: 2500, y: 0 }, "t", { rasterMm: 10, fangen: true }));
    expect(wandEntfernen(mitTuer, "w1")).toHaveProperty("fehler");
    expect(wert(wandEntfernen(rechteck(), "w1")).walls).toHaveLength(3);
  });

  it("kehrt die Umlaufrichtung um und rechnet Öffnungsabstände vom neuen Anfang", () => {
    const mitTuer = wert(oeffnungSetzen(rechteck(), "w1", "door", { x: 1500, y: 0 }, "t", { rasterMm: 100, fangen: true }));
    const umgekehrt = konturUmkehren(mitTuer);
    const tuerwand = umgekehrt.walls.find((w) => w.id === "w1") as EntwurfWand;
    expect(tuerwand).toMatchObject({ x1_mm: 5000, y1_mm: 0, x2_mm: 0, y2_mm: 0 });
    expect(tuerwand.openings[0]?.offset_mm).toBe(5000 - 1100 - 885);
    expect(konturbericht(segmenteAus(umgekehrt.walls)).status).toBe("valid");
  });
});

describe("Öffnungen", () => {
  it("projiziert den Zeiger auf die gerichtete Wand", () => {
    const w = rechteck().walls[2] as EntwurfWand; // (5000,4000) -> (0,4000)
    expect(projektion(w, { x: 4000, y: 4300 })).toBe(1000);
    expect(projektion(w, { x: 9000, y: 4000 })).toBe(0);
  });

  it("setzt die Öffnung mittig unter den Zeiger, gefangen, vollständig in der Wand", () => {
    const e = wert(oeffnungSetzen(rechteck(), "w1", "window", { x: 1500, y: 80 }, "f", { rasterMm: 100, fangen: true }));
    expect(e.walls[0]?.openings[0]).toEqual({
      id: "f",
      kind: "window",
      offset_mm: 1000,
      width_mm: 1010,
      height_mm: 1260,
      sill_height_mm: 900,
    });
    const amEnde = wert(oeffnungSetzen(rechteck(), "w1", "door", { x: 4990, y: 0 }, "t", { rasterMm: 100, fangen: true }));
    expect(amEnde.walls[0]?.openings[0]?.offset_mm).toBe(5000 - 885);
  });

  it("bezieht den Abstand auf die Wandrichtung", () => {
    // Obere Wand läuft von rechts nach links: x = 4000 liegt 1000 mm hinter dem Anfang.
    const e = wert(oeffnungSetzen(rechteck(), "w3", "door", { x: 4000, y: 4000 }, "t", { rasterMm: 1, fangen: false }));
    expect(e.walls[2]?.openings[0]?.offset_mm).toBe(Math.round(1000 - 885 / 2));
  });

  it("verschiebt eine Öffnung nur entlang ihrer Wand", () => {
    const e = wert(oeffnungSetzen(rechteck(), "w1", "door", { x: 1500, y: 0 }, "t", { rasterMm: 100, fangen: true }));
    const verschoben = oeffnungVerschieben(e, "w1", "t", { x: 3500, y: 2000 }, { rasterMm: 100, fangen: true });
    expect(verschoben.walls[0]?.openings[0]?.offset_mm).toBe(3100);
    expect(verschoben.walls[1]?.openings).toEqual([]);
  });

  it("lehnt eine Öffnung ab, die breiter als die Wand ist", () => {
    const schmal = eckeVerschieben(rechteck(), { x: 5000, y: 0 }, { x: 800, y: 0 });
    expect(oeffnungSetzen(schmal, "w1", "door", { x: 400, y: 0 }, "t", { rasterMm: 10, fangen: true })).toHaveProperty("fehler");
  });

  it("vermerkt entfernte, bereits gespeicherte Öffnungen ausdrücklich", () => {
    const e = wert(oeffnungSetzen(rechteck(), "w1", "door", { x: 1500, y: 0 }, "t", { rasterMm: 100, fangen: true }));
    expect(oeffnungEntfernen(e, "w1", "t", new Set()).entfernteOeffnungen).toEqual([]);
    expect(oeffnungEntfernen(e, "w1", "t", new Set(["t"])).entfernteOeffnungen).toEqual(["t"]);
  });
});
