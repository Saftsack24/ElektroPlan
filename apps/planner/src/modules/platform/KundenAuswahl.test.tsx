import type { CustomerOut } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

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
    return Promise.resolve({
      treffer: gefunden.slice(0, grenze),
      weitere: gefunden.length > grenze,
    });
  };
  return { suchen, aufrufe };
}

/** Haelt die Auswahl wie das echte Formular ausserhalb der Komponente. */
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
      gewaehlt={gewaehlt}
      fehler={fehler}
      suchen={suchen}
      onChange={(kunde) => {
        setGewaehlt(kunde);
        onChange(kunde);
      }}
    />
  );
}

function zeigen(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

describe("Kundenauswahl mit serverseitiger Suche", () => {
  it("zeigt beim Öffnen die ersten Treffer, ohne dass getippt werden muss", async () => {
    const { suchen, aufrufe } = suchAttrappe();
    zeigen(<Harness suchen={suchen} />);

    expect(await screen.findByRole("button", { name: /Ahrens/ })).toBeTruthy();
    expect(aufrufe).toEqual([""]);
  });

  it("sucht serverseitig statt alles zu laden", async () => {
    const { suchen, aufrufe } = suchAttrappe();
    zeigen(<Harness suchen={suchen} />);

    await screen.findByRole("button", { name: /Ahrens/ });
    fireEvent.change(screen.getByLabelText(/^Kunde/), { target: { value: "Celle" } });

    await waitFor(() => expect(aufrufe).toContain("Celle"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Ahrens/ })).toBeNull());
    expect(screen.getByRole("button", { name: /Celle Bau/ })).toBeTruthy();
  });

  it("entprellt die Eingabe, statt je Tastendruck zu fragen", async () => {
    const { suchen, aufrufe } = suchAttrappe();
    zeigen(<Harness suchen={suchen} />);

    await screen.findByRole("button", { name: /Ahrens/ });
    const feld = screen.getByLabelText(/^Kunde/);
    fireEvent.change(feld, { target: { value: "C" } });
    fireEvent.change(feld, { target: { value: "Ce" } });
    fireEvent.change(feld, { target: { value: "Cel" } });
    fireEvent.change(feld, { target: { value: "Celle" } });

    await waitFor(() => expect(aufrufe).toContain("Celle"));
    // Nur der Erstaufruf und der letzte Stand - nicht jeder Zwischenschritt.
    expect(aufrufe).toEqual(["", "Celle"]);
  });

  it("behält die Auswahl und sucht danach nicht weiter", async () => {
    const { suchen, aufrufe } = suchAttrappe();
    const onChange = vi.fn();
    zeigen(<Harness suchen={suchen} onChange={onChange} />);

    fireEvent.click(await screen.findByRole("button", { name: /Ahrens/ }));

    await screen.findByText("Ahrens");
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ id: "1", name: "Ahrens" });
    expect(screen.queryByLabelText(/^Kunde/)).toBeNull();
    expect(aufrufe).toEqual([""]);
  });

  it("lässt die Auswahl wieder aufheben", async () => {
    const { suchen } = suchAttrappe();
    zeigen(<Harness suchen={suchen} />);

    fireEvent.click(await screen.findByRole("button", { name: /Ahrens/ }));
    await screen.findByText("Ahrens");
    fireEvent.click(screen.getByRole("button", { name: "Anderen Kunden wählen" }));

    expect(await screen.findByLabelText(/^Kunde/)).toBeTruthy();
  });

  it("weist auf abgeschnittene Treffer hin, statt sie still wegzulassen", async () => {
    // Genau der Fall, der vorher unsichtbar war: Es gibt mehr, als gezeigt wird.
    const { suchen } = suchAttrappe(1);
    zeigen(<Harness suchen={suchen} />);

    fireEvent.change(await screen.findByLabelText(/^Kunde/), { target: { value: "Bau" } });

    expect(await screen.findByText(/Bitte den Suchbegriff eingrenzen/)).toBeTruthy();
  });

  it("meldet einen leeren Treffersatz verständlich", async () => {
    const { suchen } = suchAttrappe();
    zeigen(<Harness suchen={suchen} />);

    fireEvent.change(await screen.findByLabelText(/^Kunde/), { target: { value: "Zzz" } });

    expect(await screen.findByText(/Kein Kunde gefunden/)).toBeTruthy();
  });

  it("unterscheidet „noch keine Kunden“ von „nichts gefunden“", async () => {
    const suchen = () => Promise.resolve({ treffer: [], weitere: false });
    zeigen(<Harness suchen={suchen} />);

    expect(await screen.findByText(/Es gibt noch keinen Kunden/)).toBeTruthy();
  });

  it("meldet einen Fehlschlag und bietet einen neuen Versuch an", async () => {
    const suchen = (): Promise<Suchergebnis> => Promise.reject(new Error("Netz weg"));
    zeigen(<Harness suchen={suchen} />);

    expect(await screen.findByText(/Kundensuche ist fehlgeschlagen/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeTruthy();
  });

  it("zeigt einen Feldfehler an und verknüpft ihn mit dem Eingabefeld", async () => {
    const { suchen } = suchAttrappe();
    zeigen(<Harness suchen={suchen} fehler="Bitte einen Kunden auswählen." />);

    const feld = await screen.findByLabelText(/^Kunde/);
    expect(feld.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Bitte einen Kunden auswählen.")).toBeTruthy();
  });
});
