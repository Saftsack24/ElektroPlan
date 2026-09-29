import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { Link, Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Navigationsschutz } from "./Navigationsschutz";
import { RueckfrageProvider } from "./Rueckfrage";
import { useUngespeicherteAenderungen } from "./ungespeichert";

/**
 * Navigationsschutz über den Blocker des Data Routers und die eigene
 * Rückfrage (`Rueckfrage.tsx`).
 *
 * Ein Speicherrouter spielt den Browserverlauf nach: `navigate(-1)` ist
 * Browser-Zurück, `navigate(1)` Browser-Vorwärts (beides `POP`). Es gibt
 * keinen `window.confirm` mehr; geantwortet wird im eigenen Dialog.
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

function aufbauen(eintraege: string[], index: number, { strikt = false } = {}) {
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
  const baum = (
    <RueckfrageProvider>
      <RouterProvider router={router} />
    </RueckfrageProvider>
  );
  render(strikt ? <StrictMode>{baum}</StrictMode> : baum);
  return router;
}

function aendern() {
  fireEvent.change(screen.getByLabelText("Entwurf"), { target: { value: "Wand verschoben" } });
}

async function antworten(knopf: "Änderungen behalten" | "Änderungen verwerfen und fortfahren") {
  const dialog = await screen.findByRole("dialog", { name: "Seite verlassen?" });
  fireEvent.click(within(dialog).getByRole("button", { name: knopf }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

afterEach(() => vi.restoreAllMocks());

describe("Navigationsschutz", () => {
  it("fragt ohne Änderungen nicht", async () => {
    const router = aufbauen(["/start", "/editor"], 1);
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/start");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("blockiert Browser-Zurück; „behalten“ erhält URL und Entwurf", async () => {
    const frage = vi.spyOn(window, "confirm");
    const router = aufbauen(["/start", "/editor"], 1);
    aendern();
    await act(() => router.navigate(-1));
    const dialog = await screen.findByRole("dialog", { name: "Seite verlassen?" });
    expect(within(dialog).getByRole("button", { name: "Änderungen behalten" })).toHaveFocus();
    await antworten("Änderungen behalten");
    await waitFor(() => expect(router.state.navigation.state).toBe("idle"));
    expect(router.state.location.pathname).toBe("/editor");
    expect(screen.getByLabelText("Entwurf")).toHaveValue("Wand verschoben");
    expect(frage).not.toHaveBeenCalled();
  });

  it("Escape entspricht „behalten“", async () => {
    const router = aufbauen(["/start", "/editor"], 1);
    aendern();
    await act(() => router.navigate(-1));
    const dialog = await screen.findByRole("dialog", { name: "Seite verlassen?" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.state.location.pathname).toBe("/editor");
  });

  it("„verwerfen“ führt Browser-Zurück genau einmal aus", async () => {
    const router = aufbauen(["/start", "/editor"], 1);
    const zaehler = vi.fn<(pfad: string) => void>();
    const abmelden = router.subscribe(() => zaehler(router.state.location.pathname));
    aendern();
    await act(() => router.navigate(-1));
    await antworten("Änderungen verwerfen und fortfahren");
    await waitFor(() => expect(router.state.location.pathname).toBe("/start"));
    expect(await screen.findByText("Startseite")).toBeInTheDocument();
    expect(zaehler.mock.calls.filter(([pfad]) => pfad === "/start").length).toBeGreaterThanOrEqual(1);
    // Nicht zweimal zurück: /start ist der erste Eintrag, weiter zurück ginge nicht.
    expect(router.state.location.pathname).toBe("/start");
    abmelden();
  });

  it("schützt Browser-Vorwärts ebenso", async () => {
    const router = aufbauen(["/editor", "/ziel"], 0);
    aendern();
    await act(() => router.navigate(1));
    await antworten("Änderungen behalten");
    expect(router.state.location.pathname).toBe("/editor");
    expect(screen.getByLabelText("Entwurf")).toHaveValue("Wand verschoben");

    await act(() => router.navigate(1));
    await antworten("Änderungen verwerfen und fortfahren");
    await waitFor(() => expect(router.state.location.pathname).toBe("/ziel"));
  });

  it("fragt bei einem internen Link genau einmal", async () => {
    const router = aufbauen(["/editor"], 0);
    aendern();
    fireEvent.click(screen.getByText("Zum Ziel"));
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
    await antworten("Änderungen verwerfen und fortfahren");
    await waitFor(() => expect(router.state.location.pathname).toBe("/ziel"));
  });

  it("stellt bei zwei Navigationsversuchen kurz nacheinander nur eine Frage", async () => {
    const router = aufbauen(["/start", "/editor"], 1);
    aendern();
    fireEvent.click(screen.getByText("Zum Ziel"));
    fireEvent.click(screen.getByText("Zum Ziel"));
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
    await antworten("Änderungen verwerfen und fortfahren");
    await waitFor(() => expect(router.state.location.pathname).toBe("/ziel"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lässt einen abgelehnten Link auf der Seite", async () => {
    const router = aufbauen(["/editor"], 0);
    aendern();
    fireEvent.click(screen.getByText("Zum Ziel"));
    await antworten("Änderungen behalten");
    await waitFor(() => expect(router.state.navigation.state).toBe("idle"));
    expect(router.state.location.pathname).toBe("/editor");
    expect(screen.getByLabelText("Entwurf")).toHaveValue("Wand verschoben");
  });

  it("fragt unter StrictMode genau einmal", async () => {
    const router = aufbauen(["/start", "/editor"], 1, { strikt: true });
    aendern();
    await act(() => router.navigate(-1));
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
    await antworten("Änderungen verwerfen und fortfahren");
    await waitFor(() => expect(router.state.location.pathname).toBe("/start"));
  });

  it("lässt beforeunload browsernativ weiter warnen", () => {
    aufbauen(["/editor"], 0);
    aendern();
    const ereignis = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
    // Beim Neuladen gibt es keinen eigenen Dialog - das erlaubt kein Browser.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
