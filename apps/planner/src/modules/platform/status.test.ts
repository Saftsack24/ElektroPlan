import { describe, expect, it } from "vitest";

import { istLoeschbar, istSchreibgeschuetzt, istWiedereroeffenbar } from "./status";

/**
 * Projektstatus in der Oberfläche - Spiegel der Serverregeln (ADR 0020,
 * Erweiterung 4f). Verbindlich bleibt der Server (`409 project-archived`,
 * `409 project-completed`).
 */
describe("Projektstatus", () => {
  it("archivierte und abgeschlossene Projekte sind schreibgeschützt", () => {
    expect(istSchreibgeschuetzt("draft")).toBe(false);
    expect(istSchreibgeschuetzt("active")).toBe(false);
    expect(istSchreibgeschuetzt("completed")).toBe(true);
    expect(istSchreibgeschuetzt("archived")).toBe(true);
  });

  it("nur abgeschlossene lassen sich wiedereröffnen, nur laufende löschen", () => {
    expect(istWiedereroeffenbar("completed")).toBe(true);
    expect(istWiedereroeffenbar("archived")).toBe(false);
    expect(istLoeschbar("completed")).toBe(false);
    expect(istLoeschbar("active")).toBe(true);
  });
});
