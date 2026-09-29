import { describe, expect, it } from "vitest";

import {
  FEHLER_GENAUIGKEIT,
  FEHLER_TAUSENDER,
  eingabeUmrechnen,
  eingabenAusMm,
  eingabenLesen,
  mitEinheit,
  mmAlsEingabe,
  mmAlsEingabeOptional,
  mmAnzeigen,
  mmAnzeigenOptional,
  mmAusEingabe,
  mmAusEingabeOptional,
  punktAnzeigen,
} from "./masse";

describe("Maße anzeigen", () => {
  it.each([
    [115, "11,5 cm"],
    [2500, "250 cm"],
    [0, "0 cm"],
    [-125, "-12,5 cm"],
    [-5, "-0,5 cm"],
    [1, "0,1 cm"],
    [125_000, "12.500 cm"],
  ])("%i mm in Zentimetern: %s", (mm, text) => {
    expect(mmAnzeigen(mm, "cm")).toBe(text);
  });

  it.each([
    [115, "115 mm"],
    [2500, "2.500 mm"],
    [-40, "-40 mm"],
  ])("%i mm in Millimetern: %s", (mm, text) => {
    expect(mmAnzeigen(mm, "mm")).toBe(text);
  });

  it("zeigt keine unnötigen Nachkommastellen", () => {
    expect(mmAnzeigen(2500, "cm")).not.toContain(",");
    expect(mmAlsEingabe(2500, "cm")).toBe("250");
  });

  it("optionale Maße: null ist ein Gedankenstrich bzw. ein leeres Feld", () => {
    expect(mmAnzeigenOptional(null, "cm")).toBe("—");
    expect(mmAlsEingabeOptional(null, "cm")).toBe("");
    expect(mmAlsEingabeOptional(undefined, "mm")).toBe("");
  });

  it("Eingabetexte haben weder Einheit noch Tausenderpunkt", () => {
    expect(mmAlsEingabe(125_005, "cm")).toBe("12500,5");
    expect(mmAlsEingabe(125_005, "mm")).toBe("125005");
  });

  it("Beschriftung und Koordinatenpaar", () => {
    expect(mitEinheit("Breite", "cm")).toBe("Breite (cm)");
    expect(punktAnzeigen(300, -425, "cm")).toBe("30 / -42,5 cm");
  });
});

describe("Maße einlesen", () => {
  it.each([
    ["11,5", 115],
    ["11.5", 115],
    ["250", 2500],
    ["-12,5", -125],
    [",5", 5],
    ["11,50", 115],
    [" 3 ", 30],
    ["+7", 70],
    ["-0", 0],
  ])("Zentimeter %j → %i mm", (text, mm) => {
    expect(mmAusEingabe(text, "cm")).toEqual({ ok: true, mm });
  });

  it("rechnet ohne Fließkommafehler exakt um", () => {
    for (let mm = -2000; mm <= 2000; mm += 1) {
      expect(mmAusEingabe(mmAlsEingabe(mm, "cm"), "cm")).toEqual({ ok: true, mm });
    }
    expect(mmAusEingabe("0,3", "cm")).toEqual({ ok: true, mm: 3 });
    expect(mmAusEingabe("1,1", "cm")).toEqual({ ok: true, mm: 11 });
  });

  it("lehnt mehr als eine Nachkommastelle verständlich ab", () => {
    expect(mmAusEingabe("11,55", "cm")).toEqual({ ok: false, fehler: FEHLER_GENAUIGKEIT });
    expect(mmAusEingabe("0,05", "cm")).toEqual({ ok: false, fehler: FEHLER_GENAUIGKEIT });
  });

  it("rät bei einem Tausenderpunkt nicht", () => {
    expect(mmAusEingabe("1.250", "cm")).toEqual({ ok: false, fehler: FEHLER_TAUSENDER });
  });

  it.each(["", "abc", "1,2,3", "12 cm", "--3", "1e3", "."])("lehnt %j ab", (text) => {
    expect(mmAusEingabe(text, "cm").ok).toBe(false);
  });

  it("Millimeter: nur ganze Zahlen", () => {
    expect(mmAusEingabe("115", "mm")).toEqual({ ok: true, mm: 115 });
    expect(mmAusEingabe("-40", "mm")).toEqual({ ok: true, mm: -40 });
    expect(mmAusEingabe("11,5", "mm").ok).toBe(false);
    expect(mmAusEingabe("11.5", "mm").ok).toBe(false);
  });

  it("optionale Felder bleiben leer", () => {
    expect(mmAusEingabeOptional("", "cm")).toEqual({ ok: true, mm: null });
    expect(mmAusEingabeOptional("  ", "mm")).toEqual({ ok: true, mm: null });
    expect(mmAusEingabeOptional("25", "cm")).toEqual({ ok: true, mm: 250 });
  });

  it("rechnet einen offenen Eingabetext beim Einheitenwechsel um", () => {
    expect(eingabeUmrechnen("11,5", "cm", "mm")).toBe("115");
    expect(eingabeUmrechnen("115", "mm", "cm")).toBe("11,5");
    expect(eingabeUmrechnen("", "cm", "mm")).toBe("");
    expect(eingabeUmrechnen("Unsinn", "cm", "mm")).toBe("Unsinn");
  });

  it("verarbeitet Feldgruppen", () => {
    const werte = { name: "Tür", breite_mm: "885", hoehe_mm: "" };
    expect(eingabenAusMm(werte, ["breite_mm", "hoehe_mm"], "cm")).toEqual({
      name: "Tür",
      breite_mm: "88,5",
      hoehe_mm: "",
    });
    expect(eingabenLesen({ a: "88,5", b: "x" }, ["a", "b"], "cm")).toEqual({
      mm: { a: 885 },
      fehler: { b: "Bitte eine Zahl in Zentimetern angeben, z. B. 11,5." },
    });
  });
});
