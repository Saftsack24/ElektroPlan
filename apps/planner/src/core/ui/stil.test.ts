import { describe, expect, it } from "vitest";

import { knopf } from "./stil";
import type { KnopfArt } from "./stil";

/**
 * Gesperrte Knöpfe (L1): eindeutig nicht bedienbar – ohne Füllfarbe, gedämpft, Zeiger
 * „nicht erlaubt“. Hover nur an bedienbaren Knöpfen. Semantik bleibt beim nativen `disabled`.
 */
describe("Knopfstil gesperrt", () => {
  const arten: KnopfArt[] = ["primaer", "neutral", "gewaehlt", "gefahr"];

  it.each(arten)("%s: gesperrt ohne Füllfarbe, gedämpft und mit Zeiger „nicht erlaubt“", (art) => {
    const klassen = knopf(art).split(" ");
    for (const k of ["disabled:cursor-not-allowed", "disabled:bg-transparent", "disabled:text-muted", "disabled:border-line"]) {
      expect(klassen).toContain(k);
    }
    // Kein Lade-Zeiger mehr: „gesperrt“ heißt nicht „lädt gerade“.
    expect(klassen).not.toContain("disabled:cursor-progress");
  });

  it("Hover wirkt nur an bedienbaren Knöpfen", () => {
    const hover = knopf("primaer")
      .split(" ")
      .filter((k) => k.includes("hover:"));
    expect(hover.length).toBeGreaterThan(0);
    expect(hover.every((k) => k.startsWith("enabled:"))).toBe(true);
  });
});
