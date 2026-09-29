import { describe, expect, it } from "vitest";

import { messlauf4a } from "../ansicht3d/testplan";
import type { Lage } from "./lage";
import { abgerundet, alsZahl, aufgerundet, ganzeLage, lage, linienmass, vergleichen } from "./lage";
import type { TopoWand, Wandabschnitt } from "./wandtopologie";
import { geradeVon, kanonisch, wandtopologie } from "./wandtopologie";
import { topoWaendeAus } from "./testwaende";

/**
 * Exakte Teilwandtopologie (Phase 4b.2): kollineare Wände verschiedener
 * Räume werden an allen Endpunkten in atomare Abschnitte zerlegt - ganzzahlig,
 * ohne Toleranz, ohne Veränderung der Eingabe.
 */
function wand(id: string, raumId: string, [x1, y1, x2, y2]: readonly [number, number, number, number]): TopoWand {
  return { id, raumId, start: { x: x1, y: y1 }, ende: { x: x2, y: y2 }, oeffnungen: [] };
}

const topo = (waende: readonly TopoWand[], floorId = "g1") => wandtopologie(floorId, waende);
const strecke = (a: Wandabschnitt<TopoWand>) => `${a.start.x},${a.start.y}-${a.ende.x},${a.ende.y}`;
/** Abschnitte entlang der Geraden - die Topologie selbst sortiert nach ID. */
const entlang = (t: { abschnitte: readonly Wandabschnitt<TopoWand>[] }) =>
  [...t.abschnitte].sort((a, b) => a.start.x - b.start.x || a.start.y - b.start.y);
const gemeinsame = (waende: readonly TopoWand[]) =>
  topo(waende).abschnitte.filter((a) => a.lage === "gemeinsam").map((a) => `${strecke(a)} ${a.raumIds.join("↔")}`);

describe("Exakte Lagen", () => {
  const wurzelZwei = linienmass(2);
  const eins = linienmass(1);

  it("normalisiert bei ganzzahliger Schrittlänge auf reine Ganzzahlen", () => {
    expect(linienmass(25)).toEqual({ m: 25, wurzel: 5 });
    expect(lage(10, 3, linienmass(25))).toEqual({ ganz: 25, stufen: 0 });
    expect(lage(0, 7, eins)).toEqual({ ganz: 7, stufen: 0 });
    expect(linienmass(2).wurzel).toBeNull();
  });

  it("vergleicht ganz + stufen·√2 exakt über Quadrate", () => {
    const l = (ganz: number, stufen: number): Lage => lage(ganz, stufen, wurzelZwei);
    // 1414 < 1000·√2 ≈ 1414,21 < 1415
    expect(vergleichen(ganzeLage(1414), l(0, 1000), wurzelZwei)).toBe(-1);
    expect(vergleichen(ganzeLage(1415), l(0, 1000), wurzelZwei)).toBe(1);
    expect(vergleichen(l(5, 2), l(5, 2), wurzelZwei)).toBe(0);
    expect(vergleichen(l(0, -1000), ganzeLage(-1414), wurzelZwei)).toBe(-1);
    expect(abgerundet(l(0, 1000), wurzelZwei)).toBe(1414);
    expect(aufgerundet(l(0, 1000), wurzelZwei)).toBe(1415);
    expect(abgerundet(l(0, -1000), wurzelZwei)).toBe(-1415);
    expect(aufgerundet(l(0, -1000), wurzelZwei)).toBe(-1414);
    expect(alsZahl(l(0, 1000), wurzelZwei)).toBeCloseTo(1414.2136, 3);
  });

  it("bleibt bei den größten erlaubten Koordinaten exakt", () => {
    const m = linienmass(999_999 * 999_999 + 1_000_000 * 1_000_000);
    expect(vergleichen(lage(0, 1, m), ganzeLage(1_414_212), m)).toBe(1);
    expect(vergleichen(lage(0, 1, m), ganzeLage(1_414_213), m)).toBe(-1);
  });
});

describe("Gerade und kanonische Richtung", () => {
  it("gibt beiden Richtungen und jedem Teilstück derselben Geraden denselben Schlüssel", () => {
    const g = geradeVon("g1", { x: 0, y: 0 }, { x: 6000, y: 0 });
    expect(geradeVon("g1", { x: 6000, y: 0 }, { x: 3000, y: 0 })?.schluessel).toBe(g?.schluessel);
    expect(geradeVon("g1", { x: 0, y: 0 }, { x: 3000, y: 3000 })?.schluessel).toBe(
      geradeVon("g1", { x: 4000, y: 4000 }, { x: 1000, y: 1000 })?.schluessel,
    );
    expect(geradeVon("g2", { x: 0, y: 0 }, { x: 6000, y: 0 })?.schluessel).not.toBe(g?.schluessel);
    expect(geradeVon("g1", { x: 0, y: 1 }, { x: 6000, y: 1 })?.schluessel).not.toBe(g?.schluessel);
    expect(geradeVon("g1", { x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });

  it("setzt den lexikografisch kleineren Endpunkt (erst x, dann y) an den Anfang", () => {
    expect(kanonisch({ x: 5000, y: 0 }, { x: 0, y: 0 })).toEqual({ start: { x: 0, y: 0 }, ende: { x: 5000, y: 0 }, umgekehrt: true });
    expect(kanonisch({ x: 0, y: 0 }, { x: 0, y: 4000 }).umgekehrt).toBe(false);
    expect(kanonisch({ x: -10, y: 900 }, { x: -5, y: -900 }).umgekehrt).toBe(false);
  });
});

describe("Atomare Abschnitte", () => {
  it("vollständig gleiche Wände: ein gemeinsamer Abschnitt mit der Gruppen-ID", () => {
    const t = topo([wand("a1", "a", [0, 0, 5000, 0]), wand("b1", "b", [0, 0, 5000, 0])]);
    expect(t.abschnitte).toHaveLength(1);
    expect(t.abschnitte[0]).toMatchObject({ id: "a1+b1", lage: "gemeinsam", raumIds: ["a", "b"], laengeMm: 5000 });
  });

  it("Gegenrichtung: gleicher Abschnitt, Quelle als umgekehrt markiert", () => {
    const t = topo([wand("a1", "a", [5000, 0, 5000, 4000]), wand("b1", "b", [5000, 4000, 5000, 0])]);
    const a = t.abschnitte[0]!;
    expect(a.start).toEqual({ x: 5000, y: 0 });
    expect(a.quellen.map((q) => [q.wand.id, q.umgekehrt])).toEqual([
      ["a1", false],
      ["b1", true],
    ]);
    expect(a.quellen[1]!.von).toEqual(ganzeLage(0));
    expect(a.quellen[1]!.bis).toEqual(ganzeLage(4000));
  });

  it("teilweise Überlappung: gemeinsamer Teil und nicht geteilter Rest", () => {
    expect(gemeinsame([wand("a1", "a", [0, 0, 8000, 0]), wand("b1", "b", [4000, 0, 0, 0])])).toEqual(["0,0-4000,0 a↔b"]);
    const t = topo([wand("a1", "a", [0, 0, 8000, 0]), wand("b1", "b", [4000, 0, 0, 0])]);
    expect(entlang(t).map((a) => [a.id, a.lage])).toEqual([
      ["a1+b1@0,0~4000,0", "gemeinsam"],
      ["a1@4000,0~8000,0", "aussen"],
    ]);
  });

  it("lange Wand gegen zwei kurze Wände: zwei gemeinsame Abschnitte, gespeicherte Wände unverändert", () => {
    const eingabe = [
      wand("flur", "flur", [0, 0, 6000, 0]),
      wand("ra", "a", [3000, 0, 0, 0]),
      wand("rb", "b", [6000, 0, 3000, 0]),
    ];
    const vorher = JSON.stringify(eingabe);
    expect(gemeinsame(eingabe)).toEqual(["0,0-3000,0 a↔flur", "3000,0-6000,0 b↔flur"]);
    expect(JSON.stringify(eingabe)).toBe(vorher);
    const flur = topo(eingabe).teilung.get("flur")!;
    expect(flur.grenzen).toEqual([ganzeLage(0), ganzeLage(3000), ganzeLage(6000)]);
    expect(flur.abschnitte.map((a) => a.raumIds.join("↔"))).toEqual(["a↔flur", "b↔flur"]);
  });

  it("lange Wand mit geteiltem Stück und äußerem Rest an beiden Enden", () => {
    const t = topo([wand("lang", "flur", [0, 0, 9000, 0]), wand("kurz", "bad", [6000, 0, 3000, 0])]);
    expect(entlang(t).map((a) => `${strecke(a)} ${a.lage}`)).toEqual([
      "0,0-3000,0 aussen",
      "3000,0-6000,0 gemeinsam",
      "6000,0-9000,0 aussen",
    ]);
    // Fortsetzungen: nur innere Stöße, nicht die freien Enden.
    const [links, mitte, rechts] = entlang(t);
    expect([links!.fortgesetztAmStart, links!.fortgesetztAmEnde]).toEqual([false, true]);
    expect([mitte!.fortgesetztAmStart, mitte!.fortgesetztAmEnde]).toEqual([true, true]);
    expect([rechts!.fortgesetztAmStart, rechts!.fortgesetztAmEnde]).toEqual([true, false]);
  });

  it("diagonale, exakt kollineare Teilüberlappung - exakte innere Grenze", () => {
    const t = topo([wand("d1", "a", [0, 0, 3000, 3000]), wand("d2", "b", [2000, 2000, 1000, 1000])]);
    expect(entlang(t).map((a) => `${strecke(a)} ${a.lage}`)).toEqual([
      "0,0-1000,1000 aussen",
      "1000,1000-2000,2000 gemeinsam",
      "2000,2000-3000,3000 aussen",
    ]);
    const d1 = t.teilung.get("d1")!;
    expect(d1.laengeMm).toBe(4243);
    // Innere Grenzen bei 1000·√2 und 2000·√2 - exakt, nicht gerundet.
    expect(d1.grenzen.map((g) => g.stufen)).toEqual([0, 1000, 2000, 0]);
    expect(d1.grenzen[3]).toEqual(ganzeLage(4243));
    const d2 = t.teilung.get("d2")!;
    expect(d2.abschnitte).toHaveLength(1);
    expect(d2.abschnitte[0]!.quellen.find((q) => q.wand.id === "d2")!.umgekehrt).toBe(true);
  });

  it("parallele, aber versetzte Wände teilen nichts", () => {
    expect(gemeinsame([wand("a1", "a", [0, 0, 5000, 0]), wand("b1", "b", [0, 115, 5000, 115])])).toEqual([]);
  });

  it("annähernd kollinear, aber nicht exakt: keine Zusammenführung", () => {
    expect(gemeinsame([wand("a1", "a", [0, 0, 5000, 0]), wand("b1", "b", [0, 0, 5000, 1])])).toEqual([]);
    expect(gemeinsame([wand("a1", "a", [0, 0, 5000, 0]), wand("b1", "b", [0, 1, 5000, 1])])).toEqual([]);
  });

  it("Berührung nur an einem Endpunkt (Fortsetzung, T-Stoß) ist keine gemeinsame Wand", () => {
    const fortsetzung = [wand("a1", "a", [0, 0, 4000, 0]), wand("b1", "b", [4000, 0, 8000, 0])];
    expect(gemeinsame(fortsetzung)).toEqual([]);
    const t = topo(fortsetzung);
    expect(t.abschnitte.map((a) => [a.fortgesetztAmStart, a.fortgesetztAmEnde])).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(gemeinsame([wand("a1", "a", [0, 0, 4000, 0]), wand("b1", "b", [2000, 0, 2000, 3000])])).toEqual([]);
  });

  it("verschiedene Geschosse werden nie zusammengeführt", () => {
    const g1 = wandtopologie("g1", [wand("a1", "a", [0, 0, 5000, 0])]);
    const g2 = wandtopologie("g2", [wand("b1", "b", [0, 0, 5000, 0])]);
    expect(g1.abschnitte[0]!.lage).toBe("aussen");
    expect(g2.abschnitte[0]!.lage).toBe("aussen");
    expect(g1.abschnitte[0]!.gerade).not.toBe(g2.abschnitte[0]!.gerade);
  });

  it("Wände desselben Raums: nicht gemeinsam, als Doppelung markiert", () => {
    const t = topo([wand("a1", "a", [0, 0, 5000, 0]), wand("a2", "a", [5000, 0, 0, 0])]);
    expect(t.abschnitte[0]).toMatchObject({ lage: "aussen", doppeltImRaum: true, raumIds: ["a"] });
  });

  it("drei beteiligte Räume: mehrdeutig statt willkürlicher Zuordnung", () => {
    const t = topo([
      wand("a1", "a", [0, 0, 6000, 0]),
      wand("b1", "b", [4000, 0, 0, 0]),
      wand("c1", "c", [2000, 0, 5000, 0]),
    ]);
    const mitte = t.abschnitte.find((a) => a.start.x === 2000)!;
    expect(mitte).toMatchObject({ raumIds: ["a", "b", "c"], mehrdeutig: true });
    expect(t.abschnitte.filter((a) => a.mehrdeutig)).toHaveLength(1);
  });

  it("eine Wand wird nie mit sich selbst geteilt", () => {
    const eine = wand("a1", "a", [0, 0, 5000, 0]);
    const t = topo([eine, eine]);
    expect(t.abschnitte).toHaveLength(1);
    expect(t.abschnitte[0]!.quellen).toHaveLength(1);
  });

  it("stabile IDs und Ergebnis unabhängig von der Reihenfolge der Eingabe", () => {
    const waende = topoWaendeAus(messlauf4a());
    const vorwaerts = topo(waende);
    const rueckwaerts = topo([...waende].reverse());
    expect(JSON.stringify(rueckwaerts.abschnitte.map((a) => [a.id, a.quellen.map((q) => q.wand.id)]))).toBe(
      JSON.stringify(vorwaerts.abschnitte.map((a) => [a.id, a.quellen.map((q) => q.wand.id)])),
    );
    expect(new Set(vorwaerts.abschnitte.map((a) => a.id)).size).toBe(vorwaerts.abschnitte.length);
  });
});

describe("Realer Grundriss aus dem Messlauf 4a", () => {
  it("4 vollständig gemeinsame Wandpaare und 7 Teilüberlappungen werden zu atomaren Abschnitten", () => {
    const t = topo(topoWaendeAus(messlauf4a()));
    const gemeinsam = t.abschnitte.filter((a) => a.lage === "gemeinsam");
    // 4 vollständig gleiche Paare + 7 Teilstücke = 11 gemeinsame Abschnitte.
    expect(gemeinsam).toHaveLength(11);
    expect(gemeinsam.filter((a) => !a.id.includes("@"))).toHaveLength(4);
    expect(gemeinsam.filter((a) => a.id.includes("@"))).toHaveLength(7);
    // Die lange Flurwand (6500,0)→(6500,9000) ist vollständig in drei Abschnitte zerlegt.
    const flur = t.teilung.get("flur-w1")!;
    expect(flur.abschnitte.map((a) => a.raumIds.join("↔"))).toEqual(["bad↔flur", "flur↔schlafen", "flur↔kind"]);
    expect(flur.abschnitte.every((a) => a.lage === "gemeinsam")).toBe(true);
    // Außenwände bleiben je Wand ein Abschnitt: 11 gemeinsame + 12 äußere.
    expect(t.abschnitte).toHaveLength(23);
    expect(t.abschnitte.reduce((n, a) => n + a.quellen.length, 0)).toBe(8 + 14 + 12);
    expect(t.abschnitte.some((a) => a.mehrdeutig || a.doppeltImRaum)).toBe(false);
  });
});
