import { lazy } from "react";

import type { PlannerModule } from "../../core/modules/types";

/**
 * Oberflaeche der Plattform selbst: Kunden, Projekte und Protokoll.
 *
 * Zugleich das Referenzbeispiel fuer die Frontend-Modulregistrierung: Ein
 * Modul beschreibt sich selbst und wird in `src/modules/index.ts` mit einer
 * Zeile eingetragen (docs/modules.md, Abschnitt 6).
 *
 * Die Modul-ID ist `core`, weil diese Seiten zu den Core-Ressourcen des
 * Backends gehoeren - `GET /api/v1/me/modules` liefert genau diese ID.
 */
export const platformModule: PlannerModule = {
  id: "core",
  name: "Plattform",
  version: "1.1.0",
  navigation: [
    {
      id: "projects",
      label: "Projekte",
      to: "/projects",
      order: 10,
      permission: "project.record.read",
    },
    {
      id: "customers",
      label: "Kunden",
      to: "/customers",
      order: 20,
      permission: "customer.record.read",
    },
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
      path: "/projects",
      element: lazy(() => import("./ProjectsPage")),
      permission: "project.record.read",
    },
    {
      path: "/projects/:projectId",
      element: lazy(() => import("./ProjectDetailPage")),
      permission: "project.record.read",
    },
    {
      path: "/customers",
      element: lazy(() => import("./CustomersPage")),
      permission: "customer.record.read",
    },
    {
      path: "/customers/:customerId",
      element: lazy(() => import("./CustomerDetailPage")),
      permission: "customer.record.read",
    },
    {
      path: "/audit",
      element: lazy(() => import("./AuditPage")),
      permission: "audit.entry.read",
    },
  ],
};
