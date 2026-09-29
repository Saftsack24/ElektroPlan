import { describe, expect, it } from "vitest";

import { mmAnzeigen } from "../../../core/masse";
import { szenenmodellAus } from "../ansicht3d/szenenmodell";
import { messlauf4a } from "../ansicht3d/testplan";
import { basisAus } from "./entwurf";
import type { EntwurfWand } from "./entwurf";
import type { Platzierung, Platzierungsoptionen } from "./platzierung";
import { OEFFNUNG_FANG_MM, editorEinordnung, editorTopologie, platzierungBerechnen, platzierungsText, wandUnterZeiger } from "./platzierung";

/**
 * Direkte Platzierung per Maus (Phase 4b.2): Projektion auf die Wand,
 * 50-mm-Fang, Begrenzung auf Wand und atomaren Abschnitt, Kollisionen - und
 * dieselbe abgeleitete Raumverbindung wie für gespeicherte Öffnungen.
 */
function wand(id: string, [x1, y1, x2, y2]: readonly [number, number, number, number], openings: EntwurfWand["openings"] = []): EntwurfWand {
  return { id, x1_mm: x1, y1_mm: y1, x2_mm: x2, y2_mm: y2, thickness_mm: 115, openings };
}

const tuer = (id: string, offset: number) => ({ id, kind: "door" as const, offset_mm: offset, width_mm: 885, height_mm: 2010, sill_height_mm: 0 });

const NAMEN: Record<string, string> = { wohnen: "0.01 Wohnen", flur: "0.03 Flur", bad: "0.04 Bad", kind: "0.07 Kind" };
const optionen = (extra: Partial<Platzierungsoptionen> = {}): Platzierungsoptionen => ({
  breiteMm: 885,
  fangMm: OEFFNUNG_FANG_MM,
  laengeText: (mm) => mmAnzeigen(mm, "cm"),
  raumName: (id) => NAMEN[id] ?? id,
  ...extra,
});

/** Flur mit langer Wand x = 0, y 0…9000; Bad 0…3000 und Kind 3000…9000 daneben. */
function grundriss(flurOeffnungen: EntwurfWand["openings"] = [], badOeffnungen: EntwurfWand["openings"] = []) {
  return editorTopologie("g1", [
    { id: "flur", walls: [wand("flur-lang", [0, 0, 0, 9000], flurOeffnungen)] },
    { id: "bad", walls: [wand("bad-w", [0, 3000, 0, 0], badOeffnungen)] },
    { id: "kind", walls: [wand("kind-w", [0, 9000, 0, 3000])] },
    { id: "wohnen", walls: [wand("aussen", [0, 0, 5000, 0])] },
  ]);
}

function platzieren(topo: ReturnType<typeof grundriss>, wandId: string, zeiger: { x: number; y: number }, extra: Partial<Platzierungsoptionen> = {}) {
  return platzierungBerechnen(topo.teilung.get(wandId)!, zeiger, optionen(extra));
}

const offset = (p: Platzierung) => (p.ok ? p.offsetMm : `fehler: ${p.grund}`);

describe("Wand unter dem Zeiger", () => {
  const topo = grundriss();

  it("findet keine Wand abseits aller Wände", () => {
    expect(wandUnterZeiger(topo, { x: 2500, y: 2500 }, 100, null)).toBeNull();
  });

  it("findet eine Wand innerhalb halber Stärke plus Radius", () => {
    expect(wandUnterZeiger(topo, { x: 2500, y: 150 }, 100, null)).toEqual({ raumId: "wohnen", wandId: "aussen" });
    expect(wandUnterZeiger(topo, { x: 2500, y: 170 }, 100, null)).toBeNull();
  });

  it("bevorzugt auf einer gemeinsamen Wand die des aktiven Raums", () => {
    expect(wandUnterZeiger(topo, { x: 20, y: 1500 }, 100, "bad")).toEqual({ raumId: "bad", wandId: "bad-w" });
    expect(wandUnterZeiger(topo, { x: 20, y: 1500 }, 100, "flur")).toEqual({ raumId: "flur", wandId: "flur-lang" });
  });
});

describe("Projektion und Fang", () => {
  it("waagerechte Wand: Mitte unter dem Zeiger, 50-mm-Fang ab Wandanfang", () => {
    const topo = grundriss();
    // 2000 − 442,5 = 1557,5 → 1550
    expect(offset(platzieren(topo, "aussen", { x: 2000, y: 80 }))).toBe(1550);
    expect(OEFFNUNG_FANG_MM).toBe(50);
  });

  it("senkrechte Wand in Gegenrichtung: Abstand zählt vom Wandanfang", () => {
    const topo = grundriss();
    // bad-w läuft von y = 3000 nach y = 0: y = 1000 liegt 2000 hinter dem Anfang.
    expect(offset(platzieren(topo, "bad-w", { x: -30, y: 1000 }))).toBe(1550);
  });

  it("diagonale Wand: Projektion entlang der Wand", () => {
    const topo = editorTopologie("g1", [{ id: "a", walls: [wand("d", [0, 0, 3000, 4000])] }]);
    // Punkt (1800, 2400) liegt 3000 mm entlang der 5000-mm-Wand; quer versetzt ändert nichts.
    expect(offset(platzierungBerechnen(topo.teilung.get("d")!, { x: 1800, y: 2400 }, optionen()))).toBe(2550);
    expect(offset(platzierungBerechnen(topo.teilung.get("d")!, { x: 1880, y: 2340 }, optionen()))).toBe(2550);
  });

  it("ohne Fang (Alt oder Fang aus) auf ganze Millimeter", () => {
    const topo = grundriss();
    expect(offset(platzieren(topo, "aussen", { x: 2000.4, y: 0 }, { fangMm: 1 }))).toBe(1558);
  });

  it("nahe Wandanfang und Wandende bleibt die Öffnung vollständig in der Wand", () => {
    const topo = grundriss();
    expect(offset(platzieren(topo, "aussen", { x: 30, y: 0 }))).toBe(0);
    expect(offset(platzieren(topo, "aussen", { x: 4990, y: 0 }))).toBe(5000 - 885);
  });

  it("die Maßeinheit ändert nur den Text, nie die Lage", () => {
    const topo = grundriss();
    const cm = platzieren(topo, "aussen", { x: 2000, y: 0 });
    const mm = platzieren(topo, "aussen", { x: 2000, y: 0 }, { laengeText: (w) => mmAnzeigen(w, "mm") });
    expect(offset(cm)).toBe(offset(mm));
    expect(platzierungsText(cm, "door", optionen().raumName, (w) => mmAnzeigen(w, "cm"))).toContain("155 cm");
    expect(platzierungsText(mm, "door", optionen().raumName, (w) => mmAnzeigen(w, "mm"))).toContain("1.550 mm");
  });
});

describe("Grenzen und Kollisionen", () => {
  it("Standardbreite passt nicht in die Wand: verständliche Meldung", () => {
    const topo = editorTopologie("g1", [{ id: "a", walls: [wand("kurz", [0, 0, 800, 0])] }]);
    const p = platzierungBerechnen(topo.teilung.get("kurz")!, { x: 400, y: 0 }, optionen());
    expect(p).toMatchObject({ ok: false, grund: "Die Öffnung (88,5 cm) ist breiter als die Wand (80 cm)." });
  });

  it("bleibt im gemeinsamen Abschnitt unter dem Zeiger - nie halb über die Grenze", () => {
    const topo = grundriss();
    // Zeiger knapp unter der Grenze Bad/Kind bei y = 3000: Tür endet genau bei 3000.
    const p = platzieren(topo, "flur-lang", { x: 0, y: 2900 });
    expect(p).toMatchObject({ ok: true, offsetMm: 3000 - 885, klasse: "gemeinsam", nachbarRaumId: "bad" });
    // Knapp darüber: im Abschnitt des Kinderzimmers, beginnt genau bei 3000.
    expect(platzieren(topo, "flur-lang", { x: 0, y: 3100 })).toMatchObject({ ok: true, offsetMm: 3000, nachbarRaumId: "kind" });
  });

  it("Platzierung auf gemeinsamer Wand nennt beide Räume, auf der Außenwand keinen zweiten", () => {
    const topo = grundriss();
    const gemeinsam = platzieren(topo, "bad-w", { x: 0, y: 1500 });
    expect(platzierungsText(gemeinsam, "door", optionen().raumName, (w) => mmAnzeigen(w, "cm"))).toBe(
      "Tür · verbindet „0.04 Bad“ und „0.03 Flur“ · Abstand 105 cm",
    );
    const aussen = platzieren(topo, "aussen", { x: 2000, y: 0 });
    expect(aussen).toMatchObject({ ok: true, klasse: "aussen", nachbarRaumId: null });
    expect(platzierungsText(aussen, "door", optionen().raumName, (w) => mmAnzeigen(w, "cm"))).toContain(
      "nicht geteilte Wand – kein zweiter Raum",
    );
  });

  it("Abschnitt zu kurz für die Standardbreite: Meldung nennt den Nachbarn", () => {
    const topo = editorTopologie("g1", [
      { id: "flur", walls: [wand("lang", [0, 0, 6000, 0])] },
      { id: "bad", walls: [wand("kurz", [3600, 0, 3000, 0])] },
    ]);
    const p = platzierungBerechnen(topo.teilung.get("lang")!, { x: 3300, y: 0 }, optionen());
    expect(p).toMatchObject({ ok: false, grund: "Die Öffnung (88,5 cm) passt nicht in den gemeinsamen Abschnitt mit „0.04 Bad“ (60 cm)." });
  });

  it("vorhandene Öffnung derselben Wand blockiert", () => {
    const topo = grundriss([], [tuer("vorhanden", 1000)]);
    const p = platzieren(topo, "bad-w", { x: 0, y: 1700 });
    expect(p).toMatchObject({ ok: false, grund: "Überschneidet sich mit der vorhandenen Tür bei 100 cm." });
  });

  it("nennt die blockierende Öffnung grammatisch richtig", () => {
    const fenster = { ...tuer("f", 1000), kind: "window" as const, sill_height_mm: 900, height_mm: 1260 };
    const topo = grundriss([], [fenster]);
    expect(platzieren(topo, "bad-w", { x: 0, y: 1700 })).toMatchObject({
      ok: false,
      grund: "Überschneidet sich mit dem vorhandenen Fenster bei 100 cm.",
    });
  });

  it("auf der Gegenseite gespeicherte Öffnung blockiert ebenfalls - keine neue Dublette", () => {
    const topo = grundriss([], [tuer("t-bad", 1000)]);
    // Die Badtür liegt auf der Flurwand bei 1115…2000.
    const p = platzieren(topo, "flur-lang", { x: 0, y: 1500 });
    expect(p).toMatchObject({ ok: false, grund: "Überschneidet sich mit einer Öffnung, die in „0.04 Bad“ an dieser Wand gespeichert ist." });
  });

  it("beim Verschieben zählt die bewegte Öffnung nicht als Hindernis", () => {
    const topo = grundriss([], [tuer("t-bad", 1000)]);
    const p = platzieren(topo, "bad-w", { x: 0, y: 1500 }, { ohneOeffnungId: "t-bad" });
    expect(p).toMatchObject({ ok: true, offsetMm: 1050 });
  });

  it("Abschnitt mit mehr als zwei Räumen: nicht platzierbar", () => {
    const topo = editorTopologie("g1", [
      { id: "a", walls: [wand("a1", [0, 0, 6000, 0])] },
      { id: "b", walls: [wand("b1", [6000, 0, 0, 0])] },
      { id: "c", walls: [wand("c1", [0, 0, 6000, 0])] },
    ]);
    const p = platzierungBerechnen(topo.teilung.get("a1")!, { x: 3000, y: 0 }, optionen());
    expect(p.ok).toBe(false);
    expect(p.ok ? "" : p.grund).toContain("mehr als zwei Räumen");
  });
});

describe("2D und 3D verwenden dieselbe Ableitung", () => {
  it("realer Grundriss 4a: identische atomare Abschnitte und Raumverbindungen", () => {
    const plan = messlauf4a();
    const topo2d = editorTopologie(plan.floor_id, plan.rooms.map((r) => ({ id: r.id, walls: basisAus(r).entwurf.walls })));
    const modell3d = szenenmodellAus(plan);
    expect(topo2d.abschnitte.map((a) => a.id)).toEqual(modell3d.waende.map((w) => w.id));
    expect(topo2d.abschnitte.map((a) => a.lage)).toEqual(modell3d.waende.map((w) => w.lage));
    const verbindungen2d = new Map(
      [...editorEinordnung(topo2d).values()].map((e) => [e.oeffnung.oeffnungId, [e.klasse, [...e.raumIds].sort().join("+")]]),
    );
    for (const o of modell3d.oeffnungen) {
      expect(verbindungen2d.get(o.id)).toEqual([o.klasse, [...o.raumIds].sort().join("+")]);
    }
  });
});
