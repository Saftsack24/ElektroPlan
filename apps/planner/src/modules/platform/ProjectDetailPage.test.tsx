import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { lazy } from "react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectTabsProvider } from "../../core/modules/ProjectTabs";
import { useUngespeicherteAenderungen } from "../../core/ui/ungespeichert";

/**
 * Projekt-Tabwechsel bei ungespeicherten Änderungen eines Modul-Tabs.
 *
 * Die Projektseite kennt das Modul nicht: Ein Beispiel-Tab meldet über den
 * fachneutralen Core-Mechanismus, dass er ungespeicherte Änderungen hält.
 */
const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };

vi.mock("../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: () => true,
}));

const { default: ProjectDetailPage } = await import("./ProjectDetailPage");

function Modultab() {
  useUngespeicherteAenderungen(true);
  return <p>Modul-Tab mit Entwurf</p>;
}

const TABS = [
  {
    id: "beispiel",
    label: "Beispiel",
    order: 10,
    element: lazy(() => Promise.resolve({ default: Modultab })),
  },
];

function zeigen() {
  const router = createMemoryRouter(
    [{ path: "/projects/:projectId", element: <ProjectDetailPage /> }],
    { initialEntries: ["/projects/projekt-1"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectTabsProvider tabs={TABS}>
        <RouterProvider router={router} />
      </ProjectTabsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((pfad: string) =>
    pfad === "/api/v1/projects/{project_id}"
      ? Promise.resolve({
          id: "projekt-1",
          name: "Neubau Musterweg 1",
          project_number: "PR-2026-0001",
          status: "active",
          customer_id: "kunde-1",
          version: 1,
        })
      : Promise.resolve([]),
  );
});
afterEach(() => vi.restoreAllMocks());

describe("Projekt-Tabwechsel", () => {
  it("fragt bei ungespeicherten Änderungen und bleibt bei Ablehnung im Tab", async () => {
    const frage = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Beispiel" }));
    expect(await screen.findByText("Modul-Tab mit Entwurf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dateien" }));
    expect(frage).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Modul-Tab mit Entwurf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dateien" }));
    expect(frage).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Modul-Tab mit Entwurf")).toBeNull();
  });

  it("wechselt ohne Änderungen ohne Rückfrage", async () => {
    const frage = vi.spyOn(window, "confirm");
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Dateien" }));
    expect(frage).not.toHaveBeenCalled();
  });
});
