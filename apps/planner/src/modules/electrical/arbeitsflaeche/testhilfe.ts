import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Testhilfe (Phase 6c.0): Das Eigenschaftenpanel ist standardmäßig eingeklappt und
 * dann für Hilfstechnik verborgen. Tests, die dort etwas bedienen, öffnen es wie ein
 * Benutzer über den Knopf „Eigenschaften“ der jeweiligen Arbeitsfläche.
 *
 * `bereich`: die Arbeitsfläche oder ein Element, das genau eine enthält (etwa der
 * Dialog der Wandansicht). Ohne Angabe: die Arbeitsfläche des Grundrisses.
 */
export async function eigenschaftenOeffnen(bereich?: HTMLElement): Promise<void> {
  // Direkt über die festen Markierungen der Arbeitsfläche statt `findByRole` über das ganze
  // Dokument: Die Rollenabfrage berechnet Rolle, Name und Sichtbarkeit jedes Elements und war
  // der größte Zeitposten der langen Integrationstests (Profil L1, 2026-10-22). Der Name des
  // Knopfs wird weiterhin geprüft – nur für diesen einen Knopf.
  const knopf = await waitFor(() => {
    const flaeche = bereich ?? document.querySelector<HTMLElement>('[data-arbeitsflaeche][aria-label="Grundriss-Arbeitsfläche"]');
    const k = (flaeche?.matches("[data-arbeitsflaeche]") === true ? flaeche : flaeche?.querySelector("[data-arbeitsflaeche]"))?.querySelector<HTMLElement>("[data-eigenschaften-knopf] button");
    if (k === null || k === undefined) throw new Error("Knopf „Eigenschaften“ der Arbeitsfläche nicht gefunden");
    return k;
  });
  expect(knopf).toHaveAccessibleName("Eigenschaften");
  if (knopf.getAttribute("aria-expanded") !== "true") fireEvent.click(knopf);
}

/** Einen Raum über die Raumliste der Grundriss-Eigenschaften wählen (Panel wird dafür geöffnet). */
export async function raumInListe(name: RegExp | string): Promise<HTMLElement> {
  await eigenschaftenOeffnen();
  return screen.findByRole("button", { name });
}
