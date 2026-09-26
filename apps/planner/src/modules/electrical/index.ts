import { lazy } from "react";

import type { PlannerModule } from "../../core/modules/types";

/**
 * Fachmodul Elektroplanung - oeffentlicher Einstiegspunkt.
 *
 * **Genau ein Name verlaesst dieses Modul.** Alles andere - Seiten, Dialoge,
 * Texte - bleibt intern; die Grenzpruefung in
 * `scripts/module-boundaries.mjs` lehnt jeden tieferen Import von aussen ab
 * (docs/modules.md, Abschnitt 8).
 *
 * Der Projekt-Tab erscheint ueber den vorhandenen Beitragspunkt
 * `project.tabs`. Die zentrale Projektseite wird dafuer **nicht** geaendert:
 * Sie liest die Beitraege aus dem Core-Kanal `useProjectTabs()`, den die
 * Composition Root fuellt.
 *
 * `dependsOn: ["core"]` spiegelt die Backend-Registrierung
 * (`depends_on = ("core",)`). `materials` kommt erst in Phase 7.
 */
export const electricalModule: PlannerModule = {
  id: "electrical",
  name: "Elektroplanung",
  version: "1.0.0",
  dependsOn: ["core"],
  projectTabs: [
    {
      id: "electrical-rooms",
      label: "Räume & Grundriss",
      order: 20,
      permission: "electrical.plan.read",
      element: lazy(() => import("./RoomsTab")),
    },
  ],
};
