import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Ansicht3dLaden } from "./ansicht3d/Ansicht3dLaden";
import { einfamilienhaus, plan, rechteck } from "./ansicht3d/testplan";
import { RueckfrageProvider } from "../../core/ui/Rueckfrage";

/**
 * Drei Ansichten im Tab „Räume & Grundriss" (Phase 4b).
 *
 * Die echte 3D-Ansicht wird lazy nachgeladen; nur ihre Browserumgebung
 * (WebGL-Renderer, Controls, Bildtakt) ist durch Test-Doubles ersetzt.
 */
const zustand = vi.hoisted(() => ({ webgl: true, geladen: 0 }));

vi.mock("./ansicht3d/umgebung", async () => {
  const { testumgebung } = await import("./ansicht3d/szenentest");
  return {
    browserUmgebung: () => testumgebung({ webgl: zustand.webgl }).umgebung,
    webglVerfuegbar: () => zustand.webgl,
  };
});

// Zählt, wann das 3D-Modul (mit Three.js) tatsächlich geladen wird.
vi.mock("./ansicht3d/Ansicht3d", async () => {
  zustand.geladen += 1;
  return await vi.importActual("./ansicht3d/Ansicht3d");
});

const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
let darfSchreiben = true;
vi.mock("../../core/auth/AuthProvider", () => ({
  useAuth: () => ({ api }),
  usePermission: (permission: string) => (permission === "electrical.plan.write" ? darfSchreiben : true),
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("./RoomsTab");

const GESCHOSSE = [
  { id: "geschoss-1", building_id: "gebaeude-1", name: "Erdgeschoss", default_ceiling_height_mm: 2500 },
  { id: "geschoss-2", building_id: "gebaeude-1", name: "Obergeschoss", default_ceiling_height_mm: 2400 },
];
let projekt = { id: "projekt-1", status: "active", version: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  zustand.webgl = true;
  darfSchreiben = true;
  projekt = { id: "projekt-1", status: "active", version: 2 };
  api.get.mockImplementation((pfad: string, optionen?: { path?: Record<string, string> }) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve(projekt);
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve(GESCHOSSE);
    if (pfad.endsWith("/plan")) {
      return Promise.resolve(
        optionen?.path?.floor_id === "geschoss-1"
          ? einfamilienhaus()
          : plan([rechteck("og", "Galerie", [0, 0], [4000, 3000], { floorId: "geschoss-2" })], "geschoss-2"),
      );
    }
    return Promise.resolve([]);
  });
});

function zeigen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}><RueckfrageProvider>
      <RoomsTab />
    </RueckfrageProvider></QueryClientProvider>,
  );
}

const knopf = (name: string) => screen.getByRole("button", { name });

describe("Ansichtswahl", () => {
  it("bietet drei Ansichten; ohne gemerkte Wahl startet der 2D-Editor", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    const wahl = screen.getByRole("group", { name: "Ansicht" });
    expect([...wahl.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "2D-Editor",
      "3D-Ansicht",
      "Tabellen & Details",
    ]);
    expect(knopf("2D-Editor")).toHaveAttribute("aria-pressed", "true");
    // Three.js wird für den Editor nicht geladen.
    expect(zustand.geladen).toBe(0);
  });

  it("wechselt zur 3D-Ansicht, lädt sie erst dann und merkt sich die Wahl", async () => {
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    fireEvent.click(knopf("3D-Ansicht"));
    expect(await screen.findByText(/7 von 7 Räumen dargestellt/)).toBeInTheDocument();
    expect(zustand.geladen).toBe(1);
    expect(screen.getByRole("application", { name: "3D-Ansicht Hauptgebäude · Erdgeschoss" })).toBeInTheDocument();
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    expect(window.localStorage.getItem("elektroplan.electrical.ansicht")).toBe("3d");
  });

  it("öffnet mit gemerkter 3D-Ansicht direkt in 3D", async () => {
    window.localStorage.setItem("elektroplan.electrical.ansicht", "3d");
    zeigen();
    expect(await screen.findByText(/7 von 7 Räumen dargestellt/)).toBeInTheDocument();
    expect(knopf("3D-Ansicht")).toHaveAttribute("aria-pressed", "true");
  });

  it.each([["grafik"], ["3D"], [""], ["{}"]])("fällt bei ungültigem Wert %j sicher auf den 2D-Editor", async (wert) => {
    window.localStorage.setItem("elektroplan.electrical.ansicht", wert);
    zeigen();
    await screen.findByRole("application", { name: /Grundriss/ });
    expect(knopf("2D-Editor")).toHaveAttribute("aria-pressed", "true");
  });

  it("alte gespeicherte Werte gelten weiter", async () => {
    window.localStorage.setItem("elektroplan.electrical.ansicht", "tabelle");
    zeigen();
    await waitFor(() => expect(knopf("Tabellen & Details")).toHaveAttribute("aria-pressed", "true"));
  });

  it("zwischen 3D und Tabelle wird ohne Rückfrage gewechselt; zurück zum Editor ohne Verlust", async () => {
    const frage = vi.spyOn(window, "confirm");
    window.localStorage.setItem("elektroplan.electrical.ansicht", "3d");
    zeigen();
    await screen.findByText(/7 von 7 Räumen dargestellt/);
    fireEvent.click(knopf("Tabellen & Details"));
    fireEvent.click(knopf("3D-Ansicht"));
    await screen.findByText(/7 von 7 Räumen dargestellt/);
    fireEvent.click(knopf("2D-Editor"));
    expect(await screen.findByRole("button", { name: /0.03 Flur/ })).toBeInTheDocument();
    expect(frage).not.toHaveBeenCalled();
    // 3D verlassen: kein Canvas bleibt zurück.
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("Geschosswechsel lädt die Szene für das neue Geschoss", async () => {
    window.localStorage.setItem("elektroplan.electrical.ansicht", "3d");
    zeigen();
    await screen.findByText(/7 von 7 Räumen dargestellt/);
    fireEvent.change(screen.getByLabelText("Geschoss"), { target: { value: "geschoss-2" } });
    expect(await screen.findByText(/1 von 1 Räumen dargestellt/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/api/v1/modules/electrical/floors/{floor_id}/plan", {
      path: { floor_id: "geschoss-2" },
    });
    expect(screen.getByRole("application", { name: "3D-Ansicht Hauptgebäude · Obergeschoss" })).toBeInTheDocument();
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("archiviertes Projekt ist in 3D vollständig lesbar", async () => {
    projekt = { ...projekt, status: "archived" };
    window.localStorage.setItem("elektroplan.electrical.ansicht", "3d");
    zeigen();
    expect(await screen.findByText(/7 von 7 Räumen dargestellt/)).toBeInTheDocument();
    expect(screen.getByText(/schreibgeschützt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ansicht zurücksetzen" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Speichern|Raum anlegen/ })).toBeNull();
  });

  it("ohne WebGL: Hinweis statt Absturz, Weg zurück zum 2D-Editor", async () => {
    zustand.webgl = false;
    window.localStorage.setItem("elektroplan.electrical.ansicht", "3d");
    zeigen();
    expect(await screen.findByText(/in diesem Browser nicht verfügbar/)).toBeInTheDocument();
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Zum 2D-Editor" }));
    expect(await screen.findByRole("application", { name: /Grundriss/ })).toBeInTheDocument();
  });
});

describe("Lade-Grenze der 3D-Ansicht", () => {
  it("fängt ein gescheitertes Nachladen ab und versucht es erneut", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const echt = await import("./ansicht3d/Ansicht3d");
    const laden = vi
      .fn<() => Promise<typeof echt>>()
      .mockRejectedValueOnce(new Error("Chunk nicht erreichbar"))
      .mockResolvedValue(echt);
    const onAnsicht = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}><RueckfrageProvider>
        <Ansicht3dLaden floorId="geschoss-1" geschossLabel="EG" onAnsicht={onAnsicht} laden={laden} />
      </RueckfrageProvider></QueryClientProvider>,
    );
    expect(await screen.findByText(/konnte nicht geladen werden/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByText(/7 von 7 Räumen dargestellt/)).toBeInTheDocument();
    expect(laden).toHaveBeenCalledTimes(2);
  });
});
