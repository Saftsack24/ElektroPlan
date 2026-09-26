import { ApiError } from "@elektroplan/api-client";

/**
 * Uebersetzt eine Fehlerantwort in Meldungen fuer das Formular.
 *
 * Die Oberflaeche zeigt **keine** technischen Rohmeldungen. Das Backend
 * liefert nach RFC 9457 eine deutsche ``detail``-Meldung und bei
 * Validierungsfehlern zusaetzlich ``errors`` mit Feldnamen und Code. Die
 * Codes stammen aus Pydantic und sind englisch - sie werden hier auf kurze
 * deutsche Saetze abgebildet, mit einer verstaendlichen Rueckfallmeldung.
 *
 * Liegt seit Phase 3 im Core: Mit der Elektroplanung gibt es einen zweiten
 * Consumer, und ein Modul darf die Dateien eines anderen Moduls nicht
 * importieren (docs/modules.md, Abschnitt 8). Vorher stand die Datei im
 * Plattform-Modul, weil sie nur dort gebraucht wurde.
 */
const CODE_TEXTE: Record<string, string> = {
  missing: "Dieses Feld wird benötigt.",
  string_too_short: "Der Wert ist zu kurz.",
  string_too_long: "Der Wert ist zu lang.",
  value_error: "Der Wert hat nicht das erwartete Format.",
  literal_error: "Dieser Wert ist nicht zulässig.",
  enum: "Dieser Wert ist nicht zulässig.",
  int_parsing: "Bitte eine ganze Zahl angeben.",
  greater_than_equal: "Der Wert ist zu klein.",
  less_than_equal: "Der Wert ist zu groß.",
  extra_forbidden: "Dieses Feld kann hier nicht gesetzt werden.",
};

export function feldtext(code: string): string {
  return CODE_TEXTE[code] ?? "Diese Eingabe ist ungültig.";
}

export function alsFormularfehler<FeldT extends string>(
  error: unknown,
  bekannteFelder: readonly FeldT[],
): { fehler?: string; felder?: Partial<Record<FeldT, string>> } {
  if (!(error instanceof ApiError)) {
    return { fehler: "Die Anfrage konnte nicht gesendet werden. Bitte erneut versuchen." };
  }

  const felder: Partial<Record<FeldT, string>> = {};
  for (const eintrag of error.problem?.errors ?? []) {
    const name = eintrag.field as FeldT;
    if (bekannteFelder.includes(name)) {
      felder[name] = feldtext(eintrag.code);
    }
  }

  if (Object.keys(felder).length > 0) {
    return { felder, fehler: "Bitte die markierten Felder prüfen." };
  }
  return { fehler: error.userMessage };
}
