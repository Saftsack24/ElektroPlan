import { describe, expect, it } from "vitest";

import {
  anfrage,
  ausServer,
  fehlendeLagen,
  geschossAnbinden,
  geschossLoesen,
  gesetzteHalte,
  haltSetzen,
  istGeaendert,
  koordinateSetzen,
  neuerEntwurf,
} from "./entwurf";
import { LEERE_FLAECHE, geschossansicht, sichtrahmen, zeigerZuWelt } from "./flaeche";
import { steigwegAuswerten } from "./verlauf";

const SERVER = {
  id: "s1",
  building_id: "haus",
  name: "Schacht",
  note: null,
  offset_mode: "orthogonal" as const,
  stops: [
    { id: "h-eg", floor_id: "eg", x_mm: 0, y_mm: 0 },
    { id: "h-og", floor_id: "og", x_mm: 100, y_mm: 0 },
  ],
  sections: [],
  status: "confirmed" as const,
  known_length_mm: 0,
  length_mm: 0,
  version: 2,
  created_at: "",
  updated_at: "",
};

describe("Steigwegentwurf", () => {
  it("behält beim Verschieben die ID und erkennt Änderungen", () => {
    const basis = ausServer(SERVER);
    expect(istGeaendert(basis, basis)).toBe(false);
    const verschoben = haltSetzen(basis, "og", 300, 50);
    expect(istGeaendert(verschoben, basis)).toBe(true);
    expect(anfrage(verschoben).stops).toEqual([
      { id: "h-eg", floor_id: "eg", x_mm: 0, y_mm: 0 },
      { id: "h-og", floor_id: "og", x_mm: 300, y_mm: 50 },
    ]);
    // Zurückschieben ist wieder der gespeicherte Stand.
    expect(istGeaendert(haltSetzen(verschoben, "og", 100, 0), basis)).toBe(false);
  });

  it("erfindet beim Anbinden keine Lage", () => {
    const entwurf = geschossAnbinden(ausServer(SERVER), "kg");
    expect(fehlendeLagen(entwurf)).toEqual(["kg"]);
    expect(gesetzteHalte(entwurf).map((h) => h.floor_id)).toEqual(["eg", "og"]);
    const nurX = koordinateSetzen(entwurf, "kg", "x_mm", 500);
    expect(fehlendeLagen(nurX)).toEqual(["kg"]);
    const gesetzt = koordinateSetzen(nurX, "kg", "y_mm", 0);
    expect(fehlendeLagen(gesetzt)).toEqual([]);
    expect(anfrage(gesetzt).stops?.[2]).toEqual({ floor_id: "kg", x_mm: 500, y_mm: 0 });
    expect(() => anfrage(entwurf)).toThrow();
  });

  it("löst ein Geschoss und trimmt Name und Notiz", () => {
    const entwurf = { ...geschossLoesen(ausServer(SERVER), "og"), name: "  Schacht A ", note: "   " };
    expect(anfrage(entwurf)).toEqual({
      name: "Schacht A",
      note: null,
      offset_mode: "orthogonal",
      stops: [{ id: "h-eg", floor_id: "eg", x_mm: 0, y_mm: 0 }],
    });
    expect(istGeaendert(neuerEntwurf(), neuerEntwurf())).toBe(false);
  });
});

describe("Steigweg im Grundriss", () => {
  const geschosse = [
    { id: "kg", level: -1, elevation_mm: -2800, elevation_confirmed: true, default_ceiling_height_mm: 2500 },
    { id: "eg", level: 0, elevation_mm: 0, elevation_confirmed: true, default_ceiling_height_mm: 2500 },
    { id: "og", level: 1, elevation_mm: 2900, elevation_confirmed: false, default_ceiling_height_mm: 2500 },
  ];
  const auswertung = steigwegAuswerten(
    geschosse,
    [
      { schluessel: "a", floor_id: "kg", x_mm: 1200, y_mm: 3400 },
      { schluessel: "b", floor_id: "og", x_mm: 1650, y_mm: 3700 },
    ],
    "orthogonal",
  );

  it("zeigt je Geschoss Halt, Versatz und Durchstoßpunkt", () => {
    const kg = geschossansicht(auswertung, "kg");
    expect(kg.halt?.schluessel).toBe("a");
    expect(kg.nachOben).toBe("elevation-unconfirmed");
    const eg = geschossansicht(auswertung, "eg");
    expect(eg.halt).toBeNull();
    expect(eg.durchquert).toEqual([{ x_mm: 1200, y_mm: 3400, status: "elevation-unconfirmed" }]);
    const og = geschossansicht(auswertung, "og");
    expect(og.versatz).toEqual([
      {
        punkte: [
          { x_mm: 1200, y_mm: 3400 },
          { x_mm: 1650, y_mm: 3400 },
          { x_mm: 1650, y_mm: 3700 },
        ],
        status: "elevation-unconfirmed",
      },
    ]);
  });

  it("rechnet Zeigerpositionen in ganze Millimeter um", () => {
    expect(sichtrahmen([])).toEqual(LEERE_FLAECHE);
    const rahmen = sichtrahmen([{ x_mm: 0, y_mm: 0 }]);
    expect((rahmen.maxX - rahmen.minX) / (rahmen.maxY - rahmen.minY)).toBeCloseTo(4 / 3);
    const flaeche = { left: 0, top: 0, width: 800, height: 600 };
    expect(zeigerZuWelt(flaeche, LEERE_FLAECHE, 400, 300)).toEqual({ x_mm: 5000, y_mm: 3750 });
    expect(zeigerZuWelt(flaeche, LEERE_FLAECHE, 0, 600)).toEqual({ x_mm: 0, y_mm: 0 });
    // Breitere Fläche: oben/unten bündig, links und rechts Rand (meet).
    expect(zeigerZuWelt({ left: 0, top: 0, width: 1000, height: 600 }, LEERE_FLAECHE, 100, 600)).toEqual({
      x_mm: 0,
      y_mm: 0,
    });
    expect(zeigerZuWelt({ left: 0, top: 0, width: 0, height: 0 }, LEERE_FLAECHE, 1, 1)).toBeNull();
  });
});
