import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";

/**
 * Raumentwurf und Stromkreiszuordnung (Phase 6b.1): Wer ein zugeordnetes Gerät
 * entfernt, erfährt es in der **bestehenden** Rückfrage beim Speichern – mit
 * Stromkreis und Verlust der Zuordnung. Ohne Bestätigung wird nichts gespeichert.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }), usePermission: () => true }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const TYPEN = [
  {
    key: "socket_single",
    label: "Steckdose",
    category: "socket",
    symbol_key: "socket_single",
    allows_wall_interior: true,
    allows_wall_exterior: false,
    allows_ceiling: false,
    default_center_height_mm: 300,
    width_mm: 80,
    height_mm: 80,
    sort_order: 10,
    is_active: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  const plan = {
    floor_id: "geschoss-1",
    project_id: "projekt-1",
    wall_links: [],
    wall_link_candidates: [],
    rooms: [
      rechteck("raum-1", "Küche", [0, 0], [5000, 4000], {
        nummer: "0.01",
        geraete: [{ id: "steckdose", typ: "socket_single", wand: 0, mitte: 2500, hoehe: 300 }],
      }),
    ],
  };
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve([{ id: "geschoss-1", building_id: "gebaeude-1", name: "Erdgeschoss", level: 0, default_ceiling_height_mm: 2500 }]);
    if (pfad.endsWith("/plan")) return Promise.resolve(plan);
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    if (pfad.endsWith("/distribution-boards")) {
      return Promise.resolve({ building_id: "gebaeude-1", boards: [{ id: "uv1", code: "UV1", name: "UV Flur", placement_device_id: null }] });
    }
    if (pfad.endsWith("/circuits")) {
      return Promise.resolve({
        building_id: "gebaeude-1",
        circuits: [{ id: "f1", board_id: "uv1", designation: "F1", name: "Küche Steckdosen", device_ids: ["steckdose"], version: 1 }],
      });
    }
    return Promise.resolve([]);
  });
});

function druecken(ziel: Element) {
  for (const t of ["pointerdown", "pointerup", "click"]) fireEvent(ziel, new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 }));
}

describe("Zugeordnetes Gerät entfernen", () => {
  it("nennt Stromkreis und Verlust der Zuordnung in der Speicher-Rückfrage", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <RueckfrageProvider>
          <RoomsTab />
        </RueckfrageProvider>
      </QueryClientProvider>,
    );
    const geraet = await screen.findByTestId("grundriss-geraet-steckdose");
    druecken(geraet.querySelector("rect.grundriss__geraet-treffer") as Element);
    fireEvent.click(await screen.findByRole("button", { name: "Gerät entfernen" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Speichern" })).toBeEnabled());
    // Stromkreise müssen geladen sein, bevor gespeichert wird.
    await waitFor(() => expect(api.get.mock.calls.some(([p]) => String(p).endsWith("/circuits"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    const frage = await screen.findByRole("dialog");
    expect(within(frage).getByText("Stromkreiszuordnung mit entfernen?")).toBeInTheDocument();
    expect(within(frage).getByText(/Beim Speichern geht diese Zuordnung verloren/)).toBeInTheDocument();
    expect(within(frage).getByText("Steckdose – Stromkreis UV1 · F1 Küche Steckdosen")).toBeInTheDocument();
    fireEvent.click(within(frage).getByRole("button", { name: "Nicht speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.put).not.toHaveBeenCalled();
  });
});
