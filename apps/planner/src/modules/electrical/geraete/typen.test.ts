import { ApiError } from "@elektroplan/api-client";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { masseinheitSetzen, useMasse } from "../../../core/ui/masseinheit";
import type { Geraetetyp } from "./katalog";
import { EIGENE_KATEGORIEN, KATEGORIE_LABEL, KATEGORIEN, istEigenerTyp, istVerwendet, katalogAbfrage } from "./katalog";
import type { Typwerte } from "./typen";
import { alsNeuerTyp, leereTypwerte, typAenderung, typFehlerText, typFeldfehler, typPruefen, typwerteAus, verwendungText } from "./typen";
import { WAEHLBARE_SYMBOLE, symbolFuerKategorie } from "./symbole";
import { ZUORDENBAR } from "../stromkreise/daten";

/**
 * Eigene Gerätetypen (Phase 6c, K2): Formularprüfung, Änderungskörper, Fehlertexte und die
 * Kategorie Geräteanschluss/Festanschluss in allen Kategorielisten. Synthetische Werte.
 */
const HERD: Geraetetyp = {
  key: "c_0123456789abcdef0123456789abcdef",
  origin: "organization",
  label: "Herdanschluss",
  description: null,
  category: "connection",
  symbol_key: "connection_outlet",
  allows_wall_interior: true,
  allows_wall_exterior: false,
  allows_ceiling: false,
  default_center_height_mm: 300,
  width_mm: 80,
  height_mm: 80,
  sort_order: 1000,
  is_active: true,
  version: 3,
  device_count: 2,
  template_count: 1,
};

function masse() {
  return renderHook(() => useMasse()).result.current;
}

function problem(status: number, typ: string, errors: { field: string; code: string; message: string }[] = []) {
  return new ApiError(status, { type: `https://elektroplan.internal/errors/${typ}`, title: "Fehler", status, detail: "technisch", errors }, null);
}

beforeEach(() => {
  act(() => masseinheitSetzen("cm"));
});

describe("Kategorie Geräteanschluss/Festanschluss", () => {
  it("steht in Katalog, Zuordnung und eigenen Kategorien – die Verteilung nie als eigener Typ", () => {
    expect(KATEGORIE_LABEL.connection).toBe("Geräteanschluss/Festanschluss");
    expect(KATEGORIEN).toContain("connection");
    expect(ZUORDENBAR.has("connection")).toBe(true);
    expect(EIGENE_KATEGORIEN).toContain("connection");
    expect(EIGENE_KATEGORIEN).not.toContain("distribution" as never);
    expect(symbolFuerKategorie("connection")).toBe("connection_outlet");
    expect(WAEHLBARE_SYMBOLE).toContain("connection_outlet");
    expect(WAEHLBARE_SYMBOLE).not.toContain("distribution_board");
  });

  it("eigen und verwendet erkennt nur die Daten des Servers", () => {
    expect(istEigenerTyp(HERD)).toBe(true);
    expect(istEigenerTyp({ ...HERD, origin: "system" })).toBe(false);
    expect(istVerwendet(HERD)).toBe(true);
    expect(istVerwendet({ ...HERD, device_count: 0, template_count: 0 })).toBe(false);
    expect(verwendungText(HERD)).toBe("2 Geräte, 1 Kabelvorlagen-Zuordnung");
    expect(verwendungText({ ...HERD, device_count: 1, template_count: 0 })).toBe("1 Gerät");
  });
});

describe("Formular eigener Typ", () => {
  const gueltig = (teile: Partial<Typwerte> = {}): Typwerte => ({
    ...leereTypwerte("wall_interior"),
    name: " Herdanschluss ",
    kategorie: "connection",
    symbol: "connection_outlet",
    breite: "8",
    tiefe: "8",
    hoehe: "30",
    ...teile,
  });

  it("liest Maße in der Anzeigeeinheit und liefert ganze Millimeter", () => {
    const ergebnis = typPruefen(gueltig(), masse());
    expect(ergebnis).toEqual({
      ok: true,
      body: {
        label: "Herdanschluss",
        description: null,
        category: "connection",
        symbol_key: "connection_outlet",
        allows_wall_interior: true,
        allows_wall_exterior: false,
        allows_ceiling: false,
        default_center_height_mm: 300,
        width_mm: 80,
        height_mm: 80,
        sort_order: 1000,
        is_active: true,
      },
    });
  });

  it("meldet fehlende und unzulässige Angaben je Feld – ohne Anfrage", () => {
    const ergebnis = typPruefen(
      { ...leereTypwerte(null), breite: "8,5", tiefe: "120", hoehe: "x", reihenfolge: "-1" },
      masse(),
    );
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(Object.keys(ergebnis.fehler).sort()).toEqual(["breite", "flaechen", "hoehe", "kategorie", "name", "reihenfolge", "symbol", "tiefe"]);
    expect(ergebnis.fehler.breite).toMatch(/geraden Millimetern/);
    expect(ergebnis.fehler.tiefe).toMatch(/zwischen 2 cm und 100 cm/);
  });

  it("Ändern schickt nur Geänderte – gesperrte Felder eines verwendeten Typs bleiben unberührt", () => {
    const werte = { ...typwerteAus(HERD, masse()), name: "Herd (neu)", symbol: "socket_single" };
    const geprueft = typPruefen(werte, masse());
    expect(geprueft.ok).toBe(true);
    if (!geprueft.ok) return;
    expect(typAenderung(HERD, geprueft.body)).toEqual({ label: "Herd (neu)", symbol_key: "socket_single" });
  });

  it("„Als neuen Typ anlegen“ übernimmt die Angaben unter neuem Namen und aktiv", () => {
    const kopie = alsNeuerTyp({ ...typwerteAus(HERD, masse()), aktiv: false });
    expect(kopie.name).toBe("Herdanschluss (Variante)");
    expect(kopie.aktiv).toBe(true);
    expect(kopie.kategorie).toBe("connection");
    expect(alsNeuerTyp({ ...kopie, name: "x".repeat(80) }).name).toHaveLength(80);
  });

  it("Serverfehler: Felder und verständliche Meldungen statt technischer Texte", () => {
    const gesperrt = problem(409, "conflict", [{ field: "width_mm", code: "device-type-in-use", message: "x" }]);
    expect(typFeldfehler(gesperrt)).toEqual({ breite: "Gesperrt, solange der Typ verwendet wird." });
    expect(typFehlerText(gesperrt, "")).toMatch(/Als neuen Typ anlegen/);
    expect(typFehlerText(problem(409, "conflict", [{ field: "allows_ceiling", code: "device-type-surface-in-use", message: "x" }]), "")).toMatch(/Fläche bleibt erhalten/);
    expect(typFehlerText(problem(409, "version-conflict"), "")).toMatch(/Eingaben sind erhalten/);
    expect(typFehlerText(problem(422, "validation-failed", [{ field: "label", code: "device-type-label-taken", message: "x" }]), "")).toMatch(/diesem Namen/);
    expect(typFehlerText(new Error("offline"), "")).toMatch(/nicht erreichbar/);
  });
});

describe("Katalogabfrage", () => {
  it("gibt das Abbruchsignal weiter – kein veralteter Stand nach einem Wechsel", async () => {
    const get = (pfad: string, o: { signal: AbortSignal }) => Promise.resolve([pfad, o.signal]);
    const abfrage = katalogAbfrage({ get } as never);
    const signal = new AbortController().signal;
    await expect(abfrage.queryFn({ signal })).resolves.toEqual(["/api/v1/modules/electrical/device-types", signal]);
  });
});
