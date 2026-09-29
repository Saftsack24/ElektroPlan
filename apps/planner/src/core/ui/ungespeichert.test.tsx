import { fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gibtUngespeicherteAenderungen, ungespeichertMeldung, useUngespeicherteAenderungen } from "./ungespeichert";

function Halter({ aktiv }: { aktiv: boolean }) {
  useUngespeicherteAenderungen(aktiv, "Der Entwurf geht verloren.");
  return <a href="#projekte">Alle Projekte</a>;
}

afterEach(() => vi.restoreAllMocks());

describe("Meldestelle für ungespeicherte Änderungen", () => {
  it("meldet nur, solange eine Stelle ungespeicherte Änderungen hält", () => {
    const { rerender, unmount } = render(<Halter aktiv={false} />);
    expect(gibtUngespeicherteAenderungen()).toBe(false);

    rerender(<Halter aktiv />);
    expect(gibtUngespeicherteAenderungen()).toBe(true);
    expect(ungespeichertMeldung()).toBe("Der Entwurf geht verloren.");

    unmount();
    expect(gibtUngespeicherteAenderungen()).toBe(false);
  });

  it("fragt nie über window.confirm - auch nicht bei Link-Klicks", () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByText } = render(<Halter aktiv />);
    const klick = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(getByText("Alle Projekte"), klick);
    expect(frage).not.toHaveBeenCalled();
  });

  it("beforeunload bleibt browsernativ registriert", () => {
    render(<Halter aktiv />);
    const ereignis = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
  });

  it("registriert unter StrictMode genau einen beforeunload-Listener und entfernt ihn wieder", () => {
    const hinzu = vi.spyOn(window, "addEventListener");
    const weg = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <StrictMode>
        <Halter aktiv />
      </StrictMode>,
    );
    const zaehlen = (spy: typeof hinzu) => spy.mock.calls.filter(([typ]) => typ === "beforeunload").length;
    // StrictMode spielt Einhängen, Aushängen, Einhängen durch: netto einer.
    expect(zaehlen(hinzu) - zaehlen(weg)).toBe(1);
    unmount();
    expect(zaehlen(hinzu) - zaehlen(weg)).toBe(0);
    expect(gibtUngespeicherteAenderungen()).toBe(false);
  });
});
