import { lazy } from "react";

import type { PlannerModule } from "../../core/modules/types";

/**
 * Protokollansicht des Core.
 *
 * Zugleich das Referenzbeispiel fuer die Frontend-Modulregistrierung: Ein Modul
 * beschreibt sich selbst und wird in `src/modules/index.ts` mit einer Zeile
 * eingetragen.
 */
export const auditModule: PlannerModule = {
  id: "core",
  name: "Plattform",
  version: "1.0.0",
  navigation: [
    {
      id: "audit",
      label: "Protokoll",
      to: "/audit",
      order: 90,
      permission: "audit.entry.read",
    },
  ],
  routes: [
    {
      path: "/audit",
      element: lazy(() => import("./AuditPage")),
      permission: "audit.entry.read",
    },
  ],
};
