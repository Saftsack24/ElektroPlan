import { describe, expect, it } from "vitest";

import { raumseiteAuswahl } from "./raumwand";
import { szenenmodellAus } from "./szenenmodell";
import { plan, raum, rechteck } from "./testplan";

/**
 * Raumseitige Wand in 3D (Phase 4f).
 *
 * Großer Raum „Flur“ 0…6000 × 4000…6000 (gegen den Uhrzeigersinn, Südwand
 * `flur-w0` (0,4000)→(6000,4000)). Darunter zwei kleinere Räume: Bad
 * 0…3000 × 0…4000 und Küche 3000…6000 × 0…4000. Die Flur-Südwand ist eine
 * durchgehende Wand mit zwei Nachbarabschnitten.
 */
const FLUR = rechteck("flur", "Flur", [0, 4000], [6000, 6000], { nummer: "0.03" });
const BAD = rechteck("bad", "Bad", [0, 0], [3000, 4000], { nummer: "0.01", oeffnungen: { 2: [{ id: "t-bad", offset: 1000, breite: 885, hoehe: 2010 }] } });
const KUECHE = rechteck("kueche", "Küche", [3000, 0], [6000, 4000], { nummer: "0.02", hoehe: 2600 });
const modell = szenenmodellAus(plan([FLUR, BAD, KUECHE]));
const abschnitt = (raumId: string) =>
  modell.waende.find((w) => w.quellen.some((q) => q.id === "flur-w0") && w.raumIds.includes(raumId))!;

describe("Raumwand: die ganze Wand eines Raums statt eines Abschnitts", () => {
  it("die Flur-Südwand hat ihre volle Länge und zwei Nachbarabschnitte", () => {
    const flurwand = modell.raumwaende.find((w) => w.id === "flur-w0")!;
    expect(flurwand).toMatchObject({ raumId: "flur", nummer: 1, laengeMm: 6000 });
    expect(flurwand.abschnitte.map((a) => [a.vonMm, a.bisMm, a.nachbarn])).toEqual([
      [0, 3000, ["bad"]],
      [3000, 6000, ["kueche"]],
    ]);
    // Die Badtür liegt auf der Flurwand (abgeleitet) - je ID einmal.
    expect(flurwand.oeffnungIds).toEqual(["t-bad"]);
    // Zwei Wandkörper, aber eine Raumwand - und nicht über mehrere Räume zusammengefasst.
    expect(modell.waende.filter((w) => w.quellen.some((q) => q.id === "flur-w0"))).toHaveLength(2);
    expect(modell.raumwaende.find((w) => w.id === "bad-w2")!.laengeMm).toBe(3000);
  });

  it("Klick von der Flurseite (Norden) auf den Badabschnitt wählt die ganze Flurwand", () => {
    // Fläche zeigt nach Norden (+y im Grundriss) - in den Flur.
    expect(raumseiteAuswahl(abschnitt("bad"), modell.raeume, { x: 0, y: 1, hoehe: 0 })).toEqual({ art: "raumwand", id: "flur-w0" });
    expect(raumseiteAuswahl(abschnitt("kueche"), modell.raeume, { x: 0, y: 1, hoehe: 0 })).toEqual({ art: "raumwand", id: "flur-w0" });
  });

  it("Klick von der Badseite (Süden) wählt die Badwand, von der Küchenseite die Küchenwand", () => {
    expect(raumseiteAuswahl(abschnitt("bad"), modell.raeume, { x: 0, y: -1, hoehe: 0 })).toEqual({ art: "raumwand", id: "bad-w2" });
    expect(raumseiteAuswahl(abschnitt("kueche"), modell.raeume, { x: 0, y: -1, hoehe: 0 })).toEqual({ art: "raumwand", id: "kueche-w2" });
  });

  it("Krone oder Stirnseite einer gemeinsamen Wand: nicht raten, Raumwahl anbieten", () => {
    expect(raumseiteAuswahl(abschnitt("bad"), modell.raeume, { x: 0, y: 0, hoehe: 1 })).toEqual({ art: "wandseite", id: abschnitt("bad").id });
    expect(raumseiteAuswahl(abschnitt("bad"), modell.raeume, { x: 1, y: 0, hoehe: 0 })).toEqual({ art: "wandseite", id: abschnitt("bad").id });
  });

  it("nicht geteilte Wand: von innen die Wand ihres Raums, von außen die Fassade, von oben die Seitenwahl", () => {
    const nord = modell.waende.find((w) => w.quellen.some((q) => q.id === "flur-w2"))!;
    const fassadeVon = (id: string) => modell.fassaden.find((f) => f.abschnitte.some((a) => a.id === id))?.id;
    expect(raumseiteAuswahl(nord, modell.raeume, { x: 0, y: -1, hoehe: 0 }, fassadeVon)).toEqual({ art: "raumwand", id: "flur-w2" });
    expect(raumseiteAuswahl(nord, modell.raeume, { x: 0, y: 0, hoehe: 1 }, fassadeVon)).toEqual({ art: "wandseite", id: nord.id });
    expect(raumseiteAuswahl(nord, modell.raeume, { x: 0, y: 1, hoehe: 0 }, fassadeVon)).toEqual({ art: "fassade", id: fassadeVon(nord.id), abschnitt: nord.id });
  });

  it("Raum im Uhrzeigersinn: die Seite folgt dem Rauminneren, nicht der Speicherrichtung", () => {
    // Flur im Uhrzeigersinn erfasst: Südwand läuft (6000,4000)→(0,4000)... als letzte Wand.
    const flurCw = raum("flur", "Flur", [
      [0, 4000],
      [0, 6000],
      [6000, 6000],
      [6000, 4000],
    ]);
    const m = szenenmodellAus(plan([flurCw, BAD, KUECHE]));
    const sued = m.waende.find((w) => w.quellen.some((q) => q.raumId === "flur") && w.raumIds.includes("bad"))!;
    const flurSued = sued.quellen.find((q) => q.raumId === "flur")!.id;
    expect(raumseiteAuswahl(sued, m.raeume, { x: 0, y: 1, hoehe: 0 })).toEqual({ art: "raumwand", id: flurSued });
    expect(raumseiteAuswahl(sued, m.raeume, { x: 0, y: -1, hoehe: 0 })).toEqual({ art: "raumwand", id: "bad-w2" });
  });
});

describe("Fassade: durchgehende Außenwand als Ansichtsgruppe (Phase 4f)", () => {
  // Bad und Küche nebeneinander: Ihre Südwände (y = 0) bilden eine durchgehende
  // Fassade 0…6000. Die Garage liegt auf derselben Linie, aber mit Lücke.
  const bad = rechteck("bad", "Bad", [0, 0], [3000, 4000], { oeffnungen: { 0: [{ id: "f-bad", art: "window", offset: 1000, breite: 1010, hoehe: 1260, bruestung: 900 }] } });
  const kueche = rechteck("kueche", "Küche", [3000, 0], [6000, 4000]);
  const garage = rechteck("garage", "Garage", [7000, 0], [9000, 2000]);
  const m = szenenmodellAus(plan([bad, kueche, garage]));
  const fassadeMit = (wandId: string) => m.fassaden.find((f) => f.abschnitte.some((a) => a.wandId === wandId))!;
  const fassadeVon = (id: string) => m.fassaden.find((f) => f.abschnitte.some((a) => a.id === id))?.id;
  const koerper = (wandId: string) => m.waende.find((w) => w.quellen.some((q) => q.id === wandId))!;

  it("zwei Räume nebeneinander: eine Fassade über beide, das Fenster unterbricht sie nicht", () => {
    const sued = fassadeMit("bad-w0");
    expect(sued.laengeMm).toBe(6000);
    expect(sued.abschnitte.map((a) => [a.raumId, a.wandId, a.vonMm, a.bisMm])).toEqual([
      ["bad", "bad-w0", 0, 3000],
      ["kueche", "kueche-w0", 3000, 6000],
    ]);
    expect(sued.oeffnungIds).toEqual(["f-bad"]);
  });

  it("nicht um Ecken und nicht über Lücken: getrennte Wandstücke bleiben getrennt", () => {
    expect(fassadeMit("bad-w3").id).not.toBe(fassadeMit("bad-w0").id); // Westwand: andere Gerade
    expect(fassadeMit("garage-w0").id).not.toBe(fassadeMit("bad-w0").id); // gleiche Linie, Lücke
    expect(fassadeMit("garage-w0").laengeMm).toBe(2000);
    // Die gemeinsame Wand Bad/Küche gehört zu keiner Fassade.
    expect(m.fassaden.some((f) => f.abschnitte.some((a) => a.wandId === "bad-w1"))).toBe(false);
  });

  it("von außen die ganze Fassade (mit angeklicktem Abschnitt), von innen nur die Raumwand", () => {
    const k = koerper("kueche-w0");
    expect(raumseiteAuswahl(k, m.raeume, { x: 0, y: -1, hoehe: 0 }, fassadeVon)).toEqual({ art: "fassade", id: fassadeMit("bad-w0").id, abschnitt: k.id });
    expect(raumseiteAuswahl(k, m.raeume, { x: 0, y: 1, hoehe: 0 }, fassadeVon)).toEqual({ art: "raumwand", id: "kueche-w0" });
  });
});
