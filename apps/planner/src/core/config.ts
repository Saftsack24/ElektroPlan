/** Laufzeitkonfiguration des Planners. */
export const config = {
  apiBaseUrl: (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "http://localhost:8000",
} as const;
