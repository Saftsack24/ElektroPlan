import { describe, expect, it } from "vitest";

import type { LogischeWand, Oeffnungsquelle, Wand3d } from "./modell";
import { kanonisch, wandGruppieren } from "./wandgruppen";
import { wandZerlegen } from "./wandzerlegung";

/**
 * Entscheidung T9 (ADR 0016, präzisiert in Phase 4b.2): Wände werden nur für
 * die Darstellung zusammengeführt - exakt kollinear, auch bei teilweiser
 * Überdeckung, zerlegt in atomare Abschnitte.
 */
const NAMEN: Record<string, string> = { a: "Küche", b: "Flur", c: "Bad" };
const name = (id: string) => NAMEN[id] ?? id;

function wand(
  id: string,
  raumId: string,
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  extra: Partial<Omit<LogischeWand, "id" | "raumId" | "start" | "ende">> = {},
): LogischeWand {
  return {
    id,
    raumId,
    start: { x: x1, y: y1 },
    ende: { x: x2, y: y2 },
    staerkeMm: 115,
    raumhoeheMm: 2500,
    oeffnungen: [],
    ...extra,
  };
}

function oeffnung(
  oeffnungId: string,
  wandId: string,
  raumId: string,
  offsetMm: number,
  extra: Partial<Oeffnungsquelle> = {},
): Oeffnungsquelle {
  return {
    oeffnungId,
    wandId,
    raumId,
    art: "door",
    offsetMm,
    breiteMm: 885,
    hoeheMm: 2010,
    bruestungMm: 0,
    ...extra,
  };
}

const gruppieren = (waende: readonly LogischeWand[]) => wandGruppieren("g1", waende, name);
const codes = (ergebnis: { warnungen: readonly { code: string }[] }) => ergebnis.warnungen.map((w) => w.code);
const entlang = (waende: readonly Wand3d[]) => [...waende].sort((a, b) => a.start.x - b.start.x || a.start.y - b.start.y);

describe("Kanonische Wandrichtung", () => {
  it("setzt den lexikografisch kleineren Endpunkt (erst x, dann y) an den Anfang", () => {
    expect(kanonisch({ x: 5000, y: 0 }, { x: 0, y: 0 })).toEqual({
      start: { x: 0, y: 0 },
      ende: { x: 5000, y: 0 },
      umgekehrt: true,
    });
    expect(kanonisch({ x: 0, y: 4000 }, { x: 0, y: 0 }).umgekehrt).toBe(true);
  });
});

describe("Wandkörper je atomarem Abschnitt", () => {
  it("fasst exakt gleiche Wände gleicher Richtung zusammen", () => {
    const { waende } = gruppieren([wand("a1", "a", [0, 0, 5000, 0]), wand("b1", "b", [0, 0, 5000, 0])]);
    expect(waende).toHaveLength(1);
    expect(waende[0]!.lage).toBe("gemeinsam");
    expect(waende[0]!.raumIds).toEqual(["a", "b"]);
    expect([waende[0]!.verlaengernAmStart, waende[0]!.verlaengernAmEnde]).toEqual([true, true]);
  });

  it("fasst entgegengesetzt gerichtete gleiche Wände zusammen", () => {
    const { waende } = gruppieren([wand("a1", "a", [5000, 0, 5000, 4000]), wand("b1", "b", [5000, 4000, 5000, 0])]);
    expect(waende).toHaveLength(1);
    expect(waende[0]!.start).toEqual({ x: 5000, y: 0 });
    expect(waende[0]!.laengeMm).toBe(4000);
  });

  it("gruppiert annähernd gleiche Wände nicht - keine Toleranz", () => {
    const { waende } = gruppieren([wand("a1", "a", [0, 0, 5000, 0]), wand("b1", "b", [0, 1, 5000, 1])]);
    expect(waende).toHaveLength(2);
    expect(waende.every((w) => w.lage === "aussen")).toBe(true);
    const { waende: auchNicht } = gruppieren([wand("a1", "a", [0, 0, 5000, 0]), wand("b1", "b", [0, 0, 5001, 1])]);
    expect(auchNicht.every((w) => w.lage === "aussen")).toBe(true);
  });

  it("teilweise überlappende Wände: gemeinsamer Körper plus nicht geteilter Rest, ohne Warnung", () => {
    const ergebnis = gruppieren([wand("a1", "a", [0, 0, 8000, 0]), wand("b1", "b", [4000, 0, 0, 0])]);
    const [gemeinsam, rest] = entlang(ergebnis.waende);
    expect(ergebnis.waende).toHaveLength(2);
    expect(gemeinsam).toMatchObject({ id: "a1+b1@0,0~4000,0", lage: "gemeinsam", laengeMm: 4000 });
    expect(rest).toMatchObject({ id: "a1@4000,0~8000,0", lage: "aussen", laengeMm: 4000 });
    // Stumpfer Stoß ohne Überlagerung: nur die freien Enden werden verlängert.
    expect([gemeinsam!.verlaengernAmStart, gemeinsam!.verlaengernAmEnde]).toEqual([true, false]);
    expect([rest!.verlaengernAmStart, rest!.verlaengernAmEnde]).toEqual([false, true]);
    expect(ergebnis.warnungen).toEqual([]);
  });

  it("lange Wand gegen zwei kurze: jeder gemeinsame Teil wird genau einmal extrudiert", () => {
    const { waende } = gruppieren([
      wand("flur", "b", [0, 0, 6000, 0]),
      wand("ka", "a", [3000, 0, 0, 0]),
      wand("kc", "c", [6000, 0, 3000, 0]),
    ]);
    expect(entlang(waende).map((w) => [w.laengeMm, w.raumIds.join("↔")])).toEqual([
      [3000, "a↔b"],
      [3000, "b↔c"],
    ]);
    // Jede logische Wand steckt in genau so vielen Körpern, wie sie Abschnitte hat.
    expect(waende.flatMap((w) => w.quellen.map((q) => q.id)).sort()).toEqual(["flur", "flur", "ka", "kc"]);
  });

  it("bloße Berührung oder parallele Wände werden nicht zusammengeführt", () => {
    const { waende, warnungen } = gruppieren([
      wand("a1", "a", [0, 0, 4000, 0]),
      wand("b1", "b", [4000, 0, 8000, 0]),
      wand("c1", "c", [0, 115, 4000, 115]),
    ]);
    expect(waende).toHaveLength(3);
    expect(waende.every((w) => w.lage === "aussen")).toBe(true);
    expect(warnungen).toEqual([]);
  });

  it("gruppiert gleiche Geometrie verschiedener Geschosse nie", () => {
    const g1 = wandGruppieren("g1", [wand("a1", "a", [0, 0, 5000, 0])], name);
    const g2 = wandGruppieren("g2", [wand("b1", "b", [0, 0, 5000, 0])], name);
    expect(g1.waende[0]!.lage).toBe("aussen");
    expect(g2.waende[0]!.lage).toBe("aussen");
  });

  it("gruppiert eine Wand nie mit sich selbst", () => {
    const eine = wand("a1", "a", [0, 0, 5000, 0]);
    const { waende, warnungen } = gruppieren([eine, eine]);
    expect(waende).toHaveLength(1);
    expect(waende[0]!.quellen).toHaveLength(1);
    expect(waende[0]!.lage).toBe("aussen");
    expect(warnungen).toEqual([]);
  });

  it("meldet zwei gleiche Wände im selben Raum, ohne sie als gemeinsame Wand zu zählen", () => {
    const ergebnis = gruppieren([wand("a1", "a", [0, 0, 5000, 0]), wand("a2", "a", [5000, 0, 0, 0])]);
    expect(ergebnis.waende[0]!.lage).toBe("aussen");
    expect(codes(ergebnis)).toEqual(["wand-doppelt-im-raum"]);
  });

  it("meldet einen Abschnitt mit drei Räumen als Konflikt", () => {
    const ergebnis = gruppieren([
      wand("a1", "a", [0, 0, 5000, 0]),
      wand("b1", "b", [5000, 0, 0, 0]),
      wand("c1", "c", [0, 0, 5000, 0]),
    ]);
    expect(ergebnis.waende).toHaveLength(1);
    expect(codes(ergebnis)).toContain("wand-mehrfach");
    expect(ergebnis.warnungen[0]!.text).toContain("„Bad“");
  });

  it("vergibt stabile fachliche IDs unabhängig von der Reihenfolge", () => {
    const a = wand("a1", "a", [0, 0, 5000, 0]);
    const b = wand("b1", "b", [5000, 0, 0, 0]);
    expect(gruppieren([a, b]).waende[0]!.id).toBe("a1+b1");
    expect(gruppieren([b, a]).waende[0]!.id).toBe("a1+b1");
  });
});

describe("Darstellungsregeln bei Konflikten", () => {
  it("unterschiedliche Wandstärken: Warnung, größere Stärke", () => {
    const ergebnis = gruppieren([
      wand("a1", "a", [0, 0, 5000, 0], { staerkeMm: 115 }),
      wand("b1", "b", [5000, 0, 0, 0], { staerkeMm: 240 }),
    ]);
    expect(ergebnis.waende[0]!.staerkeMm).toBe(240);
    expect(codes(ergebnis)).toEqual(["wand-staerke-abweichend"]);
    expect(ergebnis.warnungen[0]!.text).toContain("größere Stärke (240 mm)");
    expect(ergebnis.warnungen[0]!.text).toContain("bleiben unverändert");
  });

  it("unterschiedliche Stärke auf einem Teilabschnitt: nur dort die größere Stärke", () => {
    const ergebnis = gruppieren([
      wand("lang", "b", [0, 0, 8000, 0], { staerkeMm: 115 }),
      wand("kurz", "a", [4000, 0, 0, 0], { staerkeMm: 240 }),
    ]);
    const [gemeinsam, rest] = entlang(ergebnis.waende);
    expect([gemeinsam!.staerkeMm, rest!.staerkeMm]).toEqual([240, 115]);
    expect(codes(ergebnis)).toEqual(["wand-staerke-abweichend"]);
  });

  it("unterschiedliche Raumhöhen: Warnung, größere Höhe - auch auf einem Teilabschnitt", () => {
    const ergebnis = gruppieren([
      wand("a1", "a", [0, 0, 5000, 0], { raumhoeheMm: 2400 }),
      wand("b1", "b", [5000, 0, 0, 0], { raumhoeheMm: 2600 }),
    ]);
    expect(ergebnis.waende[0]!.hoeheMm).toBe(2600);
    expect(codes(ergebnis)).toEqual(["wand-hoehe-abweichend"]);
    expect(ergebnis.warnungen[0]!.text).toContain("2.600 mm");

    const teil = gruppieren([
      wand("lang", "b", [0, 0, 8000, 0], { raumhoeheMm: 2500 }),
      wand("kurz", "a", [4000, 0, 0, 0], { raumhoeheMm: 2750 }),
    ]);
    expect(entlang(teil.waende).map((w) => w.hoeheMm)).toEqual([2750, 2500]);
    expect(codes(teil)).toEqual(["wand-hoehe-abweichend"]);
  });

  it("ändert die Eingangsdaten nicht", () => {
    const a = wand("a1", "a", [0, 0, 5000, 0], { staerkeMm: 115, oeffnungen: [oeffnung("o1", "a1", "a", 1000)] });
    const b = wand("b1", "b", [5000, 0, 0, 0], { staerkeMm: 240 });
    const vorher = JSON.stringify([a, b]);
    gruppieren([a, b]);
    expect(JSON.stringify([a, b])).toBe(vorher);
  });
});

describe("Öffnungen an gemeinsamen Wandabschnitten", () => {
  it("eine einmal gespeicherte Tür schneidet den gemeinsamen Körper - ohne Einseitigkeitswarnung", () => {
    const ergebnis = gruppieren([
      wand("a1", "a", [0, 0, 5000, 0]),
      wand("b1", "b", [5000, 0, 0, 0], { oeffnungen: [oeffnung("ob", "b1", "b", 1000)] }),
    ]);
    const w = ergebnis.waende[0]!;
    // Gegenrichtung: 5000 − 1000 − 885 = 3115
    expect(w.oeffnungen[0]!.rechteck).toEqual({ s0: 3115, s1: 4000, h0: 0, h1: 2010 });
    expect(w.oeffnungen[0]).toMatchObject({ id: "ob", klasse: "gemeinsam", raumIds: ["b", "a"] });
    // Aussparung über die volle Wandstärke: kein Teil überdeckt die Tür.
    expect(w.teile.some((t) => t.s0 < 4000 && t.s1 > 3115 && t.h0 < 2010)).toBe(false);
    expect(ergebnis.warnungen).toEqual([]);
  });

  it("Tür auf der kurzen Raumwand schneidet den gemeinsamen Teil der langen Flurwand", () => {
    const ergebnis = gruppieren([
      wand("flur", "b", [0, 0, 0, 9000]),
      wand("bad", "c", [0, 3000, 0, 0], { oeffnungen: [oeffnung("t-bad", "bad", "c", 1000)] }),
      wand("kind", "a", [0, 9000, 0, 3000]),
    ]);
    const [unten, oben] = entlang(ergebnis.waende);
    expect(unten!.oeffnungen.map((o) => [o.id, o.rechteck.s0, o.rechteck.s1])).toEqual([["t-bad", 1115, 2000]]);
    expect(oben!.oeffnungen).toEqual([]);
    expect(unten!.teile).toEqual(wandZerlegen(3000, 2500, [{ s0: 1115, s1: 2000, h0: 0, h1: 2010 }]));
    expect(ergebnis.warnungen).toEqual([]);
  });

  it("dedupliziert eine von beiden Seiten gleich erfasste Öffnung und meldet die Dublette", () => {
    const ergebnis = gruppieren([
      wand("a1", "a", [0, 0, 5000, 0], { oeffnungen: [oeffnung("oa", "a1", "a", 1000)] }),
      wand("b1", "b", [5000, 0, 0, 0], { oeffnungen: [oeffnung("ob", "b1", "b", 3115)] }),
    ]);
    const w = ergebnis.waende[0]!;
    expect(w.oeffnungen).toHaveLength(1);
    expect(w.oeffnungen[0]!.id).toBe("oa+ob");
    expect(w.oeffnungen[0]!.quellen).toHaveLength(2);
    expect(codes(ergebnis)).toEqual(["oeffnung-dublette"]);
    expect(ergebnis.warnungen[0]!.bezug[0]).toEqual({ art: "oeffnung", id: "oa+ob" });
    expect(w.teile).toEqual(wandZerlegen(5000, 2500, [{ s0: 1000, s1: 1885, h0: 0, h1: 2010 }]));
  });

  it("meldet eine abweichende Öffnungsart bei gleichem Rechteck", () => {
    const ergebnis = gruppieren([
      wand("a1", "a", [0, 0, 5000, 0], { oeffnungen: [oeffnung("oa", "a1", "a", 1000)] }),
      wand("b1", "b", [5000, 0, 0, 0], { oeffnungen: [oeffnung("ob", "b1", "b", 3115, { art: "passage" })] }),
    ]);
    expect(ergebnis.waende[0]!.oeffnungen).toHaveLength(1);
    expect(ergebnis.waende[0]!.oeffnungen[0]!.arten).toEqual(["door", "passage"]);
    expect(ergebnis.waende[0]!.oeffnungen[0]!.klasse).toBe("konflikt");
    expect(codes(ergebnis)).toEqual(["oeffnung-art-abweichend"]);
    expect(ergebnis.warnungen[0]!.text).toContain("als Durchgang");
  });

  it("widersprüchliche, teilweise überlappende Öffnungen gelten nicht als gleich", () => {
    const ergebnis = gruppieren([
      wand("a1", "a", [0, 0, 5000, 0], { oeffnungen: [oeffnung("oa", "a1", "a", 1000)] }),
      wand("b1", "b", [5000, 0, 0, 0], { oeffnungen: [oeffnung("ob", "b1", "b", 3000, { breiteMm: 1010 })] }),
    ]);
    const w = ergebnis.waende[0]!;
    // b: s0 = 5000 − 3000 − 1010 = 990 → [990, 2000) überlappt [1000, 1885)
    expect(w.oeffnungen.map((o) => o.id)).toEqual(["ob", "oa"]);
    expect(codes(ergebnis)).toEqual(["oeffnung-widerspruechlich"]);
    // Aussparung = Vereinigung beider Rechtecke.
    expect(w.teile).toEqual(
      wandZerlegen(5000, 2500, [
        { s0: 1000, s1: 1885, h0: 0, h1: 2010 },
        { s0: 990, s1: 2000, h0: 0, h1: 2010 },
      ]),
    );
  });

  it("Tür über der Grenze zweier Nachbarn: in beiden Körpern ausgespart, als Konflikt gemeldet", () => {
    const ergebnis = gruppieren([
      wand("flur", "b", [0, 0, 6000, 0], { oeffnungen: [oeffnung("t", "flur", "b", 2500)] }),
      wand("ka", "a", [3000, 0, 0, 0]),
      wand("kc", "c", [6000, 0, 3000, 0]),
    ]);
    const [links, rechts] = entlang(ergebnis.waende);
    expect(links!.oeffnungen[0]!.rechteck).toEqual({ s0: 2500, s1: 3000, h0: 0, h1: 2010 });
    expect(rechts!.oeffnungen[0]!.rechteck).toEqual({ s0: 0, s1: 385, h0: 0, h1: 2010 });
    expect(codes(ergebnis)).toEqual(["oeffnung-grenze"]);
    expect(ergebnis.warnungen[0]!.bezug).toEqual([
      { art: "oeffnung", id: "t" },
      { art: "wand", id: links!.id },
      { art: "wand", id: rechts!.id },
    ]);
  });

  it("Tür nur teilweise auf dem gemeinsamen Abschnitt: Konflikt", () => {
    const ergebnis = gruppieren([
      wand("lang", "b", [0, 0, 8000, 0], { oeffnungen: [oeffnung("t", "lang", "b", 3500)] }),
      wand("kurz", "a", [4000, 0, 0, 0]),
    ]);
    expect(codes(ergebnis)).toEqual(["oeffnung-teilweise"]);
  });

  it("an einer nicht geteilten Wand gibt es keine Warnung", () => {
    const ergebnis = gruppieren([wand("a1", "a", [0, 0, 5000, 0], { oeffnungen: [oeffnung("oa", "a1", "a", 1000)] })]);
    expect(ergebnis.warnungen).toEqual([]);
    expect(ergebnis.waende[0]!.oeffnungen[0]).toMatchObject({ klasse: "aussen", raumIds: ["a"] });
  });

  it("lässt unerwartet ungültige Öffnungen mit Warnung aus - ohne Absturz", () => {
    const ergebnis = gruppieren([
      wand("a1", "a", [0, 0, 5000, 0], {
        oeffnungen: [
          oeffnung("zu-breit", "a1", "a", 4500),
          oeffnung("negativ", "a1", "a", -10),
          oeffnung("null", "a1", "a", 100, { breiteMm: 0 }),
          oeffnung("zu-hoch", "a1", "a", 1000, { hoeheMm: 2600 }),
          oeffnung("krumm", "a1", "a", 1000.5),
          oeffnung("gut", "a1", "a", 2000),
        ],
      }),
    ]);
    const w: Wand3d = ergebnis.waende[0]!;
    expect(w.oeffnungen.map((o) => o.id)).toEqual(["gut"]);
    expect(codes(ergebnis)).toEqual(Array(5).fill("oeffnung-ungueltig"));
    for (const t of w.teile) {
      expect(t.s1).toBeGreaterThan(t.s0);
      expect(t.h1).toBeGreaterThan(t.h0);
    }
  });
});
