import { describe, expect, it } from "vitest";

import {
  MAX_MASSSTAB,
  MIN_MASSSTAB,
  aufMillimeter,
  bildZuWelt,
  einpassen,
  groesseAendern,
  grenzenVon,
  verschieben,
  weltZuBild,
  zoomen,
} from "./viewport";
import type { Viewport } from "./viewport";

const V: Viewport = { massstab: 0.05, ursprungX: 100, ursprungY: 500 };

describe("Welt ↔ Bild", () => {
  it("bildet Weltmillimeter auf Bildpixel ab, y nach oben", () => {
    expect(weltZuBild(V, { x: 0, y: 0 })).toEqual({ x: 100, y: 500 });
    expect(weltZuBild(V, { x: 5000, y: 4000 })).toEqual({ x: 350, y: 300 });
  });

  it("ist umkehrbar", () => {
    const welt = { x: 1234, y: -5678 };
    const zurueck = bildZuWelt(V, weltZuBild(V, welt));
    expect(zurueck.x).toBeCloseTo(welt.x, 9);
    expect(zurueck.y).toBeCloseTo(welt.y, 9);
  });

  it("liefert Gleitkomma - erst aufMillimeter macht daraus eine fachliche Koordinate", () => {
    const welt = bildZuWelt(V, { x: 100.01, y: 499.97 });
    expect(Number.isInteger(welt.x)).toBe(false);
    expect(aufMillimeter(welt)).toEqual({ x: 0, y: 1 });
  });

  it("rundet halbe Millimeter deterministisch und ohne -0", () => {
    expect(aufMillimeter({ x: 2.5, y: -2.5 })).toEqual({ x: 3, y: -2 });
    expect(Object.is(aufMillimeter({ x: -0.2, y: 0 }).x, 0)).toBe(true);
  });
});

describe("Zoom, Pan, Einpassen, Größe", () => {
  it("zoomt um die Zeigerposition: der Weltpunkt darunter bleibt stehen", () => {
    const anker = { x: 400, y: 250 };
    const vorher = bildZuWelt(V, anker);
    const nachher = zoomen(V, 2, anker);
    expect(nachher.massstab).toBe(0.1);
    const danach = bildZuWelt(nachher, anker);
    expect(danach.x).toBeCloseTo(vorher.x, 9);
    expect(danach.y).toBeCloseTo(vorher.y, 9);
  });

  it("begrenzt den Maßstab", () => {
    expect(zoomen(V, 1e6, { x: 0, y: 0 }).massstab).toBe(MAX_MASSSTAB);
    expect(zoomen(V, 1e-6, { x: 0, y: 0 }).massstab).toBe(MIN_MASSSTAB);
  });

  it("verschiebt nur den Ursprung", () => {
    expect(verschieben(V, 10, -20)).toEqual({ massstab: 0.05, ursprungX: 110, ursprungY: 480 });
  });

  it("passt alle Räume mittig ein", () => {
    const g = grenzenVon([
      { x: 0, y: 0 },
      { x: 10_000, y: 8_000 },
    ]);
    const v = einpassen(g, { breite: 1080, hoehe: 880 }, 40);
    expect(v.massstab).toBeCloseTo(0.1, 9);
    const mitte = weltZuBild(v, { x: 5_000, y: 4_000 });
    expect(mitte.x).toBeCloseTo(540, 9);
    expect(mitte.y).toBeCloseTo(440, 9);
  });

  it("passt ohne Räume auf einen sinnvollen Startausschnitt ein", () => {
    expect(einpassen(null, { breite: 800, hoehe: 600 }).massstab).toBe(0.05);
  });

  it("hält bei Größenänderung Maßstab und Weltmitte", () => {
    const alt = { breite: 800, hoehe: 600 };
    const neu = { breite: 1200, hoehe: 400 };
    const mitteVorher = bildZuWelt(V, { x: 400, y: 300 });
    const v = groesseAendern(V, alt, neu);
    expect(v.massstab).toBe(V.massstab);
    const mitteNachher = bildZuWelt(v, { x: 600, y: 200 });
    expect(mitteNachher.x).toBeCloseTo(mitteVorher.x, 9);
    expect(mitteNachher.y).toBeCloseTo(mitteVorher.y, 9);
  });
});
