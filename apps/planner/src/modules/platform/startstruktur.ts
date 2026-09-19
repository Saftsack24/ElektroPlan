/**
 * Startstruktur eines neuen Projekts: ein Gebäude und ein Erdgeschoss.
 *
 * Bewusst **nicht atomar** — der Ablauf nutzt die drei vorhandenen Endpunkte
 * nacheinander (docs/api.md, Abschnitt „Startstruktur bei der Projektanlage“).
 * Damit gibt es zwei Fehlerstufen, und beide müssen unterschiedlich gemeldet
 * werden:
 *
 * * Scheitert schon das **Gebäude**, fehlt beides.
 * * Scheitert nur das **Geschoss**, existiert das Gebäude bereits. Wird das
 *   nicht deutlich gesagt, legt der Benutzer ein zweites Hauptgebäude an —
 *   und hat dann eine Dublette, die niemand wollte.
 *
 * Die Funktion kennt keine API: Sie bekommt die beiden Aufrufe übergeben und
 * ist damit ohne Netzwerk prüfbar.
 */

/** Ebene und lichte Höhe des Startgeschosses in Millimetern (ADR 0007). */
export const START_EBENE = 0;
export const START_HOEHE_MM = 2_500;

export interface StrukturErgebnis {
  /** Satz für die Meldung an den Benutzer, schließt an die Projektmeldung an. */
  meldung: string;
  /** Wurde alles angelegt? Steuert Erfolgs- oder Warnhinweis und die Navigation. */
  vollstaendig: boolean;
  /** Welche Stufe erreicht wurde — für Tests und spätere Auswertung. */
  stufe: "vollstaendig" | "gebaeude-fehlt" | "geschoss-fehlt";
}

export async function startstrukturAnlegen({
  gebaeudename,
  geschossname,
  gebaeudeAnlegen,
  geschossAnlegen,
}: {
  gebaeudename: string;
  geschossname: string;
  gebaeudeAnlegen: () => Promise<{ id: string; name: string }>;
  geschossAnlegen: (gebaeudeId: string) => Promise<unknown>;
}): Promise<StrukturErgebnis> {
  let gebaeude: { id: string; name: string };
  try {
    gebaeude = await gebaeudeAnlegen();
  } catch {
    return {
      stufe: "gebaeude-fehlt",
      vollstaendig: false,
      meldung:
        `Weder das Gebäude „${gebaeudename}“ noch das Geschoss „${geschossname}“ ` +
        `konnten angelegt werden — bitte beides im Projekt unter ` +
        `„Gebäude & Geschosse“ ergänzen.`,
    };
  }

  try {
    await geschossAnlegen(gebaeude.id);
  } catch {
    // Der Name kommt aus der Antwort, nicht aus der Eingabe: Er ist das, was
    // wirklich in der Datenbank steht.
    return {
      stufe: "geschoss-fehlt",
      vollstaendig: false,
      meldung:
        `Das Gebäude „${gebaeude.name}“ wurde bereits angelegt — nur das Geschoss ` +
        `„${geschossname}“ fehlt noch. Bitte im Projekt unter „Gebäude & Geschosse“ ` +
        `ausschließlich das Geschoss ergänzen, kein zweites Gebäude.`,
    };
  }

  return {
    stufe: "vollstaendig",
    vollstaendig: true,
    meldung: `Gebäude „${gebaeude.name}“ und Geschoss „${geschossname}“ wurden mit angelegt.`,
  };
}

/** Nur zur Vollständigkeit des Aufrufs — hält den Namen an einer Stelle. */
export const STANDARD_GEBAEUDE = "Hauptgebäude";
export const STANDARD_GESCHOSS = "Erdgeschoss";

export function standardStruktur(): { gebaeudename: string; geschossname: string } {
  return { gebaeudename: STANDARD_GEBAEUDE, geschossname: STANDARD_GESCHOSS };
}
