/**
 * Zeitmessung der 3D-Ansicht über die User-Timing-API des Browsers.
 *
 * Die Messpunkte erscheinen in den Entwicklerwerkzeugen („Performance") und
 * lassen sich über `performance.getEntriesByName(...)` auslesen - dieselben
 * Namen verwendet die dokumentierte Leistungsmessung (ADR 0016). Keine
 * globale Variable, kein Netzverkehr; fehlt die API, wird still nur
 * ausgeführt.
 */
export const MESSUNG = {
  szenenmodell: "elektroplan-3d:szenenmodell",
  geometrie: "elektroplan-3d:geometrie",
  erstesBild: "elektroplan-3d:erstes-bild",
} as const;

export function messen<T>(name: string, arbeit: () => T): T {
  const uhr = typeof performance === "undefined" ? undefined : performance;
  if (uhr === undefined || typeof uhr.measure !== "function") return arbeit();
  const start = uhr.now();
  try {
    return arbeit();
  } finally {
    try {
      // Nur der jüngste Messwert bleibt stehen - kein Anwachsen über die Sitzung.
      uhr.clearMeasures(name);
      uhr.measure(name, { start, end: uhr.now() });
    } catch {
      // Ältere Umgebungen ohne Optionsobjekt - die Messung ist verzichtbar.
    }
  }
}
