import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, lazy } from "react";
import { createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUngespeicherteAenderungen } from "../core/ui/ungespeichert";

/**
 * Anwendungswurzel auf dem Data Router (Phase 4a.1).
 *
 * Geprüft wird die Verdrahtung, nicht ein Fachmodul: Die Modul-Registry wird
 * durch Beispielmodule ersetzt, die Anmeldung durch einen festen Zustand.
 * Gerendert wird die echte `App` unter `StrictMode` - mit einem von außen
 * übergebenen Speicherrouter, so wie `main.tsx` den Browserrouter übergibt.
 */
const abmelden = vi.fn(() => Promise.resolve());

vi.mock("../core/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    status: "authenticated",
    me: { email: "admin@example.com", organization: { name: "Elektro Beispiel GmbH" } },
    activeModuleIds: new Set(["beispiel"]),
    permissions: new Set(["beispiel.lesen"]),
    logout: abmelden,
    api: { get: vi.fn(() => Promise.resolve([])) },
  }),
  usePermission: () => true,
}));

// Zählt, wie oft die App selbst einen Browserrouter erzeugen würde.
const routerErzeugt = vi.fn();
vi.mock("react-router-dom", async (original) => {
  const echt = await original<typeof import("react-router-dom")>();
  return {
    ...echt,
    createBrowserRouter: (...args: Parameters<typeof echt.createBrowserRouter>) => {
      routerErzeugt();
      return echt.createBrowserRouter(...args);
    },
  };
});

function Beispielseite() {
  useUngespeicherteAenderungen(true);
  return <p>Beispielmodul mit Entwurf</p>;
}

vi.mock("../modules", () => ({
  moduleRegistry: {
    routes: () => [
      { path: "/beispiel", element: lazy(() => Promise.resolve({ default: Beispielseite })) },
      { path: "/zweite", element: lazy(() => Promise.resolve({ default: () => <p>Zweite Seite</p> })) },
    ],
    projectTabs: () => [],
    navigation: () => [{ id: "beispiel", label: "Beispiel", to: "/beispiel", order: 1 }],
  },
}));

const { ANWENDUNGSROUTEN, App, erzeugeRouter } = await import("./App");

function zeigen(eintraege: string[], index = eintraege.length - 1) {
  const router = createMemoryRouter(ANWENDUNGSROUTEN, { initialEntries: eintraege, initialIndex: index });
  const ansicht = render(
    <StrictMode>
      <App router={router} />
    </StrictMode>,
  );
  return { router, ansicht };
}

beforeEach(() => {
  abmelden.mockClear();
  routerErzeugt.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("Anwendungswurzel", () => {
  it("rendert unter StrictMode mit übergebenem Router und erreicht eine dynamische Modulroute", async () => {
    zeigen(["/beispiel"]);
    expect(await screen.findByText("Beispielmodul mit Entwurf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Beispiel" })).toBeInTheDocument();
  });

  it("erzeugt beim Rendern und erneuten Rendern keinen eigenen Router", async () => {
    const { router, ansicht } = zeigen(["/zweite"]);
    await screen.findByText("Zweite Seite");
    await act(() => router.navigate("/beispiel"));
    ansicht.rerender(
      <StrictMode>
        <App router={router} />
      </StrictMode>,
    );
    expect(await screen.findByText("Beispielmodul mit Entwurf")).toBeInTheDocument();
    // Derselbe Router, derselbe Verlauf - kein neuer.
    expect(router.state.location.pathname).toBe("/beispiel");
    expect(routerErzeugt).not.toHaveBeenCalled();
  });

  it("die Factory erzeugt bei jedem Aufruf genau einen Router", () => {
    const router = erzeugeRouter();
    expect(routerErzeugt).toHaveBeenCalledTimes(1);
    router.dispose();
  });

  it("blockiert unter StrictMode Browser-Zurück und -Vorwärts", async () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { router } = zeigen(["/zweite", "/beispiel", "/zweite"], 1);
    await screen.findByText("Beispielmodul mit Entwurf");

    await act(() => router.navigate(-1));
    await waitFor(() => expect(frage).toHaveBeenCalledTimes(1));
    expect(router.state.location.pathname).toBe("/beispiel");

    await act(() => router.navigate(1));
    await waitFor(() => expect(frage).toHaveBeenCalledTimes(2));
    expect(router.state.location.pathname).toBe("/beispiel");
    expect(screen.getByText("Beispielmodul mit Entwurf")).toBeInTheDocument();

    frage.mockReturnValue(true);
    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe("/zweite"));
    expect(frage).toHaveBeenCalledTimes(3);
  });

  it("fragt in der Hauptnavigation genau einmal und bleibt bei Ablehnung", async () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { router } = zeigen(["/beispiel"]);
    await screen.findByText("Beispielmodul mit Entwurf");
    fireEvent.click(screen.getByRole("link", { name: "Übersicht" }));
    await waitFor(() => expect(frage).toHaveBeenCalledTimes(1));
    expect(router.state.location.pathname).toBe("/beispiel");
    expect(screen.getByText("Beispielmodul mit Entwurf")).toBeInTheDocument();
  });

  it("Abmelden fragt über den Core-Mechanismus und meldet erst nach Bestätigung ab", async () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    zeigen(["/beispiel"]);
    await screen.findByText("Beispielmodul mit Entwurf");
    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    expect(abmelden).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    expect(abmelden).toHaveBeenCalledTimes(1);
    expect(frage).toHaveBeenCalledTimes(2);
  });
});
