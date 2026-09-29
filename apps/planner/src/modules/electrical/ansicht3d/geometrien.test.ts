import type { BufferGeometry } from "three";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { BODEN_HOEHE_M, bodenGeometrie, oeffnungsGeometrie, wandGeometrie } from "./geometrien";
import type { Szenenmodell } from "./modell";
import { szenenmodellAus } from "./szenenmodell";
import { plan, raum, rechteck } from "./testplan";

/**
 * Szenenmodell → Three.js-Geometrie. Geprüft wird die ElektroPlan-Umwandlung
 * (Lage, Orientierung, Aussparungen), nicht Three.js selbst.
 */
function dreiecke(g: BufferGeometry): [Vector3, Vector3, Vector3][] {
  const pos = g.getAttribute("position");
  const index = g.getIndex();
  const ecke = (i: number) => new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  const liste: [Vector3, Vector3, Vector3][] = [];
  const anzahl = index === null ? pos.count : index.count;
  for (let i = 0; i < anzahl; i += 3) {
    const [a, b, c] = index === null ? [i, i + 1, i + 2] : [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    liste.push([ecke(a), ecke(b), ecke(c)]);
  }
  return liste;
}

const normale = ([a, b, c]: [Vector3, Vector3, Vector3]) =>
  new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));

function bodenflaecheM2(g: BufferGeometry): number {
  return dreiecke(g).reduce((summe, d) => summe + normale(d).length() / 2, 0);
}

const modellMit = (...rooms: Parameters<typeof plan>[0]) => szenenmodellAus(plan(rooms));
const ersterBoden = (m: Szenenmodell) => bodenGeometrie(m.raeume[0]!, m.transformation)!;

describe("Bodenflächen", () => {
  it("Rechteck: zentriert, auf Bodenhöhe, Normalen nach oben, 20 m²", () => {
    const g = ersterBoden(modellMit(rechteck("r", "Raum", [0, 0], [5000, 4000])));
    expect(dreiecke(g)).toHaveLength(2);
    for (const d of dreiecke(g)) expect(normale(d).y).toBeGreaterThan(0);
    expect(bodenflaecheM2(g)).toBeCloseTo(20, 6);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.min.x).toBeCloseTo(-2.5, 6);
    expect(box.max.x).toBeCloseTo(2.5, 6);
    expect(box.min.z).toBeCloseTo(-2, 6);
    expect(box.max.y).toBeCloseTo(BODEN_HOEHE_M, 6);
  });

  it("Rechteck im Uhrzeigersinn zeigt ebenfalls nach oben", () => {
    const cw = raum("r", "Raum", [
      [0, 0],
      [0, 4000],
      [5000, 4000],
      [5000, 0],
    ]);
    const g = ersterBoden(modellMit(cw));
    for (const d of dreiecke(g)) expect(normale(d).y).toBeGreaterThan(0);
    expect(bodenflaecheM2(g)).toBeCloseTo(20, 6);
  });

  it("L-Form (konkav) wird korrekt trianguliert: 22 m², keine Fläche außerhalb", () => {
    const l = raum("l", "Flur", [
      [0, 0],
      [6000, 0],
      [6000, 3000],
      [3000, 3000],
      [1000, 5000],
      [0, 5000],
    ]);
    const m = modellMit(l);
    const g = ersterBoden(m);
    expect(bodenflaecheM2(g)).toBeCloseTo(22, 6);
    for (const d of dreiecke(g)) {
      expect(normale(d).y).toBeGreaterThan(0);
      // Schwerpunkt jedes Dreiecks liegt nicht in der Aussparung der L-Form.
      const s = new Vector3().add(d[0]).add(d[1]).add(d[2]).divideScalar(3);
      const xMm = s.x * 1000 + m.transformation.mitteXMm;
      const yMm = -s.z * 1000 + m.transformation.mitteYMm;
      expect(xMm > 3000 && yMm > 3000).toBe(false);
    }
  });

  it("Draufsicht ist nicht gespiegelt: Osten +X, Norden −Z", () => {
    const m = modellMit(rechteck("r", "Raum", [0, 0], [5000, 4000]));
    const g = ersterBoden(m);
    const pos = g.getAttribute("position");
    // Ecke 1 = (5000, 0) → Osten/Süden, Ecke 3 = (0, 4000) → Westen/Norden.
    expect(pos.getX(1)).toBeGreaterThan(pos.getX(0));
    expect(pos.getZ(3)).toBeLessThan(pos.getZ(0));
  });
});

describe("Wandkörper", () => {
  const wandVon = (m: Szenenmodell, x1: number, y1: number, x2: number, y2: number) =>
    m.waende.find((w) => w.start.x === x1 && w.start.y === y1 && w.ende.x === x2 && w.ende.y === y2)!;

  it("geschlossene Wand: ein Quader mit Stärke, Höhe und Eckverlängerung", () => {
    const m = modellMit(rechteck("r", "Raum", [0, 0], [5000, 4000], { staerke: 200, hoehe: 2600 }));
    const g = wandGeometrie(wandVon(m, 0, 0, 5000, 0), m.transformation)!;
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(5.2, 6); // + halbe Stärke je Ende
    expect(box.max.z - box.min.z).toBeCloseTo(0.2, 6);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(2.6, 6);
    // 4 Seiten + Krone, keine Bodenfläche: 5 × 2 Dreiecke
    expect(dreiecke(g)).toHaveLength(10);
    expect(g.groups).toEqual([
      { start: 0, count: 24, materialIndex: 0 },
      { start: 24, count: 6, materialIndex: 1 },
    ]);
  });

  it("Teilabschnitte einer Geraden stoßen stumpf aneinander - keine Überlagerung, kein Flimmern", () => {
    // Lange Wand 0–8000 (Flur) neben kurzer Raumwand 0–4000: zwei Körper auf y = 0.
    const m = modellMit(
      raum("flur", "Flur", [[0, 0], [8000, 0], [8000, -2000], [0, -2000]]),
      rechteck("kueche", "Küche", [0, 0], [4000, 3000]),
    );
    const gemeinsam = wandVon(m, 0, 0, 4000, 0);
    const rest = wandVon(m, 4000, 0, 8000, 0);
    expect(gemeinsam.lage).toBe("gemeinsam");
    expect(rest.lage).toBe("aussen");
    const boxVon = (w: typeof gemeinsam) => {
      const g = wandGeometrie(w, m.transformation)!;
      g.computeBoundingBox();
      return g.boundingBox!;
    };
    const a = boxVon(gemeinsam);
    const b = boxVon(rest);
    // Freie Enden verlängert (Eckschluss), am Stoß bei x = 4000 nicht.
    expect(a.max.x - a.min.x).toBeCloseTo(4.0575, 6);
    expect(b.max.x - b.min.x).toBeCloseTo(4.0575, 6);
    expect(a.max.x).toBeCloseTo(b.min.x, 9);
  });

  it("jede Fläche zeigt nach außen", () => {
    const m = modellMit(rechteck("r", "Raum", [0, 0], [5000, 4000], { oeffnungen: { 0: [{ id: "t", offset: 1000, breite: 900, hoehe: 2000 }] } }));
    const wand = wandVon(m, 0, 0, 5000, 0);
    const g = wandGeometrie(wand, m.transformation)!;
    const nor = g.getAttribute("normal");
    dreiecke(g).forEach((d, i) => {
      const soll = new Vector3(nor.getX(i * 3), nor.getY(i * 3), nor.getZ(i * 3));
      expect(normale(d).normalize().dot(soll)).toBeCloseTo(1, 6);
    });
  });

  it("Tür: kein Dreieck liegt in der Aussparung", () => {
    const m = modellMit(
      rechteck("r", "Raum", [0, 0], [5000, 4000], { oeffnungen: { 0: [{ id: "t", offset: 1000, breite: 900, hoehe: 2000 }] } }),
    );
    const g = wandGeometrie(wandVon(m, 0, 0, 5000, 0), m.transformation)!;
    const xTuer0 = (1000 - m.transformation.mitteXMm) / 1000;
    const xTuer1 = (1900 - m.transformation.mitteXMm) / 1000;
    for (const d of dreiecke(g)) {
      const s = new Vector3().add(d[0]).add(d[1]).add(d[2]).divideScalar(3);
      const inTuer = s.x > xTuer0 + 1e-6 && s.x < xTuer1 - 1e-6 && s.y < 2 - 1e-6;
      expect(inTuer).toBe(false);
    }
  });

  it("Öffnungsfläche liegt exakt in der Aussparung, in der Wandmitte", () => {
    const m = modellMit(
      rechteck("r", "Raum", [0, 0], [5000, 4000], {
        oeffnungen: { 0: [{ id: "f", art: "window", offset: 1000, breite: 1200, hoehe: 1400, bruestung: 900 }] },
      }),
    );
    const wand = wandVon(m, 0, 0, 5000, 0);
    const g = oeffnungsGeometrie(wand.oeffnungen[0]!, wand, m.transformation);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.min.x).toBeCloseTo((1000 - 2500) / 1000, 6);
    expect(box.max.x).toBeCloseTo((2200 - 2500) / 1000, 6);
    expect(box.min.y).toBeCloseTo(0.9, 6);
    expect(box.max.y).toBeCloseTo(2.3, 6);
    expect(box.min.z).toBeCloseTo(box.max.z, 6);
    expect(box.min.z).toBeCloseTo(2, 6); // y = 0 liegt 2 m südlich der Mitte (+Z)
  });

  it("schräge Wand: Endpunkte liegen exakt auf der Strecke", () => {
    const m = modellMit(
      raum("l", "Flur", [
        [0, 0],
        [6000, 0],
        [6000, 3000],
        [3000, 3000],
        [1000, 5000],
        [0, 5000],
      ]),
    );
    const wand = wandVon(m, 1000, 5000, 3000, 3000);
    // Auch bei gerundeter Länge (2828 statt 2828,43 mm) endet die Wand exakt.
    const g = wandGeometrie({ ...wand, teile: [{ s0: 0, s1: wand.laengeMm, h0: 0, h1: 2500 }], staerkeMm: 0 }, m.transformation)!;
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.min.x).toBeCloseTo((1000 - m.transformation.mitteXMm) / 1000, 6);
    expect(box.max.x).toBeCloseTo((3000 - m.transformation.mitteXMm) / 1000, 6);
  });

  it("eine Wand ohne Teile erzeugt keine Geometrie", () => {
    const m = modellMit(rechteck("r", "Raum", [0, 0], [5000, 4000]));
    expect(wandGeometrie({ ...m.waende[0]!, teile: [] }, m.transformation)).toBeNull();
  });
});
