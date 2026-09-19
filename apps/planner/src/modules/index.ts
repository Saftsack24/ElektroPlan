import { ModuleRegistry } from "../core/modules/registry";
import type { PlannerModule } from "../core/modules/types";
import { platformModule } from "./platform";

/**
 * Die einzige zentrale Stelle, an der Module registriert werden.
 *
 * Ein neues Modul benoetigt genau eine Zeile hier - Navigation, Routen,
 * Projekt-Tabs und Einstellungsbereiche bringt es selbst mit
 * (docs/modules.md, Abschnitt 6).
 */
export const MODULES: readonly PlannerModule[] = [
  platformModule,
  // ab Phase 3:  electricalModule,
  // ab Phase 7:  materialsModule,
  // ab Phase 9:  calculationModule,
  // ab Phase 10: offersModule,
];

export const moduleRegistry = new ModuleRegistry(MODULES);
