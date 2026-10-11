import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Versatzart } from "./verlauf";
import { steigwegAuswerten, steigwegVerlauf, waagerechteLaenge } from "./verlauf";

/**
 * Parität des Steigwegverlaufs zur verbindlichen Serverfunktion (ADR 0025):
 * Dieselbe Datei prüft `apps/backend/tests/test_riser_course.py` gegen
 * `riser_course.py`.
 */
interface Fixture {
  version: number;
  faelle: {
    name: string;
    versatz: Versatzart;
    geschosse: { id: string; ebene: number; hoehe: number; bestaetigt: boolean; decke: number }[];
    halte: { id: string; geschoss: string; x: number; y: number }[];
    erwartet: {
      reihenfolge: string[];
      status: string;
      bekannt: number;
      laenge: number | null;
      abschnitte: {
        von: string;
        bis: string;
        durchquert: string[];
        status: string;
        verlauf: [number, number, number][];
        senkrecht: number | null;
        waagerecht: number;
        laenge: number | null;
        hinweise: string[];
      }[];
    };
  }[];
}

const pfad = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../testdata/geometry/steigweg.v1.json");
const daten = JSON.parse(readFileSync(pfad, "utf-8")) as Fixture;

describe("Steigwegverlauf - Parität zur Serverfunktion", () => {
  it("liest Version 1", () => {
    expect(daten.version).toBe(1);
  });

  it.each(daten.faelle.map((fall) => [fall.name, fall] as const))("%s", (_name, fall) => {
    const ergebnis = steigwegAuswerten(
      fall.geschosse.map((g) => ({
        id: g.id,
        level: g.ebene,
        elevation_mm: g.hoehe,
        elevation_confirmed: g.bestaetigt,
        default_ceiling_height_mm: g.decke,
      })),
      fall.halte.map((h) => ({ schluessel: h.id, floor_id: h.geschoss, x_mm: h.x, y_mm: h.y })),
      fall.versatz,
    );
    const soll = fall.erwartet;
    expect(ergebnis.halte.map((h) => h.schluessel)).toEqual(soll.reihenfolge);
    expect(ergebnis.status).toBe(soll.status);
    expect(ergebnis.bekannt_mm).toBe(soll.bekannt);
    expect(ergebnis.laenge_mm).toBe(soll.laenge);
    expect(ergebnis.abschnitte).toHaveLength(soll.abschnitte.length);
    ergebnis.abschnitte.forEach((abschnitt, i) => {
      const a = soll.abschnitte[i];
      expect(a).toBeDefined();
      if (a === undefined) return;
      expect(abschnitt.unten.schluessel).toBe(a.von);
      expect(abschnitt.oben.schluessel).toBe(a.bis);
      expect(abschnitt.durchquert).toEqual(a.durchquert);
      expect(abschnitt.status).toBe(a.status);
      expect(abschnitt.verlauf.map((p) => [p.x_mm, p.y_mm, p.z_mm])).toEqual(a.verlauf);
      expect(abschnitt.senkrecht_mm).toBe(a.senkrecht);
      expect(abschnitt.waagerecht_mm).toBe(a.waagerecht);
      expect(abschnitt.laenge_mm).toBe(a.laenge);
      expect(abschnitt.hinweise).toEqual(a.hinweise);
      // Länge und Darstellung aus derselben Polylinie.
      expect(waagerechteLaenge(abschnitt.verlauf)).toBe(abschnitt.waagerecht_mm);
    });
  });

  it("zeichnet bei direct keine diagonale 3D-Luftlinie", () => {
    const verlauf = steigwegVerlauf({ x_mm: 0, y_mm: 0 }, { x_mm: 3000, y_mm: 4000 }, 0, 2900, "direct");
    for (let i = 1; i < verlauf.length; i += 1) {
      const a = verlauf[i - 1];
      const b = verlauf[i];
      if (a === undefined || b === undefined) continue;
      const waagerecht = a.x_mm !== b.x_mm || a.y_mm !== b.y_mm;
      expect(waagerecht && a.z_mm !== b.z_mm).toBe(false);
    }
    expect(waagerechteLaenge(verlauf)).toBe(5000);
  });
});
