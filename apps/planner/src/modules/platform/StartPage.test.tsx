import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Startseite (Phase 4.2): arbeitsorientiert, abhängig von den Rechten, ohne
 * technische Rohdaten.
 */
const { api, zustand } = vi.hoisted(() => ({
  api: { get: vi.fn() },
  zustand: {
    rechte: new Set<string>(),
    rollen: [{ key: "admin", name: "Administrator" }],
  },
}));

vi.mock("../../core/auth/AuthProvider", () => ({
  useAuth: () => ({
    api,
    permissions: zustand.rechte,
    me: {
      full_name: "Erika Beispiel",
      organization: { name: "Elektro Test GmbH" },
      roles: zustand.rollen,
    },
  }),
}));

const { default: StartPage, begruessung } = await import("./StartPage");

const ADMIN = [
  "project.record.read",
  "project.record.write",
  "customer.record.read",
  "customer.record.write",
  "user.account.read",
  "user.account.write",
  "role.assignment.read",
  "role.assignment.write",
  "module.registry.read",
];

const PROJEKT = {
  id: "p1",
  project_number: "PR-2026-0007",
  name: "Neubau Lindenweg",
  status: "active",
  customer_id: "k1",
  customer_name: "Familie Muster",
  site_city: "Kassel",
  version: 2,
  created_at: "2026-09-01T08:00:00Z",
  updated_at: "2026-09-26T08:00:00Z",
};

function zeigen() {
  const router = createMemoryRouter([{ path: "/", element: <StartPage /> }]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function antworten({ projekte = [PROJEKT], einladungen = 0 } = {}) {
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects") return Promise.resolve({ items: projekte, page: 1, page_size: 5, total_items: projekte.length, total_pages: 1 });
    if (pfad === "/api/v1/members") {
      return Promise.resolve({
        items: Array.from({ length: einladungen }, (_, n) => ({
          id: `e${n}`,
          invitation_expired: n === 0,
        })),
        has_more: false,
      });
    }
    return Promise.reject(new Error(pfad));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  zustand.rechte = new Set(ADMIN);
  zustand.rollen = [{ key: "admin", name: "Administrator" }];
  antworten();
});

describe("Startseite", () => {
  it("begrüßt persönlich und nennt den Betrieb", async () => {
    zeigen();
    expect(
      screen.getByRole("heading", { level: 1, name: /Erika Beispiel/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Elektro Test GmbH")).toBeInTheDocument();
    await screen.findAllByText("Neubau Lindenweg");
  });

  it("zeigt Administratoren alle Schnellaktionen mit genau einer Hauptaktion", async () => {
    zeigen();
    const aktionen = screen.getByRole("group", { name: "Schnellaktionen" });
    expect(within(aktionen).getByRole("link", { name: "Neues Projekt" })).toHaveAttribute(
      "href",
      "/projects?neu=1",
    );
    expect(within(aktionen).getByRole("link", { name: "Neuer Kunde" })).toBeInTheDocument();
    expect(within(aktionen).getByRole("link", { name: "Benutzer einladen" })).toHaveAttribute(
      "href",
      "/administration/users?einladen=1",
    );
    expect(aktionen.querySelectorAll(".button--primary")).toHaveLength(1);
    await screen.findAllByText("Neubau Lindenweg");
  });

  it("lädt nur kleine, serverseitig sortierte Ausschnitte", async () => {
    zeigen();
    await screen.findAllByText("Neubau Lindenweg");
    const projektabfragen = api.get.mock.calls
      .filter(([pfad]) => pfad === "/api/v1/projects")
      .map(([, optionen]) => (optionen as { query: unknown }).query);
    expect(projektabfragen).toEqual(
      expect.arrayContaining([
        { sort: "updated_at", page_size: 5 },
        { sort: "updated_at", page_size: 5, status: "active" },
      ]),
    );
  });

  it("weist Administratoren unaufdringlich auf offene Einladungen hin", async () => {
    antworten({ einladungen: 2 });
    zeigen();
    expect(await screen.findByText(/2 Einladungen sind noch nicht\s+angenommen, davon 1 abgelaufen/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Einladungen ansehen" })).toHaveAttribute(
      "href",
      "/administration/users?status=invited",
    );
  });

  it("zeigt ohne offene Einladungen keinen Hinweis", async () => {
    zeigen();
    await screen.findAllByText("Neubau Lindenweg");
    expect(screen.queryByText(/Einladung/)).toBeNull();
  });

  it("zeigt normalen Benutzern keine Verwaltung und keine Einladungsabfrage", async () => {
    zustand.rechte = new Set(["project.record.read", "module.registry.read"]);
    zustand.rollen = [{ key: "monteur", name: "Monteur" }];
    zeigen();
    await screen.findAllByText("Neubau Lindenweg");
    expect(screen.queryByRole("group", { name: "Schnellaktionen" })).toBeNull();
    expect(screen.queryByText("Benutzer einladen")).toBeNull();
    expect(api.get.mock.calls.some(([pfad]) => pfad === "/api/v1/members")).toBe(false);
    expect(screen.getByRole("link", { name: "Alle Projekte" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Kunden" })).toBeNull();
  });

  it("enthält weder Berechtigungsschlüssel noch Modulversionen", async () => {
    zeigen();
    await screen.findAllByText("Neubau Lindenweg");
    expect(document.body.textContent).not.toMatch(/project\.record|user\.account|v1\.\d/);
    expect(screen.queryByText(/Aktive Module/)).toBeNull();
  });

  it("hilft in einer frischen Umgebung beim ersten Schritt", async () => {
    antworten({ projekte: [] });
    zeigen();
    expect(await screen.findByText("Noch keine Projekte.")).toBeInTheDocument();
    expect(screen.getByText(/zuerst einen Kunden an, danach das erste Projekt/)).toBeInTheDocument();
    expect(await screen.findByText("Derzeit ist kein Projekt in Bearbeitung.")).toBeInTheDocument();
  });

  it("erklärt Rollen ohne Arbeitsbereich ehrlich", async () => {
    zustand.rechte = new Set(["module.registry.read", "file.object.read"]);
    zustand.rollen = [{ key: "lager", name: "Lager" }];
    zeigen();
    expect(screen.getByText(/Für Ihre Rolle \(Lager\) gibt es/)).toBeInTheDocument();
    await waitFor(() => expect(api.get).not.toHaveBeenCalled());
  });

  it("grüßt passend zur Tageszeit", () => {
    expect(begruessung(8)).toBe("Guten Morgen");
    expect(begruessung(14)).toBe("Guten Tag");
    expect(begruessung(20)).toBe("Guten Abend");
  });
});
