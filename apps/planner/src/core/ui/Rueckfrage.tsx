import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Dialog } from "./Dialog";
import { gibtUngespeicherteAenderungen, ungespeichertMeldung } from "./ungespeichert";

export type Rueckfrageantwort = "bestaetigt" | "alternative" | "abgebrochen";

export interface Rueckfrageoptionen {
  titel: string;
  text: ReactNode;
  /** Die folgenreiche Aktion, etwa „Änderungen verwerfen und fortfahren". */
  bestaetigenLabel: string;
  /** Die sichere Wahl - sie hat den Anfangsfokus und entspricht Escape. */
  abbrechenLabel?: string;
  /** Optionale dritte Wahl, etwa „Speichern und wechseln". */
  alternativeLabel?: string;
  gefaehrlich?: boolean;
}

type Fragen = (optionen: Rueckfrageoptionen) => Promise<Rueckfrageantwort>;

const RueckfrageKontext = createContext<Fragen | null>(null);

/**
 * Zentrale, eigene Rückfrage statt `window.confirm` - einmal in der
 * Anwendung eingehängt, von überall per {@link useRueckfrage} erreichbar.
 *
 * * **Eine Rückfrage zur Zeit.** Kommt eine zweite, während die erste offen
 *   ist (zwei Navigationsversuche kurz nacheinander), wird sie sofort als
 *   „abgebrochen" beantwortet - die bestätigte Aktion läuft nie doppelt.
 * * **Jede Antwort genau einmal.** Das Versprechen wird genau einmal
 *   aufgelöst; danach ist der Dialog geschlossen.
 * * Anfangsfokus auf der sicheren Wahl, Escape und Backdrop entsprechen
 *   „Abbrechen", Fokusfalle und Fokus-Rückgabe liefert {@link Dialog}.
 *
 * `beforeunload` (Neuladen, Tab schließen) bleibt browsernativ: Dort lassen
 * Browser keinen eigenen Dialog zu.
 */
export function RueckfrageProvider({ children }: { children: ReactNode }) {
  const [offen, setOffen] = useState<Rueckfrageoptionen | null>(null);
  const aufloesen = useRef<((antwort: Rueckfrageantwort) => void) | null>(null);

  const fragen = useCallback<Fragen>((optionen) => {
    if (aufloesen.current !== null) return Promise.resolve("abgebrochen");
    return new Promise<Rueckfrageantwort>((resolve) => {
      aufloesen.current = resolve;
      setOffen(optionen);
    });
  }, []);

  const antworten = (antwort: Rueckfrageantwort) => {
    const resolve = aufloesen.current;
    if (resolve === null) return;
    aufloesen.current = null;
    setOffen(null);
    resolve(antwort);
  };

  return (
    <RueckfrageKontext.Provider value={fragen}>
      {children}
      {offen !== null && (
        <Dialog offen titel={offen.titel} onClose={() => antworten("abgebrochen")}>
          <div className="bestaetigung">
            <div className="bestaetigung__text">{offen.text}</div>
            <div className="button-row dialog__aktionen">
              <button
                type="button"
                className={offen.gefaehrlich === false ? "button button--primary" : "button button--gefahr"}
                onClick={() => antworten("bestaetigt")}
              >
                {offen.bestaetigenLabel}
              </button>
              {offen.alternativeLabel !== undefined && (
                <button type="button" className="button button--primary" onClick={() => antworten("alternative")}>
                  {offen.alternativeLabel}
                </button>
              )}
              <button
                type="button"
                className="button button--ghost"
                data-autofocus
                onClick={() => antworten("abgebrochen")}
              >
                {offen.abbrechenLabel ?? "Abbrechen"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </RueckfrageKontext.Provider>
  );
}

export function useRueckfrage(): Fragen {
  const fragen = useContext(RueckfrageKontext);
  if (fragen === null) {
    throw new Error("useRueckfrage braucht einen RueckfrageProvider oberhalb der Komponente.");
  }
  return fragen;
}

export const VERWERFEN_LABEL = "Änderungen verwerfen und fortfahren";
export const BEHALTEN_LABEL = "Änderungen behalten";

/** Rückfrage vor dem Verwerfen ungespeicherter Änderungen. */
export function verwerfenOptionen(titel: string, situation: string, meldung?: string): Rueckfrageoptionen {
  return {
    titel,
    text: (
      <>
        <p>{situation}</p>
        <p>{meldung ?? ungespeichertMeldung() ?? "Es gibt ungespeicherte Änderungen."}</p>
      </>
    ),
    bestaetigenLabel: VERWERFEN_LABEL,
    abbrechenLabel: BEHALTEN_LABEL,
  };
}

/**
 * Führt eine Aktion aus, die ungespeicherte Änderungen verwerfen würde -
 * nach Rückfrage, falls irgendwo welche gemeldet sind (`ungespeichert.ts`).
 * Ohne ungespeicherte Änderungen läuft sie sofort. `true`, wenn sie lief.
 */
export function useVerlassenBestaetigen() {
  const fragen = useRueckfrage();
  return useMemo(
    () =>
      async (titel: string, situation: string, aktion: () => void): Promise<boolean> => {
        if (gibtUngespeicherteAenderungen()) {
          const antwort = await fragen(verwerfenOptionen(titel, situation));
          if (antwort !== "bestaetigt") return false;
        }
        aktion();
        return true;
      },
    [fragen],
  );
}
