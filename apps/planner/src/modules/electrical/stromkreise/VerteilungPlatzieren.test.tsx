import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";
import { platzierungsfehler } from "./platzierung";

/**
 * Verteilung direkt im Plan platzieren (Phase 6c, VP) über den echten Projekt-Tab:
 * „Stromkreise“ → Geschoss und Raum → Wand im Grundriss → Wandansicht → speichern.
 * Atomarität, Versionen, Rechte und Schreibschutz prüft das Backend
 * (`tests/test_electrical_board_placement.py`); hier geht es um Ablauf, Entwurfsschutz
 * und Anfrage. „0.01 Diele“ 0…5000 × 0…4000, „0.02 Küche“ daneben. Synthetische Daten.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
let rechte = new Set(["electrical.plan.write", "electrical.circuit.write", "electrical.route.write"]);
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }), usePermission: (p: string) => rechte.has(p) }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const ZEIT = "2026-10-25T08:00:00Z";
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
  typ("distribution_board", "Verteilung", { category: "distribution", default_center_height_mm: 1400, width_mm: 550, height_mm: 700, sort_order: 90 }),
];
const verteilung = (id: string, code: string, placement: string | null, version = 3) => ({
  id,
  building_id: "gebaeude-1",
  code,
  name: `Verteilung ${code}`,
  note: null,
  placement_device_id: placement,
  version,
  created_at: ZEIT,
  updated_at: ZEIT,
});

let plan: { floor_id: string; project_id: string; rooms: ReturnType<typeof rechteck>[]; wall_links: never[]; wall_link_candidates: never[] };
let boards: ReturnType<typeof verteilung>[];

beforeEach(() => {
  vi.clearAllMocks();
  rechte = new Set(["electrical.plan.write", "electrical.circuit.write", "electrical.route.write"]);
  act(() => masseinheitSetzen("cm"));
  window.localStorage.setItem("elektroplan.electrical.ansicht", "stromkreise");
  plan = {
    floor_id: "geschoss-1",
    project_id: "projekt-1",
    rooms: [
      { ...rechteck("raum-1", "Diele", [0, 0], [5000, 4000], { nummer: "0.01", geraete: [{ id: "steckdose", typ: "socket_single", wand: 0, mitte: 4000, hoehe: 300 }] }), version: 7 },
      rechteck("raum-2", "Küche", [5000, 0], [8000, 4000], { nummer: "0.02" }),
      rechteck("raum-3", "Abstellraum", [0, 4000], [2000, 6000], { offen: true }),
    ],
    wall_links: [],
    wall_link_candidates: [],
  };
  boards = [verteilung("hv", "HV", null)];
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve([{ id: "geschoss-1", building_id: "gebaeude-1", name: "Erdgeschoss", level: 0, default_ceiling_height_mm: 2500 }]);
    if (pfad.endsWith("/plan")) return Promise.resolve(plan);
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    if (pfad.endsWith("/distribution-boards")) return Promise.resolve({ building_id: "gebaeude-1", boards });
    if (pfad.endsWith("/circuits")) return Promise.resolve({ building_id: "gebaeude-1", circuits: [] });
    if (pfad.endsWith("/cables")) return Promise.resolve({ building_id: "gebaeude-1", cables: [] });
    return Promise.resolve([]);
  });
  api.put.mockImplementation((pfad: string) =>
    pfad.endsWith("/placement")
      ? Promise.resolve({
          board: { ...verteilung("hv", "HV", "neu"), version: 4 },
          device: {},
          rooms: [{ id: "raum-1", floor_id: "geschoss-1", version: 8 }],
        })
      : Promise.reject(new Error(`unerwartet: ${pfad}`)),
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

/** Zeiger auf der Wandfläche (Wand 1 der Diele: 5 m lang, 2,5 m hoch). */
function zeiger(t: string, u: number, h: number) {
  const w = screen.getByTestId("wandflaeche");
  const [x, y, b, hoehe] = ["x", "y", "width", "height"].map((n) => Number(w.getAttribute(n))) as [number, number, number, number];
  const svg = document.querySelector<SVGSVGElement>("svg.ansicht__svg")!;
  fireEvent(svg, new MouseEvent(t, { bubbles: true, cancelable: true, button: 0, clientX: x + (u * b) / 5000, clientY: y + hoehe - (h * hoehe) / 2500 }));
}

/** Von „Stromkreise“ über Geschoss und Raum bis in die Wandansicht der Diele (Wand 1). */
async function bisZurWand() {
  zeigen();
  const hv = await screen.findByRole("region", { name: "Verteilung HV" });
  fireEvent.click(within(hv).getByRole("button", { name: "Verteilung HV im Plan platzieren" }));
  const dialog = await screen.findByRole("dialog", { name: "HV im Plan platzieren" });
  // Ein Raum ohne geschlossene Kontur ist nicht wählbar.
  expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["Erdgeschoss", "Bitte wählen", "Diele", "Küche"]);
  fireEvent.change(within(dialog).getByLabelText("Raum"), { target: { value: "raum-1" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Weiter zur Wandwahl" }));
  const leiste = await screen.findByTestId("verteilung-wandwahl");
  expect(leiste).toHaveTextContent("HV platzieren – eine Wand von „0.01 Diele“ anklicken");
  grundrissKlick(await screen.findByTestId("wand-raum-1-w0"), 2500, 0);
  return screen.findByTestId("verteilung-platzieren");
}

describe("Verteilung direkt im Plan platzieren (6c, VP)", () => {
  it("führt über Geschoss, Raum und Wand zur Wandansicht und speichert Lage und Verknüpfung in einer Anfrage", async () => {
    const leiste = await bisZurWand();
    expect(leiste).toHaveTextContent("In die Wand klicken");
    expect(within(leiste).getByRole("button", { name: "Platzierung speichern" })).toBeDisabled();
    // Raumspeichern gibt es beim Platzieren nicht - der Raumentwurf bleibt unberührt.
    const wand = screen.getByRole("region", { name: /Wandansicht/ });
    expect(within(wand).queryByRole("button", { name: "Speichern" })).toBeNull();

    zeiger("pointermove", 2500, 1400);
    expect(screen.getByTestId("geraet-vorschau")).toHaveAttribute("data-gueltig", "ja");
    zeiger("pointerdown", 2500, 1400);
    zeiger("pointerup", 2500, 1400);
    expect(await screen.findByTestId("verteilung-lage")).toBeInTheDocument();
    expect(within(leiste).getByRole<HTMLInputElement>("textbox", { name: /Mitte von links/ }).value).toBe("250");
    expect(within(leiste).getByRole<HTMLInputElement>("textbox", { name: /Höhe Mitte über Boden/ }).value).toBe("140");

    fireEvent.click(within(leiste).getByRole("button", { name: "Platzierung speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0]).toEqual([
      "/api/v1/modules/electrical/distribution-boards/{board_id}/placement",
      {
        path: { board_id: "hv" },
        ifMatch: 3,
        body: { room_id: "raum-1", wall_id: "raum-1-w0", center_offset_mm: 2500, center_height_mm: 1400, expected_room_version: 7 },
      },
    ]);
    // Zurück in „Stromkreise“ mit Rückmeldung.
    expect(await screen.findByTestId("platzierung-meldung")).toHaveTextContent("HV platziert: Diele (Hauptgebäude · Erdgeschoss), Wand 1.");
  });

  it("eine unzulässige Lage wird nicht gesetzt; Abbrechen speichert nichts und führt zurück", async () => {
    const leiste = await bisZurWand();
    // Mitte 2,40 m: Die 70 cm hohe Verteilung ragt über die Decke (2,50 m).
    zeiger("pointermove", 2500, 2400);
    expect(screen.getByTestId("geraet-vorschau")).toHaveAttribute("data-gueltig", "nein");
    zeiger("pointerdown", 2500, 2400);
    zeiger("pointerup", 2500, 2400);
    expect(screen.queryByTestId("verteilung-lage")).toBeNull();
    expect(within(leiste).getByRole("button", { name: "Platzierung speichern" })).toBeDisabled();

    fireEvent.click(within(leiste).getByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByRole("region", { name: "Verteilung HV" })).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("ein Versionskonflikt behält die Lage als Vorschlag und lädt auf Wunsch neu", async () => {
    api.put.mockRejectedValueOnce(
      new ApiError(409, { type: "https://elektroplan.example/problems/version-conflict", title: "Versionskonflikt", status: 409, detail: "x" }, null),
    );
    const leiste = await bisZurWand();
    zeiger("pointerdown", 2500, 1400);
    zeiger("pointerup", 2500, 1400);
    fireEvent.click(await within(leiste).findByRole("button", { name: "Platzierung speichern" }));
    expect(await within(leiste).findByRole("alert")).toHaveTextContent("inzwischen geändert");
    expect(screen.getByTestId("verteilung-lage")).toBeInTheDocument();
    boards = [verteilung("hv", "HV", null, 5)];
    fireEvent.click(within(leiste).getByRole("button", { name: "Neu laden" }));
    await waitFor(() => expect(within(leiste).queryByRole("alert")).toBeNull());
    fireEvent.click(within(leiste).getByRole("button", { name: "Platzierung speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect((api.put.mock.calls[1] as [string, { ifMatch: number }])[1].ifMatch).toBe(5);
  });

  it("platzierte Verteilung: Im Plan zeigen öffnet die Wand mit dem Lagegerät, Zurück führt zu Stromkreise", async () => {
    plan.rooms[0] = { ...rechteck("raum-1", "Diele", [0, 0], [5000, 4000], { nummer: "0.01", geraete: [{ id: "uv-geraet", typ: "distribution_board", wand: 0, mitte: 1000, hoehe: 1400 }] }), version: 7 };
    boards = [verteilung("hv", "HV", "uv-geraet")];
    zeigen();
    const hv = await screen.findByRole("region", { name: "Verteilung HV" });
    expect(within(hv).getByText(/Lage: Erdgeschoss · Diele/)).toBeInTheDocument();
    expect(within(hv).getByRole("button", { name: "Position von Verteilung HV ändern" })).toBeInTheDocument();
    fireEvent.click(within(hv).getByRole("button", { name: "Verteilung HV im Plan zeigen" }));
    const wand = await screen.findByRole("region", { name: /Wandansicht · Wand 1 · 0.01 Diele/ });
    expect(within(wand).getByRole("button", { name: /Zurück zu Stromkreise/ })).toBeInTheDocument();
    fireEvent.click(within(wand).getByRole("button", { name: /Zurück zu Stromkreise/ }));
    expect(await screen.findByRole("region", { name: "Verteilung HV" })).toBeInTheDocument();
  });

  it("ohne Recht zum Planbearbeiten kein Platzieren; Geräte „Verteilung“ ohne Verteilung werden genannt", async () => {
    rechte = new Set(["electrical.circuit.write"]);
    plan.rooms[1] = rechteck("raum-2", "Küche", [5000, 0], [8000, 4000], { nummer: "0.02", geraete: [{ id: "alt", typ: "distribution_board", wand: 0, mitte: 1000, hoehe: 1400 }] });
    zeigen();
    const hv = await screen.findByRole("region", { name: "Verteilung HV" });
    expect(within(hv).getByText("Noch nicht im Plan platziert")).toBeInTheDocument();
    expect(within(hv).queryByRole("button", { name: /im Plan platzieren/ })).toBeNull();
    const alt = await screen.findByRole("region", { name: "Geräte „Verteilung“ ohne Verteilung" });
    expect(alt).toHaveTextContent("Verteilung · Erdgeschoss · Küche");
  });
});

describe("Meldungen zur Platzierung", () => {
  const fehler = (status: number, typ: string, codes: string[] = [], detail = "Servermeldung") =>
    new ApiError(status, { type: `https://elektroplan.example/problems/${typ}`, title: "x", status, detail, errors: codes.map((code) => ({ field: "x", code, message: "x" })) }, null);

  it("nennt Leitungen, Lagebefunde, Konflikt und Schreibschutz verständlich", () => {
    expect(platzierungsfehler(fehler(409, "conflict", ["board-placement-has-cables"], "… F1 · L1: Verteilung → Steckdose …"))).toEqual({ text: "… F1 · L1: Verteilung → Steckdose …", konflikt: false });
    expect(platzierungsfehler(fehler(422, "validation-failed", ["device-in-opening"])).text).toBe("Nicht gespeichert: Das Gerät liegt in einer Tür-, Fenster- oder Durchgangsöffnung.");
    expect(platzierungsfehler(fehler(409, "version-conflict")).konflikt).toBe(true);
    expect(platzierungsfehler(fehler(409, "project-archived")).text).toContain("schreibgeschützt");
    expect(platzierungsfehler(new Error("netz")).konflikt).toBe(false);
  });
});
