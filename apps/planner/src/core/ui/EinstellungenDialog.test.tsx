import { ApiError } from "@elektroplan/api-client";
import type { PreferencesOut } from "@elektroplan/api-client";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Einstellungsdialog mit serverseitiger Speicherung (Phase 4e, ADR 0021):
 * Vorschau sofort, gespeichert erst mit „Übernehmen" auf dem Server,
 * Abbrechen stellt den gültigen Stand her, Konflikte mit einem anderen Gerät
 * werden erklärt statt still überschrieben.
 */
const { api, server } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  server: { stand: null as null | { theme_mode: string; accent: string; length_unit: string; version: number } },
}));

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ api }) }));

const { einstellungenAnmelden, einstellungenLaden } = await import("../einstellungen/persoenlich");
const { darstellungszustand } = await import("../theme/darstellung");
const { EinstellungenDialog } = await import("./EinstellungenDialog");
const { masseinheit } = await import("./masseinheit");

const ANNA = { benutzerId: "11111111-1111-4111-8111-111111111111", mitgliedId: "aaaaaaaa-1111-4111-8111-111111111111" };
const wurzel = () => document.documentElement;

function problem(status: number, typ: string): ApiError {
  return new ApiError(status, { type: `https://elektroplan.internal/errors/${typ}`, title: "x", status }, null);
}

function antwort(): PreferencesOut {
  const stand = server.stand;
  return stand === null
    ? { stored: false, theme_mode: "system", accent: "blue", length_unit: "cm", version: 0 }
    : ({ stored: true, ...stand } as PreferencesOut);
}

function Aufbau() {
  const [offen, setOffen] = useState(false);
  return (
    <StrictMode>
      <button type="button" onClick={() => setOffen(true)}>
        Einstellungen öffnen
      </button>
      <EinstellungenDialog offen={offen} onClose={() => setOffen(false)} />
    </StrictMode>
  );
}

async function anmelden() {
  einstellungenAnmelden(ANNA);
  await act(() => einstellungenLaden(api as never));
}

async function oeffnen() {
  render(<Aufbau />);
  const knopf = screen.getByRole("button", { name: "Einstellungen öffnen" });
  knopf.focus();
  fireEvent.click(knopf);
  const dialog = screen.getByRole("dialog", { name: "Einstellungen" });
  // Beim Öffnen wird der Serverstand neu gelesen.
  await waitFor(() => expect(within(dialog).queryByText(/Aktueller Stand wird geladen/)).toBeNull());
  return dialog;
}

beforeEach(() => {
  vi.clearAllMocks();
  server.stand = null;
  api.get.mockImplementation(() => Promise.resolve(antwort()));
  api.post.mockImplementation((_pfad: string, optionen: { body: Record<string, string> }) => {
    if (server.stand !== null) return Promise.reject(problem(409, "preferences-exist"));
    server.stand = { theme_mode: optionen.body["theme_mode"] ?? "", accent: optionen.body["accent"] ?? "", length_unit: optionen.body["length_unit"] ?? "", version: 1 };
    return Promise.resolve(antwort());
  });
  api.put.mockImplementation((_pfad: string, optionen: { ifMatch: number; body: Record<string, string> }) => {
    if (server.stand === null) return Promise.reject(problem(404, "not-found"));
    if (optionen.ifMatch !== server.stand.version) return Promise.reject(problem(409, "version-conflict"));
    server.stand = {
      theme_mode: optionen.body["theme_mode"] ?? "",
      accent: optionen.body["accent"] ?? "",
      length_unit: optionen.body["length_unit"] ?? "",
      version: server.stand.version + 1,
    };
    return Promise.resolve(antwort());
  });
});

describe("Einstellungsdialog", () => {
  it("gliedert Darstellung, Akzentfarbe und Maßeinheit (mit Meter) und nennt den Speicherort", async () => {
    await anmelden();
    const dialog = await oeffnen();
    for (const gruppe of ["Darstellung", "Akzentfarbe", "Maßeinheit für Längen"]) {
      expect(within(dialog).getByRole("group", { name: gruppe })).toBeInTheDocument();
    }
    expect(within(dialog).getByText(/auf allen Ihren Geräten/)).toBeInTheDocument();
    for (const name of [/ElektroPlan Blau/, /Türkis/, /Grün/, /Violett/, /Orange/]) {
      expect(within(dialog).getByRole("radio", { name })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole("radio", { name: /Meter \(m\) - z\. B\. 0,115 m, 2,500 m/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /Wie das System/ })).toHaveFocus();
  });

  it("zeigt Änderungen sofort als Vorschau, ohne zu speichern", async () => {
    await anmelden();
    const dialog = await oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dunkel" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Türkis/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Meter/ }));
    expect(wurzel().dataset["theme"]).toBe("dark");
    expect(wurzel().dataset["accent"]).toBe("teal");
    expect(masseinheit()).toBe("m");
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("Abbrechen stellt den gespeicherten Stand vollständig wieder her und gibt den Fokus zurück", async () => {
    server.stand = { theme_mode: "light", accent: "green", length_unit: "cm", version: 3 };
    await anmelden();
    const dialog = await oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dunkel" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Violett/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Millimeter/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(wurzel().dataset["theme"]).toBe("light");
    expect(wurzel().dataset["accent"]).toBe("green");
    expect(masseinheit()).toBe("cm");
    expect(server.stand.version).toBe(3);
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(screen.getByRole("button", { name: "Einstellungen öffnen" })).toHaveFocus();
  });

  it("Escape wirkt wie Abbrechen", async () => {
    await anmelden();
    const dialog = await oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dunkel" }));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(darstellungszustand().darstellung.modus).toBe("system");
    expect(darstellungszustand().vorschau).toBe(false);
  });

  it("Übernehmen legt beim ersten Mal an und ändert danach mit If-Match", async () => {
    await anmelden();
    let dialog = await oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Hell" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Orange/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Meter/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.post).toHaveBeenCalledWith("/api/v1/me/preferences", {
      body: { theme_mode: "light", accent: "orange", length_unit: "m" },
    });
    expect(wurzel().dataset["accent"]).toBe("orange");
    expect(masseinheit()).toBe("m");
    expect(darstellungszustand().vorschau).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Einstellungen öffnen" }));
    dialog = screen.getByRole("dialog", { name: "Einstellungen" });
    await waitFor(() => expect(within(dialog).queryByText(/Aktueller Stand wird geladen/)).toBeNull());
    expect(within(dialog).getByRole("radio", { name: /Meter/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dunkel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.put).toHaveBeenCalledWith("/api/v1/me/preferences", {
      ifMatch: 1,
      body: { theme_mode: "dark", accent: "orange", length_unit: "m" },
    });
    expect(server.stand?.version).toBe(2);
  });

  it("lädt beim Öffnen den aktuellen Serverstand - etwa von einem anderen Gerät", async () => {
    server.stand = { theme_mode: "light", accent: "blue", length_unit: "cm", version: 1 };
    await anmelden();
    server.stand = { theme_mode: "dark", accent: "teal", length_unit: "mm", version: 2 };
    const dialog = await oeffnen();
    expect(within(dialog).getByRole("radio", { name: "Dunkel" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Türkis/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Millimeter/ })).toBeChecked();
  });

  it("erklärt einen Konflikt mit einem anderen Gerät und überschreibt nichts still", async () => {
    server.stand = { theme_mode: "light", accent: "blue", length_unit: "cm", version: 1 };
    await anmelden();
    const dialog = await oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Violett/ }));
    // Ein zweites Gerät speichert, während der Dialog offen ist.
    server.stand = { theme_mode: "dark", accent: "green", length_unit: "m", version: 2 };
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect(await within(dialog).findByText(/auf einem anderen Gerät geändert/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Einstellungen" })).toBeInTheDocument();
    // Der Stand des anderen Geräts gilt und steht im Entwurf.
    expect(server.stand).toEqual({ theme_mode: "dark", accent: "green", length_unit: "m", version: 2 });
    expect(wurzel().dataset["accent"]).toBe("green");
    expect(within(dialog).getByRole("radio", { name: /Grün/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Meter/ })).toBeChecked();
  });

  it("zeigt einen Speicherfehler und lässt die Vorschau stehen", async () => {
    await anmelden();
    api.post.mockRejectedValueOnce(new ApiError(500, null, null));
    const dialog = await oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dunkel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect(await within(dialog).findByText(/konnten nicht gespeichert werden/)).toBeInTheDocument();
    expect(wurzel().dataset["theme"]).toBe("dark");
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(darstellungszustand().darstellung.modus).toBe("system");
  });

  it("Zurücksetzen zeigt den Standard als Vorschau und speichert erst mit Übernehmen", async () => {
    server.stand = { theme_mode: "dark", accent: "violet", length_unit: "mm", version: 5 };
    await anmelden();
    const dialog = await oeffnen();
    fireEvent.click(within(dialog).getByRole("button", { name: "Auf Standard zurücksetzen" }));
    expect(within(dialog).getByRole("radio", { name: /Wie das System/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /ElektroPlan Blau/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Zentimeter/ })).toBeChecked();
    expect(wurzel().dataset["accent"]).toBe("blue");
    expect(masseinheit()).toBe("cm");
    expect(server.stand.version).toBe(5);
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.stand).toEqual({ theme_mode: "system", accent: "blue", length_unit: "cm", version: 6 });
  });

  it("beginnt beim erneuten Öffnen mit dem gespeicherten Stand", async () => {
    await anmelden();
    let dialog = await oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dunkel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen öffnen" }));
    dialog = screen.getByRole("dialog", { name: "Einstellungen" });
    expect(within(dialog).getByRole("radio", { name: /Wie das System/ })).toBeChecked();
  });
});
