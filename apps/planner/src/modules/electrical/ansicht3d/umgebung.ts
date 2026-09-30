/**
 * Die echte Browserumgebung der Szene: WebGL-Renderer, OrbitControls,
 * `requestAnimationFrame`, `ResizeObserver`. Die einzige Datei, die
 * `WebGLRenderer` und `OrbitControls` kennt - Tests ersetzen sie vollständig.
 */
import { WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { darstellungAbonnieren } from "../../../core/theme/darstellung";
import type { Szenenfarben, Umgebung } from "./szene";
import { STANDARD_SZENENFARBEN, WebGLNichtVerfuegbar } from "./szene";

/** Szenenfarbe → Token in modules/electrical/darstellung.css. */
const TOKEN: Record<keyof Szenenfarben, string> = {
  hintergrund: "--ep-plan3d-background",
  raster: "--ep-plan3d-grid",
  rasterFein: "--ep-plan3d-grid-fine",
  wandAussen: "--ep-plan3d-wall-exterior",
  wandGemeinsam: "--ep-plan3d-wall-shared",
  krone: "--ep-plan3d-wall-top",
  umriss: "--ep-plan3d-outline",
  glas: "--ep-plan3d-glass",
  auswahl: "--ep-plan3d-selection",
  auswahlKrone: "--ep-plan3d-selection-top",
  bodenAuswahl: "--ep-plan3d-selection-floor",
};

/**
 * Liest die berechneten Token-Werte vom Wurzelelement. Das Theme wirkt dort
 * über `data-theme`/`data-accent`; ein fehlender Wert fällt auf den
 * Standard zurück.
 */
export function szenenfarbenLesen(element: Element = document.documentElement): Szenenfarben {
  const stil = getComputedStyle(element);
  const farben = { ...STANDARD_SZENENFARBEN };
  for (const schluessel of Object.keys(TOKEN) as (keyof Szenenfarben)[]) {
    const wert = stil.getPropertyValue(TOKEN[schluessel]).trim();
    if (wert !== "") farben[schluessel] = wert;
  }
  return farben;
}

/**
 * Prüft vorab, ob der Browser einen WebGL-2-Kontext liefert (Three.js setzt
 * WebGL 2 voraus). So entsteht bei fehlendem WebGL kein Renderer und keine
 * Fehlermeldung von Three.js in der Konsole, sondern gleich der Hinweis.
 */
export function webglVerfuegbar(): boolean {
  try {
    const probe = document.createElement("canvas");
    const kontext = probe.getContext("webgl2");
    if (kontext === null) return false;
    kontext.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function browserUmgebung(): Umgebung {
  return {
    rendererErzeugen: () => {
      if (!webglVerfuegbar()) throw new WebGLNichtVerfuegbar();
      try {
        return new WebGLRenderer({ antialias: true, powerPreference: "default" });
      } catch (fehler) {
        throw new WebGLNichtVerfuegbar(fehler);
      }
    },
    controlsErzeugen: (kamera, zeigerflaeche) => new OrbitControls(kamera, zeigerflaeche),
    bildAnfordern: (rueckruf) => window.requestAnimationFrame(() => rueckruf()),
    bildAbbrechen: (id) => window.cancelAnimationFrame(id),
    groesseBeobachten: (element, rueckruf) => {
      const melden = () => rueckruf(element.clientWidth, element.clientHeight);
      if (typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", melden);
        melden();
        return () => window.removeEventListener("resize", melden);
      }
      const beobachter = new ResizeObserver(melden);
      beobachter.observe(element);
      melden();
      return () => beobachter.disconnect();
    },
    pixelRatio: () => window.devicePixelRatio || 1,
    farben: () => szenenfarbenLesen(),
    // Benachrichtigt erst, nachdem die Wurzelattribute gesetzt sind - die
    // berechneten Werte sind dann schon die neuen.
    farbwechselBeobachten: (rueckruf) => darstellungAbonnieren(rueckruf),
    dokument: document,
  };
}
