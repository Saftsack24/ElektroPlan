import type { ReactNode } from "react";

export type MarkenArt = "neutral" | "erfolg" | "warnung" | "gefahr" | "info";

/**
 * Kleine Statusmarke, etwa „Aktiv" oder „Eingeladen".
 *
 * Die Farbe ergänzt nur: Der Text trägt die Aussage allein, damit sie auch
 * ohne Farbwahrnehmung verständlich bleibt.
 */
export function Marke({ art = "neutral", children }: { art?: MarkenArt; children: ReactNode }) {
  return <span className={`marke marke--${art}`}>{children}</span>;
}
