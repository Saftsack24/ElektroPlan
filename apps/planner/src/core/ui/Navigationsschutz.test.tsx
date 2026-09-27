import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Link, Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Navigationsschutz } from "./Navigationsschutz";
import { useUngespeicherteAenderungen } from "./ungespeichert";

/**
 * Navigationsschutz über den Blocker des Data Routers.
 *
 * Ein Speicherrouter spielt den Browserverlauf nach: `navigate(-1)` ist
 * Browser-Zurück, `navigate(1)` Browser-Vorwärts (beides `POP`). Ersetzt wird
 * nur die Browsergrenze `window.confirm`.
 */
function Entwurfsseite() {
  const [text, setText] = useState("");
  useUngespeicherteAenderungen(text !== "");
  return (
    <div>
      <input aria-label="Entwurf" value={text} onChange={(e) => setText(e.target.value)} />
      <Link to="/ziel">Zum Ziel</Link>
    </div>
  );
}

function aufbauen(eintraege: string[], index: number) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <Navigationsschutz />
            <Outlet />
          </>
        ),
        children: [
          { path: "/start", element: <p>Startseite</p> },
          { path: "/editor", element: <Entwurfsseite /> },
          { path: "/ziel", element: <p>Zielseite</p> },
        ],
      },
    ],
    { initialEntries: eintraege, initialIndex: index },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function aendern() {
  fireEvent.change(screen.getByLabelText("Entwurf"), { target: { value: "Wand verschoben" } });
}

afterEach(() => vi.restoreAllMocks());

describe("Navigationsschutz", () => {
  it("fragt ohne Änderungen nicht", async () => {
    const frage = vi.spyOn(window, "confirm");
    const router = aufbauen(["/start", "/editor"], 1);
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/start");
    expect(frage).not.toHaveBeenCalled();
  });

  it("blockiert Browser-Zurück; „bleiben“ erhält URL und Entwurf", async () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValue(false);
    const router = aufbauen(["/start", "/editor"], 1);
    aendern();
    await act(() => router.navigate(-1));
    await waitFor(() => expect(frage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.state.navigation.state).toBe("idle"));
    expect(router.state.location.pathname).toBe("/editor");
    expect(screen.getByLabelText("Entwurf")).toHaveValue("Wand verschoben");
  });

  it("„verlassen“ führt Browser-Zurück genau einmal aus", async () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValue(true);
    const router = aufbauen(["/start", "/editor"], 1);
    aendern();
    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe("/start"));
    expect(frage).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Startseite")).toBeInTheDocument();
  });

  it("schützt Browser-Vorwärts ebenso", async () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const router = aufbauen(["/editor", "/ziel"], 0);
    aendern();
    await act(() => router.navigate(1));
    await waitFor(() => expect(frage).toHaveBeenCalledTimes(1));
    expect(router.state.location.pathname).toBe("/editor");
    expect(screen.getByLabelText("Entwurf")).toHaveValue("Wand verschoben");

    await act(() => router.navigate(1));
    await waitFor(() => expect(router.state.location.pathname).toBe("/ziel"));
    expect(frage).toHaveBeenCalledTimes(2);
  });

  it("fragt bei einem internen Link genau einmal", async () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValue(true);
    const router = aufbauen(["/editor"], 0);
    aendern();
    fireEvent.click(screen.getByText("Zum Ziel"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/ziel"));
    expect(frage).toHaveBeenCalledTimes(1);
  });

  it("lässt einen abgelehnten Link auf der Seite", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const router = aufbauen(["/editor"], 0);
    aendern();
    fireEvent.click(screen.getByText("Zum Ziel"));
    await waitFor(() => expect(router.state.navigation.state).toBe("idle"));
    expect(router.state.location.pathname).toBe("/editor");
    expect(screen.getByLabelText("Entwurf")).toHaveValue("Wand verschoben");
  });

  it("lässt beforeunload weiter warnen", () => {
    aufbauen(["/editor"], 0);
    aendern();
    const ereignis = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
  });
});
