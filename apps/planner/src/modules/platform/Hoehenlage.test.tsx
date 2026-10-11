import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../core/ui/masseinheit";

/**
 * Bestätigte Höhenlage in der Projektstruktur (Phase 6a.0, ADR 0025):
 * Anzeige „bestätigt“/„nicht bestätigt“ neben jeder Höhenlage, Bestätigen und
 * Zurücknehmen ohne Wertänderung, und eine geänderte Höhenlage ist erst nach
 * ausdrücklicher Bestätigung im selben Speichervorgang bestätigt.
 */
const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
vi.mock("../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }), usePermission: () => true }));

const { ProjectStructureTab } = await import("./ProjectStructureTab");

const ZEIT = "2026-10-06T08:00:00Z";
const GEBAEUDE = { id: "gebaeude-1", project_id: "projekt-1", name: "Haupthaus", sort_order: 0, version: 1, created_at: ZEIT, updated_at: ZEIT };
const geschoss = (id: string, name: string, level: number, elevation: number, bestaetigt: boolean) => ({
  id,
  building_id: "gebaeude-1",
  name,
  level,
  elevation_mm: elevation,
  elevation_confirmed: bestaetigt,
  default_ceiling_height_mm: 2500,
  version: 3,
  created_at: ZEIT,
  updated_at: ZEIT,
});

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  api.get.mockImplementation((pfad: string) => {
    if (pfad.endsWith("/buildings")) return Promise.resolve([GEBAEUDE]);
    if (pfad.endsWith("/floors")) {
      return Promise.resolve([geschoss("eg", "EG", 0, 0, false), geschoss("og", "OG", 1, 2900, true)]);
    }
    return Promise.resolve([]);
  });
  api.patch.mockResolvedValue({});
});

function zeigen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectStructureTab projectId="projekt-1" schreibgeschuetzt={false} />
    </QueryClientProvider>,
  );
}

describe("Höhenlage in der Projektstruktur", () => {
  it("zeigt neben jeder Höhenlage, ob sie bestätigt ist - auch das EG mit 0 nicht automatisch", async () => {
    zeigen();
    const status = await screen.findAllByTestId("hoehenlage-status-eg");
    expect(status[0]).toHaveTextContent("nicht bestätigt");
    expect(screen.getAllByTestId("hoehenlage-status-og")[0]).toHaveTextContent("Höhenlage bestätigt");
    expect(screen.getByTestId("hoehenlage-hinweis")).toHaveTextContent(/nicht als verlässlich/);
  });

  it("Bestätigen ohne Wertänderung sendet nur die Bestätigung", async () => {
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Höhenlage von EG bearbeiten" }));
    const formular = screen.getByRole("form", { name: "Höhenlage von EG" });
    fireEvent.click(within(formular).getByLabelText("Höhenlage bestätigt"));
    fireEvent.click(within(formular).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith("/api/v1/floors/{floor_id}", {
      path: { floor_id: "eg" },
      ifMatch: 3,
      body: { elevation_confirmed: true },
    });
  });

  it("ein geänderter Wert verliert die Bestätigung, bis sie ausdrücklich neu gesetzt wird", async () => {
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Höhenlage von OG bearbeiten" }));
    const formular = screen.getByRole("form", { name: "Höhenlage von OG" });
    expect(within(formular).getByLabelText("Höhenlage bestätigt")).toBeChecked();
    fireEvent.change(within(formular).getByLabelText(/Höhenlage \(FFB\)/), { target: { value: "295" } });
    const neu = within(formular).getByLabelText("Neue Höhenlage bestätigen");
    expect(neu).not.toBeChecked();
    fireEvent.click(within(formular).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch.mock.calls[0]?.[1]).toMatchObject({ body: { elevation_mm: 2950, elevation_confirmed: false } });
  });

  it("Bestätigung zurücknehmen", async () => {
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Höhenlage von OG bearbeiten" }));
    const formular = screen.getByRole("form", { name: "Höhenlage von OG" });
    fireEvent.click(within(formular).getByLabelText("Höhenlage bestätigt"));
    fireEvent.click(within(formular).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch.mock.calls[0]?.[1]).toMatchObject({ body: { elevation_confirmed: false } });
  });

  it("ein neues Geschoss ist ohne Häkchen unbestätigt", async () => {
    api.post.mockResolvedValue({});
    zeigen();
    fireEvent.change(await screen.findByLabelText("Bezeichnung"), { target: { value: "DG" } });
    fireEvent.change(screen.getByLabelText("Ebene"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Geschoss hinzufügen" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0]?.[1]).toMatchObject({ body: { name: "DG", level: 2, elevation_confirmed: false } });
  });
});
