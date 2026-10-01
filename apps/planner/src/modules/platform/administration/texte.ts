import { ApiError } from "@elektroplan/api-client";

import type { MarkenArt } from "../../../core/ui/Marke";

/**
 * Begriffe der Benutzerverwaltung in der Sprache eines Handwerksbetriebs.
 *
 * * **Gesperrt** meint den Zugang zu **diesem** Betrieb; Rollen und Konto
 *   bleiben bestehen, entsperren ist jederzeit möglich (ADR 0015, ADR 0021).
 * * **Entfernt** ist endgültig: ein neutraler Eintrag ohne Name und E-Mail,
 *   nicht wiederherstellbar - die Person kann nur neu eingeladen werden.
 * * **Eingeladen** ist eine offene Einladung, noch keine Mitgliedschaft; sie
 *   wird widerrufen, nicht entfernt.
 */
export type Verzeichnisstatus = "active" | "disabled" | "invited" | "removed";

export const STATUS_TEXT: Record<Verzeichnisstatus, string> = {
  active: "Aktiv",
  disabled: "Gesperrt",
  invited: "Eingeladen",
  removed: "Entfernt",
};

export const STATUS_ART: Record<Verzeichnisstatus, MarkenArt> = {
  active: "erfolg",
  disabled: "gefahr",
  invited: "info",
  removed: "neutral",
};

/** Anzeige eines entfernten Kontos - ohne jeden Bezug zur Person. */
export const ENTFERNTER_BENUTZER = "Entfernter Benutzer";

export const STATUSFILTER: { wert: Verzeichnisstatus | ""; text: string }[] = [
  { wert: "", text: "Alle (ohne Entfernte)" },
  { wert: "active", text: "Aktiv" },
  { wert: "disabled", text: "Gesperrt" },
  { wert: "invited", text: "Einladungen" },
  { wert: "removed", text: "Entfernt" },
];

export function istVerzeichnisstatus(wert: string | null): wert is Verzeichnisstatus {
  return wert === "active" || wert === "disabled" || wert === "invited" || wert === "removed";
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
      return "Das eigene Konto kann niemand selbst sperren oder entfernen und niemand kann sich selbst die Administratorrolle nehmen. Bitte einen anderen Administrator darum bitten.";
    case "member-removed":
      return "Dieses Konto wurde entfernt. Es kann nicht mehr bearbeitet, gesperrt, entsperrt oder wiederhergestellt werden.";
    case "account-shared":
      return "Dieses Konto wird auch in einem anderen Betrieb verwendet. Name, E-Mail-Adresse und Passwort kann deshalb nur die Person selbst ändern.";
    case "email-unavailable":
      return "Diese E-Mail-Adresse ist bereits einem anderen Konto oder einer offenen Einladung zugeordnet. Bitte eine andere Adresse verwenden.";
    case "password-reset-delivery-unavailable":
      return "Für das Zurücksetzen von Passwörtern ist noch kein Zustellweg eingerichtet. Es wurde kein Link erzeugt.";
    case "rate-limited":
      return "Für dieses Konto wurden gerade mehrere Links erzeugt. Bitte etwas später erneut versuchen.";
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
