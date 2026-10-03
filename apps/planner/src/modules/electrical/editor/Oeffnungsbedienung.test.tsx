import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";
import { RAUM } from "./testdaten";

/**
 * Türen direkt mit der Maus platzieren und verschieben (Phase 4b.2) -
 * Integration über den echten Editor. Ersetzt werden nur API und Route.
 *
 * Grundriss: „0.01 Wohnzimmer" (0…5000 × 0…4000) und daneben „0.02 Flur"
 * (5000…7000 × 0…4000). Die Wand x = 5000 ist gemeinsam: Wohnzimmer-Wand w2
 * läuft (5000,0)→(5000,4000), die Flurwand raum-2-w3 entgegengesetzt.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };

vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: () => true,
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const FLUR = rechteck("raum-2", "Flur", [5000, 0], [7000, 4000], { nummer: "0.02" });
let plan: { floor_id: string; project_id: string; rooms: unknown[] };

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

const flaeche = () => document.querySelector<SVGSVGElement>("svg.grundriss__svg")!;

function zeiger(ziel: Element, typ: string, x: number, y: number, extra: MouseEventInit = {}) {
  fireEvent(ziel, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, ...bild(x, y), ...extra }));
}

function klick(x: number, y: number, ziel: Element = flaeche()) {
  zeiger(ziel, "pointerdown", x, y);
  zeiger(flaeche(), "pointerup", x, y);
  zeiger(ziel, "click", x, y);
}

const taste = (key: string) => fireEvent.keyDown(window, { key });
const vorschau = () => screen.queryByTestId("oeffnungsvorschau");
const abstand = () => screen.getByLabelText<HTMLInputElement>(/^Abstand \(/).value;
const oeffnungen = () => [...document.querySelectorAll<SVGElement>("[data-oeffnung]")];

async function bereit() {
  await screen.findByRole("application", { name: /Grundriss/ });
}

/** Wohnzimmer aktivieren und das Türwerkzeug wählen. */
async function wohnzimmerMitTuerwerkzeug() {
  zeigen();
  await bereit();
  fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
  taste("t");
}

/** Gespeicherte Tür(en) an der gemeinsamen Wohnzimmerwand w2. */
function tuer(id: string, offset: number) {
  return { id, wall_id: "w2", kind: "door" as const, offset_mm: offset, width_mm: 885, height_mm: 2010, sill_height_mm: 0, version: 1, created_at: "", updated_at: "" };
}
function wohnzimmerMit(...tueren: ReturnType<typeof tuer>[]) {
  return { ...RAUM, walls: RAUM.walls.map((w) => (w.id === "w2" ? { ...w, opening_count: tueren.length, openings: tueren } : w)) };
}

/** Wohnzimmer mit einer Tür mittig auf der gemeinsamen Wand (Mitte y = 2000 → Abstand 1550), ausgewählt. */
async function tuerAufGemeinsamerWand(weitere: ReturnType<typeof tuer>[] = []) {
  plan = { ...plan, rooms: [wohnzimmerMit(tuer("tuer-1", 1550), ...weitere), plan.rooms[1]] };
  zeigen();
  await bereit();
  fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
  klick(5000, 2000, await screen.findByTestId("oeffnung-tuer-1"));
  await screen.findByText(/Tür in Wand 2/);
}

const wandansicht = () => screen.queryByRole("dialog", { name: /Wandansicht/ });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  plan = { floor_id: "geschoss-1", project_id: "projekt-1", rooms: [RAUM, FLUR] };
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) {
      return Promise.resolve([{ id: "geschoss-1", building_id: "gebaeude-1", name: "Erdgeschoss", default_ceiling_height_mm: 2500 }]);
    }
    if (pfad.endsWith("/plan")) return Promise.resolve(plan);
    return Promise.resolve([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Tür, Fenster, Durchgang: Standardweg über die Wandansicht (Phase 4f)", () => {
  it("drei Werkzeuge; Tür (T) ist gedrückt", async () => {
    await wohnzimmerMitTuerwerkzeug();
    expect(screen.getByRole("button", { name: "Tür" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Fenster" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Durchgang" })).toHaveAttribute("aria-pressed", "false");
  });

  it("über der gemeinsamen Wand wird die ganze Wand der Raumseite unter dem Zeiger hervorgehoben", async () => {
    await wohnzimmerMitTuerwerkzeug();
    zeiger(flaeche(), "pointermove", 4980, 2000);
    expect(screen.getByTestId("wandvorschau")).toHaveTextContent("Wand 2 von „0.01 Wohnzimmer“ – Klick öffnet die Wandansicht (Tür setzen)");
    zeiger(flaeche(), "pointermove", 5020, 2000);
    expect(screen.getByTestId("wandvorschau")).toHaveTextContent("Wand 4 von „0.02 Flur“");
    expect(vorschau()).toBeNull();
  });

  it("Klick wählt nur die Wand und öffnet ihre Wandansicht mit Tür-Werkzeug - keine Öffnung entsteht", async () => {
    await wohnzimmerMitTuerwerkzeug();
    klick(4980, 2000);
    const dialog = await screen.findByRole("dialog", { name: "Wandansicht · Wand 2 · 0.01 Wohnzimmer" });
    expect(within(dialog).getByRole("button", { name: "Tür" })).toHaveAttribute("aria-pressed", "true");
    // Die ganze Wand des Raums: 400 cm, nicht ein Abschnitt hinter dem Nachbarn.
    expect(within(dialog).getByText(/^400 cm breit/)).toBeInTheDocument();
    expect(oeffnungen()).toHaveLength(0);
    expect(within(dialog).getByText("Wohnzimmer: Keine ungespeicherten Änderungen")).toBeInTheDocument();
  });

  it("Fenster (N) und Durchgang (D) öffnen die Wandansicht mit ihrem Werkzeug", async () => {
    zeigen();
    await bereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    taste("n");
    klick(2500, 20);
    let dialog = await screen.findByRole("dialog", { name: "Wandansicht · Wand 1 · 0.01 Wohnzimmer" });
    expect(within(dialog).getByRole("button", { name: "Fenster" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Dialog schließen" }));
    taste("d");
    klick(2500, 20);
    dialog = await screen.findByRole("dialog", { name: "Wandansicht · Wand 1 · 0.01 Wohnzimmer" });
    expect(within(dialog).getByRole("button", { name: "Durchgang" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Abbrechen ohne Platzierung legt nichts an", async () => {
    await wohnzimmerMitTuerwerkzeug();
    klick(4980, 2000);
    const dialog = await screen.findByRole("dialog", { name: /Wandansicht/ });
    // Escape: zuerst das Werkzeug, dann schließen.
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(within(dialog).getByRole("button", { name: "Auswählen" })).toHaveAttribute("aria-pressed", "true");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(wandansicht()).toBeNull();
    expect(oeffnungen()).toHaveLength(0);
    expect(screen.getByText(/Keine ungespeicherten Änderungen/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("Klick von der Flurseite wechselt in den Flur und öffnet dessen Wand", async () => {
    await wohnzimmerMitTuerwerkzeug();
    klick(5020, 2000);
    expect(await screen.findByRole("dialog", { name: "Wandansicht · Wand 4 · 0.02 Flur" })).toBeInTheDocument();
  });

  it("mit ungespeicherten Änderungen fragt der Wechsel zur anderen Raumseite nach", async () => {
    await tuerAufGemeinsamerWand();
    // Tür verschieben (ungespeichert), dann von der Flurseite eine Wand wählen.
    zeiger(oeffnungen()[0]!, "pointerdown", 5000, 2000);
    zeiger(flaeche(), "pointermove", 5000, 2500);
    zeiger(flaeche(), "pointerup", 5000, 2500);
    taste("t");
    klick(5020, 3500);
    const frage = await screen.findByRole("dialog", { name: "Raum wechseln?" });
    fireEvent.click(within(frage).getByRole("button", { name: "Beim Raum bleiben" }));
    expect(wandansicht()).toBeNull();
    expect(abstand()).toBe("205");
  });

  it("in der Wandansicht gesetzt, im Grundriss sichtbar, rückgängig zu machen und genau einmal gespeichert", async () => {
    api.put.mockImplementation((_pfad: string, optionen: { body: unknown }) => Promise.resolve({ ...RAUM, version: 6, ...(optionen.body as object) }));
    await wohnzimmerMitTuerwerkzeug();
    klick(4980, 2000);
    const dialog = await screen.findByRole("dialog", { name: /Wandansicht/ });
    const wand = within(dialog).getByTestId("wandflaeche");
    const x = Number(wand.getAttribute("x")) + Number(wand.getAttribute("width")) / 2;
    const y = Number(wand.getAttribute("y")) + Number(wand.getAttribute("height")) / 2;
    const svg = dialog.querySelector("svg.ansicht__svg")!;
    for (const typ of ["pointermove", "pointerdown", "pointerup"]) {
      fireEvent(svg, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
    }
    await within(dialog).findByText(/Tür gesetzt/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Dialog schließen" }));
    expect(oeffnungen()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(oeffnungen()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(oeffnungen()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByText(/Gespeichert/);
    const [, optionen] = api.put.mock.calls[0] as [string, { body: { walls: { id: string; openings: { kind: string }[] }[] } }];
    const alle = optionen.body.walls.flatMap((w) => w.openings.map((o) => ({ wand: w.id, ...o })));
    expect(alle).toHaveLength(1);
    expect(alle[0]).toMatchObject({ wand: "w2", kind: "door" });
  });

  it("Klick mit dem Werkzeug auf eine vorhandene Öffnung öffnet ihre Wandansicht mit Auswahl", async () => {
    plan = { ...plan, rooms: [wohnzimmerMit(tuer("tuer-1", 1550)), FLUR] };
    await wohnzimmerMitTuerwerkzeug();
    klick(5000, 2000, await screen.findByTestId("oeffnung-tuer-1"));
    const dialog = await screen.findByRole("dialog", { name: "Wandansicht · Wand 2 · 0.01 Wohnzimmer" });
    expect(within(dialog).getByRole("textbox", { name: /^Abstand von links/ })).toHaveValue("156,5");
    expect(within(dialog).getByRole("button", { name: "Auswählen" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Doppelklick im Auswahlwerkzeug öffnet die Wandansicht; die Seitenleiste bietet sie als ersten Weg an", async () => {
    await tuerAufGemeinsamerWand();
    expect(screen.getByRole("button", { name: "In der Wandansicht bearbeiten" })).toBeInTheDocument();
    zeiger(screen.getByTestId("oeffnung-tuer-1"), "dblclick", 5000, 2000);
    expect(await screen.findByRole("dialog", { name: "Wandansicht · Wand 2 · 0.01 Wohnzimmer" })).toBeInTheDocument();
  });

  it("die Einheit mm folgt auch in der Wandansicht - gespeichert bleibt der Abstand ab Wandanfang", async () => {
    act(() => masseinheitSetzen("mm"));
    plan = { ...plan, rooms: [wohnzimmerMit(tuer("tuer-1", 1550)), FLUR] };
    await wohnzimmerMitTuerwerkzeug();
    klick(5000, 2000, await screen.findByTestId("oeffnung-tuer-1"));
    const dialog = await screen.findByRole("dialog", { name: /Wandansicht/ });
    // Blick nach Osten: links ist Norden - 4000 − 1550 − 885 = 1565 mm.
    expect(within(dialog).getByRole("textbox", { name: "Abstand von links (mm)" })).toHaveValue("1565");
    act(() => masseinheitSetzen("cm"));
  });
});

describe("Tür per Maus verschieben", () => {
  function greifen() {
    const o = oeffnungen()[0]!;
    zeiger(o, "pointerdown", 5000, 2000);
    return o;
  }

  it("verschiebt nur entlang der eigenen Wand - quer zum Zeiger bleibt sie an der Wand", async () => {
    await tuerAufGemeinsamerWand();
    greifen();
    zeiger(flaeche(), "pointermove", 5600, 3000); // 60 cm neben der Wand
    expect(vorschau()).toHaveTextContent("verbindet „0.01 Wohnzimmer“ und „0.02 Flur“ · Abstand 255 cm");
    zeiger(flaeche(), "pointerup", 5600, 3000);
    expect(abstand()).toBe("255");
    expect(oeffnungen()[0]).toHaveAttribute("data-wand", "w2");
    expect(vorschau()).toBeNull();
  });

  it("Fang 5 cm beim Ziehen; bis an das Wandende, nie darüber hinaus", async () => {
    await tuerAufGemeinsamerWand();
    greifen();
    zeiger(flaeche(), "pointermove", 5000, 2733);
    zeiger(flaeche(), "pointermove", 5000, 3990);
    zeiger(flaeche(), "pointerup", 5000, 3990);
    expect(abstand()).toBe(String((4000 - 885) / 10).replace(".", ","));
  });

  it("Kollision beim Ziehen: die letzte gültige Lage bleibt, die Vorschau nennt den Grund", async () => {
    // Zweite Tür nahe dem Wandanfang (Abstand 0 … 885).
    await tuerAufGemeinsamerWand([tuer("tuer-0", 0)]);
    const erste = screen.getByTestId("oeffnung-tuer-1");
    zeiger(erste, "pointerdown", 5000, 2000);
    zeiger(flaeche(), "pointermove", 5000, 2600);
    zeiger(flaeche(), "pointermove", 5000, 900);
    expect(vorschau()).toHaveTextContent(/Überschneidet sich mit der vorhandenen Tür bei 0 cm/);
    zeiger(flaeche(), "pointerup", 5000, 900);
    expect(abstand()).toBe("215");
  });

  it("Escape bricht das Ziehen ab, stellt die Lage wieder her und gibt den Zeiger frei", async () => {
    await tuerAufGemeinsamerWand();
    const svg = flaeche();
    const eingefangen = new Set<number>();
    const einfangen = vi.fn((id: number) => void eingefangen.add(id));
    const freigeben = vi.fn((id: number) => void eingefangen.delete(id));
    svg.setPointerCapture = einfangen;
    svg.hasPointerCapture = (id: number) => eingefangen.has(id);
    svg.releasePointerCapture = freigeben;
    const o = oeffnungen()[0]!;
    fireEvent(o, Object.assign(new MouseEvent("pointerdown", { bubbles: true, button: 0, ...bild(5000, 2000) }), { pointerId: 7 }));
    expect(einfangen).toHaveBeenCalledWith(7);
    zeiger(svg, "pointermove", 5000, 3000);
    taste("Escape");
    expect(freigeben).toHaveBeenCalledWith(7);
    expect(eingefangen.size).toBe(0);
    expect(abstand()).toBe("155");
    expect(vorschau()).toBeNull();
    // Weitere Bewegungen verschieben nichts mehr.
    zeiger(svg, "pointermove", 5000, 1000);
    zeiger(svg, "pointerup", 5000, 1000);
    expect(abstand()).toBe("155");
  });

  it("Loslassen gibt den eingefangenen Zeiger frei", async () => {
    await tuerAufGemeinsamerWand();
    const svg = flaeche();
    let gefangen = false;
    const freigeben = vi.fn(() => void (gefangen = false));
    svg.setPointerCapture = () => void (gefangen = true);
    svg.hasPointerCapture = () => gefangen;
    svg.releasePointerCapture = freigeben;
    greifen();
    zeiger(svg, "pointermove", 5000, 2500);
    zeiger(svg, "pointerup", 5000, 2500);
    expect(freigeben).toHaveBeenCalledTimes(1);
    expect(gefangen).toBe(false);
  });

  it("Wechsel vom gemeinsamen auf ein nicht geteiltes Wandstück wird klar gemeldet", async () => {
    // Der Flur ist kürzer: nur 0 … 2000 der Wohnzimmerwand ist gemeinsam.
    plan = { ...plan, rooms: [wohnzimmerMit(tuer("tuer-1", 550)), rechteck("raum-2", "Flur", [5000, 0], [7000, 2000], { nummer: "0.02" })] };
    zeigen();
    await bereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    klick(5000, 1000, await screen.findByTestId("oeffnung-tuer-1"));
    await screen.findByText(/Tür in Wand 2/);
    expect(screen.getByText("Verbindet „0.01 Wohnzimmer“ und „0.02 Flur“")).toBeInTheDocument();
    greifen();
    zeiger(flaeche(), "pointermove", 5000, 3000);
    expect(vorschau()).toHaveTextContent("nicht geteilte Wand – kein zweiter Raum");
    zeiger(flaeche(), "pointerup", 5000, 3000);
    expect(await screen.findByText(/verbindet keine zwei Räume mehr/)).toBeInTheDocument();
  });

  it("ungespeicherte Tür: Raumwechsel fragt über den eigenen Dialog", async () => {
    await tuerAufGemeinsamerWand();
    greifen();
    zeiger(flaeche(), "pointermove", 5000, 2600);
    zeiger(flaeche(), "pointerup", 5000, 2600);
    expect(screen.getByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /0.02 Flur/ }));
    expect(await screen.findByRole("dialog", { name: "Raum wechseln?" })).toBeInTheDocument();
  });
});

describe("Abgeleitete Darstellung im Nachbarraum", () => {
  const MIT_TUER = {
    ...RAUM,
    walls: RAUM.walls.map((w) =>
      w.id === "w2"
        ? { ...w, opening_count: 1, openings: [{ id: "tuer-1", wall_id: "w2", kind: "door" as const, offset_mm: 1550, width_mm: 885, height_mm: 2010, sill_height_mm: 0, version: 1, created_at: "", updated_at: "" }] }
        : w,
    ),
  };

  it("im Nachbarraum gestrichelt als abgeleitet; ein Klick wählt die eine gespeicherte Tür", async () => {
    plan = { ...plan, rooms: [MIT_TUER, FLUR] };
    zeigen();
    await bereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.02 Flur/ }));
    const tuer = await screen.findByTestId("oeffnung-tuer-1");
    expect(oeffnungen()).toHaveLength(1); // einmal gezeichnet, nicht je Raumseite
    expect(tuer).toHaveAttribute("data-abgeleitet", "ja");
    expect(tuer.closest("g")).toHaveClass("grundriss__oeffnung--abgeleitet");
    expect(tuer.closest("g")?.querySelector("title")?.textContent).toContain("abgeleitete Darstellung");

    // In der Seitenleiste der Flurwand: abgeleitet, mit Weg zur echten Tür.
    klick(5000, 3500, await screen.findByTestId("wand-raum-2-w3"));
    const hinweis = await screen.findByRole("button", { name: /Tür, 88,5 cm breit – gespeichert in „0.01 Wohnzimmer“/ });
    fireEvent.click(hinweis);
    expect(await screen.findByText(/Tür in Wand 2/)).toBeInTheDocument();
    expect(screen.getByText("Verbindet „0.01 Wohnzimmer“ und „0.02 Flur“")).toBeInTheDocument();
    expect(tuer).toHaveAttribute("data-wand", "w2");
  });

  it("eine abgeleitete Darstellung lässt sich nicht separat löschen", async () => {
    plan = { ...plan, rooms: [MIT_TUER, FLUR] };
    zeigen();
    await bereit();
    fireEvent.click(await screen.findByRole("button", { name: /0.02 Flur/ }));
    klick(5000, 3500, await screen.findByTestId("wand-raum-2-w3"));
    await screen.findByText(/Abgeleitet aus dem Nachbarraum/);
    // Die Flurwand trägt selbst keine Öffnung - Entfernen betrifft nur eigene Öffnungen.
    expect(screen.getByText("Keine Öffnung in dieser Wand.")).toBeInTheDocument();
    taste("Delete");
    expect(screen.getByTestId("oeffnung-tuer-1")).toBeInTheDocument();
  });
});
