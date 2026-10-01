import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RueckfrageProvider } from "../../core/ui/Rueckfrage";

/**
 * Kundendetail (Phase 4d): endgültige Löschung nur für Administratoren, nur
 * ohne Projekte; Bearbeitungsinfo. Die Anonymisierung gibt es nicht mehr.
 */
const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
const rechte = new Set<string>();

vi.mock("../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: (recht: string) => rechte.has(recht),
}));

const { default: CustomerDetailPage } = await import("./CustomerDetailPage");

const KUNDE = {
  id: "kunde-1",
  customer_number: "KD-00042",
  kind: "private" as const,
  name: "Familie Beispiel",
  contact_person: null,
  email: null,
  phone: null,
  billing_street: null,
  billing_postal_code: null,
  billing_city: "Hameln",
  billing_country_code: "DE",
  version: 4,
  created_at: "2026-09-01T08:00:00Z",
  updated_at: "2026-09-30T08:00:00Z",
  created_by: { kind: "system" as const, user_id: null, display_name: null },
  updated_by: { kind: "member" as const, user_id: "u1", display_name: "Kai Kalkulator" },
};

let projektAnzahl = 0;

function zeigen() {
  const router = createMemoryRouter(
    [
      { path: "/customers/:customerId", element: <CustomerDetailPage /> },
      { path: "/customers", element: <p>Kundenliste</p> },
    ],
    { initialEntries: ["/customers/kunde-1"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RueckfrageProvider>
        <RouterProvider router={router} />
      </RueckfrageProvider>
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  rechte.clear();
  rechte.add("customer.record.read");
  rechte.add("customer.record.write");
  projektAnzahl = 0;
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/customers/{customer_id}") return Promise.resolve(KUNDE);
    if (pfad === "/api/v1/projects") {
      return Promise.resolve({ items: [], page: 1, page_size: 1, total_items: projektAnzahl, total_pages: 1 });
    }
    return Promise.resolve([]);
  });
});

describe("Kunden löschen", () => {
  it("ist für Nicht-Administratoren nicht sichtbar - und Anonymisieren gibt es nicht mehr", async () => {
    zeigen();
    await screen.findByRole("heading", { name: "Familie Beispiel" });
    expect(screen.queryByRole("button", { name: /Kunden löschen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /anonymisieren/i })).toBeNull();
    expect(screen.queryByText(/anonymisiert/i)).toBeNull();
  });

  it("löscht einen Kunden ohne Projekte nach Bestätigung", async () => {
    rechte.add("customer.record.delete");
    api.delete.mockResolvedValue(undefined);
    const router = zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Kunden löschen" }));
    const dialog = await screen.findByRole("dialog", { name: "Kunden endgültig löschen?" });
    expect(within(dialog).getByText("KD-00042")).toBeInTheDocument();
    expect(await within(dialog).findByText("Diesem Kunden sind keine Projekte zugeordnet.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Die Löschung ist/)).toHaveTextContent("endgültig");
    const gefahr = within(dialog).getByRole("button", { name: "Kunden endgültig löschen" });
    expect(gefahr.className).toContain("bg-danger");
    expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toHaveFocus();

    fireEvent.click(gefahr);

    await waitFor(() => expect(router.state.location.pathname).toBe("/customers"));
    expect(api.delete).toHaveBeenCalledWith("/api/v1/customers/{customer_id}", {
      path: { customer_id: "kunde-1" },
      ifMatch: 4,
    });
    expect(router.state.location.state).toEqual({ meldung: "Kunde KD-00042 wurde endgültig gelöscht." });
  });

  it("sperrt die Löschung, solange Projekte zugeordnet sind - in jedem Status", async () => {
    rechte.add("customer.record.delete");
    projektAnzahl = 3;
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Kunden löschen" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("sind noch 3 Projekte");
    expect(within(dialog).getByRole("button", { name: "Kunden endgültig löschen" })).toBeDisabled();
    // Gezählt wird ohne Statusfilter: laufende, abgeschlossene und archivierte.
    const abfrage = api.get.mock.calls.find(([pfad]) => pfad === "/api/v1/projects")?.[1] as {
      query: Record<string, unknown>;
    };
    expect(abfrage.query).toEqual({ customer_id: "kunde-1", page: 1, page_size: 1 });
  });

  it("zeigt den Serverkonflikt, wenn inzwischen ein Projekt zugeordnet wurde", async () => {
    rechte.add("customer.record.delete");
    api.delete.mockRejectedValue(
      new ApiError(
        409,
        {
          type: "https://elektroplan.internal/errors/customer-has-projects",
          title: "Kunde hat Projekte",
          status: 409,
          detail: "Dem Kunden KD-00042 sind noch 1 Projekt(e) zugeordnet.",
        },
        null,
      ),
    );
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Kunden löschen" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Diesem Kunden sind keine Projekte zugeordnet.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Kunden endgültig löschen" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("noch 1 Projekt(e) zugeordnet");
  });
});

describe("Bearbeitungsinfo am Kunden", () => {
  it("zeigt Bestandsdaten und den letzten Bearbeiter", async () => {
    zeigen();
    const info = await screen.findByLabelText("Bearbeitungsinformationen");
    expect(within(info).getByText("System/Bestandsdaten")).toBeInTheDocument();
    expect(within(info).getByText("Kai Kalkulator")).toBeInTheDocument();
  });
});
