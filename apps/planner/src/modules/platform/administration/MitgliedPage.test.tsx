import { ApiError } from "@elektroplan/api-client";
import type { MemberOut } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Detailansicht eines Mitglieds: Rollenvergabe, effektive Rechte samt
 * Herkunft, Sperren und Reaktivieren, fachliche Konflikte.
 */
const { api, zustand } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  zustand: { rechte: new Set<string>(), aktualisieren: vi.fn(() => Promise.resolve()) },
}));

vi.mock("../../../core/auth/AuthProvider", () => ({
  useAuth: () => ({
    api,
    permissions: zustand.rechte,
    me: { organization: { name: "Elektro Test GmbH" } },
    aktualisieren: zustand.aktualisieren,
  }),
}));

const { default: MitgliedPage } = await import("./MitgliedPage");

const ADMIN_RECHTE = [
  "user.account.read",
  "user.account.write",
  "role.assignment.read",
  "role.assignment.write",
];

function mitglied(teil: Partial<MemberOut> = {}): MemberOut {
  return {
    id: "m1",
    full_name: "Paul Planer",
    email: "paul@test.example",
    status: "active",
    roles: [{ key: "planer", name: "Planer" }],
    is_administrator: false,
    is_self: false,
    joined_at: "2026-09-01T08:00:00Z",
    last_login_at: null,
    version: 4,
    ...teil,
  };
}

let aktuell: MemberOut;

function problem(status: number, typ: string, detail = "Konflikt"): ApiError {
  return new ApiError(
    status,
    { type: `https://elektroplan.internal/errors/${typ}`, title: "x", status, detail },
    null,
  );
}

function zeigen() {
  const router = createMemoryRouter(
    [{ path: "/administration/users/:memberId", element: <MitgliedPage /> }],
    { initialEntries: ["/administration/users/m1"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  zustand.rechte = new Set(ADMIN_RECHTE);
  aktuell = mitglied();
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/members/{member_id}") return Promise.resolve(aktuell);
    if (pfad === "/api/v1/members/{member_id}/permissions") {
      return Promise.resolve({
        member_id: "m1",
        version: aktuell.version,
        roles: aktuell.roles,
        permissions: [
          {
            key: "customer.record.read",
            description: "Kunden ansehen",
            area: "Kunden",
            granted_by: [
              { key: "planer", name: "Planer" },
              { key: "kalkulator", name: "Kalkulator" },
            ],
          },
          {
            key: "project.record.write",
            description: "Projekte anlegen und bearbeiten",
            area: "Projekte",
            granted_by: [{ key: "planer", name: "Planer" }],
          },
        ],
      });
    }
    if (pfad === "/api/v1/roles") {
      return Promise.resolve([
        { key: "admin", name: "Administrator", description: "Voller Zugriff.", permissions: [] },
        { key: "planer", name: "Planer", description: "Technische Planung.", permissions: [] },
        { key: "kalkulator", name: "Kalkulator", description: "Angebote.", permissions: [] },
      ]);
    }
    return Promise.reject(new Error(pfad));
  });
});

describe("Mitglied verwalten", () => {
  it("zeigt effektive Rechte nach Bereich mit Herkunft - Schlüssel nur ergänzend", async () => {
    zeigen();
    const rechte = await screen.findByRole("region", { name: "Kunden" });
    expect(within(rechte).getByText("Kunden ansehen")).toBeInTheDocument();
    expect(within(rechte).getByText(/über Planer, Kalkulator/)).toBeInTheDocument();
    expect(within(rechte).getByText("customer.record.read").tagName).toBe("CODE");
    expect(screen.getByRole("region", { name: "Projekte" })).toBeInTheDocument();
    expect(screen.getByText(/lassen sich\s+hier nicht ändern/)).toBeInTheDocument();
  });

  it("ändert Rollen erst nach Rückfrage, atomar mit If-Match", async () => {
    api.put.mockImplementation(() => {
      aktuell = mitglied({
        roles: [
          { key: "planer", name: "Planer" },
          { key: "kalkulator", name: "Kalkulator" },
        ],
        version: 5,
      });
      return Promise.resolve(aktuell);
    });
    zeigen();
    const speichern = await screen.findByRole("button", { name: "Rollen speichern" });
    expect(speichern).toBeDisabled();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Kalkulator/ }));
    fireEvent.click(speichern);

    const frage = screen.getByRole("dialog", { name: "Rollen ändern?" });
    expect(within(frage).getByText("Neu: Kalkulator")).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
    fireEvent.click(within(frage).getByRole("button", { name: "Rollen speichern" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/v1/members/{member_id}/roles", {
        path: { member_id: "m1" },
        ifMatch: 4,
        body: { role_keys: ["planer", "kalkulator"] },
      }),
    );
    expect(await screen.findByText(/gelten ab sofort/)).toBeInTheDocument();
  });

  it("zeigt den Konflikt „letzter Administrator“ verständlich an", async () => {
    aktuell = mitglied({
      roles: [{ key: "admin", name: "Administrator" }],
      is_administrator: true,
    });
    api.put.mockRejectedValue(problem(409, "last-administrator"));
    zeigen();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Administrator/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Planer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Rollen speichern" }));
    const frage = screen.getByRole("dialog", { name: "Rollen ändern?" });
    expect(within(frage).getByText("Entfernt: Administrator")).toBeInTheDocument();
    fireEvent.click(within(frage).getByRole("button", { name: "Rollen speichern" }));
    expect(
      await within(frage).findByText(/mindestens einen aktiven Administrator/),
    ).toBeInTheDocument();
  });

  it("sperrt den Zugang nach Rückfrage und kann ihn wieder freigeben", async () => {
    api.post.mockImplementation((pfad: string) => {
      aktuell = mitglied({
        status: pfad.endsWith("/suspend") ? "disabled" : "active",
        version: aktuell.version + 1,
      });
      return Promise.resolve(aktuell);
    });
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Zugang zu diesem Betrieb sperren" }));
    const frage = screen.getByRole("dialog", { name: "Zugang sperren?" });
    expect(within(frage).getByText(/Zugänge zu anderen Betrieben bleiben bestehen/)).toBeInTheDocument();
    expect(within(frage).getByRole("button", { name: "Abbrechen" })).toHaveFocus();
    fireEvent.click(within(frage).getByRole("button", { name: "Zugang sperren" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/members/{member_id}/suspend", {
        path: { member_id: "m1" },
        ifMatch: 4,
      }),
    );
    expect(await screen.findByText(/ist gesperrt/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Zugang wieder freigeben" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Zugang freigeben?" })).getByRole("button", {
        name: "Zugang freigeben",
      }),
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith("/api/v1/members/{member_id}/reactivate", {
        path: { member_id: "m1" },
        ifMatch: 5,
      }),
    );
  });

  it("bietet bei der eigenen Mitgliedschaft weder Sperre noch Abgabe der Adminrolle an", async () => {
    aktuell = mitglied({
      is_self: true,
      is_administrator: true,
      roles: [{ key: "admin", name: "Administrator" }],
    });
    zeigen();
    expect(await screen.findByText("Den eigenen Zugang kann niemand selbst sperren.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sperren/ })).toBeNull();
    expect(await screen.findByRole("checkbox", { name: /Administrator/ })).toBeDisabled();
  });

  it("zeigt Lesern die Rollen ohne Bearbeitung", async () => {
    zustand.rechte = new Set(["user.account.read", "role.assignment.read"]);
    zeigen();
    expect(await screen.findByRole("checkbox", { name: /Planer/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Rollen speichern" })).toBeNull();
    expect(screen.queryByRole("button", { name: /sperren/ })).toBeNull();
  });
});
