import { describe, expect, it } from "vitest";

import { aufgeklappt, geraetelayout, MAX_FAECHER, SYMBOLGROESSE, type LayoutGeraet, type Symbollage } from "./geraetelayout";
import { weltZuBild, type Viewport } from "./viewport";

/**
 * Symbollage im Grundriss (Phase 5): Montagepunkt und Symbolposition getrennt,
 * Zuordnung versetzter Symbole, Gruppen statt endloser Verschiebung.
 */
const VIEW: Viewport = { massstab: 0.1, ursprungX: 100, ursprungY: 500 };

/** Wand entlang +x (0,0)->(5000,0); innen = +y (Raum oberhalb), Stärke 200. */
const wand = (id: string, mitte: number, seite: "innen" | "aussen" = "innen"): LayoutGeraet => ({
  id,
  anker: { x: mitte, y: 0 },
  versatzMm: 100,
  richtung: seite === "innen" ? { x: 0, y: 1 } : { x: 0, y: -1 },
  decke: false,
});
const decke = (id: string, x: number, y: number): LayoutGeraet => ({ id, anker: { x, y }, versatzMm: 0, richtung: { x: 0, y: 0 }, decke: true });

function alle(layout: ReturnType<typeof geraetelayout>): Symbollage[] {
  return [...layout.einzeln, ...layout.gruppen.flatMap((g) => g.mitglieder)];
}
const lage = (layout: ReturnType<typeof geraetelayout>, id: string) => alle(layout).find((s) => s.id === id) as Symbollage;
const abstand = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("geraetelayout", () => {
  it("einzelnes Wandgerät: Symbol knapp vor der Wand auf der Montageseite, nicht versetzt", () => {
    const l = geraetelayout([wand("a", 1000)], VIEW);
    const s = lage(l, "a");
    expect(s.versetzt).toBe(false);
    // Montagepunkt = Wandoberfläche innen (y = +100 mm).
    expect(s.montage).toEqual(weltZuBild(VIEW, { x: 1000, y: 100 }));
    // Innen liegt im Bild oberhalb (kleineres y).
    expect(s.symbol.y).toBeLessThan(s.montage.y);
    expect(s.symbol.x).toBeCloseTo(s.montage.x);
  });

  it("mehrere Wandgeräte am gleichen Grundrisspunkt (verschiedene Höhen): aufgefächert, Linie zum gemeinsamen Montagepunkt", () => {
    // Steckdose (300 mm) und Wandleuchte (1800 mm) an derselben Stelle - der Grundriss kennt keine Höhe.
    const l = geraetelayout([wand("steckdose", 2000), wand("leuchte", 2000), wand("schalter", 2000)], VIEW);
    const lagen = ["steckdose", "leuchte", "schalter"].map((id) => lage(l, id));
    expect(l.gruppen).toEqual([]);
    for (const s of lagen) {
      expect(s.versetzt).toBe(true);
      expect(s.montage).toEqual(weltZuBild(VIEW, { x: 2000, y: 100 }));
      // Nah am Ort, auf der Innenseite.
      expect(abstand(s.symbol, s.montage)).toBeLessThan(3 * SYMBOLGROESSE);
      expect(s.symbol.y).toBeLessThan(s.montage.y);
    }
    for (let i = 0; i < lagen.length; i += 1) {
      for (let j = i + 1; j < lagen.length; j += 1) {
        expect(abstand((lagen[i] as Symbollage).symbol, (lagen[j] as Symbollage).symbol)).toBeGreaterThanOrEqual(SYMBOLGROESSE);
      }
    }
  });

  it("Innen- und Außengerät an derselben Wandstelle: getrennte Seiten, keine Gruppe, kein Versatz", () => {
    const l = geraetelayout([wand("innen", 2000, "innen"), wand("aussen", 2000, "aussen")], VIEW);
    const innen = lage(l, "innen");
    const aussen = lage(l, "aussen");
    expect(innen.versetzt).toBe(false);
    expect(aussen.versetzt).toBe(false);
    expect(innen.montage).toEqual(weltZuBild(VIEW, { x: 2000, y: 100 }));
    expect(aussen.montage).toEqual(weltZuBild(VIEW, { x: 2000, y: -100 }));
    // Innen oberhalb der Wand, außen unterhalb.
    expect(innen.symbol.y).toBeLessThan(innen.montage.y);
    expect(aussen.symbol.y).toBeGreaterThan(aussen.montage.y);
  });

  it("auch bei kleinem Maßstab bleiben Innen und Außen getrennt", () => {
    const fern: Viewport = { massstab: 0.005, ursprungX: 100, ursprungY: 500 };
    const l = geraetelayout([wand("innen", 2000, "innen"), wand("aussen", 2000, "aussen")], fern);
    expect(l.gruppen).toEqual([]);
    expect(alle(l).every((s) => !s.versetzt)).toBe(true);
  });

  it("dicht beieinanderliegende Deckengeräte: bis MAX_FAECHER aufgefächert, darüber eine Gruppe", () => {
    const zwei = geraetelayout([decke("d1", 1000, 1000), decke("d2", 1050, 1000)], VIEW);
    expect(zwei.gruppen).toEqual([]);
    expect(lage(zwei, "d1").versetzt).toBe(true);
    expect(lage(zwei, "d1").montage).toEqual(weltZuBild(VIEW, { x: 1000, y: 1000 }));
    expect(lage(zwei, "d2").montage).toEqual(weltZuBild(VIEW, { x: 1050, y: 1000 }));
    expect(abstand(lage(zwei, "d1").symbol, lage(zwei, "d2").symbol)).toBeGreaterThanOrEqual(SYMBOLGROESSE);

    const viele = Array.from({ length: MAX_FAECHER + 2 }, (_, i) => decke(`d${i}`, 1000 + i * 20, 1000));
    const gruppiert = geraetelayout(viele, VIEW);
    expect(gruppiert.einzeln).toEqual([]);
    expect(gruppiert.gruppen).toHaveLength(1);
    const gruppe = gruppiert.gruppen[0];
    expect(gruppe?.mitglieder.map((m) => m.id)).toEqual(viele.map((g) => g.id).sort());
    // Jedes Mitglied kennt seinen echten Montagepunkt; die Gruppe steht am Ort.
    for (const m of gruppe?.mitglieder ?? []) {
      const g = viele.find((x) => x.id === m.id) as LayoutGeraet;
      expect(m.montage).toEqual(weltZuBild(VIEW, g.anker));
      expect(abstand(m.montage, gruppe?.lage ?? m.montage)).toBeLessThan(2 * SYMBOLGROESSE);
    }
  });

  it("aufgeklappte Gruppe: Plätze überlappen nicht und bleiben nah", () => {
    const plaetze = aufgeklappt({ x: 0, y: 0 }, 30);
    expect(plaetze).toHaveLength(30);
    for (let i = 0; i < plaetze.length; i += 1) {
      for (let j = i + 1; j < plaetze.length; j += 1) expect(abstand(plaetze[i] as never, plaetze[j] as never)).toBeGreaterThanOrEqual(SYMBOLGROESSE);
    }
    expect(Math.max(...plaetze.map((p) => Math.hypot(p.x, p.y)))).toBeLessThan(120);
  });

  it("deterministisch: Reihenfolge der Eingabe ändert nichts", () => {
    const geraete = [wand("c", 2000), wand("a", 2000), decke("x", 1000, 1000), wand("b", 2010), decke("y", 1010, 1000)];
    const vorwaerts = geraetelayout(geraete, VIEW);
    const rueckwaerts = geraetelayout([...geraete].reverse(), VIEW);
    expect(rueckwaerts).toEqual(vorwaerts);
  });

  it("Zoom: Bei großem Maßstab lösen sich Stellen auf, die bei kleinem zusammenfallen", () => {
    const geraete = [decke("d1", 1000, 1000), decke("d2", 1150, 1000)];
    expect(alle(geraetelayout(geraete, { ...VIEW, massstab: 0.05 })).every((s) => s.versetzt)).toBe(true);
    expect(alle(geraetelayout(geraete, { ...VIEW, massstab: 1 })).every((s) => !s.versetzt)).toBe(true);
  });

  it("eine aufgefächerte Stelle, die eine Nachbarstelle berührt, wird mit ihr vereinigt - nichts deckt sich", () => {
    const geraete = [wand("a", 2000), wand("b", 2000), wand("c", 2000), wand("d", 2150)];
    const l = geraetelayout(geraete, VIEW);
    const symbole = [...l.einzeln.map((s) => s.symbol), ...l.gruppen.map((g) => g.lage)];
    for (let i = 0; i < symbole.length; i += 1) {
      for (let j = i + 1; j < symbole.length; j += 1) expect(abstand(symbole[i] as never, symbole[j] as never)).toBeGreaterThanOrEqual(SYMBOLGROESSE);
    }
  });

  it("verändert die Eingabe nicht - Gerätekoordinaten bleiben wie gespeichert", () => {
    const geraete = Object.freeze([Object.freeze(wand("a", 2000)), Object.freeze(wand("b", 2000)), Object.freeze(decke("d", 1000, 1000))]);
    const kopie = JSON.parse(JSON.stringify(geraete)) as unknown;
    geraetelayout(geraete, VIEW);
    expect(geraete).toEqual(kopie);
  });
});
