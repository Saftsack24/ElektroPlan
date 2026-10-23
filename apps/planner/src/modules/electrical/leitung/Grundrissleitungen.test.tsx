import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";
import { GESCHOSS, KOPPLUNG, TYPEN, VERTEILUNG, leitung, stromkreis } from "./testdaten";
import { eigenschaftenOeffnen } from "../arbeitsflaeche/testhilfe";

/**
 * Leitung im Grundriss (Phase 6b.5) über den echten Editor - ersetzt werden nur
 * API, Route und Rechte.
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

const leiste = () => screen.getByRole("region", { name: "Leitung im Grundriss" });
const entwurf = () => screen.getByRole("region", { name: "Leitungsentwurf" });
const wegpunkte = () => within(entwurf()).queryAllByRole("listitem").filter((li) => li.closest("ol[aria-label='Wegpunkte']") !== null);
const ebene = (name: "Fußboden" | "Wand" | "Decke") => fireEvent.click(within(leiste()).getByRole("button", { name }));
const hoehe = (wert: string) => fireEvent.change(within(leiste()).getByLabelText(/Höhe/), { target: { value: wert } });

async function neueLeitung() {
  zeigen();
  await screen.findByRole("application", { name: /Grundriss/ });
  // Die Leitungsliste steht im Eigenschaftenpanel (6c.0).
  await eigenschaftenOeffnen();
  const feld = await screen.findByTestId("grundriss-leitungen");
  fireEvent.click(await within(feld).findByRole("button", { name: "Neue Leitung" }));
  await screen.findByRole("region", { name: "Leitung im Grundriss" });
}

/** UV1 → Wandpunkt Diele Süd bei 1 000 auf Höhe 0 → Fußboden auf der Achse darunter. */
function bisZumFussboden() {
  ebene("Wand");
  hoehe("0");
  klick(1000, 30);
  ebene("Fußboden");
  klick(1000, 40);
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  og = { ...GESCHOSS, id: "geschoss-2", name: "Obergeschoss", level: 1, elevation_mm: 2800 };
  zweitesGebaeude = false;
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  api.get.mockImplementation((pfad: string, o?: { path?: Record<string, string> }) => {
    const floor = o?.path?.floor_id;
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
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

describe("Ebenenwahl und Fußboden", () => {
  it("Fußbodenpunkte nur in der Kontur; die Ebenenwahl wandelt vorhandene Punkte nie um", async () => {
    await neueLeitung();
    expect(within(leiste()).getByRole("button", { name: "Leitung" })).toHaveAttribute("aria-pressed", "true");
    expect(within(leiste()).getByRole("button", { name: "Fußboden" })).toHaveAttribute("aria-pressed", "true");

    bisZumFussboden();
    expect(wegpunkte()).toHaveLength(2);
    expect(wegpunkte()[0]).toHaveTextContent("Wandpunkt · Wand 1 (0.01 Diele) · 100 cm ab Wandanfang · 0 cm hoch");
    // Auf die Wandachse gefangen: genau der Übergang Wand ↔ Fußboden.
    expect(wegpunkte()[1]).toHaveTextContent("Fußbodenpunkt · Diele (Erdgeschoss) · x 100 cm, y 0 cm");
    expect(screen.getByText(/eingerastet: Wandachse/)).toBeInTheDocument();
    // Die Marke des Wandpunkts liegt über der Achse - im Werkzeug lässt sie Klicks durch (Browserabnahme).
    expect(screen.getByTestId("plan-wegpunkt-0")).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByTestId("plan-wegpunkt-1")).not.toHaveStyle({ pointerEvents: "none" });
    // Auf der Ebene Wand ist auch der Fußbodenpunkt auf der Achse nicht greifbar - der Klick setzt den Wandpunkt.
    ebene("Wand");
    expect(screen.getByTestId("plan-wegpunkt-1")).toHaveStyle({ pointerEvents: "none" });
    ebene("Fußboden");

    klick(1500, 1500);
    expect(wegpunkte()).toHaveLength(3);
    // Außerhalb jeder Raumkontur: Grund genannt, nichts gesetzt.
    klick(-2000, -2000);
    expect(screen.getByText(/Außerhalb eines Raums/)).toBeInTheDocument();
    expect(wegpunkte()).toHaveLength(3);

    // Ebene Decke: neue Punkte werden Deckenpunkte, die vorhandenen bleiben, was sie sind.
    ebene("Decke");
    expect(wegpunkte()[1]).toHaveTextContent("Fußbodenpunkt");
    expect(wegpunkte()[0]).toHaveTextContent("Wandpunkt");
    // Fußboden → Decke ohne Wand dazwischen ist kein zulässiger Flächenwechsel.
    klick(2000, 1500);
    expect(screen.getByText(/Nicht gesetzt|Nicht möglich/)).toBeInTheDocument();
    expect(wegpunkte()).toHaveLength(3);
    // Zeichnung: Fußbodenweg grob gestrichelt als eigene Fläche.
    expect(document.querySelector("[data-testid='plan-entwurf-strecke'][data-flaeche='fussboden']")).not.toBeNull();
  });

  it("Raumwechsel ohne Übergang wird abgelehnt; Bodenübergang nur ausdrücklich an Tür oder Durchgang", async () => {
    await neueLeitung();
    bisZumFussboden();
    klick(3000, 1500);
    // Direkt in die Küche: kein stiller Wechsel unter der Wand hindurch.
    klick(5500, 1500);
    expect(screen.getByText(/Nicht gesetzt/)).toBeInTheDocument();
    expect(wegpunkte()).toHaveLength(3);

    // Fenster: kein Bodenübergang.
    klick(0, 1500, document.querySelector("[data-oeffnung='f1']") as Element);
    expect(screen.getByText(/Kein Bodenübergang an einem Fenster/)).toBeInTheDocument();

    // Tür: Klick nahe der Mitte rastet auf die Türmitte ein; als letzter Punkt fehlt die Gegenseite noch.
    klick(4200, 760, document.querySelector("[data-oeffnung='t1']") as Element);
    expect(screen.getByText(/Bodenübergang als Wegpunkt 4 \(Türmitte\) – jetzt den Fußbodenpunkt im Nachbarraum setzen/)).toBeInTheDocument();
    expect(wegpunkte()[3]).toHaveTextContent("Bodenübergang · Wand 2 (0.01 Diele) · 75 cm ab Wandanfang");
    klick(5500, 1500);
    expect(wegpunkte()).toHaveLength(5);
    expect(wegpunkte()[4]).toHaveTextContent("Fußbodenpunkt · Küche (Erdgeschoss)");
    // Der Weg selbst hat keinen Konflikt - es fehlt nur das Endgerät.
    expect(within(entwurf()).queryByText(/Konflikt/)).toBeNull();
  });
});

describe("Schnelle Eingabe (Browserabnahme 6b.5)", () => {
  it("an der Raumecke entscheidet der Raum unter dem Zeiger - Ecke Diele.Süd/Ost ohne Ablehnung", async () => {
    await neueLeitung();
    ebene("Wand");
    hoehe("obere-zone");
    klick(4130, 30);
    expect(wegpunkte()[0]).toHaveTextContent("Wandpunkt · Wand 1 (0.01 Diele) · 420 cm ab Wandanfang · 220 cm hoch");
    klick(4170, 110);
    expect(wegpunkte()[1]).toHaveTextContent("Wandpunkt · Wand 2 (0.01 Diele) · 0 cm ab Wandanfang · 220 cm hoch");
    // Über die Ecke: Länge 0, kein Konflikt.
    expect(within(entwurf()).queryByText(/Konflikt/)).toBeNull();
  });

  it("Drücken und Loslassen ohne Rendern dazwischen setzen den Punkt trotzdem - kein veralteter Vorschaustand", async () => {
    await neueLeitung();
    bisZumFussboden();
    const flaeche = screen.getByRole("application", { name: /Grundriss/ });
    const o = { bubbles: true, cancelable: true, button: 0, ...bildpunkt(1500, 1500) };
    act(() => {
      flaeche.dispatchEvent(new MouseEvent("pointerdown", o));
      flaeche.dispatchEvent(new MouseEvent("pointerup", o));
    });
    expect(wegpunkte()).toHaveLength(3);
    expect(wegpunkte()[2]).toHaveTextContent("Fußbodenpunkt · Diele (Erdgeschoss) · x 150 cm, y 150 cm");
  });
});

describe("Neue Durchführung", () => {
  async function mitDurchfuehrung() {
    await neueLeitung();
    ebene("Wand");
    hoehe("300");
    // Wandpunkt auf der Dielenseite der gemeinsamen Bauwand.
    klick(4170, 1500);
    expect(wegpunkte()).toHaveLength(1);
    fireEvent.click(within(leiste()).getByRole("button", { name: "Durchführung hier" }));
    // Nicht an einer Wand ohne Nachbarraum.
    klick(2000, 30);
    expect(screen.getByText(/Keine Durchführung: Hier grenzt kein zweiter Raum an/)).toBeInTheDocument();
    klick(4170, 1500);
    expect(wegpunkte()).toHaveLength(2);
    expect(wegpunkte()[1]).toHaveTextContent("neu, entsteht beim Speichern · Wand 2 (0.01 Diele) ↔ Wand 4 (0.02 Küche) · 30 cm hoch");
    // Nur Anzeige: Die Marke liegt auf der Achse und darf den Klick auf die Gegenseite nicht abfangen.
    expect(screen.getByTestId("plan-neue-durchfuehrung")).toHaveStyle({ pointerEvents: "none" });
    // Gegenlage auf der Küchenseite über dieselbe Transformation: 3 000 − 1 500.
    fireEvent.click(within(leiste()).getByRole("button", { name: "Leitung" }));
    klick(4230, 1500);
    expect(wegpunkte()).toHaveLength(3);
    expect(wegpunkte()[2]).toHaveTextContent("Wandpunkt · Wand 4 (0.02 Küche) · 150 cm ab Wandanfang · 30 cm hoch");
  }

  it("entsteht atomar mit der Leitung über new_penetrations", async () => {
    api.post.mockImplementation((_p: string, o: { body: Record<string, unknown> }) =>
      Promise.resolve(leitung({ id: "l9", version: 1, waypoints: [], end_device_id: "sd-kueche", segments: [], status: "confirmed", ...(o.body as object) })),
    );
    await mitDurchfuehrung();
    fireEvent.change(within(entwurf()).getByLabelText("Endgerät"), { target: { value: "sd-kueche" } });
    fireEvent.click(within(entwurf()).getByRole("button", { name: "Leitung speichern" }));
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

  it("Verwerfen hinterlässt nichts auf dem Server; Rückgängig nimmt Wegpunkt und Durchführung zusammen", async () => {
    await mitDurchfuehrung();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(wegpunkte()).toHaveLength(1);
    expect(screen.queryByTestId("plan-neue-durchfuehrung")).toBeNull();
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByTestId("plan-neue-durchfuehrung")).toBeInTheDocument();

    fireEvent.click(within(entwurf()).getByRole("button", { name: "Entwurf schließen" }));
    const frage = await screen.findByRole("dialog", { name: "Leitungsentwurf schließen?" });
    fireEvent.click(within(frage).getByRole("button", { name: /verwerfen/i }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Leitungsentwurf" })).toBeNull());
    expect(screen.queryByTestId("plan-neue-durchfuehrung")).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});

describe("Steigweg über zwei Geschosse", () => {
  it("Einstieg, Vorschau, Übernehmen, Wechsel ins Zielgeschoss, Fortsetzen und Speichern", async () => {
    api.post.mockImplementation(() => Promise.resolve(leitung({ id: "l9", version: 1, end_device_id: "sd-og" })));
    await neueLeitung();
    bisZumFussboden();
    // Klick auf den Halt setzt ausdrücklich den Fußbodenpunkt am Halt und öffnet die Steigwegwahl.
    klick(1000, 2000, screen.getByTestId("plan-halt-h-eg").querySelector("rect") as Element);
    expect(wegpunkte()).toHaveLength(3);
    const wahl = screen.getByRole("group", { name: "Steigweg nutzen" });
    expect(within(wahl).getByText(/Einstieg: Erdgeschoss · 0 cm/)).toBeInTheDocument();
    expect(within(wahl).getByLabelText("Zielhalt")).toHaveValue("h-og");
    expect(within(wahl).getByTestId("steigweg-vorschau")).toHaveTextContent("Steigweg: 280 cm");
    expect(within(wahl).getByText("Verlauf gültig")).toBeInTheDocument();
    fireEvent.click(within(wahl).getByRole("button", { name: "Steigweg übernehmen" }));
    expect(wegpunkte()[3]).toHaveTextContent("Steigweg · S1: Erdgeschoss (Einstieg 0 cm) → Obergeschoss (Ausstieg 0 cm)");

    // Ins Zielgeschoss: keine Rückfrage, der Entwurf bleibt - nichts gespeichert, nichts verworfen.
    fireEvent.click(within(wahl).getByRole("button", { name: "Weiter in „Obergeschoss“" }));
    await waitFor(() => expect(screen.getByLabelText("Geschoss")).toHaveValue("geschoss-2"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await screen.findByTestId("plan-halt-h-og");
    expect(wegpunkte()).toHaveLength(4);
    expect(screen.getByTestId("plan-steigweg-fortsetzung")).toHaveTextContent("kommt aus Erdgeschoss (S1)");
    // Wegpunkte des anderen Geschosses bleiben eindeutig benannt - Raum mit Geschoss.
    expect(wegpunkte()[0]).toHaveTextContent("Wandpunkt · Wand 1 (Diele (Erdgeschoss))");

    klick(1000, 2000, screen.getByTestId("plan-halt-h-og").querySelector("rect") as Element);
    expect(wegpunkte()[4]).toHaveTextContent("Fußbodenpunkt · Flur (Obergeschoss) · x 100 cm, y 200 cm");

    // Kleiner Maßstab: nur Pfeil im Plan, kein Haltname - die volle Angabe bleibt erreichbar
    // (Titel, gewählter Wegpunkt, Wegpunktliste, Seitenfeld). Nachkorrektur 6b.5.
    // Verkleinern, bis der Maßstab unter 120 px/m liegt.
    for (let i = 0; i < 4 && Number(/Maßstab (\d+)/.exec(screen.getByText(/Maßstab/).textContent ?? "")?.[1]) >= 120; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Verkleinern" }));
    }
    expect(Number(/Maßstab (\d+)/.exec(screen.getByText(/Maßstab/).textContent ?? "")?.[1])).toBeLessThan(120);
    const fortsetzung = screen.getByTestId("plan-steigweg-fortsetzung");
    expect(fortsetzung.textContent?.endsWith("↓")).toBe(true);
    expect(fortsetzung).toHaveAttribute("data-volltext", "kommt aus Erdgeschoss (S1)");
    expect(fortsetzung.querySelector("title")).toHaveTextContent("kommt aus Erdgeschoss (S1)");
    expect(screen.queryByTestId("plan-halt-name")).toBeNull();
    expect(screen.getByTestId("grundriss-steighalte")).toHaveTextContent("Steighalte auf diesem Geschoss (Quadrat im Plan): S1");
    fireEvent.click(within(entwurf()).getByRole("button", { name: /^Steigweg · S1/ }));
    expect(screen.getByTestId("plan-steigweg-fortsetzung").textContent).toContain("kommt aus Erdgeschoss (S1)");
    fireEvent.click(within(entwurf()).getByRole("button", { name: /^Fußbodenpunkt · Flur \(Obergeschoss\) · x 100 cm, y 200 cm/ }));
    fireEvent.click(screen.getByRole("button", { name: "Vergrößern" }));
    klick(2000, 40);
    ebene("Wand");
    klick(2000, 30);
    fireEvent.change(within(entwurf()).getByLabelText("Endgerät"), { target: { value: "sd-og" } });
    // 1 900 (UV1) + 2 000 + 2 800 (Steigweg) + 2 236 + 300 (Steckdose) = 9 236 mm.
    expect(within(entwurf()).getByTestId("leitungslaenge")).toHaveTextContent("Bestätigt");
    expect(within(entwurf()).getByTestId("leitungslaenge")).toHaveTextContent("923,6 cm");

    // Rückgängig nach dem Geschosswechsel nimmt den letzten Punkt - der Wechsel selbst ist kein Schritt.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(within(entwurf()).getByLabelText("Endgerät")).toHaveValue("");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(wegpunkte()).toHaveLength(6);
    expect(screen.getByLabelText("Geschoss")).toHaveValue("geschoss-2");
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(wegpunkte()).toHaveLength(7);

    fireEvent.click(within(entwurf()).getByRole("button", { name: "Leitung speichern" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const body = (api.post.mock.calls[0] as [string, { body: { waypoints: unknown[] } }])[1].body;
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
    // Im Entwurf: Teilsumme statt Länge, mit Text - nie still als Länge gezählt.
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
  });
});
