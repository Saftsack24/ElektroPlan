import { describe, expect, it } from "vitest";

import { raum } from "../ansicht3d/testplan";
import { leitungsplanAus } from "./daten";
import {
  achseFangen,
  anschlussFangen,
  befundOrt,
  betroffeneOrte,
  kandidatPruefen,
  rechtwinkligeLagen,
  wandFangziele,
  wandpunktAusAnsicht,
  wandpunktInAnsicht,
  wandstrecken,
  zonenlinien,
} from "./flaechen";
import type { Leitung, Wegpunkt } from "./laenge";
import { leitungAuswerten, planVorbereiten } from "./laenge";
import { DIELE, DURCHFUEHRUNG, GESCHOSS, KUECHE, geschossplan } from "./testdaten";

/**
 * Arbeitsflächen Wand und Decke (Phase 6b.4): Umrechnung, Fang, rechtwinklige
 * Führung und die Prüfung eines Kandidaten mit der gemeinsamen Längenfunktion.
 */
const vorbereitet = planVorbereiten(leitungsplanAus({ geschosse: [GESCHOSS], plaene: [geschossplan()], durchfuehrungen: [DURCHFUEHRUNG], steigwege: [] }));

function mitWeg(wegpunkte: Wegpunkt[], endGeraetId: string | null = null): Leitung {
  return { id: "neu", startGeraetId: "uv1", endGeraetId, wegpunkte, startzugabeMm: 0, endzugabeMm: 0, reserveMm: 0, kabeltyp: null, leiterzahl: null, querschnittMm2: null };
}

const wand = (wandId: string, abstandMm: number, hoeheMm: number): Wegpunkt => ({ art: "wand", wandId, abstandMm, hoeheMm });

describe("Wand: Ansicht und gespeicherte Lage", () => {
  // Diele gegen den Uhrzeigersinn: aus dem Raum gesehen liegt das Wandende links.
  const bezug = { anfangLinks: false, laengeMm: 4200, wandId: "diele-w0" };

  it("rechnet verlustfrei in beide Richtungen", () => {
    expect(wandpunktInAnsicht(bezug, 500, 2200)).toEqual({ u: 3700, h: 2200 });
    expect(wandpunktAusAnsicht(bezug, 3700, 2200)).toEqual(wand("diele-w0", 500, 2200));
    expect(wandpunktAusAnsicht(bezug, 3700.4, 2199.6)).toEqual(wand("diele-w0", 500, 2200));
  });

  it("zeichnet die Läufe des Ergebnisses genau dort, wo die Länge sie misst", () => {
    const e = leitungAuswerten(vorbereitet, mitWeg([wand("diele-w0", 500, 2200), wand("diele-w0", 4200, 2200)]));
    expect(wandstrecken(e, bezug)).toEqual([
      { u1: 3700, h1: 1400, u2: 3700, h2: 2200, anschluss: true },
      { u1: 3700, h1: 2200, u2: 0, h2: 2200, anschluss: false },
    ]);
  });
});

describe("Rechtwinklige Führung", () => {
  it("ein Nachbar auf derselben Wand: waagerecht oder senkrecht - der nähere Fall zuerst", () => {
    expect(rechtwinkligeLagen({ u: 1000, h: 2150 }, [{ u: 500, h: 2200 }])[0]).toEqual({ u: null, h: 2200 });
    expect(rechtwinkligeLagen({ u: 520, h: 900 }, [{ u: 500, h: 2200 }])[0]).toEqual({ u: 500, h: null });
  });

  it("zwei Nachbarn: nur Ecken, die mit beiden rechtwinklig verbunden sind", () => {
    const lagen = rechtwinkligeLagen({ u: 900, h: 2100 }, [{ u: 500, h: 2200 }, { u: 1000, h: 1000 }]);
    expect(lagen[0]).toEqual({ u: 1000, h: 2200 });
    expect(lagen).toContainEqual({ u: 500, h: 1000 });
  });

  it("ohne Nachbarn frei", () => {
    expect(rechtwinkligeLagen({ u: 1, h: 2 }, [])).toEqual([{ u: null, h: null }]);
  });
});

describe("Fang", () => {
  const f = { aktiv: true, ausgesetzt: false, massstab: 0.2, rasterMm: 100 };

  it("rastet innerhalb der Bildtoleranz am Ziel ein, sonst am Raster; Alt setzt aus", () => {
    const ziele = wandFangziele({ laengeMm: 4200, hoeheMm: 2500, geraete: [], durchfuehrungen: [], oeffnungen: [], trassen: [], zonen: [] });
    expect(achseFangen(2470, ziele.h, f)).toMatchObject({ wert: 2500, ziel: { text: "Decke (Übergang)" } });
    expect(achseFangen(1234, ziele.h, f)).toMatchObject({ wert: 1200, ziel: { art: "raster" } });
    expect(achseFangen(2470, ziele.h, { ...f, ausgesetzt: true })).toEqual({ wert: 2470, ziel: null });
  });

  it("Anschlusspunkte greifen nur in der Nähe und nie bei ausgeschaltetem Fang", () => {
    const punkte = [{ a: 0, b: 2200, text: "Ecke" }];
    expect(anschlussFangen({ a: 40, b: 2230 }, punkte, f)?.text).toBe("Ecke");
    expect(anschlussFangen({ a: 400, b: 2230 }, punkte, f)).toBeNull();
    expect(anschlussFangen({ a: 40, b: 2230 }, punkte, { ...f, aktiv: false })).toBeNull();
  });

  it("Hilfslinien sind unverbindlich benannt und liegen in der Wand", () => {
    const linien = zonenlinien(4200, 2500, [{ links: 1000, rechts: 1900 }]);
    expect(linien.filter((l) => l.achse === "h").map((l) => l.wert)).toEqual([2200, 1100, 300]);
    expect(linien.filter((l) => l.achse === "u").map((l) => l.wert)).toEqual([200, 800, 2100, 4000]);
  });
});

describe("Kandidat prüfen - dieselbe Funktion wie der Server", () => {
  it("lehnt eine schräge Wandstrecke ab und nennt den Grund", () => {
    const p = kandidatPruefen(vorbereitet, mitWeg([wand("diele-w0", 500, 2200), wand("diele-w0", 1500, 1800)]), 1);
    expect(p).toMatchObject({ ok: false, grund: "Auf der Wand sind nur waagerechte und senkrechte Strecken zulässig." });
  });

  it("akzeptiert waagerecht, senkrecht und die Ecke auf gleicher Höhe", () => {
    expect(kandidatPruefen(vorbereitet, mitWeg([wand("diele-w0", 500, 2200), wand("diele-w0", 4200, 2200)]), 1).ok).toBe(true);
    expect(kandidatPruefen(vorbereitet, mitWeg([wand("diele-w0", 4200, 2200), wand("diele-w1", 0, 2200)]), 1).ok).toBe(true);
    expect(kandidatPruefen(vorbereitet, mitWeg([wand("diele-w0", 4200, 2200), wand("diele-w1", 0, 2000)]), 1).ok).toBe(false);
  });

  it("Wandwechsel ohne gemeinsame Ecke wird abgelehnt - nichts wird still verbunden", () => {
    const p = kandidatPruefen(vorbereitet, mitWeg([wand("diele-w0", 2000, 2200), wand("diele-w2", 2000, 2200)]), 1);
    expect(p.ok).toBe(false);
  });

  it("Wandstrecke durch eine Öffnung wird abgelehnt", () => {
    const mitTuer = raum("diele", "Diele", [[0, 0], [4200, 0], [4200, 3000], [0, 3000]], { oeffnungen: { 0: [{ id: "t1", offset: 1000, breite: 900, hoehe: 2100 }] } });
    const v = planVorbereiten(leitungsplanAus({ geschosse: [GESCHOSS], plaene: [geschossplan([mitTuer, KUECHE])], durchfuehrungen: [], steigwege: [] }));
    const p = kandidatPruefen(v, mitWeg([wand("diele-w0", 500, 1000), wand("diele-w0", 2500, 1000)]), 1);
    expect(p).toMatchObject({ ok: false, grund: "Die Wandstrecke führt durch eine Öffnung." });
  });

  it("Decke: Strecke muss in der echten Kontur bleiben (L-Raum)", () => {
    const l = raum("l", "L-Raum", [[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]], { floorId: "geschoss-1" });
    const v = planVorbereiten(leitungsplanAus({ geschosse: [GESCHOSS], plaene: [geschossplan([l])], durchfuehrungen: [], steigwege: [] }));
    const decke = (x: number, y: number): Wegpunkt => ({ art: "ceiling", raumId: "l", x, y });
    const ohne = (w: Wegpunkt[]) => ({ ...mitWeg(w), startGeraetId: null });
    // Die Diagonale durch die Innenecke (2000, 2000) berührt nur die Kontur - zulässig.
    expect(kandidatPruefen(v, ohne([decke(3000, 1000), decke(1000, 3000)]), 1).ok).toBe(true);
    expect(kandidatPruefen(v, ohne([decke(3500, 1500), decke(1500, 3500)]), 1)).toMatchObject({ ok: false, grund: "Die Strecke verlässt die Raumkontur." });
  });

  it("Übergang Wand – Decke nur an derselben Stelle", () => {
    const decke = (x: number, y: number): Wegpunkt => ({ art: "ceiling", raumId: "diele", x, y });
    expect(kandidatPruefen(vorbereitet, mitWeg([wand("diele-w0", 500, 2500), decke(500, 0)]), 1).ok).toBe(true);
    expect(kandidatPruefen(vorbereitet, mitWeg([wand("diele-w0", 500, 2500), decke(600, 0)]), 1).ok).toBe(false);
  });

  it("betroffene Orte: Punkt, Strecke davor, Strecke danach - nie der Anschluss ans Endgerät", () => {
    expect(betroffeneOrte(0, 1)).toEqual(["w0", "start"]);
    expect(betroffeneOrte(2, 3)).toEqual(["w2", "w1-w2"]);
    expect(betroffeneOrte(1, 3)).toEqual(["w1", "w0-w1", "w1-w2"]);
    expect(befundOrt("w1-w2")).toBe("Strecke 2 – 3");
    expect(befundOrt("w0")).toBe("Wegpunkt 1");
    expect(befundOrt("end")).toBe("Anschluss Endgerät");
  });

  it("die Raumdaten stammen aus dem Plan - Diele ist 2500 mm hoch", () => {
    expect(vorbereitet.raeume.get(DIELE.id)?.hoeheMm).toBe(2500);
  });
});
