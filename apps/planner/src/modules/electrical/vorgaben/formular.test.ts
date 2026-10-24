import { describe, expect, it } from "vitest";

import { prozentAnzeigen, prozentLesen } from "./daten";
import { anfrageAus, feldSetzen, formularAus, typSetzen } from "./formular";

/** Formular der Vorgaben (Phase 6c, L3) - 0 ist ein ausdrücklicher Wert, nie „nicht gesetzt“. */
const masse = {
  alsEingabeOptional: (mm: number | null | undefined) => (mm == null ? "" : String(mm / 10).replace(".", ",")),
  lesen: (text: string) => {
    const n = Number(text.replace(",", "."));
    return Number.isFinite(n) && text.trim() !== "" ? { ok: true as const, mm: Math.round(n * 10) } : { ok: false as const, fehler: "Zahl in cm" };
  },
};

const LEER = {
  reserve_percent: null,
  board_allowance_mm: null,
  junction_allowance_mm: null,
  device_allowance_mm: null,
  default_cable_template_id: null,
  device_type_templates: [],
};

describe("Prozent", () => {
  it("liest Komma und Punkt, höchstens zwei Stellen, 0 bis 100", () => {
    expect(prozentLesen("12,5")).toEqual({ ok: true, wert: "12.5" });
    expect(prozentLesen("0")).toEqual({ ok: true, wert: "0" });
    expect(prozentLesen("100")).toEqual({ ok: true, wert: "100" });
    expect(prozentLesen("")).toEqual({ ok: true, wert: null });
    expect(prozentLesen("12,345").ok).toBe(false);
    expect(prozentLesen("101").ok).toBe(false);
    expect(prozentLesen("-1").ok).toBe(false);
  });
  it("zeigt ohne überflüssige Nullen", () => {
    expect(prozentAnzeigen("20.00")).toBe("20 %");
    expect(prozentAnzeigen("12.50")).toBe("12,5 %");
    expect(prozentAnzeigen(null)).toBe("–");
  });
});

describe("Vorgabenformular", () => {
  it("NULL bleibt nicht gesetzt, 0 bleibt ausdrücklich 0 - in beide Richtungen", () => {
    const form = formularAus({ ...LEER, reserve_percent: "0.00", device_allowance_mm: 0 }, masse);
    expect(form.felder.reserve).toEqual({ eigen: true, text: "0" });
    expect(form.felder.device).toEqual({ eigen: true, text: "0" });
    expect(form.felder.board).toEqual({ eigen: false, text: "" });
    const a = anfrageAus(form, 3, masse);
    expect(a.ok && a.anfrage).toMatchObject({ expected_version: 3, reserve_percent: "0", device_allowance_mm: 0, board_allowance_mm: null });
  });

  it("eigener Wert ohne Eingabe ist ein Fehler - nicht still „nicht gesetzt“", () => {
    const form = feldSetzen(formularAus(LEER, masse), "board", { eigen: true, text: "" });
    const a = anfrageAus(form, 0, masse);
    expect(a.ok).toBe(false);
    expect(!a.ok && a.fehler.board).toMatch(/0 ist ein gültiger Wert/);
  });

  it("Vorlage je Gerätetyp setzen und entfernen; Reihenfolge stabil", () => {
    let form = typSetzen(formularAus(LEER, masse), "switch", "v2");
    form = typSetzen(form, "socket_single", "v1");
    const a = anfrageAus(form, 1, masse);
    expect(a.ok && a.anfrage.device_type_templates).toEqual([
      { device_type_key: "socket_single", cable_template_id: "v1" },
      { device_type_key: "switch", cable_template_id: "v2" },
    ]);
    form = typSetzen(form, "switch", null);
    const b = anfrageAus(form, 1, masse);
    expect(b.ok && b.anfrage.device_type_templates).toEqual([{ device_type_key: "socket_single", cable_template_id: "v1" }]);
  });
});
