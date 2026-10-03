import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { raum, rechteck } from "../ansicht3d/testplan";

/**
 * Wand- und Deckenansicht über den echten Editor (Phase 4f). Ersetzt werden
 * nur API und Route.
 *
 * „0.01 Wohnzimmer“ 0…5000 × 0…4000 und „0.02 Flur“ 5000…7000 × 0…4000, beide
 * gegen den Uhrzeigersinn. Wand 2 des Wohnzimmers (`raum-1-w1`, x = 5000) ist
 * gemeinsam. Aus dem Wohnzimmer blickt man nach rechts (Osten): links ist
 * Norden, die Wand ist 4000 mm breit, der Raum 2500 mm hoch.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };

vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: () => true,
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");
const { GrundrissEditor } = await import("../editor/GrundrissEditor");

const WOHNZIMMER = rechteck("raum-1", "Wohnzimmer", [0, 0], [5000, 4000], { nummer: "0.01" });
const FLUR = rechteck("raum-2", "Flur", [5000, 0], [7000, 4000], { nummer: "0.02", hoehe: 2600 });
let plan: { floor_id: string; project_id: string; rooms: unknown[] };
let projektstatus = "active";

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

// ------------------------------------------------------------ Grundriss

function grundrissBild(x: number, y: number) {
  const g = document.querySelector("svg.grundriss__svg g[transform]");
  const m = (g?.getAttribute("transform") ?? "").match(/matrix\(([^)]+)\)/)?.[1]?.split(" ").map(Number) ?? [];
  const [a = 0, , , d = 0, e = 0, f = 0] = m;
  return { clientX: e + x * a, clientY: f + y * d };
}

function grundrissKlick(ziel: Element, x: number, y: number) {
  for (const typ of ["pointerdown", "pointerup", "click"]) {
    fireEvent(ziel, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, ...grundrissBild(x, y) }));
  }
}

/** Raum aktivieren, Wand im Grundriss wählen, Wandansicht öffnen. */
async function wandansichtOeffnen(raumKnopf = /0.01 Wohnzimmer/, wandId = "raum-1-w1", x = 5000, y = 2000) {
  zeigen();
  await screen.findByRole("application", { name: /Grundriss/ });
  fireEvent.click(await screen.findByRole("button", { name: raumKnopf }));
  grundrissKlick(await screen.findByTestId(`wand-${wandId}`), x, y);
  fireEvent.click(await screen.findByRole("button", { name: /^Wand (bearbeiten|ansehen)$/ }));
  return screen.findByRole("dialog", { name: /Wandansicht/ });
}

// ------------------------------------------------------------ Wandansicht

const ansicht = () => document.querySelector<SVGSVGElement>("svg.ansicht__svg")!;

/** Ansichtskoordinaten (mm von links, mm über Boden) → Bildschirm. */
function bild(u: number, h: number, L = 4000, H = 2500) {
  const wand = screen.getByTestId("wandflaeche");
  const x = Number(wand.getAttribute("x"));
  const y = Number(wand.getAttribute("y"));
  const b = Number(wand.getAttribute("width"));
  const hoehe = Number(wand.getAttribute("height"));
  return { clientX: x + (u * b) / L, clientY: y + hoehe - (h * hoehe) / H };
}

function zeiger(ziel: Element, typ: string, u: number, h: number, extra: MouseEventInit = {}) {
  fireEvent(ziel, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, ...bild(u, h), ...extra }));
}

/** In jsdom bleibt der Hintergrund eines Dialogs zugänglich - deshalb immer im Dialog suchen. */
const dlg = () => screen.getByRole("dialog", { name: /Wandansicht/ });
const feld = (name: RegExp) => within(dlg()).getByRole<HTMLInputElement>("textbox", { name });
const klasse = (e: Element) => e.getAttribute("class") ?? "";

async function tuerSetzen(u = 2000) {
  fireEvent.click(within(dlg()).getByRole("button", { name: "Tür" }));
  zeiger(ansicht(), "pointermove", u, 1000);
  expect(screen.getByTestId("wand-vorschau")).toHaveAttribute("data-gueltig", "ja");
  zeiger(ansicht(), "pointerdown", u, 1000);
  zeiger(ansicht(), "pointerup", u, 1000);
  await screen.findByText(/Tür gesetzt/);
}

const oeffnungInAnsicht = () => document.querySelector<SVGRectElement>("svg.ansicht__svg [data-oeffnung]:not([data-griff])")!;

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  projektstatus = "active";
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  plan = { floor_id: "geschoss-1", project_id: "projekt-1", rooms: [WOHNZIMMER, FLUR] };
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: projektstatus, version: 2 });
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

describe("Einstieg und Blickrichtung", () => {
  it("öffnet aus dem Grundriss mit Wand, Raum, Blickrichtung, Nachbarraum und Maßen", async () => {
    const dialog = await wandansichtOeffnen();
    expect(within(dialog).getByRole("heading", { name: "Wandansicht · Wand 2 · 0.01 Wohnzimmer" })).toBeInTheDocument();
    expect(within(dialog).getByTestId("wandseite")).toHaveTextContent("Innenseite – 0.01 Wohnzimmer");
    expect(within(dialog).getByText("Blick aus Raum „0.01 Wohnzimmer“ · im Grundriss nach rechts")).toBeInTheDocument();
    expect(within(dialog).getByText("400 cm breit · Raumhöhe 250 cm · Stärke 11,5 cm")).toBeInTheDocument();
    // Links schließt Wand 3 (Nord) an - wer nach Osten blickt, hat Norden links.
    expect(within(dialog).getByText("◂ links · Wand 3")).toBeInTheDocument();
    expect(within(dialog).getByText(/grenzt an „0.02 Flur“ \(Decke 260 cm – abweichend\)/)).toBeInTheDocument();
    expect(within(dialog).getByText("Decke 0.02 Flur: 260 cm (abweichend)")).toBeInTheDocument();
  });

  it("Wandansicht ohne geschlossene Kontur ist gesperrt und erklärt warum", async () => {
    plan = { ...plan, rooms: [raum("raum-1", "Wohnzimmer", [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], { nummer: "0.01", offen: true })] };
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    grundrissKlick(await screen.findByTestId("wand-raum-1-w1"), 5000, 2000);
    expect(await screen.findByRole("button", { name: "Wand bearbeiten" })).toBeDisabled();
    expect(screen.getByText("Die Wandansicht braucht eine geschlossene Raumkontur.")).toBeInTheDocument();
  });
});

describe("Öffnungen setzen, verschieben, Größe ändern", () => {
  it("Tür per Klick: Mitte rastet auf die Wandmitte, Hilfslinien nennen die Abstände", async () => {
    await wandansichtOeffnen();
    await tuerSetzen(2010);
    // Mitte auf der Wandmitte (2000): links = 2000 − 442,5 → 1558 (ganze mm).
    expect(feld(/^Abstand von links/)).toHaveValue("155,8");
    expect(feld(/^Abstand von rechts/)).toHaveValue("155,7");
    expect(feld(/^Breite/)).toHaveValue("88,5");
    expect(screen.getByTestId("mass-links")).toHaveAccessibleName("Abstand von links: 155,8 cm");
    expect(screen.getByTestId("mass-decke")).toHaveAccessibleName("Abstand zur Decke: 49 cm");
    expect(within(dlg()).getByText(/Verbindet „0.01 Wohnzimmer“ und „0.02 Flur“/)).toBeInTheDocument();
  });

  it("ungültige Vorschau über der Wandkante wird gezeigt und setzt nichts", async () => {
    await wandansichtOeffnen();
    fireEvent.click(within(dlg()).getByRole("button", { name: "Fenster" }));
    // Fenster 101 cm breit, Mitte 30 cm vom linken Rand: ragt hinaus, auch ohne Fang.
    zeiger(ansicht(), "pointermove", 300, 1000, { altKey: true });
    expect(screen.getByTestId("wand-vorschau")).toHaveAttribute("data-gueltig", "nein");
    expect(screen.getByTestId("wand-statuszeile")).toHaveTextContent(/Nicht möglich: Die Öffnung muss vollständig in der Wand/);
    zeiger(ansicht(), "pointerdown", 300, 1000, { altKey: true });
    zeiger(ansicht(), "pointerup", 300, 1000, { altKey: true });
    expect(oeffnungInAnsicht()).toBeNull();
  });

  it("Ziehen ist ein einziger Rückgängig-Schritt; Alt setzt das Einrasten aus", async () => {
    await wandansichtOeffnen();
    await tuerSetzen(2010);
    const o = oeffnungInAnsicht();
    zeiger(o, "pointerdown", 2000, 1000);
    for (let u = 2010; u <= 2333; u += 17) zeiger(ansicht(), "pointermove", u, 1000, { altKey: true });
    zeiger(ansicht(), "pointerup", 2333, 1000, { altKey: true });
    const nachher = feld(/^Abstand von links/).value;
    expect(nachher).not.toBe("155,8");
    // Ohne Fang millimetergenau - nicht auf das 10-cm-Raster.
    expect(Number(nachher.replace(",", ".")) * 10 % 100).not.toBe(0);
    fireEvent.click(within(dlg()).getByRole("button", { name: "Rückgängig" }));
    expect(feld(/^Abstand von links/)).toHaveValue("155,8");
    fireEvent.click(within(dlg()).getByRole("button", { name: "Wiederholen" }));
    expect(feld(/^Abstand von links/)).toHaveValue(nachher);
  });

  it("Escape während des Ziehens bricht ab, statt den Dialog zu schließen", async () => {
    const dialog = await wandansichtOeffnen();
    await tuerSetzen(2010);
    zeiger(oeffnungInAnsicht(), "pointerdown", 2000, 1000);
    zeiger(ansicht(), "pointermove", 3000, 1000);
    expect(feld(/^Abstand von links/)).not.toHaveValue("155,8");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog", { name: /Wandansicht/ })).toBeInTheDocument();
    expect(feld(/^Abstand von links/)).toHaveValue("155,8");
    expect(screen.getByTestId("wand-statuszeile")).toHaveTextContent("Bewegung abgebrochen");
    // Spätere Bewegungen ändern nichts mehr.
    zeiger(ansicht(), "pointermove", 3500, 1000);
    expect(feld(/^Abstand von links/)).toHaveValue("155,8");
  });

  it("pointercancel bricht ab und setzt zurück", async () => {
    await wandansichtOeffnen();
    await tuerSetzen(2010);
    zeiger(oeffnungInAnsicht(), "pointerdown", 2000, 1000);
    zeiger(ansicht(), "pointermove", 3000, 1000);
    zeiger(ansicht(), "pointercancel", 3000, 1000);
    expect(feld(/^Abstand von links/)).toHaveValue("155,8");
  });

  it("Griff rechts ändert die Breite, die linke Kante bleibt", async () => {
    await wandansichtOeffnen();
    await tuerSetzen(2010);
    zeiger(screen.getByTestId("griff-rechts"), "pointerdown", 2443, 1000);
    zeiger(ansicht(), "pointermove", 2643, 1000, { altKey: true });
    zeiger(ansicht(), "pointerup", 2643, 1000, { altKey: true });
    expect(feld(/^Abstand von links/)).toHaveValue("155,8");
    expect(feld(/^Breite/)).toHaveValue("108,5");
  });

  it("Tür hat keinen Brüstungsgriff; Fenster schon - mit Standardbrüstung", async () => {
    await wandansichtOeffnen();
    await tuerSetzen(1000);
    expect(screen.queryByTestId("griff-unten")).toBeNull();
    // Eine 201 cm hohe Tür wird mit 90 cm Brüstung kein Fenster in 250 cm Raumhöhe: abgelehnt, nichts geändert.
    fireEvent.change(within(dlg()).getByLabelText("Art"), { target: { value: "window" } });
    expect(screen.getByTestId("wand-statuszeile")).toHaveTextContent("Art nicht geändert: Die Oberkante (291 cm) läge über der Decke (250 cm).");
    fireEvent.click(within(dlg()).getByRole("button", { name: "Fenster" }));
    zeiger(ansicht(), "pointermove", 3000, 1000);
    zeiger(ansicht(), "pointerdown", 3000, 1000);
    zeiger(ansicht(), "pointerup", 3000, 1000);
    expect(feld(/^Brüstung über Boden/)).toHaveValue("90");
    expect(screen.getByTestId("griff-unten")).toBeInTheDocument();
  });
});

describe("exakte Eingabe", () => {
  it("cm, m und mm - übernommen wie eingegeben, kein Raster", async () => {
    await wandansichtOeffnen();
    await tuerSetzen(2010);
    fireEvent.change(feld(/^Abstand von links/), { target: { value: "123,4" } });
    fireEvent.blur(feld(/^Abstand von links/));
    expect(feld(/^Abstand von links/)).toHaveValue("123,4");
    fireEvent.change(feld(/^Abstand von rechts/), { target: { value: "1,2 m" } });
    fireEvent.keyDown(feld(/^Abstand von rechts/), { key: "Enter" });
    expect(feld(/^Abstand von rechts/)).toHaveValue("120");
    expect(feld(/^Abstand von links/)).toHaveValue("191,5");
    act(() => masseinheitSetzen("m"));
    expect(feld(/^Abstand von links \(m\)/)).toHaveValue("1,915");
    act(() => masseinheitSetzen("mm"));
    expect(feld(/^Abstand von links \(mm\)/)).toHaveValue("1915");
  });

  it("unzulässiger Wert ändert nichts und nennt den Grund", async () => {
    await wandansichtOeffnen();
    await tuerSetzen(2010);
    fireEvent.change(feld(/^Höhe/), { target: { value: "260" } });
    fireEvent.blur(feld(/^Höhe/));
    expect(await screen.findByText("Die Oberkante (260 cm) läge über der Decke (250 cm).")).toBeInTheDocument();
    expect(feld(/^Höhe/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("mass-hoehe")).toHaveAccessibleName("Höhe: 201 cm");
  });
});

describe("gemeinsamer Entwurf, Speichern und Verwerfen", () => {
  it("Schließen behält den Entwurf; Grundriss zeigt die Tür und kann sie rückgängig machen", async () => {
    await wandansichtOeffnen();
    await tuerSetzen(2010);
    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(screen.queryByRole("dialog", { name: /Wandansicht/ })).toBeNull();
    expect(screen.getByText(/0.01 Wohnzimmer: Ungespeicherte Änderungen|Wohnzimmer: Ungespeicherte Änderungen/)).toBeInTheDocument();
    expect(screen.getByText(/noch nicht gespeichert/)).toBeInTheDocument();
    expect(document.querySelectorAll("svg.grundriss__svg [data-oeffnung]")).toHaveLength(1);
    // Die neue Tür ist auch im Grundriss ausgewählt - dieselbe Auswahl, derselbe Entwurf.
    expect(screen.getByText(/Tür in Wand 2/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
    // Rückgängig im Grundriss nimmt die in der Wandansicht gesetzte Tür zurück.
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(document.querySelectorAll("svg.grundriss__svg [data-oeffnung]")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(document.querySelectorAll("svg.grundriss__svg [data-oeffnung]")).toHaveLength(1);
  });

  it("Speichern nutzt den Konturweg mit der Raumversion; gespeichert wird der Abstand ab Wandanfang", async () => {
    api.put.mockImplementation((_pfad: string, optionen: { body: object }) => Promise.resolve({ ...WOHNZIMMER, version: 2, ...optionen.body }));
    await wandansichtOeffnen();
    await tuerSetzen(2010);
    fireEvent.click(within(dlg()).getByRole("button", { name: "Speichern" }));
    expect(await within(dlg()).findByText("Wohnzimmer: Gespeichert")).toBeInTheDocument();
    expect(api.put).toHaveBeenCalledTimes(1);
    const [pfad, optionen] = api.put.mock.calls[0] as [string, { ifMatch: number; body: { walls: { id: string; openings: { offset_mm: number }[] }[] } }];
    expect(pfad).toBe("/api/v1/modules/electrical/rooms/{room_id}/contour");
    expect(optionen.ifMatch).toBe(1);
    const tuer = optionen.body.walls.find((w) => w.id === "raum-1-w1")?.openings[0];
    // Ansicht 1558 von links ↔ gespeichert 4000 − 1558 − 885 = 1557 ab (5000,0).
    expect(tuer?.offset_mm).toBe(1557);
  });

  it("Verwerfen fragt nach und setzt Wandansicht und Grundriss gemeinsam zurück", async () => {
    await wandansichtOeffnen();
    await tuerSetzen(2010);
    fireEvent.click(within(dlg()).getByRole("button", { name: "Änderungen verwerfen" }));
    const frage = await screen.findByRole("dialog", { name: "Änderungen verwerfen?" });
    fireEvent.click(within(frage).getByRole("button", { name: "Änderungen verwerfen" }));
    await waitFor(() => expect(oeffnungInAnsicht() === null).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(document.querySelectorAll("svg.grundriss__svg [data-oeffnung]")).toHaveLength(0);
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe("gemeinsame Öffnung aus beiden Räumen", () => {
  const MIT_TUER = rechteck("raum-1", "Wohnzimmer", [0, 0], [5000, 4000], {
    nummer: "0.01",
    oeffnungen: { 1: [{ id: "tuer-1", offset: 1000, breite: 885, hoehe: 2010 }] },
  });

  it("aus dem Flur gespiegelt und abgeleitet - Bearbeiten führt zur Quelle", async () => {
    plan = { ...plan, rooms: [MIT_TUER, FLUR] };
    await wandansichtOeffnen(/0.02 Flur/, "raum-2-w3", 5000, 3500);
    expect(within(dlg()).getByText("Blick aus Raum „0.02 Flur“ · im Grundriss nach links")).toBeInTheDocument();
    const o = screen.getByTestId("ansicht-oeffnung-tuer-1");
    expect(klasse(o)).toContain("ansicht__oeffnung--abgeleitet");
    expect(document.querySelectorAll("svg.ansicht__svg [data-oeffnung]")).toHaveLength(1);
    zeiger(o, "pointerdown", 1400, 1000);
    zeiger(ansicht(), "pointerup", 1400, 1000);
    // Blick nach Westen: Süden links - die Tür (y 1000…1885) beginnt 100 cm von links.
    expect(within(dlg()).getByText(/Tür 1 · 100 cm von links · gespeichert in „0.01 Wohnzimmer“/)).toBeInTheDocument();
    expect(within(dlg()).queryByRole("textbox", { name: /^Abstand von links/ })).toBeNull();
    fireEvent.click(within(dlg()).getByRole("button", { name: "In „0.01 Wohnzimmer“ bearbeiten" }));
    expect(await screen.findByRole("heading", { name: "Wandansicht · Wand 2 · 0.01 Wohnzimmer" })).toBeInTheDocument();
    // Dieselbe Tür, jetzt aus dem Wohnzimmer: 4000 − 1000 − 885 = 2115 von links.
    expect(feld(/^Abstand von links/)).toHaveValue("211,5");
  });

  it("mit ungespeicherten Änderungen fragt der Wechsel zur Quelle nach - der Entwurf bleibt", async () => {
    plan = { ...plan, rooms: [MIT_TUER, FLUR] };
    await wandansichtOeffnen(/0.02 Flur/, "raum-2-w3", 5000, 3500);
    // Im Flur etwas ändern: eine Tür auf dem nicht verdeckten Wandstück.
    await tuerSetzen(3200);
    zeiger(screen.getByTestId("ansicht-oeffnung-tuer-1"), "pointerdown", 1400, 1000);
    zeiger(ansicht(), "pointerup", 1400, 1000);
    fireEvent.click(within(dlg()).getByRole("button", { name: "In „0.01 Wohnzimmer“ bearbeiten" }));
    const frage = await screen.findByRole("dialog", { name: "Raum wechseln?" });
    fireEvent.click(within(frage).getByRole("button", { name: "Beim Raum bleiben" }));
    expect(await screen.findByRole("heading", { name: "Wandansicht · Wand 4 · 0.02 Flur" })).toBeInTheDocument();
    expect(document.querySelectorAll("svg.ansicht__svg [data-oeffnung]:not([data-griff])")).toHaveLength(2);
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe("Lesemodus", () => {
  it("abgeschlossenes Projekt: ansehen und zoomen, aber keine Werkzeuge und keine Felder", async () => {
    projektstatus = "completed";
    plan = {
      ...plan,
      rooms: [rechteck("raum-1", "Wohnzimmer", [0, 0], [5000, 4000], { nummer: "0.01", oeffnungen: { 1: [{ id: "tuer-1", offset: 1000, breite: 885, hoehe: 2010 }] } }), FLUR],
    };
    const dialog = await wandansichtOeffnen();
    expect(within(dialog).getByText("Nur Ansicht")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Tür" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Speichern" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Vergrößern" })).toBeEnabled();
    zeiger(screen.getByTestId("ansicht-oeffnung-tuer-1"), "pointerdown", 2500, 1000);
    zeiger(ansicht(), "pointerup", 2500, 1000);
    expect(feld(/^Abstand von links/)).toBeDisabled();
    expect(screen.queryByTestId("griff-rechts")).toBeNull();
  });
});

describe("Deckenansicht", () => {
  it("Rechteck: Raummaß, Deckenhöhe, Wandnummern", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Wohnzimmer/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Deckenansicht" }));
    const dialog = await screen.findByRole("dialog", { name: "Deckenansicht · 0.01 Wohnzimmer" });
    expect(within(dialog).getByText("Raummaß 500 cm × 400 cm")).toBeInTheDocument();
    expect(within(dialog).getByText(/Deckenhöhe 250 cm/)).toBeInTheDocument();
    expect(within(dialog).getByTestId("decke-wand-1")).toHaveTextContent("W1 · 500 cm");
  });

  it("L-förmiger Raum: kein irreführendes Rechteckmaß, nur Wandlängen", async () => {
    plan = {
      ...plan,
      rooms: [raum("raum-1", "Flur L", [[0, 0], [4000, 0], [4000, 1500], [1500, 1500], [1500, 4000], [0, 4000]], { nummer: "0.01" })],
    };
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    fireEvent.click(await screen.findByRole("button", { name: /0.01 Flur L/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Deckenansicht" }));
    const dialog = await screen.findByRole("dialog", { name: "Deckenansicht · 0.01 Flur L" });
    expect(within(dialog).queryByText(/Raummaß/)).toBeNull();
    expect(within(dialog).getByText("Kein Rechteck - Maße stehen an den einzelnen Wänden.")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/^Wand \d: /)).toHaveLength(6);
  });
});

describe("Einstieg aus der 3D-Ansicht", () => {
  it("der Editor öffnet nach dem Laden genau die gewählte Raumwand - mit voller Länge", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const verbraucht = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <RueckfrageProvider>
          <GrundrissEditor
            floorId="geschoss-1"
            geschossLabel="Hauptgebäude · Erdgeschoss"
            standardhoehe_mm={2500}
            darfSchreiben
            onUngespeichert={() => undefined}
            onGespeichert={() => Promise.resolve()}
            startWandansicht={{ raumId: "raum-2", wandId: "raum-2-w3" }}
            onStartVerbraucht={verbraucht}
          />
        </RueckfrageProvider>
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Wandansicht · Wand 4 · 0.02 Flur" });
    expect(within(dialog).getByText(/^400 cm breit/)).toBeInTheDocument();
    expect(verbraucht).toHaveBeenCalledTimes(1);
  });
});

describe("Innen- und Außenseite einer Außenwand (Phase 4f)", () => {
  // Wohnzimmer-Südwand (0,0)→(5000,0), nicht geteilt, mit Fenster bei 500…1510 ab Wandanfang.
  const MIT_FENSTER = rechteck("raum-1", "Wohnzimmer", [0, 0], [5000, 4000], {
    nummer: "0.01",
    oeffnungen: { 0: [{ id: "fenster-1", art: "window", offset: 500, breite: 1010, hoehe: 1260, bruestung: 900 }] },
  });

  it("Seitenwechsel: Bezeichnung, Blickrichtung und links/rechts kehren sich um - die Öffnung bleibt gespeichert", async () => {
    plan = { ...plan, rooms: [MIT_FENSTER, FLUR] };
    await wandansichtOeffnen(/0.01 Wohnzimmer/, "raum-1-w0", 2500, 0);
    const innen = dlg();
    expect(within(innen).getByTestId("wandseite")).toHaveTextContent("Innenseite – 0.01 Wohnzimmer");
    expect(within(innen).getByText("Blick aus Raum „0.01 Wohnzimmer“ · im Grundriss nach unten")).toBeInTheDocument();
    // Blick nach Süden: links ist Osten - Fenster 5000 − 500 − 1010 = 3490 von links.
    expect(within(innen).getByText(/Fenster 1 · 349 cm von links/)).toBeInTheDocument();

    fireEvent.click(within(innen).getByRole("button", { name: "Außenseite ansehen" }));
    const aussen = screen.getByRole("dialog", { name: "Wandansicht · Wand 1 · 0.01 Wohnzimmer · Außenseite" });
    expect(within(aussen).getByTestId("wandseite")).toHaveTextContent("Außenseite – Fassade");
    expect(within(aussen).getByText(/Blick von außen auf die Wand · im Grundriss nach oben/)).toBeInTheDocument();
    // Von außen nach Norden blickend ist Westen links - dasselbe Fenster 50 cm von links.
    expect(within(aussen).getByText(/Fenster 1 · 50 cm von links/)).toBeInTheDocument();
    expect(document.querySelectorAll("svg.ansicht__svg [data-oeffnung]:not([data-griff])")).toHaveLength(1);
    // Nichts verändert: kein Entwurf, nichts zu speichern.
    expect(within(aussen).getByText("Wohnzimmer: Keine ungespeicherten Änderungen")).toBeInTheDocument();

    fireEvent.click(within(aussen).getByRole("button", { name: "Innenseite ansehen" }));
    expect(within(dlg()).getByText(/Fenster 1 · 349 cm von links/)).toBeInTheDocument();
  });

  it("Bearbeitung von außen wirkt auf dieselbe Öffnung: von außen 10 cm nach rechts = innen 10 cm nach links", async () => {
    api.put.mockImplementation((_pfad: string, optionen: { body: object }) => Promise.resolve({ ...MIT_FENSTER, version: 2, ...optionen.body }));
    plan = { ...plan, rooms: [MIT_FENSTER, FLUR] };
    await wandansichtOeffnen(/0.01 Wohnzimmer/, "raum-1-w0", 2500, 0);
    fireEvent.click(within(dlg()).getByRole("button", { name: "Außenseite ansehen" }));
    fireEvent.click(within(dlg()).getByRole("button", { name: /^Fenster 1 · 50 cm von links/ }));
    fireEvent.change(feld(/^Abstand von links/), { target: { value: "60" } });
    fireEvent.blur(feld(/^Abstand von links/));
    fireEvent.click(within(dlg()).getByRole("button", { name: "Innenseite ansehen" }));
    expect(within(dlg()).getByText(/Fenster 1 · 339 cm von links/)).toBeInTheDocument();
    fireEvent.click(within(dlg()).getByRole("button", { name: "Speichern" }));
    await within(dlg()).findByText("Wohnzimmer: Gespeichert");
    const [, optionen] = api.put.mock.calls[0] as [string, { body: { walls: { id: string; openings: { id: string; offset_mm: number }[] }[] } }];
    const alle = optionen.body.walls.flatMap((w) => w.openings);
    expect(alle).toEqual([expect.objectContaining({ id: "fenster-1", offset_mm: 600 })]);
  });
});

describe("Schließen führt zur Ausgangsansicht zurück (Phase 4f)", () => {
  function editor(start: { raumId: string; wandId: string; herkunft?: "2d" | "3d" } | null, onZurueck3d = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <RueckfrageProvider>
          <GrundrissEditor
            floorId="geschoss-1"
            geschossLabel="Hauptgebäude · Erdgeschoss"
            standardhoehe_mm={2500}
            darfSchreiben
            onUngespeichert={() => undefined}
            onGespeichert={() => Promise.resolve()}
            startWandansicht={start}
            onStartVerbraucht={() => undefined}
            onZurueck3d={onZurueck3d}
          />
        </RueckfrageProvider>
      </QueryClientProvider>,
    );
    return onZurueck3d;
  }

  it("aus 3D geöffnet: Schließen meldet die Rückkehr - der Entwurf bleibt, nichts wird gespeichert", async () => {
    const zurueck = editor({ raumId: "raum-1", wandId: "raum-1-w1", herkunft: "3d" });
    await screen.findByRole("dialog", { name: /Wandansicht/ });
    await tuerSetzen(2010);
    // Seitenwechsel innerhalb der Wandansicht ändert die Herkunft nicht.
    fireEvent.click(within(dlg()).getByRole("button", { name: "Außenseite ansehen" }));
    fireEvent.click(within(dlg()).getByRole("button", { name: "Dialog schließen" }));
    expect(zurueck).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("svg.grundriss__svg [data-oeffnung]")).toHaveLength(1);
    expect(api.put).not.toHaveBeenCalled();
  });

  it("aus 2D geöffnet: Schließen bleibt im Grundriss", async () => {
    const zurueck = editor({ raumId: "raum-1", wandId: "raum-1-w1" });
    await screen.findByRole("dialog", { name: /Wandansicht/ });
    fireEvent.click(within(dlg()).getByRole("button", { name: "Dialog schließen" }));
    expect(zurueck).not.toHaveBeenCalled();
    expect(screen.getByRole("application", { name: /Grundriss/ })).toBeInTheDocument();
  });
});
