import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";
import { raumInListe } from "../arbeitsflaeche/testhilfe";
import { GESCHOSS, KUECHE, TYPEN, VERTEILUNG, geschossplan, leitung, stromkreis, vorlage, wirksam } from "./testdaten";

/**
 * Zeichenablauf „Leitung hinzufügen“ und Abschlussdialog (Phase 6c, L2/L3, Entwurf §18.3–§18.5) über den
 * echten Editor in der Wandansicht. Ersetzt werden nur API, Route und Rechte; alle Vorgaben sind
 * synthetisch.
 *
 * Diele, Südwand `diele-w0` (4 200 × 2 500), in der Ansicht liegt das Wandende links: u = 4 200 − Abstand.
 * UV1 bei u = 3 700 / h = 1 400, Steckdose der Diele bei u = 1 200 / h = 300.
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

let leitungen = [leitung()];
let kreise = [stromkreis()];
let plan = geschossplan();
let vorgaben: Parameters<typeof wirksam>[1] = {};

function problem(status: number, typ: string, errors?: unknown[]) {
  return new ApiError(status, { type: `https://elektroplan.internal/errors/${typ}`, title: "Fehler", status, detail: "Serverdetail", ...(errors ? { errors } : {}) } as never, null);
}

function zeigen() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <RueckfrageProvider>
        <RoomsTab />
      </RueckfrageProvider>
    </QueryClientProvider>,
  );
}

function grundrissKlick(ziel: Element, x: number, y: number) {
  const g = document.querySelector("svg.grundriss__svg g[transform]");
  const m = (g?.getAttribute("transform") ?? "").match(/matrix\(([^)]+)\)/)?.[1]?.split(" ").map(Number) ?? [];
  const [a = 0, , , d = 0, e = 0, f = 0] = m;
  for (const typ of ["pointerdown", "pointerup", "click"]) {
    fireEvent(ziel, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, clientX: e + x * a, clientY: f + y * d }));
  }
}

/** Südwand der Diele - das Eigenschaftenpanel bleibt zu: Gezeichnet wird ohne Formular. */
async function wandOeffnen() {
  await screen.findByRole("application", { name: /Grundriss/ });
  fireEvent.click(await raumInListe(/0.01 Diele/));
  grundrissKlick(await screen.findByTestId("wand-diele-w0"), 2000, 0);
  fireEvent.click(await screen.findByRole("button", { name: /^Wand (bearbeiten|ansehen)$/ }));
  const d = await screen.findByRole("region", { name: /Wandansicht/ });
  await within(d).findByRole("button", { name: "Leitung hinzufügen" });
  return d;
}

const ansicht = () => document.querySelector<SVGSVGElement>("svg.ansicht__svg")!;

function bild(u: number, h: number) {
  const wand = screen.getByTestId("wandflaeche");
  const x = Number(wand.getAttribute("x"));
  const y = Number(wand.getAttribute("y"));
  const b = Number(wand.getAttribute("width"));
  const hoehe = Number(wand.getAttribute("height"));
  return { clientX: x + (u * b) / 4200, clientY: y + hoehe - (h * hoehe) / 2500 };
}

function zeiger(ziel: Element, typ: string, u: number, h: number) {
  fireEvent(ziel, new MouseEvent(typ, { bubbles: true, cancelable: true, button: 0, ...bild(u, h) }));
}

function klicken(u: number, h: number) {
  zeiger(ansicht(), "pointermove", u, h);
  zeiger(ansicht(), "pointerdown", u, h);
  zeiger(ansicht(), "pointerup", u, h);
}

function geraetKlicken(id: string) {
  const treffer = screen.getByTestId(`ansicht-geraet-${id}`).querySelector("rect.ansicht__geraet-treffer") as Element;
  fireEvent(treffer, new MouseEvent("pointermove", { bubbles: true, cancelable: true, button: 0 }));
  fireEvent(treffer, new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
  fireEvent(treffer, new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
}

const leiste = () => screen.getByTestId("zeichenleiste");
const status = (d: HTMLElement) => within(d).getByTestId("wand-statuszeile");

/** Start, zwei Punkte auf 220 cm (ohne Ecke), dann das Ziel - der Dialog öffnet. */
async function bisZumDialog(d: HTMLElement, ziel = "sd-diele") {
  fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
  geraetKlicken("uv1");
  klicken(3700, 2210);
  klicken(1200, 2210);
  geraetKlicken(ziel);
  return screen.findByRole("dialog", { name: "Leitung abschließen" });
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  rechte.plan = true;
  rechte.kreis = true;
  rechte.route = true;
  leitungen = [];
  kreise = [stromkreis()];
  plan = geschossplan();
  vorgaben = {};
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  api.get.mockImplementation((pfad: string, o?: { query?: Record<string, string> }) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
    if (pfad.endsWith("/effective")) return Promise.resolve(wirksam(o?.query, vorgaben));
    if (pfad.endsWith("/cable-templates")) return Promise.resolve({ templates: [vorlage()] });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve([GESCHOSS]);
    if (pfad.endsWith("/plan")) return Promise.resolve(plan);
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    if (pfad.endsWith("/distribution-boards")) return Promise.resolve({ building_id: "gebaeude-1", boards: [VERTEILUNG] });
    if (pfad.endsWith("/circuits")) return Promise.resolve({ building_id: "gebaeude-1", circuits: kreise });
    if (pfad.endsWith("/cables")) return Promise.resolve({ building_id: "gebaeude-1", cables: leitungen });
    if (pfad.endsWith("/penetrations")) return Promise.resolve({ floor_id: "geschoss-1", penetrations: [] });
    if (pfad.endsWith("/risers")) return Promise.resolve({ building_id: "gebaeude-1", risers: [] });
    return Promise.resolve([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Leitung hinzufügen – direkt zeichnen (L2)", () => {
  it("startet ohne Vorauswahl: 1 nur Geräte, 2 Vorschau mit Wirkung, Klick setzt genau die Vorschau", async () => {
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
    // Kein Formular, keine Stromkreiswahl: Schritt 1, mögliche Startgeräte markiert.
    expect(within(d).getByRole("button", { name: "Leitung hinzufügen" })).toHaveAttribute("aria-pressed", "true");
    expect(within(leiste()).getByText(/1 Startgerät wählen/)).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("startgeraet-uv1")).toHaveAttribute("data-moeglich", "ja");
    expect(screen.getByTestId("startgeraet-sd-diele")).toHaveAttribute("data-moeglich", "ja");
    // Kein langes Formular mehr: keine Felder für Leitungstyp, Start- oder Endgerät.
    expect(screen.queryByLabelText(/Leitungstyp/)).toBeNull();
    expect(screen.queryByLabelText("Startgerät")).toBeNull();
    // Ein Klick auf die Wand setzt in Schritt 1 nichts.
    klicken(2000, 1000);
    expect(status(d)).toHaveTextContent("Zuerst ein Startgerät anklicken");
    expect(screen.queryByTestId("wegpunkt-0")).toBeNull();

    geraetKlicken("uv1");
    expect(within(leiste()).getByText(/2 Verlauf zeichnen/)).toHaveAttribute("aria-current", "step");
    zeiger(ansicht(), "pointermove", 3700, 2210);
    expect(screen.getByTestId("leitung-kandidat")).toHaveAttribute("data-gueltig", "ja");
    expect(status(d)).toHaveTextContent("Nächster Klick: Wegpunkt 1 setzen: 370 cm von links · 220 cm über Boden");
    zeiger(ansicht(), "pointerdown", 3700, 2210);
    zeiger(ansicht(), "pointerup", 3700, 2210);
    expect(screen.getByTestId("wegpunkt-0")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("L-Führung: sichtbare Ecke, „Ecke wechseln“ ohne Kippen, Ecke und Punkt als ein Rückgängig-Schritt", async () => {
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
    geraetKlicken("uv1");
    klicken(3700, 2210);
    zeiger(ansicht(), "pointermove", 1200, 1000);
    const ecke = () => screen.getByTestId("leitung-kandidat-ecke");
    const vorher = Number(ecke().getAttribute("cx"));
    expect(status(d)).toHaveTextContent("Nächster Klick: Ecke und Wegpunkt 3 setzen");
    // Bewegt sich der Zeiger, bleibt die Richtung: zuerst waagerecht (Ecke bei u des Ziels).
    zeiger(ansicht(), "pointermove", 1250, 1500);
    expect(Number(ecke().getAttribute("cx"))).toBeLessThan(Number(bild(3700, 0).clientX));
    fireEvent.click(within(leiste()).getByTestId("ecke-wechseln"));
    expect(within(leiste()).getByTestId("ecke-wechseln")).toHaveTextContent("zuerst senkrecht");
    zeiger(ansicht(), "pointermove", 1200, 1000);
    expect(Number(ecke().getAttribute("cx"))).not.toBe(vorher);
    zeiger(ansicht(), "pointerdown", 1200, 1000);
    zeiger(ansicht(), "pointerup", 1200, 1000);
    expect(screen.getByTestId("wegpunkt-2")).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Rückgängig" }));
    expect(screen.queryByTestId("wegpunkt-1")).toBeNull();
    expect(screen.getByTestId("wegpunkt-0")).toBeInTheDocument();
  });

  it("ungültige Ecke: Grund am Zeiger vor dem Klick und Hinweis auf die andere Ecke; Klick setzt nichts", async () => {
    plan = geschossplan([
      rechteck("diele", "Diele", [0, 0], [4200, 3000], {
        nummer: "0.01",
        oeffnungen: { 0: [{ id: "fenster-1", art: "window", offset: 1800, breite: 1000, hoehe: 1200, bruestung: 900 }] },
        geraete: [
          { id: "uv1", typ: "distribution_board", wand: 0, mitte: 500, hoehe: 1400 },
          { id: "sd-diele", typ: "socket_single", wand: 0, mitte: 3000, hoehe: 300 },
        ],
      }),
      KUECHE,
    ]);
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
    geraetKlicken("uv1");
    klicken(3700, 2210);
    fireEvent.keyDown(ansicht(), { key: "k" });
    // Zuerst senkrecht, dann waagerecht auf 150 cm: die Waagerechte liefe durch das Fenster.
    zeiger(ansicht(), "pointermove", 1300, 1500);
    expect(screen.getByTestId("leitung-kandidat")).toHaveAttribute("data-gueltig", "nein");
    expect(screen.getByTestId("leitung-kandidat-text")).toHaveTextContent(/Teilstrecke 2/);
    expect(status(d)).toHaveTextContent(/Nicht möglich/);
    zeiger(ansicht(), "pointerdown", 1300, 1500);
    zeiger(ansicht(), "pointerup", 1300, 1500);
    expect(screen.queryByTestId("wegpunkt-1")).toBeNull();
    // Die andere Ecke (zuerst waagerecht über dem Fenster) ist gültig.
    fireEvent.keyDown(ansicht(), { key: "k" });
    zeiger(ansicht(), "pointermove", 1300, 1500);
    expect(screen.getByTestId("leitung-kandidat")).toHaveAttribute("data-gueltig", "ja");
  });

  it("Bewegung zwischen Drücken und Loslassen setzt nichts; Doppelklick setzt keinen doppelten Punkt und öffnet den Dialog", async () => {
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
    geraetKlicken("uv1");
    zeiger(ansicht(), "pointermove", 3700, 2210);
    zeiger(ansicht(), "pointerdown", 3700, 2210);
    zeiger(ansicht(), "pointermove", 2000, 2210);
    zeiger(ansicht(), "pointerup", 2000, 2210);
    expect(screen.queryByTestId("wegpunkt-0")).toBeNull();
    expect(status(d)).toHaveTextContent("Nicht gesetzt – zum Setzen ohne Bewegung klicken.");
    // Doppelklick: zwei Klicks an derselben Stelle, dann dblclick.
    klicken(3700, 2210);
    zeiger(ansicht(), "pointerdown", 3700, 2210);
    zeiger(ansicht(), "pointerup", 3700, 2210);
    zeiger(ansicht(), "dblclick", 3700, 2210);
    expect(screen.getByTestId("wegpunkt-0")).toBeInTheDocument();
    expect(screen.queryByTestId("wegpunkt-1")).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "Leitung abschließen" });
    expect(within(dialog).getByTestId("leitung-offen")).toBeInTheDocument();
  });
});

describe("Abschlussdialog (L3)", () => {
  it("Ziel öffnet den Dialog: Stromkreis abgeleitet, Vorgaben mit Herkunft, Bedarf getrennt; Speichern mit Herkunft und Basis; Werkzeug bleibt", async () => {
    api.post.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ id: "l9", ...(o.body as object), version: 1 })));
    zeigen();
    const d = await wandOeffnen();
    const dialog = await bisZumDialog(d);
    expect(within(dialog).getByTestId("stromkreis")).toHaveTextContent("UV1 · F3 Steckdosen");
    expect(within(dialog).getByTestId("stromkreis")).toHaveTextContent("aus der Zuordnung des Geräts");
    await waitFor(() => expect(within(dialog).getByLabelText("Typ")).toHaveValue("TEST-A"));
    expect(within(dialog).getByLabelText("Querschnitt")).toHaveValue("1,5");
    expect(within(within(dialog).getByRole("region", { name: "Kabel" })).getByTestId("herkunft")).toHaveTextContent("Vorlage des Gerätetyps (Betriebsstandard)");
    expect(within(within(dialog).getByRole("region", { name: "Reserve" })).getByTestId("herkunft")).toHaveTextContent("Projektvorgabe");
    expect(within(dialog).getByLabelText("Prozentsatz")).toHaveValue("20");
    // 800 + 2 500 + 1 900 = 5 200 Weg; 20 % = 1 040; Zugaben 500 + 200 - gesamt 6 940 mm.
    expect(within(dialog).getByTestId("gesamtbedarf")).toHaveTextContent("Gesamtbedarf 694 cm");
    expect(within(dialog).getByTestId("bedarf-teile")).toHaveTextContent("Weg 520 cm · Reserve 104 cm (20 %) · Zugaben 70 cm");

    fireEvent.click(within(dialog).getByRole("button", { name: "Leitung speichern" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [pfad, o] = api.post.mock.calls[0] as [string, { path: { circuit_id: string }; body: Record<string, unknown> }];
    expect(pfad).toBe("/api/v1/modules/electrical/circuits/{circuit_id}/cables");
    expect(o.path.circuit_id).toBe("f3");
    expect(o.body).toMatchObject({
      start_device_id: "uv1",
      end_device_id: "sd-diele",
      cable_type: "TEST-A",
      conductor_count: 3,
      cross_section_mm2: "1.5",
      start_allowance_mm: 500,
      end_allowance_mm: 200,
      reserve_mode: "percent",
      reserve_percent: "20.00",
      reserve_mm: 0,
      spec_source: "defaults",
      reserve_source: "defaults",
      allowance_source: "defaults",
      defaults_basis: { office_version: 1, project_version: 1, cable_template_id: "vorlage-dose", cable_template_version: 1 },
    });
    expect(o.body).not.toHaveProperty("assign_devices");
    // Gespeichert: Dialog zu, das Werkzeug bleibt für die nächste Leitung.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Leitung abschließen" })).toBeNull());
    expect(within(leiste()).getByText(/1 Startgerät wählen/)).toHaveAttribute("aria-current", "step");
  });

  it("Abweichung, „Vorgabe übernehmen“ und Weiterzeichnen: Escape verliert nichts, das Ziel wird gelöst", async () => {
    zeigen();
    const d = await wandOeffnen();
    const dialog = await bisZumDialog(d);
    await waitFor(() => expect(within(dialog).getByLabelText("Prozentsatz")).toHaveValue("20"));
    const reserve = within(dialog).getByLabelText("Prozentsatz");
    fireEvent.change(reserve, { target: { value: "0" } });
    fireEvent.blur(reserve);
    // 0 % ist ein ausdrücklicher Wert - abweichend, nicht „nicht gesetzt“.
    expect(within(within(dialog).getByRole("region", { name: "Reserve" })).getByTestId("herkunft")).toHaveTextContent("abweichend");
    expect(within(dialog).getByTestId("gesamtbedarf")).toHaveTextContent("Gesamtbedarf 590 cm");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(leiste()).getByText(/2 Verlauf zeichnen \(2\)/)).toBeInTheDocument();
    // Wieder abschließen: die Abweichung ist erhalten; „Vorgabe übernehmen“ setzt zurück.
    fireEvent.keyDown(ansicht(), { key: "Enter" });
    const wieder = await screen.findByRole("dialog", { name: "Leitung abschließen" });
    expect(within(wieder).getByLabelText("Prozentsatz")).toHaveValue("0");
    expect(within(wieder).getByTestId("leitung-offen")).toBeInTheDocument();
    fireEvent.click(within(wieder).getByTestId("vorgabe-reserve"));
    await waitFor(() => expect(within(wieder).getByLabelText("Prozentsatz")).toHaveValue("20"));
  });

  it("offener Abschluss: kein Zielgerät, keine Gesamtmenge, Speichern als unvollständige Leitung", async () => {
    api.post.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ id: "l9", ...(o.body as object), version: 1 })));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
    geraetKlicken("uv1");
    klicken(3700, 2210);
    fireEvent.click(within(leiste()).getByTestId("abschliessen"));
    const dialog = await screen.findByRole("dialog", { name: "Leitung abschließen" });
    expect(within(dialog).getByTestId("leitung-offen")).toHaveTextContent("Offen – kein Zielgerät");
    await waitFor(() => expect(within(dialog).getByTestId("bedarf-teile")).toHaveTextContent("Reserve 20 % erst mit vollständigem Weg"));
    expect(within(dialog).queryByTestId("gesamtbedarf")).toBeNull();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Leitung speichern" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Leitung speichern" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((api.post.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body).toMatchObject({ end_device_id: null, start_device_id: "uv1" });
  });

  it("nicht zugeordnetes Ziel: Zuordnung deutlich, nur ausdrücklich bestätigt - atomar mit Stromkreisversion", async () => {
    kreise = [stromkreis({ device_ids: ["sd-kueche"] })];
    api.post.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ id: "l9", ...(o.body as object), version: 1 })));
    zeigen();
    const d = await wandOeffnen();
    const dialog = await bisZumDialog(d);
    const speichern = within(dialog).getByRole("button", { name: "Leitung speichern" });
    expect(speichern).toBeDisabled();
    expect(within(dialog).getByTestId("speichern-sperrgrund")).toHaveTextContent("Bitte die Zuordnung zum Stromkreis bestätigen.");
    fireEvent.click(within(within(dialog).getByTestId("zuordnen-sd-diele")).getByRole("checkbox"));
    await waitFor(() => expect(speichern).toBeEnabled());
    fireEvent.click(speichern);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((api.post.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body).toMatchObject({ assign_devices: ["sd-diele"], expected_circuit_version: 5 });
  });

  it("ohne circuit.write keine Zuordnung beim Speichern - verständlich gesperrt", async () => {
    rechte.kreis = false;
    kreise = [stromkreis({ device_ids: ["sd-kueche"] })];
    zeigen();
    const d = await wandOeffnen();
    const dialog = await bisZumDialog(d);
    expect(within(within(dialog).getByTestId("zuordnen-sd-diele")).getByRole("checkbox")).toBeDisabled();
    expect(within(dialog).getByText(/fehlt das Recht „Stromkreise bearbeiten“/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Leitung speichern" })).toBeDisabled();
  });

  it("Ziel an einem Stromkreis einer anderen Verteilung: Konflikt, nie umhängen, Speichern gesperrt", async () => {
    kreise = [stromkreis({ device_ids: ["sd-kueche"] }), stromkreis({ id: "f9", designation: "F9", board_id: "board-2", device_ids: ["sd-diele"] })];
    zeigen();
    const d = await wandOeffnen();
    const dialog = await bisZumDialog(d);
    expect(within(dialog).getByTestId("stromkreis-konflikt")).toHaveTextContent(/anderen Verteilung/);
    expect(within(dialog).getByRole("button", { name: "Leitung speichern" })).toBeDisabled();
  });

  it("geänderte Vorgabenbasis: nichts gespeichert, Werte erhalten, bewusste Entscheidung - als Abweichung behalten", async () => {
    api.post
      .mockRejectedValueOnce(problem(409, "planning-defaults-changed", [{ field: "reserve_percent", code: "planning-defaults-changed", message: "Reserve aus Vorgaben jetzt: 25 %." }]))
      .mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ id: "l9", ...(o.body as object), version: 1 })));
    zeigen();
    const d = await wandOeffnen();
    const dialog = await bisZumDialog(d);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Leitung speichern" })).toBeEnabled());
    vorgaben = { reserve: "25.00", basis: { office_version: 2 } };
    fireEvent.click(within(dialog).getByRole("button", { name: "Leitung speichern" }));
    const fehler = await within(dialog).findByTestId("leitung-fehler");
    expect(fehler).toHaveTextContent("Es wurde nichts gespeichert");
    // Die Serverzeilen ersetzt der Vergleich in Anzeigeeinheiten (Browserabnahme L3).
    expect(fehler).not.toHaveTextContent("Reserve aus Vorgaben jetzt");
    expect(await within(fehler).findByTestId("vorgaben-vergleich")).toHaveTextContent("Reserve: bisher 20 %, jetzt 25 %");
    expect(within(dialog).getByLabelText("Prozentsatz")).toHaveValue("20");
    expect(within(dialog).getByRole("button", { name: "Leitung speichern" })).toBeDisabled();
    fireEvent.click(within(fehler).getByRole("button", { name: "Bisherige Werte als Abweichung behalten" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Leitung speichern" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Leitung speichern" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const body = (api.post.mock.calls[1] as [string, { body: Record<string, unknown> }])[1].body;
    expect(body).toMatchObject({ reserve_percent: "20.00", spec_source: "manual", reserve_source: "manual", allowance_source: "manual" });
    expect(body).not.toHaveProperty("defaults_basis");
  });

  it("geänderte Vorgabenbasis: neue Vorgaben bewusst übernehmen", async () => {
    api.post.mockRejectedValueOnce(problem(409, "planning-defaults-changed", [{ field: "reserve_percent", code: "planning-defaults-changed", message: "Reserve aus Vorgaben jetzt: 25 %." }]));
    zeigen();
    const d = await wandOeffnen();
    const dialog = await bisZumDialog(d);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Leitung speichern" })).toBeEnabled());
    vorgaben = { reserve: "25.00", basis: { office_version: 2 } };
    fireEvent.click(within(dialog).getByRole("button", { name: "Leitung speichern" }));
    const fehler = await within(dialog).findByTestId("leitung-fehler");
    fireEvent.click(within(fehler).getByRole("button", { name: "Neue Vorgaben übernehmen" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Prozentsatz")).toHaveValue("25"));
    expect(within(dialog).queryByTestId("leitung-fehler")).toBeNull();
  });

  it("Entwurf verwerfen nur mit Rückfrage - nichts auf dem Server", async () => {
    zeigen();
    const d = await wandOeffnen();
    const dialog = await bisZumDialog(d);
    fireEvent.click(within(dialog).getByRole("button", { name: "Entwurf verwerfen …" }));
    const frage = await screen.findByRole("dialog", { name: "Leitung verwerfen?" });
    fireEvent.click(within(frage).getByRole("button", { name: /verwerfen/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Leitung abschließen" })).toBeNull());
    expect(screen.queryByTestId("zeichenleiste")).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("Bedienungslücken §21.5 – Rückmeldung, Änderungszustand, aktuelle Rechnung", () => {
  const escapeBisWerkzeugEnde = () => {
    for (let i = 0; i < 4 && screen.queryByTestId("zeichenleiste") !== null; i++) fireEvent.keyDown(ansicht(), { key: "Escape" });
  };

  it("die Rückmeldung passt immer zum Zustand: Start, Zeichnen, Dialog, Weiterzeichnen, Escape, Speichern, nächste Leitung", async () => {
    api.post.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ id: "l9", ...(o.body as object), version: 1 })));
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
    expect(status(d)).toHaveTextContent("Startgerät anklicken – markierte Geräte sind möglich.");
    geraetKlicken("uv1");
    await waitFor(() => expect(status(d)).toHaveTextContent("Ersten Punkt setzen oder das Zielgerät anklicken."));
    klicken(3700, 2210);
    expect(status(d)).toHaveTextContent(/Wegpunkt 1 gesetzt – noch nicht gespeichert/);
    geraetKlicken("sd-diele");
    const dialog = await screen.findByRole("dialog", { name: "Leitung abschließen" });
    // Die Meldung der Fläche („Wegpunkt 1 gesetzt“) ist veraltet: Der Schritt ist jetzt der Dialog.
    await waitFor(() => expect(status(d)).toHaveTextContent("Angaben im Dialog prüfen und speichern."));
    fireEvent.click(within(dialog).getByRole("button", { name: "Weiterzeichnen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(status(d)).toHaveTextContent("Weiterzeichnen oder Zielgerät anklicken – Enter schließt offen ab.");
    // Escape beendet das Werkzeug: kein Text des Zeichnens bleibt stehen, der Entwurfsblock nennt den Stand.
    escapeBisWerkzeugEnde();
    expect(screen.queryByTestId("zeichenleiste")).toBeNull();
    expect(status(d)).toHaveTextContent("Eine Öffnung anklicken oder ein Werkzeug wählen.");
    expect(screen.getByTestId("entwurfsleiste-leitung")).toHaveTextContent("Leitungsentwurf: ungespeichert");
    // Weiter und speichern: danach Schritt 1 der nächsten Leitung mit Bestätigung, ohne alte Zeichenmeldung.
    // Weiter am offenen Entwurf (das Panel ist in diesem Aufbau offen - dort führt „Leitung hinzufügen“).
    fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
    expect(within(leiste()).getByText(/2 Verlauf zeichnen \(1\)/)).toBeInTheDocument();
    geraetKlicken("sd-diele");
    const wieder = await screen.findByRole("dialog", { name: "Leitung abschließen" });
    await waitFor(() => expect(within(wieder).getByRole("button", { name: "Leitung speichern" })).toBeEnabled());
    fireEvent.click(within(wieder).getByRole("button", { name: "Leitung speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(status(d)).toHaveTextContent("gespeichert. Startgerät anklicken – markierte Geräte sind möglich."));
    expect(within(leiste()).getByText(/1 Startgerät wählen/)).toHaveAttribute("aria-current", "step");
    expect(leiste()).not.toHaveTextContent("ungespeichert");
  });

  it("leerer Einstieg täuscht keine Bearbeitung vor; sobald ein Startgerät gewählt ist, greifen Markierung und Rückfrage", async () => {
    zeigen();
    const d = await wandOeffnen();
    fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
    expect(leiste()).not.toHaveTextContent("ungespeichert");
    fireEvent.click(within(leiste()).getByTestId("zeichnen-abbrechen"));
    // Keine Verwerfungsrückfrage, kein Entwurf.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("zeichenleiste")).toBeNull();
    expect(screen.queryByTestId("entwurfsleiste-leitung")).toBeNull();
    // Mit Escape ebenso.
    fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
    escapeBisWerkzeugEnde();
    expect(screen.queryByTestId("entwurfsleiste-leitung")).toBeNull();
    // Startgerät gewählt: Das ist eine Eingabe - Markierung und Rückfrage.
    fireEvent.click(within(d).getByRole("button", { name: "Leitung hinzufügen" }));
    geraetKlicken("uv1");
    expect(leiste()).toHaveTextContent("ungespeichert");
    fireEvent.click(within(leiste()).getByTestId("zeichnen-abbrechen"));
    const frage = await screen.findByRole("dialog", { name: "Leitungsentwurf schließen?" });
    fireEvent.click(within(frage).getByRole("button", { name: /behalten/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(leiste()).toHaveTextContent("ab Verteilung");
  });

  it("gültige Zahlen rechnen sofort; leer, „12,“ oder Text sind nie eine stille Null; die letzte Eingabe wird ohne Feldwechsel gespeichert", async () => {
    api.post.mockImplementation((_p: string, o: { body: Record<string, unknown> }) => Promise.resolve(leitung({ id: "l9", ...(o.body as object), version: 1 })));
    zeigen();
    const d = await wandOeffnen();
    const dialog = await bisZumDialog(d);
    await waitFor(() => expect(within(dialog).getByLabelText("Prozentsatz")).toHaveValue("20"));
    const reserve = within(dialog).getByLabelText("Prozentsatz");
    const teile = () => within(dialog).getByTestId("bedarf-teile");
    const speichern = () => within(dialog).getByRole("button", { name: "Leitung speichern" });
    fireEvent.focus(reserve);
    // Gültig: sofort - ohne das Feld zu verlassen. 15 % von 5 200 = 780.
    fireEvent.change(reserve, { target: { value: "15" } });
    expect(teile()).toHaveTextContent("Weg 520 cm · Reserve 78 cm (15 %) · Zugaben 70 cm");
    expect(within(dialog).getByTestId("gesamtbedarf")).toHaveTextContent("Gesamtbedarf 668 cm");
    expect(within(dialog).queryByTestId("ergebnis-veraltet")).toBeNull();
    // Zwischenstände: das Ergebnis ist als nicht aktuell gekennzeichnet, gerechnet bleibt mit 15 % - nie mit 0.
    for (const zwischen of ["", "12,", "zwölf"]) {
      fireEvent.change(reserve, { target: { value: zwischen } });
      expect(within(dialog).getByTestId("ergebnis-veraltet")).toHaveTextContent("„Prozentsatz“");
      expect(within(dialog).getByTestId("leitungsergebnis")).toHaveAttribute("data-veraltet");
      expect(teile()).toHaveTextContent("(15 %)");
      expect(within(dialog).getByTestId("leitungsergebnis")).not.toHaveTextContent("Bestätigt");
      expect(speichern()).toBeDisabled();
      expect(within(dialog).getByTestId("speichern-sperrgrund")).toHaveTextContent("„Prozentsatz“");
    }
    // Komma nach den bestehenden Eingaberegeln: 12,5 % von 5 200 = 650.
    fireEvent.change(reserve, { target: { value: "12,5" } });
    expect(within(dialog).queryByTestId("ergebnis-veraltet")).toBeNull();
    expect(teile()).toHaveTextContent("Reserve 65 cm (12,5 %)");
    // Ebenso die Zugaben.
    const start = within(dialog).getByLabelText("Start");
    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: "60" } });
    expect(teile()).toHaveTextContent("Zugaben 80 cm");
    // Sofort speichern - ohne vorher ein anderes Feld anzuklicken.
    expect(speichern()).toBeEnabled();
    fireEvent.click(speichern());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const body = (api.post.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body;
    expect(body).toMatchObject({ reserve_mode: "percent", reserve_percent: "12.5", reserve_source: "manual", start_allowance_mm: 600, allowance_source: "manual" });
  });

  it("wer wieder beim Vorgabewert ankommt, weicht nicht ab", async () => {
    zeigen();
    const d = await wandOeffnen();
    const dialog = await bisZumDialog(d);
    await waitFor(() => expect(within(dialog).getByLabelText("Prozentsatz")).toHaveValue("20"));
    const reserve = within(dialog).getByLabelText("Prozentsatz");
    const herkunft = () => within(within(dialog).getByRole("region", { name: "Reserve" })).getByTestId("herkunft");
    fireEvent.focus(reserve);
    fireEvent.change(reserve, { target: { value: "2" } });
    expect(herkunft()).toHaveTextContent("abweichend");
    fireEvent.change(reserve, { target: { value: "20" } });
    expect(herkunft()).toHaveTextContent("Projektvorgabe");
  });
});
