import type {
  NavItem,
  PlannerModule,
  ProjectTab,
  RouteContribution,
  SettingsSection,
  Visibility,
} from "./types";

export class ModuleRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleRegistrationError";
  }
}

/**
 * Haelt die registrierten Frontend-Module und liefert die sichtbaren Beitraege.
 *
 * Wichtig: Das Ausblenden eines Beitrags ist Bedienkomfort, **kein**
 * Zugriffsschutz. Die Absicherung erfolgt serverseitig.
 */
export class ModuleRegistry {
  private readonly modules: readonly PlannerModule[];

  constructor(modules: readonly PlannerModule[]) {
    this.modules = modules;
    this.validate();
  }

  /** Prueft eindeutige IDs, vorhandene Abhaengigkeiten und Zyklenfreiheit. */
  private validate(): void {
    const byId = new Map<string, PlannerModule>();
    for (const module of this.modules) {
      if (byId.has(module.id)) {
        throw new ModuleRegistrationError(`Modul-ID "${module.id}" ist doppelt vergeben.`);
      }
      byId.set(module.id, module);
    }

    for (const module of this.modules) {
      for (const dependency of module.dependsOn ?? []) {
        if (!byId.has(dependency)) {
          throw new ModuleRegistrationError(
            `Modul "${module.id}" haengt von "${dependency}" ab, das nicht registriert ist.`,
          );
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const walk = (id: string, path: string[]): void => {
      if (visiting.has(id)) {
        throw new ModuleRegistrationError(
          `Zyklus in den Modulabhaengigkeiten: ${[...path, id].join(" -> ")}`,
        );
      }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of byId.get(id)?.dependsOn ?? []) {
        walk(dependency, [...path, id]);
      }
      visiting.delete(id);
      visited.add(id);
    };
    for (const module of this.modules) {
      walk(module.id, []);
    }
  }

  all(): readonly PlannerModule[] {
    return this.modules;
  }

  private visibleModules(visibility: Visibility): PlannerModule[] {
    return this.modules.filter((module) => visibility.activeModuleIds.has(module.id));
  }

  private static allowed(permission: string | undefined, visibility: Visibility): boolean {
    return permission === undefined || visibility.permissions.has(permission);
  }

  navigation(visibility: Visibility): NavItem[] {
    return this.visibleModules(visibility)
      .flatMap((module) => module.navigation ?? [])
      .filter((item) => ModuleRegistry.allowed(item.permission, visibility))
      .sort((a, b) => a.order - b.order);
  }

  routes(visibility: Visibility): RouteContribution[] {
    return this.visibleModules(visibility)
      .flatMap((module) => module.routes ?? [])
      .filter((route) => ModuleRegistry.allowed(route.permission, visibility));
  }

  projectTabs(visibility: Visibility): ProjectTab[] {
    return this.visibleModules(visibility)
      .flatMap((module) => module.projectTabs ?? [])
      .filter((tab) => ModuleRegistry.allowed(tab.permission, visibility))
      .sort((a, b) => a.order - b.order);
  }

  settingsSections(visibility: Visibility): SettingsSection[] {
    return this.visibleModules(visibility)
      .flatMap((module) => module.settingsSections ?? [])
      .filter((section) => ModuleRegistry.allowed(section.permission, visibility));
  }
}
