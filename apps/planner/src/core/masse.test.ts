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
    expect(mmAusEingabe("11,55", "cm")).toEqual({ ok: false, fehler: FEHLER_GENAUIGKEIT.cm });
    expect(mmAusEingabe("0,05", "cm")).toEqual({ ok: false, fehler: FEHLER_GENAUIGKEIT.cm });
  });

  it("rät bei einem Tausenderpunkt nicht", () => {
    expect(mmAusEingabe("1.250", "cm")).toEqual({ ok: false, fehler: FEHLER_TAUSENDER });
  });

  it.each(["", "abc", "1,2,3", "12 km", "--3", "1e3", ".", "cm", "1,5 mm", "1.250,5"])("lehnt %j ab", (text) => {
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

describe("Meter (Phase 4e)", () => {
  it.each([
    [1250, "1,250 m"],
    [1, "0,001 m"],
    [0, "0,000 m"],
    [2500, "2,500 m"],
    [-125, "-0,125 m"],
    [125_000, "125,000 m"],
    [12_345_678, "12.345,678 m"],
  ])("%i mm in Metern: %s", (mm, text) => {
    expect(mmAnzeigen(mm, "m")).toBe(text);
  });

  it("zeigt 1250 mm in allen drei Einheiten", () => {
    expect(mmAnzeigen(1250, "mm")).toBe("1.250 mm");
    expect(mmAnzeigen(1250, "cm")).toBe("125 cm");
    expect(mmAnzeigen(1250, "m")).toBe("1,250 m");
  });

  it.each([
    ["1,25", 1250],
    ["1.25", 1250],
    ["1,250", 1250],
    ["1.250", 1250],
    ["0,001", 1],
    [",5", 500],
    ["2", 2000],
    ["-0,4", -400],
    [" 1, 25 ", 1250],
    ["1,2500", 1250],
  ])("Meter %j → %i mm", (text, mm) => {
    expect(mmAusEingabe(text, "m")).toEqual({ ok: true, mm });
  });

  it("lehnt mehr als drei Nachkommastellen ab", () => {
    expect(mmAusEingabe("1,2505", "m")).toEqual({ ok: false, fehler: FEHLER_GENAUIGKEIT.m });
    expect(mmAusEingabe("0,0001", "m")).toEqual({ ok: false, fehler: FEHLER_GENAUIGKEIT.m });
  });

  it("rechnet Millimeter → Meter → Millimeter exakt hin und zurück", () => {
    for (let mm = -3000; mm <= 3000; mm += 1) {
      expect(mmAusEingabe(mmAlsEingabe(mm, "m"), "m")).toEqual({ ok: true, mm });
      expect(mmAusEingabe(mmAlsEingabe(mm, "m").replace(",", "."), "m")).toEqual({ ok: true, mm });
    }
    // typische Fließkommafallen
    expect(mmAusEingabe("0,3", "m")).toEqual({ ok: true, mm: 300 });
    expect(mmAusEingabe("1,005", "m")).toEqual({ ok: true, mm: 1005 });
    expect(mmAusEingabe("4,35", "m")).toEqual({ ok: true, mm: 4350 });
  });

  it("Eingabetexte in Metern haben drei Stellen und keinen Tausenderpunkt", () => {
    expect(mmAlsEingabe(1250, "m")).toBe("1,250");
    expect(mmAlsEingabe(125_005, "m")).toBe("125,005");
    expect(mmAlsEingabeOptional(null, "m")).toBe("");
  });

  it("rechnet offene Eingaben zwischen allen drei Einheiten um", () => {
    expect(eingabeUmrechnen("125", "cm", "m")).toBe("1,250");
    expect(eingabeUmrechnen("1,25", "m", "cm")).toBe("125");
    expect(eingabeUmrechnen("1,251", "m", "mm")).toBe("1251");
    expect(eingabeUmrechnen("1251", "mm", "m")).toBe("1,251");
  });
});

describe("Einheitenzeichen in der Eingabe (Phase 4e)", () => {
  it.each([
    ["125 cm", "m", 1250],
    ["1,25 m", "cm", 1250],
    ["1.25m", "mm", 1250],
    ["1250 mm", "m", 1250],
    ["1250MM", "cm", 1250],
    ["11,5cm", "cm", 115],
  ] as const)("%j in %s → %i mm", (text, einheit, mm) => {
    expect(mmAusEingabe(text, einheit)).toEqual({ ok: true, mm });
  });

  it("prüft die Genauigkeit in der angegebenen Einheit", () => {
    expect(mmAusEingabe("11,55 cm", "m")).toEqual({ ok: false, fehler: FEHLER_GENAUIGKEIT.cm });
    expect(mmAusEingabe("1,2505 m", "cm")).toEqual({ ok: false, fehler: FEHLER_GENAUIGKEIT.m });
  });
});
