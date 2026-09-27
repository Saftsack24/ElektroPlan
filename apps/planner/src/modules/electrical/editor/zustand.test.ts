import { ApiError } from "@elektroplan/api-client";
import { describe, expect, it } from "vitest";

import type { RaumImPlan, Raumentwurf } from "./entwurf";
import { RAUM } from "./testdaten";
import { alsKonturanfrage } from "./entwurf";
import { fehlerAuswerten } from "./speichern";
import { eckeVerschieben } from "./werkzeuge";
import { ANFANG, MAX_HISTORIE, editorReducer, fehlerhafteKeys, ungespeichert } from "./zustand";
import type { Aktion, EditorZustand } from "./zustand";

function lauf(...aktionen: Aktion[]): EditorZustand {
  return aktionen.reduce(editorReducer, ANFANG);
}

function verschoben(z: EditorZustand, x: number): Raumentwurf {
  if (z.entwurf === null) throw new Error("kein Entwurf");
  return eckeVerschieben(z.entwurf, { x: 5000, y: 4000 }, { x, y: 4000 });
}

const aktiv = lauf({ typ: "raum-aktivieren", raum: RAUM });

describe("Editorzustand", () => {
  it("startet sauber mit Serverstand als Basis", () => {
    expect(aktiv.status).toBe("sauber");
    expect(ungespeichert(aktiv)).toBe(false);
    expect(aktiv.auswahl).toEqual({ art: "raum", raumId: "raum-1" });
  });

  it("eine lokale Änderung setzt den Dirty-Status", () => {
    const z = editorReducer(aktiv, { typ: "aendern", entwurf: verschoben(aktiv, 6000) });
    expect(z.status).toBe("geaendert");
    expect(ungespeichert(z)).toBe(true);
    expect(z.zurueck).toHaveLength(1);
  });

  it("Undo und Redo - und zurück auf dem Serverstand ist der Entwurf wieder sauber", () => {
    const geaendert = editorReducer(aktiv, { typ: "aendern", entwurf: verschoben(aktiv, 6000) });
    const zurueck = editorReducer(geaendert, { typ: "rueckgaengig" });
    expect(zurueck.status).toBe("sauber");
    expect(zurueck.entwurf).toEqual(aktiv.entwurf);
    const wieder = editorReducer(zurueck, { typ: "wiederholen" });
    expect(wieder.entwurf).toEqual(geaendert.entwurf);
    expect(wieder.status).toBe("geaendert");
  });

  it("eine neue Aktion hinter einem Undo verwirft den Redo-Zweig", () => {
    let z = editorReducer(aktiv, { typ: "aendern", entwurf: verschoben(aktiv, 6000) });
    z = editorReducer(z, { typ: "rueckgaengig" });
    expect(z.vor).toHaveLength(1);
    z = editorReducer(z, { typ: "aendern", entwurf: verschoben(z, 7000) });
    expect(z.vor).toHaveLength(0);
  });

  it("eine Ziehbewegung erzeugt genau einen Historienschritt", () => {
    let z = editorReducer(aktiv, { typ: "ziehen-beginnen" });
    for (let x = 5010; x <= 6000; x += 10) {
      z = editorReducer(z, { typ: "ziehen-vorschau", entwurf: eckeVerschieben(aktiv.entwurf as Raumentwurf, { x: 5000, y: 4000 }, { x, y: 4000 }) });
    }
    expect(z.zurueck).toHaveLength(0);
    z = editorReducer(z, { typ: "ziehen-beenden" });
    expect(z.zurueck).toHaveLength(1);
    expect(z.zurueck[0]).toEqual(aktiv.entwurf);
    expect(z.entwurf?.walls[1]?.x2_mm).toBe(6000);
  });

  it("Escape bricht eine Ziehbewegung ohne Spuren ab", () => {
    let z = editorReducer(aktiv, { typ: "ziehen-beginnen" });
    z = editorReducer(z, { typ: "ziehen-vorschau", entwurf: verschoben(aktiv, 9000) });
    z = editorReducer(z, { typ: "ziehen-abbrechen" });
    expect(z.entwurf).toEqual(aktiv.entwurf);
    expect(z.zurueck).toHaveLength(0);
  });

  it("Auswahl und Werkzeugwechsel blähen die Historie nicht auf", () => {
    let z = editorReducer(aktiv, { typ: "auswaehlen", auswahl: { art: "wand", raumId: "raum-1", wandId: "w2" } });
    z = editorReducer(z, { typ: "werkzeug", werkzeug: "polygon" });
    z = editorReducer(z, { typ: "zeichnung", punkte: [{ x: 1, y: 1 }] });
    expect(z.zurueck).toHaveLength(0);
    expect(z.werkzeug).toBe("polygon");
  });

  it("begrenzt die Historie", () => {
    let z = aktiv;
    for (let i = 1; i <= MAX_HISTORIE + 20; i += 1) {
      z = editorReducer(z, { typ: "aendern", entwurf: verschoben(aktiv, 5000 + i * 10) });
    }
    expect(z.zurueck).toHaveLength(MAX_HISTORIE);
  });

  it("übernimmt nach dem Speichern die Serverantwort als neue Basis und beginnt die Historie neu", () => {
    let z = editorReducer(aktiv, { typ: "aendern", entwurf: verschoben(aktiv, 6000) });
    z = editorReducer(z, { typ: "speichern-beginnt" });
    expect(z.status).toBe("speichert");
    const antwort: RaumImPlan = { ...RAUM, version: 6, walls: RAUM.walls.map((w) => (w.id === "w2" ? { ...w, x2_mm: 6000 } : w.id === "w3" ? { ...w, x1_mm: 6000 } : w)) };
    z = editorReducer(z, { typ: "gespeichert", raum: antwort });
    expect(z.status).toBe("gespeichert");
    expect(z.basis?.raum.version).toBe(6);
    expect(z.zurueck).toHaveLength(0);
    expect(ungespeichert(z)).toBe(false);
    expect(alsKonturanfrage(z.entwurf as Raumentwurf).walls[1]?.x2_mm).toBe(6000);
  });

  it("409 behält den lokalen Entwurf und meldet einen Konflikt", () => {
    const geaendert = editorReducer(aktiv, { typ: "aendern", entwurf: verschoben(aktiv, 6000) });
    const a = fehlerAuswerten(new ApiError(409, { type: "https://elektroplan.internal/errors/version-conflict", title: "x", status: 409 }, null));
    const z = editorReducer(geaendert, { typ: "speichern-gescheitert", status: a.status, fehler: a.fehler });
    expect(z.status).toBe("konflikt");
    expect(z.entwurf).toEqual(geaendert.entwurf);
    // Ein neu geladener Serverstand überschreibt den Entwurf nicht still.
    const nachLaden = editorReducer(z, { typ: "serverstand", raum: { ...RAUM, version: 9 } });
    expect(nachLaden.entwurf).toEqual(geaendert.entwurf);
    expect(nachLaden.basis?.raum.version).toBe(5);
  });

  it("422 markiert die betroffenen Elemente anhand der keys", () => {
    const geaendert = editorReducer(aktiv, { typ: "aendern", entwurf: verschoben(aktiv, 6000) });
    const a = fehlerAuswerten(
      new ApiError(
        422,
        {
          type: "https://elektroplan.internal/errors/validation-failed",
          title: "x",
          status: 422,
          errors: [{ field: "geometry", code: "walls-intersect", message: "raw", keys: ["w2", "w4"] }],
        },
        null,
      ),
    );
    expect(a.status).toBe("validierung");
    expect(a.fehler.eintraege[0]?.meldung).toBe("Zwei Wände überschneiden oder berühren sich.");
    const z = editorReducer(geaendert, { typ: "speichern-gescheitert", status: a.status, fehler: a.fehler });
    expect([...fehlerhafteKeys(z)]).toEqual(["w2", "w4"]);
    expect(z.entwurf).toEqual(geaendert.entwurf);
  });

  it("ein Netzwerkfehler behält den Entwurf", () => {
    const a = fehlerAuswerten(new TypeError("Failed to fetch"));
    expect(a.status).toBe("fehler");
    expect(a.fehler.meldung).toContain("Entwurf");
  });

  it("ein unveränderter Entwurf folgt einem neu geladenen Serverstand", () => {
    const z = editorReducer(aktiv, { typ: "serverstand", raum: { ...RAUM, version: 7 } });
    expect(z.basis?.raum.version).toBe(7);
  });

  it("Verwerfen stellt den Serverstand wieder her", () => {
    let z = editorReducer(aktiv, { typ: "aendern", entwurf: verschoben(aktiv, 6000) });
    z = editorReducer(z, { typ: "verwerfen" });
    expect(z.entwurf).toEqual(aktiv.entwurf);
    expect(z.status).toBe("sauber");
  });

  it("übernimmt geänderte Stammdaten samt neuer Version, ohne den Entwurf anzufassen", () => {
    let z = editorReducer(aktiv, { typ: "aendern", entwurf: verschoben(aktiv, 6000) });
    const { walls: _walls, contour_problems: _p, ...stammdaten } = RAUM;
    z = editorReducer(z, { typ: "stammdaten", raum: { ...stammdaten, name: "Wohnen", version: 6 } });
    expect(z.basis?.raum.version).toBe(6);
    expect(z.basis?.raum.name).toBe("Wohnen");
    expect(z.status).toBe("geaendert");
  });
});
