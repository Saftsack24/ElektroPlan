import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import type { TopoWand } from "../topologie/wandtopologie";
import { wandtopologie } from "../topologie/wandtopologie";
import type { KandidatImPlan, KopplungImPlan } from "./zuordnung";
import { kopplungenAus } from "./zuordnung";

/**
 * Bedienung der Wandzuordnung im Editor (Phase 6a): Zustand, Vorschlag,
 * Bestätigen, Ändern und Lösen - mit Rückfrage bei folgenreichen Schritten,
 * gesperrt bei ungespeichertem Entwurf, ohne technische IDs in der Anzeige.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }) }));

const { Wandzuordnung } = await import("./Wandzuordnung");

const WAND_A = "11111111-1111-4111-8111-111111111111";
const WAND_B = "22222222-2222-4222-8222-222222222222";

function waende(versatz = 0): (TopoWand & { staerkeMm: number })[] {
  return [
    { id: WAND_A, raumId: "A", start: { x: 4000, y: 0 }, ende: { x: 4000, y: 3000 }, oeffnungen: [], staerkeMm: 115 },
    { id: WAND_B, raumId: "B", start: { x: 4000 + versatz, y: 3000 }, ende: { x: 4000 + versatz, y: 0 }, oeffnungen: [], staerkeMm: 115 },
  ];
}

const KOPPLUNG: KopplungImPlan = {
  id: "33333333-3333-4333-8333-333333333333",
  wall_a_id: WAND_A,
  wall_b_id: WAND_B,
  relation: "shared",
  origin: "user",
  status: "active",
  thickness_conflict: false,
  version: 4,
  created_at: "2026-10-06T08:00:00Z",
  updated_at: "2026-10-06T08:00:00Z",
};
const VORSCHLAG: KandidatImPlan = { wall_a_id: WAND_A, wall_b_id: WAND_B, kind: "suggested", reasons: [] };

function zeigen({
  kopplungen = [] as KopplungImPlan[],
  kandidaten = [] as KandidatImPlan[],
  versatz = 0,
  darfSchreiben = true,
  entwurfOffen = false,
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}><RueckfrageProvider>
      <Wandzuordnung
        topologie={wandtopologie("geschoss-1", waende(versatz), kopplungenAus(kopplungen))}
        wandId={WAND_A}
        kopplungen={kopplungen}
        kandidaten={kandidaten}
        wandName={() => "Wand 4 von „Bad“"}
        darfSchreiben={darfSchreiben}
        entwurfOffen={entwurfOffen}
      />
    </RueckfrageProvider></QueryClientProvider>,
  );
  return screen.getByRole("region", { name: "Wandzuordnung" });
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
});

describe("Wandzuordnung", () => {
  it("zeigt den Vorschlag verständlich und ohne technische IDs; Bestätigen legt shared an", async () => {
    api.post.mockResolvedValue({ ...KOPPLUNG });
    const bereich = zeigen({ kandidaten: [VORSCHLAG] });
    expect(within(bereich).getByText("Zuordnung offen – Vorschlag: gemeinsame Bauwand")).toBeInTheDocument();
    expect(within(bereich).getByText(/mit Wand 4 von „Bad“ · ab Wandanfang 0 cm bis 300 cm/)).toBeInTheDocument();
    expect(bereich.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);

    fireEvent.click(within(bereich).getByRole("button", { name: "Als gemeinsame Bauwand bestätigen" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith("/api/v1/modules/electrical/floors/{floor_id}/wall-links", {
      path: { floor_id: "geschoss-1" },
      body: { wall_a_id: WAND_A, wall_b_id: WAND_B, relation: "shared" },
    });
  });

  it("sperrt die Bedienung bei ungespeichertem Entwurf und ohne Schreibrecht", () => {
    const bereich = zeigen({ kandidaten: [VORSCHLAG], entwurfOffen: true });
    expect(within(bereich).getByText(/Bitte zuerst speichern oder verwerfen/)).toBeInTheDocument();
    expect(within(bereich).getByRole("button", { name: "Als getrennte Wände festlegen" })).toBeDisabled();
  });

  it("ohne Schreibrecht nur lesen", () => {
    const bereich = zeigen({ kopplungen: [KOPPLUNG], darfSchreiben: false });
    expect(within(bereich).getByText("Gemeinsame Bauwand")).toBeInTheDocument();
    expect(within(bereich).queryAllByRole("button")).toHaveLength(0);
  });

  it("Lösen nur nach Rückfrage, mit If-Match der Kopplung", async () => {
    api.delete.mockResolvedValue(undefined);
    const bereich = zeigen({ kopplungen: [KOPPLUNG] });
    fireEvent.click(within(bereich).getByRole("button", { name: "Zuordnung lösen" }));
    const dialog = await screen.findByRole("dialog", { name: "Zuordnung lösen?" });
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Zuordnung lösen" }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
    expect(api.delete).toHaveBeenCalledWith("/api/v1/modules/electrical/wall-links/{link_id}", {
      path: { link_id: KOPPLUNG.id },
      ifMatch: 4,
    });
  });

  it("Ablehnung durch die Geräteprüfung bleibt im Dialog sichtbar - nichts wird verschoben", async () => {
    api.patch.mockRejectedValue(
      new ApiError(
        422,
        {
          type: "https://elektroplan.example/errors/validation-failed",
          title: "Ungueltige Eingabe",
          status: 422,
          detail: "Mit dieser Wandzuordnung laege ein Geraet unzulaessig.",
          errors: [{ field: "devices", code: "device-in-opening", message: "x", keys: ["g1"] }],
        },
        null,
      ),
    );
    const bereich = zeigen({ kopplungen: [{ ...KOPPLUNG, relation: "separate" }] });
    expect(within(bereich).getByText("Getrennte Wände")).toBeInTheDocument();
    fireEvent.click(within(bereich).getByRole("button", { name: "Auf gemeinsame Bauwand ändern" }));
    const dialog = await screen.findByRole("dialog", { name: "Auf gemeinsame Bauwand ändern?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ändern" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Tür-, Fenster- oder Durchgangsöffnung/);
    expect(api.patch).toHaveBeenCalledWith("/api/v1/modules/electrical/wall-links/{link_id}", {
      path: { link_id: KOPPLUNG.id },
      ifMatch: 4,
      body: { relation: "shared" },
    });
  });

  it("verschobene Wand: Kopplung unterbrochen, nur noch Lösen", () => {
    const bereich = zeigen({ kopplungen: [KOPPLUNG], versatz: 1 });
    expect(within(bereich).getByText("Kopplung unterbrochen")).toBeInTheDocument();
    expect(within(bereich).queryByRole("button", { name: /ändern/ })).toBeNull();
    expect(within(bereich).getByRole("button", { name: "Zuordnung lösen" })).toBeEnabled();
  });

  it("ohne Nachbarwand erscheint nichts", () => {
    const client = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={client}><RueckfrageProvider>
        <Wandzuordnung
          topologie={wandtopologie("geschoss-1", [waende()[0] as TopoWand & { staerkeMm: number }])}
          wandId={WAND_A}
          kopplungen={[]}
          kandidaten={[]}
          wandName={() => ""}
          darfSchreiben
          entwurfOffen={false}
        />
      </RueckfrageProvider></QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
