import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";
import { RAUM } from "./testdaten";
import { raumInListe } from "../arbeitsflaeche/testhilfe";

/**
 * Wandzuordnung im Grundriss-Editor (Phase 6a) - Integration über den
 * Projekt-Tab: Zustand an der gewählten Wand, Markierung im Grundriss und das
 * ausdrückliche Lösen beim Entfernen einer gekoppelten Wand.
 *
 * „0.01 Wohnzimmer“ 0…5000 × 0…4000 (`w2` = (5000,0)->(5000,4000)) und „Flur“
 * 5000…8000 (`raum-2-w3` = (5000,4000)->(5000,0)) liegen an x = 5000 aufeinander.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }), usePermission: () => true }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const KOPPLUNG = {
  id: "k1",
  wall_a_id: "raum-2-w3",
  wall_b_id: "w2",
  relation: "separate" as const,
  origin: "user" as const,
  status: "active" as const,
  thickness_conflict: false,
  version: 2,
  created_at: "2026-10-06T08:00:00Z",
  updated_at: "2026-10-06T08:00:00Z",
};

let plan: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  plan = {
    floor_id: "geschoss-1",
    project_id: "projekt-1",
    rooms: [RAUM, rechteck("raum-2", "Flur", [5000, 0], [8000, 4000])],
    wall_links: [KOPPLUNG],
    wall_link_candidates: [],
  };
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve([{ id: "geschoss-1", building_id: "gebaeude-1", name: "Erdgeschoss", default_ceiling_height_mm: 2500 }]);
    if (pfad.endsWith("/plan")) return Promise.resolve(plan);
    return Promise.resolve([]);
  });
  api.put.mockImplementation(() => Promise.resolve({ ...RAUM, version: 6 }));
});

function zeigen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <RueckfrageProvider>
        <RoomsTab />
      </RueckfrageProvider>
    </QueryClientProvider>,
  );
}

function bild(x: number, y: number): { clientX: number; clientY: number } {
  const g = document.querySelector("svg.grundriss__svg g[transform]");
  const m = (g?.getAttribute("transform") ?? "").match(/matrix\(([^)]+)\)/)?.[1]?.split(" ").map(Number) ?? [];
  const [a = 0, , , d = 0, e = 0, f = 0] = m;
  return { clientX: e + x * a, clientY: f + y * d };
}

function klick(ziel: Element, x: number, y: number) {
  const svg = document.querySelector("svg.grundriss__svg") as Element;
  for (const [element, typ] of [[ziel, "pointerdown"], [svg, "pointerup"], [ziel, "click"]] as const) {
    fireEvent(element, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, ...bild(x, y) }));
  }
}

async function wandW2Waehlen() {
  await screen.findByRole("application", { name: /Grundriss/ });
  fireEvent.click(await raumInListe(/0.01 Wohnzimmer/));
  klick(await screen.findByTestId("wand-w2"), 4990, 2000);
  return screen.findByRole("region", { name: "Wandzuordnung" });
}

describe("Wandzuordnung im Editor", () => {
  it("zeigt den Zustand an der gewählten Wand und markiert getrennte Wände im Grundriss", async () => {
    zeigen();
    const bereich = await wandW2Waehlen();
    expect(within(bereich).getByText("Getrennte Wände")).toBeInTheDocument();
    expect(within(bereich).getByText(/mit Wand 4 von „Flur“/)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-testid='abschnitt-getrennt']")).toHaveLength(1);
  });

  it("Entfernen einer gekoppelten Wand: Rückfrage, dann ausdrücklich mit removed_wall_link_ids", async () => {
    zeigen();
    await wandW2Waehlen();
    fireEvent.click(screen.getByRole("button", { name: "Wand entfernen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));

    const dialog = await screen.findByRole("dialog", { name: "Wandzuordnung mit lösen?" });
    expect(within(dialog).getByText(/Getrennte Wände mit „Flur“/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern und Zuordnung lösen" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const anfrage = api.put.mock.calls[0]?.[1] as { body: { removed_wall_link_ids: string[]; walls: { id: string }[] } };
    expect(anfrage.body.removed_wall_link_ids).toEqual(["k1"]);
    expect(anfrage.body.walls.map((w) => w.id)).not.toContain("w2");
  });

  it("Abbrechen der Rückfrage speichert nichts", async () => {
    zeigen();
    await wandW2Waehlen();
    fireEvent.click(screen.getByRole("button", { name: "Wand entfernen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));
    const dialog = await screen.findByRole("dialog", { name: "Wandzuordnung mit lösen?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Nicht speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.put).not.toHaveBeenCalled();
  });
});
