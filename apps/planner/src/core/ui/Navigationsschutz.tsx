import { useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";

import { useRueckfrage, verwerfenOptionen } from "./Rueckfrage";
import { gibtUngespeicherteAenderungen } from "./ungespeichert";

/**
 * Hält jede Navigation **innerhalb der Anwendung** an, solange ein Modul
 * ungespeicherte Änderungen meldet - Links, `navigate()`, Browser-Zurück und
 * Browser-Vorwärts.
 *
 * Grundlage ist der Blocker des Data Routers (`useBlocker`). Er stellt bei
 * Zurück/Vorwärts den alten Eintrag selbst wieder her; es gibt keinen
 * eigenen `popstate`-Umweg und damit keine Navigationsschleife. Gefragt wird
 * über die eigene Rückfrage (`Rueckfrage.tsx`). Bestätigt der Benutzer, läuft
 * genau die angehaltene Navigation genau einmal weiter (`proceed`), sonst
 * bleibt alles, wie es war (`reset`).
 *
 * **Eine Frage je Blockade.** Unter StrictMode laufen Effekte doppelt; der
 * Merker `fragt` verhindert eine zweite Rückfrage für dieselbe angehaltene
 * Navigation. Die Antwort wirkt auf den jeweils aktuellen Blocker.
 *
 * Fachneutral: Der Schutz weiß nicht, **was** ungespeichert ist. Neuladen und
 * Schließen deckt `beforeunload` ab - das kann kein Router abfangen.
 *
 * Wird genau einmal unterhalb des `RouterProvider` gerendert: Ein Router
 * unterstützt nur einen Blocker gleichzeitig.
 */
export function Navigationsschutz() {
  const fragen = useRueckfrage();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      gibtUngespeicherteAenderungen() &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
  );
  const aktuell = useRef(blocker);
  const fragt = useRef(false);
  useEffect(() => {
    aktuell.current = blocker;
  });

  useEffect(() => {
    if (blocker.state !== "blocked" || fragt.current) return;
    fragt.current = true;
    void fragen(
      verwerfenOptionen("Seite verlassen?", "Sie wollen diese Seite verlassen."),
    ).then((antwort) => {
      fragt.current = false;
      const b = aktuell.current;
      if (b.state !== "blocked") return;
      if (antwort === "bestaetigt") b.proceed();
      else b.reset();
    });
  }, [blocker, fragen]);

  return null;
}
