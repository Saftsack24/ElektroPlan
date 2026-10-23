import { describe, expect, it } from "vitest";

import type { Leitungsentwurf, Leitungswerte } from "./entwurf";
import {
  entwurfAus,
  gleicheWerte,
  leiterzahlLesen,
  leitungUngespeichert,
  leitungsReducer,
  querschnittNormal,
  vorschlagVergleichen,
  durchfuehrungDaneben,
  wegpunktEinfuegen,
  wegpunktEntfernen,
  wegpunktErsetzen,
} from "./entwurf";
import type { Wegpunkt } from "./laenge";

/** Leitungsentwurf (Phase 6b.4): Historie, Ziehen, Speichern, Kabelangaben. */
const BODEN: Wegpunkt = { art: "floor", raumId: "r1", x: 100, y: 200 };
const STEIG: Wegpunkt = { art: "steigweg", steigwegId: "s1", vonHalt: "h1", vonHoeheMm: 0, nachHalt: "h2", nachHoeheMm: 0 };

function werte(wegpunkte: readonly Wegpunkt[] = []): Leitungswerte {
  return {
    circuitId: "f3",
    label: "L1",
    startId: "uv1",
    endId: null,
    kabeltyp: "NYM-J",
    leiterzahl: "3",
    querschnitt: "1,5",
    startzugabeMm: 0,
    endzugabeMm: 0,
    reserveMm: 0,
    reserveProzent: null,
    wegpunkte,
    neueDurchfuehrungen: [],
  };
}

const wand = (abstandMm: number, hoeheMm = 2200): Wegpunkt => ({ art: "wand", wandId: "w1", abstandMm, hoeheMm });

function mit(e: Leitungsentwurf, ...aktionen: Parameters<typeof leitungsReducer>[1][]): Leitungsentwurf {
  return aktionen.reduce<Leitungsentwurf>((z, a) => leitungsReducer(z, a) as Leitungsentwurf, e);
}

describe("Historie", () => {
  it("jede Änderung ein Schritt; Rückgängig und Wiederholen stellen genau her", () => {
    const e0 = entwurfAus("l1", 4, werte());
    const a = wegpunktEinfuegen(e0.werte, wand(500), null).werte;
    const b = wegpunktEinfuegen(a, wand(4200), null).werte;
    const e = mit(e0, { typ: "aendern", werte: a }, { typ: "aendern", werte: b });
    expect(e.zurueck).toHaveLength(2);
    const zurueck = mit(e, { typ: "rueckgaengig" });
    expect(zurueck.werte).toEqual(a);
    expect(mit(zurueck, { typ: "wiederholen" }).werte).toEqual(b);
    expect(mit(zurueck, { typ: "rueckgaengig" }).werte).toEqual(e0.werte);
  });

  it("gleiche Werte erzeugen keinen Schritt", () => {
    const e0 = entwurfAus("l1", 4, werte());
    expect(mit(e0, { typ: "aendern", werte: { ...e0.werte } }).zurueck).toHaveLength(0);
  });

  it("eine Ziehbewegung ist genau ein Schritt - beliebig viele Vorschauen dazwischen", () => {
    const e0 = entwurfAus("l1", 4, werte([wand(500)]));
    const e = mit(
      e0,
      { typ: "ziehen-beginnen" },
      { typ: "ziehen-vorschau", werte: wegpunktErsetzen(e0.werte, 0, wand(600)) },
      { typ: "ziehen-vorschau", werte: wegpunktErsetzen(e0.werte, 0, wand(700)) },
      { typ: "ziehen-vorschau", werte: wegpunktErsetzen(e0.werte, 0, wand(800)) },
      { typ: "ziehen-beenden" },
    );
    expect(e.zurueck).toHaveLength(1);
    expect(e.werte.wegpunkte[0]).toEqual(wand(800));
    expect(mit(e, { typ: "rueckgaengig" }).werte.wegpunkte[0]).toEqual(wand(500));
  });

  it("abgebrochenes Ziehen stellt den Stand vor der Bewegung her, ohne Historie", () => {
    const e0 = entwurfAus("l1", 4, werte([wand(500)]));
    const e = mit(e0, { typ: "ziehen-beginnen" }, { typ: "ziehen-vorschau", werte: wegpunktErsetzen(e0.werte, 0, wand(900)) }, { typ: "ziehen-abbrechen" });
    expect(e.werte).toEqual(e0.werte);
    expect(e.zurueck).toHaveLength(0);
    expect(e.ziehenAb).toBeNull();
  });

  it("Ziehen ohne Änderung: kein Schritt; Rückgängig während des Ziehens wirkt nicht", () => {
    const e0 = entwurfAus("l1", 4, werte([wand(500)]));
    expect(mit(e0, { typ: "ziehen-beginnen" }, { typ: "ziehen-beenden" }).zurueck).toHaveLength(0);
    const waehrend = mit(e0, { typ: "aendern", werte: werte([wand(600)]) }, { typ: "ziehen-beginnen" }, { typ: "rueckgaengig" });
    expect(waehrend.werte.wegpunkte[0]).toEqual(wand(600));
  });

  it("Auswahl ist keine Änderung und wird nach Rückgängig auf gültige Indizes begrenzt", () => {
    const e0 = entwurfAus("l1", 4, werte([wand(500)]));
    const e = mit(e0, { typ: "aendern", werte: werte([wand(500), wand(900)]), auswahl: 1 });
    expect(e.auswahl).toBe(1);
    expect(mit(e, { typ: "rueckgaengig" }).auswahl).toBeNull();
    expect(mit(e0, { typ: "auswaehlen", auswahl: 0 }).zurueck).toHaveLength(0);
  });
});

describe("Speichern und Konflikt", () => {
  it("ein gescheitertes Speichern behält den Entwurf vollständig", () => {
    const e0 = entwurfAus("l1", 4, werte());
    const geaendert = mit(e0, { typ: "aendern", werte: werte([wand(500)]) }, { typ: "speichern-beginnt" });
    const e = mit(geaendert, { typ: "gescheitert", status: "konflikt", fehler: { meldung: "x", eintraege: [] } });
    expect(e.werte).toEqual(werte([wand(500)]));
    expect(e.version).toBe(4);
    expect(e.status).toBe("konflikt");
    expect(leitungUngespeichert(e)).toBe(true);
  });

  it("gespeichert: Serverantwort wird neue Basis, Historie beginnt neu", () => {
    const e = mit(entwurfAus(null, null, werte()), { typ: "aendern", werte: werte([wand(500)]) }, { typ: "gespeichert", cableId: "l9", version: 1, werte: werte([wand(500)]) });
    expect(e.cableId).toBe("l9");
    expect(e.zurueck).toHaveLength(0);
    expect(leitungUngespeichert(e)).toBe(false);
  });

  it("eine neue Leitung ist immer ungespeichert; Verwerfen führt zur Basis zurück", () => {
    expect(leitungUngespeichert(entwurfAus(null, null, werte()))).toBe(true);
    const e = mit(entwurfAus("l1", 2, werte()), { typ: "aendern", werte: werte([wand(1)]) }, { typ: "verwerfen" });
    expect(leitungUngespeichert(e)).toBe(false);
    expect(leitungsReducer(e, { typ: "schliessen" })).toBeNull();
  });
});

describe("Wegpunkte", () => {
  it("neue Punkte folgen dem gewählten, sonst ans Ende", () => {
    const w = werte([wand(1), wand(2)]);
    expect(wegpunktEinfuegen(w, wand(3), null)).toEqual({ werte: werte([wand(1), wand(2), wand(3)]), index: 2 });
    expect(wegpunktEinfuegen(w, wand(3), 0)).toEqual({ werte: werte([wand(1), wand(3), wand(2)]), index: 1 });
  });

  it("andere Wegpunktarten bleiben beim Bearbeiten unverändert erhalten", () => {
    const w = werte([BODEN, wand(1), STEIG]);
    const neu = wegpunktErsetzen(wegpunktEinfuegen(w, wand(5), 1).werte, 1, wand(2));
    expect(neu.wegpunkte[0]).toEqual(BODEN);
    expect(neu.wegpunkte[3]).toEqual(STEIG);
    expect(wegpunktEntfernen(neu, 2).wegpunkte).toEqual([BODEN, wand(2), STEIG]);
    expect(gleicheWerte(w, werte([BODEN, wand(1), STEIG]))).toBe(true);
  });
});

describe("Durchführung nicht doppelt", () => {
  it("erkennt dieselbe Durchführung direkt davor oder an der Einfügestelle", () => {
    const d: Wegpunkt = { art: "durchfuehrung", durchfuehrungId: "d1" };
    const w = werte([wand(1), d]);
    expect(durchfuehrungDaneben(w, 2, "d1")).toBe(1);
    expect(durchfuehrungDaneben(w, 1, "d1")).toBe(1);
    expect(durchfuehrungDaneben(w, 2, "d2")).toBeNull();
    expect(durchfuehrungDaneben(werte([d, wand(1)]), 2, "d1")).toBeNull();
  });
});

describe("Kabelangaben", () => {
  const kreis = { proposed_cable_type: "NYM-J", proposed_conductor_count: 3, proposed_cross_section_mm2: "1.50" };

  it("vergleicht mit dem aktuellen Vorschlag - Komma und Nachkommanullen gleichwertig", () => {
    expect(vorschlagVergleichen({ kabeltyp: "NYM-J", leiterzahl: "3", querschnitt: "1,5" }, kreis)).toEqual({
      kabeltyp: "wie-vorschlag",
      leiterzahl: "wie-vorschlag",
      querschnitt: "wie-vorschlag",
    });
    expect(vorschlagVergleichen({ kabeltyp: "NYM-J", leiterzahl: "5", querschnitt: "2,5" }, kreis)).toMatchObject({ leiterzahl: "abweichend", querschnitt: "abweichend" });
    expect(vorschlagVergleichen({ kabeltyp: "", leiterzahl: "", querschnitt: "" }, { proposed_cable_type: null, proposed_conductor_count: null, proposed_cross_section_mm2: null })).toEqual({
      kabeltyp: "kein-vorschlag",
      leiterzahl: "kein-vorschlag",
      querschnitt: "kein-vorschlag",
    });
    expect(querschnittNormal("2.50")).toBe("2.5");
  });

  it("Leiterzahl: leer erlaubt, sonst ganze Zahl 1 bis 100", () => {
    expect(leiterzahlLesen("")).toEqual({ ok: true, wert: null });
    expect(leiterzahlLesen("5")).toEqual({ ok: true, wert: 5 });
    expect(leiterzahlLesen("0").ok).toBe(false);
    expect(leiterzahlLesen("2,5").ok).toBe(false);
    expect(leiterzahlLesen("101").ok).toBe(false);
  });
});
