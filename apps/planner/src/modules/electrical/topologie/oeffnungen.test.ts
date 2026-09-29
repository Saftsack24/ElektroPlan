import { describe, expect, it } from "vitest";

import { messlauf4a } from "../ansicht3d/testplan";
import { alsZahl, ganzeLage } from "./lage";
import { bereichEinordnen, fremdeBereiche, lokalerBereich, oeffnungenEinordnen } from "./oeffnungen";
import { topoWaendeAus } from "./testwaende";
import type { TopoOeffnung, TopoWand } from "./wandtopologie";
import { wandtopologie } from "./wandtopologie";

/**
 * Eine Öffnung - eine Zeile. Die Raumverbindung ist nur abgeleitet; bei
 * mehrdeutiger Lage wird nichts geraten (Phase 4b.2).
 */
function wand(
  id: string,
  raumId: string,
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  oeffnungen: readonly TopoOeffnung[] = [],
): TopoWand {
  return { id, raumId, start: { x: x1, y: y1 }, ende: { x: x2, y: y2 }, oeffnungen };
}

function tuer(id: string, offsetMm: number, extra: Partial<TopoOeffnung> = {}): TopoOeffnung {
  return { oeffnungId: id, art: "door", offsetMm, breiteMm: 885, hoeheMm: 2010, bruestungMm: 0, ...extra };
}

const einordnen = (waende: readonly TopoWand[]) => oeffnungenEinordnen(wandtopologie("g1", waende));

describe("Öffnung auf einem gemeinsamen Abschnitt", () => {
  it("einzelne Tür vollständig im gemeinsamen Abschnitt verbindet beide Räume - ein Datensatz", () => {
    const e = einordnen([wand("a1", "kueche", [0, 0, 5000, 0], [tuer("t", 1000)]), wand("b1", "flur", [5000, 0, 0, 0])]);
    expect([...e.keys()]).toEqual(["t"]);
    expect(e.get("t")).toMatchObject({
      klasse: "gemeinsam",
      grund: null,
      raumIds: ["kueche", "flur"],
      nachbarRaumId: "flur",
      dubletten: [],
      widersprueche: [],
    });
    expect(e.get("t")!.wand.id).toBe("a1");
  });

  it("Gegenrichtung: gespeichert an der entgegenlaufenden Wand, gleiche Einordnung", () => {
    const e = einordnen([wand("a1", "kueche", [0, 0, 5000, 0]), wand("b1", "flur", [5000, 0, 0, 0], [tuer("t", 3000)])]);
    expect(e.get("t")).toMatchObject({ klasse: "gemeinsam", nachbarRaumId: "kueche", raumIds: ["flur", "kueche"] });
  });

  it("Tür auf der kurzen Raumwand neben einer langen Flurwand", () => {
    const e = einordnen([
      wand("flur", "flur", [0, 0, 0, 9000]),
      wand("bad", "bad", [0, 3000, 0, 0], [tuer("t-bad", 1000)]),
      wand("kind", "kind", [0, 9000, 0, 3000]),
    ]);
    expect(e.get("t-bad")).toMatchObject({ klasse: "gemeinsam", nachbarRaumId: "flur" });
  });

  it("Tür an der langen Flurwand wird dem Nachbarn des jeweiligen Teilstücks zugeordnet", () => {
    const waende = [
      wand("flur", "flur", [0, 0, 0, 9000], [tuer("zum-bad", 1000), tuer("zum-kind", 6000)]),
      wand("bad", "bad", [0, 3000, 0, 0]),
      wand("kind", "kind", [0, 9000, 0, 3000]),
    ];
    const e = einordnen(waende);
    expect(e.get("zum-bad")!.nachbarRaumId).toBe("bad");
    expect(e.get("zum-kind")!.nachbarRaumId).toBe("kind");
  });

  it("überschreitet die Grenze zwischen zwei Nachbarräumen: Konflikt, kein Nachbar geraten", () => {
    const e = einordnen([
      wand("flur", "flur", [0, 0, 0, 9000], [tuer("t", 2500)]),
      wand("bad", "bad", [0, 3000, 0, 0]),
      wand("kind", "kind", [0, 9000, 0, 3000]),
    ]);
    expect(e.get("t")).toMatchObject({ klasse: "konflikt", grund: "grenze", nachbarRaumId: null });
    expect(e.get("t")!.abschnitte).toHaveLength(2);
  });

  it("nur teilweise im gemeinsamen Abschnitt: Konflikt", () => {
    const e = einordnen([wand("lang", "flur", [0, 0, 9000, 0], [tuer("t", 5500)]), wand("kurz", "bad", [6000, 0, 3000, 0])]);
    expect(e.get("t")).toMatchObject({ klasse: "konflikt", grund: "teilweise", nachbarRaumId: null });
  });

  it("Berührung der Abschnittsgrenze an der Kante ist erlaubt", () => {
    // [2115, 3000] endet genau an der Grenze 3000 und liegt damit ganz im äußeren Rest.
    const e = einordnen([
      wand("lang", "flur", [0, 0, 9000, 0], [tuer("aussen", 2115), tuer("innen", 3000)]),
      wand("kurz", "bad", [6000, 0, 3000, 0]),
    ]);
    expect(e.get("aussen")).toMatchObject({ klasse: "aussen", nachbarRaumId: null, raumIds: ["flur"] });
    expect(e.get("innen")).toMatchObject({ klasse: "gemeinsam", nachbarRaumId: "bad" });
  });

  it("auf einem Abschnitt mit drei Räumen: mehrdeutig", () => {
    const e = einordnen([
      wand("a1", "a", [0, 0, 6000, 0], [tuer("t", 2500)]),
      wand("b1", "b", [4000, 0, 0, 0]),
      wand("c1", "c", [2000, 0, 5000, 0]),
    ]);
    expect(e.get("t")).toMatchObject({ klasse: "konflikt", grund: "mehrdeutig", nachbarRaumId: null });
  });

  it("diagonale Teilüberlappung: exakte Grenze bei 1000·√2", () => {
    const waende = (offset: number) => [
      wand("d1", "a", [0, 0, 3000, 3000], [tuer("t", offset, { breiteMm: 800 })]),
      wand("d2", "b", [2000, 2000, 1000, 1000]),
    ];
    // 1414 < 1000·√2: beginnt eine Winzigkeit vor dem gemeinsamen Teil.
    expect(einordnen(waende(1414)).get("t")!.grund).toBe("teilweise");
    expect(einordnen(waende(1415)).get("t")).toMatchObject({ klasse: "gemeinsam", nachbarRaumId: "b" });
    // Ende bei 2000·√2 ≈ 2828,43: 2028 + 800 = 2828 passt, 2029 + 800 nicht.
    expect(einordnen(waende(2028)).get("t")!.klasse).toBe("gemeinsam");
    expect(einordnen(waende(2029)).get("t")!.grund).toBe("teilweise");
  });
});

describe("Außenöffnungen und mehrere Öffnungen", () => {
  it("Öffnung an einer nicht geteilten Wand bleibt eine Außenöffnung", () => {
    const e = einordnen([wand("a1", "a", [0, 0, 5000, 0], [tuer("haustuer", 500, { breiteMm: 1010 })])]);
    expect(e.get("haustuer")).toMatchObject({ klasse: "aussen", raumIds: ["a"], nachbarRaumId: null });
  });

  it("Fenster, Durchgang und Tür auf derselben gemeinsamen Wand", () => {
    const e = einordnen([
      wand("a1", "a", [0, 0, 8000, 0], [
        tuer("t", 500),
        tuer("d", 2000, { art: "passage" }),
        tuer("f", 4000, { art: "window", breiteMm: 1010, hoeheMm: 1260, bruestungMm: 900 }),
      ]),
      wand("b1", "b", [8000, 0, 0, 0]),
    ]);
    expect([...e.values()].map((x) => [x.oeffnung.oeffnungId, x.klasse, x.nachbarRaumId])).toEqual([
      ["d", "gemeinsam", "b"],
      ["f", "gemeinsam", "b"],
      ["t", "gemeinsam", "b"],
    ]);
  });

  it("unerwartet ungültige Öffnung wird als ungültig eingeordnet, ohne Absturz", () => {
    const e = einordnen([wand("a1", "a", [0, 0, 5000, 0], [tuer("zu-breit", 4500), tuer("krumm", 1000.5)])]);
    expect(e.get("zu-breit")!.klasse).toBe("ungueltig");
    expect(e.get("krumm")!.klasse).toBe("ungueltig");
  });
});

describe("Vorhandene beidseitige Erfassungen", () => {
  const paar = (a: TopoOeffnung, b: TopoOeffnung) =>
    einordnen([wand("a1", "kueche", [0, 0, 5000, 0], [a]), wand("b1", "flur", [5000, 0, 0, 0], [b])]);

  it("exakte Dublette (Gegenrichtung umgerechnet): gemeinsam, zur Bereinigung gemeldet", () => {
    // 5000 − 1000 − 885 = 3115
    const e = paar(tuer("oa", 1000), tuer("ob", 3115));
    expect(e.get("oa")).toMatchObject({ klasse: "gemeinsam", dubletten: ["ob"], widersprueche: [] });
    expect(e.get("ob")).toMatchObject({ klasse: "gemeinsam", dubletten: ["oa"] });
  });

  it("gleiche Geometrie, andere Art: Konflikt", () => {
    const e = paar(tuer("oa", 1000), tuer("ob", 3115, { art: "passage" }));
    expect(e.get("oa")).toMatchObject({ klasse: "konflikt", grund: "art", widersprueche: ["ob"] });
  });

  it("teilweise überlappende Öffnungen der beiden Seiten: Konflikt", () => {
    const e = paar(tuer("oa", 1000), tuer("ob", 3000, { breiteMm: 1010 }));
    expect(e.get("oa")).toMatchObject({ klasse: "konflikt", grund: "widerspruch", widersprueche: ["ob"] });
    expect(e.get("ob")!.klasse).toBe("konflikt");
  });

  it("gleiche Lage, andere Höhe oder Brüstung: Konflikt", () => {
    expect(paar(tuer("oa", 1000), tuer("ob", 3115, { hoeheMm: 2135 })).get("oa")!.grund).toBe("widerspruch");
    expect(paar(tuer("oa", 1000, { art: "window", bruestungMm: 900, hoeheMm: 1000 }), tuer("ob", 3115, { art: "window", bruestungMm: 1000, hoeheMm: 1000 })).get("oa")!.grund).toBe("widerspruch");
  });

  it("verschiedene, nicht überlappende Öffnungen beider Seiten sind unabhängig", () => {
    const e = paar(tuer("oa", 500), tuer("ob", 500));
    expect(e.get("oa")).toMatchObject({ klasse: "gemeinsam", dubletten: [], widersprueche: [] });
    expect(e.get("ob")).toMatchObject({ klasse: "gemeinsam", dubletten: [], widersprueche: [] });
  });

  it("verändert die Eingangsdaten nicht", () => {
    const waende = topoWaendeAus(messlauf4a());
    const vorher = JSON.stringify(waende);
    oeffnungenEinordnen(wandtopologie("g1", waende));
    expect(JSON.stringify(waende)).toBe(vorher);
  });
});

describe("Übertragung zwischen Wänden", () => {
  it("lokaler Bereich in kanonischer Richtung, auch bei Gegenrichtung", () => {
    const t = wandtopologie("g1", [wand("a1", "a", [0, 0, 5000, 0]), wand("b1", "b", [5000, 0, 0, 0])]);
    const abschnitt = t.abschnitte[0]!;
    const b = abschnitt.quellen.find((q) => q.wand.id === "b1")!;
    const bereich = lokalerBereich(b, 1000, 885, abschnitt.mass);
    expect([alsZahl(bereich.s0, abschnitt.mass), alsZahl(bereich.s1, abschnitt.mass)]).toEqual([3115, 4000]);
  });

  it("Öffnungen der Gegenseite erscheinen in der Richtung der eigenen Wand", () => {
    const t = wandtopologie("g1", [
      wand("flur", "flur", [0, 0, 0, 9000]),
      wand("bad", "bad", [0, 3000, 0, 0], [tuer("t-bad", 1000)]),
    ]);
    const fremd = fremdeBereiche(t.teilung.get("flur")!);
    expect(fremd.map((f) => [f.oeffnungId, f.raumId, f.bereich.s0, f.bereich.s1])).toEqual([
      ["t-bad", "bad", ganzeLage(1115), ganzeLage(2000)],
    ]);
    expect(fremdeBereiche(t.teilung.get("bad")!)).toEqual([]);
  });

  it("bereichEinordnen beurteilt Vorschau und gespeicherte Öffnung gleich", () => {
    const t = wandtopologie("g1", [wand("lang", "flur", [0, 0, 9000, 0]), wand("kurz", "bad", [6000, 0, 3000, 0])]);
    const lang = t.teilung.get("lang")!;
    expect(bereichEinordnen(lang, 3000, 3000).klasse).toBe("gemeinsam");
    expect(bereichEinordnen(lang, 3000, 3001).grund).toBe("teilweise");
    expect(bereichEinordnen(lang, 8200, 885).klasse).toBe("ungueltig");
  });
});

describe("Realer Grundriss aus dem Messlauf 4a", () => {
  it("Bad-, Schlafen- und Kindertür verbinden über die Teilwand mit dem Flur", () => {
    const e = oeffnungenEinordnen(wandtopologie("g1", topoWaendeAus(messlauf4a())));
    const nachbar = (id: string) => [e.get(id)!.klasse, e.get(id)!.nachbarRaumId];
    expect(nachbar("t-bad")).toEqual(["gemeinsam", "flur"]);
    expect(nachbar("t-schlafen")).toEqual(["gemeinsam", "flur"]);
    expect(nachbar("t-kind")).toEqual(["gemeinsam", "flur"]);
    expect(nachbar("t-hwr")).toEqual(["gemeinsam", "bad"]);
    expect(nachbar("t-kueche")).toEqual(["gemeinsam", "kueche"]);
    expect(nachbar("t-wohnen")).toEqual(["gemeinsam", "wohnen"]);
    expect(nachbar("t-haustuer")).toEqual(["aussen", null]);
    expect([...e.values()].filter((x) => x.oeffnung.art === "window").every((x) => x.klasse === "aussen")).toBe(true);
    expect([...e.values()].some((x) => x.klasse === "konflikt" || x.dubletten.length > 0)).toBe(false);
    expect(e.size).toBe(15);
  });
});
