import { ApiError } from "@elektroplan/api-client";

/**
 * Verständliche Meldung zu einer fehlgeschlagenen Lösch- oder Statusaktion.
 *
 * Fachliche Konflikte (Kunde hat Projekte, Projekt abgeschlossen, Bestätigung
 * fehlt) erklärt der Server selbst - seine Meldung wird übernommen. Für die
 * technischen Fälle steht hier ein Satz, der sagt, was zu tun ist.
 */
export function aktionsfehler(error: unknown, standard: string): string {
  if (!(error instanceof ApiError)) return standard;
  switch (error.status) {
    case 403:
      return "Für diese Aktion fehlt Ihnen die Berechtigung.";
    case 404:
      return "Der Datensatz existiert nicht mehr. Bitte die Liste neu laden.";
    case 428:
      return "Die Anfrage enthielt keinen Bearbeitungsstand. Bitte die Seite neu laden und erneut versuchen.";
    case 409:
      if (error.errorType === "version-conflict") {
        return "Der Datensatz wurde inzwischen von jemand anderem geändert. Bitte neu laden und erneut prüfen.";
      }
      return error.userMessage;
    default:
      return error.status >= 500 ? `${standard} Es wurde nichts verändert.` : error.userMessage;
  }
}
