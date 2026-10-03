import { describe, expect, it } from "vitest";

import { mmAnzeigen } from "../../../core/masse";
import { rechteck } from "../ansicht3d/testplan";
import type { RaumImPlan } from "../editor/entwurf";
import { basisAus } from "../editor/entwurf";
import { editorEinordnung, editorTopologie } from "../editor/platzierung";
import { masslinien } from "./masslinien";
import { fangen, waagerechteZiele } from "./wandfang";
import type { Fangoptionen, Nachbaroeffnung } from "./wandfang";
import type { Wandbezug } from "./wandbezug";
import { wandbezug } from "./wandbezug";
import { wandmodell } from "./wandmodell";
import { lagePruefen } from "./wandpruefung";
import { bewegen, platzieren } from "./wandziehen";
import type { Bewegungskontext } from "./wandziehen";

const cm = (mm: number) => mmAnzeigen(mm, "cm");
const name = (id: string) => ({ "raum-1": "Wohnzimmer", "raum-2": "Flur", "raum-3": "Bad" })[id] ?? id;

/**
 * Wohnzimmer 0…5000 × 0…4000, Flur 5000…7000 × 0…4000 - beide gegen den
 * Uhrzeigersinn. Die gemeinsame Wand x = 5000 ist im Wohnzimmer `raum-1-w1`
 * (5000,0)→(5000,4000), im Flur `raum-2-w3` (5000,4000)→(5000,0).
 */
function grundriss(raeume: readonly RaumImPlan[]) {
  const darstellung = raeume.map((r) => ({ id: r.id, walls: basisAus(r).entwurf.walls }));
  const topologie = editorTopologie("geschoss-1", darstellung);
  return { darstellung, topologie, einordnung: editorEinordnung(topologie) };
}

function bezugVon(raum: RaumImPlan, wandId: string): Wandbezug {
  const e = wandbezug(raum.id, basisAus(raum).entwurf.walls, wandId, raum.effective_height_mm);
  if (!e.ok) throw new Error(e.grund);
  return e.bezug;
}

/** Grund einer abgelehnten Lage - leer, wenn sie zulässig war. */
function grund(e: ReturnType<typeof lagePruefen>): string {
  return e.ok ? "" : e.grund;
}

const tuer = { id: "tuer", art: "door" as const, offset: 1000, breite: 885, hoehe: 2010 };

describe("gemeinsame Wand: eine Öffnung, zwei Ansichten", () => {
  const wohnzimmer = rechteck("raum-1", "Wohnzimmer", [0, 0], [5000, 4000], { oeffnungen: { 1: [tuer] } });
  const flur = rechteck("raum-2", "Flur", [5000, 0], [7000, 4000], { hoehe: 2600 });
  const g = grundriss([wohnzimmer, flur]);

  it("aus dem Wohnzimmer (Blick nach rechts/Osten) - eigene, bearbeitbare Öffnung", () => {
    const b = bezugVon(wohnzimmer, "raum-1-w1");
    expect(b.blick).toBe("nach rechts");
    const wand = basisAus(wohnzimmer).entwurf.walls[1];
    const m = wandmodell(b, wand!, g.topologie, g.einordnung);
    expect(m.oeffnungen).toHaveLength(1);
    expect(m.oeffnungen[0]).toMatchObject({ id: "tuer", eigen: true, links: 2115, rechts: 3000, unten: 0, oben: 2010 });
    expect(m.abschnitte).toEqual([{ links: 0, rechts: 4000, nachbarn: ["raum-2"], mehrdeutig: false }]);
  });

  it("aus dem Flur (Blick nach links/Westen) - dieselbe ID, gespiegelt, abgeleitet", () => {
    const b = bezugVon(flur, "raum-2-w3");
    expect(b.blick).toBe("nach links");
    const wand = basisAus(flur).entwurf.walls[3];
    const m = wandmodell(b, wand!, g.topologie, g.einordnung);
    expect(m.oeffnungen).toHaveLength(1);
    // Wer nach Westen blickt, hat Süden links: Die Tür (y 1000…1885) beginnt 1000 mm von links.
    expect(m.oeffnungen[0]).toMatchObject({ id: "tuer", eigen: false, links: 1000, rechts: 1885, quelleRaumId: "raum-1" });
    expect(b.hoeheMm).toBe(2600);
  });
});

describe("teilweise gemeinsame Wand", () => {
  // Lange Flurwand 0…6000 neben zwei Räumen: A 0…3000, B 3000…6000.
  const flur = rechteck("raum-2", "Flur", [0, 4000], [6000, 6000]);
  const a = rechteck("raum-1", "Wohnzimmer", [0, 0], [3000, 4000], { oeffnungen: { 2: [{ id: "ta", art: "door", offset: 500, breite: 885, hoehe: 2010 }] } });
  const bad = rechteck("raum-3", "Bad", [3000, 0], [6000, 4000]);
  const g = grundriss([flur, a, bad]);

  it("zeigt die Abschnitte mit ihrem Nachbarraum und die abgeleitete Tür an der richtigen Stelle", () => {
    const b = bezugVon(flur, "raum-2-w0"); // Südwand des Flurs (0,4000)→(6000,4000), Blick nach unten
    expect(b.blick).toBe("nach unten");
    const m = wandmodell(b, basisAus(flur).entwurf.walls[0]!, g.topologie, g.einordnung);
    // Blick nach Süden: Osten (x = 6000) ist links. Bad liegt links, Wohnzimmer rechts.
    expect(m.abschnitte).toEqual([
      { links: 0, rechts: 3000, nachbarn: ["raum-3"], mehrdeutig: false },
      { links: 3000, rechts: 6000, nachbarn: ["raum-1"], mehrdeutig: false },
    ]);
    // Wohnzimmer-Nordwand läuft (3000,4000)→(0,4000); Tür bei 500…1385 ab x = 3000 → x 1615…2500.
    expect(m.oeffnungen[0]).toMatchObject({ id: "ta", eigen: false, links: 3500, rechts: 4385 });
  });

  it("Platzieren über die Grenze zweier Nachbarn ist unzulässig, innerhalb eines Abschnitts erlaubt", () => {
    const b = bezugVon(flur, "raum-2-w0");
    const teilung = g.topologie.teilung.get("raum-2-w0");
    const optionen = { laengeText: cm, raumName: name };
    const ueberGrenze = grund(lagePruefen(b, teilung, "door", { links: 2600, rechts: 3485, unten: 0, oben: 2010 }, optionen));
    expect(ueberGrenze).toMatch(/Grenze zweier Nachbarräume/);
    const imBad = lagePruefen(b, teilung, "door", { links: 1000, rechts: 1885, unten: 0, oben: 2010 }, optionen);
    expect(imBad.ok).toBe(true);
    // In der Ansicht 1000…1885 von links = gespeichert 6000 − 1885 = 4115 ab Wandanfang (0,4000).
    expect(imBad.ok && imBad.werte).toEqual({ offset_mm: 4115, width_mm: 885, height_mm: 2010, sill_height_mm: 0 });
    // Überschneidung mit der auf der Gegenseite gespeicherten Tür.
    const kollision = grund(lagePruefen(b, teilung, "door", { links: 4000, rechts: 4885, unten: 0, oben: 2010 }, optionen));
    expect(kollision).toMatch(/in „Wohnzimmer“ an dieser Wand gespeichert/);
    // Eigene Öffnung dieser Wand: benannt in der Sprache der Ansicht, nicht ab Wandanfang.
    const ohneTuer = rechteck("raum-2", "Flur", [0, 4000], [6000, 6000], { oeffnungen: { 0: [{ id: "f", art: "door", offset: 100, breite: 885, hoehe: 2010 }] } });
    const g2 = grundriss([ohneTuer]);
    const b2 = bezugVon(ohneTuer, "raum-2-w0");
    const eigen = grund(lagePruefen(b2, g2.topologie.teilung.get("raum-2-w0"), "door", { links: 5000, rechts: 5885, unten: 0, oben: 2010 }, optionen));
    expect(eigen).toBe("Überschneidet sich mit der vorhandenen Tür 501,5 cm von links.");
  });
});

describe("Höhen- und Größenregeln", () => {
  const raum = rechteck("raum-1", "Wohnzimmer", [0, 0], [5000, 4000]);
  const g = grundriss([raum]);
  const b = bezugVon(raum, "raum-1-w0");
  const teilung = g.topologie.teilung.get("raum-1-w0");
  const o = { laengeText: cm, raumName: name };

  it("Oberkante über der Decke, Fenster ohne Brüstung, Tür mit Brüstung, zu klein", () => {
    expect(grund(lagePruefen(b, teilung, "window", { links: 0, rechts: 1000, unten: 1500, oben: 2600 }, o))).toBe(
      "Die Oberkante (260 cm) läge über der Decke (250 cm).",
    );
    expect(grund(lagePruefen(b, teilung, "window", { links: 0, rechts: 1000, unten: 0, oben: 1200 }, o))).toMatch(/Brüstung/);
    expect(grund(lagePruefen(b, teilung, "door", { links: 0, rechts: 1000, unten: 10, oben: 2010 }, o))).toMatch(/stehen auf dem Boden/);
    expect(grund(lagePruefen(b, teilung, "door", { links: 0, rechts: 99, unten: 0, oben: 2010 }, o))).toMatch(/mindestens 10 cm/);
    expect(grund(lagePruefen(b, teilung, "door", { links: -1, rechts: 884, unten: 0, oben: 2010 }, o))).toMatch(/vollständig in der Wand/);
    // Bündig unter der Decke und an der Wandkante: erlaubt (Berührung ist erlaubt).
    expect(lagePruefen(b, teilung, "door", { links: 4115, rechts: 5000, unten: 0, oben: 2500 }, o).ok).toBe(true);
  });
});

describe("Einrasten", () => {
  const andere: Nachbaroeffnung[] = [{ id: "f1", name: "Fenster 1", links: 500, rechts: 1500, unten: 900, oben: 2160, fenster: true }];
  const basis: Fangoptionen = { aktiv: true, ausgesetzt: false, massstab: 0.1, rasterMm: 100, rasterBezug: 0 };
  const ziele = waagerechteZiele(5000, andere);

  it("Toleranz in Bildschirmpixeln: 10 px sind bei 0,1 px/mm 100 mm, bei 1 px/mm 10 mm", () => {
    // Linke Kante bei 1560: 60 mm neben der rechten Kante von Fenster 1.
    const merkmale = [{ wert: 1560, versatz: 0, ziele: ziele.links }];
    expect(fangen(merkmale, { ...basis, rasterBezug: 1560 }).ziel?.id).toBe("kante:f1:rechts");
    expect(fangen(merkmale, { ...basis, rasterBezug: 1560, massstab: 1 }).ziel?.art).toBe("raster");
  });

  it("Priorität bei gleichem Abstand: Wandkante vor Öffnungskante vor Wandmitte", () => {
    const gleich = [
      { wert: 40, versatz: 0, ziele: [{ id: "m", art: "wandmitte" as const, wert: 0, text: "Mitte" }, { id: "k", art: "oeffnungskante" as const, wert: 80, text: "Kante" }, { id: "w", art: "wandkante" as const, wert: 0, text: "Wand" }] },
    ];
    expect(fangen(gleich, { ...basis, rasterBezug: 40 }).ziel?.id).toBe("w");
    // Ergebnis unabhängig von der Reihenfolge der Ziele.
    const umgedreht = [{ ...gleich[0]!, ziele: [...gleich[0]!.ziele].reverse() }];
    expect(fangen(umgedreht, { ...basis, rasterBezug: 40 }).ziel?.id).toBe("w");
  });

  it("Wandmitte: Mitte der Öffnung auf L/2, ganzzahlig gerundet", () => {
    const merkmale = [{ wert: 2470, versatz: 442.5, ziele: ziele.mitte }];
    const f = fangen(merkmale, { ...basis, rasterBezug: 2470 - 442.5 });
    expect(f.ziel?.id).toBe("wand-mitte");
    // Linke Kante exakt 2500 − 442,5 = 2057,5 → 2058 - auch bei Gleitkommarauschen der Zeigerlage.
    expect(2470 - 442.5 + f.verschiebung).toBe(2058);
    const rauschen = fangen([{ wert: 2470.0000001, versatz: 442.5, ziele: ziele.mitte }], { ...basis, rasterBezug: 2470.0000001 - 442.5 });
    expect(Math.round(2470.0000001 - 442.5 + rauschen.verschiebung)).toBe(2058);
  });

  it("Hysterese: ein knapp näheres Ziel verdrängt das bisherige nicht", () => {
    const zwei = [{ wert: 100, versatz: 0, ziele: [{ id: "a", art: "oeffnungskante" as const, wert: 130, text: "A" }, { id: "b", art: "oeffnungskante" as const, wert: 80, text: "B" }] }];
    expect(fangen(zwei, { ...basis, rasterBezug: 100 }).ziel?.id).toBe("b");
    expect(fangen(zwei, { ...basis, rasterBezug: 100, vorher: "a" }).ziel?.id).toBe("a");
  });

  it("ausgeschaltet oder Alt: nur ganze Millimeter, kein Ziel", () => {
    const alt = fangen([{ wert: 1560.4, versatz: 0, ziele: ziele.links }], { ...basis, rasterBezug: 1560.4, ausgesetzt: true });
    expect(alt.ziel).toBeNull();
    expect(Math.round(1560.4 + alt.verschiebung)).toBe(1560);
    expect(fangen([{ wert: 1560.6, versatz: 0, ziele: ziele.links }], { ...basis, rasterBezug: 1560.6, aktiv: false }).ziel).toBeNull();
  });
});

describe("Verschieben, Größe ändern, Platzieren", () => {
  const k: Bewegungskontext = {
    laengeMm: 5000,
    hoeheMm: 2500,
    andere: [{ id: "f1", name: "Fenster 1", links: 500, rechts: 1500, unten: 900, oben: 2160, fenster: true }],
    fenster: true,
    fang: { aktiv: true, ausgesetzt: false, massstab: 0.1, rasterMm: 100 },
  };
  const fenster = { links: 3000, rechts: 4000, unten: 1000, oben: 2200 };

  it("Fenster verschieben rastet an gleicher Brüstung und Kante ein", () => {
    const e = bewegen(fenster, { art: "verschieben" }, -1440, -70, k);
    expect(e.zielWaagerecht?.id).toBe("kante:f1:rechts");
    expect(e.rechteck).toEqual({ links: 1500, rechts: 2500, unten: 900, oben: 2100 });
    expect(e.zielSenkrecht?.id).toBe("bruestung:f1");
  });

  it("Tür bleibt beim Verschieben auf dem Boden", () => {
    const tuer = { links: 3000, rechts: 3885, unten: 0, oben: 2010 };
    expect(bewegen(tuer, { art: "verschieben" }, 33, 400, { ...k, fenster: false }).rechteck.unten).toBe(0);
  });

  it("Griffe: Gegenkante bleibt, Oberkante rastet an der Decke", () => {
    expect(bewegen(fenster, { art: "groesse", griff: "rechts" }, 960, 0, k).rechteck).toMatchObject({ links: 3000, rechts: 5000 });
    expect(bewegen(fenster, { art: "groesse", griff: "oben" }, 0, 270, k)).toMatchObject({ rechteck: { unten: 1000, oben: 2500 }, zielSenkrecht: { id: "decke" } });
    expect(bewegen(fenster, { art: "groesse", griff: "unten" }, 0, -120, k).rechteck).toMatchObject({ unten: 900, oben: 2200 });
  });

  it("neue Tür: Mitte unter dem Zeiger, auf dem Raster, auf dem Boden", () => {
    const e = platzieren(2730, { breite: 885, hoehe: 2010, bruestung: 0 }, { ...k, andere: [] });
    expect(e.rechteck.unten).toBe(0);
    expect(e.rechteck.rechts - e.rechteck.links).toBe(885);
    expect(Number.isInteger(e.rechteck.links)).toBe(true);
  });
});

describe("Maßlinien", () => {
  it("Randabstände zur Objektkante, freier Abstand zum nächsten Nachbarn, Decke", () => {
    const linien = masslinien(
      { links: 2000, rechts: 2885, unten: 0, oben: 2010 },
      5000,
      2500,
      [
        { id: "f1", name: "Fenster 1", links: 500, rechts: 1500, unten: 900, oben: 2160 },
        { id: "f0", name: "Fenster 0", links: 0, rechts: 400, unten: 900, oben: 2160 },
        { id: "f2", name: "Fenster 2", links: 3500, rechts: 4500, unten: 900, oben: 2160 },
      ],
      cm,
    );
    const text = Object.fromEntries(linien.map((l) => [l.id, `${l.bezeichnung}: ${l.text}`]));
    expect(text).toEqual({
      links: "Abstand von links: 200 cm",
      breite: "Breite: 88,5 cm",
      rechts: "Abstand von rechts: 211,5 cm",
      "nachbar-links": "frei zu Fenster 1: frei 50 cm",
      "nachbar-rechts": "frei zu Fenster 2: frei 61,5 cm",
      hoehe: "Höhe: 201 cm",
      decke: "Abstand zur Decke: 49 cm",
    });
  });

  it("Überschneidung erscheint nie als positiver Abstand", () => {
    const linien = masslinien({ links: 1400, rechts: 2400, unten: 900, oben: 2100 }, 5000, 2500, [{ id: "f1", name: "Fenster 1", links: 500, rechts: 1500, unten: 900, oben: 2160 }], cm);
    const nachbar = linien.find((l) => l.id === "nachbar-links");
    expect(nachbar).toMatchObject({ art: "ueberschneidung", text: "überschneidet" });
    expect(linien.find((l) => l.id === "bruestung")?.text).toBe("90 cm");
  });
});
