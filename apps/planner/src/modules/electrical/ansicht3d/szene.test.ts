import type { Material, Mesh, Object3D } from "three";
import { BufferGeometry, Color, Material as MaterialKlasse, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Auswahl } from "./modell";
import { Grundrissszene, STANDARD_SZENENFARBEN, WebGLNichtVerfuegbar } from "./szene";
import { szenenmodellAus } from "./szenenmodell";
import { testumgebung } from "./szenentest";
import { einfamilienhaus, plan, rechteck } from "./testplan";

/**
 * Lebenszyklus der imperativen Szenenschicht ohne WebGL-Kontext.
 *
 * Renderer, Controls, Bildtakt und Größenbeobachtung sind Test-Doubles
 * (`szenentest.ts`); Szene, Kamera, Geometrien und Raycasting sind echtes
 * Three.js. Geprüft wird ElektroPlan: Aufbau, Aktualisierung, Auswahl,
 * Kamera und vollständiges Entsorgen.
 */
const einRaum = () =>
  szenenmodellAus(
    plan([
      rechteck("r1", "Wohnen", [0, 0], [5000, 4000], {
        oeffnungen: { 0: [{ id: "tuer", offset: 2000, breite: 1000, hoehe: 2000 }] },
      }),
    ]),
  );

let behaelter: HTMLDivElement;
let rueckmeldung: {
  auswahl: ReturnType<typeof vi.fn<(a: Auswahl | null) => void>>;
  kontextVerloren: ReturnType<typeof vi.fn<() => void>>;
};

beforeEach(() => {
  behaelter = document.createElement("div");
  document.body.appendChild(behaelter);
  rueckmeldung = { auswahl: vi.fn<(a: Auswahl | null) => void>(), kontextVerloren: vi.fn<() => void>() };
});

afterEach(() => {
  behaelter.remove();
  vi.restoreAllMocks();
});

function erzeugen(optionen?: Parameters<typeof testumgebung>[0]) {
  const test = testumgebung(optionen);
  const szene = new Grundrissszene(behaelter, test.umgebung, rueckmeldung);
  return { test, szene };
}

function meshMit(wurzel: Object3D | undefined, auswahl: Auswahl): Mesh | undefined {
  let gefunden: Mesh | undefined;
  wurzel?.traverse((o) => {
    const a = o.userData["auswahl"] as Auswahl | undefined;
    if (a?.art === auswahl.art && a.id === auswahl.id) gefunden = o as Mesh;
  });
  return gefunden;
}

/** Bildschirmposition (NDC) eines Szenenpunkts für die aktuelle Kamera. */
function ndc(szene: Grundrissszene, punkt: Vector3): [number, number] {
  szene.kamera.updateMatrixWorld();
  const p = punkt.clone().project(szene.kamera);
  return [p.x, p.y];
}

describe("Initialisierung", () => {
  it("erzeugt Renderer, Canvas und Controls genau einmal", () => {
    const { test } = erzeugen();
    expect(test.rendererErzeugen).toHaveBeenCalledTimes(1);
    expect(test.controlsErzeugen).toHaveBeenCalledTimes(1);
    expect(behaelter.querySelectorAll("canvas")).toHaveLength(1);
    expect(test.controls.tastenAn).toBe(behaelter);
    expect(test.controls.maxPolarAngle).toBeLessThan(Math.PI / 2);
  });

  it("begrenzt die Pixel Ratio auf 2 und übernimmt die Behältergröße", () => {
    const { test, szene } = erzeugen();
    expect(test.renderer.setPixelRatio).toHaveBeenCalledWith(2);
    expect(test.renderer.setSize).toHaveBeenCalledWith(800, 600, false);
    expect(szene.kamera.aspect).toBeCloseTo(800 / 600, 9);
  });

  it("rendert nur auf Anforderung - ohne Bewegung keine Schleife", () => {
    const { test } = erzeugen();
    expect(test.offeneBilder).toBe(1);
    test.bild();
    expect(test.renderer.render).toHaveBeenCalledTimes(1);
    expect(test.offeneBilder).toBe(0);
    test.bild();
    expect(test.renderer.render).toHaveBeenCalledTimes(1);
  });

  it("läuft während der Dämpfung nach und hört danach auf", () => {
    const { test } = erzeugen();
    test.bild();
    test.controls.bewegen(3);
    for (let i = 0; i < 10; i += 1) test.bild();
    expect(test.renderer.render).toHaveBeenCalledTimes(1 + 4);
    expect(test.offeneBilder).toBe(0);
  });

  it("fordert auch bei vielen Änderungen je Frame nur ein Bild an", () => {
    const { test } = erzeugen();
    test.bild();
    for (let i = 0; i < 20; i += 1) test.controls.bewegen();
    expect(test.offeneBilder).toBe(1);
  });

  it("WebGL-Fehler: eigene Fehlerart, kein Canvas, keine Controls", () => {
    const dispose = vi.spyOn(MaterialKlasse.prototype, "dispose");
    expect(() => erzeugen({ webgl: false })).toThrow(WebGLNichtVerfuegbar);
    expect(behaelter.querySelector("canvas")).toBeNull();
    expect(dispose).toHaveBeenCalled();
  });
});

describe("Plan", () => {
  it("baut Böden, Wände und Öffnungen als auswählbare Objekte auf", () => {
    const { szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    // 1 Boden + 4 Wände + 1 Öffnung auswählbar; dazu 1 Umriss
    expect(szene.statistik()).toMatchObject({ auswaehlbar: 6, planGeometrien: 7, raster: 1 });
  });

  it("zeichnet das Raster zuerst und ohne Tiefe - es scheint nie durch Böden (Browserbefund)", () => {
    const { test, szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    test.bild();
    let raster: Object3D | undefined;
    test.letzteSzene()?.traverse((o) => {
      if (o.type === "GridHelper") raster = o;
    });
    expect(raster?.renderOrder).toBe(-1);
    expect(((raster as Mesh | undefined)?.material as Material).depthWrite).toBe(false);
  });

  it("gibt beim neuen Plan die ersetzten Geometrien frei", () => {
    const { szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    const freigegeben = vi.spyOn(BufferGeometry.prototype, "dispose");
    szene.setzePlan(szenenmodellAus(einfamilienhaus()), { einpassen: false });
    expect(freigegeben.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(szene.statistik().auswaehlbar).toBe(7 + 22 + 15);
  });

  it("setzt die Kamera passend zur Ausdehnung des Plans", () => {
    const { test, szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    const klein = szene.kamera.position.distanceTo(test.controls.target);
    szene.setzePlan(szenenmodellAus(einfamilienhaus()), { einpassen: true });
    const gross = szene.kamera.position.distanceTo(test.controls.target);
    expect(gross).toBeGreaterThan(klein);
    // Ganzer Grundriss im Bild: alle Ecken innerhalb des Sichtbereichs.
    szene.kamera.updateMatrixWorld();
    for (const [x, z] of [
      [-5.5, 4.5],
      [5.5, 4.5],
      [5.5, -4.5],
      [-5.5, -4.5],
    ]) {
      const [nx, ny] = ndc(szene, new Vector3(x, 2.5, z));
      expect(Math.abs(nx)).toBeLessThan(1);
      expect(Math.abs(ny)).toBeLessThan(1);
    }
  });

  it("behält die Kamera bei einer Aktualisierung desselben Geschosses", () => {
    const { szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    szene.zoomen(2);
    const vorher = szene.kamera.position.clone();
    szene.setzePlan(einRaum(), { einpassen: false });
    expect(szene.kamera.position.equals(vorher)).toBe(true);
  });

  it("Draufsicht blickt senkrecht von oben mit Norden oben", () => {
    const { test, szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    szene.draufsicht();
    const blick = szene.kamera.position.clone().sub(test.controls.target).normalize();
    expect(blick.y).toBeGreaterThan(0.999);
    szene.kamera.updateMatrixWorld();
    const [, nordY] = ndc(szene, new Vector3(0, 0, -1));
    const [, suedY] = ndc(szene, new Vector3(0, 0, 1));
    expect(nordY).toBeGreaterThan(suedY);
    const [ostX] = ndc(szene, new Vector3(1, 0, 0));
    const [westX] = ndc(szene, new Vector3(-1, 0, 0));
    expect(ostX).toBeGreaterThan(westX);
  });

  it("„Ansicht einpassen“ behält die Blickrichtung und passt den Abstand an", () => {
    const { test, szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    szene.draufsicht();
    szene.zoomen(4);
    szene.einpassen();
    const blick = szene.kamera.position.clone().sub(test.controls.target);
    expect(blick.clone().normalize().y).toBeGreaterThan(0.999);
    szene.draufsicht();
    expect(szene.kamera.position.clone().sub(test.controls.target).length()).toBeCloseTo(blick.length(), 6);
  });

  it("zoomen bleibt in den Distanzgrenzen", () => {
    const { test, szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    for (let i = 0; i < 50; i += 1) szene.zoomen(3);
    expect(szene.kamera.position.distanceTo(test.controls.target)).toBeCloseTo(test.controls.minDistance, 6);
    for (let i = 0; i < 50; i += 1) szene.zoomen(0.2);
    expect(szene.kamera.position.distanceTo(test.controls.target)).toBeCloseTo(test.controls.maxDistance, 6);
  });
});

describe("Größe", () => {
  it("aktualisiert Seitenverhältnis und Renderergröße ohne Neuaufbau", () => {
    const { test, szene } = erzeugen();
    test.groesse(1000, 500);
    expect(szene.kamera.aspect).toBe(2);
    expect(test.renderer.setSize).toHaveBeenLastCalledWith(1000, 500, false);
    expect(test.rendererErzeugen).toHaveBeenCalledTimes(1);
  });

  it("rendert ohne Behältergröße nicht und setzt danach fort", () => {
    const { test } = erzeugen({ groesse: [0, 0] });
    expect(test.offeneBilder).toBe(0);
    expect(test.renderer.setSize).not.toHaveBeenCalled();
    test.groesse(640, 480);
    expect(test.offeneBilder).toBe(1);
    test.groesse(0, 480);
    expect(test.offeneBilder).toBe(0);
  });
});

describe("Auswahl", () => {
  it("trifft Boden, Wand und Öffnung und liefert fachliche IDs", () => {
    const { szene } = erzeugen();
    const modell = einRaum();
    szene.setzePlan(modell, { einpassen: true });

    szene.draufsicht();
    expect(szene.auswahlBei(...ndc(szene, new Vector3(0.3, 0, -0.3)))).toEqual({ art: "raum", id: "r1" });

    const nordwand = modell.waende.find((w) => w.start.y === 4000 && w.ende.y === 4000)!;
    expect(szene.auswahlBei(...ndc(szene, new Vector3(0, 2.5, -2)))).toEqual({ art: "wand", id: nordwand.id });

    szene.standardansicht();
    // Türmitte: s = 2000 … 3000 → x = 0, Höhe 1 m, Südwand z = +2
    expect(szene.auswahlBei(...ndc(szene, new Vector3(0, 1, 2)))).toEqual({ art: "oeffnung", id: "tuer" });
  });

  it("außerhalb des Plans ist nichts ausgewählt", () => {
    const { szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    szene.draufsicht();
    expect(szene.auswahlBei(0.99, 0.99)).toBeNull();
  });

  it("hebt die Auswahl hervor und stellt sie wieder zurück", () => {
    const { test, szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    test.bild();
    const boden = meshMit(test.letzteSzene(), { art: "raum", id: "r1" })!;
    const normal = boden.material as Material;
    szene.setzeAuswahl({ art: "raum", id: "r1" });
    test.bild();
    expect(boden.material).not.toBe(normal);
    szene.setzeAuswahl(null);
    expect(boden.material).toBe(normal);
  });

  it("bleibt bei kompatiblem Update erhalten und verschwindet mit dem Objekt", () => {
    const { test, szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    szene.setzeAuswahl({ art: "oeffnung", id: "tuer" });
    szene.setzePlan(einRaum(), { einpassen: false });
    expect(szene.aktuelleAuswahl()).toEqual({ art: "oeffnung", id: "tuer" });
    test.bild();
    const tuer = meshMit(test.letzteSzene(), { art: "oeffnung", id: "tuer" })!;
    expect((tuer.material as Material & { opacity: number }).opacity).toBeGreaterThan(0);

    szene.setzePlan(szenenmodellAus(plan([rechteck("r1", "Wohnen", [0, 0], [5000, 4000])])), { einpassen: false });
    expect(szene.aktuelleAuswahl()).toBeNull();
  });

  it("ein Klick wählt aus, ein Ziehen nicht", () => {
    const { test, szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    szene.draufsicht();
    vi.spyOn(test.canvas, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    });
    const [nx, ny] = ndc(szene, new Vector3(0.3, 0, -0.3));
    const px = { clientX: ((nx + 1) / 2) * 800, clientY: ((1 - ny) / 2) * 600 };
    const zeiger = (typ: string, x: number, y: number) =>
      test.canvas.dispatchEvent(new MouseEvent(typ, { button: 0, clientX: x, clientY: y }));

    zeiger("pointerdown", px.clientX, px.clientY);
    zeiger("pointerup", px.clientX + 2, px.clientY);
    expect(rueckmeldung.auswahl).toHaveBeenLastCalledWith({ art: "raum", id: "r1" });

    rueckmeldung.auswahl.mockClear();
    zeiger("pointerdown", px.clientX, px.clientY);
    zeiger("pointerup", px.clientX + 40, px.clientY);
    expect(rueckmeldung.auswahl).not.toHaveBeenCalled();
  });
});

describe("Pause, Kontextverlust und Entsorgen", () => {
  it("pausiert ohne Bildanforderung und setzt fort", () => {
    const { test, szene } = erzeugen();
    test.bild();
    szene.pausieren();
    szene.setzeAuswahl(null);
    test.controls.bewegen();
    expect(test.offeneBilder).toBe(0);
    szene.fortsetzen();
    expect(test.offeneBilder).toBe(1);
  });

  it("pausiert, solange das Dokument verborgen ist", () => {
    const { test, szene } = erzeugen();
    const sichtbarkeit = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(szene.statistik().pausiert).toBe(true);
    expect(test.offeneBilder).toBe(0);
    sichtbarkeit.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(szene.statistik().pausiert).toBe(false);
    expect(test.offeneBilder).toBe(1);
  });

  it("meldet einen Kontextverlust und rendert danach nicht mehr", () => {
    const { test } = erzeugen();
    const ereignis = new Event("webglcontextlost", { cancelable: true });
    test.canvas.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
    expect(rueckmeldung.kontextVerloren).toHaveBeenCalledTimes(1);
    expect(test.offeneBilder).toBe(0);
    test.controls.bewegen();
    expect(test.offeneBilder).toBe(0);
  });

  it("entsorgt alles, was es angelegt hat", () => {
    const geometrien = vi.spyOn(BufferGeometry.prototype, "dispose");
    const materialien = vi.spyOn(MaterialKlasse.prototype, "dispose");
    const { test, szene } = erzeugen();
    szene.setzePlan(szenenmodellAus(einfamilienhaus()), { einpassen: true });
    const { planGeometrien, materialien: anzahlMaterialien } = szene.statistik();
    test.controls.bewegen(5);
    expect(test.offeneBilder).toBe(1);

    szene.entsorgen();

    expect(test.offeneBilder).toBe(0);
    expect(behaelter.querySelector("canvas")).toBeNull();
    expect(test.beobachtung.aktiv).toBe(false);
    expect(test.controls.zuhoerer.size).toBe(0);
    expect(test.controls.tastenAn).toBeNull();
    expect(test.controls.dispose).toHaveBeenCalledTimes(1);
    expect(test.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(test.renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    // Plangeometrien + Raster
    expect(geometrien.mock.calls.length).toBe(planGeometrien + 1);
    // Szenenmaterialien + Rastermaterial
    expect(materialien.mock.calls.length).toBe(anzahlMaterialien + 1);
    expect(szene.statistik()).toMatchObject({ planGeometrien: 0, auswaehlbar: 0, raster: 0, entsorgt: true });

    // Nichts reagiert mehr: kein Listener, kein Bild, kein zweites Entsorgen.
    test.canvas.dispatchEvent(new MouseEvent("pointerdown", { button: 0 }));
    test.canvas.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
    document.dispatchEvent(new Event("visibilitychange"));
    szene.setzePlan(einRaum(), { einpassen: true });
    szene.setzeAuswahl({ art: "raum", id: "r1" });
    test.groesse(300, 300);
    expect(test.offeneBilder).toBe(0);
    expect(rueckmeldung.auswahl).not.toHaveBeenCalled();
    szene.entsorgen();
    expect(test.renderer.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("Theme (Phase 4c.2)", () => {
  /** Alle Materialfarben der zuletzt gerenderten Szene als Hex. */
  function materialfarben(wurzel: Object3D | undefined): Set<string> {
    const farben = new Set<string>();
    wurzel?.traverse((o) => {
      const roh = (o as Mesh).material as Material | Material[] | undefined;
      for (const material of Array.isArray(roh) ? roh : roh === undefined ? [] : [roh]) {
        const farbe = (material as Material & { color?: unknown }).color;
        if (farbe instanceof Color) farben.add(`#${farbe.getHexString()}`);
      }
    });
    return farben;
  }

  it("übernimmt die Theme-Farben beim Start", () => {
    const { test } = erzeugen();
    expect(test.renderer.setClearColor).toHaveBeenCalledWith(new Color(STANDARD_SZENENFARBEN.hintergrund), 1);
    expect(test.farbbeobachter).toBe(1);
  });

  it("ändert bei einem Theme-Wechsel nur Farben - keine neue Szene, kein neuer Canvas, ein Bild", () => {
    const geometrien = vi.spyOn(BufferGeometry.prototype, "dispose");
    const { test, szene } = erzeugen();
    szene.setzePlan(einRaum(), { einpassen: true });
    test.bild();
    const vorher = szene.statistik();
    const rendererAufrufe = test.rendererErzeugen.mock.calls.length;

    test.farbwechsel({ hintergrund: "#1d232b", wandAussen: "#123456", raster: "#4a5663", rasterFein: "#2f3842" });

    expect(test.renderer.setClearColor).toHaveBeenLastCalledWith(new Color("#1d232b"), 1);
    expect(test.offeneBilder).toBe(1);
    test.bild();
    expect(materialfarben(test.letzteSzene())).toContain("#123456");
    expect(test.rendererErzeugen.mock.calls.length).toBe(rendererAufrufe);
    expect(behaelter.querySelectorAll("canvas")).toHaveLength(1);
    // Plangeometrien und Materialien bleiben; nur das Raster wird ersetzt.
    expect(szene.statistik()).toMatchObject({
      planGeometrien: vorher.planGeometrien,
      materialien: vorher.materialien,
      raster: 1,
    });
    expect(geometrien).toHaveBeenCalledTimes(1);
  });

  it("wächst bei vielen Theme-Wechseln nicht und fordert je Frame nur ein Bild an", () => {
    const { test, szene } = erzeugen();
    szene.setzePlan(szenenmodellAus(einfamilienhaus()), { einpassen: true });
    test.bild();
    const vorher = szene.statistik();
    for (let i = 0; i < 20; i += 1) {
      test.farbwechsel({ hintergrund: i % 2 === 0 ? "#1d232b" : "#f4f6f8", raster: i % 2 === 0 ? "#4a5663" : "#b8c1cb" });
    }
    expect(test.offeneBilder).toBe(1);
    expect(szene.statistik()).toMatchObject({
      planGeometrien: vorher.planGeometrien,
      materialien: vorher.materialien,
      raster: 1,
    });
    expect(behaelter.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("meldet sich beim Entsorgen vom Theme ab", () => {
    const { test, szene } = erzeugen();
    szene.entsorgen();
    expect(test.farbbeobachter).toBe(0);
    test.farbwechsel({ hintergrund: "#000000" });
    expect(test.offeneBilder).toBe(0);
  });
});
