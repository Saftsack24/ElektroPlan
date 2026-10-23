import { useEffect, useState } from "react";

/** Ab dieser Breite stehen Zeichenfläche und Eigenschaften nebeneinander (Token `--breakpoint-split`). */
export const BREIT = "(min-width: 60rem)";

/** Breites Fenster? Ohne `matchMedia` (etwa in Tests) gilt die breite Darstellung. */
export function istBreit(): boolean {
  return typeof window.matchMedia !== "function" || window.matchMedia(BREIT).matches;
}

/**
 * Kompakte Darstellung der Arbeitsfläche (L1, Entwurf §18.2 „Schmal“): unter 60 rem
 * stehen die Werkzeuge überwiegend als Symbolknöpfe da, Gruppen wie Raum und Öffnung
 * als Menü, Pfad und Kopf gekürzt. Folgt Größenänderungen des Fensters; nur Ansicht.
 */
export function useKompakt(): boolean {
  const [kompakt, setKompakt] = useState(() => !istBreit());
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const medien = window.matchMedia(BREIT);
    const folgen = () => setKompakt(!medien.matches);
    folgen();
    medien.addEventListener("change", folgen);
    return () => medien.removeEventListener("change", folgen);
  }, []);
  return kompakt;
}

/**
 * Inhalt eines Knopfs, der schmal einen kurzen sichtbaren Text trägt („Speichern“ statt
 * „Leitung speichern“). Der volle Name bleibt als zugänglicher Name erhalten.
 */
export function knopftext(kompakt: boolean, voll: string, knapp: string): { "aria-label"?: string; children: string } {
  return kompakt ? { "aria-label": voll, children: knapp } : { children: voll };
}
