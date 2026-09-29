/** Eine Position der Seitennavigation: Seitenzahl oder Auslassung. */
export type Seitenposition = number | "…";

/**
 * Welche Seitenzahlen die Navigation zeigt - reine Funktion.
 *
 * Immer die erste und die letzte Seite, dazu die aktuelle mit `nachbarn`
 * Seiten links und rechts. Lücken werden zu „…" - außer die Lücke umfasst
 * genau eine Seite: Dann steht die Zahl selbst da, denn eine Auslassung für
 * eine einzige Seite spart nichts.
 *
 * `seitenfolge(6, 24)` → `[1, "…", 4, 5, 6, 7, 8, "…", 24]`
 */
export function seitenfolge(aktuell: number, gesamt: number, nachbarn = 2): Seitenposition[] {
  if (gesamt <= 0) return [];
  const seite = Math.min(Math.max(1, aktuell), gesamt);
  const zahlen = new Set<number>([1, gesamt]);
  for (let n = seite - nachbarn; n <= seite + nachbarn; n += 1) {
    if (n >= 1 && n <= gesamt) zahlen.add(n);
  }
  const sortiert = [...zahlen].sort((a, b) => a - b);
  const ergebnis: Seitenposition[] = [];
  let vorige = 0;
  for (const n of sortiert) {
    if (n - vorige === 2) ergebnis.push(n - 1);
    else if (n - vorige > 2) ergebnis.push("…");
    ergebnis.push(n);
    vorige = n;
  }
  return ergebnis;
}
