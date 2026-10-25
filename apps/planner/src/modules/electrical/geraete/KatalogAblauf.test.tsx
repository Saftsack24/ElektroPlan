import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";
import { eigenschaftenOeffnen } from "../arbeitsflaeche/testhilfe";

/**
 * Gerätekatalog in den Arbeitsflächen (Phase 6c, K1) über den echten Projekt-Tab:
 * Einstieg im Grundriss (Knopf und Taste G), Führung zur passenden Fläche, vorhandene
 * Platzierung und Raumspeicherung, „Typ ändern …“, Entwurfsschutz, Verteilungseintrag,
 * Rechte, Projektstatus und Sitzungswechsel. „0.01 Wohnzimmer“ 0…5000 × 0…4000 mit einer
 * Steckdose an Wand 2 (x = 5000), „0.02 Flur“ daneben. Synthetische Daten.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
let rechte = new Set(["electrical.plan.write", "electrical.circuit.write", "electrical.route.write"]);
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }), usePermission: (p: string) => rechte.has(p) }));
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
let typen = [
  typ("socket_single", "Steckdose", {}),
  typ("switch_single", "Ausschalter", { category: "switch", default_center_height_mm: 1050, sort_order: 20 }),
  typ("light_ceiling", "Deckenleuchte (Auslass)", { category: "light", allows_wall_interior: false, allows_ceiling: true, default_center_height_mm: null, width_mm: 100, height_mm: 100, sort_order: 30 }),
  typ("distribution_board", "Verteilung", { category: "distribution", default_center_height_mm: 1400, width_mm: 550, height_mm: 700, sort_order: 90 }),
];
let status = "active";
let plan: { floor_id: string; project_id: string; rooms: ReturnType<typeof rechteck>[]; wall_links: never[]; wall_link_candidates: never[] };

beforeEach(() => {
  vi.clearAllMocks();
  rechte = new Set(["electrical.plan.write", "electrical.circuit.write", "electrical.route.write"]);
  status = "active";
  typen = typen.filter((t) => t.key !== "socket_extra");
  act(() => masseinheitSetzen("cm"));
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  plan = {
    floor_id: "geschoss-1",
    project_id: "projekt-1",
    rooms: [
      rechteck("raum-1", "Wohnzimmer", [0, 0], [5000, 4000], { nummer: "0.01", geraete: [{ id: "sd", typ: "socket_single", wand: 1, mitte: 1000, hoehe: 300 }] }),
      rechteck("raum-2", "Flur", [5000, 0], [7000, 4000], { nummer: "0.02" }),
    ],
    wall_links: [],
    wall_link_candidates: [],
  };
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status, version: 2 });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve([{ id: "geschoss-1", building_id: "gebaeude-1", name: "Erdgeschoss", level: 0, default_ceiling_height_mm: 2500 }]);
    if (pfad.endsWith("/plan")) return Promise.resolve(plan);
    if (pfad.endsWith("/device-types")) return Promise.resolve(typen);
    if (pfad.endsWith("/distribution-boards")) {
      return Promise.resolve({ building_id: "gebaeude-1", boards: [{ id: "uv2", building_id: "gebaeude-1", code: "UV2", name: "UV Keller", note: null, placement_device_id: null, version: 1, created_at: "", updated_at: "" }] });
    }
    if (pfad.endsWith("/circuits")) return Promise.resolve({ building_id: "gebaeude-1", circuits: [] });
    if (pfad.endsWith("/cables")) return Promise.resolve({ building_id: "gebaeude-1", cables: [] });
    return Promise.resolve([]);
  });
  api.put.mockImplementation((_pfad: string, optionen: { body: { devices: unknown[] } }) =>
    Promise.resolve({ ...plan.rooms[0], version: 2, devices: optionen.body.devices.map((g) => ({ ...(g as object), room_id: "raum-1", created_at: "", updated_at: "" })) }),
  );
});

function zeigen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
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

/** Zeiger auf der Wandfläche von Wand 1 des Wohnzimmers (Außenwand unten, 5 m lang, 2,5 m hoch). */
function wandzeiger(t: string, u: number, h: number) {
  const w = screen.getByTestId("wandflaeche");
  const [x, y, b, hoehe] = ["x", "y", "width", "height"].map((n) => Number(w.getAttribute(n))) as [number, number, number, number];
  fireEvent(document.querySelector("svg.ansicht__svg")!, new MouseEvent(t, { bubbles: true, cancelable: true, button: 0, clientX: x + (u * b) / 5000, clientY: y + hoehe - (h * hoehe) / 2500 }));
}

const grundriss = () => screen.findByRole("application", { name: /Grundriss/ });
const werkzeuge = () => screen.getByRole("toolbar", { name: "Werkzeuge des Grundrisseditors" });

async function katalogPer(weg: "knopf" | "taste") {
  const flaeche = await grundriss();
  if (weg === "knopf") fireEvent.click(within(werkzeuge()).getByRole("button", { name: "Gerät" }));
  else fireEvent.keyDown(flaeche, { key: "g" });
  return screen.findByRole("dialog", { name: "Gerät auswählen" });
}

describe("Gerätekatalog im Grundriss (K1)", () => {
  it("Knopf und Taste G öffnen den Katalog; Abbrechen ändert nichts", async () => {
    zeigen();
    let dialog = await katalogPer("knopf");
    expect(within(dialog).queryByTestId("katalog-kachel-distribution_board")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    dialog = await katalogPer("taste");
    fireEvent.click(within(dialog).getByRole("button", { name: "Dialog schließen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("geraet-wandwahl")).toBeNull();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("Wandtyp: Aufforderung zur Wandwahl, Wand öffnet das Gerätewerkzeug; gesetzt und mit dem Raum gespeichert", async () => {
    zeigen();
    const dialog = await katalogPer("knopf");
    fireEvent.click(within(dialog).getByTestId("katalog-kachel-switch_single"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Platzieren" }));
    const leiste = await screen.findByTestId("geraet-wandwahl");
    expect(leiste).toHaveTextContent("Gerät: Ausschalter");
    expect(leiste).toHaveTextContent("Eine Wand anklicken – die Wandansicht öffnet sich zum Setzen.");
    expect(api.put).not.toHaveBeenCalled();

    // Außenwand unten: eindeutig dem Wohnzimmer zugeordnet (eine gemeinsame Wand wählt die Raumseite).
    grundrissKlick(await screen.findByTestId("wand-raum-1-w0"), 2500, 40);
    const wand = await screen.findByRole("region", { name: /Wandansicht · Wand 1/ });
    expect(within(wand).getByRole("button", { name: /Gerät: Ausschalter – anderen Typ wählen/ })).toBeInTheDocument();
    expect(within(wand).getByTestId("wand-statuszeile")).toHaveTextContent("Ausschalter: in die Wand klicken");
    wandzeiger("pointerdown", 2500, 1050);
    wandzeiger("pointerup", 2500, 1050);
    await screen.findByText(/Ausschalter gesetzt/);
    fireEvent.click(within(wand).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const body = (api.put.mock.calls[0] as [string, { body: { devices: Record<string, unknown>[] } }])[1].body;
    expect(body.devices).toEqual(
      expect.arrayContaining([expect.objectContaining({ device_type_key: "switch_single", mounting_surface: "wall_interior", wall_id: "raum-1-w0", center_height_mm: 1050 })]),
    );
  });

  it("Deckentyp: Klick in den Raum öffnet die Deckenansicht mit dem Werkzeug „Gerät“", async () => {
    zeigen();
    const dialog = await katalogPer("taste");
    fireEvent.click(within(dialog).getByTestId("katalog-kachel-light_ceiling"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Platzieren" }));
    expect(await screen.findByTestId("geraet-wandwahl")).toHaveTextContent("In einen Raum klicken – die Deckenansicht öffnet sich zum Setzen.");
    grundrissKlick(await grundriss(), 2500, 2000);
    const decke = await screen.findByRole("region", { name: /Deckenansicht/ });
    expect(within(decke).getByRole("button", { name: /Gerät: Deckenleuchte \(Auslass\) – anderen Typ wählen/ })).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("vorhandenes Gerät: Klick wählt, „Typ ändern …“ übernimmt bewusst in den Entwurf – ohne Speichern; Öffnen/Schließen behält den Entwurf", async () => {
    zeigen();
    await grundriss();
    const geraet = await screen.findByTestId("grundriss-geraet-sd");
    for (const t of ["pointerdown", "pointerup", "click"]) fireEvent(geraet.querySelector("rect.grundriss__geraet-treffer")!, new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 }));
    await waitFor(() => expect(screen.getByTestId("grundriss-geraet-sd").getAttribute("class")).toContain("ausgewaehlt"));
    expect(screen.queryByRole("dialog")).toBeNull();

    await eigenschaftenOeffnen();
    fireEvent.click(await screen.findByRole("button", { name: "An Wand bearbeiten" }));
    const wand = await screen.findByRole("region", { name: /Wandansicht · Wand 2/ });
    await eigenschaftenOeffnen(wand);
    fireEvent.click(within(wand).getByRole("button", { name: "Typ ändern …" }));
    let dialog = await screen.findByRole("dialog", { name: "Gerätetyp ändern" });
    expect(within(dialog).queryByTestId("katalog-kachel-light_ceiling")).toBeNull();
    fireEvent.click(within(dialog).getByTestId("katalog-kachel-switch_single"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Typ übernehmen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(wand).getByTestId("geraet-typ")).toHaveTextContent("Ausschalter");
    expect(within(wand).getByText(/Wohnzimmer: Ungespeicherte Änderungen|ungespeichert/i)).toBeInTheDocument();

    // Katalog öffnen und schließen: Der ungespeicherte Typwechsel bleibt.
    fireEvent.click(within(wand).getByRole("button", { name: "Gerät" }));
    dialog = await screen.findByRole("dialog", { name: "Gerät auswählen" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(wand).getByTestId("geraet-typ")).toHaveTextContent("Ausschalter");
    expect(api.put).not.toHaveBeenCalled();
  });

  it("„Verteilung platzieren …“ führt ohne Dialogstapel in die Wandwahl des VP-Ablaufs", async () => {
    zeigen();
    const dialog = await katalogPer("knopf");
    fireEvent.click(within(dialog).getByRole("button", { name: "Verteilung platzieren …" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Verteilung UV2 platzieren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByTestId("verteilung-wandwahl")).toHaveTextContent("UV2 platzieren – eine Wand anklicken");
    grundrissKlick(await screen.findByTestId("wand-raum-1-w0"), 2500, 40);
    expect(await screen.findByTestId("verteilung-platzieren")).toHaveTextContent("UV2 platzieren");
    // Abbrechen aus dem Katalogeinstieg bleibt im Editor und speichert nichts.
    fireEvent.click(within(screen.getByTestId("verteilung-platzieren")).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByTestId("verteilung-platzieren")).toBeNull());
    expect(screen.getByRole("region", { name: /Wandansicht · Wand 1/ })).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("ohne Recht Stromkreise: Verteilungseintrag nennt den Grund; ohne Planrecht und im archivierten Projekt kein Katalog", async () => {
    rechte = new Set(["electrical.plan.write"]);
    const ansicht = zeigen();
    const dialog = await katalogPer("knopf");
    fireEvent.click(within(dialog).getByRole("button", { name: "Verteilung platzieren …" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Verteilungen platziert, wer Verteilungen und Stromkreise bearbeiten darf.");
    ansicht.unmount();

    rechte = new Set(["electrical.circuit.write"]);
    const ohnePlan = zeigen();
    const flaeche = await grundriss();
    expect(within(werkzeuge()).queryByRole("button", { name: "Gerät" })).toBeNull();
    fireEvent.keyDown(flaeche, { key: "g" });
    expect(screen.queryByRole("dialog")).toBeNull();
    ohnePlan.unmount();

    rechte = new Set(["electrical.plan.write", "electrical.circuit.write"]);
    status = "archived";
    zeigen();
    await grundriss();
    await screen.findByText(/archiviert/);
    expect(within(werkzeuge()).queryByRole("button", { name: "Gerät" })).toBeNull();
  });

  it("Sitzungswechsel: Der neue Katalog zeigt nur die Typen der neuen Sitzung", async () => {
    const erste = zeigen();
    let dialog = await katalogPer("knopf");
    expect(within(dialog).getByTestId("katalog-kachel-socket_single")).toBeInTheDocument();
    erste.unmount();
    typen = [...typen, typ("socket_extra", "Steckdose Betrieb B", { sort_order: 15 })];
    zeigen();
    dialog = await katalogPer("knopf");
    expect(within(dialog).getByTestId("katalog-kachel-socket_extra")).toBeInTheDocument();
  });
});
