import type { InvitationPolicy, SystemRoleOut } from "@elektroplan/api-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EinladenDialog } from "./EinladenDialog";
import type { Einladungsergebnis, EinladungsWerte } from "./EinladenDialog";

/**
 * Einladungsdialog: Formular, Validierung, Tastatur, kein Doppelversand.
 * Der Dialog kennt keine API - `onSubmit` ist eine Attrappe.
 */
const ROLLEN: SystemRoleOut[] = [
  { key: "admin", name: "Administrator", description: "Voller Zugriff.", permissions: [] },
  { key: "planer", name: "Planer", description: "Technische Planung.", permissions: [] },
  { key: "monteur", name: "Monteur", description: "Baustelle.", permissions: [] },
];
const RICHTLINIE: InvitationPolicy = { valid_hours: 72, delivery: "development_link" };

function aufbauen(
  onSubmit: (werte: EinladungsWerte) => Promise<Einladungsergebnis | undefined> = vi.fn(() =>
    Promise.resolve(undefined),
  ),
  richtlinie: InvitationPolicy = RICHTLINIE,
) {
  const onClose = vi.fn();
  render(
    <EinladenDialog
      offen
      rollen={ROLLEN}
      richtlinie={richtlinie}
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );
  return { onSubmit, onClose };
}

const tippen = (label: RegExp | string, wert: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value: wert } });

describe("Benutzer einladen", () => {
  it("zeigt beschriftete Felder, feste Rollen mit Zweck und die Gültigkeit", () => {
    aufbauen();
    expect(screen.getByRole("dialog", { name: "Benutzer einladen" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^E-Mail/)).toHaveFocus();
    expect(screen.getByLabelText(/Name \(optional\)/)).toBeInTheDocument();
    const planer = screen.getByRole("checkbox", { name: /Planer/ });
    expect(planer).toHaveAccessibleDescription("Technische Planung.");
    expect(screen.getByText(/72 Stunden gültig/)).toBeInTheDocument();
    // Keine einzelnen Berechtigungen zum Anklicken.
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("prüft E-Mail und Rollen, ohne zu senden", () => {
    const { onSubmit } = aufbauen();
    tippen(/^E-Mail/, "keine-mail");
    fireEvent.click(screen.getByRole("button", { name: "Einladung erstellen" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Bitte eine gültige E-Mail-Adresse angeben.")).toBeInTheDocument();
    expect(screen.getByText("Bitte mindestens eine Rolle wählen.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^E-Mail/)).toHaveAttribute("aria-invalid", "true");
  });

  it("sendet mit Enter genau einmal, auch bei Doppelklick", async () => {
    let freigeben: (wert: undefined) => void = () => {};
    const onSubmit = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          freigeben = resolve;
        }),
    );
    aufbauen(onSubmit);
    tippen(/^E-Mail/, "  neu@test.example ");
    fireEvent.click(screen.getByRole("checkbox", { name: /Monteur/ }));
    fireEvent.submit(screen.getByLabelText(/^E-Mail/).closest("form")!);
    fireEvent.submit(screen.getByLabelText(/^E-Mail/).closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: /wird erstellt/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ email: "neu@test.example", name: "", rollen: ["monteur"] });
    freigeben(undefined);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Einladung erstellen" })).toBeEnabled(),
    );
  });

  it("behält die Eingaben bei einem Serverfehler", async () => {
    aufbauen(() => Promise.resolve({ fehler: "Diese Person gehört dem Betrieb bereits an." }));
    tippen(/^E-Mail/, "da@test.example");
    fireEvent.click(screen.getByRole("checkbox", { name: /Planer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Einladung erstellen" }));
    expect(await screen.findByText("Diese Person gehört dem Betrieb bereits an.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^E-Mail/)).toHaveValue("da@test.example");
    expect(screen.getByRole("checkbox", { name: /Planer/ })).toBeChecked();
  });

  it("Escape und Abbrechen schließen, ohne etwas zu senden", () => {
    const { onSubmit, onClose } = aufbauen();
    tippen(/^E-Mail/, "neu@test.example");
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("verhindert Einladungen ohne eingerichteten Zustellweg", () => {
    aufbauen(vi.fn(), { valid_hours: 72, delivery: "none" });
    expect(screen.getByText(/noch kein Zustellweg eingerichtet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Einladung erstellen" })).toBeDisabled();
  });
});
