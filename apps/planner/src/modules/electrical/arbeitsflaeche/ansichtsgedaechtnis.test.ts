import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { deckenSchluessel, useAnsichtsgedaechtnis, wandSchluessel } from "./ansichtsgedaechtnis";

/** Viewport je besuchter Fläche (Phase 6c, L1): begrenzt, zuletzt benutzt bleibt. */
describe("Ansichtsgedächtnis", () => {
  const ansicht = (massstab: number) => ({ viewport: { massstab, ursprungX: 1, ursprungY: 2 }, groesse: { breite: 800, hoehe: 400 } });

  it("merkt je Fläche und Seite getrennt", () => {
    const { result } = renderHook(() => useAnsichtsgedaechtnis());
    result.current.merken(wandSchluessel("w1", "innen"), ansicht(0.1));
    result.current.merken(wandSchluessel("w1", "aussen"), ansicht(0.2));
    result.current.merken(deckenSchluessel("r1"), ansicht(0.3));
    expect(result.current.lesen(wandSchluessel("w1", "innen"))?.viewport.massstab).toBe(0.1);
    expect(result.current.lesen(wandSchluessel("w1", "aussen"))?.viewport.massstab).toBe(0.2);
    expect(result.current.lesen(deckenSchluessel("r1"))?.viewport.massstab).toBe(0.3);
    expect(result.current.lesen(wandSchluessel("w2", "innen"))).toBeNull();
  });

  it("ist begrenzt: die am längsten nicht benutzte Fläche fällt heraus", () => {
    const { result } = renderHook(() => useAnsichtsgedaechtnis(3));
    for (const id of ["a", "b", "c"]) result.current.merken(id, ansicht(1));
    result.current.merken("a", ansicht(2)); // „a“ zuletzt benutzt
    result.current.merken("d", ansicht(1)); // verdrängt „b“
    expect(result.current.lesen("b")).toBeNull();
    expect(result.current.lesen("a")?.viewport.massstab).toBe(2);
    expect(result.current.lesen("c")).not.toBeNull();
    expect(result.current.lesen("d")).not.toBeNull();
  });
});
