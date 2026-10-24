import { ApiError } from "@elektroplan/api-client";

/** Verständliche Texte zu den Codes der Vorgaben-API (Phase 6c V1) - vor der Servermeldung. */
const TEXT: Record<string, string> = {
  "cable-template-in-use": "Diese Kabelvorlage wird von Leitungen oder Vorgaben genutzt und lässt sich nicht entfernen – bitte deaktivieren.",
  "cable-template-unknown": "Die gewählte Kabelvorlage ist nicht (mehr) bekannt. Bitte neu laden.",
  "cable-template-inactive": "Eine deaktivierte Kabelvorlage kann nicht neu gewählt werden.",
  "device-type-duplicate": "Ein Gerätetyp ist doppelt zugeordnet.",
  "device-type-unknown": "Ein Gerätetyp ist nicht bekannt.",
  "device-type-not-assignable": "Diesem Gerätetyp lässt sich keine Kabelvorlage zuordnen.",
  "version-conflict": "Die Vorgaben wurden inzwischen an anderer Stelle geändert. Ihre Eingaben sind erhalten und wurden nicht gespeichert.",
  "project-completed": "Das Projekt ist abgeschlossen – Projektvorgaben sind schreibgeschützt.",
  "project-archived": "Das Projekt ist archiviert – Projektvorgaben sind schreibgeschützt.",
  "cable-template-name-taken": "Eine Kabelvorlage mit diesem Namen gibt es bereits.",
};

export function fehlerText(code: string, rueckfall: string): string {
  return TEXT[code] ?? (rueckfall === "" ? "Die Angaben konnten nicht gespeichert werden." : rueckfall);
}

/** Meldung zu einem API-Fehler: Fehlerart, dann bekannte Codes der Einträge, sonst die Servermeldung. */
export function apiFehlerText(error: unknown, rueckfall: string): string {
  if (!(error instanceof ApiError)) return "Der Server ist nicht erreichbar. Ihre Eingaben sind erhalten.";
  const art = TEXT[error.errorType];
  if (art !== undefined) return art;
  for (const e of error.problem?.errors ?? []) {
    const text = TEXT[e.code];
    if (text !== undefined) return text;
  }
  return error.userMessage === "" ? rueckfall : error.userMessage;
}
