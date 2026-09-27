import { ApiError } from "@elektroplan/api-client";

import type { MarkenArt } from "../../../core/ui/Marke";

/**
 * Begriffe der Benutzerverwaltung in der Sprache eines Handwerksbetriebs.
 *
 * „Gesperrt" meint immer den Zugang zu **diesem** Betrieb - das Konto der
 * Person bleibt bestehen (ADR 0015).
 */
export type Verzeichnisstatus = "active" | "disabled" | "invited";

export const STATUS_TEXT: Record<Verzeichnisstatus, string> = {
  active: "Aktiv",
  disabled: "Zugang gesperrt",
  invited: "Eingeladen",
};

export const STATUS_ART: Record<Verzeichnisstatus, MarkenArt> = {
  active: "erfolg",
  disabled: "gefahr",
  invited: "info",
};

export const STATUSFILTER: { wert: Verzeichnisstatus | ""; text: string }[] = [
  { wert: "", text: "Alle" },
  { wert: "active", text: "Aktiv" },
  { wert: "disabled", text: "Zugang gesperrt" },
  { wert: "invited", text: "Eingeladen" },
];

export function istVerzeichnisstatus(wert: string | null): wert is Verzeichnisstatus {
  return wert === "active" || wert === "disabled" || wert === "invited";
}

export function datum(wert: string | null | undefined): string {
  return wert ? new Date(wert).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

/**
 * Fachliche Konflikte der Verwaltung in verständlichen Sätzen.
 *
 * Der Server liefert einen stabilen `type`; nur darauf wird verzweigt, nicht
 * auf den Meldungstext.
 */
export function verwaltungsfehler(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Die Anfrage konnte nicht gesendet werden. Bitte erneut versuchen.";
  }
  switch (error.errorType) {
    case "last-administrator":
      return "Der Betrieb braucht mindestens einen aktiven Administrator. Geben Sie zuerst einem anderen Mitglied die Administratorrolle.";
    case "self-lockout":
      return "Den eigenen Zugang und die eigene Administratorrolle kann hier niemand selbst entfernen. Bitte einen anderen Administrator darum bitten.";
    case "version-conflict":
      return "Jemand hat diesen Eintrag inzwischen geändert. Die Ansicht wurde neu geladen - bitte die Änderung prüfen und wiederholen.";
    case "invitation-delivery-unavailable":
      return "Für Einladungen ist noch kein Zustellweg eingerichtet. Es wurde keine Einladung angelegt.";
    case "permission-denied":
      return "Dafür fehlt Ihnen die Berechtigung.";
    case "not-found":
      return "Der Eintrag existiert nicht mehr.";
    default:
      return error.userMessage;
  }
}
