import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CustomerFormDialog } from "./CustomerFormDialog";
import type { Absendeergebnis, KundenWerte } from "./CustomerFormDialog";

/**
 * Bedienung der Kundenanlage.
 *
 * Der Dialog kennt keine API - `onSubmit` wird hier durch eine Attrappe
 * ersetzt. Geprüft wird damit genau das, was die Oberfläche verantwortet:
 * öffnen, abbrechen, Eingaben halten, Fehler zeigen, nicht doppelt senden.
 */
function aufbauen(
  onSubmit: (werte: KundenWerte) => Promise<Absendeergebnis | undefined>,
  onClose = vi.fn(),
) {
  render(
    <CustomerFormDialog
      offen
      titel="Neuer Kunde"
      absendenLabel="Kunden anlegen"
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );
  return { onClose };
}

function tippen(label: RegExp | string, wert: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: wert } });
}

describe("Kundenanlage im Dialog", () => {
  it("zeigt nichts, solange der Dialog geschlossen ist", () => {
    render(
      <CustomerFormDialog offen={false} titel="Neuer Kunde" onSubmit={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.queryByRole("heading", { name: "Neuer Kunde" })).toBeNull();
  });

  it("zeigt das Formular mit beschrifteten Feldern", () => {
    aufbauen(vi.fn());

    expect(screen.getByRole("heading", { name: "Neuer Kunde" })).toBeTruthy();
    expect(screen.getByLabelText(/^Name/)).toBeTruthy();
    expect(screen.getByLabelText("Art")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kunden anlegen" })).toBeTruthy();
  });

  it("sendet die eingegebenen Werte", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    aufbauen(onSubmit);

    tippen(/^Name/, "Familie Ahrens");
    tippen("Ort", "Hannover");
    fireEvent.click(screen.getByRole("button", { name: "Kunden anlegen" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: "Familie Ahrens",
      billing_city: "Hannover",
      kind: "private",
    });
  });

  it("schliesst über Abbrechen, ohne zu senden", () => {
    const onSubmit = vi.fn();
    const { onClose } = aufbauen(onSubmit);

    tippen(/^Name/, "Wird verworfen");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("schliesst über das Kreuz in der Kopfzeile", () => {
    const { onClose } = aufbauen(vi.fn());

    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("meldet Escape an den Aufrufer", () => {
    const { onClose } = aufbauen(vi.fn());

    // Das native <dialog> löst bei Escape ein cancel-Ereignis aus.
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("verlangt einen Namen, bevor gesendet wird", async () => {
    const onSubmit = vi.fn();
    aufbauen(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: "Kunden anlegen" }));

    expect(await screen.findByText("Bitte einen Namen angeben.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("behaelt die Eingaben, wenn der Server einen Feldfehler meldet", async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      fehler: "Bitte die markierten Felder prüfen.",
      felder: { email: "Der Wert hat nicht das erwartete Format." },
    });
    aufbauen(onSubmit);

    tippen(/^Name/, "Familie Ahrens");
    tippen("E-Mail", "keine-mail");
    fireEvent.click(screen.getByRole("button", { name: "Kunden anlegen" }));

    expect(await screen.findByText("Der Wert hat nicht das erwartete Format.")).toBeTruthy();
    expect(screen.getByText("Bitte die markierten Felder prüfen.")).toBeTruthy();
    // Nichts muss neu getippt werden.
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe("Familie Ahrens");
    expect(screen.getByLabelText<HTMLInputElement>("E-Mail").value).toBe("keine-mail");
    expect(screen.getByLabelText("E-Mail").getAttribute("aria-invalid")).toBe("true");
  });

  it("behaelt die Eingaben auch bei einem allgemeinen Serverfehler", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ fehler: "Es ist ein Fehler aufgetreten." });
    aufbauen(onSubmit);

    tippen(/^Name/, "Familie Ahrens");
    fireEvent.click(screen.getByRole("button", { name: "Kunden anlegen" }));

    expect(await screen.findByText("Es ist ein Fehler aufgetreten.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe("Familie Ahrens");
  });

  it("sendet trotz mehrfachen Klickens nur einmal", async () => {
    let freigeben: () => void = () => undefined;
    const onSubmit = vi.fn().mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          freigeben = () => resolve(undefined);
        }),
    );
    aufbauen(onSubmit);

    tippen(/^Name/, "Familie Ahrens");
    const knopf = screen.getByRole("button", { name: "Kunden anlegen" });
    fireEvent.click(knopf);
    fireEvent.click(knopf);
    fireEvent.click(knopf);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Wird gespeichert ..." })).toBeTruthy(),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);

    freigeben();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("sperrt Felder und Abbrechen waehrend des Sendens", async () => {
    const onSubmit = vi.fn().mockImplementation(() => new Promise<undefined>(() => undefined));
    aufbauen(onSubmit);

    tippen(/^Name/, "Familie Ahrens");
    fireEvent.click(screen.getByRole("button", { name: "Kunden anlegen" }));

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>(/^Name/).disabled).toBe(true),
    );
    expect(screen.getByRole("button", { name: "Abbrechen" }).hasAttribute("disabled")).toBe(true);
  });

  it("setzt den Fokus beim Öffnen auf das erste Feld", () => {
    aufbauen(vi.fn());

    expect(document.activeElement).toBe(screen.getByLabelText(/^Name/));
  });

  it("verweist per aria-labelledby auf die Überschrift", () => {
    aufbauen(vi.fn());

    const dialog = screen.getByRole("dialog");
    const id = dialog.getAttribute("aria-labelledby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id ?? "")?.textContent).toBe("Neuer Kunde");
  });
});
