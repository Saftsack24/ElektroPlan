import { describe, expect, it } from "vitest";

import { geraetEignung, stromkreisAbleiten } from "./stromkreisableitung";
import { stromkreis, VERTEILUNG } from "./testdaten";
import { andereEcke, istKlick, lEcke, wiederholtLetzten } from "./zeichnen";

/** Stromkreis ableiten (Entwurf §7.3) und Eignung als Start/Ziel - rein, ohne Oberfläche. */
const name = (k: { designation: string }) => k.designation;
const UV2 = { ...VERTEILUNG, id: "board-2", code: "UV2", placement_device_id: "uv2" };
const F3 = stromkreis({ device_ids: ["sd-kueche"] });
const F5 = stromkreis({ id: "f5", designation: "F5", device_ids: ["schalter"] });
const F9 = stromkreis({ id: "f9", designation: "F9", board_id: "board-2", device_ids: ["sd-fremd"] });

describe("stromkreisAbleiten", () => {
  it("aus der Zuordnung des Ziels an derselben Verteilung", () => {
    expect(stromkreisAbleiten("uv1", "sd-kueche", [F3, F9], [VERTEILUNG, UV2], name)).toMatchObject({ art: "eindeutig", kreisId: "f3", zuordnen: [] });
  });
  it("Ziel an einer anderen Verteilung: Konflikt, nie umhängen", () => {
    expect(stromkreisAbleiten("uv1", "sd-fremd", [F3, F9], [VERTEILUNG, UV2], name).art).toBe("konflikt");
  });
  it("nicht zugeordnetes Ziel: Wahl an der Verteilung (einziger vorgewählt) und ausdrückliche Zuordnung", () => {
    expect(stromkreisAbleiten("uv1", "neu", [F3, F9], [VERTEILUNG, UV2], name)).toMatchObject({ art: "eindeutig", kreisId: "f3", zuordnen: ["neu"] });
    const zwei = stromkreisAbleiten("uv1", "neu", [F3, F5, F9], [VERTEILUNG, UV2], name);
    expect(zwei.art).toBe("wahl");
    expect(zwei.art === "wahl" ? zwei.kreise.map((k) => k.id) : []).toEqual(["f3", "f5"]);
  });
  it("Gerät zu Gerät: gleicher Stromkreis ja, verschiedene nein", () => {
    expect(stromkreisAbleiten("schalter", "sd-kueche", [F3, F5], [VERTEILUNG], name).art).toBe("konflikt");
    expect(stromkreisAbleiten("schalter", "neu", [F3, F5], [VERTEILUNG], name)).toMatchObject({ art: "eindeutig", kreisId: "f5", zuordnen: ["neu"] });
  });
  it("offen ohne Ziel: Stromkreis aus dem Start", () => {
    expect(stromkreisAbleiten("sd-kueche", null, [F3], [VERTEILUNG], name)).toMatchObject({ art: "eindeutig", kreisId: "f3" });
    expect(stromkreisAbleiten("uv1", null, [F3, F5], [VERTEILUNG], name).art).toBe("wahl");
  });
  it("zwei Verteilungen verbindet keine Leitung", () => {
    expect(stromkreisAbleiten("uv1", "uv2", [F3], [VERTEILUNG, UV2], name).art).toBe("konflikt");
  });
});

describe("geraetEignung", () => {
  const geraete = [
    { id: "uv1", kategorie: "distribution" as const, zuordenbar: false },
    { id: "uv-ohne", kategorie: "distribution" as const, zuordenbar: false },
    { id: "dose", kategorie: "socket" as const, zuordenbar: true },
    { id: "daten", kategorie: "data" as const, zuordenbar: false },
    { id: "aussen", kategorie: "socket" as const, zuordenbar: true },
  ];
  const pruefen = (id: string) => geraetEignung(id, geraete, [VERTEILUNG], (x) => x === "aussen");
  it("Lagegerät einer Verteilung und zuordenbare Geräte: ja", () => {
    expect(pruefen("uv1").ok).toBe(true);
    expect(pruefen("dose").ok).toBe(true);
  });
  it("außen, Datendose, Verteilung ohne Eintrag, unbekannt: nein mit Grund", () => {
    expect(pruefen("aussen")).toEqual({ ok: false, grund: "Außen montierte Geräte werden noch nicht angeschlossen." });
    const grund = (id: string) => {
      const e = pruefen(id);
      return e.ok ? null : e.grund;
    };
    expect(grund("daten")).toMatch(/Datendosen/);
    expect(grund("uv-ohne")).toMatch(/noch nicht angelegt/);
    expect(pruefen("x").ok).toBe(false);
  });
});

describe("Zeichenregeln", () => {
  it("L-Ecke: zuerst waagerecht, sonst senkrecht; auf einer Achse keine Ecke", () => {
    expect(lEcke({ a: 0, b: 0 }, { a: 10, b: 5 }, "waagerecht")).toEqual({ a: 10, b: 0 });
    expect(lEcke({ a: 0, b: 0 }, { a: 10, b: 5 }, "senkrecht")).toEqual({ a: 0, b: 5 });
    expect(lEcke({ a: 0, b: 0 }, { a: 10, b: 0 }, "waagerecht")).toBeNull();
    expect(andereEcke("waagerecht")).toBe("senkrecht");
  });
  it("Klick: unter 4 Bildpunkten Bewegung", () => {
    expect(istKlick({ x: 0, y: 0 }, { x: 3, y: 0 }, 1)).toBe(true);
    expect(istKlick({ x: 0, y: 0 }, { x: 4, y: 0 }, 1)).toBe(false);
    expect(istKlick({ x: 0, y: 0 }, { x: 30, y: 0 }, 0.1)).toBe(true);
  });
  it("Doppelklick wiederholt den letzten Punkt nicht", () => {
    const wp = { art: "wand" as const, wandId: "w", abstandMm: 1, hoeheMm: 2 };
    expect(wiederholtLetzten([wp], { ...wp })).toBe(true);
    expect(wiederholtLetzten([wp], { ...wp, hoeheMm: 3 })).toBe(false);
  });
});
