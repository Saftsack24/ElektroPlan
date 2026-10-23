import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Arbeitsbereich-Modus der Seite (Phase 6c, L1) – fachneutral.
 *
 * Verwaltungsseiten bleiben in der lesbaren Spalte (1 100 px). Eine Seite, die
 * gerade eine große Arbeitsfläche zeigt (etwa die grafische Planung eines
 * Fachmoduls), meldet das hier an; dann nutzt **die ganze Seite** – Kopf,
 * Reiter und Arbeitsfläche – dieselbe breitere Flucht. So entsteht kein
 * einzelner überbreiter Block unter schmalen Kopfbereichen.
 *
 * Mehrere Anmeldungen werden gezählt; die letzte Abmeldung (Aushängen,
 * Ansichtswechsel) stellt die Spalte wieder her.
 */
interface Arbeitsbereich {
  readonly aktiv: boolean;
  readonly anmelden: () => () => void;
}

const Kontext = createContext<Arbeitsbereich | null>(null);

export function ArbeitsbereichProvider({ children }: { children: ReactNode }) {
  const [anzahl, setAnzahl] = useState(0);
  const anmelden = useCallback(() => {
    setAnzahl((n) => n + 1);
    return () => setAnzahl((n) => n - 1);
  }, []);
  const wert = useMemo(() => ({ aktiv: anzahl > 0, anmelden }), [anzahl, anmelden]);
  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>;
}

/** Diese Ansicht braucht den breiten Arbeitsbereich, solange `aktiv` gilt. Ohne Rahmen wirkungslos. */
export function useArbeitsbereich(aktiv: boolean): void {
  const kontext = useContext(Kontext);
  const anmelden = kontext?.anmelden;
  useEffect(() => (aktiv && anmelden !== undefined ? anmelden() : undefined), [aktiv, anmelden]);
}

/** Zeigt die Seite gerade einen Arbeitsbereich? (etwa für einen kompakten Kopf) */
export function useArbeitsbereichAktiv(): boolean {
  return useContext(Kontext)?.aktiv ?? false;
}
