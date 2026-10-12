import { ApiError } from "@elektroplan/api-client";

/** Texte der Stromkreisverwaltung (Phase 6b.1) - keine technischen Codes oder IDs. */

export const VORSCHLAG_HINWEIS =
  "Vorschläge für neue Leitungen – keine Vorgabe für bereits geplante Leitungen. ElektroPlan prüft und dimensioniert nichts; Leitungstyp, Querschnitt und Schutzorgan verantwortet die Elektrofachkraft.";

export const ZUORDNUNG_MELDUNG =
  "In der Stromkreisverwaltung gibt es eine ungespeicherte Gerätezuordnung. Wenn Sie fortfahren, geht sie verloren.";

/** Deutsche Texte zu den Fehlercodes des Servers (Felder und Konflikte). */
const CODE_TEXT: Record<string, string> = {
  "board-code-taken": "Dieser Code ist in diesem Gebäude bereits vergeben.",
  "board-placement-taken": "Dieses Gerät ist bereits die Lage einer anderen Verteilung.",
  "board-placement-not-in-building": "Dieses Gerät liegt nicht in diesem Gebäude. Bitte neu laden.",
  "board-placement-wrong-type": "Als Lage einer Verteilung ist nur ein Gerät „Verteilung“ möglich.",
  "board-has-circuits": "An dieser Verteilung hängen noch Stromkreise. Bitte zuerst die Stromkreise entfernen.",
  "circuit-designation-taken": "Diese Bezeichnung gibt es an dieser Verteilung bereits.",
  "circuit-device-not-assignable":
    "Nur Steckdosen, Schalter, Leuchten und Abzweigdosen lassen sich zuordnen – keine Datendosen und nicht die Lage einer Verteilung.",
  "circuit-device-not-in-building": "Ein Gerät gehört nicht (mehr) zu diesem Gebäude. Bitte neu laden.",
  "circuit-device-duplicate": "Ein Gerät ist doppelt gewählt.",
  "device-assigned-elsewhere":
    "Mindestens ein Gerät ist inzwischen einem anderen Stromkreis zugeordnet. Es wird nicht still umgehängt – bitte neu laden.",
};

export function codeText(code: string): string | undefined {
  return CODE_TEXT[code];
}

/** Verständliche Meldung zu einem Fehler; bekannte Codes vor der Servermeldung. */
export function fehlermeldung(error: unknown, rueckfall: string): string {
  if (!(error instanceof ApiError)) return rueckfall;
  for (const eintrag of error.problem?.errors ?? []) {
    const text = CODE_TEXT[eintrag.code];
    if (text !== undefined) return text;
  }
  if (error.errorType === "version-conflict") {
    return "Die Daten wurden inzwischen an anderer Stelle geändert. Bitte neu laden – es wird nichts automatisch überschrieben.";
  }
  if (error.errorType === "project-archived" || error.errorType === "project-completed") {
    return "Das Projekt ist schreibgeschützt (abgeschlossen oder archiviert).";
  }
  return error.userMessage;
}

/** Feldfehler je Formularfeld aus den Fehlercodes. */
export function feldfehler<F extends string>(error: unknown, felder: readonly F[]): Partial<Record<F, string>> {
  const ergebnis: Partial<Record<F, string>> = {};
  if (!(error instanceof ApiError)) return ergebnis;
  for (const eintrag of error.problem?.errors ?? []) {
    const feld = eintrag.field as F;
    if (felder.includes(feld)) ergebnis[feld] = CODE_TEXT[eintrag.code] ?? "Bitte diese Angabe prüfen.";
  }
  return ergebnis;
}
