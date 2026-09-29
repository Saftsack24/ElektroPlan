import type { CustomerOut } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../core/ui/masseinheit";
import { FELDZEILE } from "../../core/ui/stil";
import { ProjectFormDialog } from "./ProjectFormDialog";
import type { Projektabsendeergebnis, ProjektWerte } from "./ProjectFormDialog";
import type { Suchergebnis } from "./KundenAuswahl";

function kunde(id: string, name: string, adresse: Partial<CustomerOut> = {}): CustomerOut {
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
    ...adresse,
  };
}

const KUNDEN = [
  kunde("1", "Familie Ahrens", { billing_street: "Ahornweg 1", billing_postal_code: "30159", billing_city: "Hannover" }),
  kunde("2", "Bau GmbH"),
  kunde("3", "Alpenbau AG", {
    billing_street: "Seestrasse 5",
    billing_postal_code: "8002",
    billing_city: "Zürich",
    billing_country_code: "CH",
  }),
  kunde("4", "Nur Ort KG", { billing_city: "Celle" }),
];

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

const kundenfeld = () => screen.getByRole("combobox", { name: /^Kunde/ });

async function kundenWaehlen(name = "Familie Ahrens") {
  fireEvent.focus(kundenfeld());
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
  await screen.findByTestId("projekt-kunde-gewaehlt");
}

async function kundenWechseln(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Anderen Kunden wählen" }));
  await kundenWaehlen(name);
}

async function ausfuellen() {
  await kundenWaehlen();
  fireEvent.change(screen.getByLabelText(/^Bezeichnung/), { target: { value: "Neubau" } });
}

const wert = (label: string) => screen.getByLabelText<HTMLInputElement>(label).value;

describe("Projektanlage im Dialog", () => {
  it("bietet die gefundenen Kunden zur Auswahl an", async () => {
    aufbauen(vi.fn());
    fireEvent.focus(kundenfeld());

    expect(await screen.findByRole("option", { name: /Familie Ahrens/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Bau GmbH/ })).toBeTruthy();
  });

  it("schlägt die Startstruktur vor und lässt die Namen ändern", () => {
    aufbauen(vi.fn());

    expect(wert("Gebäude")).toBe("Hauptgebäude");
    expect(wert("Geschoss")).toBe("Erdgeschoss");
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
    fireEvent.change(screen.getByLabelText("Ort"), { target: { value: "Hameln" } });
    fireEvent.click(screen.getByRole("button", { name: "Projekt anlegen" }));

    expect(await screen.findByText("Der Kunde wurde nicht gefunden.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/^Bezeichnung/).value).toBe("Neubau");
    expect(wert("Ort")).toBe("Hameln");
    expect(screen.getByTestId("projekt-kunde-gewaehlt")).toHaveTextContent("Familie Ahrens");
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

describe("Baustellenadresse als Vorschlag aus der Kundenadresse", () => {
  it("füllt leere Adressfelder und kennzeichnet sie", async () => {
    aufbauen(vi.fn());
    await kundenWaehlen("Familie Ahrens");

    expect(wert("Straße")).toBe("Ahornweg 1");
    expect(wert("PLZ")).toBe("30159");
    expect(wert("Ort")).toBe("Hannover");
    expect(wert("Ländercode")).toBe("DE");
    expect(screen.getAllByText("Vom Kunden übernommen")).toHaveLength(4);
  });

  it("nimmt einer manuell geänderten Angabe die Kennzeichnung und behält sie beim Kundenwechsel", async () => {
    aufbauen(vi.fn());
    await kundenWaehlen("Familie Ahrens");
    fireEvent.change(screen.getByLabelText("Ort"), { target: { value: "Laatzen" } });
    expect(screen.getAllByText("Vom Kunden übernommen")).toHaveLength(3);

    await kundenWechseln("Alpenbau AG");

    // Automatisch verwaltete Felder folgen dem neuen Kunden, die eigene Eingabe bleibt.
    expect(wert("Straße")).toBe("Seestrasse 5");
    expect(wert("PLZ")).toBe("8002");
    expect(wert("Ort")).toBe("Laatzen");
    expect(wert("Ländercode")).toBe("CH");
  });

  it("übernimmt auf ausdrücklichen Wunsch alle vorhandenen Kundenwerte", async () => {
    aufbauen(vi.fn());
    await kundenWaehlen("Familie Ahrens");
    fireEvent.change(screen.getByLabelText("Ort"), { target: { value: "Laatzen" } });

    fireEvent.click(screen.getByRole("button", { name: "Kundenadresse übernehmen" }));

    expect(wert("Ort")).toBe("Hannover");
    expect(screen.getAllByText("Vom Kunden übernommen")).toHaveLength(4);
  });

  it("lässt bei einem Kunden ohne Adresse alles leer - ohne null oder undefined", async () => {
    aufbauen(vi.fn());
    await kundenWaehlen("Bau GmbH");

    expect(wert("Straße")).toBe("");
    expect(wert("PLZ")).toBe("");
    expect(wert("Ort")).toBe("");
    expect(wert("Ländercode")).toBe("DE");
    expect(screen.queryByRole("button", { name: "Kundenadresse übernehmen" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });

  it("leert beim Wechsel zu einem Kunden mit Teiladresse nur die automatisch übernommenen Felder", async () => {
    aufbauen(vi.fn());
    await kundenWaehlen("Familie Ahrens");
    await kundenWechseln("Nur Ort KG");

    expect(wert("Straße")).toBe("");
    expect(wert("PLZ")).toBe("");
    expect(wert("Ort")).toBe("Celle");
  });

  it("behält die Adressdaten, wenn die Kundenauswahl entfernt wird", async () => {
    aufbauen(vi.fn());
    await kundenWaehlen("Familie Ahrens");
    fireEvent.change(screen.getByLabelText("PLZ"), { target: { value: "30165" } });
    fireEvent.click(screen.getByRole("button", { name: "Anderen Kunden wählen" }));

    expect(wert("Straße")).toBe("Ahornweg 1");
    expect(wert("PLZ")).toBe("30165");
  });

  it("sendet genau die sichtbaren Werte, auch einen ausländischen Ländercode", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    aufbauen(onSubmit);
    await kundenWaehlen("Alpenbau AG");
    fireEvent.change(screen.getByLabelText(/^Bezeichnung/), { target: { value: "Chalet" } });
    fireEvent.change(screen.getByLabelText("Straße"), { target: { value: "Bergweg 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Projekt anlegen" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      customer_id: "3",
      site_street: "Bergweg 2",
      site_postal_code: "8002",
      site_city: "Zürich",
      site_country_code: "CH",
    });
  });

  it("lehnt einen ungültigen Ländercode ab", async () => {
    const onSubmit = vi.fn();
    aufbauen(onSubmit);
    await ausfuellen();
    fireEvent.change(screen.getByLabelText("Ländercode"), { target: { value: "D" } });
    fireEvent.click(screen.getByRole("button", { name: "Projekt anlegen" }));

    expect(await screen.findByText(/zweistelligen Ländercode/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Dialogaufbau des Projektformulars", () => {
  it("hat genau einen Scrollbereich; Titel und Aktionen bleiben erreichbar", () => {
    aufbauen(vi.fn());
    const dialog = screen.getByRole("dialog");
    const bereiche = dialog.querySelectorAll("[data-dialog-scrollbereich]");
    expect(bereiche).toHaveLength(1);
    expect(
      within(dialog).getByRole("heading", { name: "Neues Projekt" }).closest("[data-dialog-scrollbereich]"),
    ).toBeNull();
    expect(bereiche[0]?.querySelector("form")).not.toBeNull();
    expect(dialog.querySelector("[data-dialog-aktionen]")).not.toBeNull();
  });

  it("verändert beim Öffnen und Laden der Vorschläge den Formularfluss nicht", async () => {
    let freigeben: (e: Suchergebnis) => void = () => undefined;
    aufbauen(vi.fn(), vi.fn(), () => new Promise<Suchergebnis>((r) => (freigeben = r)));
    const bereich = screen.getByRole("dialog").querySelector("[data-dialog-scrollbereich]") as HTMLElement;
    // Elemente im Formularfluss - ohne die schwebende Liste.
    const imFluss = () =>
      [...bereich.querySelectorAll("*")].filter((e) => e.closest("[data-testid$=\"-popup\"]") === null).length;
    const vorher = imFluss();

    // Der Dialog fokussiert das Kundenfeld beim Öffnen; die Liste öffnet sich.
    fireEvent.focus(kundenfeld());
    const popup = await screen.findByTestId("projekt-kunde-popup");
    expect(popup.style.position).toBe("fixed");
    expect(within(popup).getByRole("status")).toHaveTextContent("Wird gesucht");
    expect(imFluss()).toBe(vorher);

    freigeben({ treffer: KUNDEN, weitere: false });
    await screen.findByRole("option", { name: /Familie Ahrens/ });
    expect(imFluss()).toBe(vorher);
    expect(kundenfeld()).toHaveFocus();
  });

  it("richtet Gebäude und Geschoss in einer Feldzeile oben bündig aus", () => {
    aufbauen(vi.fn());
    // Feld = Hülle aus Beschriftung, Eingabe, Fehler und Hinweis (core/ui/Feld.tsx).
    const gebaeude = screen.getByLabelText("Gebäude").parentElement;
    const geschoss = screen.getByLabelText("Geschoss").parentElement;
    expect(gebaeude?.parentElement).toBe(geschoss?.parentElement);
    expect(gebaeude?.parentElement?.className).toBe(FELDZEILE);
    // Der Hinweis gehört zum Geschossfeld und steht darunter.
    expect(within(geschoss as HTMLElement).getByText(/Ebene 0, Standardhöhe 250 cm/)).toBeInTheDocument();
  });

  it("nennt die Standardhöhe in der gewählten Maßeinheit", () => {
    masseinheitSetzen("mm");
    aufbauen(vi.fn());
    expect(screen.getByText(/Standardhöhe 2\.500 mm/)).toBeInTheDocument();
  });
});
