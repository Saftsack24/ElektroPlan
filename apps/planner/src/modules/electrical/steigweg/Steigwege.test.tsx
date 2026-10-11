import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { gibtUngespeicherteAenderungen } from "../../../core/ui/ungespeichert";

/**
 * Steigwegverwaltung (Phase 6a.5). Der verbindliche Schutz (Gebäude,
 * doppelte Geschosse, If-Match, Rechte, Status) liegt im Backend
 * (`tests/test_electrical_risers.py`); hier geht es um Bedienung, Anzeige und
 * Aktualität. Synthetische Daten nach Beispiel 3.4.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };

vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
}));

const { Steigwege } = await import("./Steigwege");

const ZEIT = "2026-10-11T08:00:00Z";

function geschoss(id: string, name: string, level: number, elevation: number, bestaetigt = true) {
  return {
    id,
    building_id: "haus",
    name,
    level,
    elevation_mm: elevation,
    elevation_confirmed: bestaetigt,
    default_ceiling_height_mm: 2500,
    version: 1,
    created_at: ZEIT,
    updated_at: ZEIT,
  };
}

const KG = geschoss("kg", "Kellergeschoss", -1, -2800);
const EG = geschoss("eg", "Erdgeschoss", 0, 0);
const OG = geschoss("og", "Obergeschoss", 1, 2900);

const SCHACHT = {
  id: "steigweg-1",
  building_id: "haus",
  name: "Installationsschacht Flur",
  note: null,
  offset_mode: "orthogonal" as const,
  stops: [
    { id: "halt-kg", floor_id: "kg", x_mm: 1200, y_mm: 3400 },
    { id: "halt-eg", floor_id: "eg", x_mm: 1200, y_mm: 3400 },
    { id: "halt-og", floor_id: "og", x_mm: 1650, y_mm: 3700 },
  ],
  // Der Server liefert Abschnitte mit; angezeigt wird die gespiegelte Berechnung.
  sections: [],
  status: "confirmed" as const,
  known_length_mm: 6450,
  length_mm: 6450,
  version: 3,
  created_at: ZEIT,
  updated_at: ZEIT,
};

let geschosse = [KG, EG, OG];
let steigwege: (typeof SCHACHT)[] = [SCHACHT];
let raeume: unknown[] = [];

function planMit(floorId: string) {
  return { floor_id: floorId, project_id: "projekt", rooms: raeume, wall_links: [], wall_link_candidates: [] };
}

beforeEach(() => {
  geschosse = [KG, EG, OG];
  steigwege = [SCHACHT];
  raeume = [];
  masseinheitSetzen(null);
  api.get.mockImplementation((pfad: string, optionen: { path: Record<string, string> }) => {
    if (pfad === "/api/v1/buildings/{building_id}/floors") return Promise.resolve(geschosse);
    if (pfad === "/api/v1/modules/electrical/buildings/{building_id}/risers") {
      return Promise.resolve({ building_id: "haus", risers: steigwege });
    }
    if (pfad === "/api/v1/modules/electrical/floors/{floor_id}/plan") {
      return Promise.resolve(planMit(optionen.path.floor_id ?? ""));
    }
    return Promise.reject(new Error(`unerwartet: ${pfad}`));
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
});

function zeigen({
  darfSchreiben = true,
  aktiv = "eg",
  onGeschoss = vi.fn(),
  onUngespeichert = vi.fn(),
}: {
  darfSchreiben?: boolean;
  aktiv?: string;
  onGeschoss?: (id: string) => void;
  onUngespeichert?: (offen: boolean) => void;
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ansicht = (geschossId: string) => (
    <QueryClientProvider client={client}>
      <RueckfrageProvider>
        <Steigwege
          buildingId="haus"
          buildingName="Haupthaus"
          aktivesGeschossId={geschossId}
          onGeschoss={onGeschoss}
          darfSchreiben={darfSchreiben}
          onUngespeichert={onUngespeichert}
        />
      </RueckfrageProvider>
    </QueryClientProvider>
  );
  const ergebnis = render(ansicht(aktiv));
  return { ...ergebnis, client, wechseln: (id: string) => ergebnis.rerender(ansicht(id)) };
}

async function geladen() {
  await screen.findByRole("cell", { name: /^Installationsschacht Flur/ });
}

describe("Steigwegverwaltung", () => {
  it("zeigt Status und Länge aus dem Verlauf", async () => {
    zeigen();
    await geladen();
    const zeile = screen.getByRole("cell", { name: "Installationsschacht Flur" }).closest("tr");
    expect(zeile).not.toBeNull();
    const z = within(zeile as HTMLElement);
    expect(z.getByText("Länge bestätigt")).toBeInTheDocument();
    expect(z.getByText("645 cm")).toBeInTheDocument();
    expect(z.getByText("Kellergeschoss → Erdgeschoss → Obergeschoss")).toBeInTheDocument();
    expect(screen.getByText(/Keine Aussage über bauliche Machbarkeit/)).toBeInTheDocument();
  });

  it("zeigt bei unbestätigter Höhenlage nur eine Teilsumme", async () => {
    geschosse = [KG, EG, { ...OG, elevation_confirmed: false }];
    zeigen();
    await geladen();
    expect(screen.getByText("Teilsumme 355 cm (unvollständig)")).toBeInTheDocument();
    expect(screen.getByText(/Nicht bestätigte Höhenlage: Obergeschoss/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Steigweg Installationsschacht Flur bearbeiten" }));
    expect(await screen.findByText("Bekannte Teilsumme – keine vollständige Leitungslänge")).toBeInTheDocument();
    expect(screen.getByTestId("steigweg-summe")).toHaveTextContent("355 cm");
    expect(screen.getAllByText("unbekannt").length).toBeGreaterThan(0);
    // 3D-Vorschau: der vorläufige Abschnitt ist als solcher gekennzeichnet.
    const abschnitte = screen.getAllByTestId("vorschau-abschnitt");
    expect(abschnitte.map((a) => a.getAttribute("data-status"))).toEqual(["confirmed", "elevation-unconfirmed"]);
    expect(abschnitte[1]).toHaveClass("steigweg__linie--vorlaeufig");
  });

  it("aktualisiert Längen, wenn sich Höhenlage oder Reihenfolge ändern", async () => {
    const { client } = zeigen();
    await geladen();
    expect(screen.getByText("645 cm")).toBeInTheDocument();
    act(() => {
      client.setQueryData(["floors", "haus"], [KG, EG, { ...OG, elevation_mm: 3000 }]);
    });
    expect(await screen.findByText("655 cm")).toBeInTheDocument();
    act(() => {
      client.setQueryData(["floors", "haus"], [KG, EG, { ...OG, elevation_mm: 3000, elevation_confirmed: false }]);
    });
    expect(await screen.findByText("Teilsumme 355 cm (unvollständig)")).toBeInTheDocument();
    // Reihenfolge: KG wird zum obersten Geschoss.
    act(() => {
      client.setQueryData(["floors", "haus"], [{ ...KG, level: 5, elevation_mm: 9000 }, EG, OG]);
    });
    expect(await screen.findByText("Erdgeschoss → Obergeschoss → Kellergeschoss")).toBeInTheDocument();
  });

  it("legt einen Steigweg auf einem Geschoss ohne Räume an", async () => {
    steigwege = [];
    api.post.mockResolvedValue({
      ...SCHACHT,
      id: "steigweg-2",
      name: "Schacht Küche",
      stops: [{ id: "neu-eg", floor_id: "eg", x_mm: 5000, y_mm: 3750 }],
      version: 1,
    });
    const onUngespeichert = vi.fn();
    zeigen({ onUngespeichert });
    await screen.findByText(/noch kein Steigweg angelegt/);
    expect(await screen.findByText(/keine Räume erfasst – die Fläche ist trotzdem bedienbar/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Steigweg anlegen" }));
    fireEvent.change(await screen.findByLabelText("Name *"), { target: { value: "Schacht Küche" } });
    // Klick in die Fläche (800 × 600 Bildpunkte auf 10 m × 7,5 m): Mitte = (5000, 3750).
    fireEvent.click(screen.getByTestId("steigweg-flaeche"), { clientX: 400, clientY: 300 });
    expect(screen.getByLabelText("x auf Erdgeschoss (cm)")).toHaveValue("500");
    expect(screen.getByLabelText("y auf Erdgeschoss (cm)")).toHaveValue("375");
    expect(screen.getByTestId("steigweg-halt")).toBeInTheDocument();
    expect(onUngespeichert).toHaveBeenLastCalledWith(true);
    expect(gibtUngespeicherteAenderungen()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0]?.[1]).toEqual({
      path: { building_id: "haus" },
      body: {
        name: "Schacht Küche",
        note: null,
        offset_mode: "orthogonal",
        stops: [{ floor_id: "eg", x_mm: 5000, y_mm: 3750 }],
      },
    });
    await waitFor(() => expect(onUngespeichert).toHaveBeenLastCalledWith(false));
    expect(gibtUngespeicherteAenderungen()).toBe(false);
  });

  it("verschiebt einen Halt mit stabiler ID und genauen Maßen", async () => {
    api.put.mockImplementation((_pfad: string, { body }: { body: { stops: unknown[] } }) =>
      Promise.resolve({ ...SCHACHT, stops: body.stops, version: 4 }),
    );
    zeigen({ aktiv: "og" });
    await geladen();
    fireEvent.click(screen.getByRole("button", { name: "Steigweg Installationsschacht Flur bearbeiten" }));
    const x = await screen.findByLabelText("x auf Obergeschoss (cm)");
    fireEvent.change(x, { target: { value: "170,5" } });
    fireEvent.blur(x);
    expect(screen.getByText("Ungespeicherte Änderungen")).toBeInTheDocument();
    expect(screen.getByTestId("steigweg-summe")).toHaveTextContent("650,5 cm");

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [, anfrage] = api.put.mock.calls[0] as [string, { ifMatch: number; body: { stops: { id?: string; x_mm: number }[] } }];
    expect(anfrage.ifMatch).toBe(3);
    expect(anfrage.body.stops.map((s) => s.id)).toEqual(["halt-kg", "halt-eg", "halt-og"]);
    expect(anfrage.body.stops[2]?.x_mm).toBe(1705);
    expect(await screen.findByText("Gespeichert")).toBeInTheDocument();
  });

  it("zeigt den waagerechten Versatz oben und verwirft Änderungen", async () => {
    zeigen({ aktiv: "og" });
    await geladen();
    const versatz = screen.getByTestId("steigweg-versatz");
    expect(versatz).toHaveAttribute("data-status", "confirmed");
    expect(versatz.querySelector("polyline")?.getAttribute("points")).toBe("1200,-3400 1650,-3400 1650,-3700");

    fireEvent.click(screen.getByRole("button", { name: "Steigweg Installationsschacht Flur bearbeiten" }));
    fireEvent.change(await screen.findByLabelText("Waagerechter Versatz"), { target: { value: "direct" } });
    expect(screen.getByTestId("steigweg-summe")).toHaveTextContent("624,1 cm");
    expect(screen.getByTestId("steigweg-versatz").querySelector("polyline")?.getAttribute("points")).toBe(
      "1200,-3400 1650,-3700",
    );
    fireEvent.click(screen.getByRole("button", { name: "Änderungen verwerfen" }));
    expect(screen.getByTestId("steigweg-summe")).toHaveTextContent("645 cm");
    expect(screen.getByText("Gespeichert")).toBeInTheDocument();
  });

  it("markiert ein durchquertes Geschoss ohne Anschluss", async () => {
    steigwege = [{ ...SCHACHT, stops: SCHACHT.stops.filter((s) => s.floor_id !== "eg") }];
    zeigen({ aktiv: "eg" });
    await geladen();
    expect(screen.getByTestId("steigweg-durchquert")).toBeInTheDocument();
    expect(screen.queryByTestId("steigweg-halt")).toBeNull();
  });

  it("meldet einen Versionskonflikt und lädt auf Wunsch neu", async () => {
    api.put.mockRejectedValue(
      new ApiError(
        409,
        { type: "https://elektroplan.example/problems/version-conflict", title: "Versionskonflikt", status: 409, detail: "Der Datensatz wurde zwischenzeitlich geaendert." },
        null,
      ),
    );
    zeigen();
    await geladen();
    fireEvent.click(screen.getByRole("button", { name: "Steigweg Installationsschacht Flur bearbeiten" }));
    fireEvent.change(await screen.findByLabelText("Name *"), { target: { value: "Neuer Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/zwischenzeitlich geaendert/)).toBeInTheDocument();
    steigwege = [{ ...SCHACHT, name: "Von anderer Seite", version: 4 }];
    fireEvent.click(screen.getByRole("button", { name: "Änderungen verwerfen und neu laden" }));
    await waitFor(() => expect(screen.getByLabelText("Name *")).toHaveValue("Von anderer Seite"));
    expect(screen.getByText("Gespeichert")).toBeInTheDocument();
  });

  it("verhindert das Speichern ohne gesetzten Übergabepunkt", async () => {
    zeigen();
    await geladen();
    fireEvent.click(screen.getByRole("button", { name: "Steigweg Installationsschacht Flur bearbeiten" }));
    fireEvent.click(await screen.findByLabelText("angebunden", { selector: "#steigweg-anbinden-og" }));
    fireEvent.click(screen.getByLabelText("angebunden", { selector: "#steigweg-anbinden-og" }));
    expect(screen.getByText("Noch nicht gesetzt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/Für Obergeschoss ist der Übergabepunkt noch nicht gesetzt/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
    // Lage vom Geschoss darunter übernehmen.
    fireEvent.click(screen.getByRole("button", { name: "Lage von Erdgeschoss übernehmen" }));
    expect(screen.getByLabelText("x auf Obergeschoss (cm)")).toHaveValue("120");
  });

  it("bleibt im Lesemodus unveränderlich", async () => {
    zeigen({ darfSchreiben: false });
    await geladen();
    expect(screen.queryByRole("button", { name: "Steigweg anlegen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Steigweg Installationsschacht Flur ansehen" }));
    expect(await screen.findByLabelText("Name *")).toBeDisabled();
    expect(screen.getByLabelText("x auf Erdgeschoss (cm)")).toBeDisabled();
    fireEvent.click(screen.getByTestId("steigweg-flaeche"), { clientX: 10, clientY: 10 });
    expect(screen.queryByText("Ungespeicherte Änderungen")).toBeNull();
    expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull();
  });

  it("zeigt Maße in der gewählten Einheit", async () => {
    masseinheitSetzen("mm");
    zeigen();
    await geladen();
    expect(screen.getByText("6.450 mm")).toBeInTheDocument();
    act(() => masseinheitSetzen("m"));
    expect(await screen.findByText("6,450 m")).toBeInTheDocument();
  });

  it("wechselt das Grundrissgeschoss über die Geschossliste", async () => {
    const onGeschoss = vi.fn();
    zeigen({ onGeschoss });
    await geladen();
    fireEvent.click(screen.getByRole("button", { name: "Steigweg Installationsschacht Flur bearbeiten" }));
    const zeile = (await screen.findByRole("cell", { name: "Obergeschoss" })).closest("tr");
    fireEvent.click(within(zeile as HTMLElement).getByRole("button", { name: "Im Grundriss zeigen" }));
    expect(onGeschoss).toHaveBeenCalledWith("og");
  });
});
