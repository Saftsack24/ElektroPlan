import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Seitennavigation } from "./Seitennavigation";
import { seitenfolge } from "./seitenfolge";

describe("Seitenfolge", () => {
  it.each([
    [6, 24, [1, "…", 4, 5, 6, 7, 8, "…", 24]],
    [1, 24, [1, 2, 3, "…", 24]],
    [24, 24, [1, "…", 22, 23, 24]],
    [4, 24, [1, 2, 3, 4, 5, 6, "…", 24]],
    [3, 5, [1, 2, 3, 4, 5]],
    [1, 1, [1]],
    [1, 0, []],
  ])("Seite %i von %i", (aktuell, gesamt, erwartet) => {
    expect(seitenfolge(aktuell, gesamt)).toEqual(erwartet);
  });

  it("ersetzt eine Lücke von genau einer Seite durch die Zahl", () => {
    expect(seitenfolge(5, 24)).toEqual([1, 2, 3, 4, 5, 6, 7, "…", 24]);
  });
});

function zeigen(seite: number, gesamtSeiten: number, gesamtEintraege = gesamtSeiten * 25) {
  const onSeite = vi.fn<(seite: number) => void>();
  render(
    <Seitennavigation seite={seite} gesamtSeiten={gesamtSeiten} gesamtEintraege={gesamtEintraege} onSeite={onSeite} />,
  );
  return onSeite;
}

describe("Seitennavigation", () => {
  it("zeigt aktuelle Seite, Gesamtzahl und Ellipsen", () => {
    zeigen(6, 24, 587);
    const nav = screen.getByRole("navigation", { name: "Seiten" });
    expect(within(nav).getByText(/Seite 6 von 24 · 587 Einträge/)).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Seite 6" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getAllByText("…")).toHaveLength(2);
    expect(within(nav).getByRole("button", { name: "Seite 24" })).toBeInTheDocument();
  });

  it("blättert zur vorigen, nächsten, ersten und letzten Seite", () => {
    const onSeite = zeigen(6, 24);
    fireEvent.click(screen.getByRole("button", { name: "Vorige Seite" }));
    fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    fireEvent.click(screen.getByRole("button", { name: "Erste Seite" }));
    fireEvent.click(screen.getByRole("button", { name: "Letzte Seite" }));
    fireEvent.click(screen.getByRole("button", { name: "Seite 8" }));
    expect(onSeite.mock.calls.map(([s]) => s)).toEqual([5, 7, 1, 24, 8]);
  });

  it("sperrt Zurück auf der ersten und Weiter auf der letzten Seite", () => {
    zeigen(1, 3);
    expect(screen.getByRole("button", { name: "Erste Seite" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Vorige Seite" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nächste Seite" })).toBeEnabled();
  });

  it("zeigt bei einer Seite nur die Anzahl, bei leerer Liste nichts", () => {
    const { unmount } = render(
      <Seitennavigation seite={1} gesamtSeiten={1} gesamtEintraege={1} onSeite={vi.fn()} />,
    );
    expect(screen.getByText("1 Eintrag")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    unmount();
    const { container } = render(
      <Seitennavigation seite={1} gesamtSeiten={0} gesamtEintraege={0} onSeite={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
