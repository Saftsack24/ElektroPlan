import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useNummerierteListe } from "./useNummerierteListe";
import type { NummerierteSeite } from "./useNummerierteListe";

type Eintrag = { id: string };

/** Serverattrappe: 60 Einträge, 25 je Seite, Seite hinter der letzten → letzte. */
function server(gesamt = 60) {
  const aufrufe: { filter: string; seite: number }[] = [];
  const laden = (filter: string, seite: number): Promise<NummerierteSeite<Eintrag>> => {
    aufrufe.push({ filter, seite });
    const anzahl = filter === "eng" ? 3 : gesamt;
    const seiten = Math.ceil(anzahl / 25);
    const echt = Math.max(1, Math.min(seite, seiten));
    const items = Array.from({ length: anzahl }, (_, i) => ({ id: `${filter}-${i}` })).slice((echt - 1) * 25, echt * 25);
    return Promise.resolve({ items, page: echt, page_size: 25, total_items: anzahl, total_pages: seiten });
  };
  return { laden, aufrufe };
}

function Liste({ laden }: { laden: (filter: string, seite: number) => Promise<NummerierteSeite<Eintrag>> }) {
  const [filter, setFilter] = useState("alle");
  const liste = useNummerierteListe({ schluessel: ["test", filter], laden: (seite) => laden(filter, seite) });
  return (
    <div>
      <button type="button" onClick={() => setFilter("eng")}>
        eng
      </button>
      <button type="button" onClick={() => liste.zuSeite(3)}>
        zu 3
      </button>
      <button type="button" onClick={() => liste.zuSeite(9)}>
        zu 9
      </button>
      <p data-testid="stand">{`${liste.seite}/${liste.gesamtSeiten}/${liste.gesamtEintraege}`}</p>
      <p data-testid="erste">{liste.eintraege[0]?.id ?? "-"}</p>
    </div>
  );
}

function zeigen(laden: Parameters<typeof Liste>[0]["laden"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <Liste laden={laden} />
    </QueryClientProvider>,
  );
}

describe("Nummerierte Liste", () => {
  it("lädt echte Seiten des Servers", async () => {
    const { laden, aufrufe } = server();
    zeigen(laden);
    await waitFor(() => expect(screen.getByTestId("stand")).toHaveTextContent("1/3/60"));
    fireEvent.click(screen.getByText("zu 3"));
    await waitFor(() => expect(screen.getByTestId("erste")).toHaveTextContent("alle-50"));
    expect(aufrufe.map((a) => a.seite)).toEqual([1, 3]);
  });

  it("beginnt nach einem Filterwechsel wieder auf Seite 1", async () => {
    const { laden, aufrufe } = server();
    zeigen(laden);
    fireEvent.click(await screen.findByText("zu 3"));
    await waitFor(() => expect(screen.getByTestId("stand")).toHaveTextContent("3/3/60"));

    fireEvent.click(screen.getByText("eng"));
    await waitFor(() => expect(screen.getByTestId("stand")).toHaveTextContent("1/1/3"));
    expect(aufrufe.at(-1)).toEqual({ filter: "eng", seite: 1 });
    // Keine Anfrage nach Seite 3 des neuen Filters.
    expect(aufrufe.some((a) => a.filter === "eng" && a.seite !== 1)).toBe(false);
  });

  it("übernimmt die letzte gültige Seite, wenn die angefragte nicht mehr existiert", async () => {
    const { laden } = server();
    zeigen(laden);
    await screen.findByText("zu 9");
    fireEvent.click(screen.getByText("zu 9"));
    await waitFor(() => expect(screen.getByTestId("stand")).toHaveTextContent("3/3/60"));
  });

  it("zeigt nach einem Filterwechsel nie die alten Einträge", async () => {
    let freigeben: () => void = () => undefined;
    const { laden: echt } = server();
    const laden = vi.fn((filter: string, seite: number) =>
      filter === "eng" ? new Promise<NummerierteSeite<Eintrag>>((r) => (freigeben = () => void echt(filter, seite).then(r))) : echt(filter, seite),
    );
    zeigen(laden);
    await waitFor(() => expect(screen.getByTestId("erste")).toHaveTextContent("alle-0"));
    fireEvent.click(screen.getByText("eng"));
    await waitFor(() => expect(screen.getByTestId("erste")).toHaveTextContent("-"));
    act(() => freigeben());
    await waitFor(() => expect(screen.getByTestId("erste")).toHaveTextContent("eng-0"));
  });
});
