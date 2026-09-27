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
    // Ohne user.account.read kein Eintrag "Administration".
    expect(navigation.map((item) => item.id)).not.toContain("administration");
  });

  it("blendet Kunden und Protokoll aus, wenn die Berechtigung fehlt", () => {
    const permissions = new Set(["project.record.read"]);

    const navigation = registry.navigation({ activeModuleIds: aktiv, permissions });
    const routen = registry.routes({ activeModuleIds: aktiv, permissions });

    expect(navigation.map((item) => item.id)).toEqual(["projects"]);
    expect(routen.map((route) => route.path)).toEqual(["/", "/projects", "/projects/:projectId"]);
  });

  it("zeigt die Administration nur mit Leserecht - auch als Route", () => {
    const monteur = new Set(["project.record.read"]);
    const admin = new Set([
      "project.record.read",
      "user.account.read",
      "role.assignment.read",
      "audit.entry.read",
    ]);

    const ohne = registry.routes({ activeModuleIds: aktiv, permissions: monteur });
    const mit = registry.routes({ activeModuleIds: aktiv, permissions: admin });

    expect(ohne.some((route) => route.path.startsWith("/administration"))).toBe(false);
    expect(
      registry.navigation({ activeModuleIds: aktiv, permissions: monteur }).map((i) => i.id),
    ).not.toContain("administration");
    expect(mit.map((route) => route.path).filter((pfad) => pfad.startsWith("/administration")))
      .toEqual([
        "/administration",
        "/administration/users",
        "/administration/users/:memberId",
        "/administration/roles",
        "/administration/system",
      ]);
    expect(
      registry.navigation({ activeModuleIds: aktiv, permissions: admin }).map((i) => i.id),
    ).toEqual(["projects", "administration", "audit"]);
  });

  it("bindet die Rollenübersicht an das eigene Leserecht", () => {
    const nurBenutzer = new Set(["user.account.read"]);
    const pfade = registry
      .routes({ activeModuleIds: aktiv, permissions: nurBenutzer })
      .map((route) => route.path);
    expect(pfade).toContain("/administration/users");
    expect(pfade).not.toContain("/administration/roles");
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
