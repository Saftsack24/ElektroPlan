import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RAUM } from "./testdaten";
import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";

/**
 * Grafischer Editor im Projekt-Tab (Phase 4a) - Integration.
 *
 * Ersetzt werden nur die Grenzen: API (`useAuth`) und Route (`useParams`).
 * Rückfragen laufen über den echten `RueckfrageProvider` - einen
 * `window.confirm` gibt es nicht mehr. Zeigerereignisse laufen durch die echte
 * Zeichenfläche; die Weltkoordinaten ergeben sich aus der tatsächlichen
 * Viewport-Transformation des gerenderten SVG.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
let darfSchreiben = true;

vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: (permission: string) => (permission === "electrical.plan.write" ? darfSchreiben : true),
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const PROJEKT = { id: "projekt-1", status: "active", version: 2 };
const GEBAEUDE = { id: "gebaeude-1", name: "Hauptgebäude" };
const GESCHOSSE = [
  { id: "geschoss-1", building_id: "gebaeude-1", name: "Erdgeschoss", default_ceiling_height_mm: 2500 },
  { id: "geschoss-2", building_id: "gebaeude-1", name: "Obergeschoss", default_ceiling_height_mm: 2400 },
];

let projekt: { id: string; status: string; version: number } = PROJEKT;
let plan: { floor_id: string; project_id: string; rooms: unknown[] };

function problem(status: number, typ: string, errors?: unknown[]) {
  return new ApiError(
    status,
    { type: `https://elektroplan.internal/errors/${typ}`, title: "Fehler", status, detail: "Serverdetail", ...(errors ? { errors } : {}) } as never,
    null,
  );
}

function zeigen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}><RueckfrageProvider>
      <RoomsTab />
    </RueckfrageProvider></QueryClientProvider>,
  );
}

async function editorBereit() {
  await screen.findByRole("application", { name: /Grundriss/ });
}

/** Weltmillimeter → Clientpixel über die gerenderte Transformation. */
function bild(x: number, y: number): { clientX: number; clientY: number } {
  const g = document.querySelector("svg.grundriss__svg g[transform]");
  const m = (g?.getAttribute("transform") ?? "").match(/matrix\(([^)]+)\)/)?.[1]?.split(" ").map(Number) ?? [];
  const [a = 0, , , d = 0, e = 0, f = 0] = m;
  return { clientX: e + x * a, clientY: f + y * d };
}

function flaeche(): SVGSVGElement {
  return document.querySelector("svg.grundriss__svg") as SVGSVGElement;
}

function zeiger(ziel: Element, typ: string, x: number, y: number, extra: MouseEventInit = {}) {
  // jsdom kennt kein PointerEvent; React liest nur Typ und Koordinaten.
  fireEvent(ziel, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, ...bild(x, y), ...extra }));
}

/** Die eigene Rückfrage mit diesem Titel. */
async function rueckfrage(titel: string): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name: titel });
}

function klick(x: number, y: number, ziel: Element = flaeche()) {
  zeiger(ziel, "pointerdown", x, y);
  zeiger(flaeche(), "pointerup", x, y);
  zeiger(ziel, "click", x, y);
}

function taste(key: string, extra: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  darfSchreiben = true;
  projekt = PROJEKT;
  plan = { floor_id: "geschoss-1", project_id: "projekt-1", rooms: [RAUM] };
  api.get.mockImplementation((pfad: string, optionen?: { path?: Record<string, string> }) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve(projekt);
    if (pfad.endsWith("/buildings")) return Promise.resolve([GEBAEUDE]);
    if (pfad.endsWith("/floors")) return Promise.resolve(GESCHOSSE);
    if (pfad.endsWith("/plan")) {
      return Promise.resolve(optionen?.path?.floor_id === "geschoss-1" ? plan : { ...plan, floor_id: "geschoss-2", rooms: [] });
    }
    return Promise.resolve([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Grafischer Editor", () => {
  it("lädt den Planungsstand in einer Anfrage und zeigt Räume mit Maßen und Fläche", async () => {
    zeigen();
    await editorBereit();
    expect(await screen.findByText("20,00 m²")).toBeInTheDocument();
    expect(screen.getAllByText("500 cm")).toHaveLength(2);
    expect(api.get).toHaveBeenCalledWith("/api/v1/modules/electrical/floors/{floor_id}/plan", {
      path: { floor_id: "geschoss-1" },
    });
    // Keine Einzelabrufe je Raum oder Wand.
    expect(api.get.mock.calls.some(([pfad]) => String(pfad).endsWith("/walls"))).toBe(false);
  });

  it("wählt einen Raum aus und macht ihn bearbeitbar", async () => {
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer · Geschlossen/ }));
    expect(await screen.findByText(/Wohnzimmer: Keine ungespeicherten Änderungen/)).toBeInTheDocument();
    expect(document.querySelectorAll(".grundriss__ecke")).toHaveLength(4);
  });

  it("legt einen Rechteckraum mit zwei Klicks und einem Namen an", async () => {
    api.post.mockResolvedValue({ ...RAUM, id: "raum-neu", name: "Küche" });
    zeigen();
    await editorBereit();
    taste("r");
    klick(6000, 0);
    klick(9000, 3000);
    fireEvent.change(await screen.findByLabelText(/Bezeichnung/), { target: { value: "Küche" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [pfad, optionen] = api.post.mock.calls[0] as [string, { body: { name: string; walls: { x1_mm: number; y1_mm: number; x2_mm: number; y2_mm: number; id: string }[] } }];
    expect(pfad).toBe("/api/v1/modules/electrical/floors/{floor_id}/rooms");
    expect(optionen.body.name).toBe("Küche");
    expect(optionen.body.walls.map((w) => [w.x1_mm, w.y1_mm, w.x2_mm, w.y2_mm])).toEqual([
      [6000, 0, 9000, 0],
      [9000, 0, 9000, 3000],
      [9000, 3000, 6000, 3000],
      [6000, 3000, 6000, 0],
    ]);
    // Clientseitig erzeugte UUIDs (ADR 0007).
    expect(optionen.body.walls.every((w) => /^[0-9a-f-]{36}$/.test(w.id))).toBe(true);
  });

  it("bricht einen Polygonzug mit Escape ab und entfernt Punkte mit der Rücktaste", async () => {
    zeigen();
    await editorBereit();
    taste("p");
    klick(6000, 0);
    klick(9000, 0);
    klick(9000, 3000);
    expect(document.querySelector("polyline.grundriss__vorschau")).not.toBeNull();
    taste("Backspace");
    taste("Escape");
    expect(document.querySelector("polyline.grundriss__vorschau")).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("bearbeitet eine bestehende Kontur, speichert atomar und aktualisiert die Tabellenansicht", async () => {
    const gespeichert = {
      ...RAUM,
      version: 6,
      area_m2: "22.000",
      walls: RAUM.walls.map((w) => (w.id === "w2" ? { ...w, x2_mm: 6000 } : w.id === "w3" ? { ...w, x1_mm: 6000 } : w)),
    };
    api.put.mockResolvedValue(gespeichert);
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    const ecke = await screen.findByTestId("ecke-5000,4000");
    zeiger(ecke, "pointerdown", 5000, 4000);
    for (const x of [5200, 5500, 5800, 6000]) zeiger(flaeche(), "pointermove", x, 4000);
    zeiger(flaeche(), "pointerup", 6000, 4000);

    expect(await screen.findByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled(); // keine Anfrage während des Ziehens
    const aufrufeVorher = api.get.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await screen.findByText(/Wohnzimmer: Gespeichert/);
    expect(api.put).toHaveBeenCalledTimes(1);
    const [pfad, optionen] = api.put.mock.calls[0] as [string, { ifMatch: number; path: { room_id: string }; body: { walls: { id: string; x2_mm: number }[]; removed_opening_ids: string[] } }];
    expect(pfad).toBe("/api/v1/modules/electrical/rooms/{room_id}/contour");
    expect(optionen.ifMatch).toBe(5);
    expect(optionen.path.room_id).toBe("raum-1");
    expect(optionen.body.walls.map((w) => w.id)).toEqual(["w1", "w2", "w3", "w4"]);
    expect(optionen.body.walls[1]?.x2_mm).toBe(6000);
    expect(optionen.body.removed_opening_ids).toEqual([]);

    // Die Formularansicht liest danach neu.
    fireEvent.click(screen.getByRole("button", { name: "Tabellen & Details" }));
    await waitFor(() =>
      expect(api.get.mock.calls.slice(aufrufeVorher).some(([p]) => String(p).endsWith("/floors/{floor_id}/rooms"))).toBe(true),
    );
  });

  it("macht Änderungen mit Strg+Z rückgängig - aber nicht, solange ein Eingabefeld sie braucht", async () => {
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    zeiger(await screen.findByTestId("ecke-5000,4000"), "pointerdown", 5000, 4000);
    zeiger(flaeche(), "pointermove", 6000, 4000);
    zeiger(flaeche(), "pointerup", 6000, 4000);
    expect(await screen.findByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();

    const feld = screen.getByLabelText("X (cm)");
    fireEvent.keyDown(feld, { key: "z", ctrlKey: true });
    expect(screen.getByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();

    taste("z", { ctrlKey: true });
    expect(await screen.findByText(/Keine ungespeicherten Änderungen/)).toBeInTheDocument();
    taste("y", { ctrlKey: true });
    expect(await screen.findByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
  });

  it("behält bei 409 den Entwurf und bietet die beiden Wege an", async () => {
    api.put.mockRejectedValue(problem(409, "version-conflict"));
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    zeiger(await screen.findByTestId("ecke-5000,4000"), "pointerdown", 5000, 4000);
    zeiger(flaeche(), "pointermove", 6000, 4000);
    zeiger(flaeche(), "pointerup", 6000, 4000);
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));

    expect(await screen.findByText(/zwischenzeitlich an anderer Stelle geändert/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Serverstand laden/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Entwurf vorerst behalten" }));
    expect(await screen.findByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
    expect(screen.getAllByText("600 cm").length).toBeGreaterThan(0);
  });

  it("folgt der persönlichen Maßeinheit sofort, ohne die Geometrie zu ändern", async () => {
    zeigen();
    await editorBereit();
    expect(screen.getAllByText("500 cm")).toHaveLength(2);
    const geometrie = document.querySelector("svg.grundriss__svg g[transform]")?.innerHTML;

    act(() => masseinheitSetzen("mm"));

    expect(screen.getAllByText("5.000 mm")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "100 mm" })).toBeInTheDocument(); // Raster
    // Die SVG-Geometrie bleibt in Millimetern - unverändert.
    expect(document.querySelector("svg.grundriss__svg g[transform]")?.innerHTML).toBe(geometrie);
  });

  it("heißt „Ansicht zurücksetzen“ und erklärt, was die Schaltfläche tut", async () => {
    zeigen();
    await editorBereit();
    const knopf = screen.getByRole("button", { name: "Ansicht zurücksetzen" });
    expect(knopf).toHaveAttribute("title", expect.stringContaining("gesamten Grundriss"));
    expect(screen.queryByText(/Ansicht einpassen|^Einpassen$/)).toBeNull();
    fireEvent.click(knopf);
  });

  it("lädt den Serverstand erst nach der eigenen Rückfrage", async () => {
    api.put.mockRejectedValue(problem(409, "version-conflict"));
    const frage = vi.spyOn(window, "confirm");
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    zeiger(await screen.findByTestId("ecke-5000,4000"), "pointerdown", 5000, 4000);
    zeiger(flaeche(), "pointermove", 6000, 4000);
    zeiger(flaeche(), "pointerup", 6000, 4000);
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));
    const aufrufe = api.get.mock.calls.length;

    fireEvent.click(await screen.findByRole("button", { name: /Serverstand laden/ }));
    const dialog = await rueckfrage("Serverstand laden?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Änderungen behalten" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.get.mock.calls.length).toBe(aufrufe);

    fireEvent.click(screen.getByRole("button", { name: /Serverstand laden/ }));
    const zweiter = await rueckfrage("Serverstand laden?");
    fireEvent.click(
      within(zweiter).getByRole("button", { name: "Lokale Änderungen verwerfen und Serverstand laden" }),
    );
    expect(await screen.findByText(/Wohnzimmer: Keine ungespeicherten Änderungen/)).toBeInTheDocument();
    expect(frage).not.toHaveBeenCalled();
  });

  it("markiert bei 422 die betroffenen Wände und zeigt eine verständliche Meldung", async () => {
    api.put.mockRejectedValue(
      problem(422, "validation-failed", [{ field: "geometry", code: "walls-intersect", message: "raw", keys: ["w2", "w4"] }]),
    );
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    zeiger(await screen.findByTestId("ecke-5000,4000"), "pointerdown", 5000, 4000);
    zeiger(flaeche(), "pointermove", 6000, 4000);
    zeiger(flaeche(), "pointerup", 6000, 4000);
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));

    expect(await screen.findByText("Zwei Wände überschneiden oder berühren sich.")).toBeInTheDocument();
    expect(screen.queryByText("raw")).toBeNull();
    const markiert = [...document.querySelectorAll(".grundriss__wand--fehler")];
    expect(markiert).toHaveLength(2);
    expect(screen.getByText(/Nicht gespeichert - bitte prüfen/)).toBeInTheDocument();
  });

  it("Werkzeug Tür: Klick auf eine Wand öffnet deren Wandansicht, ohne eine Öffnung anzulegen (Phase 4f)", async () => {
    zeigen();
    await editorBereit();
    taste("t");
    klick(1500, 20, await screen.findByTestId("wand-w1"));
    const dialog = await screen.findByRole("dialog", { name: /Wandansicht · Wand 1/ });
    expect(within(dialog).getByRole("button", { name: "Tür" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelectorAll("svg.grundriss__svg [data-oeffnung]")).toHaveLength(0);
  });

  it("warnt beim Geschosswechsel mit ungespeicherten Änderungen", async () => {
    const frage = vi.spyOn(window, "confirm");
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    zeiger(await screen.findByTestId("ecke-5000,4000"), "pointerdown", 5000, 4000);
    zeiger(flaeche(), "pointermove", 6000, 4000);
    zeiger(flaeche(), "pointerup", 6000, 4000);
    await screen.findByText(/Ungespeicherte Änderungen/);

    fireEvent.change(screen.getByLabelText("Geschoss"), { target: { value: "geschoss-2" } });
    const dialog = await rueckfrage("Geschoss wechseln?");
    expect(within(dialog).getByText(/Obergeschoss/)).toBeInTheDocument();
    // Anfangsfokus auf der sicheren Wahl; Escape bricht ab.
    expect(within(dialog).getByRole("button", { name: "Änderungen behalten" })).toHaveFocus();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("Geschoss")).toHaveValue("geschoss-1");
    expect(screen.getByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Geschoss"), { target: { value: "geschoss-2" } });
    const zweiter = await rueckfrage("Geschoss wechseln?");
    fireEvent.click(within(zweiter).getByRole("button", { name: "Änderungen verwerfen und fortfahren" }));
    await waitFor(() => expect(screen.getByLabelText("Geschoss")).toHaveValue("geschoss-2"));
    expect(frage).not.toHaveBeenCalled();
  });

  it("fragt beim Wechsel zur 3D-Ansicht nach ungespeicherten Änderungen (Phase 4b)", async () => {
    // jsdom hat kein WebGL - die 3D-Ansicht zeigt dann ihren Hinweis.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    zeiger(await screen.findByTestId("ecke-5000,4000"), "pointerdown", 5000, 4000);
    zeiger(flaeche(), "pointermove", 6000, 4000);
    zeiger(flaeche(), "pointerup", 6000, 4000);
    await screen.findByText(/Ungespeicherte Änderungen/);

    // Abgelehnt: Editor, Entwurf und Auswahl bleiben; der Fokus kehrt zurück.
    const knopf = screen.getByRole("button", { name: "3D-Ansicht" });
    knopf.focus();
    fireEvent.click(knopf);
    const dialog = await rueckfrage("Ansicht wechseln?");
    expect(within(dialog).getByText(/„3D-Ansicht“/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Änderungen behalten" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(knopf).toHaveFocus();
    expect(screen.getByRole("button", { name: "2D-Editor" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Wohnzimmer: Ungespeicherte Änderungen/)).toBeInTheDocument();

    // Bestätigt: Wechsel zur 3D-Ansicht, ohne Schreibvorgang.
    fireEvent.click(screen.getByRole("button", { name: "3D-Ansicht" }));
    const zweiter = await rueckfrage("Ansicht wechseln?");
    fireEvent.click(within(zweiter).getByRole("button", { name: "Änderungen verwerfen und fortfahren" }));
    expect(await screen.findByText(/in diesem Browser nicht verfügbar/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("verwirft beim Raumwechsel nie still: speichern und wechseln oder beim Raum bleiben", async () => {
    const zweiter = {
      ...RAUM,
      id: "raum-2",
      name: "Flur",
      room_number: "0.02",
      walls: RAUM.walls.map((w) => ({ ...w, id: `${w.id}-b`, x1_mm: w.x1_mm + 6000, x2_mm: w.x2_mm + 6000 })),
    };
    plan = { ...plan, rooms: [RAUM, zweiter] };
    api.put.mockResolvedValue({ ...RAUM, version: 6 });
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    zeiger(await screen.findByTestId("ecke-5000,4000"), "pointerdown", 5000, 4000);
    zeiger(flaeche(), "pointermove", 5500, 4000);
    zeiger(flaeche(), "pointerup", 5500, 4000);
    await screen.findByText(/Wohnzimmer: Ungespeicherte Änderungen/);

    // Abgelehnt: Der Entwurf bleibt, der Raum bleibt aktiv.
    fireEvent.click(screen.getByRole("button", { name: /0.02 Flur/ }));
    const dialog = await rueckfrage("Raum wechseln?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Beim Raum bleiben" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/Wohnzimmer: Ungespeicherte Änderungen/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();

    // Speichern und wechseln: erst speichern, dann wechseln - genau einmal.
    fireEvent.click(screen.getByRole("button", { name: /0.02 Flur/ }));
    const nochmal = await rueckfrage("Raum wechseln?");
    fireEvent.click(within(nochmal).getByRole("button", { name: "Speichern und wechseln" }));
    expect(await screen.findByText(/Flur: Keine ungespeicherten Änderungen/)).toBeInTheDocument();
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it("verwirft beim Raumwechsel auf ausdrücklichen Wunsch, ohne zu speichern", async () => {
    const zweiter = {
      ...RAUM,
      id: "raum-2",
      name: "Flur",
      room_number: "0.02",
      walls: RAUM.walls.map((w) => ({ ...w, id: `${w.id}-b`, x1_mm: w.x1_mm + 6000, x2_mm: w.x2_mm + 6000 })),
    };
    plan = { ...plan, rooms: [RAUM, zweiter] };
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    zeiger(await screen.findByTestId("ecke-5000,4000"), "pointerdown", 5000, 4000);
    zeiger(flaeche(), "pointermove", 5500, 4000);
    zeiger(flaeche(), "pointerup", 5500, 4000);
    await screen.findByText(/Wohnzimmer: Ungespeicherte Änderungen/);

    fireEvent.click(screen.getByRole("button", { name: /0.02 Flur/ }));
    const dialog = await rueckfrage("Raum wechseln?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Änderungen verwerfen und fortfahren" }));
    expect(await screen.findByText(/Flur: Keine ungespeicherten Änderungen/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("warnt beim Neuladen oder Schließen des Browsers", async () => {
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    zeiger(await screen.findByTestId("ecke-5000,4000"), "pointerdown", 5000, 4000);
    zeiger(flaeche(), "pointermove", 6000, 4000);
    zeiger(flaeche(), "pointerup", 6000, 4000);
    await screen.findByText(/Ungespeicherte Änderungen/);
    const ereignis = new Event("beforeunload", { cancelable: true });
    act(() => {
      window.dispatchEvent(ereignis);
    });
    expect(ereignis.defaultPrevented).toBe(true);
  });

  it("zeigt ein archiviertes Projekt nur an - ohne Werkzeuge, Griffe und Speichern", async () => {
    projekt = { ...PROJEKT, status: "archived" };
    zeigen();
    await editorBereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    expect(await screen.findByText(/Nur Ansicht/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rechteckraum/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull();
    expect(document.querySelectorAll(".grundriss__ecke")).toHaveLength(0);
    expect(screen.getByText("20,00 m²")).toBeInTheDocument();
  });

  it("bleibt ohne Schreibrecht im Lesemodus", async () => {
    darfSchreiben = false;
    zeigen();
    await editorBereit();
    expect(screen.queryByRole("button", { name: /Polygonraum/ })).toBeNull();
    taste("r");
    klick(6000, 0);
    klick(9000, 3000);
    expect(screen.queryByLabelText(/Bezeichnung/)).toBeNull();
  });
});
