/**
 * Test-Doubles für die Grenzen der Szenenschicht - kein WebGL, kein Browser.
 * Renderer, Controls, Bildtakt und Größenbeobachtung werden aufgezeichnet;
 * alles andere ist echtes Three.js.
 */
import type { Object3D, PerspectiveCamera } from "three";
import { Vector3 } from "three";
import { vi } from "vitest";

import type { ControlsPort, RendererPort, Szenenfarben, Umgebung } from "./szene";
import { STANDARD_SZENENFARBEN } from "./szene";

export class TestControls implements ControlsPort {
  readonly target = new Vector3();
  enableDamping = false;
  dampingFactor = 0;
  minDistance = 0;
  maxDistance = Infinity;
  maxPolarAngle = Math.PI;
  screenSpacePanning = false;
  /** So viele weitere `update()`-Aufrufe melden noch Bewegung (Dämpfung). */
  nachlauf = 0;
  readonly zuhoerer = new Set<() => void>();
  tastenAn: HTMLElement | null = null;
  readonly dispose = vi.fn();
  readonly update = vi.fn(() => {
    if (this.nachlauf <= 0) return false;
    this.nachlauf -= 1;
    return true;
  });

  constructor(readonly kamera: PerspectiveCamera) {}

  listenToKeyEvents(element: HTMLElement) {
    this.tastenAn = element;
  }
  stopListenToKeyEvents() {
    this.tastenAn = null;
  }
  addEventListener(_typ: "change", listener: () => void) {
    this.zuhoerer.add(listener);
  }
  removeEventListener(_typ: "change", listener: () => void) {
    this.zuhoerer.delete(listener);
  }
  /** Simuliert eine Benutzerbewegung. */
  bewegen(nachlauf = 0) {
    this.nachlauf = nachlauf;
    for (const z of this.zuhoerer) z();
  }
}

export function testumgebung(optionen: { webgl?: boolean; groesse?: [number, number] } = {}) {
  const bilder = new Map<number, () => void>();
  let naechsteId = 1;
  let groesseMelden: ((b: number, h: number) => void) | null = null;
  const farben: { aktuell: Szenenfarben } = { aktuell: STANDARD_SZENENFARBEN };
  const farbhoerer = new Set<() => void>();
  const beobachtung = { aktiv: false };
  const canvas = document.createElement("canvas");
  const renderer = {
    domElement: canvas,
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setClearColor: vi.fn(),
    render: vi.fn<(szene: Object3D, kamera: PerspectiveCamera) => void>(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  } satisfies RendererPort;
  let controls: TestControls | null = null;

  const rendererErzeugen = vi.fn(() => {
    if (optionen.webgl === false) throw new Error("Error creating WebGL context.");
    return renderer;
  });
  const controlsErzeugen = vi.fn((kamera: PerspectiveCamera) => {
    controls = new TestControls(kamera);
    return controls;
  });
  const umgebung: Umgebung = {
    rendererErzeugen,
    controlsErzeugen,
    bildAnfordern: vi.fn((rueckruf: () => void) => {
      const id = naechsteId;
      naechsteId += 1;
      bilder.set(id, rueckruf);
      return id;
    }),
    bildAbbrechen: vi.fn((id: number) => {
      bilder.delete(id);
    }),
    groesseBeobachten: vi.fn((_element: HTMLElement, rueckruf: (b: number, h: number) => void) => {
      groesseMelden = rueckruf;
      beobachtung.aktiv = true;
      const [b, h] = optionen.groesse ?? [800, 600];
      rueckruf(b, h);
      return () => {
        beobachtung.aktiv = false;
        groesseMelden = null;
      };
    }),
    pixelRatio: () => 3,
    farben: vi.fn(() => farben.aktuell),
    farbwechselBeobachten: vi.fn((rueckruf: () => void) => {
      farbhoerer.add(rueckruf);
      return () => {
        farbhoerer.delete(rueckruf);
      };
    }),
    dokument: document,
  };

  return {
    umgebung,
    /** Simuliert einen Theme-Wechsel: neue Farben, dann Meldung wie im Browser. */
    farbwechsel(neu: Partial<Szenenfarben>) {
      farben.aktuell = { ...farben.aktuell, ...neu };
      for (const h of [...farbhoerer]) h();
    },
    /** Anzahl angemeldeter Farbwechsel-Beobachter. */
    get farbbeobachter() {
      return farbhoerer.size;
    },
    rendererErzeugen,
    controlsErzeugen,
    renderer,
    canvas,
    beobachtung,
    get controls(): TestControls {
      if (controls === null) throw new Error("Controls noch nicht erzeugt");
      return controls;
    },
    /** Offene Bildanforderungen. */
    get offeneBilder() {
      return bilder.size;
    },
    /** Führt alle angeforderten Bilder aus (ein „Frame"). */
    bild() {
      const jetzt = [...bilder.values()];
      bilder.clear();
      for (const b of jetzt) b();
    },
    groesse(b: number, h: number) {
      groesseMelden?.(b, h);
    },
    /** Zuletzt gerenderte Szene. */
    letzteSzene(): Object3D | undefined {
      return renderer.render.mock.calls.at(-1)?.[0];
    },
  };
}
