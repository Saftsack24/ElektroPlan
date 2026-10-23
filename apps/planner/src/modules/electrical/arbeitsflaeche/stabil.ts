import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Stabile Rückruffunktion, die immer die **aktuelle** Fassung aufruft (Phase 6c, L1).
 *
 * Werkzeugleisten werden mit `memo` nur neu gezeichnet, wenn sich ihr sichtbarer Zustand
 * ändert – nicht bei jeder Zeigerbewegung der Zeichenfläche. Dafür brauchen ihre
 * Rückruffunktionen eine feste Identität, ohne veraltete Werte festzuhalten.
 */
export function useStabil<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const aktuell = useRef(fn);
  useLayoutEffect(() => {
    aktuell.current = fn;
  });
  return useCallback((...args: A) => aktuell.current(...args), []);
}
