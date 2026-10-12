import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { gibtUngespeicherteAenderungen } from "../../../core/ui/ungespeichert";

/**
 * Verteilungen, Stromkreise und Gerätezuordnung (Phase 6b.1). Die verbindlichen
 * Regeln (Gebäude, Kategorie, doppelte Zuordnung, If-Match, Rechte, Status)
 * prüft das Backend (`tests/test_electrical_circuits.py`); hier geht es um
 * Bedienung und Anzeige. Synthetische Daten.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }) }));

const { Stromkreise } = await import("./Stromkreise");

const ZEIT = "2026-10-11T08:00:00Z";
const typ = (key: string, label: string, category: string, decke = false) => ({
  key,
  label,
  category,
  symbol_key: key,
  allows_wall_interior: !decke,
  allows_wall_exterior: false,
  allows_ceiling: decke,
  default_center_height_mm: decke ? null : 300,
  width_mm: 80,
  height_mm: 80,
  sort_order: 1,
  is_active: true,
});
const TYPEN = [
  typ("socket_single", "Steckdose", "socket"),
  typ("switch_single", "Ausschalter", "switch"),
  typ("data_single", "Netzwerkdose einfach", "data"),
  typ("distribution_board", "Verteilung", "distribution"),
  typ("junction_box", "Abzweigdose", "junction", true),
];

const wandgeraet = (id: string, key: string, offset: number) => ({
  id,
  room_id: "kueche",
  device_type_key: key,
  mounting_surface: "wall_interior",
  wall_id: "w1",
  center_offset_mm: offset,
  center_height_mm: 300,
  x_mm: null,
  y_mm: null,
  label: null,
  created_at: ZEIT,
  updated_at: ZEIT,
});

const PLAN = {
  floor_id: "eg",
  project_id: "projekt",
  wall_links: [],
  wall_link_candidates: [],
  rooms: [
    {
      id: "kueche",
      name: "Küche",
      walls: [{ id: "w1", x1_mm: 0, y1_mm: 0, x2_mm: 5000, y2_mm: 0 }],
      devices: [
        wandgeraet("steckdose", "socket_single", 1000),
        wandgeraet("schalter", "switch_single", 2000),
        wandgeraet("netzwerk", "data_single", 3000),
        wandgeraet("uv-geraet", "distribution_board", 4000),
        wandgeraet("uv-geraet-2", "distribution_board", 4600),
        { ...wandgeraet("dose", "junction_box", 0), mounting_surface: "ceiling", wall_id: null, center_offset_mm: null, center_height_mm: null, x_mm: 2500, y_mm: 2000 },
      ],
    },
  ],
};

const verteilung = (id: string, code: string, placement: string | null, version = 1) => ({
  id,
  building_id: "haus",
  code,
  name: `Verteilung ${code}`,
  note: null,
  placement_device_id: placement,
  version,
  created_at: ZEIT,
  updated_at: ZEIT,
});

const kreis = (id: string, board: string, designation: string, devices: string[], version = 1) => ({
  id,
  board_id: board,
  designation,
  name: `Kreis ${designation}`,
  sort_order: 0,
  proposed_cable_type: "NYM-J",
  proposed_conductor_count: 3,
  proposed_cross_section_mm2: "1.50",
  protective_device: "B16",
  rcd_group: null,
  phase_count: 1,
  note: null,
  device_ids: devices,
  version,
  created_at: ZEIT,
  updated_at: ZEIT,
});

let boards = [verteilung("uv1", "UV1", "uv-geraet"), verteilung("hv", "HV", null)];
let circuits = [kreis("f1", "uv1", "F1", ["steckdose"]), kreis("f2", "hv", "F2", ["schalter"])];

beforeEach(() => {
  masseinheitSetzen(null);
  boards = [verteilung("uv1", "UV1", "uv-geraet"), verteilung("hv", "HV", null)];
  circuits = [kreis("f1", "uv1", "F1", ["steckdose"]), kreis("f2", "hv", "F2", ["schalter"])];
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/buildings/{building_id}/floors") {
      return Promise.resolve([{ id: "eg", building_id: "haus", name: "Erdgeschoss", level: 0 }]);
    }
    if (pfad.endsWith("/distribution-boards")) return Promise.resolve({ building_id: "haus", boards });
    if (pfad.endsWith("/circuits")) return Promise.resolve({ building_id: "haus", circuits });
    if (pfad.endsWith("/plan")) return Promise.resolve(PLAN);
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    return Promise.reject(new Error(`unerwartet: ${pfad}`));
  });
});

afterEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
});

function zeigen({ darfSchreiben = true, onUngespeichert = vi.fn() } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RueckfrageProvider>
        <Stromkreise
          buildingId="haus"
          buildingName="Haupthaus"
          aktivesGeschossId="eg"
          onGeschoss={vi.fn()}
          darfSchreiben={darfSchreiben}
          onUngespeichert={onUngespeichert}
        />
      </RueckfrageProvider>
    </QueryClientProvider>,
  );
}

const problem = (status: number, typ: string, errors: { field: string; code: string; message: string }[] = []) =>
  new ApiError(status, { type: `https://elektroplan.example/problems/${typ}`, title: "Fehler", status, detail: "Servermeldung", errors }, null);

async function geladen() {
  await screen.findByRole("region", { name: "Verteilung UV1" });
}

describe("Verteilungen und Stromkreise", () => {
  it("zeigt Gebäude, Verteilungen mit Lage und Stromkreise mit Vorschlag", async () => {
    zeigen();
    await geladen();
    expect(screen.getByText("Verteilungen & Stromkreise · Gebäude „Haupthaus“")).toBeInTheDocument();
    const uv1 = screen.getByRole("region", { name: "Verteilung UV1" });
    expect(within(uv1).getByText(/Lage: Erdgeschoss · Küche/)).toBeInTheDocument();
    expect(within(uv1).getByText("NYM-J 3 × 1,5 mm²")).toBeInTheDocument();
    const hv = screen.getByRole("region", { name: "Verteilung HV" });
    expect(within(hv).getByText("Noch nicht im Plan platziert")).toBeInTheDocument();
    expect(screen.getByText(/keine Aussage zur Normkonformität/)).toBeInTheDocument();
  });

  it("bietet beim Anlegen nur freie Lagegeräte an und zeigt einen doppelten Code verständlich", async () => {
    api.post.mockRejectedValueOnce(problem(422, "validation-failed", [{ field: "code", code: "board-code-taken", message: "x" }]));
    zeigen();
    await geladen();
    fireEvent.click(screen.getByRole("button", { name: "Verteilung anlegen" }));
    const dialog = await screen.findByRole("dialog");
    const optionen = within(dialog).getAllByRole("option").map((o) => o.textContent);
    expect(optionen).toEqual(["Noch nicht im Plan platziert", "Erdgeschoss · Küche · Verteilung"]);
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "UV1" } });
    fireEvent.change(within(dialog).getByLabelText(/^Bezeichnung/), { target: { value: "Doppelt" } });
    fireEvent.change(within(dialog).getByLabelText("Lage im Plan (optional)"), { target: { value: "uv-geraet-2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByText("Dieser Code ist in diesem Gebäude bereits vergeben.")).toBeInTheDocument();
    expect(api.post.mock.calls[0]?.[1]).toEqual({
      path: { building_id: "haus" },
      body: { code: "UV1", name: "Doppelt", note: null, placement_device_id: "uv-geraet-2" },
    });
  });

  it("legt einen Stromkreis mit Vorschlägen an (Komma wird Dezimalpunkt)", async () => {
    api.post.mockResolvedValue(kreis("f3", "hv", "F3", []));
    zeigen();
    await geladen();
    const hv = screen.getByRole("region", { name: "Verteilung HV" });
    fireEvent.click(within(hv).getByRole("button", { name: "Stromkreis anlegen" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Vorschläge für neue Leitungen/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Bezeichnung/), { target: { value: "F3" } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Bad" } });
    fireEvent.change(within(dialog).getByLabelText("Querschnitt in mm² (Vorschlag)"), { target: { value: "2,5" } });
    fireEvent.change(within(dialog).getByLabelText("Leiteranzahl (Vorschlag)"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0]?.[1]).toEqual({
      path: { board_id: "hv" },
      body: {
        designation: "F3",
        name: "Bad",
        proposed_cable_type: null,
        proposed_conductor_count: 3,
        proposed_cross_section_mm2: "2.5",
        protective_device: null,
        rcd_group: null,
        phase_count: null,
        note: null,
      },
    });
  });

  it("verweigert das Entfernen einer Verteilung mit Stromkreisen verständlich und fragt beim Stromkreis nach", async () => {
    api.delete.mockResolvedValue(undefined);
    zeigen();
    await geladen();
    fireEvent.click(screen.getByRole("button", { name: "Verteilung UV1 entfernen" }));
    expect(await screen.findByText(/An der Verteilung UV1 hängt noch ein Stromkreis/)).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stromkreis F1 entfernen" }));
    const frage = await screen.findByRole("dialog");
    expect(within(frage).getByText(/Die Zuordnung von einem Gerät geht dabei verloren/)).toBeInTheDocument();
    fireEvent.click(within(frage).getByRole("button", { name: "Stromkreis entfernen" }));
    await waitFor(() => expect(api.delete).toHaveBeenCalled());
    expect(api.delete.mock.calls[0]?.[1]).toEqual({ path: { circuit_id: "f1" }, ifMatch: 1 });
  });
});

describe("Gerätezuordnung", () => {
  it("zeigt zuordenbare Geräte, Geräte anderer Stromkreise gesperrt, speichert bewusst", async () => {
    const onUngespeichert = vi.fn();
    api.put.mockImplementation((_p: string, { body }: { body: { device_ids: string[] } }) =>
      Promise.resolve(kreis("f1", "uv1", "F1", body.device_ids, 2)),
    );
    zeigen({ onUngespeichert });
    await geladen();
    fireEvent.click(screen.getByRole("button", { name: "Geräte von F1 zuordnen" }));
    const liste = await screen.findByRole("list", { name: "Geräteliste" });
    const eintraege = within(liste).getAllByRole("listitem").map((li) => li.textContent);
    expect(eintraege.some((t) => t?.includes("Netzwerkdose"))).toBe(false);
    expect(eintraege.some((t) => t?.startsWith("Verteilung"))).toBe(false);
    expect(within(liste).getByLabelText(/Steckdose/)).toBeChecked();
    const schalter = within(liste).getByLabelText(/Ausschalter/);
    expect(schalter).toBeDisabled();
    expect(within(liste).getByText("in HV · F2 Kreis F2")).toBeInTheDocument();

    // Abzweigdose über die grafische Auswahl, Steckdose über die Liste abwählen.
    fireEvent.click(screen.getByTestId("zuordnung-geraet-dose"));
    expect(within(liste).getByLabelText(/Abzweigdose/)).toBeChecked();
    fireEvent.click(within(liste).getByLabelText(/Steckdose/));
    expect(screen.getByText("Ungespeicherte Zuordnung")).toBeInTheDocument();
    expect(onUngespeichert).toHaveBeenLastCalledWith(true);
    expect(gibtUngespeicherteAenderungen()).toBe(true);
    // Der Schalter eines anderen Stromkreises lässt sich auch grafisch nicht übernehmen.
    fireEvent.click(screen.getByTestId("zuordnung-geraet-schalter"));
    expect(screen.getByTestId("zuordnung-geraet-schalter").dataset.zustand).toBe("anderer");

    fireEvent.click(screen.getByRole("button", { name: "Zuordnung speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0]?.[1]).toEqual({ path: { circuit_id: "f1" }, ifMatch: 1, body: { device_ids: ["dose"] } });
    expect(await screen.findByText("Gespeichert")).toBeInTheDocument();
    await waitFor(() => expect(onUngespeichert).toHaveBeenLastCalledWith(false));
  });

  it("verwirft ohne Server und lädt bei Versionskonflikt nur bewusst neu", async () => {
    api.put.mockRejectedValue(problem(409, "version-conflict"));
    zeigen();
    await geladen();
    fireEvent.click(screen.getByRole("button", { name: "Geräte von F1 zuordnen" }));
    const liste = await screen.findByRole("list", { name: "Geräteliste" });
    fireEvent.click(within(liste).getByLabelText(/Abzweigdose/));
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    expect(within(liste).getByLabelText(/Abzweigdose/)).not.toBeChecked();
    expect(screen.getByText("Gespeichert")).toBeInTheDocument();

    fireEvent.click(within(liste).getByLabelText(/Abzweigdose/));
    fireEvent.click(screen.getByRole("button", { name: "Zuordnung speichern" }));
    expect(await screen.findByText(/inzwischen an anderer Stelle geändert/)).toBeInTheDocument();
    // Nichts wird automatisch überschrieben: der Entwurf bleibt, bis bewusst neu geladen wird.
    expect(within(liste).getByLabelText(/Abzweigdose/)).toBeChecked();
    circuits = [kreis("f1", "uv1", "F1", ["steckdose", "schalter-neu"], 5), kreis("f2", "hv", "F2", ["schalter"])];
    fireEvent.click(screen.getByRole("button", { name: "Zuordnung verwerfen und neu laden" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Geräteliste" })).getByLabelText(/Abzweigdose/)).not.toBeChecked());
    expect(screen.getByText("Gespeichert")).toBeInTheDocument();
  });

  it("fragt beim Wechsel zu einem anderen Stromkreis mit ungespeicherter Zuordnung", async () => {
    zeigen();
    await geladen();
    fireEvent.click(screen.getByRole("button", { name: "Geräte von F1 zuordnen" }));
    const liste = await screen.findByRole("list", { name: "Geräteliste" });
    fireEvent.click(within(liste).getByLabelText(/Abzweigdose/));
    fireEvent.click(screen.getByRole("button", { name: "Geräte von F2 zuordnen" }));
    const frage = await screen.findByRole("dialog");
    expect(within(frage).getByText(/ungespeicherte Gerätezuordnung/)).toBeInTheDocument();
    fireEvent.click(within(frage).getByRole("button", { name: "Änderungen behalten" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/Geräte des Stromkreises UV1 · F1/)).toBeInTheDocument();
  });

  it("bleibt im Lesemodus ohne Schreibaktionen", async () => {
    zeigen({ darfSchreiben: false });
    await geladen();
    expect(screen.queryByRole("button", { name: "Verteilung anlegen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stromkreis anlegen" })).toBeNull();
    expect(screen.queryByRole("button", { name: /entfernen/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Geräte von F1 ansehen" }));
    const liste = await screen.findByRole("list", { name: "Geräteliste" });
    expect(within(liste).getByLabelText(/Steckdose/)).toBeDisabled();
    fireEvent.click(screen.getByTestId("zuordnung-geraet-dose"));
    expect(within(liste).getByLabelText(/Abzweigdose/)).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Zuordnung speichern" })).toBeNull();
  });
});

describe("Projektkopf", () => {
  it("lädt das Projekt nur nach erfolgreichen Schreibvorgängen nach", async () => {
    const onGeschrieben = vi.fn(() => Promise.resolve());
    api.put.mockRejectedValueOnce(problem(409, "version-conflict"));
    api.put.mockResolvedValueOnce(kreis("f1", "uv1", "F1", ["steckdose", "dose"], 2));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RueckfrageProvider>
          <Stromkreise
            buildingId="haus"
            buildingName="Haupthaus"
            aktivesGeschossId="eg"
            onGeschoss={vi.fn()}
            darfSchreiben
            onUngespeichert={vi.fn()}
            onGeschrieben={onGeschrieben}
          />
        </RueckfrageProvider>
      </QueryClientProvider>,
    );
    await geladen();
    fireEvent.click(screen.getByRole("button", { name: "Geräte von F1 zuordnen" }));
    const liste = await screen.findByRole("list", { name: "Geräteliste" });
    fireEvent.click(within(liste).getByLabelText(/Abzweigdose/));
    fireEvent.click(screen.getByRole("button", { name: "Zuordnung speichern" }));
    await screen.findByText(/inzwischen an anderer Stelle geändert/);
    expect(onGeschrieben).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Zuordnung speichern" }));
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
  });
});