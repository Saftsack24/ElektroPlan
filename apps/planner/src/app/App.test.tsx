import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, lazy } from "react";
import { createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { einstellungenAnmelden } from "../core/einstellungen/persoenlich";
import { masseinheit } from "../core/ui/masseinheit";
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
/** Stabil über alle Renderdurchläufe - wie der echte Client aus `useMemo`. */
const { appApi } = vi.hoisted(() => {
  const ohneStand = { stored: false, theme_mode: "system", accent: "blue", length_unit: "cm", version: 0 };
  return {
    appApi: {
      get: vi.fn((pfad: string) => Promise.resolve(pfad === "/api/v1/me/preferences" ? ohneStand : [])),
      post: vi.fn((_pfad: string, optionen: { body: Record<string, string> }) =>
        Promise.resolve({ stored: true, ...optionen.body, version: 1 }),
      ),
    },
  };
});

vi.mock("../core/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    status: "authenticated",
    me: { email: "admin@example.com", organization: { name: "Elektro Beispiel GmbH" } },
    activeModuleIds: new Set(["beispiel"]),
    permissions: new Set(["beispiel.lesen"]),
    logout: abmelden,
    api: appApi,
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

/** Beantwortet die eigene Rückfrage mit diesem Titel. */
async function antworten(titel: string, knopf: string) {
  const dialog = await screen.findByRole("dialog", { name: titel });
  fireEvent.click(within(dialog).getByRole("button", { name: knopf }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: titel })).toBeNull());
}

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

  it("blockiert unter StrictMode Browser-Zurück und -Vorwärts - mit genau einer eigenen Rückfrage", async () => {
    const frage = vi.spyOn(window, "confirm");
    const { router } = zeigen(["/zweite", "/beispiel", "/zweite"], 1);
    await screen.findByText("Beispielmodul mit Entwurf");

    await act(() => router.navigate(-1));
    await antworten("Seite verlassen?", "Änderungen behalten");
    expect(router.state.location.pathname).toBe("/beispiel");

    await act(() => router.navigate(1));
    await antworten("Seite verlassen?", "Änderungen behalten");
    expect(router.state.location.pathname).toBe("/beispiel");
    expect(screen.getByText("Beispielmodul mit Entwurf")).toBeInTheDocument();

    await act(() => router.navigate(-1));
    await antworten("Seite verlassen?", "Änderungen verwerfen und fortfahren");
    await waitFor(() => expect(router.state.location.pathname).toBe("/zweite"));
    expect(frage).not.toHaveBeenCalled();
  });

  it("fragt in der Hauptnavigation genau einmal und bleibt bei Ablehnung", async () => {
    const { router } = zeigen(["/beispiel"]);
    await screen.findByText("Beispielmodul mit Entwurf");
    fireEvent.click(screen.getByRole("link", { name: "Übersicht" }));
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
    await antworten("Seite verlassen?", "Änderungen behalten");
    expect(router.state.location.pathname).toBe("/beispiel");
    expect(screen.getByText("Beispielmodul mit Entwurf")).toBeInTheDocument();
  });

  it("Abmelden fragt über die eigene Rückfrage und meldet erst nach Bestätigung genau einmal ab", async () => {
    const frage = vi.spyOn(window, "confirm");
    zeigen(["/beispiel"]);
    await screen.findByText("Beispielmodul mit Entwurf");
    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    await antworten("Abmelden?", "Änderungen behalten");
    expect(abmelden).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    // Ein zweiter Klick, während die Rückfrage offen ist, zählt nicht doppelt.
    fireEvent.click(screen.getByRole("button", { name: "Abmelden", hidden: true }));
    await antworten("Abmelden?", "Änderungen verwerfen und fortfahren");
    expect(abmelden).toHaveBeenCalledTimes(1);
    expect(frage).not.toHaveBeenCalled();
  });

  it("stellt die Maßeinheit in den Einstellungen um und speichert sie auf dem Server", async () => {
    // Den angemeldeten Benutzer meldet sonst der (hier ersetzte) AuthProvider.
    einstellungenAnmelden({
      benutzerId: "33333333-3333-4333-8333-333333333333",
      mitgliedId: "cccccccc-3333-4333-8333-333333333333",
    });
    zeigen(["/zweite"]);
    await screen.findByText("Zweite Seite");
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }));
    const dialog = await screen.findByRole("dialog", { name: "Einstellungen" });
    expect(within(dialog).getByLabelText(/Zentimeter/)).toBeChecked();
    expect(within(dialog).getByText(/gespeicherten Planmaße bleiben unverändert/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText(/Millimeter/));
    expect(within(dialog).getByLabelText(/Millimeter/)).toBeChecked();
    // Zunächst nur Vorschau - gespeichert wird mit „Übernehmen".
    expect(appApi.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Einstellungen" })).toBeNull());
    expect(appApi.post).toHaveBeenCalledWith("/api/v1/me/preferences", {
      body: { theme_mode: "system", accent: "blue", length_unit: "mm" },
    });
    expect(masseinheit()).toBe("mm");
  });

  it("öffnet die Einladungsseite ohne Anwendungshülle - auch bei bestehender Sitzung", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ type: "x/invitation-invalid", title: "x", status: 404 }), {
        status: 404,
      }),
    );
    zeigen(["/einladung#t=abc"]);
    expect(await screen.findByRole("heading", { name: "Einladung annehmen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abmelden" })).toBeNull();
    expect(routerErzeugt).not.toHaveBeenCalled();
  });

  it("zeigt für nicht freigegebene Routen nur einen Hinweis", async () => {
    zeigen(["/administration/users"]);
    expect(await screen.findByText(/fehlt die Berechtigung/)).toBeInTheDocument();
  });
});
