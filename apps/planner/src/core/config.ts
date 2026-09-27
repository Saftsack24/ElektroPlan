/** Laufzeitkonfiguration des Planners. */
export const config = {
  apiBaseUrl: (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "http://localhost:8000",
  /**
   * Entwicklungsfunktionen der Oberfläche - etwa die Anzeige eines
   * Einladungslinks. Nur im Vite-Entwicklungsmodus; ein Produktionsbuild
   * zeigt sie nie, selbst wenn ein falsch konfigurierter Server einen Link
   * mitschickte. Der Server lehnt den Entwicklungslink in Produktion
   * seinerseits ab (docs/security.md, Abschnitt 18).
   */
  entwicklungsfunktionen: import.meta.env.DEV,
} as const;
