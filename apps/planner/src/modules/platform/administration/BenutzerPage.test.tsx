import type { DirectoryEntryOut } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TABELLENRAHMEN } from "../../../core/ui/stil";

/**
 * Administration → Benutzer: Liste, Suche, Statusfilter, Blättern,
 * Einladen, Widerrufen und der Entwicklungslink.
 */
const { api, rechte, konfig } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rechte: { menge: new Set<string>() },
  konfig: { apiBaseUrl: "http://localhost:8000", entwicklungsfunktionen: true },
}));

vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api, permissions: rechte.menge }),
}));
vi.mock("../../../core/config", () => ({ config: konfig }));

const { default: BenutzerPage } = await import("./BenutzerPage");

const ADMIN_RECHTE = [
  "user.account.read",
  "user.account.write",
  "role.assignment.read",
  "role.assignment.write",
];

function eintrag(teil: Partial<DirectoryEntryOut> & { id: string; email: string }): DirectoryEntryOut {
  return {
    kind: "member",
    full_name: teil.email.split("@")[0] ?? null,
    status: "active",
    roles: [{ key: "planer", name: "Planer" }],
    last_login_at: null,
    invitation_expires_at: null,
    invitation_expired: false,
    version: 1,
    ...teil,
  };
}

const SEITE_1 = {
  items: [
    eintrag({ id: "m1", email: "anna@test.example", full_name: "Anna Albrecht" }),
    eintrag({ id: "m2", email: "bernd@test.example", full_name: "Bernd Becker", status: "disabled" }),
  ],
  next_cursor: "cursor-2",
  has_more: true,
};
const SEITE_2 = {
  items: [
    eintrag({
      id: "e1",
      kind: "invitation",
      email: "neu@test.example",
      full_name: null,
      status: "invited",
      invitation_expires_at: "2026-10-01T10:00:00Z",
      invitation_expired: true,
      version: 3,
    }),
  ],
  next_cursor: null,
  has_more: false,
};

function zeigen(pfad = "/administration/users") {
  const router = createMemoryRouter(
    [
      { path: "/administration/users", element: <BenutzerPage /> },
      { path: "/administration/users/:memberId", element: <p>Detailseite</p> },
    ],
    { initialEntries: [pfad] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function mitgliederAufrufe(): Record<string, unknown>[] {
  return api.get.mock.calls
    .filter(([pfad]) => pfad === "/api/v1/members")
    .map(([, optionen]) => (optionen as { query: Record<string, unknown> }).query);
}

beforeEach(() => {
  vi.clearAllMocks();
  rechte.menge = new Set(ADMIN_RECHTE);
  konfig.entwicklungsfunktionen = true;
  api.get.mockImplementation((pfad: string, optionen?: { query?: Record<string, unknown> }) => {
    if (pfad === "/api/v1/members") {
      const query = optionen?.query ?? {};
      if (query["q"] === "niemand") return Promise.resolve({ items: [], has_more: false });
      return Promise.resolve(query["cursor"] === "cursor-2" ? SEITE_2 : SEITE_1);
    }
    if (pfad === "/api/v1/roles") {
      return Promise.resolve([
        { key: "planer", name: "Planer", description: "Planung.", permissions: [] },
      ]);
    }
    if (pfad === "/api/v1/invitations/policy") {
      return Promise.resolve({ valid_hours: 72, delivery: "development_link" });
    }
    return Promise.reject(new Error(`unerwartet: ${pfad}`));
  });
});

describe("Benutzerliste", () => {
  it("zeigt eine semantische Tabelle mit Status und Rollen", async () => {
    zeigen();
    const tabelle = await screen.findByRole("table", { name: "Benutzer und offene Einladungen" });
    const zeilen = within(tabelle).getAllByRole("row");
    expect(zeilen).toHaveLength(3);
    expect(within(zeilen[1]!).getByRole("link", { name: "Anna Albrecht" })).toHaveAttribute(
      "href",
      "/administration/users/m1",
    );
    expect(within(zeilen[2]!).getByText("Zugang gesperrt")).toBeInTheDocument();
    expect(within(zeilen[1]!).getByText("Planer")).toBeInTheDocument();
    expect(mitgliederAufrufe()[0]).toEqual({ limit: 25 });
  });

  it("scrollt eine breite Tabelle in ihrer eigenen Hülle statt die Seite zu verbreitern", async () => {
    zeigen();
    const tabelle = await screen.findByRole("table", { name: "Benutzer und offene Einladungen" });
    expect(tabelle.parentElement?.className).toBe(TABELLENRAHMEN);
  });

  it("blättert vor und zurück - mit dem Cursor des Servers", async () => {
    zeigen();
    await screen.findByText("Anna Albrecht");
    expect(screen.getByText("Seite 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zurück" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    expect(await screen.findByText("neu@test.example")).toBeInTheDocument();
    expect(screen.getByText("Seite 2")).toBeInTheDocument();
    expect(screen.getByText("Einladung abgelaufen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
    expect(mitgliederAufrufe().at(-1)).toEqual({ limit: 25, cursor: "cursor-2" });

    fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
    expect(await screen.findByText("Anna Albrecht")).toBeInTheDocument();
    expect(screen.getByText("Seite 1")).toBeInTheDocument();
  });

  it("sucht serverseitig und beginnt dabei wieder auf Seite 1", async () => {
    zeigen();
    await screen.findByText("Anna Albrecht");
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await screen.findByText("Seite 2");

    fireEvent.change(screen.getByLabelText("Suche (Name oder E-Mail)"), {
      target: { value: "niemand" },
    });
    expect(await screen.findByText("Keine Treffer für diese Suche oder diesen Filter.")).toBeInTheDocument();
    expect(mitgliederAufrufe().at(-1)).toEqual({ limit: 25, q: "niemand" });
    expect(screen.queryByText(/^Seite /)).toBeNull();
  });

  it("filtert nach Status", async () => {
    zeigen();
    await screen.findByText("Anna Albrecht");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "invited" } });
    await waitFor(() => expect(mitgliederAufrufe().at(-1)).toEqual({ limit: 25, status: "invited" }));
  });

  it("übernimmt den Filter aus der Adresse (Hinweis der Startseite)", async () => {
    zeigen("/administration/users?status=invited");
    await waitFor(() => expect(mitgliederAufrufe()[0]).toEqual({ limit: 25, status: "invited" }));
    expect(screen.getByLabelText("Status")).toHaveValue("invited");
  });

  it("zeigt einen verständlichen leeren Zustand ohne Filter", async () => {
    api.get.mockImplementation((pfad: string) =>
      pfad === "/api/v1/members"
        ? Promise.resolve({ items: [], has_more: false })
        : Promise.resolve([]),
    );
    zeigen();
    expect(await screen.findByText(/Noch keine weiteren Benutzer/)).toBeInTheDocument();
  });

  it("zeigt einen Fehlerzustand mit erneutem Versuch", async () => {
    api.get.mockImplementation(() => Promise.reject(new Error("offline")));
    zeigen();
    expect(await screen.findByText(/konnte nicht geladen werden/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });
});

describe("Einladen und Einladungen verwalten", () => {
  it("bietet das Einladen nur mit beiden Schreibrechten an", async () => {
    rechte.menge = new Set(["user.account.read", "user.account.write"]);
    zeigen();
    await screen.findByText("Anna Albrecht");
    expect(screen.queryByRole("button", { name: "Benutzer einladen" })).toBeNull();
  });

  it("zeigt Lesern keine Aktionen für Einladungen", async () => {
    rechte.menge = new Set(["user.account.read"]);
    zeigen();
    await screen.findByText("Anna Albrecht");
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await screen.findByText("neu@test.example");
    expect(screen.queryByRole("button", { name: /Widerrufen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Neu ausstellen/ })).toBeNull();
  });

  it("zeigt den Entwicklungslink genau nach dem Anlegen", async () => {
    api.post.mockResolvedValue({
      invitation: { email: "neu@test.example" },
      delivery: "development_link",
      development_activation_url: "http://localhost:5173/einladung#t=geheim",
    });
    zeigen("/administration/users?einladen=1");
    const dialog = await screen.findByRole("dialog", { name: "Benutzer einladen" });
    fireEvent.change(within(dialog).getByLabelText(/^E-Mail/), {
      target: { value: "neu@test.example" },
    });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Planer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Einladung erstellen" }));

    expect(await screen.findByText("Einladung für neu@test.example wurde erstellt.")).toBeInTheDocument();
    expect(screen.getByText("Entwicklungsfunktion: Einladungslink")).toBeInTheDocument();
    expect(screen.getByLabelText("Einladungslink")).toHaveValue(
      "http://localhost:5173/einladung#t=geheim",
    );
    expect(api.post).toHaveBeenCalledWith("/api/v1/invitations", {
      body: { email: "neu@test.example", role_keys: ["planer"] },
    });
    // Einmalig: Nach dem Schließen des Hinweises ist der Link weg.
    fireEvent.click(screen.getByRole("button", { name: "Hinweis schließen" }));
    expect(screen.queryByLabelText("Einladungslink")).toBeNull();
  });

  it("zeigt ohne Entwicklungsmodus keinen Link - auch wenn der Server einen schickte", async () => {
    konfig.entwicklungsfunktionen = false;
    api.post.mockResolvedValue({
      invitation: { email: "neu@test.example" },
      delivery: "development_link",
      development_activation_url: "http://localhost:5173/einladung#t=geheim",
    });
    zeigen("/administration/users?einladen=1");
    const dialog = await screen.findByRole("dialog", { name: "Benutzer einladen" });
    fireEvent.change(within(dialog).getByLabelText(/^E-Mail/), {
      target: { value: "neu@test.example" },
    });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Planer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Einladung erstellen" }));
    expect(await screen.findByText("Einladung für neu@test.example wurde erstellt.")).toBeInTheDocument();
    expect(screen.queryByText(/Entwicklungsfunktion/)).toBeNull();
    expect(screen.queryByDisplayValue(/einladung#t=/)).toBeNull();
  });

  it("widerruft eine Einladung erst nach Rückfrage und mit If-Match", async () => {
    api.post.mockResolvedValue({ id: "e1", status: "revoked" });
    zeigen();
    await screen.findByText("Anna Albrecht");
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    fireEvent.click(await screen.findByRole("button", { name: /Widerrufen/ }));

    const frage = screen.getByRole("dialog", { name: "Einladung widerrufen?" });
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(within(frage).getByRole("button", { name: "Einladung widerrufen" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/invitations/{invitation_id}/revoke", {
        path: { invitation_id: "e1" },
        ifMatch: 3,
      }),
    );
    expect(await screen.findByText(/wurde widerrufen/)).toBeInTheDocument();
  });
});
