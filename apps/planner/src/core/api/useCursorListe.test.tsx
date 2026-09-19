import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useCursorListe } from "./useCursorListe";
import type { Seite } from "./useCursorListe";

interface Eintrag {
  id: string;
}

/**
 * Die Liste wird mit einer Attrappe statt der API betrieben. Geprüft wird
 * damit genau das Versprechen der Oberfläche: nachladen ohne Dubletten und
 * ein Cursor, der bei jeder Such- oder Filteränderung von vorn beginnt.
 */
function seitenAttrappe(seiten: Record<string, Seite<Eintrag>[]>) {
  const aufrufe: { filter: string; cursor: string | undefined }[] = [];
  const laden = (filter: string) => (cursor: string | undefined) => {
    aufrufe.push({ filter, cursor });
    const fuerFilter = seiten[filter] ?? [];
    const index = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
    return Promise.resolve(fuerFilter[index] ?? { items: [], next_cursor: null });
  };
  return { laden, aufrufe };
}

function Harness({
  laden,
}: {
  laden: (filter: string) => (cursor: string | undefined) => Promise<Seite<Eintrag>>;
}) {
  const [filter, setFilter] = useState("a");
  const liste = useCursorListe<Eintrag>({
    schluessel: ["test", filter],
    laden: laden(filter),
  });

  return (
    <div>
      <button type="button" onClick={() => setFilter("b")}>
        Filter wechseln
      </button>
      <button type="button" disabled={!liste.hatWeitere} onClick={liste.weitereLaden}>
        Weitere laden
      </button>
      <span data-testid="ids">{liste.eintraege.map((eintrag) => eintrag.id).join(",")}</span>
      <span data-testid="zustand">
        {liste.laedt ? "laedt" : liste.fehlgeschlagen ? "fehler" : "fertig"}
      </span>
    </div>
  );
}

function aufbauen(
  laden: (filter: string) => (cursor: string | undefined) => Promise<Seite<Eintrag>>,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <Harness laden={laden} />
    </QueryClientProvider>,
  );
}

const ids = () => screen.getByTestId("ids").textContent;

describe("Cursorbasierte Liste", () => {
  it("laedt die erste Seite ohne Cursor", async () => {
    const { laden, aufrufe } = seitenAttrappe({
      a: [{ items: [{ id: "1" }, { id: "2" }], next_cursor: null }],
    });
    aufbauen(laden);

    await waitFor(() => expect(ids()).toBe("1,2"));
    expect(aufrufe).toEqual([{ filter: "a", cursor: undefined }]);
  });

  it("haengt die naechste Seite an", async () => {
    const { laden } = seitenAttrappe({
      a: [
        { items: [{ id: "1" }], next_cursor: "1" },
        { items: [{ id: "2" }], next_cursor: null },
      ],
    });
    aufbauen(laden);

    await waitFor(() => expect(ids()).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "Weitere laden" }));

    await waitFor(() => expect(ids()).toBe("1,2"));
  });

  it("sperrt den Knopf, wenn keine weitere Seite existiert", async () => {
    const { laden } = seitenAttrappe({ a: [{ items: [{ id: "1" }], next_cursor: null }] });
    aufbauen(laden);

    await waitFor(() => expect(ids()).toBe("1"));
    expect(screen.getByRole("button", { name: "Weitere laden" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("liefert keine doppelten Eintraege, wenn Seiten sich ueberlappen", async () => {
    const { laden } = seitenAttrappe({
      a: [
        { items: [{ id: "1" }, { id: "2" }], next_cursor: "1" },
        { items: [{ id: "2" }, { id: "3" }], next_cursor: null },
      ],
    });
    aufbauen(laden);

    await waitFor(() => expect(ids()).toBe("1,2"));
    fireEvent.click(screen.getByRole("button", { name: "Weitere laden" }));

    await waitFor(() => expect(ids()).toBe("1,2,3"));
  });

  it("setzt den Cursor zurueck, wenn sich der Filter aendert", async () => {
    const { laden, aufrufe } = seitenAttrappe({
      a: [
        { items: [{ id: "a1" }], next_cursor: "1" },
        { items: [{ id: "a2" }], next_cursor: null },
      ],
      b: [{ items: [{ id: "b1" }], next_cursor: null }],
    });
    aufbauen(laden);

    await waitFor(() => expect(ids()).toBe("a1"));
    fireEvent.click(screen.getByRole("button", { name: "Weitere laden" }));
    await waitFor(() => expect(ids()).toBe("a1,a2"));

    fireEvent.click(screen.getByRole("button", { name: "Filter wechseln" }));

    // Die zweite Seite des alten Filters ist weg, und die neue Abfrage
    // beginnt ohne Cursor.
    await waitFor(() => expect(ids()).toBe("b1"));
    expect(aufrufe.filter((aufruf) => aufruf.filter === "b")).toEqual([
      { filter: "b", cursor: undefined },
    ]);
  });

  it("meldet einen Fehlschlag, statt still leer zu bleiben", async () => {
    const laden = () => (): Promise<Seite<Eintrag>> =>
      Promise.reject(new Error("Netz weg"));
    aufbauen(laden);

    await waitFor(() => expect(screen.getByTestId("zustand").textContent).toBe("fehler"));
  });

  it("laedt nichts, solange die Abfrage nicht aktiv ist", () => {
    const laden = vi.fn<(cursor: string | undefined) => Promise<Seite<Eintrag>>>();
    function Inaktiv() {
      const liste = useCursorListe<Eintrag>({
        schluessel: ["inaktiv"],
        laden,
        aktiv: false,
      });
      return <span data-testid="ids">{liste.eintraege.length}</span>;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Inaktiv />
      </QueryClientProvider>,
    );

    expect(laden).not.toHaveBeenCalled();
  });
});
