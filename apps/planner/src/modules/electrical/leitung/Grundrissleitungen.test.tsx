import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";
import { GESCHOSS, KOPPLUNG, TYPEN, VERTEILUNG, leitung, stromkreis, vorlage, wirksam } from "./testdaten";
import { eigenschaftenOeffnen } from "../arbeitsflaeche/testhilfe";

/**
 * Leitung im Grundriss (Phase 6b.5, Zeichenablauf seit 6c L2) über den echten Editor - ersetzt
 * werden nur API, Route und Rechte. Das Klickziel bestimmt die Punktart: Wandlinie = Wandpunkt, im
 * Raum Fußboden oder Decke nach „Raumpunkt“; Übergänge liegen genau auf der Wandachse.
 *
 * EG: Diele (0,0)–(4200,3000) mit Tür `t1` in der gemeinsamen Ostwand
 * `diele-w1` (300–1200) und Fenster `f1` in der Westwand; Küche
 * (4200,0)–(8000,3000). OG (Höhe 2 800): Flur (0,0)–(4200,3000) mit Steckdose
 * an der Südwand bei 2 000. Steigweg S1 hält in beiden Geschossen bei
 * (1000, 2000), orthogonal.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }), usePermission: () => true }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const ZEIT = "2026-10-13T08:00:00Z";

const DIELE = rechteck("diele", "Diele", [0, 0], [4200, 3000], {
  nummer: "0.01",
  geraete: [
    { id: "uv1", typ: "distribution_board", wand: 0, mitte: 500, hoehe: 1400 },
    { id: "sd-diele", typ: "socket_single", wand: 0, mitte: 3000, hoehe: 300 },
  ],
  oeffnungen: {
    1: [{ id: "t1", art: "door", offset: 300, breite: 900, hoehe: 2010 }],
    3: [{ id: "f1", art: "window", offset: 1000, breite: 1000, hoehe: 1200, bruestung: 900 }],
  },
});
const KUECHE = rechteck("kueche", "Küche", [4200, 0], [8000, 3000], {
  nummer: "0.02",
  geraete: [{ id: "sd-kueche", typ: "socket_single", wand: 3, mitte: 900, hoehe: 300 }],
});
const FLUR = rechteck("flur", "Flur", [0, 0], [4200, 3000], {
  nummer: "1.01",
  floorId: "geschoss-2",
  geraete: [{ id: "sd-og", typ: "socket_single", wand: 0, mitte: 2000, hoehe: 300 }],
});

let og = { ...GESCHOSS, id: "geschoss-2", name: "Obergeschoss", level: 1, elevation_mm: 2800 };
let zweitesGebaeude = false;

const STEIGWEG = {
  id: "s1",
  building_id: "gebaeude-1",
  name: "S1",
  note: null,
  offset_mode: "orthogonal" as const,
  stops: [
    { id: "h-eg", floor_id: "geschoss-1", x_mm: 1000, y_mm: 2000 },
    { id: "h-og", floor_id: "geschoss-2", x_mm: 1000, y_mm: 2000 },
  ],
  sections: [],
  status: "confirmed" as const,
  known_length_mm: 2800,
  length_mm: 2800,
  version: 1,
  created_at: ZEIT,
  updated_at: ZEIT,
};

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

function bildpunkt(x: number, y: number) {
  const g = document.querySelector("svg.grundriss__svg g[transform]");
  const m = (g?.getAttribute("transform") ?? "").match(/matrix\(([^)]+)\)/)?.[1]?.split(" ").map(Number) ?? [];
  const [a = 0, , , d = 0, e = 0, f = 0] = m;
  return { clientX: e + x * a, clientY: f + y * d };
}

/** Ein Klick im Grundriss an Weltkoordinaten (mm) - auf das Element darunter oder die Fläche. */
function klick(x: number, y: number, ziel: Element = screen.getByRole("application", { name: /Grundriss/ })) {
  for (const typ of ["pointermove", "pointerdown", "pointerup", "click"]) {
    fireEvent(ziel, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, ...bildpunkt(x, y) }));
  }
}

const leiste = () => screen.getByTestId("zeichenleiste");
const zusatzleiste = () => screen.getByRole("group", { name: "Leitung im Grundriss" });
const entwurf = () => screen.getByRole("region", { name: "Leitungsentwurf" });
const wegpunkte = () => within(entwurf()).queryAllByRole("listitem").filter((li) => li.closest("ol[aria-label='Wegpunkte']") !== null);
const raumpunkt = (name: "Fußboden" | "Decke") => fireEvent.click(within(leiste()).getByRole("button", { name }));
const hoehe = (wert: string) => fireEvent.change(within(leiste()).getByLabelText("Höhe neuer Wandpunkte"), { target: { value: wert } });
const geraet = (id: string) => screen.getByTestId(`grundriss-geraet-${id}`).querySelector("rect.grundriss__geraet-treffer") as Element;

/** „Leitung hinzufügen“ oben, dann UV1 (Diele Süd, Abstand 500) als Startgerät. */
async function neueLeitung() {
  zeigen();
  await screen.findByRole("application", { name: /Grundriss/ });
  // Wegpunkte zum Lesen stehen im Eigenschaftenpanel (6c.0); gezeichnet wird ohne Formular.
  await eigenschaftenOeffnen();
  fireEvent.click(await screen.findByRole("button", { name: "Leitung hinzufügen" }));
  await screen.findByTestId("zeichenleiste");
  klick(500, 0, geraet("uv1"));
  expect(within(leiste()).getByText(/2 Verlauf zeichnen/)).toHaveAttribute("aria-current", "step");
}

/** Wandpunkt Diele Süd bei 1 000 auf Fußbodenhöhe, dann ausdrücklich der Übergang zum Fußboden. */
function bisZumFussboden() {
  hoehe("0");
  klick(1000, 30);
  fireEvent.click(within(leiste()).getByTestId("uebergang-floor"));
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  og = { ...GESCHOSS, id: "geschoss-2", name: "Obergeschoss", level: 1, elevation_mm: 2800 };
  zweitesGebaeude = false;
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  api.get.mockImplementation((pfad: string, o?: { path?: Record<string, string>; query?: Record<string, string> }) => {
    const floor = o?.path?.floor_id;
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
    if (pfad.endsWith("/effective")) return Promise.resolve(wirksam(o?.query));
    if (pfad.endsWith("/cable-templates")) return Promise.resolve({ templates: [vorlage()] });
    if (pfad.endsWith("/buildings")) {
      return Promise.resolve([{ id: "gebaeude-1", name: "Haus" }, ...(zweitesGebaeude ? [{ id: "gebaeude-2", name: "Garage" }] : [])]);
    }
    if (pfad.endsWith("/floors")) {
      return Promise.resolve(o?.path?.building_id === "gebaeude-2" ? [{ ...GESCHOSS, id: "geschoss-g", building_id: "gebaeude-2", name: "Garage EG" }] : [GESCHOSS, og]);
    }
    if (pfad.endsWith("/plan")) {
      if (floor === "geschoss-2") return Promise.resolve({ floor_id: "geschoss-2", project_id: "projekt-1", rooms: [FLUR], wall_links: [], wall_link_candidates: [] });
      if (floor === "geschoss-g") return Promise.resolve({ floor_id: "geschoss-g", project_id: "projekt-1", rooms: [], wall_links: [], wall_link_candidates: [] });
      return Promise.resolve({ floor_id: "geschoss-1", project_id: "projekt-1", rooms: [DIELE, KUECHE], wall_links: [KOPPLUNG], wall_link_candidates: [] });
    }
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    if (pfad.endsWith("/distribution-boards")) return Promise.resolve({ building_id: "gebaeude-1", boards: [VERTEILUNG] });
    if (pfad.endsWith("/circuits")) return Promise.resolve({ building_id: "gebaeude-1", circuits: [stromkreis({ device_ids: ["sd-diele", "sd-kueche", "sd-og"] })] });
    if (pfad.endsWith("/cables")) return Promise.resolve({ building_id: "gebaeude-1", cables: [] });
    if (pfad.endsWith("/penetrations")) return Promise.resolve({ floor_id: floor, penetrations: [] });
    if (pfad.endsWith("/risers")) return Promise.resolve({ building_id: "gebaeude-1", risers: [STEIGWEG] });
    return Promise.resolve([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Klickziel und Raumfläche (L2)", () => {
  it("Wandlinie = Wandpunkt mit sichtbarer Höhe; Übergang ausdrücklich; Fußboden rechtwinklig, „Gerade“ wählbar, Kontur", async () => {
    await neueLeitung();
    // Ohne Wahl folgt die Höhe dem Vorgänger - nach UV1 dessen Mitte (140 cm), vor dem Klick genannt.
    for (const typ of ["pointermove"]) fireEvent(screen.getByRole("application", { name: /Grundriss/ }), new MouseEvent(typ, { bubbles: true, cancelable: true, ...bildpunkt(1000, 30) }));
    expect(screen.getByText(/Nächster Klick: Wegpunkt 1 setzen \(Wand\).*140 cm hoch – genau in der Wandfläche/)).toBeInTheDocument();
    bisZumFussboden();
    expect(wegpunkte()).toHaveLength(2);
    expect(wegpunkte()[0]).toHaveTextContent("Wandpunkt · Wand 1 (0.01 Diele) · 100 cm ab Wandanfang · 0 cm hoch");
    expect(wegpunkte()[1]).toHaveTextContent("Fußbodenpunkt · Diele (Erdgeschoss) · x 100 cm, y 0 cm");
    expect(within(leiste()).getByRole("button", { name: "Fußboden" })).toHaveAttribute("aria-pressed", "true");

    // Rechtwinklig (Standard, F6): Ecke und Punkt als ein Schritt.
    klick(1500, 1500);
    expect(wegpunkte()).toHaveLength(4);
    expect(wegpunkte()[2]).toHaveTextContent("x 150 cm, y 0 cm");
    expect(wegpunkte()[3]).toHaveTextContent("x 150 cm, y 150 cm");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(wegpunkte()).toHaveLength(2);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    // Gerade: eine Strecke.
    fireEvent.click(within(leiste()).getByRole("button", { name: "Gerade" }));
    klick(2000, 2000);
    expect(wegpunkte()).toHaveLength(5);
    // Außerhalb jeder Raumkontur: Grund genannt, nichts gesetzt.
    klick(-2000, -2000);
    expect(screen.getByText(/Außerhalb eines Raums/)).toBeInTheDocument();
    expect(wegpunkte()).toHaveLength(5);
    // Fußboden → Decke ohne Wand dazwischen ist kein zulässiger Flächenwechsel.
    raumpunkt("Decke");
    klick(2500, 1500);
    expect(screen.getByText(/Nicht gesetzt|Nicht möglich/)).toBeInTheDocument();
    expect(wegpunkte()).toHaveLength(5);
    expect(wegpunkte()[1]).toHaveTextContent("Fußbodenpunkt");
    expect(document.querySelector("[data-testid='plan-entwurf-strecke'][data-flaeche='fussboden']")).not.toBeNull();
  });

  it("Raumwechsel ohne Übergang wird abgelehnt; Bodenübergang nur ausdrücklich an Tür oder Durchgang", async () => {
    await neueLeitung();
    bisZumFussboden();
    fireEvent.click(within(leiste()).getByRole("button", { name: "Gerade" }));
    klick(3000, 1500);
    expect(wegpunkte()).toHaveLength(3);
    // Direkt in die Küche: kein stiller Wechsel unter der Wand hindurch.
    klick(5500, 1500);
    expect(screen.getByText(/Nicht gesetzt/)).toBeInTheDocument();
    expect(wegpunkte()).toHaveLength(3);
    klick(0, 1500, document.querySelector("[data-oeffnung='f1']") as Element);
    expect(screen.getByText(/Kein Bodenübergang an einem Fenster/)).toBeInTheDocument();
    klick(4200, 760, document.querySelector("[data-oeffnung='t1']") as Element);
    expect(screen.getByText(/Bodenübergang als Wegpunkt 4 \(Türmitte\) – jetzt den Fußbodenpunkt im Nachbarraum setzen/)).toBeInTheDocument();
    expect(wegpunkte()[3]).toHaveTextContent("Bodenübergang · Wand 2 (0.01 Diele) · 75 cm ab Wandanfang");
    klick(5500, 1500);
    expect(wegpunkte()).toHaveLength(5);
    expect(wegpunkte()[4]).toHaveTextContent("Fußbodenpunkt · Küche (Erdgeschoss)");
    expect(within(entwurf()).queryByText(/Konflikt/)).toBeNull();
  });

  it("vom Fußboden an die Wand: Klick auf die Wandlinie setzt Übergang und Wandpunkt auf Fußbodenhöhe als einen Schritt", async () => {
    await neueLeitung();
    bisZumFussboden();
    fireEvent.click(within(leiste()).getByRole("button", { name: "Gerade" }));
    klick(2000, 1500);
    fireEvent.click(within(leiste()).getByRole("button", { name: "Rechtwinklig" }));
    klick(3000, 30);
    expect(wegpunkte()).toHaveLength(6);
    expect(wegpunkte()[4]).toHaveTextContent("Fußbodenpunkt · Diele (Erdgeschoss) · x 300 cm, y 0 cm");
    expect(wegpunkte()[5]).toHaveTextContent("Wandpunkt · Wand 1 (0.01 Diele) · 300 cm ab Wandanfang · 0 cm hoch");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(wegpunkte()).toHaveLength(3);
  });
});

describe("Schnelle Eingabe (Browserabnahme 6b.5)", () => {
  it("an der Raumecke entscheidet der Raum unter dem Zeiger - Ecke Diele.Süd/Ost ohne Ablehnung", async () => {
    await neueLeitung();
    hoehe("obere-zone");
    klick(4130, 30);
    expect(wegpunkte()[0]).toHaveTextContent("Wandpunkt · Wand 1 (0.01 Diele) · 420 cm ab Wandanfang · 220 cm hoch");
    klick(4170, 110);
    expect(wegpunkte()[1]).toHaveTextContent("Wandpunkt · Wand 2 (0.01 Diele) · 0 cm ab Wandanfang · 220 cm hoch");
    expect(within(entwurf()).queryByText(/Konflikt/)).toBeNull();
  });

  it("Drücken und Loslassen ohne Rendern dazwischen setzen genau den angezeigten Verlauf - kein veralteter Vorschaustand", async () => {
    await neueLeitung();
    bisZumFussboden();
    const flaeche = screen.getByRole("application", { name: /Grundriss/ });
    const o = { bubbles: true, cancelable: true, button: 0, ...bildpunkt(1500, 1500) };
    act(() => {
      flaeche.dispatchEvent(new MouseEvent("pointerdown", o));
      flaeche.dispatchEvent(new MouseEvent("pointerup", o));
    });
    expect(wegpunkte()).toHaveLength(4);
    expect(wegpunkte()[3]).toHaveTextContent("Fußbodenpunkt · Diele (Erdgeschoss) · x 150 cm, y 150 cm");
  });
});

describe("Gerät unter einer Leitung oder Wandlinie (Browserabnahme L2)", () => {
  it("Startgerät greift auch, wenn der Klick die darüberliegende Wandlinie trifft; beim Zeichnen bleibt die Wandlinie ein Wandpunkt", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    await eigenschaftenOeffnen();
    fireEvent.click(await screen.findByRole("button", { name: "Leitung hinzufügen" }));
    await screen.findByTestId("zeichenleiste");
    // UV1 liegt auf der Achse der Südwand - getroffen wird im Bild die Wandlinie, nicht das Symbol.
    const wand = screen.getByTestId("wand-diele-w0");
    klick(500, 0, wand);
    expect(within(leiste()).getByText(/2 Verlauf zeichnen/)).toHaveAttribute("aria-current", "step");
    hoehe("obere-zone");
    klick(1500, 30);
    expect(wegpunkte()).toHaveLength(1);
    // Beim Zeichnen gilt das Klickziel: die Wandlinie ist ein Wandpunkt, auch neben einem Gerät.
    klick(3000, 0, wand);
    expect(wegpunkte()).toHaveLength(2);
    expect(screen.queryByRole("dialog", { name: "Leitung abschließen" })).toBeNull();
  });
});

describe("Direkter Flächenwechsel beim Zeichnen (§21.5)", () => {
  it("Grundriss → Wand → Decke → Grundriss: derselbe Entwurf, gleiche Wegpunkte, Schritt und Rückgängig; nichts gespeichert, kein Punkt", async () => {
    await neueLeitung();
    hoehe("obere-zone");
    klick(1500, 30);
    expect(wegpunkte()).toHaveLength(1);
    const vorher = wegpunkte().map((li) => li.textContent);
    // Kontextbezogen an der Wand des letzten Punkts - ein Klick in die Fläche wechselt nie die Ansicht.
    fireEvent.click(within(leiste()).getByRole("button", { name: /^Zur Wand 1 .* wechseln$/ }));
    const wand = await screen.findByRole("region", { name: /Wandansicht · Wand 1/ });
    expect(within(leiste()).getByText(/2 Verlauf zeichnen \(1\)/)).toHaveAttribute("aria-current", "step");
    expect(within(wand).getByTestId("wegpunkt-0")).toBeInTheDocument();
    expect(within(wand).getByRole("button", { name: "Rückgängig" })).not.toHaveAttribute("aria-disabled");
    fireEvent.click(within(leiste()).getByRole("button", { name: /^Zur Decke von .* wechseln$/ }));
    await screen.findByRole("region", { name: /Deckenansicht/ });
    expect(within(leiste()).getByText(/2 Verlauf zeichnen \(1\)/)).toBeInTheDocument();
    fireEvent.click(within(leiste()).getByRole("button", { name: "Zum Grundriss wechseln" }));
    await screen.findByRole("application", { name: /Grundriss/ });
    expect(within(leiste()).getByText(/2 Verlauf zeichnen \(1\)/)).toBeInTheDocument();
    expect(wegpunkte().map((li) => li.textContent)).toEqual(vorher);
    expect(screen.getByRole("button", { name: "Rückgängig" })).not.toHaveAttribute("aria-disabled");
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    // Weiterzeichnen im Grundriss hängt an denselben Entwurf an.
    klick(2500, 30);
    expect(wegpunkte()).toHaveLength(2);
  });
});

describe("Ansicht verschieben während des Zeichnens (Browserabnahme L2)", () => {
  it("Verschieben behält den Entwurf; „Leitung hinzufügen“ führt zurück zum Zeichnen", async () => {
    await neueLeitung();
    hoehe("obere-zone");
    klick(1500, 30);
    expect(wegpunkte()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Verschieben" }));
    expect(screen.getByRole("button", { name: "Verschieben" })).toHaveAttribute("aria-pressed", "true");
    klick(2000, 30);
    expect(wegpunkte()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Leitung hinzufügen" }));
    expect(screen.getByRole("button", { name: "Verschieben" })).toHaveAttribute("aria-pressed", "false");
    expect(within(leiste()).getByText(/2 Verlauf zeichnen/)).toHaveAttribute("aria-current", "step");
    klick(2000, 30);
    expect(wegpunkte()).toHaveLength(2);
    // Ebenso über die Tasten H und L.
    fireEvent.keyDown(window, { key: "h" });
    expect(screen.getByRole("button", { name: "Verschieben" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "l" });
    expect(screen.getByRole("button", { name: "Verschieben" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Neue Durchführung", () => {
  async function mitDurchfuehrung() {
    await neueLeitung();
    hoehe("300");
    // Wandpunkt auf der Dielenseite der gemeinsamen Bauwand.
    klick(4170, 1500);
    expect(wegpunkte()).toHaveLength(1);
    fireEvent.click(within(zusatzleiste()).getByRole("button", { name: "Durchführung hier" }));
    // Nicht an einer Wand ohne Nachbarraum.
    klick(2000, 30);
    expect(screen.getByText(/Keine Durchführung: Hier grenzt kein zweiter Raum an/)).toBeInTheDocument();
    klick(4170, 1500);
    expect(wegpunkte()).toHaveLength(2);
    expect(wegpunkte()[1]).toHaveTextContent("neu, entsteht beim Speichern · Wand 2 (0.01 Diele) ↔ Wand 4 (0.02 Küche) · 30 cm hoch");
    expect(screen.getByTestId("plan-neue-durchfuehrung")).toHaveStyle({ pointerEvents: "none" });
    // Zurück zum Zeichnen; Gegenlage auf der Küchenseite über dieselbe Transformation: 3 000 − 1 500.
    fireEvent.click(within(zusatzleiste()).getByRole("button", { name: "Durchführung hier" }));
    klick(4230, 1500);
    expect(wegpunkte()).toHaveLength(3);
    expect(wegpunkte()[2]).toHaveTextContent("Wandpunkt · Wand 4 (0.02 Küche) · 150 cm ab Wandanfang · 30 cm hoch");
  }

  it("entsteht atomar mit der Leitung über new_penetrations", async () => {
    api.post.mockImplementation((_p: string, o: { body: Record<string, unknown> }) =>
      Promise.resolve(leitung({ id: "l9", version: 1, waypoints: [], end_device_id: "sd-kueche", segments: [], status: "confirmed", ...(o.body as object) })),
    );
    await mitDurchfuehrung();
    klick(4200, 2100, geraet("sd-kueche"));
    const dialog = await screen.findByRole("dialog", { name: "Leitung abschließen" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Leitung speichern" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Leitung speichern" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const body = (api.post.mock.calls[0] as [string, { body: { new_penetrations: { key: string }[]; waypoints: unknown[] } }])[1].body;
    const neuerSchluessel: unknown = expect.stringMatching(/^neu-[0-9a-f]{32}$/);
    expect(body.new_penetrations).toEqual([{ key: neuerSchluessel, wall_link_id: "kopplung-1", offset_mm: 1500, height_mm: 300 }]);
    const schluessel = body.new_penetrations[0]?.key;
    expect(body.waypoints).toEqual([
      { kind: "wall", wall_id: "diele-w1", offset_mm: 1500, height_mm: 300 },
      { kind: "penetration", new_penetration_key: schluessel },
      { kind: "wall", wall_id: "kueche-w3", offset_mm: 1500, height_mm: 300 },
    ]);
  });

  it("Abbrechen hinterlässt nichts auf dem Server; Rückgängig nimmt Wegpunkt und Durchführung zusammen", async () => {
    await mitDurchfuehrung();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(wegpunkte()).toHaveLength(1);
    expect(screen.queryByTestId("plan-neue-durchfuehrung")).toBeNull();
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByTestId("plan-neue-durchfuehrung")).toBeInTheDocument();

    fireEvent.click(within(leiste()).getByTestId("zeichnen-abbrechen"));
    const frage = await screen.findByRole("dialog", { name: "Leitungsentwurf schließen?" });
    fireEvent.click(within(frage).getByRole("button", { name: /verwerfen/i }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Leitungsentwurf" })).toBeNull());
    expect(screen.queryByTestId("plan-neue-durchfuehrung")).toBeNull();
    expect(screen.queryByTestId("zeichenleiste")).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});

describe("Steigweg über zwei Geschosse", () => {
  it("Einstieg, Vorschau, Übernehmen, Wechsel ins Zielgeschoss, Fortsetzen, Ziel und Speichern", async () => {
    api.post.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ id: "l9", version: 1, end_device_id: "sd-og", ...(o.body as object) })));
    await neueLeitung();
    bisZumFussboden();
    // Klick auf den Halt setzt ausdrücklich den Fußbodenpunkt am Halt und öffnet die Steigwegwahl.
    klick(1000, 2000, screen.getByTestId("plan-halt-h-eg").querySelector("rect") as Element);
    expect(wegpunkte()).toHaveLength(3);
    const wahl = screen.getByRole("group", { name: "Steigweg nutzen" });
    expect(within(wahl).getByText(/Einstieg: Erdgeschoss · 0 cm/)).toBeInTheDocument();
    expect(within(wahl).getByLabelText("Zielhalt")).toHaveValue("h-og");
    expect(within(wahl).getByTestId("steigweg-vorschau")).toHaveTextContent("Steigweg: 280 cm");
    fireEvent.click(within(wahl).getByRole("button", { name: "Steigweg übernehmen" }));
    expect(wegpunkte()[3]).toHaveTextContent("Steigweg · S1: Erdgeschoss (Einstieg 0 cm) → Obergeschoss (Ausstieg 0 cm)");

    // Ins Zielgeschoss: keine Rückfrage, Entwurf und Werkzeug bleiben - nichts gespeichert.
    fireEvent.click(within(wahl).getByRole("button", { name: "Weiter in „Obergeschoss“" }));
    await waitFor(() => expect(screen.getByLabelText("Geschoss")).toHaveValue("geschoss-2"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await screen.findByTestId("plan-halt-h-og");
    expect(within(leiste()).getByText(/2 Verlauf zeichnen \(4\)/)).toBeInTheDocument();
    expect(screen.getByTestId("plan-steigweg-fortsetzung")).toHaveTextContent("kommt aus Erdgeschoss (S1)");
    expect(wegpunkte()[0]).toHaveTextContent("Wandpunkt · Wand 1 (Diele (Erdgeschoss))");
    // Die Steighalte nennt die Hilfe der Zeichenleiste (statt eines Dauertextes unter der Fläche).
    fireEvent.click(within(leiste()).getByRole("button", { name: "Hilfe zum Zeichnen" }));
    const hilfe = await screen.findByRole("dialog", { name: "Leitung zeichnen – Bedienung" });
    expect(within(hilfe).getByTestId("grundriss-steighalte")).toHaveTextContent("Steighalte auf diesem Geschoss (Quadrat im Plan): S1");
    fireEvent.click(within(hilfe).getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Leitung zeichnen – Bedienung" })).toBeNull());

    klick(1000, 2000, screen.getByTestId("plan-halt-h-og").querySelector("rect") as Element);
    expect(wegpunkte()[4]).toHaveTextContent("Fußbodenpunkt · Flur (Obergeschoss) · x 100 cm, y 200 cm");
    // An die Wand: Übergang und Wandpunkt auf Fußbodenhöhe, dann das Ziel - der Dialog öffnet.
    fireEvent.click(within(leiste()).getByRole("button", { name: "Gerade" }));
    klick(2000, 30);
    expect(wegpunkte()).toHaveLength(7);
    klick(2000, 0, geraet("sd-og"));
    const dialog = await screen.findByRole("dialog", { name: "Leitung abschließen" });
    // 1 900 (UV1) + 2 000 + 2 800 (Steigweg) + 2 236 + 300 (Steckdose) = 9 236 mm Weg.
    await waitFor(() => expect(within(dialog).getByTestId("bedarf-teile")).toHaveTextContent("Weg 923,6 cm"));
    // Escape: zurück zum Zeichnen; Rückgängig nach dem Geschosswechsel nimmt den letzten Punkt - der Wechsel ist kein Schritt.
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(wegpunkte()).toHaveLength(5);
    expect(screen.getByLabelText("Geschoss")).toHaveValue("geschoss-2");
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(wegpunkte()).toHaveLength(7);
    klick(2000, 0, geraet("sd-og"));
    const wieder = await screen.findByRole("dialog", { name: "Leitung abschließen" });
    await waitFor(() => expect(within(wieder).getByRole("button", { name: "Leitung speichern" })).toBeEnabled());
    fireEvent.click(within(wieder).getByRole("button", { name: "Leitung speichern" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const body = (api.post.mock.calls[0] as [string, { body: { waypoints: unknown[]; end_device_id: string } }])[1].body;
    expect(body.end_device_id).toBe("sd-og");
    expect(body.waypoints).toEqual([
      { kind: "wall", wall_id: "diele-w0", offset_mm: 1000, height_mm: 0 },
      { kind: "floor", room_id: "diele", x_mm: 1000, y_mm: 0 },
      { kind: "floor", room_id: "diele", x_mm: 1000, y_mm: 2000 },
      { kind: "riser", riser_id: "s1", from_stop_id: "h-eg", from_height_mm: 0, to_stop_id: "h-og", to_height_mm: 0 },
      { kind: "floor", room_id: "flur", x_mm: 1000, y_mm: 2000 },
      { kind: "floor", room_id: "flur", x_mm: 2000, y_mm: 0 },
      { kind: "wall", wall_id: "flur-w0", offset_mm: 2000, height_mm: 0 },
    ]);
  });

  it("unbestätigte Geschosshöhe: übernehmbar, aber ausdrücklich unvollständig; widersprüchliche Höhe: abgelehnt", async () => {
    og = { ...og, elevation_confirmed: false };
    await neueLeitung();
    bisZumFussboden();
    klick(1000, 2000, screen.getByTestId("plan-halt-h-eg").querySelector("rect") as Element);
    const wahl = screen.getByRole("group", { name: "Steigweg nutzen" });
    expect(within(wahl).getByTestId("steigweg-vorschau")).toHaveTextContent("senkrechte Länge unbekannt");
    expect(within(wahl).getByTestId("steigweg-vorschau")).toHaveTextContent("unvollständig");
    expect(within(wahl).getByRole("button", { name: "Steigweg übernehmen" })).toBeEnabled();
    fireEvent.click(within(wahl).getByRole("button", { name: "Steigweg übernehmen" }));
    expect(within(entwurf()).getByTestId("leitungslaenge")).not.toHaveTextContent("Bestätigt");
  });

  it("widersprüchliche Geschosshöhen: Steigweg nicht übernehmbar", async () => {
    og = { ...og, elevation_mm: -100 };
    await neueLeitung();
    bisZumFussboden();
    klick(1000, 2000, screen.getByTestId("plan-halt-h-eg").querySelector("rect") as Element);
    const wahl = screen.getByRole("group", { name: "Steigweg nutzen" });
    expect(within(wahl).getByTestId("steigweg-vorschau")).toHaveTextContent("nicht möglich");
    expect(within(wahl).getByRole("button", { name: "Steigweg übernehmen" })).toBeDisabled();
  });
});

describe("Entwurfsschutz", () => {
  it("Gebäudewechsel mit ungespeichertem Entwurf fragt nach; Abbrechen behält alles", async () => {
    zweitesGebaeude = true;
    await neueLeitung();
    bisZumFussboden();
    fireEvent.change(screen.getByLabelText("Geschoss"), { target: { value: "geschoss-g" } });
    const frage = await screen.findByRole("dialog", { name: "Gebäude wechseln?" });
    expect(frage).toHaveTextContent(/ungespeicherten Leitungsentwurf/);
    fireEvent.click(within(frage).getByRole("button", { name: /behalten|abbrechen/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Gebäude wechseln?" })).toBeNull());
    expect(screen.getByLabelText("Geschoss")).toHaveValue("geschoss-1");
    expect(wegpunkte()).toHaveLength(2);
    expect(screen.getByTestId("zeichenleiste")).toBeInTheDocument();
  });
});
