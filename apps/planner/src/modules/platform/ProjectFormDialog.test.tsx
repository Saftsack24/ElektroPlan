import type { CustomerOut } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectFormDialog } from "./ProjectFormDialog";
import type { Projektabsendeergebnis, ProjektWerte } from "./ProjectFormDialog";
import type { Suchergebnis } from "./KundenAuswahl";

function kunde(id: string, name: string): CustomerOut {
  return {
    id,
    customer_number: `KD-0000${id}`,
    kind: "private",
    name,
    contact_person: null,
    email: null,
    phone: null,
    billing_street: null,
    billing_postal_code: null,
    billing_city: null,
    billing_country_code: "DE",
    anonymized_at: null,
    version: 1,
    created_at: "2026-09-19T10:00:00Z",
    updated_at: "2026-09-19T10:00:00Z",
  };
}

const KUNDEN = [kunde("1", "Familie Ahrens"), kunde("2", "Bau GmbH")];

const suchenStandard = (begriff: string): Promise<Suchergebnis> =>
  Promise.resolve({
    treffer: KUNDEN.filter((k) => k.name.toLowerCase().includes(begriff.toLowerCase())),
    weitere: false,
  });

function aufbauen(
  onSubmit: (werte: ProjektWerte) => Promise<Projektabsendeergebnis | undefined>,
  onClose = vi.fn(),
  suchen = suchenStandard,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectFormDialog offen suchen={suchen} onSubmit={onSubmit} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

async function kundenWaehlen(name = "Familie Ahrens") {
  const eintrag = await screen.findByRole("button", { name: new RegExp(name) });
  fireEvent.click(eintrag);
  await screen.findByText(name);
}

async function ausfuellen() {
  await kundenWaehlen();
  fireEvent.change(screen.getByLabelText(/^Bezeichnung/), { target: { value: "Neubau" } });
}

describe("Projektanlage im Dialog", () => {
  it("bietet die gefundenen Kunden zur Auswahl an", async () => {
    aufbauen(vi.fn());

    expect(await screen.findByRole("button", { name: /Familie Ahrens/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bau GmbH/ })).toBeTruthy();
  });

  it("schlägt die Startstruktur vor und lässt die Namen ändern", () => {
    aufbauen(vi.fn());

    expect(screen.getByLabelText<HTMLInputElement>("Gebäude").value).toBe("Hauptgebäude");
    expect(screen.getByLabelText<HTMLInputElement>("Geschoss").value).toBe("Erdgeschoss");
    expect(
      screen.getByLabelText<HTMLInputElement>("Gebäude und Geschoss gleich mit anlegen").checked,
    ).toBe(true);
  });

  it("blendet die Strukturfelder aus, wenn sie abgewählt wird", () => {
    aufbauen(vi.fn());

    fireEvent.click(screen.getByLabelText("Gebäude und Geschoss gleich mit anlegen"));

    expect(screen.queryByLabelText("Gebäude")).toBeNull();
    expect(screen.queryByLabelText("Geschoss")).toBeNull();
  });

  it("sendet Projekt und gewählte Startstruktur", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    aufbauen(onSubmit);

    await ausfuellen();
    fireEvent.change(screen.getByLabelText("Gebäude"), { target: { value: "Werkstatt" } });
    fireEvent.click(screen.getByRole("button", { name: "Projekt anlegen" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      customer_id: "1",
      name: "Neubau",
      startstruktur: true,
      gebaeudename: "Werkstatt",
      geschossname: "Erdgeschoss",
    });
  });

  it("sendet ohne Startstruktur, wenn sie abgewählt wurde", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    aufbauen(onSubmit);

    await ausfuellen();
    fireEvent.click(screen.getByLabelText("Gebäude und Geschoss gleich mit anlegen"));
    fireEvent.click(screen.getByRole("button", { name: "Projekt anlegen" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ startstruktur: false });
  });

  it("verlangt Kunde und Bezeichnung", async () => {
    const onSubmit = vi.fn();
    aufbauen(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: "Projekt anlegen" }));

    expect(await screen.findByText("Bitte einen Kunden auswählen.")).toBeTruthy();
    expect(screen.getByText("Bitte eine Bezeichnung angeben.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("verlangt Namen für die Startstruktur, solange sie gewählt ist", async () => {
    const onSubmit = vi.fn();
    aufbauen(onSubmit);

    await ausfuellen();
    fireEvent.change(screen.getByLabelText("Gebäude"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Projekt anlegen" }));

    expect(await screen.findByText("Bitte einen Gebäudenamen angeben.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("behält die Eingaben bei einem Serverfehler", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ fehler: "Der Kunde wurde nicht gefunden." });
    aufbauen(onSubmit);

    await ausfuellen();
    fireEvent.change(screen.getByLabelText("Baustelle: Ort"), { target: { value: "Hannover" } });
    fireEvent.click(screen.getByRole("button", { name: "Projekt anlegen" }));

    expect(await screen.findByText("Der Kunde wurde nicht gefunden.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/^Bezeichnung/).value).toBe("Neubau");
    expect(screen.getByLabelText<HTMLInputElement>("Baustelle: Ort").value).toBe("Hannover");
    // Auch die Kundenwahl bleibt stehen.
    expect(screen.getByText("Familie Ahrens")).toBeTruthy();
  });

  it("sendet trotz mehrfachen Klickens nur einmal", async () => {
    const onSubmit = vi.fn().mockImplementation(() => new Promise<undefined>(() => undefined));
    aufbauen(onSubmit);

    await ausfuellen();
    const knopf = screen.getByRole("button", { name: "Projekt anlegen" });
    fireEvent.click(knopf);
    fireEvent.click(knopf);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Wird angelegt ..." })).toBeTruthy(),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("schliesst über Abbrechen, ohne zu senden", async () => {
    const onSubmit = vi.fn();
    const { onClose } = aufbauen(onSubmit);

    await ausfuellen();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("meldet Escape an den Aufrufer", () => {
    const { onClose } = aufbauen(vi.fn());

    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
