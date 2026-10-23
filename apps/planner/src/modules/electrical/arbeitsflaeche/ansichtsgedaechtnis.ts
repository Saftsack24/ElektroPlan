import { useMemo, useRef } from "react";

import type { Groesse, Viewport } from "../editor/viewport";

/** Was eine Fläche zum Wiederherstellen braucht: Viewport und die Größe, zu der er gehört. */
export interface GemerkteAnsicht {
  readonly viewport: Viewport;
  readonly groesse: Groesse;
}

export interface Ansichtsgedaechtnis {
  lesen(schluessel: string): GemerkteAnsicht | null;
  merken(schluessel: string, ansicht: GemerkteAnsicht): void;
}

/** Höchstens so viele besuchte Wand- und Deckenflächen werden gemerkt (die zuletzt benutzten). */
export const MAX_GEMERKTE_FLAECHEN = 16;

/**
 * Viewport je besuchter Wand-/Deckenfläche (Phase 6c, L1) – **begrenzt** und ohne
 * eingehängte Flächen: Nur die gerade offene Fläche ist eingehängt; verlassene
 * Flächen hinterlassen hier nur ihren Viewport. Kehrt man zurück, wird er über
 * `groesseAendern` an die aktuelle Größe angepasst (Maßstab und Weltmitte bleiben) –
 * kein Einpassen. Reine Ansicht im Komponentenzustand: mit dem Editor (und damit
 * mit Sitzung, Geschoss oder Gebäude) ist alles fort.
 */
export function useAnsichtsgedaechtnis(max = MAX_GEMERKTE_FLAECHEN): Ansichtsgedaechtnis {
  const speicher = useRef(new Map<string, GemerkteAnsicht>());
  return useMemo(
    () => ({
      lesen: (schluessel) => speicher.current.get(schluessel) ?? null,
      merken: (schluessel, ansicht) => {
        const m = speicher.current;
        // Zuletzt benutzt ans Ende; das älteste fällt bei Überlauf heraus.
        m.delete(schluessel);
        m.set(schluessel, ansicht);
        while (m.size > max) {
          const aeltester = m.keys().next().value;
          if (aeltester === undefined) break;
          m.delete(aeltester);
        }
      },
    }),
    [max],
  );
}

export function wandSchluessel(wandId: string, seite: "innen" | "aussen"): string {
  return `wand:${wandId}:${seite}`;
}

export function deckenSchluessel(raumId: string): string {
  return `decke:${raumId}`;
}
