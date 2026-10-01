import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  gespeicherteMasseinheit,
  masseinheit,
  masseinheitSetzen,
  masseinheitVorschauBeenden,
  masseinheitVorschauen,
  useMasse,
} from "./masseinheit";

function Anzeige() {
  const masse = useMasse();
  return <p>{masse.anzeigen(2500)}</p>;
}

/**
 * Seit Phase 4e hält `masseinheit.ts` nur den gültigen Wert; Server, Cache und
 * Übernahme prüft `core/einstellungen/persoenlich.test.ts`.
 */
describe("Persönliche Maßeinheit", () => {
  it("ist ohne Wahl Zentimeter", () => {
    render(<Anzeige />);
    expect(screen.getByText("250 cm")).toBeInTheDocument();
    expect(masseinheit()).toBe("cm");
  });

  it("wirkt sofort in allen Komponenten - auch in Metern", () => {
    render(
      <>
        <Anzeige />
        <Anzeige />
      </>,
    );
    act(() => masseinheitSetzen("mm"));
    expect(screen.getAllByText("2.500 mm")).toHaveLength(2);
    act(() => masseinheitSetzen("m"));
    expect(screen.getAllByText("2,500 m")).toHaveLength(2);
  });

  it("null (niemand angemeldet) ergibt den Standard", () => {
    masseinheitSetzen("m");
    masseinheitSetzen(null);
    expect(masseinheit()).toBe("cm");
  });

  it("liest und schreibt selbst keinen Browser-Speicher", () => {
    const lesen = vi.spyOn(Storage.prototype, "getItem");
    const schreiben = vi.spyOn(Storage.prototype, "setItem");
    masseinheitSetzen("mm");
    masseinheitVorschauen("m");
    masseinheitVorschauBeenden();
    expect(lesen).not.toHaveBeenCalled();
    expect(schreiben).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("funktioniert unter StrictMode mit doppeltem Abonnieren", () => {
    render(
      <StrictMode>
        <Anzeige />
      </StrictMode>,
    );
    act(() => masseinheitSetzen("m"));
    expect(screen.getByText("2,500 m")).toBeInTheDocument();
  });
});

describe("Vorschau der Maßeinheit", () => {
  it("zeigt eine Vorschau sofort, ändert den gültigen Wert aber nicht", () => {
    render(<Anzeige />);
    act(() => masseinheitVorschauen("m"));
    expect(screen.getByText("2,500 m")).toBeInTheDocument();
    expect(gespeicherteMasseinheit()).toBe("cm");
    act(() => masseinheitVorschauBeenden());
    expect(screen.getByText("250 cm")).toBeInTheDocument();
  });

  it("ein neuer gültiger Wert beendet die Vorschau", () => {
    masseinheitVorschauen("mm");
    masseinheitSetzen("m");
    expect(masseinheit()).toBe("m");
    masseinheitVorschauBeenden();
    expect(masseinheit()).toBe("m");
  });
});
