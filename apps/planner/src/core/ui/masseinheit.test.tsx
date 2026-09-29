import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  MASSEINHEIT_SCHLUESSEL_ALT,
  masseinheit,
  masseinheitBenutzerSetzen,
  masseinheitSchluessel,
  masseinheitSetzen,
  masseinheitZuruecksetzen,
  useMasse,
} from "./masseinheit";

function Anzeige() {
  const masse = useMasse();
  return <p>{masse.anzeigen(2500)}</p>;
}

const ANNA = "11111111-1111-4111-8111-111111111111";
const BERT = "22222222-2222-4222-8222-222222222222";

describe("Persönliche Maßeinheit", () => {
  it("ist ohne gespeicherte Wahl Zentimeter", () => {
    masseinheitBenutzerSetzen(ANNA);
    render(<Anzeige />);
    expect(screen.getByText("250 cm")).toBeInTheDocument();
    expect(masseinheit()).toBe("cm");
  });

  it("wirkt sofort in allen Komponenten und wird für den Benutzer gespeichert", () => {
    masseinheitBenutzerSetzen(ANNA);
    render(
      <>
        <Anzeige />
        <Anzeige />
      </>,
    );
    act(() => masseinheitSetzen("mm"));
    expect(screen.getAllByText("2.500 mm")).toHaveLength(2);
    expect(window.localStorage.getItem(masseinheitSchluessel(ANNA))).toBe("mm");
    expect(window.localStorage.getItem(MASSEINHEIT_SCHLUESSEL_ALT)).toBeNull();
  });

  it("liest eine gespeicherte Wahl beim Start und verwirft unbekannte Werte", () => {
    window.localStorage.setItem(masseinheitSchluessel(ANNA), "mm");
    masseinheitZuruecksetzen();
    masseinheitBenutzerSetzen(ANNA);
    expect(masseinheit()).toBe("mm");

    window.localStorage.setItem(masseinheitSchluessel(ANNA), "zoll");
    masseinheitZuruecksetzen();
    masseinheitBenutzerSetzen(ANNA);
    expect(masseinheit()).toBe("cm");
  });

  it("zieht eine Änderung desselben Benutzers aus einem anderen Tab nach", () => {
    masseinheitBenutzerSetzen(ANNA);
    render(<Anzeige />);
    window.localStorage.setItem(masseinheitSchluessel(ANNA), "mm");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: masseinheitSchluessel(ANNA) }));
    });
    expect(screen.getByText("2.500 mm")).toBeInTheDocument();
  });

  it("registriert unter StrictMode genau einen storage-Listener und räumt ihn ab", () => {
    const hinzu = vi.spyOn(window, "addEventListener");
    const weg = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <StrictMode>
        <Anzeige />
        <Anzeige />
      </StrictMode>,
    );
    const netto = () =>
      hinzu.mock.calls.filter(([t]) => t === "storage").length - weg.mock.calls.filter(([t]) => t === "storage").length;
    expect(netto()).toBe(1);
    unmount();
    expect(netto()).toBe(0);
    vi.restoreAllMocks();
  });

  it("bleibt ohne nutzbaren Speicher bedienbar", () => {
    masseinheitBenutzerSetzen(ANNA);
    const setzen = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("gesperrt");
    });
    render(<Anzeige />);
    act(() => masseinheitSetzen("mm"));
    expect(screen.getByText("2.500 mm")).toBeInTheDocument();
    setzen.mockRestore();
  });
});

describe("Maßeinheit je Benutzer im selben Browser", () => {
  it("zwei Benutzer im selben localStorage haben getrennte Einheiten", () => {
    render(<Anzeige />);
    act(() => masseinheitBenutzerSetzen(ANNA));
    act(() => masseinheitSetzen("mm"));
    expect(screen.getByText("2.500 mm")).toBeInTheDocument();

    // Anna meldet sich ab, Bert meldet sich an: Bert sieht seinen Standard.
    act(() => masseinheitBenutzerSetzen(null));
    expect(screen.getByText("250 cm")).toBeInTheDocument();
    act(() => masseinheitBenutzerSetzen(BERT));
    expect(screen.getByText("250 cm")).toBeInTheDocument();

    // Anna wieder angemeldet: ihre Wahl ist erhalten.
    act(() => masseinheitBenutzerSetzen(ANNA));
    expect(screen.getByText("2.500 mm")).toBeInTheDocument();
    expect(window.localStorage.getItem(masseinheitSchluessel(ANNA))).toBe("mm");
    expect(window.localStorage.getItem(masseinheitSchluessel(BERT))).toBeNull();
  });

  it("während die Anmeldung lädt oder nach dem Abmelden gilt der Standard - keine fremde Wahl", () => {
    window.localStorage.setItem(masseinheitSchluessel(ANNA), "mm");
    masseinheitZuruecksetzen();
    render(<Anzeige />);
    expect(screen.getByText("250 cm")).toBeInTheDocument();
    // Ohne Benutzer wird eine Wahl nicht gespeichert.
    act(() => masseinheitSetzen("mm"));
    expect(Object.keys(window.localStorage).filter((k) => k.startsWith(MASSEINHEIT_SCHLUESSEL_ALT))).toEqual([
      masseinheitSchluessel(ANNA),
    ]);
  });

  it("ein Tab eines anderen Benutzers beeinflusst die Anzeige nicht", () => {
    masseinheitBenutzerSetzen(ANNA);
    render(<Anzeige />);
    window.localStorage.setItem(masseinheitSchluessel(BERT), "mm");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: masseinheitSchluessel(BERT) }));
    });
    expect(screen.getByText("250 cm")).toBeInTheDocument();
  });

  it("derselbe Benutzer behält seine Einheit beim Betriebswechsel", () => {
    masseinheitBenutzerSetzen(ANNA);
    masseinheitSetzen("mm");
    // Betriebswechsel: dieselbe user_id wird erneut gemeldet.
    masseinheitBenutzerSetzen(ANNA);
    expect(masseinheit()).toBe("mm");
  });

  it("übernimmt den alten browserweiten Wert einmalig für den ersten Benutzer und entfernt ihn", () => {
    window.localStorage.setItem(MASSEINHEIT_SCHLUESSEL_ALT, "mm");
    masseinheitZuruecksetzen();
    masseinheitBenutzerSetzen(ANNA);
    expect(masseinheit()).toBe("mm");
    expect(window.localStorage.getItem(masseinheitSchluessel(ANNA))).toBe("mm");
    expect(window.localStorage.getItem(MASSEINHEIT_SCHLUESSEL_ALT)).toBeNull();
    // Der nächste Benutzer erbt nichts.
    masseinheitBenutzerSetzen(BERT);
    expect(masseinheit()).toBe("cm");
  });

  it("überschreibt beim Übernehmen keine vorhandene eigene Wahl", () => {
    window.localStorage.setItem(masseinheitSchluessel(ANNA), "cm");
    window.localStorage.setItem(MASSEINHEIT_SCHLUESSEL_ALT, "mm");
    masseinheitZuruecksetzen();
    masseinheitBenutzerSetzen(ANNA);
    expect(masseinheit()).toBe("cm");
    expect(window.localStorage.getItem(MASSEINHEIT_SCHLUESSEL_ALT)).toBeNull();
  });
});
