import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Die Oberfläche spiegelt den Schreibschutz archivierter Projekte.
 *
 * **Der verbindliche Schutz liegt im Backend** (`409 project-archived`,
 * geprüft in `tests/test_projects.py` und `tests/test_project_files.py`).
 * Hier wird nur geprüft, dass die Oberfläche keine Aktion anbietet, die der
 * Server ohnehin ablehnt — und dass Lesen und Herunterladen erhalten bleiben.
 *
 * `useAuth` wird ersetzt, damit die Komponenten ohne Anmeldung und ohne
 * Netzwerk laufen. Die Berechtigungen stehen dabei bewusst auf „darf alles":
 * Nur so ist belegt, dass wirklich der Archivstatus die Aktionen entfernt und
 * nicht eine fehlende Berechtigung.
 */
const api = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  upload: vi.fn(),
};

vi.mock("../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: () => true,
}));

const { ProjectFilesTab } = await import("./ProjectFilesTab");
const { ProjectStructureTab } = await import("./ProjectStructureTab");

const DATEI = {
  id: "datei-1",
  filename: "grundriss.pdf",
  content_type: "application/pdf",
  size_bytes: 2048,
  sha256: "0".repeat(64),
  project_id: "projekt-1",
  entity_type: null,
  entity_id: null,
  created_at: "2026-09-19T10:00:00Z",
};

const GEBAEUDE = {
  id: "gebaeude-1",
  project_id: "projekt-1",
  name: "Hauptgebäude",
  sort_order: 0,
  version: 1,
  created_at: "2026-09-19T10:00:00Z",
  updated_at: "2026-09-19T10:00:00Z",
};

const GESCHOSS = {
  id: "geschoss-1",
  building_id: "gebaeude-1",
  name: "Erdgeschoss",
  level: 0,
  elevation_mm: 0,
  default_ceiling_height_mm: 2500,
  version: 1,
  created_at: "2026-09-19T10:00:00Z",
  updated_at: "2026-09-19T10:00:00Z",
};

function zeigen(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((pfad: string) => {
    if (pfad.endsWith("/files")) return Promise.resolve([DATEI]);
    if (pfad.endsWith("/buildings")) return Promise.resolve([GEBAEUDE]);
    if (pfad.endsWith("/floors")) return Promise.resolve([GESCHOSS]);
    return Promise.resolve([]);
  });
});

describe("Dateien eines archivierten Projekts", () => {
  it("bietet keinen Upload an und sagt warum", async () => {
    zeigen(<ProjectFilesTab projectId="projekt-1" schreibgeschuetzt />);

    await screen.findByText("grundriss.pdf");
    expect(screen.queryByLabelText("Datei hochladen")).toBeNull();
    expect(screen.getByText(/archiviert/)).toBeTruthy();
  });

  it("laesst bestehende Dateien weiterhin herunterladen", async () => {
    zeigen(<ProjectFilesTab projectId="projekt-1" schreibgeschuetzt />);

    await screen.findByText("grundriss.pdf");
    expect(screen.getByRole("button", { name: "Herunterladen" })).toBeTruthy();
  });

  it("bietet den Upload an, solange das Projekt nicht archiviert ist", async () => {
    zeigen(<ProjectFilesTab projectId="projekt-1" schreibgeschuetzt={false} />);

    await screen.findByText("grundriss.pdf");
    expect(screen.getByLabelText("Datei hochladen")).toBeTruthy();
  });
});

describe("Struktur eines archivierten Projekts", () => {
  it("zeigt Gebaeude und Geschosse weiterhin an", async () => {
    zeigen(<ProjectStructureTab projectId="projekt-1" schreibgeschuetzt />);

    expect(await screen.findByText("Hauptgebäude")).toBeTruthy();
    expect(screen.getByText("Erdgeschoss")).toBeTruthy();
  });

  it("blendet die Verwaltung aus und nennt den Grund", async () => {
    zeigen(<ProjectStructureTab projectId="projekt-1" schreibgeschuetzt />);

    await screen.findByText("Hauptgebäude");
    expect(screen.queryByText("Gebäudestruktur verwalten")).toBeNull();
    expect(screen.queryByRole("button", { name: "Gebäude löschen" })).toBeNull();
    expect(screen.getByText(/archiviert/)).toBeTruthy();
  });

  it("zeigt die Verwaltung, solange das Projekt nicht archiviert ist", async () => {
    zeigen(<ProjectStructureTab projectId="projekt-1" schreibgeschuetzt={false} />);

    // Der Name steht dann zweimal da: in der Uebersicht und in der Verwaltung.
    await waitFor(() => expect(screen.getAllByText("Hauptgebäude").length).toBe(2));
    expect(screen.getByText("Gebäudestruktur verwalten")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gebäude löschen" })).toBeTruthy();
  });
});
