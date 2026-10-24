import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";
import { DIELE, DURCHFUEHRUNG, GESCHOSS, KUECHE, TYPEN, VERTEILUNG, geschossplan, leitung, stromkreis, vorlage, wirksam } from "./testdaten";
import { eigenschaftenOeffnen, raumInListe } from "../arbeitsflaeche/testhilfe";

/**
 * Leitungsplanung in Wand- und Deckenansicht (Phase 6b.4) über den echten
 * Editor. Ersetzt werden nur API, Route und Rechte.
 *
 * Diele (0,0)–(4200,3000) gegen den Uhrzeigersinn: In der Ansicht der Südwand
 * `diele-w0` liegt das Wandende links - `u = 4200 − Abstand`. UV1 sitzt bei
 * u = 3700 / 1400, die Steckdose der Diele bei u = 1200 / 300.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
const rechte = { plan: true, kreis: true, route: true };
vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: (p: string) =>
    p === "electrical.route.write" ? rechte.route : p === "electrical.circuit.write" ? rechte.kreis : p === "electrical.plan.write" ? rechte.plan : true,
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");
const { GrundrissEditor } = await import("../editor/GrundrissEditor");

let projektstatus = "active";
let leitungen = [leitung()];
let kreise = [stromkreis()];
let plan = geschossplan();

function problem(status: number, typ: string, errors?: unknown[]) {
  return new ApiError(status, { type: `https://elektroplan.internal/errors/${typ}`, title: "Fehler", status, detail: "Serverdetail", ...(errors ? { errors } : {}) } as never, null);
}

function zeigen(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return render(
    <QueryClientProvider client={client}>
      <RueckfrageProvider>
        <RoomsTab />
      </RueckfrageProvider>
    </QueryClientProvider>,
  );
}

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

/** Südwand der Diele in der Wandansicht öffnen. */
async function wandOeffnen() {
  await screen.findByRole("application", { name: /Grundriss/ });
  fireEvent.click(await raumInListe(/0.01 Diele/));
  grundrissKlick(await screen.findByTestId("wand-diele-w0"), 2000, 0);
  fireEvent.click(await screen.findByRole("button", { name: /^Wand (bearbeiten|ansehen)$/ }));
  const d = await screen.findByRole("region", { name: /Wandansicht/ });
  // Leitungsliste und -formular stehen im Eigenschaftenpanel der Wandansicht (6c.0).
  await eigenschaftenOeffnen(d);
  await within(d).findByRole("heading", { name: "Leitungen" });
  return d;
}

const ansicht = () => document.querySelector<SVGSVGElement>("svg.ansicht__svg")!;

function bild(u: number, h: number, L = 4200, H = 2500) {
  const wand = screen.getByTestId("wandflaeche");
  const x = Number(wand.getAttribute("x"));
  const y = Number(wand.getAttribute("y"));
  const b = Number(wand.getAttribute("width"));
  const hoehe = Number(wand.getAttribute("height"));
  return { clientX: x + (u * b) / L, clientY: y + hoehe - (h * hoehe) / H };
}

function zeiger(ziel: Element, typ: string, u: number, h: number) {
  fireEvent(ziel, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, ...bild(u, h) }));
}

function klicken(u: number, h: number, ziel: Element = ansicht()) {
  zeiger(ziel, "pointermove", u, h);
  zeiger(ziel, "pointerdown", u, h);
  zeiger(ziel, "pointerup", u, h);
}

const geraetTreffer = (id: string) => screen.getByTestId(`ansicht-geraet-${id}`).querySelector("rect.ansicht__geraet-treffer") as Element;

/** Gerät anklicken (Zeichenablauf 6c, L2: Start bzw. Ziel). */
function geraetKlicken(id: string) {
  for (const typ of ["pointerdown", "pointerup"]) fireEvent(geraetTreffer(id), new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0 }));
}

/** „Leitung hinzufügen“ oben und Startgerät UV1 anklicken. */
function zeichnenAbUv1(d: HTMLElement) {
  fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
  geraetKlicken("uv1");
}

const zeichenleiste = () => screen.getByTestId("zeichenleiste");

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  rechte.plan = true;
  rechte.kreis = true;
  rechte.route = true;
  projektstatus = "active";
  leitungen = [leitung()];
  kreise = [stromkreis()];
  plan = geschossplan();
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  api.get.mockImplementation((pfad: string, o?: { query?: Record<string, string> }) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: projektstatus, version: 2 });
    if (pfad.endsWith("/effective")) return Promise.resolve(wirksam(o?.query));
    if (pfad.endsWith("/cable-templates")) return Promise.resolve({ templates: [vorlage()] });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve([GESCHOSS]);
    if (pfad.endsWith("/plan")) return Promise.resolve(plan);
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    if (pfad.endsWith("/distribution-boards")) return Promise.resolve({ building_id: "gebaeude-1", boards: [VERTEILUNG] });
    if (pfad.endsWith("/circuits")) return Promise.resolve({ building_id: "gebaeude-1", circuits: kreise });
    if (pfad.endsWith("/cables")) return Promise.resolve({ building_id: "gebaeude-1", cables: leitungen });
    if (pfad.endsWith("/penetrations")) return Promise.resolve({ floor_id: "geschoss-1", penetrations: [DURCHFUEHRUNG] });
    if (pfad.endsWith("/risers")) return Promise.resolve({ building_id: "gebaeude-1", risers: [] });
    return Promise.resolve([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ------------------------------------------------------------ Arbeitsfläche (6c.0)

describe("Wandansicht mit eingeklapptem Eigenschaftenpanel (6c.0)", () => {
  it("Leitungsentwurf bleibt über Ein-/Ausklappen und Maximieren erhalten; Zeichenleiste und Rückgängig an der Fläche", async () => {
    leitungen = [];
    zeigen();
    const d = await wandOeffnen();
    zeichnenAbUv1(d);
    klicken(3700, 2210);
    const flaeche = within(d).getByRole("region", { name: "Arbeitsfläche Wand" });
    const svg = ansicht();
    fireEvent.click(within(flaeche).getByRole("button", { name: "Eigenschaften" }));
    fireEvent.click(within(flaeche).getByRole("button", { name: "Zeichenfläche maximieren" }));
    expect(flaeche).toHaveAttribute("data-maximiert");
    fireEvent.click(within(flaeche).getByRole("button", { name: "Normale Ansicht" }));
    expect(ansicht()).toBe(svg);
    expect(zeichenleiste()).toHaveTextContent("Verlauf zeichnen (1)");
    expect(within(flaeche).getByRole("group", { name: "Rückgängig und Wiederholen im Leitungsentwurf" })).toBeInTheDocument();
    expect(within(flaeche).getByRole("button", { name: "Rückgängig" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("Neue Durchführung in der Wandansicht (6b.5)", () => {
  it("Werkzeug Durchführung legt sie nur im Entwurf an; die Gegenseite zeigt sie an der transformierten Lage", async () => {
    leitungen = [];
    const diele = rechteck("diele", "Diele", [0, 0], [4200, 3000], {
      nummer: "0.01",
      geraete: [
        { id: "uv1", typ: "distribution_board", wand: 0, mitte: 500, hoehe: 1400 },
        { id: "sd-ost", typ: "socket_single", wand: 1, mitte: 2500, hoehe: 300 },
      ],
    });
    plan = geschossplan([diele, KUECHE]);
    kreise = [stromkreis({ device_ids: ["sd-ost", "sd-kueche"] })];
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    fireEvent.click(await raumInListe(/0.01 Diele/));
    grundrissKlick(await screen.findByTestId("wand-diele-w1"), 4200, 1500);
    fireEvent.click(await screen.findByRole("button", { name: /^Wand (bearbeiten|ansehen)$/ }));
    const d = await screen.findByRole("region", { name: /Wandansicht/ });
    fireEvent.click(await within(d).findByRole("button", { name: "Leitung hinzufügen" }));
    geraetKlicken("sd-ost");
    // Ostwand der Diele (3 000 lang, Wandende links): Abstand 1 500 liegt bei u = 1 500.
    const ort = (u: number, h: number) => ({ bubbles: true, cancelable: true, button: 0, ...bild(u, h, 3000) });
    for (const typ of ["pointermove", "pointerdown", "pointerup"]) fireEvent(ansicht(), new MouseEvent(typ, ort(1500, 300)));
    expect(screen.getByTestId("wegpunkt-0")).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Durchführung" }));
    for (const typ of ["pointermove", "pointerdown", "pointerup"]) fireEvent(ansicht(), new MouseEvent(typ, ort(1500, 300)));
    expect(within(d).getByTestId("wand-statuszeile")).toHaveTextContent(/Neue Durchführung als Wegpunkt 2/);
    expect(document.querySelector("[data-neu='ja']")).not.toBeNull();
    // Nur im Entwurf: Der Server hat nichts erhalten.
    expect(api.post).not.toHaveBeenCalled();

    await eigenschaftenOeffnen(d);
    fireEvent.click(within(d).getByRole("button", { name: /Gegenseite aus „0.02 Küche“ ansehen/ }));
    const k = await screen.findByRole("region", { name: /Wandansicht.*Küche|Küche.*Wandansicht/ });
    // Küche.West läuft von (4200,3000) nach (4200,0); Gegenlage 3 000 − 1 500 = 1 500 ab Wandanfang.
    const marke = await within(k).findByTestId(/^durchfuehrung-neu-[0-9a-f]{32}$/);
    expect(marke.querySelector("circle")).toHaveAttribute("data-neu", "ja");
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ Bestehende Leitung

describe("Bestehende Leitung bearbeiten", () => {
  it("Ziehen ist ein Rückgängig-Schritt; andere Wegpunktarten bleiben beim Speichern unverändert", async () => {
    const boden = { kind: "floor" as const, room_id: "kueche", x_mm: 5000, y_mm: 1000 };
    leitungen = [leitung({ waypoints: [...leitung().waypoints, boden], status: "conflict", length_mm: null })];
    api.put.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ waypoints: o.body.waypoints as never, version: 3 })));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Verlauf bearbeiten" }));
    const entwurf = within(d).getByRole("region", { name: "Leitungsentwurf" });
    expect(within(entwurf).getByText(/Fußbodenpunkt/)).toBeInTheDocument();
    // Die Räume sind gesperrt, solange die Leitung offen ist - kein zweiter Entwurf.
    expect(within(d).queryByRole("button", { name: "Tür" })).toBeNull();

    const punkt = screen.getByTestId("wegpunkt-0").querySelector("circle") as Element;
    zeiger(punkt, "pointerdown", 3700, 2200);
    // Mehrere Zwischenlagen - eine Bewegung. Nah an der Achse über UV1 rastet der Punkt dort ein.
    zeiger(ansicht(), "pointermove", 3650, 2200);
    zeiger(ansicht(), "pointermove", 3500, 2200);
    zeiger(ansicht(), "pointermove", 3300, 2200);
    zeiger(ansicht(), "pointerup", 3300, 2200);
    expect(within(entwurf).getByText(/Wandpunkt · diese Wand · 330 cm von links · 220 cm hoch/)).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Rückgängig" }));
    expect(within(entwurf).getByText(/Wandpunkt · diese Wand · 370 cm von links · 220 cm hoch/)).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Wiederholen" }));
    expect(within(entwurf).getByText(/330 cm von links/)).toBeInTheDocument();

    // Nur der Verlauf hat sich geändert: direkt speichern, ohne Dialog (Entwurf §18.3).
    fireEvent.click(within(zeichenleiste()).getByRole("button", { name: "Verlauf speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [pfad, optionen] = api.put.mock.calls[0] as [string, { ifMatch: number; body: { waypoints: unknown[] } }];
    expect(pfad).toBe("/api/v1/modules/electrical/cables/{cable_id}");
    expect(optionen.ifMatch).toBe(2);
    expect(optionen.body.waypoints).toEqual([
      { kind: "wall", wall_id: "diele-w0", offset_mm: 900, height_mm: 2200 },
      { kind: "wall", wall_id: "diele-w0", offset_mm: 4200, height_mm: 2200 },
      { kind: "wall", wall_id: "diele-w1", offset_mm: 0, height_mm: 2200 },
      { kind: "penetration", penetration_id: "d1" },
      boden,
    ]);
  });

  it("Prozentreserve (Phase 6c V1) bleibt beim Speichern erhalten; unverändert gespeichert ändert sich nichts", async () => {
    leitungen = [leitung({ reserve_mode: "percent", reserve_percent: "20", reserve_origin: "manual", reserve_effective_mm: 1700, allowance_mm: 2400, length_mm: 10_900, known_mm: 10_900 })];
    api.put.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ ...(o.body as object), version: 3 })));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Angaben …" }));
    const dialog = await screen.findByRole("dialog", { name: /Leitung L1 – Angaben/ });
    expect(within(dialog).getByLabelText("Prozentsatz")).toHaveValue("20");
    // 8 500 Weg + 500 + 200 + 20 % von 8 500 (1 700) = 10 900 - wie im Backend (gemeinsame Fixture).
    expect(within(dialog).getByTestId("gesamtbedarf")).toHaveTextContent("Gesamtbedarf 1.090 cm");
    expect(within(dialog).getByTestId("bedarf-teile")).toHaveTextContent("Reserve 170 cm (20 %) · Zugaben 70 cm");
    expect(within(within(dialog).getByRole("region", { name: "Reserve" })).getByTestId("herkunft")).toHaveTextContent("abweichend");
    // Ohne Änderung nichts zu speichern; nur die Bezeichnung ändern - die Prozentreserve wird nicht still zu 0 mm.
    const bezeichnung = within(dialog).getByLabelText("Bezeichnung");
    fireEvent.change(bezeichnung, { target: { value: "L1a" } });
    fireEvent.blur(bezeichnung);
    fireEvent.click(within(dialog).getByRole("button", { name: "Leitung speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [, optionen] = api.put.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(optionen.body).toMatchObject({ label: "L1a", reserve_mode: "percent", reserve_percent: "20", reserve_mm: 0, spec_source: null, reserve_source: null, allowance_source: null });
    expect(optionen.body).not.toHaveProperty("defaults_basis");
  });

  it("feste Bestandsreserve bleibt fest; Prozent nur ausdrücklich", async () => {
    leitungen = [leitung({ reserve_mm: 300, allowance_mm: 1000, length_mm: 9500, known_mm: 9500 })];
    api.put.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ ...(o.body as object), version: 3 })));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Angaben …" }));
    const dialog = await screen.findByRole("dialog", { name: /Leitung L1 – Angaben/ });
    expect(within(dialog).getByTestId("reserve-fest")).toBeInTheDocument();
    expect(within(dialog).getByTestId("bedarf-teile")).toHaveTextContent("Reserve 30 cm (fest)");
    expect(within(within(dialog).getByRole("region", { name: "Reserve" })).getByTestId("herkunft")).toHaveTextContent("vor 6c erfasst");
    // Bloßes Öffnen ändert nichts: ohne Änderung bleibt „Änderungen verwerfen …“ aus.
    expect(within(dialog).queryByRole("button", { name: "Änderungen verwerfen …" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Auf Prozent umstellen" }));
    expect(within(dialog).getByLabelText("Prozentsatz")).toHaveValue("0");
    expect(within(within(dialog).getByRole("region", { name: "Reserve" })).getByTestId("herkunft")).toHaveTextContent("abweichend");
    fireEvent.click(within(dialog).getByRole("button", { name: "Feste Reserve eingeben" }));
    expect(within(dialog).getByTestId("reserve-fest")).toBeInTheDocument();
  });

  it("Bestandsreserven beim sofortigen Speichern (§21.5): fest bleibt fest mit dem getippten Wert, Prozent bleibt Prozent", async () => {
    leitungen = [leitung({ reserve_mm: 300, allowance_mm: 1000, length_mm: 9500, known_mm: 9500 })];
    api.put.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ ...(o.body as object), version: 3 })));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Angaben …" }));
    const dialog = await screen.findByRole("dialog", { name: /Leitung L1 – Angaben/ });
    const fest = within(dialog).getByLabelText("Feste Reserve");
    fireEvent.focus(fest);
    fireEvent.change(fest, { target: { value: "45" } });
    expect(within(dialog).getByTestId("bedarf-teile")).toHaveTextContent("Reserve 45 cm (fest)");
    fireEvent.click(within(dialog).getByRole("button", { name: "Leitung speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect((api.put.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body).toMatchObject({ reserve_mode: "fixed", reserve_mm: 450, reserve_percent: null, reserve_source: "manual" });
  });

  it("Prozent-Bestandsreserve: nur die Bezeichnung getippt und sofort gespeichert - Reserve unverändert", async () => {
    leitungen = [leitung({ reserve_mode: "percent", reserve_percent: "20", reserve_origin: "manual", reserve_effective_mm: 1700, allowance_mm: 2400, length_mm: 10_900, known_mm: 10_900 })];
    api.put.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ ...(o.body as object), version: 3 })));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Angaben …" }));
    const dialog = await screen.findByRole("dialog", { name: /Leitung L1 – Angaben/ });
    const bezeichnung = within(dialog).getByLabelText("Bezeichnung");
    fireEvent.focus(bezeichnung);
    fireEvent.change(bezeichnung, { target: { value: "L1b" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Leitung speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect((api.put.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body).toMatchObject({ label: "L1b", reserve_mode: "percent", reserve_percent: "20", reserve_mm: 0, reserve_source: null });
  });

  it("Pfeiltasten verschieben, Entf entfernt - Fußbodenpunkt nicht", async () => {
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Verlauf bearbeiten" }));
    const entwurf = within(d).getByRole("region", { name: "Leitungsentwurf" });
    fireEvent.click(within(entwurf).getByRole("button", { name: /Wandpunkt · diese Wand · 370 cm/ }));
    fireEvent.keyDown(ansicht(), { key: "ArrowLeft" });
    expect(within(entwurf).getByText(/Wandpunkt · diese Wand · 369 cm von links/)).toBeInTheDocument();
    fireEvent.keyDown(ansicht(), { key: "Delete" });
    expect(within(within(entwurf).getByRole("list", { name: "Wegpunkte" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("Versionskonflikt überschreibt nichts; Verwerfen und Neuladen erst auf Wunsch", async () => {
    api.put.mockRejectedValue(problem(409, "version-conflict"));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Verlauf bearbeiten" }));
    const entwurf = within(d).getByRole("region", { name: "Leitungsentwurf" });
    fireEvent.click(within(entwurf).getByRole("button", { name: /Wandpunkt · diese Wand · 370 cm/ }));
    fireEvent.keyDown(ansicht(), { key: "ArrowLeft" });
    fireEvent.click(within(zeichenleiste()).getByRole("button", { name: "Verlauf speichern" }));
    expect(await within(zeichenleiste()).findByText(/zwischenzeitlich an anderer Stelle geändert/)).toBeInTheDocument();
    expect(within(entwurf).getByText(/369 cm von links/)).toBeInTheDocument();
    expect(within(entwurf).getByText("Nicht gespeichert")).toBeInTheDocument();
    leitungen = [leitung({ version: 7, label: "L1 neu" })];
    fireEvent.click(within(zeichenleiste()).getByRole("button", { name: "Serverstand laden (Änderungen verwerfen)" }));
    expect(await within(d).findByRole("heading", { name: /Leitung L1 neu/ })).toBeInTheDocument();
    expect(within(d).getByTestId("leitung-hinweis")).toHaveTextContent("Serverstand geladen");
    expect(within(within(d).getByRole("list", { name: "Wegpunkte" })).getByText(/370 cm von links/)).toBeInTheDocument();
    expect(api.put).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------------ Arbeitsflächen

describe("Wand- und Deckenwechsel", () => {
  it("behält Entwurf und Werkzeug, speichert nichts und setzt an der Decke über den Übergang fort", async () => {
    leitungen = [];
    zeigen();
    const d = await wandOeffnen();
    zeichnenAbUv1(d);
    // Am oberen Rand rastet der Punkt auf der Decke ein (Übergang Wand – Decke).
    klicken(3700, 2480);
    expect(within(d).getByText(/370 cm von links · 250 cm hoch/)).toBeInTheDocument();
    fireEvent.click(within(zeichenleiste()).getByRole("button", { name: /^Zur Decke von/ }));
    const decke = await screen.findByRole("region", { name: /Deckenansicht/ });
    expect(screen.queryByRole("region", { name: /Wandansicht/ })).toBeNull();
    await eigenschaftenOeffnen(decke);
    const entwurf = within(decke).getByRole("region", { name: "Leitungsentwurf" });
    expect(within(within(entwurf).getByRole("list", { name: "Wegpunkte" })).getAllByRole("listitem")).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    // Das Werkzeug läuft weiter - derselbe Ablauf, kein neuer Einstieg.
    expect(within(decke).getByRole("button", { name: "Leitung hinzufügen" })).toHaveAttribute("aria-pressed", "true");
    expect(zeichenleiste()).toHaveTextContent("Verlauf zeichnen (1)");
  });
});

// ------------------------------------------------------------------ Schnelle Eingabe (Nachkorrektur 6b.5)

/** Ereignisse ohne Rendern dazwischen - wie eine schnelle Geste vor dem nächsten React-Render. */
function ohneRendern(schritte: readonly [Element, string, { clientX: number; clientY: number }][]) {
  act(() => {
    for (const [ziel, typ, ort] of schritte) ziel.dispatchEvent(new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, ...ort }));
  });
}

/** Bildpunkt einer Deckenstelle aus den Ecken der gezeichneten Diele (0,0), (4200,0), (0,3000). */
function deckenbild(x: number, y: number) {
  const punkte = (screen.getByTestId("deckenkontur").getAttribute("points") ?? "").trim().split(/\s+/).map((p) => p.split(",").map(Number) as [number, number]);
  const [a, b, , c] = punkte as [[number, number], [number, number], [number, number], [number, number]];
  return { clientX: a[0] + ((b[0] - a[0]) * x) / 4200 + ((c[0] - a[0]) * y) / 3000, clientY: a[1] + ((b[1] - a[1]) * x) / 4200 + ((c[1] - a[1]) * y) / 3000 };
}

describe("Schnelle Eingabe: ein Klick setzt genau die angezeigte Vorschau", () => {
  it("Wandansicht: Drücken und Loslassen ohne Rendern - Punkt an der angezeigten Lage; mit Bewegung nichts", async () => {
    leitungen = [];
    zeigen();
    const d = await wandOeffnen();
    zeichnenAbUv1(d);
    ohneRendern([
      [ansicht(), "pointermove", bild(3700, 2210)],
      [ansicht(), "pointerdown", bild(3700, 2210)],
      [ansicht(), "pointermove", bild(1200, 2210)],
      [ansicht(), "pointerup", bild(1200, 2210)],
    ]);
    expect(screen.queryByTestId("wegpunkt-0")).toBeNull();
    ohneRendern([
      [ansicht(), "pointermove", bild(1200, 2210)],
      [ansicht(), "pointerdown", bild(1200, 2210)],
      [ansicht(), "pointerup", bild(1200, 2210)],
    ]);
    await eigenschaftenOeffnen(d);
    const entwurf = within(d).getByRole("region", { name: "Leitungsentwurf" });
    const punkte = within(within(entwurf).getByRole("list", { name: "Wegpunkte" })).getAllByRole("listitem");
    expect(punkte).toHaveLength(1);
    expect(punkte[0]).toHaveTextContent("Wandpunkt · diese Wand · 120 cm von links · 220 cm hoch");
  });

  it("Wandansicht: schnelles Ziehen ist genau ein Rückgängig-Schritt und endet an der letzten Lage", async () => {
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Verlauf bearbeiten" }));
    const entwurf = within(d).getByRole("region", { name: "Leitungsentwurf" });
    const punkt = screen.getByTestId("wegpunkt-0").querySelector("circle") as Element;
    ohneRendern([
      [punkt, "pointerdown", bild(3700, 2200)],
      [ansicht(), "pointermove", bild(3500, 2200)],
      [ansicht(), "pointermove", bild(3300, 2200)],
      [ansicht(), "pointerup", bild(3300, 2200)],
    ]);
    expect(within(entwurf).getByText(/Wandpunkt · diese Wand · 330 cm von links · 220 cm hoch/)).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Rückgängig" }));
    expect(within(entwurf).getByText(/Wandpunkt · diese Wand · 370 cm von links · 220 cm hoch/)).toBeInTheDocument();
  });

  it("Deckenansicht: Klick ohne Rendern setzt den angezeigten Übergang von der Wand", async () => {
    leitungen = [];
    zeigen();
    const d = await wandOeffnen();
    zeichnenAbUv1(d);
    klicken(3700, 2480);
    fireEvent.click(within(zeichenleiste()).getByRole("button", { name: /^Zur Decke von/ }));
    const decke = await screen.findByRole("region", { name: /Deckenansicht/ });
    const flaeche = decke.querySelector("svg.ansicht__svg") as Element;
    // Knapp neben dem Übergang von der Wand - der Fang setzt ihn genau, wie angezeigt.
    ohneRendern([
      [flaeche, "pointermove", deckenbild(500, 30)],
      [flaeche, "pointerdown", deckenbild(500, 30)],
      [flaeche, "pointerup", deckenbild(500, 30)],
    ]);
    await eigenschaftenOeffnen(decke);
    const entwurf = within(decke).getByRole("region", { name: "Leitungsentwurf" });
    const punkte = within(within(entwurf).getByRole("list", { name: "Wegpunkte" })).getAllByRole("listitem");
    expect(punkte).toHaveLength(2);
    expect(punkte[1]).toHaveTextContent("Deckenpunkt · Diele (Erdgeschoss) · x 50 cm, y 0 cm");
  });
});

// ------------------------------------------------------------------ Vorschlag

describe("Stromkreisvorschlag übernehmen", () => {
  it("nur ausdrücklich, mit Leitungsversion (If-Match) und gesehener Stromkreisversion", async () => {
    leitungen = [leitung({ deviates_from_proposal: true, cross_section_mm2: "2.50" })];
    api.post.mockResolvedValue(leitung({ version: 3 }));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    expect(within(d).getByText("weicht vom aktuellen Stromkreisvorschlag ab")).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Vorschlag übernehmen" }));
    const frage = await screen.findByRole("dialog", { name: "Stromkreisvorschlag übernehmen?" });
    expect(within(frage).getByText("NYM-J · 3 Leiter · 1,5 mm²")).toBeInTheDocument();
    fireEvent.click(within(frage).getByRole("button", { name: "Vorschlag übernehmen" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/modules/electrical/cables/{cable_id}/apply-proposal", {
        path: { cable_id: "l1" },
        ifMatch: 2,
        body: { expected_circuit_version: 5 },
      }),
    );
  });

  it("bei einem Konflikt wird nichts übernommen und das verständlich gesagt", async () => {
    leitungen = [leitung({ deviates_from_proposal: true })];
    api.post.mockRejectedValue(problem(409, "conflict", [{ field: "expected_circuit_version", code: "circuit-proposal-changed", message: "x" }]));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Vorschlag übernehmen" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Stromkreisvorschlag übernehmen?" })).getByRole("button", { name: "Vorschlag übernehmen" }));
    expect(await within(d).findByText(/Es wurde nichts übernommen/)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ Unterbrechung

describe("Änderungen, die Leitungen unterbrechen", () => {
  const bruch = (id: string, text: string) => problem(409, "conflict", [{ field: "cables", code: "cables-would-break", message: text, keys: [id] }]);

  async function tuerSetzenUndSpeichern() {
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: "Tür" }));
    klicken(1200, 1000);
    await within(d).findByText(/Tür gesetzt/);
    fireEvent.click(within(d).getByRole("button", { name: "Speichern" }));
    return d;
  }

  it("nennt Stromkreis, Endgeräte und Grund und sendet genau die bestätigten IDs", async () => {
    api.put.mockRejectedValueOnce(bruch("l1", "F3 · L1: Verteilung (0.01 Diele) → Steckdose (0.02 Kueche): Die Wandstrecke fuehrt durch eine Oeffnung.")).mockResolvedValueOnce(DIELE);
    zeigen();
    await tuerSetzenUndSpeichern();
    const frage = await screen.findByRole("dialog", { name: "Eine Leitung würde unterbrochen" });
    expect(within(frage).getByTestId("betroffene-leitungen")).toHaveTextContent("F3 · L1: Verteilung (0.01 Diele) → Steckdose (0.02 Kueche)");
    expect(within(frage).getByText(/ohne Gesamtlänge und nicht in bestätigten Mengen/)).toBeInTheDocument();
    fireEvent.click(within(frage).getByRole("button", { name: "Speichern – Leitung wird Konflikt" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    const erste = (api.put.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body;
    const zweite = (api.put.mock.calls[1] as [string, { body: Record<string, unknown> }])[1].body;
    expect(erste).not.toHaveProperty("acknowledged_cable_ids");
    expect(zweite.acknowledged_cable_ids).toEqual(["l1"]);
  });

  it("neu betroffene Leitungen: erneut fragen; Ablehnen speichert nichts", async () => {
    api.put.mockRejectedValueOnce(bruch("l1", "F3 · L1: …")).mockRejectedValueOnce(bruch("l7", "F4 · L7: Licht"));
    zeigen();
    const d = await tuerSetzenUndSpeichern();
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Eine Leitung würde unterbrochen" })).getByRole("button", { name: "Speichern – Leitung wird Konflikt" }));
    const erneut = await screen.findByText(/Der Stand hat sich seit Ihrer Bestätigung geändert/);
    expect(within(erneut.closest("dialog") as HTMLElement).getByTestId("betroffene-leitungen")).toHaveTextContent("F4 · L7: Licht");
    fireEvent.click(within(erneut.closest("dialog") as HTMLElement).getByRole("button", { name: "Nicht speichern" }));
    await waitFor(() => expect(screen.queryByText(/Der Stand hat sich/)).toBeNull());
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(within(d).getByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
  });
});

describe("Durchführung verschieben", () => {
  it("nur ohne offenen Leitungsentwurf; Unterbrechung nur mit genauer Bestätigung", async () => {
    const bruch = problem(409, "conflict", [{ field: "cables", code: "cables-would-break", message: "F3 · L1: Verteilung → Steckdose", keys: ["l1"] }]);
    api.patch.mockRejectedValueOnce(bruch).mockResolvedValueOnce({ ...DURCHFUEHRUNG, height_mm: 2000, version: 4 });
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    fireEvent.click(await raumInListe(/0.01 Diele/));
    grundrissKlick(await screen.findByTestId("wand-diele-w1"), 4200, 1500);
    fireEvent.click(await screen.findByRole("button", { name: /^Wand (bearbeiten|ansehen)$/ }));
    const d = await screen.findByRole("region", { name: /Wandansicht · Wand 2/ });
    await eigenschaftenOeffnen(d);
    const marke = (await within(d).findByTestId("durchfuehrung-d1")).querySelector("circle") as Element;
    fireEvent(marke, new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    fireEvent(marke, new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
    const feld = within(d).getByRole("group", { name: "Gewählte Durchführung" });
    const hoehe = within(feld).getByLabelText(/Höhe über Boden/);
    fireEvent.change(hoehe, { target: { value: "200" } });
    fireEvent.blur(hoehe);
    const frage = await screen.findByRole("dialog", { name: "Eine Leitung würde unterbrochen" });
    fireEvent.click(within(frage).getByRole("button", { name: "Speichern – Leitung wird Konflikt" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(api.patch.mock.calls[0]).toEqual([
      "/api/v1/modules/electrical/penetrations/{penetration_id}",
      { path: { penetration_id: "d1" }, ifMatch: 3, body: { offset_mm: 2100, height_mm: 2000 } },
    ]);
    expect((api.patch.mock.calls[1] as [string, { body: unknown }])[1].body).toEqual({ offset_mm: 2100, height_mm: 2000, acknowledged_cable_ids: ["l1"] });
  });
});

// ------------------------------------------------------------------ Zuordnung

describe("Gerätezuordnung in der Wandansicht", () => {
  it("derselbe Entwurf wie in der Stromkreisansicht - fremde Geräte bleiben, bewusst speichern", async () => {
    kreise = [stromkreis(), stromkreis({ id: "f4", designation: "F4", name: "Licht", device_ids: [], version: 2 })];
    api.put.mockResolvedValue(stromkreis({ id: "f4", designation: "F4", device_ids: [], version: 3 }));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.change(within(d).getByLabelText("Geräte einem Stromkreis zuordnen"), { target: { value: "f4" } });
    fireEvent.click(within(d).getByRole("button", { name: "Geräte zuordnen" }));
    expect(within(d).getByRole("button", { name: "Zuordnen" })).toHaveAttribute("aria-pressed", "true");
    // Die Steckdose gehört zu F3 - sie wird nicht still umgehängt.
    expect(screen.getByTestId("zuordnung-sd-diele")).toHaveAttribute("data-zustand", "anderer");
    const treffer = geraetTreffer("sd-diele");
    fireEvent(treffer, new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    fireEvent(treffer, new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
    expect(within(d).getByTestId("wand-statuszeile")).toHaveTextContent("Gehört zu UV1 · F3 Steckdosen – wird nicht still umgehängt.");
    // Die Verteilung selbst ist nicht zuordenbar.
    expect(screen.getByTestId("zuordnung-uv1")).toHaveAttribute("data-zustand", "nicht-zuordenbar");
    expect(within(d).getByRole("button", { name: "Zuordnung speichern" })).toBeDisabled();
  });

  it("zuordnen und speichern mit If-Match des Stromkreises", async () => {
    kreise = [stromkreis({ device_ids: ["sd-kueche"] })];
    api.put.mockResolvedValue(stromkreis({ device_ids: ["sd-diele", "sd-kueche"], version: 6 }));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: "Geräte zuordnen" }));
    expect(screen.getByTestId("zuordnung-sd-diele")).toHaveAttribute("data-zustand", "frei");
    const treffer = geraetTreffer("sd-diele");
    fireEvent(treffer, new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    fireEvent(treffer, new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
    expect(screen.getByTestId("zuordnung-sd-diele")).toHaveAttribute("data-zustand", "dieser");
    fireEvent.click(within(d).getByRole("button", { name: "Zuordnung speichern" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/v1/modules/electrical/circuits/{circuit_id}/devices", {
        path: { circuit_id: "f3" },
        ifMatch: 5,
        body: { device_ids: ["sd-diele", "sd-kueche"] },
      }),
    );
  });
});

// ------------------------------------------------------------------ Schutz

describe("Entwurfsschutz, Rechte und Sitzung", () => {
  it("ungespeicherter Leitungsentwurf: übersteht Ansichtswechsel im Gebäude; Steigwege fragen nach, nichts wird verworfen", async () => {
    leitungen = [];
    zeigen();
    const d = await wandOeffnen();
    zeichnenAbUv1(d);
    klicken(3700, 2200);
    fireEvent.click(within(d).getByRole("button", { name: /^Zurück zu(m Grundriss|r 3D-Ansicht)$/ }));
    // Der Ablauf gehört zum Gebäude: Im Grundriss geht es mit derselben Leitung weiter - die Zeichenleiste
    // nennt Schritt und Änderungszustand.
    expect(await screen.findByTestId("zeichenleiste")).toHaveTextContent("Verlauf zeichnen (1)");
    expect(zeichenleiste()).toHaveTextContent("ungespeichert");
    fireEvent.click(screen.getByRole("button", { name: "Tabellen & Details" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Tabellen & Details" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByRole("dialog", { name: "Ansicht wechseln?" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2D-Editor" }));
    expect(await screen.findByTestId("zeichenleiste")).toHaveTextContent("ungespeichert");
    fireEvent.click(screen.getByRole("button", { name: "Steigwege" }));
    const frage = await screen.findByRole("dialog", { name: "Ansicht wechseln?" });
    expect(within(frage).getByText(/ungespeicherten Leitungsentwurf/)).toBeInTheDocument();
    fireEvent.click(within(frage).getByRole("button", { name: /behalten|Abbrechen|bleiben/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ansicht wechseln?" })).toBeNull());
    // Escape beendet nur das Werkzeug; „Weiterzeichnen“ führt zurück an den letzten Punkt.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByTestId("entwurf-offen")).toHaveTextContent("Leitungsentwurf offen – ungespeichert");
    fireEvent.click(await screen.findByRole("button", { name: "Weiterzeichnen" }));
    expect(await screen.findByRole("region", { name: /Wandansicht · Wand 1/ })).toBeInTheDocument();
    expect(zeichenleiste()).toHaveTextContent("Verlauf zeichnen (1)");
  });

  it("ohne route.write keine Leitungsbearbeitung; ohne circuit.write keine Zuordnung", async () => {
    rechte.route = false;
    rechte.kreis = false;
    zeigen();
    const d = await wandOeffnen();
    expect(within(d).queryByRole("button", { name: "Leitung hinzufügen" })).toBeNull();
    expect(within(d).queryByRole("button", { name: "Geräte zuordnen" })).toBeNull();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    expect(within(d).queryByRole("button", { name: "Verlauf bearbeiten" })).toBeNull();
    expect(within(d).getByTestId("leitungslaenge")).toHaveTextContent("Leitungslänge 920 cm");
  });

  it("abgeschlossenes Projekt: nur lesen", async () => {
    projektstatus = "completed";
    zeigen();
    const d = await wandOeffnen();
    expect(within(d).queryByRole("button", { name: "Leitung hinzufügen" })).toBeNull();
    expect(within(d).queryByRole("button", { name: "Vorschlag übernehmen" })).toBeNull();
  });

  it("nach einem Sitzungswechsel bleibt kein alter Entwurf sichtbar", async () => {
    leitungen = [];
    const erste = zeigen();
    const d = await wandOeffnen();
    zeichnenAbUv1(d);
    expect(zeichenleiste()).toBeInTheDocument();
    // Der AuthProvider baut die Oberfläche mit einem neuen Sitzungsraum (eigener Query-Client) neu auf.
    erste.unmount();
    zeigen(new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
    const neu = await wandOeffnen();
    expect(within(neu).queryByRole("region", { name: "Leitungsentwurf" })).toBeNull();
    expect(screen.queryByTestId("zeichenleiste")).toBeNull();
  });
});

describe("Rückkehr aus 3D", () => {
  it("Wand → Decke im selben Entwurf behält die Herkunft; Schließen führt zur 3D-Ansicht zurück", async () => {
    leitungen = [];
    const zurueck = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <RueckfrageProvider>
          <GrundrissEditor
            floorId="geschoss-1"
            buildingId="gebaeude-1"
            geschossLabel="Hauptgebäude · Erdgeschoss"
            standardhoehe_mm={2500}
            darfSchreiben
            darfLeitungen
            darfStromkreise
            onUngespeichert={() => undefined}
            onGespeichert={() => Promise.resolve()}
            startWandansicht={{ raumId: "diele", wandId: "diele-w0", herkunft: "3d" }}
            onZurueck3d={zurueck}
          />
        </RueckfrageProvider>
      </QueryClientProvider>,
    );
    const d = await screen.findByRole("region", { name: /Wandansicht · Wand 1/ });
    fireEvent.click(await within(d).findByRole("button", { name: "Leitung hinzufügen" }));
    geraetKlicken("uv1");
    fireEvent.click(within(zeichenleiste()).getByRole("button", { name: /^Zur Decke von/ }));
    const decke = await screen.findByRole("region", { name: /Deckenansicht/ });
    await eigenschaftenOeffnen(decke);
    // Der Wechsel selbst führt nicht zurück und schließt nichts.
    expect(zurueck).not.toHaveBeenCalled();
    expect(within(decke).getByRole("region", { name: "Leitungsentwurf" })).toBeInTheDocument();
    fireEvent.click(within(decke).getByRole("button", { name: /^Zurück zu(m Grundriss|r 3D-Ansicht)$/ }));
    // Erst das Schließen führt zurück - die 3D-Ansicht fragt dann wie immer nach dem Entwurf.
    await waitFor(() => expect(zurueck).toHaveBeenCalledTimes(1));
  });
});

describe("Darstellung", () => {
  it("Kopfzeile und Werkzeugleiste der Wandansicht schrumpfen nicht (Überlagerung aus der Browserabnahme)", async () => {
    zeigen();
    const d = await wandOeffnen();
    // Seit L1 stehen Kopf und Werkzeugleiste in Zeilen der Arbeitsfläche, die nicht schrumpfen.
    expect(within(d).getByRole("toolbar", { name: "Werkzeuge der Wandansicht" }).closest(".shrink-0")).not.toBeNull();
    expect(within(d).getByTestId("wandseite").closest(".shrink-0")).not.toBeNull();
  });

  it("Leitungsfarbe ist für hell und dunkel als Token definiert", () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../darstellung.css"), "utf-8");
    const grenze = css.search(/^:root\[data-theme="dark"\] \{/m);
    const hell = css.slice(0, grenze);
    const dunkel = css.slice(grenze);
    expect(hell).toMatch(/--ep-plan-cable:\s*#[0-9a-f]{6}/i);
    expect(dunkel).toMatch(/--ep-plan-cable:\s*#[0-9a-f]{6}/i);
    const leitungCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "leitung.css"), "utf-8");
    expect(leitungCss).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("Einheit mm zeigt Längen in Millimetern", async () => {
    act(() => masseinheitSetzen("mm"));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: /F3 · L1/ }));
    expect(within(d).getByTestId("leitungslaenge")).toHaveTextContent("Leitungslänge 9.200 mm");
  });

  it("die Küche hat kein Gerät der Diele", () => {
    expect(KUECHE.devices.map((g) => g.id)).toEqual(["sd-kueche"]);
  });
});
