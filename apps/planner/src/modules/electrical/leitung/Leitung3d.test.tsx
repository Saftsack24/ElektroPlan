import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { Grundrissszene } from "../ansicht3d/szene";
import { GESCHOSS, KUECHE, DIELE, KOPPLUNG, TYPEN, VERTEILUNG, leitung, stromkreis } from "./testdaten";
import { raumInListe } from "../arbeitsflaeche/testhilfe";

/**
 * Leitungen in der 3D-Ansicht (Phase 6b.5) über den echten Tab: Auswahl öffnet
 * die passende Bearbeitungsfläche, die Rückkehr stellt Kamera und Auswahl her,
 * der Entwurf bleibt erhalten und wird nie still gespeichert. Ersetzt sind nur
 * API, Route, Rechte und die WebGL-Umgebung der Szene.
 */
const zustand = vi.hoisted(() => ({ modul: null as Promise<unknown> | null }));
vi.mock("../ansicht3d/umgebung", async () => {
  const { testumgebung } = await import("../ansicht3d/szenentest");
  return { browserUmgebung: () => testumgebung().umgebung, webglVerfuegbar: () => true };
});
vi.mock("../ansicht3d/Ansicht3d", async () => {
  zustand.modul = vi.importActual("../ansicht3d/Ansicht3d");
  return await zustand.modul;
});

const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }), usePermission: () => true }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const pt = (x: number, y: number, z: number) => ({ x_mm: x, y_mm: y, z_mm: z });
const L1 = leitung({
  waypoints: [
    { kind: "wall", wall_id: "diele-w0", offset_mm: 500, height_mm: 0 },
    { kind: "wall", wall_id: "diele-w0", offset_mm: 1000, height_mm: 0 },
    { kind: "floor", room_id: "diele", x_mm: 1000, y_mm: 0 },
    { kind: "floor", room_id: "diele", x_mm: 1000, y_mm: 2000 },
  ],
  end_device_id: "sd-diele",
  status: "incomplete",
  length_mm: null,
  segments: [
    { kind: "wall", ref: "w0-w1", owner_id: "diele-w0", floor_id: "geschoss-1", length_mm: 500, known_mm: 500, points: [pt(500, 0, 0), pt(1000, 0, 0)] },
    { kind: "floor", ref: "w2-w3", owner_id: "diele", floor_id: "geschoss-1", length_mm: 2000, known_mm: 2000, points: [pt(1000, 0, 0), pt(1000, 2000, 0)] },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  window.localStorage.setItem("elektroplan.electrical.ansicht", "3d");
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Haus" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve([GESCHOSS]);
    if (pfad.endsWith("/plan")) return Promise.resolve({ floor_id: "geschoss-1", project_id: "projekt-1", rooms: [DIELE, KUECHE], wall_links: [KOPPLUNG], wall_link_candidates: [] });
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    if (pfad.endsWith("/distribution-boards")) return Promise.resolve({ building_id: "gebaeude-1", boards: [VERTEILUNG] });
    if (pfad.endsWith("/circuits")) return Promise.resolve({ building_id: "gebaeude-1", circuits: [stromkreis()] });
    if (pfad.endsWith("/cables")) return Promise.resolve({ building_id: "gebaeude-1", cables: [L1] });
    if (pfad.endsWith("/penetrations")) return Promise.resolve({ floor_id: "geschoss-1", penetrations: [] });
    if (pfad.endsWith("/risers")) return Promise.resolve({ building_id: "gebaeude-1", risers: [] });
    return Promise.resolve([]);
  });
});

function zeigen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <RueckfrageProvider>
        <RoomsTab />
      </RueckfrageProvider>
    </QueryClientProvider>,
  );
}

async function in3d() {
  await waitFor(() => expect(zustand.modul).not.toBeNull());
  await zustand.modul;
  return await screen.findByRole("region", { name: "Leitungen in der 3D-Ansicht" });
}

describe("Leitung in 3D", () => {
  it("gespeicherter Verlauf als Text und Szene; Auswahl öffnet den Grundriss; Rückkehr mit Kamera und Auswahl; Entwurf bleibt", async () => {
    const kamera = vi.spyOn(Grundrissszene.prototype, "kamerastandSetzen");
    zeigen();
    const liste = await in3d();
    fireEvent.click(await within(liste).findByRole("button", { name: /F3 · L1 – unvollständig/ }));
    const auswahl = screen.getByRole("heading", { name: "Auswahl" }).closest("section") as HTMLElement;
    expect(auswahl).toHaveTextContent("Leitung F3 · L1");
    expect(auswahl).toHaveTextContent("Teilsumme");
    expect(auswahl).toHaveTextContent("Wand (1), Fußboden (1)");

    fireEvent.click(within(auswahl).getByRole("button", { name: "Im Grundriss bearbeiten" }));
    // Editor mit geöffnetem Entwurf und gewähltem Werkzeug „Leitung“ - nichts gespeichert.
    await screen.findByRole("application", { name: /Grundriss/ });
    expect(await screen.findByTestId("zeichenleiste")).toHaveTextContent("Verlauf bearbeiten");
    expect(screen.queryByTestId("entwurf-offen")).toBeNull();
    expect(within(screen.getByTestId("zeichenleiste")).getByRole("button", { name: "Zurück zur 3D-Ansicht" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leitung hinzufügen" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("zeichenleiste")).toHaveTextContent("Verlauf bearbeiten");
    // Eine Änderung im Entwurf (Angaben im Dialog) …
    fireEvent.click(within(screen.getByTestId("zeichenleiste")).getByRole("button", { name: "Angaben …" }));
    const dialog = await screen.findByRole("dialog", { name: /Angaben/ });
    fireEvent.change(within(dialog).getByLabelText("Bezeichnung"), { target: { value: "L1 neu" } });
    fireEvent.blur(within(dialog).getByLabelText("Bezeichnung"));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    fireEvent.click(screen.getByRole("button", { name: "Zurück zur 3D-Ansicht" }));
    const wieder = await in3d();
    // … bleibt erhalten und ist als ungespeichert benannt; 3D zeigt den gespeicherten Stand.
    expect(wieder).toHaveTextContent("Ein Leitungsentwurf ist offen und ungespeichert");
    await waitFor(() => expect(screen.getByText("Leitung F3 · L1")).toBeInTheDocument());
    expect(kamera).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("Grundriss: gespeicherte Leitungen verdecken bei Raumbearbeitung keine Wände und Öffnungen", async () => {
    window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    // Je Teilstrecke eine Gruppe mit Trefferfläche.
    const treffer = () => screen.getAllByTestId("plan-leitung-l1").map((g) => g.querySelector("path.leitung-treffer") as Element);
    await screen.findAllByTestId("plan-leitung-l1");
    // Ohne Raumbearbeitung ist die Leitung wählbar ...
    for (const t of treffer()) expect(t).not.toHaveStyle({ pointerEvents: "none" });
    fireEvent.click(await raumInListe(/0.01 Diele/));
    // ... während ein Raum bearbeitet wird, lässt sie Klicks zu Wand und Öffnung durch (Abnahme 6b.6).
    await waitFor(() => {
      for (const t of treffer()) expect(t).toHaveStyle({ pointerEvents: "none" });
    });
  });
});
