import type { ReactNode } from "react";

export type MarkenArt = "neutral" | "erfolg" | "warnung" | "gefahr" | "info";

// Vollständige Klassen je Art: Tailwind erkennt nur statisch ausgeschriebene Namen.
const FARBE: Record<MarkenArt, string> = {
  neutral: "border-line text-muted",
  info: "border-accent text-accent",
  erfolg: "border-success text-success",
  warnung: "border-warning text-warning",
  gefahr: "border-danger text-danger",
};

/**
 * Kleine Statusmarke, etwa „Aktiv" oder „Eingeladen".
 *
 * Die Farbe ergänzt nur: Der Text trägt die Aussage allein, damit sie auch
 * ohne Farbwahrnehmung verständlich bleibt.
 */
export function Marke({ art = "neutral", children }: { art?: MarkenArt; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-px text-[0.8rem] font-semibold whitespace-nowrap ${FARBE[art]}`}
    >
      {children}
    </span>
  );
}
