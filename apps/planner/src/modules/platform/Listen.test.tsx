import type { CustomerOut, ProjectSummary } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RueckfrageProvider } from "../../core/ui/Rueckfrage";

/**
 * Projektübersicht, Kundenübersicht und die Projekte eines Kunden
 * (Bedienungsnacharbeit 1): nummerierte Seiten, getrennter Kundenfilter,
 * serverseitige Statusgruppen.
 *
 * Die API ist eine Attrappe, die Seiten wie der Server schneidet - geprüft
 * wird, welche Anfragen die Oberfläche stellt und was sie daraus zeigt.
 */
const { api, rechte } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rechte: new Set<string>(),
}));

vi.mock("../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api, permissions: rechte }),
  usePermission: (recht: string) => rechte.has(recht),
}));

const { default: ProjectsPage } = await import("./ProjectsPage");
const { default: CustomersPage } = await import("./CustomersPage");
const { default: CustomerDetailPage } = await import("./CustomerDetailPage");

function kunde(id: string, name: string, extra: Partial<CustomerOut> = {}): CustomerOut {
  return {
    id,
    customer_number: `KD-${id.padStart(5, "0")}`,
    kind: "company",
    name,
    contact_person: null,
    email: null,
    phone: null,
    billing_street: null,
    billing_postal_code: null,
    billing_city: "Hameln",
    billing_country_code: "DE",
    created_by: { kind: "system", user_id: null, display_name: null },
    updated_by: { kind: "system", user_id: null, display_name: null },
    version: 1,
    created_at: "2026-09-01T08:00:00Z",
    updated_at: "2026-09-01T08:00:00Z",
    ...extra,
  };
}

function projekt(n: number, status: ProjectSummary["status"] = "active"): ProjectSummary {
  return {
    id: `p${n}`,
    project_number: `PR-2026-${String(n).padStart(4, "0")}`,
    name: `Projekt ${n}`,
    status,
    customer_id: "k1",
    customer_name: "Bau GmbH",
    site_city: "Kassel",
    version: 1,
    created_at: "2026-09-01T08:00:00Z",
    updated_at: "2026-09-26T08:00:00Z",
    created_by: { kind: "system", user_id: null, display_name: null },
    updated_by: { kind: "system", user_id: null, display_name: null },
  };
}

let PROJEKTE = Array.from({ length: 60 }, (_, i) => projekt(i + 1));

/** Ergänzt abgeschlossene und archivierte Projekte für die historische Ansicht. */
function PROJEKTE_MIT_HISTORIE() {
  PROJEKTE = [...PROJEKTE, projekt(70, "completed"), projekt(71, "archived")];
}
const KUNDEN = [kunde("1", "Bau GmbH"), kunde("2", "Zweitkunde")];

function seite<T>(alle: readonly T[], query: Record<string, unknown>) {
  const groesse = Number(query.page_size ?? 25);
  const gesamt = Math.ceil(alle.length / groesse);
  const echt = Math.max(1, Math.min(Number(query.page ?? 1), gesamt));
  return {
    items: alle.slice((echt - 1) * groesse, echt * groesse),
    page: echt,
    page_size: groesse,
    total_items: alle.length,
    total_pages: gesamt,
  };
}

const projektAnfragen = () =>
  api.get.mock.calls
    .filter(([pfad]) => pfad === "/api/v1/projects")
    .map(([, optionen]) => (optionen as { query: Record<string, unknown> }).query);

beforeEach(() => {
  vi.clearAllMocks();
  PROJEKTE = Array.from({ length: 60 }, (_, i) => projekt(i + 1));
  rechte.clear();
  for (const r of ["project.record.read", "project.record.write", "customer.record.read", "customer.record.write"]) {
    rechte.add(r);
  }
  api.get.mockImplementation((pfad: string, optionen?: { query?: Record<string, unknown> }) => {
    const query = optionen?.query ?? {};
    if (pfad === "/api/v1/projects") {
      let liste = PROJEKTE;
      if (query.customer_id === "2") liste = [projekt(99, "archived")];
      if (query.status_group === "closed") liste = liste.filter((p) => p.status === "completed" || p.status === "archived");
      if (query.status_group === "current") liste = liste.filter((p) => p.status === "draft" || p.status === "active");
      if (typeof query.q === "string") liste = liste.filter((p) => p.name.includes(String(query.q)));
      return Promise.resolve(seite(liste, query));
    }
    if (pfad === "/api/v1/customers") return Promise.resolve(seite(KUNDEN, query));
    if (pfad === "/api/v1/customers/{customer_id}") return Promise.resolve(KUNDEN[1]);
    return Promise.resolve([]);
  });
});

function zeigen(element: React.ReactElement, pfad = "/", muster = "/") {
  const router = createMemoryRouter([{ path: muster, element }], { initialEntries: [pfad] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <RueckfrageProvider>
        <RouterProvider router={router} />
      </RueckfrageProvider>
    </QueryClientProvider>,
  );
}

describe("Projektübersicht", () => {
  it("blättert mit nummerierten Seiten statt „Weitere laden“", async () => {
    zeigen(<ProjectsPage />);
    const nav = await screen.findByRole("navigation", { name: "Seiten der Projektliste" });
    expect(within(nav).getByText(/Seite 1 von 3 · 60 Einträge/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Weitere laden/ })).toBeNull();

    fireEvent.click(within(nav).getByRole("button", { name: "Seite 3" }));
    expect(await screen.findByText("Projekt 51")).toBeInTheDocument();
    expect(projektAnfragen().at(-1)).toMatchObject({ page: 3, page_size: 25 });
  });

  it("trennt die allgemeine Suche vom Kundenfilter", async () => {
    zeigen(<ProjectsPage />);
    expect(await screen.findByLabelText("Suche (Bezeichnung, Projektnummer, Baustellenort)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Suche.*Kunde/)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Kunde" })).toBeInTheDocument();
  });

  it("filtert serverseitig nach genau einem Kunden und entfernt den Filter wieder", async () => {
    zeigen(<ProjectsPage />, "/projects?ansicht=abgeschlossen", "/projects");
    await screen.findByRole("heading", { name: "Abgeschlossene & archivierte Projekte" });
    const feld = screen.getByRole("combobox", { name: "Kunde" });
    fireEvent.focus(feld);
    await screen.findByRole("option", { name: /Zweitkunde/ });
    fireEvent.keyDown(feld, { key: "ArrowDown" });
    fireEvent.keyDown(feld, { key: "ArrowDown" });
    fireEvent.keyDown(feld, { key: "Enter" });

    expect(await screen.findByTestId("projektfilter-kunde-gewaehlt")).toHaveTextContent("Zweitkunde");
    expect(await screen.findByText("Projekt 99")).toBeInTheDocument();
    expect(projektAnfragen().at(-1)).toMatchObject({ customer_id: "2", status_group: "closed", page: 1 });
    expect(projektAnfragen().at(-1)).not.toHaveProperty("q");

    fireEvent.click(screen.getByRole("button", { name: "Kundenfilter entfernen" }));
    await waitFor(() => expect(projektAnfragen().at(-1)).not.toHaveProperty("customer_id"));
  });

  it("zeigt standardmäßig nur laufende Projekte - serverseitig gefiltert", async () => {
    zeigen(<ProjectsPage />);
    expect(await screen.findByRole("heading", { name: "Laufende Projekte" })).toBeInTheDocument();
    await screen.findByText("Projekt 1");
    expect(projektAnfragen().at(-1)).toMatchObject({ status_group: "current", page: 1 });
    const status = screen.getByLabelText("Status");
    expect(within(status).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Alle laufenden",
      "Entwurf",
      "In Bearbeitung",
    ]);
  });

  it("schaltet per Adresse auf abgeschlossene und archivierte um und zurück", async () => {
    PROJEKTE_MIT_HISTORIE();
    const router = createMemoryRouter([{ path: "/projects", element: <ProjectsPage /> }], {
      initialEntries: ["/projects"],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <RueckfrageProvider>
          <RouterProvider router={router} />
        </RueckfrageProvider>
      </QueryClientProvider>,
    );
    const nav = await screen.findByRole("navigation", { name: "Seiten der Projektliste" });
    fireEvent.click(within(nav).getByRole("button", { name: "Seite 2" }));
    await screen.findByText("Projekt 26");
    fireEvent.change(screen.getByLabelText(/^Suche/), { target: { value: "Projekt" } });

    const umschalten = screen.getByRole("button", { name: "Abgeschlossene & archivierte anzeigen" });
    expect(umschalten).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(umschalten);

    expect(await screen.findByRole("heading", { name: "Abgeschlossene & archivierte Projekte" })).toBeInTheDocument();
    expect(router.state.location.search).toBe("?ansicht=abgeschlossen");
    // Suche bleibt, Seite beginnt wieder bei 1.
    await waitFor(() =>
      expect(projektAnfragen().at(-1)).toMatchObject({ status_group: "closed", q: "Projekt", page: 1 }),
    );
    expect(await screen.findByRole("cell", { name: "Archiviert" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Suche/)).toHaveValue("Projekt");

    // Browser-Zurück führt zur laufenden Ansicht.
    await act(() => router.navigate(-1));
    expect(await screen.findByRole("heading", { name: "Laufende Projekte" })).toBeInTheDocument();
    await waitFor(() => expect(projektAnfragen().at(-1)).toMatchObject({ status_group: "current" }));
  });

  it("zeigt die Erfolgsmeldung einer Löschung einmal", async () => {
    const router = createMemoryRouter([{ path: "/projects", element: <ProjectsPage /> }], {
      initialEntries: [{ pathname: "/projects", state: { meldung: "Projekt PR-2026-0007 wurde endgültig gelöscht." } }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <RueckfrageProvider>
          <RouterProvider router={router} />
        </RueckfrageProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("PR-2026-0007 wurde endgültig gelöscht");
    await waitFor(() => expect(router.state.location.state).toBeNull());
  });

  it("kürzt den Platzhalter der Kundensuche", async () => {
    zeigen(<ProjectsPage />);
    expect(await screen.findByRole("combobox", { name: "Kunde" })).toHaveAttribute(
      "placeholder",
      "Name, Nummer oder Ort",
    );
  });

  it("trägt Icons nur dekorativ - der Name kommt vom Text", async () => {
    zeigen(<ProjectsPage />);
    const knopf = await screen.findByRole("button", { name: "Neues Projekt" });
    const symbol = knopf.querySelector("svg");
    expect(symbol).not.toBeNull();
    expect(symbol).toHaveAttribute("aria-hidden", "true");
  });

  it("beginnt nach einem Filterwechsel wieder auf Seite 1", async () => {
    zeigen(<ProjectsPage />);
    const nav = await screen.findByRole("navigation", { name: "Seiten der Projektliste" });
    fireEvent.click(within(nav).getByRole("button", { name: "Seite 2" }));
    await screen.findByText("Projekt 26");

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "active" } });
    await waitFor(() => expect(projektAnfragen().at(-1)).toMatchObject({ status: "active", page: 1 }));

    fireEvent.change(screen.getByLabelText(/^Suche/), { target: { value: "Projekt 5" } });
    await waitFor(() => expect(projektAnfragen().at(-1)).toMatchObject({ q: "Projekt 5", page: 1 }));
  });

  it("bietet im Anlagedialog alle gelisteten Kunden an", async () => {
    zeigen(<ProjectsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Neues Projekt" }));
    const dialog = await screen.findByRole("dialog", { name: "Neues Projekt" });
    fireEvent.focus(within(dialog).getByRole("combobox", { name: /^Kunde/ }));
    expect(await within(dialog).findByRole("option", { name: /Bau GmbH/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Zweitkunde/ })).toBeInTheDocument();
  });
});

describe("Kundenübersicht", () => {
  it("zeigt nummerierte Seiten und sucht ab Seite 1", async () => {
    zeigen(<CustomersPage />);
    expect(await screen.findByText("Bau GmbH")).toBeInTheDocument();
    expect(screen.getByText("2 Einträge")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Weitere laden/ })).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Suche/), { target: { value: "Bau" } });
    await waitFor(() =>
      expect(
        api.get.mock.calls.filter(([p]) => p === "/api/v1/customers").at(-1)?.[1],
      ).toMatchObject({ query: { q: "Bau", page: 1, page_size: 25, sort: "name" } }),
    );
  });
});

describe("Projekte dieses Kunden", () => {
  const detail = () => zeigen(<CustomerDetailPage />, "/customers/2", "/customers/:customerId");

  it("zeigt standardmäßig laufende Projekte, serverseitig gefiltert", async () => {
    detail();
    const bereich = await screen.findByRole("region", { name: "Projekte dieses Kunden" });
    expect(within(bereich).getByRole("heading", { name: "Laufende Projekte" })).toBeInTheDocument();
    await waitFor(() =>
      expect(projektAnfragen().at(-1)).toMatchObject({ customer_id: "2", status_group: "current", page: 1 }),
    );
    expect(await within(bereich).findByText(/Keine laufenden Projekte/)).toBeInTheDocument();
  });

  it("schaltet auf abgeschlossene und archivierte um", async () => {
    detail();
    const bereich = await screen.findByRole("region", { name: "Projekte dieses Kunden" });
    fireEvent.click(within(bereich).getByRole("button", { name: "Abgeschlossene & archivierte anzeigen" }));

    expect(await within(bereich).findByText("Projekt 99")).toBeInTheDocument();
    expect(within(bereich).getByRole("link", { name: "Projekt 99" })).toHaveAttribute("href", "/projects/p99");
    expect(within(bereich).getByText("Archiviert")).toBeInTheDocument();
    expect(projektAnfragen().at(-1)).toMatchObject({ customer_id: "2", status_group: "closed", page: 1 });

    fireEvent.click(within(bereich).getByRole("button", { name: "Laufende Projekte anzeigen" }));
    await waitFor(() => expect(projektAnfragen().at(-1)).toMatchObject({ status_group: "current" }));
  });

  it("wird ohne Leserecht für Projekte nicht angezeigt und fragt nichts an", async () => {
    rechte.delete("project.record.read");
    detail();
    expect(await screen.findByRole("heading", { name: "Zweitkunde" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Projekte dieses Kunden" })).toBeNull();
    expect(projektAnfragen()).toHaveLength(0);
  });
});
