import { useEffect } from "react";

/**
 * Meldestelle für ungespeicherte Eingaben - fachneutral.
 *
 * Ein Modul meldet mit {@link useUngespeicherteAenderungen}, dass es gerade
 * ungespeicherte Änderungen hält. Solange das gilt,
 *
 * * hält der {@link Navigationsschutz} (Data-Router-Blocker) jede
 *   Navigation innerhalb der Anwendung an - interne Links, Browser-Zurück und
 *   Browser-Vorwärts - und fragt über die eigene Rückfrage genau einmal nach,
 * * kann jede Stelle, die Inhalte ohne Navigation austauscht (Projekt-Tab,
 *   Abmelden), über `useVerlassenBestaetigen` (`Rueckfrage.tsx`) nachfragen,
 * * zeigt der Browser beim Neuladen, Schließen des Tabs oder Verlassen der
 *   Website **seine eigene** Warnung (`beforeunload`). Das ist die einzige
 *   verbliebene native Rückfrage: Browser lassen dort keinen eigenen Dialog
 *   zu, und der Text ist nicht wählbar.
 *
 * Der Core weiß dabei nicht, **was** ungespeichert ist - nur, dass etwas
 * ungespeichert ist.
 *
 * @see ./Navigationsschutz.tsx
 * @see ./Rueckfrage.tsx
 */
export const STANDARD_MELDUNG =
  "Es gibt ungespeicherte Änderungen. Wenn Sie fortfahren, gehen sie verloren.";

const aktive = new Map<symbol, string>();

/** Meldung der ersten gemeldeten Stelle - oder `undefined`, wenn alles gespeichert ist. */
export function ungespeichertMeldung(): string | undefined {
  return aktive.values().next().value;
}

export function gibtUngespeicherteAenderungen(): boolean {
  return aktive.size > 0;
}

export function useUngespeicherteAenderungen(aktiv: boolean, meldung: string = STANDARD_MELDUNG) {
  useEffect(() => {
    if (!aktiv) return undefined;
    const schluessel = Symbol("ungespeichert");
    aktive.set(schluessel, meldung);

    const vorEntladen = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Ältere Browser verlangen zusätzlich einen Rückgabewert.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", vorEntladen);
    return () => {
      aktive.delete(schluessel);
      window.removeEventListener("beforeunload", vorEntladen);
    };
  }, [aktiv, meldung]);
}
