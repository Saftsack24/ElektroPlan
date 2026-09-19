import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import type { ProjectTab } from "./types";

/**
 * Projekt-Tabs der Fachmodule, bereitgestellt vom Shell-Bereich.
 *
 * Warum ein Context und nicht der direkte Zugriff auf die Registry:
 * Die Projektseite gehoert einem Modul, und ein Modul darf die Composition
 * Root `src/modules/index.ts` nicht importieren - das waere ein Zyklus und
 * eine Grenzverletzung (docs/modules.md, Abschnitt 8). Der Core definiert
 * deshalb den Kanal, `src/app` fuellt ihn aus der Registry, und jedes Modul
 * liest ihn ueber `useProjectTabs()`.
 */
const ProjectTabsContext = createContext<readonly ProjectTab[]>([]);

export function ProjectTabsProvider({
  tabs,
  children,
}: {
  tabs: readonly ProjectTab[];
  children: ReactNode;
}) {
  const value = useMemo(() => tabs, [tabs]);
  return <ProjectTabsContext.Provider value={value}>{children}</ProjectTabsContext.Provider>;
}

/** Beitraege der Fachmodule zur Projektansicht - in Phase 2 noch leer. */
export function useProjectTabs(): readonly ProjectTab[] {
  return useContext(ProjectTabsContext);
}
