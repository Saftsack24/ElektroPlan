import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gibtUngespeicherteAenderungen, useUngespeicherteAenderungen, verlassenBestaetigen } from "./ungespeichert";

function Halter({ aktiv }: { aktiv: boolean }) {
  useUngespeicherteAenderungen(aktiv, "Wirklich verlassen?");
  return <a href="#projekte">Alle Projekte</a>;
}

afterEach(() => vi.restoreAllMocks());

describe("Schutz vor stillem Verwerfen", () => {
  it("fragt nur nach, solange ungespeicherte Änderungen gemeldet sind", () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerender, unmount } = render(<Halter aktiv={false} />);
    expect(verlassenBestaetigen()).toBe(true);
    expect(frage).not.toHaveBeenCalled();

    rerender(<Halter aktiv />);
    expect(gibtUngespeicherteAenderungen()).toBe(true);
    expect(verlassenBestaetigen()).toBe(false);
    expect(frage).toHaveBeenCalledWith("Wirklich verlassen?");

    unmount();
    expect(gibtUngespeicherteAenderungen()).toBe(false);
  });

  it("fängt Links nicht mehr selbst ab - das übernimmt der Navigationsschutz des Routers", () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByText } = render(<Halter aktiv />);
    const klick = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(getByText("Alle Projekte"), klick);
    // Kein zweiter, eigener Dialog: Sonst fragte ein Router-Link doppelt.
    expect(frage).not.toHaveBeenCalled();
  });

  it("setzt die Browserwarnung beim Verlassen der Seite", () => {
    render(<Halter aktiv />);
    const ereignis = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
  });
});
