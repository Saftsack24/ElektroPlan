import { useEffect } from "react";
import { useBlocker } from "react-router-dom";

import { STANDARD_MELDUNG, gibtUngespeicherteAenderungen, ungespeichertMeldung } from "./ungespeichert";

/**
 * Hält jede Navigation **innerhalb der Anwendung** an, solange ein Modul
 * ungespeicherte Änderungen meldet - Links, `navigate()`, Browser-Zurück und
 * Browser-Vorwärts.
 *
 * Grundlage ist der Blocker des Data Routers (`useBlocker`). Er stellt bei
 * Zurück/Vorwärts den alten Eintrag selbst wieder her; es gibt keinen
 * eigenen `popstate`-Umweg und damit keine Navigationsschleife. Bestätigt der
 * Benutzer, läuft genau die angehaltene Navigation genau einmal weiter
 * (`proceed`), sonst bleibt alles, wie es war (`reset`).
 *
 * Fachneutral: Der Schutz weiß nicht, **was** ungespeichert ist. Er fragt die
 * Meldestelle aus `ungespeichert.ts`. Neuladen und Schließen deckt dort
 * `beforeunload` ab - das kann kein Router abfangen.
 *
 * Wird genau einmal unterhalb des `RouterProvider` gerendert: Ein Router
 * unterstützt nur einen Blocker gleichzeitig.
 */
export function Navigationsschutz() {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      gibtUngespeicherteAenderungen() &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
  );

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(ungespeichertMeldung() ?? STANDARD_MELDUNG)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  return null;
}
