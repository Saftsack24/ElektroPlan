import { ApiError } from "@elektroplan/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { lazy } from "react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectTabsProvider } from "../../core/modules/ProjectTabs";
import { useUngespeicherteAenderungen } from "../../core/ui/ungespeichert";
import { RueckfrageProvider } from "../../core/ui/Rueckfrage";
import { reiter } from "../../core/ui/stil";

/**
 * Projektdetail: Tabwechsel bei ungespeicherten Änderungen eines Modul-Tabs
 * (Phase 4a.1) sowie Löschen, Wiedereröffnen und Bearbeitungsinfo (Phase 4d).
 *
 * Die Projektseite kennt das Modul nicht: Ein Beispiel-Tab meldet über den
 * fachneutralen Core-Mechanismus, dass er ungespeicherte Änderungen hält.
 */
const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
const rechte = new Set<string>();

vi.mock("../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: (recht: string) => rechte.has(recht),
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

const PERSON = (name: string) => ({ kind: "member" as const, user_id: `u-${name}`, display_name: name });
const SYSTEM = { kind: "system" as const, user_id: null, display_name: null };

let projekt: Record<string, unknown>;
let pruefung: Record<string, unknown>;

function zeigen() {
  const router = createMemoryRouter(
    [
      { path: "/projects/:projectId", element: <ProjectDetailPage /> },
      { path: "/projects", element: <p>Projektliste</p> },
    ],
    { initialEntries: ["/projects/projekt-1"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RueckfrageProvider>
      <ProjectTabsProvider tabs={TABS}>
        <RouterProvider router={router} />
      </ProjectTabsProvider>
    </RueckfrageProvider></QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  rechte.clear();
  for (const r of ["project.record.read", "project.record.write", "project.record.delete"]) rechte.add(r);
  projekt = {
    id: "projekt-1",
    name: "Neubau Musterweg 1",
    project_number: "PR-2026-0001",
    status: "active",
    customer_id: "kunde-1",
    site_street: null,
    site_postal_code: null,
    site_city: null,
    site_country_code: "DE",
    version: 3,
    created_at: "2026-09-01T08:00:00Z",
    updated_at: "2026-09-30T10:00:00Z",
    created_by: PERSON("Anna Admin"),
    updated_by: PERSON("Paula Planer"),
  };
  pruefung = {
    project_id: "projekt-1",
    project_number: "PR-2026-0001",
    name: "Neubau Musterweg 1",
    status: "active",
    version: 3,
    is_empty: true,
    contents: [],
    status_allows_deletion: true,
    can_delete: true,
    requires_admin: false,
    requires_number_confirmation: false,
    blocked_code: null,
    blocked_reason: null,
  };
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve(projekt);
    if (pfad === "/api/v1/projects/{project_id}/deletion-check") return Promise.resolve(pruefung);
    return Promise.resolve([]);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("Projekt-Tabwechsel", () => {
  it("fragt bei ungespeicherten Änderungen und bleibt bei Ablehnung im Tab", async () => {
    const frage = vi.spyOn(window, "confirm");
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Beispiel" }));
    expect(await screen.findByText("Modul-Tab mit Entwurf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dateien" }));
    const dialog = await screen.findByRole("dialog", { name: "Tab wechseln?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Änderungen behalten" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Modul-Tab mit Entwurf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dateien" }));
    const zweiter = await screen.findByRole("dialog", { name: "Tab wechseln?" });
    fireEvent.click(within(zweiter).getByRole("button", { name: "Änderungen verwerfen und fortfahren" }));
    await waitFor(() => expect(screen.queryByText("Modul-Tab mit Entwurf")).toBeNull());
    expect(frage).not.toHaveBeenCalled();
  });

  it("wechselt ohne Änderungen ohne Rückfrage und lädt den Projektkopf neu", async () => {
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Dateien" }));
    // Der gewählte Reiter trägt die hervorgehobene Variante des Reiter-Rezepts.
    await waitFor(() => expect(screen.getByRole("button", { name: "Dateien" }).className).toBe(reiter(true)));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(api.get.mock.calls.filter(([p]) => p === "/api/v1/projects/{project_id}").length).toBeGreaterThan(1),
    );
  });
});

describe("Bearbeitungsinfo", () => {
  it("nennt Ersteller und letzten Bearbeiter mit Anzeigenamen", async () => {
    zeigen();
    const liste = await screen.findByLabelText("Bearbeitungsinformationen");
    expect(within(liste).getByText("Anna Admin")).toBeInTheDocument();
    expect(within(liste).getByText("Paula Planer")).toBeInTheDocument();
    expect(within(liste).getByText("Erstellt von")).toBeInTheDocument();
    expect(within(liste).getByText("Zuletzt geändert von")).toBeInTheDocument();
  });

  it("zeigt Bestandsdaten verständlich", async () => {
    projekt = { ...projekt, created_by: SYSTEM, updated_by: { kind: "unknown", user_id: null, display_name: null } };
    zeigen();
    const liste = await screen.findByLabelText("Bearbeitungsinformationen");
    expect(within(liste).getByText("System/Bestandsdaten")).toBeInTheDocument();
    expect(within(liste).getByText("Unbekannter Benutzer")).toBeInTheDocument();
  });
});

describe("Projekt löschen", () => {
  it("zeigt den Löschknopf nur mit Recht und nur für Entwurf oder In Bearbeitung", async () => {
    zeigen();
    expect(await screen.findByRole("button", { name: "Projekt löschen" })).toBeInTheDocument();
  });

  it("verbirgt den Löschknopf ohne Recht", async () => {
    rechte.delete("project.record.delete");
    zeigen();
    await screen.findByRole("heading", { name: "Neubau Musterweg 1" });
    expect(screen.queryByRole("button", { name: "Projekt löschen" })).toBeNull();
  });

  it.each(["completed", "archived"])("verbirgt den Löschknopf im Status %s", async (status) => {
    projekt = { ...projekt, status };
    zeigen();
    await screen.findByRole("heading", { name: "Neubau Musterweg 1" });
    expect(screen.queryByRole("button", { name: "Projekt löschen" })).toBeNull();
  });

  it("löscht ein leeres Projekt nach Bestätigung und kehrt zur Liste zurück", async () => {
    api.delete.mockResolvedValue(undefined);
    const router = zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Projekt löschen" }));
    const dialog = await screen.findByRole("dialog", { name: "Projekt endgültig löschen?" });
    expect(await within(dialog).findByText(/Das Projekt ist leer/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Die Löschung ist/)).toHaveTextContent("Die Löschung ist endgültig");
    expect(within(dialog).queryByLabelText(/Projektnummer/)).toBeNull();
    // Der Fokus steht auf der sicheren Wahl.
    expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Projekt endgültig löschen" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(api.delete).toHaveBeenCalledWith("/api/v1/projects/{project_id}", {
      path: { project_id: "projekt-1" },
      ifMatch: 3,
      query: {},
    });
    expect(router.state.location.state).toEqual({ meldung: "Projekt PR-2026-0001 wurde endgültig gelöscht." });
    // Die Detailseite ersetzt sich selbst im Verlauf.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("verlangt bei Inhalt die exakte Projektnummer", async () => {
    pruefung = {
      ...pruefung,
      is_empty: false,
      requires_admin: true,
      requires_number_confirmation: true,
      contents: [
        { code: "core.files", label: "Dateien", count: 2 },
        { code: "electrical.rooms", label: "Räume", count: 5 },
      ],
    };
    api.delete.mockResolvedValue(undefined);
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Projekt löschen" }));
    const dialog = await screen.findByRole("dialog", { name: "Projekt mit Inhalt endgültig löschen?" });
    const inhalte = await within(dialog).findByRole("list", { name: "Erkannte Inhalte" });
    expect(within(inhalte).getByText("Dateien: 2")).toBeInTheDocument();
    expect(within(inhalte).getByText("Räume: 5")).toBeInTheDocument();
    expect(within(dialog).getByText(/unwiederbringlich verloren/)).toBeInTheDocument();

    const knopf = within(dialog).getByRole("button", { name: "Projekt endgültig löschen" });
    const feld = within(dialog).getByLabelText(/Projektnummer PR-2026-0001 eingeben/);
    expect(knopf).toBeDisabled();
    fireEvent.change(feld, { target: { value: "PR-2026-000" } });
    expect(knopf).toBeDisabled();
    fireEvent.change(feld, { target: { value: "PR-2026-0001" } });
    expect(knopf).toBeEnabled();

    fireEvent.click(knopf);
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith("/api/v1/projects/{project_id}", {
        path: { project_id: "projekt-1" },
        ifMatch: 3,
        query: { confirm_project_number: "PR-2026-0001" },
      }),
    );
  });

  it("erklärt, wenn nur ein Administrator löschen darf", async () => {
    pruefung = {
      ...pruefung,
      is_empty: false,
      can_delete: false,
      requires_admin: true,
      requires_number_confirmation: true,
      contents: [{ code: "electrical.rooms", label: "Räume", count: 1 }],
      blocked_code: "permission",
      blocked_reason: "Projekte mit Inhalt kann nur ein Administrator loeschen.",
    };
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Projekt löschen" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("nur ein Administrator");
    expect(within(dialog).getByRole("button", { name: "Projekt endgültig löschen" })).toBeDisabled();
    expect(within(dialog).queryByLabelText(/Projektnummer/)).toBeNull();
  });

  it.each([
    [403, "permission-denied", "Berechtigung"],
    [409, "version-conflict", "inzwischen von jemand anderem geändert"],
    [428, "precondition-required", "Bearbeitungsstand"],
  ])("erklärt einen Fehler %s verständlich", async (status, typ, text) => {
    api.delete.mockRejectedValue(
      new ApiError(status, { type: `https://elektroplan.internal/errors/${typ}`, title: "x", status }, null),
    );
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Projekt löschen" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Das Projekt ist leer/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Projekt endgültig löschen" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(text);
  });

  it("schließt mit Escape, ohne zu löschen", async () => {
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Projekt löschen" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();
  });
});

describe("Wiedereröffnung", () => {
  it("bietet sie nur dem Administrator für abgeschlossene Projekte an", async () => {
    projekt = { ...projekt, status: "completed" };
    zeigen();
    await screen.findByRole("heading", { name: "Neubau Musterweg 1" });
    expect(screen.queryByRole("button", { name: "Wieder in Bearbeitung setzen" })).toBeNull();
  });

  it("setzt nach Bestätigung zurück in Bearbeitung", async () => {
    rechte.add("project.record.reopen");
    projekt = { ...projekt, status: "completed" };
    api.post.mockResolvedValue({ ...projekt, status: "active" });
    zeigen();
    fireEvent.click(await screen.findByRole("button", { name: "Wieder in Bearbeitung setzen" }));
    const dialog = await screen.findByRole("dialog", { name: "Projekt wieder in Bearbeitung setzen?" });
    expect(within(dialog).getByText(/„Abgeschlossen" nach „In Bearbeitung"/)).toBeInTheDocument();
    expect(within(dialog).getByText(/wieder in der Liste der laufenden/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Wieder in Bearbeitung setzen" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/projects/{project_id}/reopen", {
        path: { project_id: "projekt-1" },
        ifMatch: 3,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("wieder in Bearbeitung");
  });

  it.each(["active", "archived"])("fehlt im Status %s", async (status) => {
    rechte.add("project.record.reopen");
    projekt = { ...projekt, status };
    zeigen();
    await screen.findByRole("heading", { name: "Neubau Musterweg 1" });
    expect(screen.queryByRole("button", { name: "Wieder in Bearbeitung setzen" })).toBeNull();
  });
});
