import { describe, expect, it } from "vitest";

import { inMeter, inSzene, METER_JE_MM, transformationFuer } from "./transformation";

/**
 * Grenze Millimeter → Szenenmeter (ADR 0016). Die fachlichen Werte bleiben
 * ganzzahlig; hier wird genau einmal umgerechnet.
 */
describe("Koordinatentransformation", () => {
  it("rechnet Millimeter in Meter um", () => {
    expect(METER_JE_MM).toBe(0.001);
    expect(inMeter(2500)).toBeCloseTo(2.5, 12);
    expect(inMeter(1)).toBeCloseTo(0.001, 12);
    expect(inMeter(0)).toBe(0);
  });

  it("bildet x auf +X, y auf −Z und die Höhe auf +Y ab", () => {
    const t = transformationFuer({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(inSzene(t, 1000, 0)).toEqual({ x: 1, y: 0, z: 0 });
    expect(inSzene(t, 0, 1000)).toEqual({ x: 0, y: 0, z: -1 });
    expect(inSzene(t, 0, 0, 2500)).toEqual({ x: 0, y: 2.5, z: 0 });
  });

  it("zentriert den Grundriss um den Mittelpunkt seiner Ausdehnung", () => {
    const t = transformationFuer({ minX: 0, minY: 0, maxX: 11_000, maxY: 9000 });
    expect(t).toEqual({ mitteXMm: 5500, mitteYMm: 4500, meterJeMm: 0.001 });
    expect(inSzene(t, 5500, 4500)).toEqual({ x: 0, y: 0, z: 0 });
    const ecke = inSzene(t, 0, 0);
    expect(ecke.x).toBeCloseTo(-5.5, 12);
    expect(ecke.z).toBeCloseTo(4.5, 12);
  });

  it("rundet eine halbe Millimetermitte ab und bleibt damit ganzzahlig", () => {
    const t = transformationFuer({ minX: 0, minY: -1, maxX: 5001, maxY: 0 });
    expect(Number.isInteger(t.mitteXMm)).toBe(true);
    expect(t.mitteXMm).toBe(2500);
    expect(t.mitteYMm).toBe(-1);
  });

  it("erhält die Orientierung: Draufsicht ist nicht gespiegelt", () => {
    const t = transformationFuer({ minX: 0, minY: 0, maxX: 5000, maxY: 4000 });
    // Gegen den Uhrzeigersinn im Grundriss …
    const [a, b, c] = [
      [0, 0],
      [5000, 0],
      [5000, 4000],
    ].map(([x, y]) => inSzene(t, x as number, y as number));
    // … Normale des Dreiecks (b−a)×(c−a) zeigt nach oben (+Y).
    const u = { x: b!.x - a!.x, z: b!.z - a!.z };
    const v = { x: c!.x - a!.x, z: c!.z - a!.z };
    const normaleY = u.z * v.x - u.x * v.z;
    expect(normaleY).toBeGreaterThan(0);
    // Blick von oben mit Norden oben: Bildschirm-rechts = +X, Bildschirm-oben = −Z.
    expect(b!.x).toBeGreaterThan(a!.x); // Osten bleibt rechts
    expect(-c!.z).toBeGreaterThan(-b!.z); // Norden bleibt oben
  });

  it("hält große, aber erlaubte Koordinaten nahe am Ursprung", () => {
    const t = transformationFuer({ minX: 990_000, minY: -1_000_000, maxX: 1_000_000, maxY: -990_000 });
    const p = inSzene(t, 1_000_000, -1_000_000);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(5);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(5);
    // Millimetergenau darstellbar, auch nach Float32 in der GPU.
    expect(Math.fround(p.x) - p.x).toBeLessThan(1e-6);
  });

  it("verarbeitet negative Koordinaten", () => {
    const t = transformationFuer({ minX: -6000, minY: -4000, maxX: -2000, maxY: 0 });
    expect(t.mitteXMm).toBe(-4000);
    expect(t.mitteYMm).toBe(-2000);
    expect(inSzene(t, -6000, 0)).toEqual({ x: -2, y: 0, z: -2 });
  });

  it("legt einen leeren Plan in den Ursprung", () => {
    expect(transformationFuer(null)).toEqual({ mitteXMm: 0, mitteYMm: 0, meterJeMm: 0.001 });
  });
});
