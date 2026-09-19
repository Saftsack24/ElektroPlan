import type { ComponentType, LazyExoticComponent } from "react";

/** Eine lazy geladene Seite eines Moduls. */
export type ModulePage = LazyExoticComponent<ComponentType>;

export interface NavItem {
  id: string;
  label: string;
  to: string;
  order: number;
  /** Ohne diese Berechtigung wird der Eintrag nicht gerendert. */
  permission?: string;
}

export interface RouteContribution {
  path: string;
  element: ModulePage;
  permission?: string;
}

export interface ProjectTab {
  id: string;
  label: string;
  order: number;
  element: ModulePage;
  permission?: string;
}

export interface SettingsSection {
  id: string;
  label: string;
  element: ModulePage;
  permission?: string;
}

/**
 * Selbstbeschreibung eines Frontend-Moduls.
 *
 * Ein neues Modul benoetigt genau eine Zeile in `src/modules/index.ts`
 * (docs/modules.md, Abschnitt 6). Es gibt kein Laufzeit-Plugin-System:
 * Alle Module werden statisch importiert und gemeinsam gebaut.
 */
export interface PlannerModule {
  id: string;
  name: string;
  version: string;
  dependsOn?: string[];
  navigation?: NavItem[];
  routes?: RouteContribution[];
  projectTabs?: ProjectTab[];
  settingsSections?: SettingsSection[];
}

/** Was die Shell ueber den angemeldeten Benutzer wissen muss. */
export interface Visibility {
  activeModuleIds: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
}
