import { describe, expect, it } from "vitest";

import { ModuleRegistry } from "../../core/modules/registry";
import { electricalModule } from "./index";

/**
 * Registrierung des Fachmoduls über den vorhandenen Beitragspunkt.
 *
 * Der Nachweis, dass Phase 3 die Projektseite **nicht** anfassen muss: Der
 * Tab entsteht allein aus dieser Modulbeschreibung. Die Sichtbarkeitsregel ist
 * dabei Bedienkomfort, kein Zugriffsschutz - abgesichert wird serverseitig
 * (docs/modules.md, Abschnitt 6).
 *
 * Geprüft wird **nur** das eigene Modul: Ein Modul importiert kein anderes -
 * auch nicht im Test. Die Registry wird deshalb allein mit `electricalModule`
 * aufgebaut; die Abhängigkeit auf `core` ist eine fachliche Angabe und wird von
 * der Composition Root aufgelöst.
 */
const aktiv = new Set(["electrical"]);
const registry = new ModuleRegistry([{ ...electricalModule, dependsOn: [] }]);

describe("Elektroplanungs-Modul", () => {
  it("bringt genau einen Projekt-Tab mit", () => {
    expect(electricalModule.projectTabs).toHaveLength(1);
    const [tab] = electricalModule.projectTabs ?? [];
    expect(tab?.id).toBe("electrical-rooms");
    expect(tab?.label).toBe("Räume & Grundriss");
    expect(tab?.permission).toBe("electrical.plan.read");
  });

  it("registriert weder Navigation noch Routen noch Einstellungen", () => {
    // Phase 3 hat keine eigene Seite ausserhalb des Projekts und keine
    // Stammdatenpflege - das kommt mit den Geraetetypen (Phase 5).
    expect(electricalModule.navigation).toBeUndefined();
    expect(electricalModule.routes).toBeUndefined();
    expect(electricalModule.settingsSections).toBeUndefined();
  });

  it("haengt wie im Backend nur am Core", () => {
    expect(electricalModule.dependsOn).toEqual(["core"]);
  });

  it("erscheint in der Tab-Liste der Projektansicht", () => {
    const tabs = registry.projectTabs({
      activeModuleIds: aktiv,
      permissions: new Set(["electrical.plan.read"]),
    });

    expect(tabs.map((tab) => tab.id)).toEqual(["electrical-rooms"]);
  });

  it("bleibt ohne Leseberechtigung verborgen", () => {
    const tabs = registry.projectTabs({
      activeModuleIds: aktiv,
      permissions: new Set(["project.record.read"]),
    });

    expect(tabs).toEqual([]);
  });

  it("bleibt verborgen, solange das Modul fuer den Betrieb nicht aktiv ist", () => {
    const tabs = registry.projectTabs({
      activeModuleIds: new Set(["core"]),
      permissions: new Set(["electrical.plan.read"]),
    });

    expect(tabs).toEqual([]);
  });

  it("nennt den Core als Abhaengigkeit, die die Composition Root aufloest", () => {
    // Die Registry wird oben ohne ``core`` aufgebaut, weil dieser Test nur das
    // eigene Modul kennt. Die echte Liste in ``src/modules/index.ts`` enthaelt
    // beide - dort wird die Abhaengigkeit geprueft.
    expect(electricalModule.dependsOn).toContain("core");
  });

  it("wird hinter den Tabs der Plattform einsortiert", () => {
    const [tab] = electricalModule.projectTabs ?? [];
    expect(tab?.order).toBe(20);
  });

  it("ist unter seiner Modul-ID registriert", () => {
    expect(registry.all().map((modul) => modul.id)).toEqual(["electrical"]);
  });
});
