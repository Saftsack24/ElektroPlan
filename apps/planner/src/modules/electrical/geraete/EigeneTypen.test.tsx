import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { vorlage } from "../leitung/testdaten";
import type { Katalogmodus } from "./Geraetekatalog";
import type { Geraetetyp } from "./katalog";
import { katalogAbfrage, typenNachSchluessel } from "./katalog";

/**
 * Eigene Gerätetypen (Phase 6c, K2, ADR 0030) über die echte Oberfläche: Anlegen im
 * Katalogdialog, Rückkehr mit gewähltem und fokussiertem Typ, Entwurf bei „Abbrechen“,
 * Typwechsel eines Geräts, deaktivierte Typen, Bestandsschutz und „Als neuen Typ anlegen“ auf
 * „Elektro-Vorgaben“, Vorlagenzuordnung und Rechte. Ersetzt werden nur API und Rechte; alle
 * Werte synthetisch.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
const rechte = { typen: true };
vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: (p: string) => (p === "electrical.device_types.manage" ? rechte.typen : true),
}));

const { Geraetekatalog } = await import("./Geraetekatalog");
const { default: VorgabenSeite } = await import("../vorgaben/VorgabenSeite");

const typ = (key: string, label: string, category: Geraetetyp["category"], teile: Partial<Geraetetyp> = {}): Geraetetyp => ({
  key,
  origin: "system",
  label,
  description: null,
  category,
  symbol_key: key,
  allows_wall_interior: true,
  allows_wall_exterior: false,
  allows_ceiling: false,
  default_center_height_mm: 300,
  width_mm: 80,
  height_mm: 80,
  sort_order: 10,
  is_active: true,
  version: 1,
  device_count: 0,
  template_count: 0,
  ...teile,
});
const HERD_KEY = `c_${"a".repeat(32)}`;
const NEU_KEY = `c_${"b".repeat(32)}`;
const eigen = (key: string, label: string, teile: Partial<Geraetetyp> = {}) =>
  typ(key, label, "connection", { origin: "organization", symbol_key: "connection_outlet", sort_order: 1000, version: 3, ...teile });
const SYSTEM = [
  typ("socket_single", "Steckdose", "socket", { sort_order: 10 }),
  typ("switch_single", "Ausschalter", "switch", { sort_order: 30, default_center_height_mm: 1050 }),
  typ("distribution_board", "Verteilung", "distribution", { sort_order: 90 }),
];

let katalog: Geraetetyp[] = [];
const BETRIEB = {
  version: 2,
  reserve_percent: null,
  board_allowance_mm: null,
  junction_allowance_mm: null,
  device_allowance_mm: null,
  default_cable_template_id: null,
  device_type_templates: [{ device_type_key: HERD_KEY, cable_template_id: "vorlage-dose" }],
  updated_at: "2026-10-25T08:00:00Z",
};

function mit(kind: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <RueckfrageProvider>{kind}</RueckfrageProvider>
    </QueryClientProvider>,
  );
}

/** Katalog wie in den Ansichten: aus der Abfrage – ein neuer Typ kommt ohne Neuladen an. */
function KatalogMitAbfrage({ modus, onWahl }: { modus: Katalogmodus; onWahl: (key: string) => string | undefined }) {
  const abfrage = useQuery(katalogAbfrage(api as never));
  const typen = useMemo(() => typenNachSchluessel(abfrage.data), [abfrage.data]);
  if (abfrage.data === undefined) return null;
  return <Geraetekatalog typen={typen} modus={modus} onWahl={onWahl} onClose={() => undefined} typAnlegen={rechte.typen} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  rechte.typen = true;
  katalog = [...SYSTEM];
  api.get.mockImplementation((pfad: string) => {
    if (pfad.endsWith("/device-types")) return Promise.resolve(katalog.map((t) => ({ ...t })));
    if (pfad.endsWith("/cable-templates")) return Promise.resolve({ templates: [vorlage()] });
    if (pfad.endsWith("/planning-defaults")) return Promise.resolve(BETRIEB);
    return Promise.resolve([]);
  });
});

const kachel = (key: string) => screen.getByTestId(`katalog-kachel-${key}`);

/** Körper des (einzigen) `POST /device-types`. */
function anlage(): Record<string, unknown> {
  const [pfad, optionen] = api.post.mock.calls[0] as [string, { body: Record<string, unknown> }];
  expect(pfad).toBe("/api/v1/modules/electrical/device-types");
  return optionen.body;
}

describe("Eigenen Typ im Katalogdialog anlegen (K2)", () => {
  it("Abbrechen behält Auswahl und Entwurf; nach dem Speichern ist der neue Typ gewählt und fokussiert", async () => {
    api.post.mockImplementation((_pfad: string, { body }: { body: Partial<Geraetetyp> }) => {
      const neu = eigen(NEU_KEY, body.label ?? "", { ...body, version: 1 });
      katalog = [...katalog, neu];
      return Promise.resolve(neu);
    });
    const onWahl = vi.fn(() => undefined as string | undefined);
    mit(<KatalogMitAbfrage modus={{ art: "platzieren", flaeche: "wall_interior", start: null }} onWahl={onWahl} />);
    fireEvent.click(await screen.findByTestId("katalog-kachel-switch_single"));
    expect(kachel("switch_single")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Eigenen Typ anlegen …" }));
    let dialog = screen.getByRole("dialog", { name: "Eigenen Gerätetyp anlegen" });
    // Die Fläche des Katalogs ist vorbelegt; die Verteilung ist keine Kategorie eigener Typen.
    expect(within(dialog).getByLabelText("Wand innen")).toBeChecked();
    expect(within(dialog).queryByRole("option", { name: "Verteilungen" })).toBeNull();
    expect(within(dialog).queryByTestId("typ-symbol-distribution_board")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Herdanschluss" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));

    expect(screen.getByRole("dialog", { name: "Gerät auswählen" })).toBeInTheDocument();
    expect(kachel("switch_single")).toHaveAttribute("aria-checked", "true");
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Eigenen Typ anlegen …" }));
    dialog = screen.getByRole("dialog", { name: "Eigenen Gerätetyp anlegen" });
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Herdanschluss");
    fireEvent.change(within(dialog).getByLabelText(/^Kategorie/), { target: { value: "connection" } });
    // Das Symbol folgt der Kategorie.
    expect(within(dialog).getByTestId("typ-symbol-connection_outlet")).toHaveAttribute("aria-checked", "true");
    fireEvent.change(within(dialog).getByLabelText(/^Planungsmaß Breite/), { target: { value: "8" } });
    fireEvent.change(within(dialog).getByLabelText(/^Planungsmaß Höhe/), { target: { value: "8" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Typ anlegen" }));

    await waitFor(() => expect(kachel(NEU_KEY)).toHaveFocus());
    expect(anlage()).toMatchObject({ label: "Herdanschluss", category: "connection", symbol_key: "connection_outlet", width_mm: 80, height_mm: 80, allows_wall_interior: true });
    expect(kachel(NEU_KEY)).toHaveAttribute("aria-checked", "true");
    expect(kachel(NEU_KEY)).toHaveTextContent("eigen");
    expect(screen.getByTestId("katalog-neu")).toHaveTextContent("„Herdanschluss“ angelegt und ausgewählt.");
    expect(screen.getByTestId("katalog-details")).toHaveTextContent("eigener Typ");
    fireEvent.click(screen.getByRole("button", { name: "Platzieren" }));
    expect(onWahl).toHaveBeenCalledWith(NEU_KEY);
  });

  it("ohne Recht kein „Eigenen Typ anlegen …“", async () => {
    rechte.typen = false;
    mit(<KatalogMitAbfrage modus={{ art: "platzieren", flaeche: null, start: null }} onWahl={() => undefined} />);
    await screen.findByTestId("katalog-kachel-socket_single");
    expect(screen.queryByRole("button", { name: "Eigenen Typ anlegen …" })).toBeNull();
  });

  it("Typ ändern: ein Gerät erhält einen eigenen Typ; Systemtypen sind als solche erkennbar", async () => {
    katalog = [...SYSTEM, eigen(HERD_KEY, "Herdanschluss")];
    const onWahl = vi.fn(() => undefined as string | undefined);
    mit(<KatalogMitAbfrage modus={{ art: "typ", flaeche: "wall_interior", aktuell: "socket_single" }} onWahl={onWahl} />);
    expect(await screen.findByTestId("katalog-details")).toHaveTextContent("Systemtyp");
    fireEvent.click(kachel(HERD_KEY));
    expect(screen.getByTestId("katalog-details")).toHaveTextContent("Geräteanschluss/Festanschluss");
    fireEvent.click(screen.getByRole("button", { name: "Typ übernehmen" }));
    expect(onWahl).toHaveBeenCalledWith(HERD_KEY);
  });

  it("deaktivierter eigener Typ: nicht neu platzierbar, am vorhandenen Gerät lesbar", async () => {
    katalog = [...SYSTEM, eigen(HERD_KEY, "Herdanschluss", { is_active: false, device_count: 1 })];
    const ansicht = mit(<KatalogMitAbfrage modus={{ art: "platzieren", flaeche: "wall_interior", start: null }} onWahl={() => undefined} />);
    await screen.findByTestId("katalog-kachel-socket_single");
    expect(screen.queryByTestId(`katalog-kachel-${HERD_KEY}`)).toBeNull();
    ansicht.unmount();

    mit(<KatalogMitAbfrage modus={{ art: "typ", flaeche: "wall_interior", aktuell: HERD_KEY }} onWahl={() => undefined} />);
    expect(await screen.findByTestId(`katalog-kachel-${HERD_KEY}`)).toHaveTextContent("nicht mehr angeboten");
    expect(screen.getByTestId("katalog-details")).toHaveTextContent("Bestand: Das Gerät behält diesen Typ");
    expect(screen.getByRole("button", { name: "Typ übernehmen" })).toBeDisabled();
  });
});

describe("Gerätetypen auf „Elektro-Vorgaben“ (K2)", () => {
  beforeEach(() => {
    katalog = [...SYSTEM, eigen(HERD_KEY, "Herdanschluss", { device_count: 2, template_count: 1 }), eigen(NEU_KEY, "Rollladen", { version: 1 })];
  });

  it("listet eigene Typen mit Verwendung; Entfernen nur unbenutzt; Systemtypen nicht änderbar", async () => {
    mit(<VorgabenSeite />);
    const tabelle = await screen.findByRole("table", { name: "Eigene Gerätetypen" });
    const herd = within(tabelle).getByTestId("geraetetyp-Herdanschluss");
    expect(herd).toHaveTextContent("verwendet: 2 Geräte, 1 Kabelvorlagen-Zuordnung");
    expect(within(herd).queryByRole("button", { name: "Entfernen" })).toBeNull();
    expect(within(within(tabelle).getByTestId("geraetetyp-Rollladen")).getByRole("button", { name: "Entfernen" })).toBeInTheDocument();
    // Technische Schlüssel erscheinen nie als Bezeichnung.
    expect(screen.queryByText(HERD_KEY)).toBeNull();
    expect(screen.getByText(/Systemtypen von ElektroPlan \(2\)/)).toBeInTheDocument();
    // Vorlage je Gerätetyp: der eigene, aktive Typ ist dabei und markiert.
    expect(await screen.findByTestId("betriebsstandard")).toHaveTextContent("Gerätetyp Herdanschluss (eigen)Test Dose");
  });

  it("verwendeter Typ: Kategorie und Maß gesperrt; Symbolwechsel nur nach Rückfrage mit Geräteanzahl", async () => {
    api.patch.mockResolvedValue(eigen(HERD_KEY, "Herdanschluss", { symbol_key: "socket_single", version: 4 }));
    mit(<VorgabenSeite />);
    const herd = await screen.findByTestId("geraetetyp-Herdanschluss");
    fireEvent.click(within(herd).getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Gerätetyp bearbeiten" });
    expect(within(dialog).getByTestId("typ-bestandsschutz")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Kategorie/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/^Planungsmaß Breite/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/^Planungsmaß Höhe/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/^Name/)).toBeEnabled();

    fireEvent.click(within(dialog).getByTestId("typ-symbol-socket_single"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    const frage = await screen.findByRole("dialog", { name: "Symbol ändern?" });
    expect(frage).toHaveTextContent("allen 2 vorhandenen Geräten");
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent.click(within(frage).getByRole("button", { name: "Symbol für 2 Geräte ändern" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/v1/modules/electrical/device-types/{key}", { path: { key: HERD_KEY }, ifMatch: 3, body: { symbol_key: "socket_single" } }),
    );
  });

  it("„Als neuen Typ anlegen“: alle Felder frei, der verwendete Typ bleibt unverändert", async () => {
    api.post.mockResolvedValue(eigen(`c_${"c".repeat(32)}`, "Herdanschluss groß"));
    mit(<VorgabenSeite />);
    const herd = await screen.findByTestId("geraetetyp-Herdanschluss");
    fireEvent.click(within(herd).getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Gerätetyp bearbeiten" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Als neuen Typ anlegen" }));
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Herdanschluss (Variante)");
    expect(within(dialog).getByLabelText(/^Planungsmaß Breite/)).toBeEnabled();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: "Herdanschluss groß" } });
    fireEvent.change(within(dialog).getByLabelText(/^Planungsmaß Breite/), { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Typ anlegen" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(anlage()).toMatchObject({ label: "Herdanschluss groß", category: "connection", width_mm: 120, height_mm: 80 });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("deaktivierter Typ mit Zuordnung bleibt in den Vorgaben lösbar; Speichern lädt die Verwendung neu", async () => {
    katalog = [...SYSTEM, eigen(HERD_KEY, "Herdanschluss", { is_active: false, template_count: 1 })];
    api.put.mockResolvedValue({ ...BETRIEB, version: 3, device_type_templates: [] });
    mit(<VorgabenSeite />);
    expect(await screen.findByTestId("betriebsstandard")).toHaveTextContent("Gerätetyp Herdanschluss (eigen) (deaktiviert)");
    fireEvent.click(screen.getByRole("button", { name: "Betriebsstandard bearbeiten" }));
    const dialog = await screen.findByRole("dialog", { name: "Betriebsstandard für neue Leitungen" });
    const feld = await within(dialog).findByTestId(`vorgabe-typ-${HERD_KEY}`);
    expect(feld).toHaveTextContent("Gerätetyp Herdanschluss (eigen) (deaktiviert)");
    fireEvent.change(within(feld).getByRole("combobox"), { target: { value: "" } });
    const katalogVorher = api.get.mock.calls.filter(([pfad]) => String(pfad).endsWith("/device-types")).length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Vorgaben speichern" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect((api.put.mock.calls[0] as [string, { body: { device_type_templates: unknown[] } }])[1].body.device_type_templates).toEqual([]);
    await waitFor(() => expect(api.get.mock.calls.filter(([pfad]) => String(pfad).endsWith("/device-types")).length).toBeGreaterThan(katalogVorher));
  });

  it("Deaktivieren mit Versionsprüfung; ohne Recht nur Ansicht", async () => {
    api.patch.mockResolvedValue(eigen(HERD_KEY, "Herdanschluss", { is_active: false }));
    const ansicht = mit(<VorgabenSeite />);
    const herd = await screen.findByTestId("geraetetyp-Herdanschluss");
    fireEvent.click(within(herd).getByRole("button", { name: "Deaktivieren" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/v1/modules/electrical/device-types/{key}", { path: { key: HERD_KEY }, ifMatch: 3, body: { is_active: false } }),
    );
    expect(await screen.findByText(/deaktiviert – wird für neue Geräte nicht mehr angeboten/)).toBeInTheDocument();
    ansicht.unmount();

    rechte.typen = false;
    mit(<VorgabenSeite />);
    const tabelle = await screen.findByRole("table", { name: "Eigene Gerätetypen" });
    expect(within(tabelle).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Eigenen Typ anlegen" })).toBeNull();
    expect(screen.getByTestId("geraetetypen")).toHaveTextContent("Ändern dürfen Benutzer mit dem Recht „Gerätetypen verwalten“.");
  });
});
