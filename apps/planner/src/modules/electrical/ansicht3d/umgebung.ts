/**
 * Die echte Browserumgebung der Szene: WebGL-Renderer, OrbitControls,
 * `requestAnimationFrame`, `ResizeObserver`. Die einzige Datei, die
 * `WebGLRenderer` und `OrbitControls` kennt - Tests ersetzen sie vollständig.
 */
import { WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { Umgebung } from "./szene";
import { WebGLNichtVerfuegbar } from "./szene";

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
    dunkel: () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
    dokument: document,
  };
}
