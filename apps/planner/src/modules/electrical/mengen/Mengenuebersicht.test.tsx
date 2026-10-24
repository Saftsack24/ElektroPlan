import { ApiError } from "@elektroplan/api-client";
import type { components } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { GESCHOSS, TYPEN, VERTEILUNG, geschossplan, leitung, stromkreis } from "../leitung/testdaten";
import { angabenText, fehlendText, gruppenName } from "./daten";
import { eigenschaftenOeffnen } from "../arbeitsflaeche/testhilfe";

/**
 * Mengenübersicht (Phase 6b.6) über den echten Tab. Die Mengen rechnet der Server
 * (`cabling-summary`) - hier geprüft: Anzeige, Einheiten, Zustände, Aufschlüsselung,
 * Wechsel in die Bearbeitung und zurück, Entwurfsschutz, Sitzungswechsel.
 */
type Summary = components["schemas"]["CablingSummaryOut"];

const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }), usePermission: () => true }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const eimer = (count = 0, geometric = 0, allowance = 0, ids: string[] = []) => ({
  count,
  geometric_mm: geometric,
  allowance_mm: allowance,
  connection_allowance_mm: allowance,
  reserve_mm: 0,
  reserve_pending_count: 0,
  total_mm: geometric + allowance,
  cable_ids: ids,
});

const L1 = leitung({ id: "l1", label: "L1" });
const L4 = leitung({ id: "l4", label: "L4", cross_section_mm2: null, spec_complete: false, length_mm: 1_800, known_mm: 1_800, geometric_mm: 1_800, allowance_mm: 0 });
const L5 = leitung({ id: "l5", label: "L5", status: "incomplete", length_mm: null, known_mm: 1_200, geometric_mm: 1_200, allowance_mm: 0, problems: [{ code: "route-not-reaching-end", kind: "missing", ref: "end", message: "Der Weg erreicht das Endgerät nicht." }] });

function zeile(c: components["schemas"]["CableOut"], missing: ("cable_type" | "conductor_count" | "cross_section_mm2")[] = []) {
  return {
    id: c.id,
    circuit_id: c.circuit_id,
    label: c.label,
    start_device_id: c.start_device_id,
    end_device_id: c.end_device_id,
    cable_type: c.cable_type,
    conductor_count: c.conductor_count,
    cross_section_mm2: c.cross_section_mm2,
    missing_spec: missing,
    status: c.status,
    geometric_mm: c.geometric_mm,
    allowance_mm: c.allowance_mm,
    connection_allowance_mm: c.connection_allowance_mm,
    reserve_mode: c.reserve_mode,
    reserve_percent: c.reserve_percent,
    reserve_effective_mm: c.reserve_effective_mm,
    reserve_pending: c.reserve_pending,
    spec_origin: c.spec_origin,
    reserve_origin: c.reserve_origin,
    allowance_origin: c.allowance_origin,
    length_mm: c.length_mm,
    known_mm: c.known_mm,
    problem_codes: c.problems.map((p) => p.code),
  };
}

const SUMMARY: Summary = {
  building_id: "gebaeude-1",
  building_name: "Hauptgebäude",
  project_status: "active",
  groups: [
    {
      cable_type: "NYM-J",
      conductor_count: 3,
      cross_section_mm2: "1.50",
      confirmed: eimer(1, 8_500, 700, ["l1"]),
      incomplete: eimer(1, 1_200, 0, ["l5"]),
      conflict: eimer(),
    },
  ],
  totals: { confirmed: eimer(1, 8_500, 700, ["l1"]), incomplete: eimer(1, 1_200, 0, ["l5"]), conflict: eimer() },
  unspecified: [zeile(L4, ["cross_section_mm2"])],
  cables: [zeile(L1), zeile(L4, ["cross_section_mm2"]), zeile(L5)],
  surfaces: [
    { surface: "wall", confirmed_trace_mm: 4_000, confirmed_cable_mm: 10_000, all_trace_mm: 4_000, all_cable_mm: 11_200, confirmed_complete: true, all_complete: true },
    { surface: "ceiling", confirmed_trace_mm: 0, confirmed_cable_mm: 0, all_trace_mm: 0, all_cable_mm: 0, confirmed_complete: true, all_complete: true },
    { surface: "floor", confirmed_trace_mm: 1_500, confirmed_cable_mm: 1_500, all_trace_mm: 1_500, all_cable_mm: 1_500, confirmed_complete: true, all_complete: true },
    { surface: "riser", confirmed_trace_mm: 750, confirmed_cable_mm: 750, all_trace_mm: 750, all_cable_mm: 750, confirmed_complete: false, all_complete: false },
    { surface: "shaft", confirmed_trace_mm: 0, confirmed_cable_mm: 0, all_trace_mm: 0, all_cable_mm: 0, confirmed_complete: true, all_complete: true },
  ],
  penetrations: [
    { id: "d1", used: true, cable_ids: ["l1", "l4"], problem_code: null },
    { id: "d2", used: false, cable_ids: [], problem_code: null },
  ],
  crossings: [{ opening_id: "t1", wall_id: "diele-w1", cable_ids: ["l1", "l5"], uses: 2 }],
  circuits: [{ circuit_id: "f3", board_id: "board-1", designation: "F3", name: "Steckdosen", by_type: [{ type_key: "socket_single", label: "Steckdose", count: 2 }], device_ids: ["sd-diele", "sd-kueche"], devices_without_cable: ["sd-diele"] }],
  unassigned_device_ids: [],
};

let antwort: () => Promise<unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  window.localStorage.setItem("elektroplan.electrical.ansicht", "mengen");
  antwort = () => Promise.resolve(SUMMARY);
  api.get.mockImplementation((pfad: string) => {
    if (pfad.endsWith("/cabling-summary")) return antwort();
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve([GESCHOSS]);
    if (pfad.endsWith("/plan")) return Promise.resolve(geschossplan());
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    if (pfad.endsWith("/distribution-boards")) return Promise.resolve({ building_id: "gebaeude-1", boards: [VERTEILUNG] });
    if (pfad.endsWith("/circuits")) return Promise.resolve({ building_id: "gebaeude-1", circuits: [stromkreis()] });
    if (pfad.endsWith("/cables")) return Promise.resolve({ building_id: "gebaeude-1", cables: [L1, L4, L5] });
    if (pfad.endsWith("/penetrations")) return Promise.resolve({ floor_id: "geschoss-1", penetrations: [] });
    if (pfad.endsWith("/risers")) return Promise.resolve({ building_id: "gebaeude-1", risers: [] });
    return Promise.resolve([]);
  });
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function zeigen(c = client()) {
  return render(
    <QueryClientProvider client={c}>
      <RueckfrageProvider>
        <RoomsTab />
      </RueckfrageProvider>
    </QueryClientProvider>,
  );
}

describe("Texte", () => {
  it("Gruppenname, fehlende Angaben konkret, vorhandene Angaben ohne erfundenen Wert", () => {
    expect(gruppenName({ cable_type: "NYM-J", conductor_count: 3, cross_section_mm2: "1.50" })).toBe("NYM-J 3 × 1,5 mm²");
    expect(fehlendText(["cross_section_mm2"])).toBe("Querschnitt fehlt");
    expect(fehlendText(["cable_type", "conductor_count", "cross_section_mm2"])).toBe("Leitungstyp, Leiterzahl und Querschnitt fehlen");
    expect(angabenText({ cable_type: "NYM-J", conductor_count: 3, cross_section_mm2: null })).toBe("NYM-J · 3 Leiter · – mm²");
  });
});

describe("Mengenübersicht", () => {
  it("Prozentreserve (Phase 6c V1): getrennt ausgewiesen, nie doppelt, offen ohne Wert", async () => {
    const mitReserve = { ...eimer(1, 8_500, 2_400, ["l1"]), connection_allowance_mm: 700, reserve_mm: 1_700 };
    const offen = { ...eimer(1, 1_200, 0, ["l5"]), reserve_pending_count: 1 };
    const l1 = { ...zeile(L1), reserve_mode: "percent" as const, reserve_percent: "20", reserve_effective_mm: 1_700, allowance_mm: 2_400, length_mm: 10_900, known_mm: 10_900 };
    const l5 = { ...zeile(L5), reserve_mode: "percent" as const, reserve_percent: "20", reserve_effective_mm: null, reserve_pending: true };
    antwort = () =>
      Promise.resolve({
        ...SUMMARY,
        groups: [{ ...SUMMARY.groups[0], confirmed: mitReserve, incomplete: offen }],
        totals: { ...SUMMARY.totals, confirmed: mitReserve, incomplete: offen },
        cables: [l1, zeile(L4, ["cross_section_mm2"]), l5],
      });
    zeigen();
    const gruppe = await screen.findByTestId("mengen-gruppe-NYM-J 3 × 1,5 mm²");
    // 8 500 + 700 + 1 700 = 10 900: die Reserve ist Teil der Summe, nicht zusätzlich.
    expect(gruppe).toHaveTextContent("1.090 cm");
    expect(gruppe).toHaveTextContent("Weg 850 cm + Zugaben 70 cm + Reserve 170 cm");
    expect(gruppe).toHaveTextContent("Prozentreserve offen bei 1");
    fireEvent.click(within(gruppe).getByRole("button", { name: /^Zeigen/ }));
    expect(screen.getAllByTestId("mengen-leitung-l1")[0]).toHaveTextContent("davon Reserve 20 %");
    expect(screen.getAllByTestId("mengen-leitung-l5")[0]).toHaveTextContent("Reserve 20 % offen");
  });

  it("zeigt Gruppen, getrennte Status, fehlende Angaben, Trassen, Stückzahlen - mit Bezug zum gespeicherten Stand", async () => {
    zeigen();
    const uebersicht = await screen.findByTestId("mengenuebersicht");
    expect(within(uebersicht).getByRole("heading", { name: "Mengenübersicht · Gebäude „Hauptgebäude“" })).toBeInTheDocument();
    expect(uebersicht).toHaveTextContent("Gespeicherter Planungsstand");
    const gruppe = screen.getByTestId("mengen-gruppe-NYM-J 3 × 1,5 mm²");
    // Bestätigt 920 cm aus Weg und Zugaben; offen ausdrücklich als Teilsumme, nie addiert.
    expect(gruppe).toHaveTextContent("920 cm");
    expect(gruppe).toHaveTextContent("1 Leitung · Weg 850 cm + Zugaben 70 cm");
    expect(gruppe).toHaveTextContent("Teilsumme 120 cm");
    // Unvollständig angegeben: konkret benannt, keiner Gruppe zugeschlagen.
    const fehlend = screen.getByRole("list", { name: "Leitungen mit fehlenden Angaben" });
    expect(fehlend).toHaveTextContent("L4");
    expect(fehlend).toHaveTextContent("Querschnitt fehlt");
    expect(fehlend).toHaveTextContent("NYM-J · 3 Leiter · – mm²");
    // Zu klären mit Befundtext.
    expect(screen.getByRole("list", { name: "Leitungen zu klären" })).toHaveTextContent(/L5.*Endgerät/);
    // Trassen: Wand bestätigt 4 000 / 10 000, vorläufig zusätzlich; Steigweg nur bekannter Teil.
    expect(screen.getByTestId("mengen-flaeche-wall")).toHaveTextContent("400 cm1.000 cm400 cm1.120 cm");
    expect(screen.getByTestId("mengen-flaeche-riser")).toHaveTextContent("nur bekannter Teil");
    // Stückzahlen und Nutzungen klar getrennt.
    expect(screen.getByTestId("mengen-durchfuehrungen")).toHaveTextContent("2 Stück · genutzt 1 · ungenutzt 1");
    expect(screen.getByTestId("mengen-bodenuebergaenge")).toHaveTextContent("2 Nutzungen an 1 Öffnung");
    expect(screen.getByTestId("mengen-bodenuebergaenge")).toHaveTextContent("kein Bauteil und keine Stückzahl");
    expect(screen.getByTestId("mengen-kreis-F3")).toHaveTextContent("2 × Steckdose");
    expect(screen.getByTestId("mengen-nicht-zugeordnet")).toHaveTextContent("0 Stück");
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("Einheiten: mm und m aus der persönlichen Einstellung; Querschnitt bleibt mm²", async () => {
    act(() => masseinheitSetzen("mm"));
    const { unmount } = zeigen();
    expect(await screen.findByTestId("mengen-gruppe-NYM-J 3 × 1,5 mm²")).toHaveTextContent("9.200 mm");
    unmount();
    act(() => masseinheitSetzen("m"));
    zeigen();
    expect(await screen.findByTestId("mengen-gruppe-NYM-J 3 × 1,5 mm²")).toHaveTextContent("9,200 m");
  });

  it("Laden und Fehler: nie „0“ statt einer Aussage; erneut laden möglich", async () => {
    let fertig: (wert: unknown) => void = () => undefined;
    antwort = () => new Promise((resolve) => (fertig = resolve));
    zeigen();
    expect(await screen.findByText("Mengen werden geladen …")).toBeInTheDocument();
    await act(async () => {
      fertig(SUMMARY);
      await Promise.resolve();
    });
    expect(await screen.findByTestId("mengenuebersicht")).toBeInTheDocument();
  });

  it("Fehlerzustand zeigt keine Mengen", async () => {
    antwort = () => Promise.reject(new ApiError(500, { type: "about:blank", title: "Fehler", status: 500 }, null));
    zeigen();
    expect(await screen.findByRole("alert")).toHaveTextContent("Die Mengenübersicht konnte nicht geladen werden. Es werden keine Mengen angezeigt.");
    expect(screen.queryByTestId("mengenuebersicht")).toBeNull();
    expect(screen.queryByText(/0 cm/)).toBeNull();
    antwort = () => Promise.resolve(SUMMARY);
    fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));
    expect(await screen.findByTestId("mengenuebersicht")).toBeInTheDocument();
  });

  it("Aufschlüsselung bis zur Leitung, Bearbeiten im Grundriss und Rückkehr mit aufgeklappter Gruppe", async () => {
    zeigen();
    const gruppe = await screen.findByTestId("mengen-gruppe-NYM-J 3 × 1,5 mm²");
    fireEvent.click(within(gruppe).getByRole("button", { name: "Zeigen (2)" }));
    const liste = screen.getByRole("list", { name: "Leitungen der Gruppe NYM-J 3 × 1,5 mm²" });
    expect(within(liste).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(within(screen.getByTestId("mengen-leitung-l1")).getByRole("button", { name: "Bearbeiten" }));
    // Grundriss mit geöffnetem Entwurf und Werkzeug „Leitung“ - nichts gespeichert.
    await screen.findByRole("application", { name: /Grundriss/ });
    expect(within(await screen.findByTestId("zeichenleiste")).getByRole("button", { name: "Zurück zur Mengenübersicht" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leitung hinzufügen" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("zeichenleiste")).toHaveTextContent("Verlauf bearbeiten");
    // Angaben und Wegpunkte des Entwurfs stehen im Eigenschaftenpanel (6c.0).
    await eigenschaftenOeffnen();
    expect(screen.getByRole("region", { name: "Leitungsentwurf" })).toHaveTextContent("Leitung L1");
    fireEvent.click(screen.getByRole("button", { name: "Zurück zur Mengenübersicht" }));
    // Zurück: Gruppe weiter aufgeklappt; der offene Entwurf ist benannt und bleibt erhalten.
    expect(await screen.findByRole("list", { name: "Leitungen der Gruppe NYM-J 3 × 1,5 mm²" })).toBeInTheDocument();
    expect(screen.getByTestId("mengen-entwurf")).toHaveTextContent("Ein Leitungsentwurf ist offen");
    // Eine andere Leitung lässt sich jetzt nicht öffnen - nie still einen Entwurf verwerfen.
    expect(within(screen.getByRole("list", { name: "Leitungen der Gruppe NYM-J 3 × 1,5 mm²" })).getByText(/Ein anderer Leitungsentwurf ist offen/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("nach einem Sitzungswechsel kehren keine alten Mengen zurück", async () => {
    const erste = zeigen();
    expect(await screen.findByTestId("mengen-gruppe-NYM-J 3 × 1,5 mm²")).toBeInTheDocument();
    erste.unmount();
    // Neue Sitzung (eigener Query-Client), der Server antwortet nun mit einem Fehler.
    antwort = () => Promise.reject(new ApiError(500, { type: "about:blank", title: "Fehler", status: 500 }, null));
    zeigen(client());
    expect(await screen.findByRole("alert")).toHaveTextContent("konnte nicht geladen werden");
    expect(screen.queryByTestId("mengen-gruppe-NYM-J 3 × 1,5 mm²")).toBeNull();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });
});
