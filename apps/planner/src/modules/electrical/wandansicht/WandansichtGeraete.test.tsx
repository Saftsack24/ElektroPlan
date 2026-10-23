import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";
import { eigenschaftenOeffnen, raumInListe } from "../arbeitsflaeche/testhilfe";

/**
 * Geräte in Wand- und Deckenansicht über den echten Editor (Phase 5).
 * „0.01 Wohnzimmer“ 0…5000 × 0…4000, „0.02 Flur“ 5000…7000 × 0…4000. Wand 2 des
 * Wohnzimmers (x = 5000) ist gemeinsam; von innen steht das Wandende links.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }), usePermission: () => true }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const typ = (key: string, label: string, teile: Partial<Record<string, unknown>>) => ({
  key,
  label,
  category: "socket",
  symbol_key: key,
  allows_wall_interior: true,
  allows_wall_exterior: false,
  allows_ceiling: false,
  default_center_height_mm: 300,
  width_mm: 80,
  height_mm: 80,
  sort_order: 10,
  is_active: true,
  ...teile,
});
const TYPEN = [
  typ("socket_single", "Steckdose", {}),
  typ("socket_outdoor", "Steckdose, außen geeignet", { allows_wall_exterior: true, sort_order: 20 }),
  typ("light_ceiling", "Deckenleuchte (Auslass)", { category: "light", allows_wall_interior: false, allows_ceiling: true, default_center_height_mm: null, width_mm: 100, height_mm: 100, sort_order: 30 }),
];

let plan: { floor_id: string; project_id: string; rooms: { id: string; version: number }[] };

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  plan = {
    floor_id: "geschoss-1",
    project_id: "projekt-1",
    rooms: [rechteck("raum-1", "Wohnzimmer", [0, 0], [5000, 4000], { nummer: "0.01" }), rechteck("raum-2", "Flur", [5000, 0], [7000, 4000], { nummer: "0.02" })],
  };
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve([{ id: "geschoss-1", building_id: "gebaeude-1", name: "Erdgeschoss", default_ceiling_height_mm: 2500 }]);
    if (pfad.endsWith("/plan")) return Promise.resolve(plan);
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    return Promise.resolve([]);
  });
  api.put.mockImplementation((_pfad: string, optionen: { body: { devices: unknown[] } }) =>
    Promise.resolve({ ...plan.rooms[0], version: 2, devices: optionen.body.devices.map((g) => ({ ...(g as object), room_id: "raum-1", created_at: "", updated_at: "" })) }),
  );
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

function grundrissKlick(ziel: Element, x: number, y: number) {
  const g = document.querySelector("svg.grundriss__svg g[transform]");
  const [a = 0, , , d = 0, e = 0, f = 0] = (g?.getAttribute("transform") ?? "").match(/matrix\(([^)]+)\)/)?.[1]?.split(" ").map(Number) ?? [];
  for (const t of ["pointerdown", "pointerup", "click"]) {
    fireEvent(ziel, new MouseEvent(t, { bubbles: true, cancelable: true, button: 0, clientX: e + x * a, clientY: f + y * d }));
  }
}

async function wandansicht() {
  zeigen();
  await screen.findByRole("application", { name: /Grundriss/ });
  fireEvent.click(await raumInListe(/0.01 Wohnzimmer/));
  grundrissKlick(await screen.findByTestId("wand-raum-1-w1"), 5000, 2000);
  fireEvent.click(await screen.findByRole("button", { name: /^Wand bearbeiten$/ }));
  const dialog = await screen.findByRole("region", { name: /Wandansicht/ });
  // Lage und Typ des gewählten Geräts stehen im Eigenschaftenpanel (6c.0).
  await eigenschaftenOeffnen(dialog);
  return dialog;
}

const ansicht = () => document.querySelector<SVGSVGElement>("svg.ansicht__svg")!;
function bild(u: number, h: number) {
  const w = screen.getByTestId("wandflaeche");
  const [x, y, b, hoehe] = ["x", "y", "width", "height"].map((n) => Number(w.getAttribute(n))) as [number, number, number, number];
  return { clientX: x + (u * b) / 4000, clientY: y + hoehe - (h * hoehe) / 2500 };
}
function zeiger(ziel: Element, t: string, u: number, h: number) {
  fireEvent(ziel, new MouseEvent(t, { bubbles: true, cancelable: true, button: 0, ...bild(u, h) }));
}
const dlg = () => screen.getByRole("region", { name: /Wandansicht/ });

describe("Geräte in der Wandansicht (Phase 5)", () => {
  it("setzen per Zeiger, Ziehen als ein Rückgängig-Schritt, Speichern mit der Gerätemitte ab Wandanfang", async () => {
    await wandansicht();
    fireEvent.click(within(dlg()).getByRole("button", { name: "Gerät" }));
    await waitFor(() => expect(within(dlg()).getByRole<HTMLSelectElement>("combobox", { name: /Gerät für die Innenseite/ }).value).toBe("socket_single"));
    zeiger(ansicht(), "pointermove", 1000, 330);
    expect(screen.getByTestId("geraet-vorschau")).toHaveAttribute("data-gueltig", "ja");
    zeiger(ansicht(), "pointerdown", 1000, 330);
    zeiger(ansicht(), "pointerup", 1000, 330);
    await screen.findByText(/Steckdose gesetzt/);
    // Standardhöhe 30 cm eingerastet, Mitte 100 cm von links.
    expect(within(dlg()).getByRole<HTMLInputElement>("textbox", { name: /Mitte von links/ }).value).toBe("100");
    expect(within(dlg()).getByRole<HTMLInputElement>("textbox", { name: /Höhe Mitte über Boden/ }).value).toBe("30");

    const geraet = dlg().querySelector("[data-geraet]")!;
    zeiger(geraet, "pointerdown", 1000, 300);
    for (const u of [1200, 1500, 2000]) zeiger(ansicht(), "pointermove", u, 300);
    zeiger(ansicht(), "pointerup", 2000, 300);
    expect(within(dlg()).getByRole<HTMLInputElement>("textbox", { name: /Mitte von links/ }).value).toBe("200");
    fireEvent.click(within(dlg()).getByRole("button", { name: "Rückgängig" }));
    expect(within(dlg()).getByRole<HTMLInputElement>("textbox", { name: /Mitte von links/ }).value).toBe("100");
    fireEvent.click(within(dlg()).getByRole("button", { name: "Wiederholen" }));

    fireEvent.click(within(dlg()).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const body = (api.put.mock.calls[0] as [string, { body: { devices: Record<string, unknown>[] } }])[1].body;
    // Von innen steht das Wandende links: Mitte 200 cm von links = 4000 − 2000 ab Wandanfang.
    expect(body.devices).toEqual([expect.objectContaining({ device_type_key: "socket_single", mounting_surface: "wall_interior", wall_id: "raum-1-w1", center_offset_mm: 2000, center_height_mm: 300 })]);
  });

  it("außen auf einem geteilten Wandstück ist kein Gerät möglich; der Seitenwechsel ändert nichts", async () => {
    await wandansicht();
    fireEvent.click(within(dlg()).getByRole("button", { name: "Außenseite ansehen" }));
    expect(within(dlg()).getByTestId("wandseite")).toHaveTextContent("Außenseite");
    fireEvent.click(within(dlg()).getByRole("button", { name: "Gerät" }));
    await waitFor(() => expect(within(dlg()).getByRole<HTMLSelectElement>("combobox", { name: /Gerät für die Fassade/ }).value).toBe("socket_outdoor"));
    zeiger(ansicht(), "pointermove", 1000, 1500);
    expect(screen.getByTestId("geraet-vorschau")).toHaveAttribute("data-gueltig", "nein");
    expect(screen.getByTestId("wand-statuszeile")).toHaveTextContent("grenzt an einen anderen Raum");
    expect(within(dlg()).getByText(/Keine ungespeicherten Änderungen/)).toBeInTheDocument();
  });
});
