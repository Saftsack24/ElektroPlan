import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Oberfläche des Raummodells (Phase 3).
 *
 * `useAuth` und `useParams` werden ersetzt, damit die Komponenten ohne
 * Anmeldung und ohne Netzwerk laufen. Die Berechtigung steht dabei je Test
 * ausdrücklich fest - nur so ist belegt, dass wirklich der geprüfte Umstand
 * die Aktionen entfernt.
 *
 * **Der verbindliche Schutz liegt im Backend**: Geometrieprüfung,
 * Mandantentrennung, Berechtigungen und der Schreibschutz archivierter
 * Projekte werden in `tests/test_electrical_rooms.py` geprüft. Hier geht es
 * um die Bedienung.
 */
const api = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  upload: vi.fn(),
};

let darfSchreiben = true;

vi.mock("../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: (permission: string) =>
    permission === "electrical.plan.write" ? darfSchreiben : true,
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ projectId: "projekt-1" }),
}));

const { default: RoomsTab } = await import("./RoomsTab");

const PROJEKT = {
  id: "projekt-1",
  project_number: "PR-2026-0001",
  name: "Neubau Musterweg 1",
  status: "active",
  customer_id: "kunde-1",
  site_street: null,
  site_postal_code: null,
  site_city: null,
  site_country_code: "DE",
  version: 2,
  created_at: "2026-09-26T08:00:00Z",
  updated_at: "2026-09-26T08:00:00Z",
};

const GEBAEUDE = {
  id: "gebaeude-1",
  project_id: "projekt-1",
  name: "Hauptgebäude",
  sort_order: 0,
  version: 1,
  created_at: "2026-09-26T08:00:00Z",
  updated_at: "2026-09-26T08:00:00Z",
};

const GESCHOSSE = [
  {
    id: "geschoss-eg",
    building_id: "gebaeude-1",
    name: "Erdgeschoss",
    level: 0,
    elevation_mm: 0,
    default_ceiling_height_mm: 2500,
    version: 1,
    created_at: "2026-09-26T08:00:00Z",
    updated_at: "2026-09-26T08:00:00Z",
  },
  {
    id: "geschoss-og",
    building_id: "gebaeude-1",
    name: "Obergeschoss",
    level: 1,
    elevation_mm: 2750,
    default_ceiling_height_mm: 2400,
    version: 1,
    created_at: "2026-09-26T08:00:00Z",
    updated_at: "2026-09-26T08:00:00Z",
  },
];

const WOHNZIMMER = {
  id: "raum-1",
  floor_id: "geschoss-eg",
  name: "Wohnzimmer",
  room_number: "1.01",
  height_mm: null,
  effective_height_mm: 2500,
  contour_status: "valid" as const,
  wall_count: 4,
  area_mm2: 20_000_000,
  area_m2: "20.000",
  perimeter_mm: 18_000,
  version: 1,
  created_at: "2026-09-26T08:00:00Z",
  updated_at: "2026-09-26T08:00:00Z",
};

const BAD = {
  ...WOHNZIMMER,
  id: "raum-2",
  name: "Bad",
  room_number: "1.02",
  contour_status: "draft" as const,
  wall_count: 2,
  area_mm2: null,
  area_m2: null,
  perimeter_mm: 9_000,
};

const WAND = {
  id: "wand-1",
  room_id: "raum-1",
  sort_order: 0,
  x1_mm: 0,
  y1_mm: 0,
  x2_mm: 5000,
  y2_mm: 0,
  thickness_mm: 115,
  length_mm: 5000,
  opening_count: 1,
  version: 1,
  created_at: "2026-09-26T08:00:00Z",
  updated_at: "2026-09-26T08:00:00Z",
};

const ZWEITE_WAND = {
  ...WAND,
  id: "wand-2",
  sort_order: 1,
  x1_mm: 5000,
  y1_mm: 0,
  x2_mm: 5000,
  y2_mm: 4000,
  length_mm: 4000,
  opening_count: 0,
};

const TUER = {
  id: "oeffnung-1",
  wall_id: "wand-1",
  kind: "door" as const,
  offset_mm: 1000,
  width_mm: 1010,
  height_mm: 2010,
  sill_height_mm: 0,
  version: 1,
  created_at: "2026-09-26T08:00:00Z",
  updated_at: "2026-09-26T08:00:00Z",
};

const KONTUR_GUELTIG = {
  room_id: "raum-1",
  contour_status: "valid" as const,
  wall_count: 4,
  area_mm2: 20_000_000,
  area_m2: "20.000",
  perimeter_mm: 18_000,
  problems: [],
};

let projekt = PROJEKT;
let raeume: unknown[] = [WOHNZIMMER, BAD];
let kontur: unknown = KONTUR_GUELTIG;

function zeigen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <RoomsTab />
    </QueryClientProvider>,
  );
}

function klicken(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** Erster Knopf mit diesem Namen - es gibt je Wand einen gleichnamigen. */
function erstenKlicken(name: string) {
  const knoepfe = screen.getAllByRole("button", { name });
  const erster = knoepfe[0];
  if (erster === undefined) throw new Error(`Kein Knopf "${name}" gefunden.`);
  fireEvent.click(erster);
}

function tippen(label: RegExp | string, wert: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: wert } });
}

function waehlen(label: RegExp | string, wert: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: wert } });
}

function problem(status: number, typ: string, detail: string, errors?: unknown[]) {
  return new ApiError(
    status,
    {
      type: `https://elektroplan.internal/errors/${typ}`,
      title: "Fehler",
      status,
      detail,
      ...(errors ? { errors } : {}),
    } as never,
    "test-request",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  darfSchreiben = true;
  projekt = PROJEKT;
  raeume = [WOHNZIMMER, BAD];
  kontur = KONTUR_GUELTIG;

  api.get.mockImplementation((pfad: string, optionen?: { path?: Record<string, string> }) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve(projekt);
    if (pfad.endsWith("/buildings")) return Promise.resolve([GEBAEUDE]);
    if (pfad.endsWith("/floors")) return Promise.resolve(GESCHOSSE);
    if (pfad.endsWith("/rooms")) {
      const floor = optionen?.path?.floor_id;
      return Promise.resolve(raeume.filter((raum) => (raum as { floor_id: string }).floor_id === floor));
    }
    if (pfad.endsWith("/contour")) return Promise.resolve(kontur);
    if (pfad.endsWith("/walls")) return Promise.resolve([WAND, ZWEITE_WAND]);
    if (pfad.endsWith("/openings")) {
      return Promise.resolve(optionen?.path?.wall_id === "wand-1" ? [TUER] : []);
    }
    return Promise.resolve([]);
  });
  api.post.mockResolvedValue(WOHNZIMMER);
  api.patch.mockResolvedValue(WOHNZIMMER);
  api.delete.mockResolvedValue(undefined);
});

// ------------------------------------------------------- Geschoss und Liste

describe("Räume und Grundriss", () => {
  it("zeigt die Räume des ersten Geschosses samt Konturzustand", async () => {
    zeigen();

    expect(await screen.findByText("Wohnzimmer")).toBeInTheDocument();
    expect(screen.getByText("Geschlossen")).toBeInTheDocument();
    expect(screen.getByText("Entwurf")).toBeInTheDocument();
    expect(screen.getByText("20,00 m²")).toBeInTheDocument();
  });

  it("laedt nach der Geschossauswahl die Raeume des anderen Geschosses", async () => {
    raeume = [WOHNZIMMER, { ...BAD, id: "raum-3", name: "Kinderzimmer", floor_id: "geschoss-og" }];
    zeigen();
    await screen.findByText("Wohnzimmer");

    waehlen("Geschoss", "geschoss-og");

    expect(await screen.findByText("Kinderzimmer")).toBeInTheDocument();
    expect(screen.queryByText("Wohnzimmer")).not.toBeInTheDocument();
  });

  it("nennt den fehlenden Geschossaufbau, statt eine leere Liste zu zeigen", async () => {
    api.get.mockImplementation((pfad: string) => {
      if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve(PROJEKT);
      if (pfad.endsWith("/buildings")) return Promise.resolve([GEBAEUDE]);
      if (pfad.endsWith("/floors")) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    zeigen();

    expect(await screen.findByText(/noch kein Geschoss angelegt/)).toBeInTheDocument();
  });

  it("zeigt einen Ladezustand und danach die Liste", async () => {
    zeigen();

    expect(screen.getByText("Grundriss wird geladen ...")).toBeInTheDocument();
    expect(await screen.findByText("Wohnzimmer")).toBeInTheDocument();
  });

  it("meldet einen Ladefehler verstaendlich", async () => {
    api.get.mockImplementation((pfad: string) => {
      if (pfad === "/api/v1/projects/{project_id}") return Promise.reject(new Error("kaputt"));
      return Promise.resolve([]);
    });
    zeigen();

    expect(
      await screen.findByText(/Gebäudestruktur dieses Projekts konnte nicht geladen werden/),
    ).toBeInTheDocument();
  });

  it("zeigt einen Hinweis, wenn das Geschoss noch keinen Raum hat", async () => {
    raeume = [];
    zeigen();

    expect(await screen.findByText(/noch kein Raum erfasst/)).toBeInTheDocument();
  });
});

// ----------------------------------------------------------- Raum anlegen

describe("Raum anlegen", () => {
  it("sendet die Eingaben an den Server", async () => {
    zeigen();
    await screen.findByText("Wohnzimmer");

    klicken("Raum anlegen");
    tippen(/Bezeichnung/, "Küche");
    tippen(/Raumnummer/, "1.03");
    klicken("Speichern");

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/modules/electrical/floors/{floor_id}/rooms",
        {
          path: { floor_id: "geschoss-eg" },
          body: { name: "Küche", room_number: "1.03", height_mm: null },
        },
      ),
    );
  });

  it("verlangt eine Bezeichnung, ohne den Server zu fragen", async () => {
    zeigen();
    await screen.findByText("Wohnzimmer");

    klicken("Raum anlegen");
    klicken("Speichern");

    expect(await screen.findByText("Bitte eine Bezeichnung angeben.")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("behaelt die Eingaben bei einem Serverfehler", async () => {
    api.post.mockRejectedValue(
      problem(422, "validation-failed", "Die Raumnummer ist bereits vergeben."),
    );
    zeigen();
    await screen.findByText("Wohnzimmer");

    klicken("Raum anlegen");
    tippen(/Bezeichnung/, "Küche");
    tippen(/Raumnummer/, "1.01");
    klicken("Speichern");

    expect(await screen.findByText("Die Raumnummer ist bereits vergeben.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Bezeichnung/)).toHaveValue("Küche");
    expect(screen.getByLabelText(/Raumnummer/)).toHaveValue("1.01");
  });

  it("verhindert eine doppelte Uebermittlung", async () => {
    let freigeben: () => void = () => {};
    api.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          freigeben = () => resolve(WOHNZIMMER);
        }),
    );
    zeigen();
    await screen.findByText("Wohnzimmer");

    klicken("Raum anlegen");
    tippen(/Bezeichnung/, "Küche");
    const speichern = screen.getByRole("button", { name: "Speichern" });
    fireEvent.click(speichern);
    klicken("Wird gespeichert ...");

    expect(api.post).toHaveBeenCalledTimes(1);
    freigeben();
  });

  it("uebernimmt beim Bearbeiten die bisherigen Werte", async () => {
    zeigen();
    await screen.findByText("Wohnzimmer");

    klicken("Raum Wohnzimmer bearbeiten");

    expect(screen.getByLabelText(/Bezeichnung/)).toHaveValue("Wohnzimmer");
    expect(screen.getByLabelText(/Raumnummer/)).toHaveValue("1.01");
  });

  it("aendert mit If-Match der gelesenen Version", async () => {
    zeigen();
    await screen.findByText("Wohnzimmer");

    klicken("Raum Wohnzimmer bearbeiten");
    tippen(/Bezeichnung/, "Salon");
    klicken("Speichern");

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/v1/modules/electrical/rooms/{room_id}", {
        path: { room_id: "raum-1" },
        ifMatch: 1,
        body: { name: "Salon", room_number: "1.01", height_mm: null },
      }),
    );
  });
});

// -------------------------------------------------------- Kontur und Waende

describe("Raum öffnen", () => {
  it("zeigt Kontur, Waende und Oeffnungen", async () => {
    zeigen();
    await screen.findByText("Wohnzimmer");

    klicken("Raum Wohnzimmer öffnen");

    expect(await screen.findByText("Raumkontur")).toBeInTheDocument();
    expect(screen.getByText(/4 Wände/)).toBeInTheDocument();
    expect(screen.getByText(/Öffnungen in Wand 1/)).toBeInTheDocument();
    expect(await screen.findByText("Tür")).toBeInTheDocument();
  });

  it("nennt die Geometriefehler des Servers im Klartext", async () => {
    kontur = {
      room_id: "raum-1",
      contour_status: "draft",
      wall_count: 3,
      area_mm2: null,
      area_m2: null,
      perimeter_mm: 14_000,
      problems: [
        {
          code: "contour-not-closed",
          message: "Die letzte Wand endet nicht am Anfang der ersten Wand.",
          wall_ids: ["wand-1"],
        },
      ],
    };
    zeigen();
    await screen.findByText("Wohnzimmer");

    klicken("Raum Wohnzimmer öffnen");

    expect(
      await screen.findByText("Die letzte Wand endet nicht am Anfang der ersten Wand."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Entwurf").length).toBeGreaterThan(0);
  });

  it("legt eine Wand mit Koordinaten und Staerke an", async () => {
    api.post.mockResolvedValue(WAND);
    zeigen();
    await screen.findByText("Wohnzimmer");
    klicken("Raum Wohnzimmer öffnen");
    await screen.findByText("Raumkontur");

    klicken("Wand hinzufügen");
    tippen(/Endpunkt X/, "5000");
    tippen(/Wandstärke/, "240");
    klicken("Speichern");

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/modules/electrical/rooms/{room_id}/walls",
        {
          path: { room_id: "raum-1" },
          body: { x1_mm: 0, y1_mm: 0, x2_mm: 5000, y2_mm: 0, thickness_mm: 240 },
        },
      ),
    );
  });

  it("lehnt eine Wand mit identischem Start- und Endpunkt sofort ab", async () => {
    zeigen();
    await screen.findByText("Wohnzimmer");
    klicken("Raum Wohnzimmer öffnen");
    await screen.findByText("Raumkontur");

    klicken("Wand hinzufügen");
    klicken("Speichern");

    expect(
      await screen.findByText("Start- und Endpunkt müssen sich unterscheiden."),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("zeigt den serverseitigen Geometriefehler einer Wand", async () => {
    api.post.mockRejectedValue(
      problem(
        422,
        "validation-failed",
        "Die Wand passt nicht zu den bereits erfassten Waenden dieses Raums.",
        [
          {
            field: "geometry",
            code: "walls-intersect",
            message: "Zwei Waende ueberschneiden sich.",
          },
        ],
      ),
    );
    zeigen();
    await screen.findByText("Wohnzimmer");
    klicken("Raum Wohnzimmer öffnen");
    await screen.findByText("Raumkontur");

    klicken("Wand hinzufügen");
    tippen(/Endpunkt X/, "5000");
    klicken("Speichern");

    expect(
      await screen.findByText(/Die Wand passt nicht zu den bereits erfassten/),
    ).toBeInTheDocument();
    // Die Eingaben bleiben stehen.
    expect(screen.getByLabelText(/Endpunkt X/)).toHaveValue(5000);
  });

  it("ordnet die Waende ueber die vollstaendige Reihenfolge um", async () => {
    api.post.mockResolvedValue([ZWEITE_WAND, WAND]);
    zeigen();
    await screen.findByText("Wohnzimmer");
    klicken("Raum Wohnzimmer öffnen");
    await screen.findByText("Raumkontur");

    klicken("Wand 2 nach oben");

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/modules/electrical/rooms/{room_id}/walls/reorder",
        {
          path: { room_id: "raum-1" },
          ifMatch: 1,
          body: { wall_ids: ["wand-2", "wand-1"] },
        },
      ),
    );
  });

  it("meldet die Ablehnung einer Wandloeschung mit Oeffnungen", async () => {
    api.delete.mockRejectedValue(
      problem(409, "conflict", "Diese Wand traegt noch 1 Oeffnung(en)."),
    );
    zeigen();
    await screen.findByText("Wohnzimmer");
    klicken("Raum Wohnzimmer öffnen");
    await screen.findByText("Raumkontur");

    klicken("Wand 1 entfernen");

    expect(await screen.findByText(/traegt noch 1 Oeffnung/)).toBeInTheDocument();
  });

  it("pflegt eine Oeffnung mit If-Match", async () => {
    zeigen();
    await screen.findByText("Wohnzimmer");
    klicken("Raum Wohnzimmer öffnen");
    await screen.findByText("Tür");

    erstenKlicken("Bearbeiten");
    tippen(/Abstand vom Wandanfang/, "2000");
    klicken("Speichern");

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/api/v1/modules/electrical/openings/{opening_id}",
        {
          path: { opening_id: "oeffnung-1" },
          ifMatch: 1,
          body: {
            kind: "door",
            offset_mm: 2000,
            width_mm: 1010,
            height_mm: 2010,
            sill_height_mm: 0,
          },
        },
      ),
    );
  });

  it("lehnt eine Oeffnung ausserhalb der Wand sofort ab", async () => {
    zeigen();
    await screen.findByText("Wohnzimmer");
    klicken("Raum Wohnzimmer öffnen");
    await screen.findByText(/Öffnungen in Wand 1/);

    erstenKlicken("Öffnung hinzufügen");
    tippen(/Abstand vom Wandanfang/, "4500");
    klicken("Speichern");

    expect(await screen.findByText(/in die 5000 mm lange Wand passen/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("zeigt die Bruestungshoehe nur beim Fenster", async () => {
    zeigen();
    await screen.findByText("Wohnzimmer");
    klicken("Raum Wohnzimmer öffnen");
    await screen.findByText(/Öffnungen in Wand 1/);

    erstenKlicken("Öffnung hinzufügen");
    expect(screen.queryByLabelText(/Brüstungshöhe/)).not.toBeInTheDocument();

    waehlen(/^Art/, "window");

    expect(screen.getByLabelText(/Brüstungshöhe/)).toBeInTheDocument();
  });
});

// ------------------------------------------------- Berechtigung und Archiv

describe("Schreibschutz", () => {
  it("bietet ohne Schreibrecht keine Aktion an", async () => {
    darfSchreiben = false;
    zeigen();
    await screen.findByText("Wohnzimmer");

    expect(screen.queryByRole("button", { name: "Raum anlegen" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Raum Wohnzimmer bearbeiten" }),
    ).not.toBeInTheDocument();
    // Lesen bleibt möglich.
    expect(screen.getByRole("button", { name: "Raum Wohnzimmer öffnen" })).toBeInTheDocument();
  });

  it("archiviertes Projekt: lesbar, aber nicht bearbeitbar", async () => {
    projekt = { ...PROJEKT, status: "archived" };
    zeigen();
    await screen.findByText("Wohnzimmer");

    expect(await screen.findByText(/archiviert und damit/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raum anlegen" })).not.toBeInTheDocument();

    klicken("Raum Wohnzimmer öffnen");

    expect(await screen.findByText("Raumkontur")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wand hinzufügen" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Öffnung hinzufügen" }),
    ).not.toBeInTheDocument();
  });

  it("zeigt trotz Schreibschutz die vorhandenen Daten", async () => {
    projekt = { ...PROJEKT, status: "archived" };
    zeigen();
    await screen.findByText("Wohnzimmer");

    klicken("Raum Wohnzimmer öffnen");

    expect(await screen.findByText("Tür")).toBeInTheDocument();
  });
});
