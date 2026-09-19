import { describe, expect, it } from "vitest";

import { eintraegeAus } from "./seiten";

const seite = (...ids: string[]) => ({ items: ids.map((id) => ({ id })) });

describe("Seiten einer cursorbasierten Liste", () => {
  it("liefert ohne Daten eine leere Liste", () => {
    expect(eintraegeAus(undefined)).toEqual([]);
    expect(eintraegeAus([])).toEqual([]);
  });

  it("haengt nachgeladene Seiten in der Reihenfolge an", () => {
    const ergebnis = eintraegeAus([seite("a", "b"), seite("c")]);

    expect(ergebnis.map((eintrag) => eintrag.id)).toEqual(["a", "b", "c"]);
  });

  it("laesst doppelte Eintraege weg", () => {
    // Ein doppelt ausgeloestes Nachladen darf die Liste nicht verfaelschen.
    const ergebnis = eintraegeAus([seite("a", "b"), seite("b", "c"), seite("a")]);

    expect(ergebnis.map((eintrag) => eintrag.id)).toEqual(["a", "b", "c"]);
  });

  it("behaelt den ersten Stand eines doppelten Eintrags", () => {
    const ergebnis = eintraegeAus([
      { items: [{ id: "a", name: "zuerst" }] },
      { items: [{ id: "a", name: "spaeter" }] },
    ]);

    expect(ergebnis).toEqual([{ id: "a", name: "zuerst" }]);
  });
});
