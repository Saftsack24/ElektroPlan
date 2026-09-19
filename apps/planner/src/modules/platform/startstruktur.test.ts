import { describe, expect, it, vi } from "vitest";

import { startstrukturAnlegen } from "./startstruktur";

const GEBAEUDE = { id: "gebaeude-1", name: "Hauptgebäude" };

function aufrufe({
  gebaeudeFehlt = false,
  geschossFehlt = false,
}: { gebaeudeFehlt?: boolean; geschossFehlt?: boolean } = {}) {
  const gebaeudeAnlegen = vi.fn(() =>
    gebaeudeFehlt ? Promise.reject(new Error("500")) : Promise.resolve(GEBAEUDE),
  );
  const geschossAnlegen = vi.fn(() =>
    geschossFehlt ? Promise.reject(new Error("500")) : Promise.resolve({}),
  );
  return { gebaeudeAnlegen, geschossAnlegen };
}

const anlegen = (
  fehler: { gebaeudeFehlt?: boolean; geschossFehlt?: boolean } = {},
  geschossname = "Erdgeschoss",
) => {
  const { gebaeudeAnlegen, geschossAnlegen } = aufrufe(fehler);
  return {
    gebaeudeAnlegen,
    geschossAnlegen,
    ergebnis: startstrukturAnlegen({
      gebaeudename: "Hauptgebäude",
      geschossname,
      gebaeudeAnlegen,
      geschossAnlegen,
    }),
  };
};

describe("Startstruktur eines neuen Projekts", () => {
  it("legt Gebäude und Geschoss an und nennt beide", async () => {
    const { ergebnis, gebaeudeAnlegen, geschossAnlegen } = anlegen();

    const struktur = await ergebnis;

    expect(struktur.stufe).toBe("vollstaendig");
    expect(struktur.vollstaendig).toBe(true);
    expect(struktur.meldung).toContain("Hauptgebäude");
    expect(struktur.meldung).toContain("Erdgeschoss");
    expect(gebaeudeAnlegen).toHaveBeenCalledTimes(1);
    expect(geschossAnlegen).toHaveBeenCalledWith("gebaeude-1");
  });

  // ------------------------------------------------- Stufe 1: Gebäude fehlt

  it("meldet bei einem Fehlschlag des Gebäudes, dass beides fehlt", async () => {
    const { ergebnis } = anlegen({ gebaeudeFehlt: true });

    const struktur = await ergebnis;

    expect(struktur.stufe).toBe("gebaeude-fehlt");
    expect(struktur.vollstaendig).toBe(false);
    expect(struktur.meldung).toContain("Weder das Gebäude");
    expect(struktur.meldung).toContain("noch das Geschoss");
    expect(struktur.meldung).toContain("beides");
  });

  it("versucht das Geschoss gar nicht erst, wenn das Gebäude fehlschlug", async () => {
    const { ergebnis, geschossAnlegen } = anlegen({ gebaeudeFehlt: true });

    await ergebnis;

    expect(geschossAnlegen).not.toHaveBeenCalled();
  });

  // ------------------------------------------------ Stufe 2: Geschoss fehlt

  it("sagt ausdrücklich, dass das Gebäude bereits existiert", async () => {
    const { ergebnis } = anlegen({ geschossFehlt: true });

    const struktur = await ergebnis;

    expect(struktur.stufe).toBe("geschoss-fehlt");
    expect(struktur.vollstaendig).toBe(false);
    expect(struktur.meldung).toContain("bereits angelegt");
  });

  it("nennt den Namen des bereits angelegten Gebäudes", async () => {
    const { ergebnis } = anlegen({ geschossFehlt: true });

    const struktur = await ergebnis;

    expect(struktur.meldung).toContain("Hauptgebäude");
  });

  it("warnt davor, ein zweites Gebäude anzulegen", async () => {
    // Genau dieser Satz verhindert die Dublette, um die es hier geht.
    const { ergebnis } = anlegen({ geschossFehlt: true });

    const struktur = await ergebnis;

    expect(struktur.meldung).toContain("kein zweites Gebäude");
    expect(struktur.meldung).toContain("nur das Geschoss");
  });

  it("nennt das fehlende Geschoss beim Namen", async () => {
    const { ergebnis } = anlegen({ geschossFehlt: true }, "Untergeschoss");

    const struktur = await ergebnis;

    expect(struktur.meldung).toContain("Untergeschoss");
  });

  it("nimmt den Gebäudenamen aus der Antwort, nicht aus der Eingabe", async () => {
    // Der Server kürzt oder normalisiert den Namen möglicherweise - gemeldet
    // wird, was wirklich in der Datenbank steht.
    const struktur = await startstrukturAnlegen({
      gebaeudename: "  Werkstatt  ",
      geschossname: "Erdgeschoss",
      gebaeudeAnlegen: () => Promise.resolve({ id: "g-2", name: "Werkstatt" }),
      geschossAnlegen: () => Promise.reject(new Error("500")),
    });

    expect(struktur.meldung).toContain("„Werkstatt“");
    expect(struktur.meldung).not.toContain("  Werkstatt  ");
  });

  it("unterscheidet die beiden Fehlerstufen im Wortlaut", async () => {
    const stufe1 = await anlegen({ gebaeudeFehlt: true }).ergebnis;
    const stufe2 = await anlegen({ geschossFehlt: true }).ergebnis;

    expect(stufe1.meldung).not.toBe(stufe2.meldung);
    expect(stufe1.meldung).not.toContain("bereits angelegt");
  });
});
