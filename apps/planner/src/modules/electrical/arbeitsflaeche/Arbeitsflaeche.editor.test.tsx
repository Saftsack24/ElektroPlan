import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RAUM } from "../editor/testdaten";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { eigenschaftenOeffnen, raumInListe } from "./testhilfe";

/**
 * Planungsarbeitsfläche im echten Grundrisseditor (Phase 6c.0) – Integration.
 *
 * Geprüft wird, dass Ein-/Ausklappen und Maximieren die laufende Bearbeitung
 * nicht berühren: dieselbe Zeichenfläche (kein Neueinhängen), dieselbe
 * Viewport-Transformation (kein Neueinpassen), Auswahl, Werkzeug, Raumentwurf und
 * Undo-Verlauf. jsdom misst keine Größen – die Geometrie beim tatsächlichen
 * Größenwechsel ist im Browser geprüft (Entwurf 6c §17).
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };

vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: () => true,
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const PROJEKT = { id: "projekt-1", status: "active", version: 2 };
const GESCHOSSE = [
  { id: "geschoss-1", building_id: "gebaeude-1", name: "Erdgeschoss", default_ceiling_height_mm: 2500 },
  { id: "geschoss-2", building_id: "gebaeude-1", name: "Obergeschoss", default_ceiling_height_mm: 2400 },
];

function problem(status: number, typ: string) {
  return new ApiError(
    status,
    { type: `https://elektroplan.internal/errors/${typ}`, title: "Fehler", status, detail: "Serverdetail" },
    null,
  );
}

function zeigen(streng = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const baum = (
    <QueryClientProvider client={client}>
      <RueckfrageProvider>
        <RoomsTab />
      </RueckfrageProvider>
    </QueryClientProvider>
  );
  // Wie `main.tsx`: Im StrictMode laufen Effekte beim Einhängen doppelt.
  render(streng ? <StrictMode>{baum}</StrictMode> : baum);
}

function flaeche(): SVGSVGElement {
  return document.querySelector("svg.grundriss__svg") as SVGSVGElement;
}
function transformation(): string | null {
  return document.querySelector("svg.grundriss__svg g[transform]")?.getAttribute("transform") ?? null;
}
function bild(x: number, y: number) {
  const m = (transformation() ?? "").match(/matrix\(([^)]+)\)/)?.[1]?.split(" ").map(Number) ?? [];
  const [a = 0, , , d = 0, e = 0, f = 0] = m;
  return { clientX: e + x * a, clientY: f + y * d };
}
function zeiger(ziel: Element, typ: string, x: number, y: number) {
  fireEvent(ziel, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, ...bild(x, y) }));
}
const arbeitsflaeche = () => screen.getByRole("region", { name: "Grundriss-Arbeitsfläche" });
const eigenschaftenKnopf = () => within(arbeitsflaeche()).getByRole("button", { name: "Eigenschaften" });

/** Raum wählen und eine Ecke ziehen: ein ungespeicherter Raumentwurf mit Undo-Schritt. */
async function raumentwurf() {
  zeigen();
  await screen.findByRole("application", { name: /Grundriss/ });
  fireEvent.click(await raumInListe(/0.01 Wohnzimmer/));
  zeiger(await screen.findByTestId("ecke-5000,4000"), "pointerdown", 5000, 4000);
  zeiger(flaeche(), "pointermove", 6000, 4000);
  zeiger(flaeche(), "pointerup", 6000, 4000);
  expect(await screen.findByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  api.get.mockImplementation((pfad: string, optionen?: { path?: Record<string, string> }) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve(PROJEKT);
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve(GESCHOSSE);
    if (pfad.endsWith("/plan")) {
      const id = optionen?.path?.floor_id ?? "geschoss-1";
      return Promise.resolve({ floor_id: id, project_id: "projekt-1", rooms: id === "geschoss-1" ? [RAUM] : [] });
    }
    return Promise.resolve([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Planungsarbeitsfläche im Grundriss", () => {
  it("startet mit eingeklappten Eigenschaften; die Zeichenfläche steht im Seitenfluss", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "false");
    expect(within(arbeitsflaeche()).getByTestId("eigenschaftenpanel")).toHaveAttribute("aria-hidden", "true");
    expect(arbeitsflaeche()).not.toHaveAttribute("data-maximiert");
    // L1: keine einzelne überbreite Editorkarte mehr - die ganze Seite nutzt die Breite (Arbeitsbereich).
    expect(document.querySelector(".ep-arbeitsflaeche-breit")).toBeNull();
  });

  it("Ein-/Ausklappen und Maximieren behalten Zeichenfläche, Viewport, Auswahl, Werkzeug, Entwurf und Undo", async () => {
    await raumentwurf();
    const svg = flaeche();
    const vorher = transformation();
    expect(screen.getAllByText("600 cm").length).toBeGreaterThan(0);
    // Werkzeug wechseln (P) - es muss den Layoutwechsel überstehen.
    fireEvent.keyDown(window, { key: "p" });
    expect(screen.getByRole("button", { name: "Polygonraum" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(eigenschaftenKnopf()); // zu
    fireEvent.keyDown(window, { key: "m" }); // maximieren
    expect(arbeitsflaeche()).toHaveAttribute("data-maximiert");
    fireEvent.keyDown(window, { key: "e" }); // auf
    fireEvent.keyDown(window, { key: "e" }); // zu
    fireEvent.click(within(arbeitsflaeche()).getByRole("button", { name: "Normale Ansicht" }));
    expect(arbeitsflaeche()).not.toHaveAttribute("data-maximiert");

    expect(flaeche()).toBe(svg);
    expect(transformation()).toBe(vorher);
    expect(screen.getByRole("button", { name: "Polygonraum" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
    expect(screen.getAllByText("600 cm").length).toBeGreaterThan(0);
    // Auswahl: der aktive Raum bleibt gewählt.
    await eigenschaftenOeffnen();
    expect(screen.getByRole("heading", { name: "0.01 Wohnzimmer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raumdaten" })).toBeInTheDocument();

    // Der Undo-Verlauf ist unverändert: ein Schritt zurück, einer vor.
    const rueckgaengig = within(arbeitsflaeche()).getByRole("button", { name: "Rückgängig" });
    expect(rueckgaengig).not.toHaveAttribute("aria-disabled");
    fireEvent.click(rueckgaengig);
    await waitFor(() => expect(screen.queryAllByText("600 cm")).toHaveLength(0));
    fireEvent.click(within(arbeitsflaeche()).getByRole("button", { name: "Wiederholen" }));
    expect((await screen.findAllByText("600 cm")).length).toBeGreaterThan(0);
  });

  it("Undo/Redo ohne Entwurf: erkennbar gesperrt, mit Grund im Hinweis", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    const rueckgaengig = within(arbeitsflaeche()).getByRole("button", { name: "Rückgängig" });
    expect(rueckgaengig).toHaveAttribute("aria-disabled", "true");
    expect(rueckgaengig).toHaveAccessibleDescription("Rückgängig (Strg+Z) – nichts rückgängig zu machen");
    expect(rueckgaengig).toHaveAttribute("aria-keyshortcuts", "Control+Z");
  });

  it("Escape: erst Werkzeug und Auswahl, zuletzt die Maximierung", async () => {
    await raumentwurf();
    fireEvent.keyDown(window, { key: "m" });
    expect(arbeitsflaeche()).toHaveAttribute("data-maximiert");
    fireEvent.keyDown(window, { key: "Escape" }); // Auswahl aufheben
    expect(arbeitsflaeche()).toHaveAttribute("data-maximiert");
    fireEvent.keyDown(window, { key: "Escape" }); // jetzt die Maximierung
    expect(arbeitsflaeche()).not.toHaveAttribute("data-maximiert");
    // Der Entwurf bleibt - Escape verwirft nichts.
    expect(screen.getByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
  });

  it("Kürzel stören keine offene Rückfrage", async () => {
    await raumentwurf();
    fireEvent.click(screen.getByRole("button", { name: "Änderungen verwerfen" }));
    const frage = await screen.findByRole("dialog");
    fireEvent.keyDown(within(frage).getAllByRole("button")[0] as HTMLElement, { key: "m" });
    fireEvent.keyDown(window, { key: "m" });
    expect(arbeitsflaeche()).not.toHaveAttribute("data-maximiert");
  });

  it("Speicherfehler und Konflikt bleiben bei eingeklapptem Panel an der Aktion sichtbar", async () => {
    api.put.mockRejectedValue(problem(409, "version-conflict"));
    await raumentwurf();
    // Panel schließen (raumInListe hatte es geöffnet).
    fireEvent.click(eigenschaftenKnopf());
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    const meldung = await screen.findByRole("alert");
    expect(meldung).toHaveTextContent(/zwischenzeitlich an anderer Stelle geändert/);
    expect(within(meldung).getByRole("button", { name: /Serverstand laden/ })).toBeInTheDocument();
    expect(within(meldung).getByRole("button", { name: "Entwurf vorerst behalten" })).toBeInTheDocument();
    // Die Meldung liegt nicht im (verborgenen) Panel.
    expect(within(arbeitsflaeche()).getByTestId("eigenschaftenpanel").contains(meldung)).toBe(false);
  });

  it("Panel und Maximierung überstehen einen Geschosswechsel", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    fireEvent.click(eigenschaftenKnopf());
    fireEvent.keyDown(window, { key: "m" });
    fireEvent.change(screen.getByLabelText("Geschoss"), { target: { value: "geschoss-2" } });
    await waitFor(() => expect(screen.getByLabelText("Geschoss")).toHaveValue("geschoss-2"));
    await screen.findByRole("application", { name: /Grundriss/ });
    expect(arbeitsflaeche()).toHaveAttribute("data-maximiert");
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("Wand und Decke in derselben Arbeitsfläche (L1)", () => {
  /** Mit dem Werkzeug Tür (T) eine Wand anklicken – ihre Wandfläche öffnet sich an Ort und Stelle. */
  async function wandOeffnen() {
    fireEvent.keyDown(window, { key: "t" });
    const wand = await screen.findByTestId("wand-w1");
    zeiger(wand, "pointerdown", 1500, 20);
    zeiger(flaeche(), "pointerup", 1500, 20);
    zeiger(wand, "click", 1500, 20);
    return screen.findByRole("region", { name: /Wandansicht · Wand 1/ });
  }

  it("Hauptwerkzeuge oben gruppiert; Seltenes im Menü „Ansicht“; „Leitung hinzufügen“ ohne Vorauswahl", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    const leiste = screen.getByRole("toolbar", { name: "Werkzeuge des Grundrisseditors" });
    for (const gruppe of ["Auswahl", "Raum", "Öffnung", "Gerät", "Leitung", "Verlauf", "Zoom"]) {
      expect(within(leiste).getByRole("group", { name: gruppe })).toBeInTheDocument();
    }
    for (const knopf of ["Auswählen", "Verschieben", "Rechteckraum", "Polygonraum", "Tür", "Fenster", "Durchgang", "Gerät", "Leitung hinzufügen", "Rückgängig", "Wiederholen", "Vergrößern", "Verkleinern", "Ansicht zurücksetzen"]) {
      expect(within(leiste).getByRole("button", { name: knopf })).toBeInTheDocument();
    }
    // Fang, Raster und Hilfe stehen nicht mehr dauerhaft in der Leiste.
    expect(within(leiste).queryByRole("checkbox", { name: "Fang" })).toBeNull();
    expect(within(leiste).queryByRole("combobox")).toBeNull();
    fireEvent.click(within(leiste).getByRole("button", { name: "Ansicht und Hilfe" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Bedienung, Tastenkürzel und Legende …" }));
    expect(await screen.findByRole("dialog", { name: "Grundriss – Bedienung und Tastenkürzel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    // L1-Zwischenstand: „Leitung hinzufügen“ öffnet den bestehenden Einstieg im Panel.
    fireEvent.click(within(leiste).getByRole("button", { name: "Leitung hinzufügen" }));
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "true");
  });

  it("Pfad und Rückweg; der Grundriss ist während der Wand ausgehängt; Entwurf, Undo und Grundriss-Ausschnitt bleiben", async () => {
    await raumentwurf();
    const vorher = transformation();
    const wand = await wandOeffnen();
    // Keine modale Oberfläche: kein Dialog, Fokus in der Fläche, Pfad sichtbar.
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(wand));
    const pfad = within(wand).getByRole("navigation", { name: "Pfad" });
    expect(pfad).toHaveTextContent("Grundriss");
    expect(pfad).toHaveTextContent("Wand 1");
    // Der Grundriss ist nicht nur versteckt, sondern ausgehängt: keine zweite Zeichenfläche, keine Tasten.
    expect(screen.queryByRole("region", { name: "Grundriss-Arbeitsfläche" })).toBeNull();
    expect(document.querySelector("svg.grundriss__svg")).toBeNull();
    expect(within(wand).getByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();

    fireEvent.click(within(wand).getByRole("button", { name: "Zurück zum Grundriss" }));
    expect(await screen.findByRole("region", { name: "Grundriss-Arbeitsfläche" })).toBeInTheDocument();
    // Kein Einpassen beim Zurückkehren: dieselbe Transformation wie vorher.
    expect(transformation()).toBe(vorher);
    expect(screen.getByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
    const rueckgaengig = within(arbeitsflaeche()).getByRole("button", { name: "Rückgängig" });
    expect(rueckgaengig).not.toHaveAttribute("aria-disabled");
    fireEvent.click(rueckgaengig);
    await waitFor(() => expect(screen.queryAllByText("600 cm")).toHaveLength(0));
  });

  it("Escape: erst das Werkzeug, dann zurück; ein offenes Menü schließt Escape allein", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    const wand = await wandOeffnen();
    expect(within(wand).getByRole("button", { name: "Tür" })).toHaveAttribute("aria-pressed", "true");
    // Menü offen: Escape schließt nur das Menü – Werkzeug und Fläche bleiben.
    fireEvent.click(within(wand).getByRole("button", { name: "Ansicht und Hilfe" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(within(wand).getByRole("button", { name: "Tür" })).toHaveAttribute("aria-pressed", "true");
    const svg = wand.querySelector("svg.ansicht__svg") as Element;
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(within(wand).getByRole("button", { name: "Auswählen" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: /Wandansicht · Wand 1/ })).toBe(wand);
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(await screen.findByRole("region", { name: "Grundriss-Arbeitsfläche" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Wandansicht/ })).toBeNull();
  });

  it("Panel und Maximierung gelten für die ganze Arbeitsfläche – auch in der Wand", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    fireEvent.keyDown(window, { key: "m" });
    const wand = await wandOeffnen();
    const flaecheWand = within(wand).getByRole("region", { name: "Arbeitsfläche Wand" });
    expect(flaecheWand).toHaveAttribute("data-maximiert");
    // Erst wenn die Fläche den Fokus hat, sind ihre Effekte (auch der Tastenhandler) gelaufen.
    await waitFor(() => expect(document.activeElement).toBe(wand));
    // M wirkt in der Wand (Fokus dort), nicht doppelt über den ausgehängten Grundriss.
    fireEvent.keyDown(wand, { key: "m" });
    expect(flaecheWand).not.toHaveAttribute("data-maximiert");
    fireEvent.click(within(wand).getByRole("button", { name: "Zurück zum Grundriss" }));
    expect(await screen.findByRole("region", { name: "Grundriss-Arbeitsfläche" })).not.toHaveAttribute("data-maximiert");
  });
});

describe("Decke und Wechsel der Sitzung (L1)", () => {
  it("Decke: Pfad, Fokus, Rückweg ohne Einpassen; Grundriss-Werkzeuge sind währenddessen nicht erreichbar", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    fireEvent.click(await raumInListe(/0.01 Wohnzimmer/));
    const vorher = transformation();
    fireEvent.click(await screen.findByRole("button", { name: "Deckenansicht" }));
    const decke = await screen.findByRole("region", { name: "Deckenansicht · 0.01 Wohnzimmer" });
    await waitFor(() => expect(document.activeElement).toBe(decke));
    expect(within(decke).getByRole("navigation", { name: "Pfad" })).toHaveTextContent(/Grundriss.*0\.01 Wohnzimmer.*Decke/);
    expect(screen.queryByRole("toolbar", { name: "Werkzeuge des Grundrisseditors" })).toBeNull();
    // Grundriss-Kürzel greifen nicht in die Decke durch.
    fireEvent.keyDown(window, { key: "r" });
    expect(screen.queryByRole("button", { name: "Rechteckraum" })).toBeNull();
    fireEvent.click(within(decke).getByRole("button", { name: "Zurück zum Grundriss" }));
    expect(await screen.findByRole("region", { name: "Grundriss-Arbeitsfläche" })).toBeInTheDocument();
    expect(transformation()).toBe(vorher);
    expect(within(arbeitsflaeche()).getByRole("button", { name: "Auswählen" })).toHaveAttribute("aria-pressed", "true");
  });

  it("nach einem Benutzer- oder Betriebswechsel (neuer Baum, neuer Cache) taucht keine alte Fläche und kein Entwurf auf", async () => {
    await raumentwurf();
    await wandOeffnenNachRaum();
    cleanup();
    zeigen();
    expect(await screen.findByRole("region", { name: "Grundriss-Arbeitsfläche" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Wandansicht/ })).toBeNull();
    expect(screen.queryByText(/Ungespeicherte Änderungen/)).toBeNull();
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "false");
  });

  async function wandOeffnenNachRaum() {
    fireEvent.keyDown(window, { key: "t" });
    const wand = await screen.findByTestId("wand-w1");
    zeiger(wand, "pointerdown", 1500, 20);
    zeiger(flaeche(), "pointerup", 1500, 20);
    zeiger(wand, "click", 1500, 20);
    await screen.findByRole("region", { name: /Wandansicht · Wand 1/ });
  }
});

describe("Ausschnitt je Wand (L1)", () => {
  /** Fingerabdruck des Ausschnitts: Lage des ersten gezeichneten Elements der offenen Fläche. */
  function wandbild(): string {
    const svg = [...document.querySelectorAll("[data-flaeche] svg")].find((e) => !e.classList.contains("lucide"));
    const r = svg?.querySelector("rect, polygon, path, line");
    return ["x", "y", "width", "height", "points", "d", "x1", "y1"].map((a) => r?.getAttribute(a) ?? "").join(",");
  }
  async function wandOeffnen() {
    fireEvent.keyDown(window, { key: "t" });
    const wand = await screen.findByTestId("wand-w1");
    zeiger(wand, "pointerdown", 1500, 20);
    zeiger(flaeche(), "pointerup", 1500, 20);
    zeiger(wand, "click", 1500, 20);
    const region = await screen.findByRole("region", { name: /Wandansicht · Wand 1/ });
    // Bedienen erst, wenn die Fläche eingehängt und gemessen ist (ihre Effekte liefen: Fokus).
    await waitFor(() => expect(document.activeElement).toBe(region));
    return region;
  }

  for (const streng of [false, true]) {
    it(`dieselbe Wand kommt mit ihrem Ausschnitt zurück${streng ? " (StrictMode)" : ""}`, async () => {
      zeigen(streng);
      await screen.findByRole("application", { name: /Grundriss/ });
      let wand = await wandOeffnen();
      const eingepasst = wandbild();
      fireEvent.click(within(wand).getByRole("button", { name: "Vergrößern" }));
      const gezoomt = wandbild();
      expect(gezoomt).not.toBe(eingepasst);
      fireEvent.click(within(wand).getByRole("button", { name: /Zurück zum Grundriss/ }));
      await screen.findByRole("region", { name: "Grundriss-Arbeitsfläche" });
      wand = await wandOeffnen();
      // Die Fläche misst nach dem Einhängen und übernimmt dann den gemerkten Ausschnitt.
      await waitFor(() => expect(wandbild()).toBe(gezoomt), { timeout: 4000 });
    });
  }

  for (const streng of [false, true]) {
    it(`dieselbe Decke kommt mit ihrem Ausschnitt zurück${streng ? " (StrictMode)" : ""}`, async () => {
      zeigen(streng);
      await screen.findByRole("application", { name: /Grundriss/ });
      fireEvent.click(await raumInListe(/0.01 Wohnzimmer/));
      fireEvent.click(await screen.findByRole("button", { name: "Deckenansicht" }));
      let decke = await screen.findByRole("region", { name: /Deckenansicht/ });
      await waitFor(() => expect(document.activeElement).toBe(decke));
      const eingepasst = wandbild();
      fireEvent.click(within(decke).getByRole("button", { name: "Vergrößern" }));
      const gezoomt = wandbild();
      expect(gezoomt).not.toBe(eingepasst);
      fireEvent.click(within(decke).getByRole("button", { name: /Zurück zum Grundriss/ }));
      await screen.findByRole("region", { name: "Grundriss-Arbeitsfläche" });
      fireEvent.click(await screen.findByRole("button", { name: "Deckenansicht" }));
      decke = await screen.findByRole("region", { name: /Deckenansicht/ });
      await waitFor(() => expect(document.activeElement).toBe(decke));
      await waitFor(() => expect(wandbild()).toBe(gezoomt), { timeout: 4000 });
    });
  }
});

describe("Schmale Darstellung (L1, unter 60 rem)", () => {
  beforeEach(() => {
    // Wie ein Fenster unter 60 rem: `(min-width: 60rem)` trifft nicht zu.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Werkzeuge als Symbolknöpfe mit Namen und Hinweis; Raum und Öffnung als Menü; „Leitung“ bleibt mit Text oben", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    const leiste = screen.getByRole("toolbar", { name: "Werkzeuge des Grundrisseditors" });
    // Symbolknopf: zugänglicher Name, Kürzel, Hinweis bei Zeigen/Fokus (role=tooltip) – kein sichtbarer Text.
    const auswaehlen = within(leiste).getByRole("button", { name: "Auswählen" });
    expect(auswaehlen).toHaveAttribute("aria-pressed", "true");
    expect(auswaehlen).toHaveAttribute("aria-keyshortcuts", "V");
    expect(auswaehlen).toHaveAccessibleDescription("Auswählen (V)");
    expect(auswaehlen.textContent).toBe("");
    // Raum und Öffnung: je ein Menü statt zwei bzw. drei Knöpfen.
    expect(within(leiste).queryByRole("button", { name: "Rechteckraum" })).toBeNull();
    expect(within(leiste).queryByRole("button", { name: "Tür" })).toBeNull();
    const raum = within(leiste).getByRole("button", { name: "Raum zeichnen" });
    expect(raum).toHaveAccessibleDescription("Raum zeichnen");
    fireEvent.click(raum);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Rechteckraum/ }));
    // Das gewählte Werkzeug nennt der Menüknopf im Namen (Menüknopf, kein Umschalter).
    expect(within(leiste).getByRole("button", { name: "Raum zeichnen: Rechteckraum" })).toBeInTheDocument();
    // Kürzel wirken weiter – auch für Werkzeuge im Menü.
    fireEvent.keyDown(window, { key: "t" });
    expect(within(leiste).getByRole("button", { name: "Öffnung setzen: Tür" })).toBeInTheDocument();
    expect(within(leiste).getByRole("button", { name: "Raum zeichnen" })).toBeInTheDocument();
    // „Leitung hinzufügen“: oben, Symbol und kurzer sichtbarer Text, voller Name.
    const leitung = within(leiste).getByRole("button", { name: "Leitung hinzufügen" });
    expect(leitung).toHaveTextContent("Leitung");
    // Seltenes und die Arbeitsfläche: nur Symbol, Name bleibt.
    expect(within(leiste).getByRole("button", { name: "Ansicht und Hilfe" }).textContent?.replace("▾", "").trim()).toBe("");
    expect(eigenschaftenKnopf().textContent).toBe("");
  });

  it("Ansichtszeile als Auswahl; Kopf ohne doppelte Überschrift; Verwerfen kurz mit vollem Namen", async () => {
    await raumentwurf();
    const ansicht = screen.getByRole("combobox", { name: "Ansicht" });
    expect(ansicht).toHaveValue("editor");
    expect(screen.queryByRole("group", { name: "Ansicht" })).toBeNull();
    expect(within(arbeitsflaeche()).getByRole("heading", { level: 2, name: /^Grundriss/ })).toHaveClass("sr-only");
    const verwerfen = within(arbeitsflaeche()).getByRole("button", { name: "Änderungen verwerfen" });
    expect(verwerfen).toHaveTextContent(/^Verwerfen$/);
    expect(verwerfen).toBeEnabled();
  });

  it("Wandfläche: Rückweg als Symbol mit Namen, Pfad ohne Geschoss, Öffnung als Menü", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    fireEvent.keyDown(window, { key: "t" });
    const w1 = await screen.findByTestId("wand-w1");
    zeiger(w1, "pointerdown", 1500, 20);
    zeiger(flaeche(), "pointerup", 1500, 20);
    zeiger(w1, "click", 1500, 20);
    const wand = await screen.findByRole("region", { name: /Wandansicht · Wand 1/ });
    const zurueck = within(wand).getByRole("button", { name: "Zurück zum Grundriss" });
    expect(zurueck.textContent).toBe("");
    const pfad = within(wand).getByRole("navigation", { name: "Pfad" });
    expect(pfad).toHaveTextContent(/^Grundriss/);
    expect(pfad).not.toHaveTextContent("Erdgeschoss");
    const leiste = within(wand).getByRole("toolbar", { name: "Werkzeuge der Wandansicht" });
    expect(within(leiste).getByRole("button", { name: "Öffnung setzen: Tür" })).toBeInTheDocument();
    expect(within(wand).getByRole("button", { name: "Außenseite ansehen" })).toHaveTextContent(/^Außenseite$/);
  });
});
