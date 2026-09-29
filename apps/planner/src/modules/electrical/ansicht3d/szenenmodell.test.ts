import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RAUM } from "../editor/testdaten";
import type { Szenenmodell } from "./modell";
import { LEERES_MODELL, objektZu, szenenmodellAus, warnungenZu } from "./szenenmodell";
import { belastungsplan, einfamilienhaus, messlauf4a, plan, raum, rechteck } from "./testplan";

/**
 * Planungsstand → Szenenmodell. Die Konturformen stammen aus derselben
 * Fixture, die Backend und 2D-Editor gegeneinander prüfen.
 */
interface Kontur {
  name: string;
  waende: [number, number, number, number][];
  status: "draft" | "valid";
  flaeche_mm2: number | null;
}
const fixture = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../testdata/geometry/raumgeometrie.v1.json"),
    "utf-8",
  ),
) as { konturen: Kontur[] };

function aus(konturName: string, id = "r1") {
  const kontur = fixture.konturen.find((k) => k.name === konturName);
  if (kontur === undefined) throw new Error(`Fixture-Kontur fehlt: ${konturName}`);
  // Nur geschlossene Fixture-Konturen: Die Startpunkte ergeben die Wände wieder.
  const punkte = kontur.waende.map(([x, y]) => [x, y] as const);
  return raum(id, konturName, punkte, { status: kontur.status });
}

const gemeinsame = (m: Szenenmodell) => m.waende.filter((w) => w.lage === "gemeinsam");

describe("Szenenmodell aus dem Planungsstand", () => {
  it("leerer Plan ist ein normaler, leerer Zustand", () => {
    const modell = szenenmodellAus(plan([]));
    expect(modell.raeume).toEqual([]);
    expect(modell.waende).toEqual([]);
    expect(modell.ausgelassen).toEqual([]);
    expect(modell.warnungen).toEqual([]);
    expect(modell.grenzen).toBeNull();
    expect(modell.floorId).toBe("geschoss-1");
    expect(szenenmodellAus(undefined)).toBe(LEERES_MODELL);
  });

  it("gültiges Rechteck: ein Raum, vier nicht geteilte Wände, zentrierte Transformation", () => {
    const modell = szenenmodellAus(plan([aus("gueltiges Rechteck")]));
    expect(modell.raeume).toHaveLength(1);
    expect(modell.raeume[0]!.kontur).toEqual([
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 5000, y: 4000 },
      { x: 0, y: 4000 },
    ]);
    expect(modell.waende).toHaveLength(4);
    expect(modell.waende.every((w) => w.lage === "aussen")).toBe(true);
    // Rand = halbe Wandstärke, aufgerundet (115 → 58).
    expect(modell.grenzen).toEqual({ minX: -58, minY: -58, maxX: 5058, maxY: 4058 });
    expect(modell.transformation).toEqual({ mitteXMm: 2500, mitteYMm: 2000, meterJeMm: 0.001 });
    expect(modell.hoeheMaxMm).toBe(2500);
  });

  it("übernimmt den Editor-Testraum mit Höhe, Fläche und Wandzahl", () => {
    const modell = szenenmodellAus(plan([RAUM], "geschoss-1"));
    expect(modell.raeume[0]).toMatchObject({ name: "Wohnzimmer", nummer: "0.01", hoeheMm: 2500, flaecheM2: "20.000", wandanzahl: 4 });
  });

  it("gültige L-Form mit schräger Wand wird dargestellt", () => {
    const modell = szenenmodellAus(plan([aus("L-Form mit schraeger Wand")]));
    expect(modell.raeume).toHaveLength(1);
    expect(modell.raeume[0]!.kontur).toHaveLength(6);
    expect(modell.waende).toHaveLength(6);
    const schraeg = modell.waende.find((w) => w.start.x === 1000 && w.start.y === 5000);
    expect(schraeg?.laengeMm).toBe(2828);
  });

  it("lässt offene und als Entwurf gemeldete Konturen mit Begründung aus", () => {
    const modell = szenenmodellAus(
      plan([
        aus("gueltiges Rechteck", "ok"),
        raum("offen", "Abstellraum", [[6000, 0], [9000, 0], [9000, 3000], [6000, 3000]], { offen: true, nummer: "0.09" }),
        rechteck("entwurf", "Gäste-WC", [10_000, 0], [12_000, 2000], { status: "draft" }),
      ]),
    );
    expect(modell.raeume.map((r) => r.id)).toEqual(["ok"]);
    expect(modell.ausgelassen.map((r) => r.bezeichnung)).toEqual(["0.09 Abstellraum", "Gäste-WC"]);
    expect(modell.ausgelassen[0]!.grund).toContain("nicht geschlossen");
    // Wände ausgelassener Räume erzeugen keine Körper und keine Gruppen.
    expect(modell.waende).toHaveLength(4);
    expect(modell.raumanzahlGesamt).toBe(3);
  });

  it("lässt einen als gültig gemeldeten, aber lückenhaften Raum defensiv aus", () => {
    const kaputt = rechteck("kaputt", "Kaputt", [0, 0], [3000, 3000]);
    const walls = kaputt.walls.map((w, i) => (i === 1 ? { ...w, x1_mm: 3000, y1_mm: 500 } : w));
    const modell = szenenmodellAus(plan([{ ...kaputt, walls }]));
    expect(modell.raeume).toEqual([]);
    expect(modell.ausgelassen[0]!.grund).toContain("lückenlos");
  });

  it("stellt Räume eines anderen Geschosses nicht dar", () => {
    const modell = szenenmodellAus(plan([rechteck("fremd", "Fremd", [0, 0], [3000, 3000], { floorId: "geschoss-2" })]));
    expect(modell.raeume).toEqual([]);
    expect(modell.ausgelassen[0]!.grund).toContain("anderen Geschoss");
  });

  it("mehrere benachbarte Räume: gemeinsame Wand erscheint einmal", () => {
    const modell = szenenmodellAus(
      plan([rechteck("a", "Küche", [0, 0], [4000, 4000]), rechteck("b", "Flur", [4000, 0], [6000, 4000])]),
    );
    expect(modell.waende).toHaveLength(7);
    expect(gemeinsame(modell)).toHaveLength(1);
    expect(gemeinsame(modell)[0]!.id).toBe("a-w1+b-w3");
    expect(modell.raeume.map((r) => r.farbindex)).toEqual([0, 1]);
  });

  it("Einfamilienhaus: 7 Räume, 32 logische → 22 Wandkörper, 17 → 15 Öffnungen", () => {
    const modell = szenenmodellAus(einfamilienhaus());
    expect(modell.raeume).toHaveLength(7);
    expect(modell.waende.reduce((n, w) => n + w.quellen.length, 0)).toBe(32);
    expect(modell.waende).toHaveLength(22);
    expect(gemeinsame(modell)).toHaveLength(10);
    expect(modell.oeffnungen).toHaveLength(15);
    expect(modell.oeffnungen.reduce((n, o) => n + o.quellen.length, 0)).toBe(17);
    // Einmal gespeicherte Türen an gemeinsamen Wänden sind keine Auffälligkeit
    // mehr (Phase 4b.2); gemeldet werden nur die echten Widersprüche.
    expect(modell.warnungen.map((w) => w.code).sort()).toEqual(["oeffnung-art-abweichend", "oeffnung-dublette"]);
    // Die beidseitig gleich erfasste Wohnzimmertür ist eine Öffnung.
    expect(modell.oeffnungen.find((o) => o.id === "t-wohnen-flur-f+t-wohnen-flur-w")).toBeDefined();
  });

  it("realer Grundriss aus 4a: 7 Teilüberlappungen ergeben einzelne Körper, keine doppelte Extrusion", () => {
    const modell = szenenmodellAus(messlauf4a());
    expect(modell.raeume).toHaveLength(7);
    // 30 logische Wände → 23 Körper: 4 vollständig gleiche Paare, 7 Teilstücke, 12 Außenwände.
    expect(modell.waende).toHaveLength(23);
    expect(gemeinsame(modell)).toHaveLength(11);
    expect(modell.waende.filter((w) => w.id.includes("@"))).toHaveLength(7);
    // Keine doppelte Extrusion: Die Körper einer Geraden überlappen sich nirgends.
    const laengeJeGerade = new Map<string, number>();
    for (const w of modell.waende) {
      const gerade = w.start.x === w.ende.x ? `x${w.start.x}` : `y${w.start.y}`;
      laengeJeGerade.set(gerade, (laengeJeGerade.get(gerade) ?? 0) + w.laengeMm);
    }
    expect(laengeJeGerade.get("x6500")).toBe(9000); // lange Flurwand: Bad + Schlafen + Kind
    expect(laengeJeGerade.get("y5000")).toBe(5000); // Wohnen gegen Küche und Flur
    expect(laengeJeGerade.get("y3000")).toBe(4500); // Schlafen gegen Bad und HWR
    // Die nur an der kurzen Raumwand gespeicherte Badtür schneidet den gemeinsamen Körper.
    const bad = modell.oeffnungen.find((o) => o.id === "t-bad")!;
    expect(bad).toMatchObject({ klasse: "gemeinsam", raumIds: ["bad", "flur"] });
    const koerper = modell.waende.find((w) => w.id === bad.wandId)!;
    expect(koerper.raumIds).toEqual(["bad", "flur"]);
    expect(koerper.teile.some((t) => t.s0 < bad.rechteck.s1 && t.s1 > bad.rechteck.s0 && t.h0 < bad.rechteck.h1)).toBe(false);
    expect(modell.oeffnungen).toHaveLength(15);
    expect(modell.warnungen).toEqual([]);
  });

  it("Belastungsprobe: 30 Räume, 120 Wände, 60 Öffnungen", () => {
    const start = performance.now();
    const modell = szenenmodellAus(belastungsplan());
    const dauer = performance.now() - start;
    expect(modell.raeume).toHaveLength(30);
    expect(modell.waende.reduce((n, w) => n + w.quellen.length, 0)).toBe(120);
    expect(modell.waende).toHaveLength(71);
    expect(modell.oeffnungen).toHaveLength(60);
    // Keine Leistungszusage - nur ein Schutz gegen grobe Ausreißer (quadratisch o. ä.).
    expect(dauer).toBeLessThan(500);
  });

  it("ist deterministisch und liefert stabile Auswahl-IDs", () => {
    const a = szenenmodellAus(einfamilienhaus());
    const b = szenenmodellAus(einfamilienhaus());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const umgekehrt = einfamilienhaus();
    const c = szenenmodellAus({ ...umgekehrt, rooms: [...umgekehrt.rooms].reverse() });
    expect(c.waende.map((w) => w.id).sort()).toEqual(a.waende.map((w) => w.id).sort());
    expect(c.oeffnungen.map((o) => o.id).sort()).toEqual(a.oeffnungen.map((o) => o.id).sort());
  });

  it("findet das fachliche Objekt und seine Warnungen zu einer Auswahl", () => {
    const modell = szenenmodellAus(einfamilienhaus());
    expect(objektZu(modell, { art: "raum", id: "flur" })).toMatchObject({ art: "raum", raum: { name: "Flur" } });
    const tuer = objektZu(modell, { art: "oeffnung", id: "t-hwr" });
    expect(tuer).toMatchObject({ art: "oeffnung", wand: { id: "flur-w1+hwr-w3", lage: "gemeinsam" } });
    expect(tuer).toMatchObject({ oeffnung: { klasse: "gemeinsam", raumIds: ["flur", "hwr"] } });
    expect(warnungenZu(modell, { art: "oeffnung", id: "t-hwr" })).toEqual([]);
    expect(warnungenZu(modell, { art: "oeffnung", id: "t-bad-bad+t-bad-flur" }).map((w) => w.code)).toEqual([
      "oeffnung-art-abweichend",
    ]);
    expect(objektZu(modell, { art: "wand", id: "gibt-es-nicht" })).toBeNull();
    expect(objektZu(modell, null)).toBeNull();
  });
});
