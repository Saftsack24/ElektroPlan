import { describe, expect, it } from "vitest";

import { rechteck } from "../ansicht3d/testplan";
import type { EntwurfWand } from "../editor/entwurf";
import { basisAus } from "../editor/entwurf";
import { mmAnzeigen, mmAusEingabe } from "../../../core/masse";
import type { Masseinheit } from "../../../core/masse";
import { konturUmkehren } from "../editor/werkzeuge";
import { ausAnsicht, inAnsicht, punktInAnsicht, rechteckAusAnsicht, rechteckInAnsicht, umlaufsinn, wandbezug } from "./wandbezug";
import type { Wandbezug } from "./wandbezug";

/**
 * Blickrichtung und Maßbezug der Wandansicht (ADR 0022).
 *
 * Wohnzimmer 5 × 4 m gegen den Uhrzeigersinn: Wand 1 Süd (0,0)→(5000,0),
 * Wand 2 Ost (5000,0)→(5000,4000), Wand 3 Nord, Wand 4 West.
 */
const WOHNZIMMER = basisAus(rechteck("raum-1", "Wohnzimmer", [0, 0], [5000, 4000])).entwurf;

function bezug(walls: readonly EntwurfWand[], wandId: string): Wandbezug {
  const e = wandbezug("raum-1", walls, wandId, 2500);
  if (!e.ok) throw new Error(e.grund);
  return e.bezug;
}

describe("Blickrichtung aus dem Raum", () => {
  it("gegen den Uhrzeigersinn: Blick auf die Südwand nach unten, Wandende (Ost) links", () => {
    const b = bezug(WOHNZIMMER.walls, "raum-1-w0");
    expect(umlaufsinn(WOHNZIMMER.walls)).toBe("gegen-uhrzeigersinn");
    expect(b.anfangLinks).toBe(false);
    expect(b.blick).toBe("nach unten");
    expect(b.laengeMm).toBe(5000);
    expect(b.wandNummer).toBe(1);
    // Wer nach Süden blickt, hat Osten links: Dort schließt Wand 2 an.
    expect(b.nachbarLinks).toBe(2);
    expect(b.nachbarRechts).toBe(4);
  });

  it("umgekehrte Kontur: dasselbe Bild, obwohl die Wand anders herum gespeichert ist", () => {
    const umgekehrt = konturUmkehren({
      ...WOHNZIMMER,
      walls: WOHNZIMMER.walls.map((w) =>
        w.id === "raum-1-w0"
          ? { ...w, openings: [{ id: "t", kind: "door" as const, offset_mm: 1000, width_mm: 885, height_mm: 2010, sill_height_mm: 0 }] }
          : w,
      ),
    });
    const vorher = bezug(
      WOHNZIMMER.walls.map((w) =>
        w.id === "raum-1-w0"
          ? { ...w, openings: [{ id: "t", kind: "door" as const, offset_mm: 1000, width_mm: 885, height_mm: 2010, sill_height_mm: 0 }] }
          : w,
      ),
      "raum-1-w0",
    );
    const nachher = bezug(umgekehrt.walls, "raum-1-w0");
    expect(umlaufsinn(umgekehrt.walls)).toBe("im-uhrzeigersinn");
    expect(nachher.anfangLinks).toBe(true);
    expect(nachher.blick).toBe(vorher.blick);
    const wandVorher = { offset_mm: 1000, width_mm: 885 };
    const wandNachher = umgekehrt.walls.find((w) => w.id === "raum-1-w0")?.openings[0];
    // Gespeichert unterschiedlich (1000 bzw. 3115), angezeigt identisch.
    expect(wandNachher?.offset_mm).toBe(3115);
    expect(inAnsicht(vorher, wandVorher.offset_mm, wandVorher.width_mm)).toEqual(
      inAnsicht(nachher, wandNachher?.offset_mm ?? 0, 885),
    );
    expect(inAnsicht(vorher, 1000, 885)).toEqual({ links: 3115, rechts: 4000 });
  });

  it("offene Kontur: keine Wandansicht, verständlicher Grund", () => {
    const offen = WOHNZIMMER.walls.slice(0, 3);
    const e = wandbezug("raum-1", offen, "raum-1-w0", 2500);
    expect(e.ok).toBe(false);
    expect(!e.ok && e.grund).toMatch(/nicht geschlossen/);
  });

  it("unbekannte Wand (etwa nach Rückgängig): verständlicher Grund statt Absturz", () => {
    const e = wandbezug("raum-1", WOHNZIMMER.walls, "gibt-es-nicht", 2500);
    expect(!e.ok && e.grund).toMatch(/nicht \(mehr\)/);
  });
});

describe("Transformation gespeichert ↔ Ansicht", () => {
  it("ist ganzzahlig und ihre eigene Umkehrung - für beide Richtungen und jede Lage", () => {
    for (const anfangLinks of [true, false]) {
      const b = { anfangLinks, laengeMm: 4321 };
      for (const offset of [0, 1, 999, 2000, 4321 - 885]) {
        const a = inAnsicht(b, offset, 885);
        expect(Number.isInteger(a.links)).toBe(true);
        expect(ausAnsicht(b, a.links, 885)).toBe(offset);
        expect(a.rechts - a.links).toBe(885);
      }
      expect(punktInAnsicht(b, punktInAnsicht(b, 1234))).toBe(1234);
    }
  });

  it("Rechteck samt Brüstung und Oberkante", () => {
    const b = { anfangLinks: false, laengeMm: 5000 };
    const fenster = { offset_mm: 500, width_mm: 1010, height_mm: 1260, sill_height_mm: 900 };
    const r = rechteckInAnsicht(b, fenster);
    expect(r).toEqual({ links: 3490, rechts: 4500, unten: 900, oben: 2160 });
    expect(rechteckAusAnsicht(b, r)).toEqual(fenster);
  });

  it("Rundreise über die Anzeige in mm, cm und m bleibt exakt", () => {
    const b = { anfangLinks: false, laengeMm: 5000 };
    for (const einheit of ["mm", "cm", "m"] as Masseinheit[]) {
      for (const links of [0, 1, 115, 1234, 4115]) {
        const text = mmAnzeigen(links, einheit).replace(/ (mm|cm|m)$/, "").replace(/\./g, "");
        const gelesen = mmAusEingabe(text, einheit);
        expect(gelesen).toEqual({ ok: true, mm: links });
        expect(ausAnsicht(b, gelesen.ok ? gelesen.mm : -1, 885) + 885 + links).toBe(5000);
      }
    }
  });
});
