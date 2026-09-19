import { lazy } from "react";
import { describe, expect, it } from "vitest";

import { ModuleRegistrationError, ModuleRegistry } from "./registry";
import type { PlannerModule } from "./types";

const page = lazy(() => Promise.resolve({ default: () => null }));

function makeModule(id: string, overrides: Partial<PlannerModule> = {}): PlannerModule {
  return { id, name: id, version: "1.0.0", ...overrides };
}

describe("ModuleRegistry", () => {
  it("lehnt doppelte Modul-IDs ab", () => {
    expect(() => new ModuleRegistry([makeModule("electrical"), makeModule("electrical")])).toThrow(
      ModuleRegistrationError,
    );
  });

  it("meldet fehlende Abhaengigkeiten", () => {
    expect(
      () => new ModuleRegistry([makeModule("electrical", { dependsOn: ["materials"] })]),
    ).toThrow(/materials/);
  });

  it("erkennt Zyklen", () => {
    expect(
      () =>
        new ModuleRegistry([
          makeModule("a", { dependsOn: ["b"] }),
          makeModule("b", { dependsOn: ["a"] }),
        ]),
    ).toThrow(/Zyklus/);
  });

  it("blendet Module aus, die fuer die Organisation nicht aktiv sind", () => {
    const registry = new ModuleRegistry([
      makeModule("electrical", {
        navigation: [{ id: "plan", label: "Planung", to: "/plan", order: 10 }],
      }),
    ]);

    const sichtbar = registry.navigation({
      activeModuleIds: new Set(),
      permissions: new Set(),
    });

    expect(sichtbar).toHaveLength(0);
  });

  it("blendet Beitraege ohne passende Berechtigung aus", () => {
    const registry = new ModuleRegistry([
      makeModule("electrical", {
        navigation: [
          {
            id: "plan",
            label: "Planung",
            to: "/plan",
            order: 10,
            permission: "electrical.plan.read",
          },
        ],
      }),
    ]);

    expect(
      registry.navigation({
        activeModuleIds: new Set(["electrical"]),
        permissions: new Set(),
      }),
    ).toHaveLength(0);

    expect(
      registry.navigation({
        activeModuleIds: new Set(["electrical"]),
        permissions: new Set(["electrical.plan.read"]),
      }),
    ).toHaveLength(1);
  });

  it("sortiert Navigation und Projekt-Tabs nach order", () => {
    const registry = new ModuleRegistry([
      makeModule("b", { navigation: [{ id: "zweiter", label: "B", to: "/b", order: 20 }] }),
      makeModule("a", { navigation: [{ id: "erster", label: "A", to: "/a", order: 10 }] }),
    ]);

    const eintraege = registry.navigation({
      activeModuleIds: new Set(["a", "b"]),
      permissions: new Set(),
    });

    expect(eintraege.map((item) => item.id)).toEqual(["erster", "zweiter"]);
  });

  it("sammelt Routen und Projekt-Tabs mehrerer Module", () => {
    const registry = new ModuleRegistry([
      makeModule("electrical", {
        routes: [{ path: "/plan", element: page }],
        projectTabs: [{ id: "plan", label: "Elektroplanung", order: 20, element: page }],
      }),
      makeModule("materials", {
        projectTabs: [{ id: "material", label: "Material", order: 30, element: page }],
      }),
    ]);
    const visibility = {
      activeModuleIds: new Set(["electrical", "materials"]),
      permissions: new Set<string>(),
    };

    expect(registry.routes(visibility)).toHaveLength(1);
    expect(registry.projectTabs(visibility).map((tab) => tab.id)).toEqual(["plan", "material"]);
  });
});
