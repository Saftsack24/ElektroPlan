import { describe, expect, it } from "vitest";

import { ModuleRegistry } from "../../core/modules/registry";
import { platformModule } from "./index";

/**
 * Die Sichtbarkeitsregel ist Bedienkomfort, kein Zugriffsschutz - abgesichert
 * wird serverseitig. Trotzdem muss sie stimmen: Ein Monteur soll keine
 * Kundenliste angeboten bekommen, die ihm der Server ohnehin verweigert.
 */
const registry = new ModuleRegistry([platformModule]);
const aktiv = new Set(["core"]);

describe("Plattform-Modul", () => {
  it("zeigt einem Administrator alle Bereiche", () => {
    const permissions = new Set([
      "project.record.read",
      "customer.record.read",
      "audit.entry.read",
    ]);

    const navigation = registry.navigation({ activeModuleIds: aktiv, permissions });

    expect(navigation.map((item) => item.id)).toEqual(["projects", "customers", "audit"]);
  });

  it("blendet Kunden und Protokoll aus, wenn die Berechtigung fehlt", () => {
    const permissions = new Set(["project.record.read"]);

    const navigation = registry.navigation({ activeModuleIds: aktiv, permissions });
    const routen = registry.routes({ activeModuleIds: aktiv, permissions });

    expect(navigation.map((item) => item.id)).toEqual(["projects"]);
    expect(routen.map((route) => route.path)).toEqual(["/projects", "/projects/:projectId"]);
  });

  it("zeigt nichts an, solange das Modul fuer den Betrieb nicht aktiv ist", () => {
    const permissions = new Set(["project.record.read", "customer.record.read"]);

    const navigation = registry.navigation({
      activeModuleIds: new Set<string>(),
      permissions,
    });

    expect(navigation).toEqual([]);
  });

  it("bringt in Phase 2 noch keine eigenen Projekt-Tabs mit", () => {
    // Die Tabs der Projektansicht sind fest; Fachmodule ergaenzen sie ab Phase 3.
    expect(platformModule.projectTabs).toBeUndefined();
  });
});
