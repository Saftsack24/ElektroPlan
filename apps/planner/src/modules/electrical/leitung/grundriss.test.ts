import { describe, expect, it } from "vitest";

import { rechteck } from "../ansicht3d/testplan";
import { leitungsplanAus } from "./daten";
import { durchfuehrungsWandlage, durchfuehrungsziel } from "./durchfuehrung";
import { achsgitterpunkt, grundrissFangen, grundrissstrecken, raumFuer, raumseite, wandhoeheIn } from "./grundriss";
import type { Leitung, Wegpunkt } from "./laenge";
import { leitungAuswerten, planVorbereiten } from "./laenge";
import { DIELE, GESCHOSS, KOPPLUNG, KUECHE, geschossplan } from "./testdaten";

/**
 * Reine Hilfen der Leitung im Grundriss und der neuen Durchführung (6b.5).
 * Diele (0,0)–(4200,3000), Küche (4200,0)–(8000,3000); `diele-w1` ist `wall_a`
 * der gemeinsamen Bauwand mit `kueche-w3` (entgegengesetzt, gleich lang).
 */
function vorbereitet(rooms = [DIELE, KUECHE], kopplungen = [KOPPLUNG]) {
  return planVorbereiten(
    leitungsplanAus({ geschosse: [GESCHOSS], plaene: [{ ...geschossplan(rooms), wall_links: kopplungen }], durchfuehrungen: [], steigwege: [] }),
  );
}

const v = vorbereitet();

/** Erwarteter Ablehnungsgrund - als `unknown`, damit kein `any` in Erwartungsobjekte gelangt. */
const grundMit = (muster: RegExp): unknown => expect.stringMatching(muster);

function mitWeg(wegpunkte: Wegpunkt[]): Leitung {
  return { id: "neu", startGeraetId: "uv1", endGeraetId: null, wegpunkte, startzugabeMm: 0, endzugabeMm: 0, reserveMm: 0, reserveProzent: null, kabeltyp: null, leiterzahl: null, querschnittMm2: null };
}

describe("Achse und Raum", () => {
  it("nächster ganzzahliger Achspunkt mit Abstand ab Wandanfang und Querabstand", () => {
    const info = v.waende.get("diele-w0");
    if (info === undefined) throw new Error("Wand fehlt");
    expect(achsgitterpunkt(info, { x: 1234, y: 40 })).toEqual({ punkt: { x: 1234, y: 0 }, abstandMm: 1234, querMm: 40 });
    // Über das Wandende hinaus: auf das Ende begrenzt.
    expect(achsgitterpunkt(info, { x: 5000, y: 0 }).abstandMm).toBe(4200);
  });

  it("Raum eines Punkts: eindeutig, sonst der Raum unter dem Zeiger, sonst der des Vorgängers - nie geraten", () => {
    expect(raumFuer(v, "geschoss-1", { x: 1000, y: 1000 }, { x: 1000, y: 1000 }, null)).toBe("diele");
    // Auf der gemeinsamen Wandachse liegen beide Räume - entscheidend ist, wo der Zeiger wirklich ist.
    expect(raumFuer(v, "geschoss-1", { x: 4200, y: 1500 }, { x: 4230, y: 1500 }, null)).toBe("kueche");
    expect(raumFuer(v, "geschoss-1", { x: 4200, y: 1500 }, { x: 4200, y: 1500 }, "diele")).toBe("diele");
    expect(raumFuer(v, "geschoss-1", { x: 4200, y: 1500 }, { x: 4200, y: 1500 }, null)).toBeNull();
    expect(raumFuer(v, "geschoss-1", { x: -100, y: 0 }, { x: -100, y: 0 }, "diele")).toBeNull();
    expect(raumFuer(v, "anderes-geschoss", { x: 1000, y: 1000 }, { x: 1000, y: 1000 }, null)).toBeNull();
  });

  it("Raumseite einer Wand zeigt in den Raum", () => {
    expect(raumseite(v, "diele-w0")).toEqual({ x: -0, y: 1 });
    expect(raumseite(v, "kueche-w3")?.x).toBe(1);
  });

  it("Fang: ausdrückliches Ziel im Radius, sonst Raster, mit Alt ganze Millimeter", () => {
    const ziele = [{ punkt: { x: 1000, y: 2000 }, text: "Steigweghalt S1" }];
    expect(grundrissFangen({ x: 1040, y: 1980 }, ziele, { aktiv: true, ausgesetzt: false, radiusMm: 100, rasterMm: 100 })).toEqual({ punkt: { x: 1000, y: 2000 }, text: "Steigweghalt S1" });
    expect(grundrissFangen({ x: 1240, y: 1980 }, ziele, { aktiv: true, ausgesetzt: false, radiusMm: 100, rasterMm: 100 })).toEqual({ punkt: { x: 1200, y: 2000 }, text: null });
    expect(grundrissFangen({ x: 1040.4, y: 1980.6 }, ziele, { aktiv: true, ausgesetzt: true, radiusMm: 100, rasterMm: 100 })).toEqual({ punkt: { x: 1040, y: 1981 }, text: null });
  });
});

describe("Zeichenstrecken im Grundriss", () => {
  it("Wand- und Fußbodenläufe dieses Geschosses - senkrechte Teile ohne Strecke", () => {
    const e = leitungAuswerten(
      v,
      mitWeg([
        { art: "wand", wandId: "diele-w0", abstandMm: 1000, hoeheMm: 0 },
        { art: "floor", raumId: "diele", x: 1000, y: 0 },
        { art: "floor", raumId: "diele", x: 1000, y: 2000 },
      ]),
    );
    const strecken = grundrissstrecken(v, e, "geschoss-1");
    // Anschluss UV1: senkrecht (keine Strecke im Grundriss), dann waagerecht 500 → 1000.
    expect(strecken).toEqual([
      { flaeche: "wand", a: { x: 500, y: 0 }, b: { x: 1000, y: 0 }, wandId: "diele-w0" },
      { flaeche: "fussboden", a: { x: 1000, y: 0 }, b: { x: 1000, y: 2000 }, wandId: null },
    ]);
    expect(grundrissstrecken(v, e, "anderes-geschoss")).toEqual([]);
  });
});

describe("Neue Durchführung: nur aktive, eindeutige gemeinsame Abschnitte", () => {
  it("an wall_a direkt, von wall_b über die geprüfte Transformation; Gegenlage zurück exakt", () => {
    expect(durchfuehrungsziel(v, "diele-w1", 1500)).toEqual({ ok: true, kopplungId: "kopplung-1", abstandMm: 1500 });
    expect(durchfuehrungsziel(v, "kueche-w3", 900)).toEqual({ ok: true, kopplungId: "kopplung-1", abstandMm: 2100 });
    const d = { id: "neu-x", kopplungId: "kopplung-1", abstandMm: 2100, hoeheMm: 2200 };
    expect(durchfuehrungsWandlage(v, d, "kueche-w3")).toBe(900);
    expect(durchfuehrungsWandlage(v, d, "diele-w1")).toBe(2100);
    expect(durchfuehrungsWandlage(v, d, "diele-w0")).toBeNull();
  });

  it("nicht an einer Wand ohne Nachbarraum, nicht bei undecided oder separate", () => {
    expect(durchfuehrungsziel(v, "diele-w0", 1000)).toMatchObject({ ok: false, grund: grundMit(/kein zweiter Raum/) });
    const offen = vorbereitet([DIELE, KUECHE], []);
    expect(durchfuehrungsziel(offen, "diele-w1", 1500)).toMatchObject({ ok: false, grund: grundMit(/nicht entschieden/) });
    const getrennt = vorbereitet([DIELE, KUECHE], [{ ...KOPPLUNG, relation: "separate" as never }]);
    expect(durchfuehrungsziel(getrennt, "diele-w1", 1500)).toMatchObject({ ok: false, grund: grundMit(/getrennte Wände/) });
  });

  it("nicht bei mehr als zwei Räumen und nicht genau auf einer Abschnittsgrenze", () => {
    const nische = rechteck("nische", "Nische", [4200, 0], [5000, 3000]);
    expect(durchfuehrungsziel(vorbereitet([DIELE, KUECHE, nische]), "diele-w1", 1500)).toMatchObject({ ok: false, grund: grundMit(/mehr als zwei Räume/) });
    // Kürzere Küche: gemeinsam nur 0–2 000, danach ohne Partner. Genau auf 2 000 ist die Grenze.
    const kurz = rechteck("kueche", "Küche", [4200, 0], [8000, 2000]);
    const plan = vorbereitet([DIELE, kurz]);
    expect(durchfuehrungsziel(plan, "diele-w1", 1500).ok).toBe(true);
    expect(durchfuehrungsziel(plan, "diele-w1", 2000)).toMatchObject({ ok: false, grund: grundMit(/Abschnittsgrenze/) });
    expect(durchfuehrungsziel(plan, "diele-w1", 2500)).toMatchObject({ ok: false, grund: grundMit(/kein zweiter Raum/) });
  });
});

describe("Höhe neuer Wandpunkte im Grundriss", () => {
  it("fest, obere Zone (300 mm unter der Decke) oder Decke - nie über der Raumhöhe", () => {
    expect(wandhoeheIn(300, 2500)).toBe(300);
    expect(wandhoeheIn("obere-zone", 2500)).toBe(2200);
    expect(wandhoeheIn("decke", 2400)).toBe(2400);
    expect(wandhoeheIn(3000, 2500)).toBe(2500);
  });
});
