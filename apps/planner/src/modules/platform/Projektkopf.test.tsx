import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { lazy } from "react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectTabsProvider } from "../../core/modules/ProjectTabs";
import { ArbeitsbereichProvider, useArbeitsbereich } from "../../core/ui/arbeitsbereich";
import { RueckfrageProvider } from "../../core/ui/Rueckfrage";

/**
 * Kompakter Projektkopf im Arbeitsbereich (Phase 6c, L1): Meldet ein Modul-Tab eine große
 * Arbeitsfläche an, wird der Kopf einzeilig – Name, Nummer, Status, die nächste
 * Statusaktion und ein Menü für Seltenes. Die Projektseite kennt das Modul nicht.
 */
const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
const rechte = new Set<string>();
vi.mock("../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: (recht: string) => rechte.has(recht),
}));

const { default: ProjectDetailPage } = await import("./ProjectDetailPage");

function Planungstab() {
  useArbeitsbereich(true);
  return <p>Planungsfläche</p>;
}

const TABS = [{ id: "planung", label: "Planung", order: 10, element: lazy(() => Promise.resolve({ default: Planungstab })) }];

let status = "draft";

function zeigen() {
  const router = createMemoryRouter([{ path: "/projects/:projectId", element: <ProjectDetailPage /> }], { initialEntries: ["/projects/projekt-1"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RueckfrageProvider>
        <ArbeitsbereichProvider>
          <ProjectTabsProvider tabs={TABS}>
            <RouterProvider router={router} />
          </ProjectTabsProvider>
        </ArbeitsbereichProvider>
      </RueckfrageProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rechte.clear();
  for (const r of ["project.record.read", "project.record.write", "project.record.delete"]) rechte.add(r);
  status = "draft";
  api.get.mockImplementation((pfad: string) =>
    pfad === "/api/v1/projects/{project_id}"
      ? Promise.resolve({
          id: "projekt-1",
          name: "Neubau Musterweg 1",
          project_number: "PR-2026-0001",
          status,
          customer_id: "kunde-1",
          version: 3,
          created_at: "2026-09-01T08:00:00Z",
          updated_at: "2026-09-30T10:00:00Z",
          created_by: { kind: "system", user_id: null, display_name: null },
          updated_by: { kind: "system", user_id: null, display_name: null },
        })
      : Promise.resolve([]),
  );
});

describe("Projektkopf im Arbeitsbereich", () => {
  it("ist ohne Arbeitsbereich die bisherige Karte und wird mit Planungsfläche einzeilig", async () => {
    zeigen();
    expect(await screen.findByRole("heading", { name: "Neubau Musterweg 1" })).toBeInTheDocument();
    expect(screen.queryByTestId("projektkopf-kompakt")).toBeNull();
    expect(screen.getByText(/Version 3/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Planung" }));
    const kopf = await screen.findByTestId("projektkopf-kompakt");
    expect(within(kopf).getByRole("heading", { name: "Neubau Musterweg 1" })).toBeInTheDocument();
    expect(kopf).toHaveTextContent("PR-2026-0001 · Entwurf");
    // Die nächste Statusaktion bleibt direkt erreichbar, Seltenes steht im Menü.
    expect(within(kopf).getByRole("button", { name: "In Bearbeitung nehmen" })).toBeInTheDocument();
    expect(screen.queryByText(/Version 3/)).toBeNull();
    fireEvent.click(within(kopf).getByRole("button", { name: "Weitere Projektaktionen" }));
    const menue = screen.getByRole("menu", { name: "Weitere Projektaktionen" });
    expect(within(menue).getByRole("menuitem", { name: "Archivieren" })).toBeInTheDocument();
    expect(within(menue).getByRole("menuitem", { name: "Projekt löschen …" })).toBeInTheDocument();
    // Details führen in die vorhandene Verwaltungsansicht – dort ist der Kopf wieder vollständig.
    fireEvent.click(within(menue).getByRole("menuitem", { name: "Stammdaten und Bearbeitungsinfo" }));
    expect(await screen.findByText(/Version 3/)).toBeInTheDocument();
    expect(screen.queryByTestId("projektkopf-kompakt")).toBeNull();
  });

  it("nennt den Schreibschutz auch kompakt", async () => {
    status = "archived";
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Planung" }));
    const kopf = await screen.findByTestId("projektkopf-kompakt");
    expect(within(kopf).getByText("schreibgeschützt")).toBeInTheDocument();
    expect(kopf).toHaveTextContent("Archiviert – Planung nur lesbar.");
  });
});
