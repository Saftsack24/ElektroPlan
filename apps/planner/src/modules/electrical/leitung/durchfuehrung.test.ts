import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SCHLUESSEL_MAX, istNeu, neuerSchluessel } from "./durchfuehrung";

/** Schlüssel neuer Durchführungen (6b.5): eindeutig erkennbar und vom Server angenommen. */
describe("Schlüssel neuer Durchführungen", () => {
  it("passt in das Feld `key` des Servers und ist von Server-IDs unterscheidbar", () => {
    const hier = dirname(fileURLToPath(import.meta.url));
    const spec = JSON.parse(readFileSync(resolve(hier, "../../../../../backend/openapi.json"), "utf-8")) as {
      components: { schemas: { NewPenetrationIn: { properties: { key: { maxLength: number } } } } };
    };
    expect(SCHLUESSEL_MAX).toBe(spec.components.schemas.NewPenetrationIn.properties.key.maxLength);
    const a = neuerSchluessel();
    const b = neuerSchluessel();
    expect(a.length).toBeLessThanOrEqual(SCHLUESSEL_MAX);
    expect(a).not.toBe(b);
    expect(istNeu(a)).toBe(true);
    expect(istNeu(crypto.randomUUID())).toBe(false);
  });
});
