import type { CustomerOut } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { listenposition } from "../../core/ui/Combobox";
import { KundenAuswahl } from "./KundenAuswahl";
import type { Suchergebnis } from "./KundenAuswahl";

function kunde(id: string, name: string, ort: string | null = null): CustomerOut {
  return {
    id,
    customer_number: `KD-${id.padStart(5, "0")}`,
    kind: "private",
    name,
    contact_person: null,
    email: null,
    phone: null,
    billing_street: null,
    billing_postal_code: null,
    billing_city: ort,
    billing_country_code: "DE",
    anonymized_at: null,
    version: 1,
    created_at: "2026-09-19T10:00:00Z",
    updated_at: "2026-09-19T10:00:00Z",
  };
}

const ALLE = [kunde("1", "Ahrens", "Hannover"), kunde("2", "Bau GmbH"), kunde("3", "Celle Bau")];

/** Kleine Attrappe des Servers: filtert und meldet abgeschnittene Treffer. */
function suchAttrappe(grenze = 20) {
  const aufrufe: string[] = [];
  const suchen = (begriff: string): Promise<Suchergebnis> => {
    aufrufe.push(begriff);
    const gefunden = ALLE.filter((k) => k.name.toLowerCase().includes(begriff.toLowerCase()));
    return Promise.resolve({ treffer: gefunden.slice(0, grenze), weitere: gefunden.length > grenze });
  };
  return { suchen, aufrufe };
}

/** Hält die Auswahl wie das echte Formular außerhalb der Komponente. */
function Harness({
  suchen,
  onChange = vi.fn(),
  fehler,
}: {
  suchen: (begriff: string) => Promise<Suchergebnis>;
  onChange?: (kunde: CustomerOut | null) => void;
  fehler?: string;
}) {
  const [gewaehlt, setGewaehlt] = useState<CustomerOut | null>(null);
  return (
    <KundenAuswahl
      id="kunde"
      zweck="test"
      required
      gewaehlt={gewaehlt}
      fehler={fehler}
      suchen={suchen}
      onChange={(k) => {
        setGewaehlt(k);
        onChange(k);
      }}
    />
  );
}

function zeigen(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

function feld(): HTMLInputElement {
  return screen.getByRole("combobox", { name: /^Kunde/ });
}

async function oeffnen() {
  fireEvent.focus(feld());
  return screen.findByRole("listbox");
}

describe("Kundenauswahl mit serverseitiger Suche", () => {
  it("zeigt beim Öffnen die ersten Treffer eindeutig mit Nummer, Name und Ort", async () => {
    const { suchen, aufrufe } = suchAttrappe();
    zeigen(<Harness suchen={suchen} />);

    const liste = await oeffnen();
    expect(await within(liste).findByRole("option", { name: /KD-00001 Ahrens · Hannover/ })).toBeInTheDocument();
    expect(aufrufe).toEqual([""]);
  });

  it("hat Combobox-/Listbox-Semantik", async () => {
    const { suchen } = suchAttrappe();
    zeigen(<Harness suchen={suchen} />);
    expect(feld()).toHaveAttribute("aria-expanded", "false");

    const liste = await oeffnen();
    expect(feld()).toHaveAttribute("aria-expanded", "true");
    expect(feld()).toHaveAttribute("aria-controls", liste.id);
    expect(feld()).toHaveAttribute("aria-autocomplete", "list");
  });

  it("sucht serverseitig statt alles zu laden", async () => {
    const { suchen, aufrufe } = suchAttrappe();
    zeigen(<Harness suchen={suchen} />);
    await oeffnen();
    await screen.findByRole("option", { name: /Ahrens/ });

    fireEvent.change(feld(), { target: { value: "Celle" } });

    await waitFor(() => expect(aufrufe).toContain("Celle"));
    await waitFor(() => expect(screen.queryByRole("option", { name: /Ahrens/ })).toBeNull());
    expect(screen.getByRole("option", { name: /Celle Bau/ })).toBeInTheDocument();
  });

  it("entprellt die Eingabe, statt je Tastendruck zu fragen", async () => {
    const { suchen, aufrufe } = suchAttrappe();
    zeigen(<Harness suchen={suchen} />);
    await oeffnen();
    await screen.findByRole("option", { name: /Ahrens/ });

    for (const wert of ["C", "Ce", "Cel", "Celle"]) fireEvent.change(feld(), { target: { value: wert } });

    await waitFor(() => expect(aufrufe).toContain("Celle"));
    expect(aufrufe).toEqual(["", "Celle"]);
  });

  it("zeigt nie ein veraltetes Ergebnis, wenn eine ältere Antwort später kommt", async () => {
    const offen = new Map<string, (ergebnis: Suchergebnis) => void>();
    const suchen = (begriff: string) =>
      new Promise<Suchergebnis>((resolve) => {
        offen.set(begriff, resolve);
      });
    zeigen(<Harness suchen={suchen} />);
    await oeffnen();

    fireEvent.change(feld(), { target: { value: "Ahr" } });
    await waitFor(() => expect(offen.has("Ahr")).toBe(true));
    fireEvent.change(feld(), { target: { value: "Celle" } });
    await waitFor(() => expect(offen.has("Celle")).toBe(true));

    // Die neuere Suche antwortet zuerst, die ältere danach.
    act(() => offen.get("Celle")?.({ treffer: [ALLE[2] as CustomerOut], weitere: false }));
    expect(await screen.findByRole("option", { name: /Celle Bau/ })).toBeInTheDocument();
    act(() => offen.get("Ahr")?.({ treffer: [ALLE[0] as CustomerOut], weitere: false }));

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("option", { name: /Ahrens/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Celle Bau/ })).toBeInTheDocument();
  });

  it("ist vollständig per Tastatur bedienbar: Pfeile, Enter, Escape", async () => {
    const { suchen } = suchAttrappe();
    const onChange = vi.fn();
    zeigen(<Harness suchen={suchen} onChange={onChange} />);
    await oeffnen();
    await screen.findByRole("option", { name: /Ahrens/ });

    fireEvent.keyDown(feld(), { key: "ArrowDown" });
    fireEvent.keyDown(feld(), { key: "ArrowDown" });
    const zweite = screen.getByRole("option", { name: /Bau GmbH/ });
    expect(zweite).toHaveAttribute("aria-selected", "true");
    expect(feld()).toHaveAttribute("aria-activedescendant", zweite.id);
    fireEvent.keyDown(feld(), { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: /Ahrens/ })).toHaveAttribute("aria-selected", "true");

    // Escape schließt nur die Liste und wird nicht weitergereicht.
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    feld().dispatchEvent(escape);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(escape.defaultPrevented).toBe(true);

    fireEvent.keyDown(feld(), { key: "ArrowDown" });
    await screen.findByRole("listbox");
    fireEvent.keyDown(feld(), { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ id: "1", name: "Ahrens" });
    // Der Fokus geht nicht verloren, sondern auf den Knopf der Auswahl.
    await waitFor(() => expect(screen.getByRole("button", { name: "Anderen Kunden wählen" })).toHaveFocus());
  });

  it("behält die Auswahl sichtbar, sucht danach nicht weiter und lässt sie entfernen", async () => {
    const { suchen, aufrufe } = suchAttrappe();
    const onChange = vi.fn();
    zeigen(<Harness suchen={suchen} onChange={onChange} />);
    await oeffnen();

    fireEvent.click(await screen.findByRole("option", { name: /Ahrens/ }));

    expect(await screen.findByTestId("kunde-gewaehlt")).toHaveTextContent("KD-00001 Ahrens · Hannover");
    const vorher = aufrufe.length;
    await new Promise((r) => setTimeout(r, 350));
    expect(aufrufe.length).toBe(vorher);

    fireEvent.click(screen.getByRole("button", { name: "Anderen Kunden wählen" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(feld()).toHaveFocus());
    expect(feld()).toHaveValue("");
  });

  it("zeigt Lade-, Leer- und Fehlerzustand in der Liste", async () => {
    let versuch = 0;
    const suchen = (begriff: string): Promise<Suchergebnis> => {
      versuch += 1;
      if (begriff === "kaputt" && versuch < 99) return Promise.reject(new Error("Netz"));
      return Promise.resolve({ treffer: [], weitere: false });
    };
    zeigen(<Harness suchen={suchen} />);
    await oeffnen();
    fireEvent.change(feld(), { target: { value: "niemand" } });
    expect(screen.getByRole("status")).toHaveTextContent("Wird gesucht");
    expect(await screen.findByText("Kein Kunde gefunden. Bitte den Suchbegriff ändern.")).toBeInTheDocument();

    fireEvent.change(feld(), { target: { value: "kaputt" } });
    expect(await screen.findByText(/Die Kundensuche ist fehlgeschlagen/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });

  it("weist auf weitere Treffer hin", async () => {
    const { suchen } = suchAttrappe(1);
    zeigen(<Harness suchen={suchen} />);
    await oeffnen();
    expect(await screen.findByText(/mehr als 20 Treffer/)).toBeInTheDocument();
  });

  it("zeigt den Feldfehler am Suchfeld", () => {
    const { suchen } = suchAttrappe();
    zeigen(<Harness suchen={suchen} fehler="Bitte einen Kunden auswählen." />);
    expect(feld()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Bitte einen Kunden auswählen.")).toBeInTheDocument();
  });

  it("legt die Vorschläge als schwebende Liste außerhalb des Formularflusses ab", async () => {
    const { suchen } = suchAttrappe();
    zeigen(<Harness suchen={suchen} />);
    await oeffnen();
    const popup = screen.getByTestId("kunde-popup");
    expect(popup.style.position).toBe("fixed");
    // Auch während des Ladens: dieselbe schwebende Fläche, kein Element im Fluss.
    fireEvent.change(feld(), { target: { value: "Ce" } });
    expect(screen.getByTestId("kunde-popup").style.position).toBe("fixed");
  });
});

describe("Lage der schwebenden Vorschlagsliste", () => {
  const fenster = { breite: 1000, hoehe: 800 };

  it("liegt unter dem Feld, begrenzt auf eine feste Höhe", () => {
    const lage = listenposition({ top: 100, bottom: 140, left: 50, width: 300 }, fenster);
    expect(lage).toMatchObject({ position: "fixed", top: 144, left: 50, width: 300, maxHeight: 280 });
  });

  it("klappt nach oben, wenn unten kein Platz ist", () => {
    const lage = listenposition({ top: 700, bottom: 740, left: 50, width: 300 }, fenster);
    expect(lage.bottom).toBe(800 - 700 + 4);
    expect(lage.top).toBeUndefined();
  });

  it("bleibt bei schmalem Fenster innerhalb des sichtbaren Bereichs", () => {
    const lage = listenposition({ top: 100, bottom: 140, left: 250, width: 300 }, { breite: 320, hoehe: 600 });
    expect(Number(lage.left) + Number(lage.width)).toBeLessThanOrEqual(320);
    expect(Number(lage.left)).toBeGreaterThanOrEqual(0);
  });
});
