import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { TYPEN, vorlage, wirksam } from "../leitung/testdaten";
import { VorgabenDialog } from "./VorgabenDialog";

/**
 * Elektro-Vorgaben (Phase 6c, L3): Kabelvorlagen, Betriebsstandard, Projektvorgabe - über die echte
 * Oberfläche; ersetzt werden nur API und Rechte. Alle Werte synthetisch (`TEST-*`).
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
const rechte = { vorgaben: true };
vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: (p: string) => (p === "electrical.defaults.manage" ? rechte.vorgaben : true),
}));

const { default: VorgabenSeite } = await import("./VorgabenSeite");

const ZEIT = "2026-10-23T08:00:00Z";
const BETRIEB = {
  version: 2,
  reserve_percent: "20.00" as string | null,
  board_allowance_mm: 500 as number | null,
  junction_allowance_mm: null as number | null,
  device_allowance_mm: 0 as number | null,
  default_cable_template_id: null as string | null,
  device_type_templates: [{ device_type_key: "socket_single", cable_template_id: "vorlage-dose" }],
  updated_at: ZEIT,
};
let betrieb = BETRIEB;
let projekt = { ...BETRIEB, version: 0, project_id: "projekt-1", reserve_percent: null, board_allowance_mm: null, device_allowance_mm: null, device_type_templates: [], updated_at: null };

function problem(status: number, typ: string, errors?: unknown[]) {
  return new ApiError(status, { type: `https://elektroplan.internal/errors/${typ}`, title: "Fehler", status, detail: "x", ...(errors ? { errors } : {}) } as never, null);
}

function mit(kind: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <RueckfrageProvider>{kind}</RueckfrageProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  rechte.vorgaben = true;
  betrieb = { ...BETRIEB };
  projekt = { ...projekt, version: 0 };
  api.get.mockImplementation((pfad: string, o?: { query?: Record<string, string> }) => {
    if (pfad.endsWith("/cable-templates")) return Promise.resolve({ templates: [vorlage({ in_use: true }), vorlage({ id: "vorlage-alt", name: "Alt", is_active: false, cable_type: "TEST-B" })] });
    if (pfad.endsWith("/projects/{project_id}/planning-defaults")) return Promise.resolve(projekt);
    if (pfad.endsWith("/effective")) return Promise.resolve(wirksam(o?.query, { reserve: "20.00" }));
    if (pfad.endsWith("/planning-defaults")) return Promise.resolve(betrieb);
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    return Promise.resolve([]);
  });
});

describe("Seite Elektro-Vorgaben", () => {
  it("zeigt Vorlagen und Betriebsstandard; 0 ist ein Wert, NULL „nicht gesetzt“; Löschen nur ungenutzt", async () => {
    mit(<VorgabenSeite />);
    const tabelle = await screen.findByRole("table", { name: "Kabelvorlagen" });
    expect(within(tabelle).getByText("Test Dose")).toBeInTheDocument();
    expect(within(screen.getByTestId("vorlage-vorlage-dose")).getByText("in Verwendung")).toBeInTheDocument();
    // Genutzt: kein Entfernen, nur Deaktivieren.
    expect(within(screen.getByTestId("vorlage-vorlage-dose")).queryByRole("button", { name: "Entfernen" })).toBeNull();
    expect(within(screen.getByTestId("vorlage-vorlage-alt")).getByRole("button", { name: "Aktivieren" })).toBeInTheDocument();
    const standard = await screen.findByTestId("betriebsstandard");
    expect(standard).toHaveTextContent("Reserve20 %");
    expect(standard).toHaveTextContent("Zugabe an einer Abzweigdosenicht gesetzt");
    expect(standard).toHaveTextContent("Zugabe an einem Gerät0 cm");
    expect(standard).toHaveTextContent("Gerätetyp SteckdoseTest Dose – TEST-A 3 × 1,5 mm²");
  });

  it("ohne Verwaltungsrecht nur ansehen", async () => {
    rechte.vorgaben = false;
    mit(<VorgabenSeite />);
    await screen.findByRole("table", { name: "Kabelvorlagen" });
    expect(screen.getByTestId("vorgaben-nur-lesen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kabelvorlage anlegen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bearbeiten" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Betriebsstandard ansehen" }));
    const dialog = await screen.findByRole("dialog", { name: "Betriebsstandard für neue Leitungen" });
    expect(within(dialog).queryByRole("button", { name: "Vorgaben speichern" })).toBeNull();
  });

  it("Vorlage anlegen im Dialog - technische Felder, kein Preis", async () => {
    api.post.mockResolvedValue(vorlage({ id: "neu", name: "Test Schalter" }));
    mit(<VorgabenSeite />);
    fireEvent.click(await screen.findByRole("button", { name: "Kabelvorlage anlegen" }));
    const dialog = await screen.findByRole("dialog", { name: "Kabelvorlage anlegen" });
    expect(within(dialog).queryByLabelText(/Preis/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Test Schalter" } });
    fireEvent.change(within(dialog).getByLabelText(/^Leitungstyp/), { target: { value: "TEST-C" } });
    fireEvent.change(within(dialog).getByLabelText(/^Leiteranzahl/), { target: { value: "5" } });
    fireEvent.change(within(dialog).getByLabelText(/^Querschnitt/), { target: { value: "1,5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith("/api/v1/modules/electrical/cable-templates", {
      body: { name: "Test Schalter", cable_type: "TEST-C", conductor_count: 5, cross_section_mm2: "1.5", is_active: true, sort_order: 0 },
    });
  });

  it("Betriebsstandard: Versionskonflikt behält die Eingaben; Serverstand nur auf Wunsch", async () => {
    api.put.mockRejectedValueOnce(problem(409, "version-conflict"));
    mit(<VorgabenSeite />);
    fireEvent.click(await screen.findByRole("button", { name: "Betriebsstandard bearbeiten" }));
    const dialog = await screen.findByRole("dialog", { name: "Betriebsstandard für neue Leitungen" });
    const reserve = await within(dialog).findByLabelText("Reserve in % der geometrischen Länge (%)");
    expect(reserve).toHaveValue("20");
    fireEvent.change(reserve, { target: { value: "25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Vorgaben speichern" }));
    expect(await within(dialog).findByTestId("vorgaben-meldung")).toHaveTextContent(/inzwischen an anderer Stelle geändert/);
    expect(api.put.mock.calls[0]?.[1]).toMatchObject({ body: { expected_version: 2, reserve_percent: "25", device_allowance_mm: 0, junction_allowance_mm: null } });
    expect(reserve).toHaveValue("25");
    betrieb = { ...betrieb, version: 3, reserve_percent: "15.00" };
    fireEvent.click(within(dialog).getByRole("button", { name: "Serverstand laden (Eingaben verwerfen)" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Reserve in % der geometrischen Länge (%)")).toHaveValue("15"));
  });
});

describe("Planungsvorgaben des Projekts", () => {
  it("Betriebsstandard übernehmen oder abweichen - wirksamer Wert mit Herkunft; 0 % ausdrücklich", async () => {
    api.put.mockResolvedValue({ ...projekt, version: 1 });
    mit(<VorgabenDialog modus="projekt" projektId="projekt-1" darfSchreiben sperrgrund={null} onClose={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: "Planungsvorgaben des Projekts" });
    const reserve = await within(dialog).findByTestId("vorgabe-reserve");
    expect(within(reserve).getByRole("radio", { name: /Betriebsstandard übernehmen/ })).toBeChecked();
    expect(reserve).toHaveTextContent("Betriebsstandard übernehmen(20 %)");
    expect(reserve).toHaveTextContent("Wirksam im Projekt: 20 % (Projektvorgabe)");
    fireEvent.change(within(reserve).getByLabelText("Reserve in % der geometrischen Länge (%)"), { target: { value: "0" } });
    expect(within(reserve).getByRole("radio", { name: /abweichender Projektwert/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Vorgaben speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0]?.[0]).toBe("/api/v1/modules/electrical/projects/{project_id}/planning-defaults");
    expect(api.put.mock.calls[0]?.[1]).toMatchObject({ path: { project_id: "projekt-1" }, body: { expected_version: 0, reserve_percent: "0", board_allowance_mm: null } });
  });

  it("abgeschlossenes oder archiviertes Projekt: nur lesen, mit Grund", async () => {
    mit(<VorgabenDialog modus="projekt" projektId="projekt-1" darfSchreiben={false} sperrgrund="Das Projekt ist abgeschlossen – die Projektvorgaben sind nur lesbar." onClose={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: "Planungsvorgaben des Projekts" });
    expect(within(dialog).getByTestId("vorgaben-nur-lesen")).toHaveTextContent("abgeschlossen");
    await within(dialog).findByTestId("vorgabe-reserve");
    expect(within(dialog).queryByRole("button", { name: "Vorgaben speichern" })).toBeNull();
    for (const radio of within(dialog).getAllByRole("radio")) expect(radio).toBeDisabled();
  });
});
