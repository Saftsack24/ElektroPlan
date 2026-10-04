import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { RueckfrageProvider } from "../../../core/ui/Rueckfrage";
import { rechteck } from "../ansicht3d/testplan";

/**
 * Gerätesymbole im Grundriss (Phase 5): versetzte Symbole zeigen mit einer
 * Zuordnungslinie auf ihren Montagepunkt, dichte Stellen werden zur Gruppe.
 * „0.01 Wohnzimmer“ 0…5000 × 0…4000; Wand 0 läuft (0,0)->(5000,0), innen = +y.
 */
const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }), usePermission: () => true }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ projectId: "projekt-1" }) }));

const { default: RoomsTab } = await import("../RoomsTab");

const typ = (key: string, label: string, teile: Partial<Record<string, unknown>>) => ({
  key,
  label,
  category: "socket",
  symbol_key: key,
  allows_wall_interior: true,
  allows_wall_exterior: false,
  allows_ceiling: false,
  default_center_height_mm: 300,
  width_mm: 80,
  height_mm: 80,
  sort_order: 10,
  is_active: true,
  ...teile,
});
const TYPEN = [
  typ("socket_single", "Steckdose", {}),
  typ("light_wall", "Wandleuchte (Auslass)", { category: "light", default_center_height_mm: 1800, width_mm: 100, height_mm: 100, sort_order: 15 }),
  typ("socket_outdoor", "Steckdose, außen geeignet", { allows_wall_exterior: true, sort_order: 20 }),
  typ("light_ceiling", "Deckenleuchte (Auslass)", { category: "light", allows_wall_interior: false, allows_ceiling: true, default_center_height_mm: null, width_mm: 100, height_mm: 100, sort_order: 30 }),
];

/** Sechs Deckenauslässe auf 100 mm - zu dicht für einzelne Symbole. */
const DECKE = Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, typ: "light_ceiling", x: 1000 + i * 20, y: 3000, label: `Auslass ${i}` }));

const GERAETE = [
  // Gleicher Grundrisspunkt, verschiedene Höhen.
  { id: "w-steckdose", typ: "socket_single", wand: 0, mitte: 2500, hoehe: 300 },
  { id: "w-leuchte", typ: "light_wall", wand: 0, mitte: 2500, hoehe: 1800 },
  // Dieselbe Wandstelle von außen.
  { id: "w-aussen", typ: "socket_outdoor", wand: 0, seite: "aussen" as const, mitte: 2500, hoehe: 300 },
  ...DECKE,
];

let plan: { floor_id: string; project_id: string; rooms: unknown[] };

beforeEach(() => {
  vi.clearAllMocks();
  act(() => masseinheitSetzen("cm"));
  window.localStorage.setItem("elektroplan.electrical.ansicht", "editor");
  plan = {
    floor_id: "geschoss-1",
    project_id: "projekt-1",
    rooms: [rechteck("raum-1", "Wohnzimmer", [0, 0], [5000, 4000], { nummer: "0.01", geraete: GERAETE })],
  };
  api.get.mockImplementation((pfad: string) => {
    if (pfad === "/api/v1/projects/{project_id}") return Promise.resolve({ id: "projekt-1", status: "active", version: 2 });
    if (pfad.endsWith("/buildings")) return Promise.resolve([{ id: "gebaeude-1", name: "Hauptgebäude" }]);
    if (pfad.endsWith("/floors")) return Promise.resolve([{ id: "geschoss-1", building_id: "gebaeude-1", name: "Erdgeschoss", default_ceiling_height_mm: 2500 }]);
    if (pfad.endsWith("/plan")) return Promise.resolve(plan);
    if (pfad.endsWith("/device-types")) return Promise.resolve(TYPEN);
    return Promise.resolve([]);
  });
});

async function grundriss() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <RueckfrageProvider>
        <RoomsTab />
      </RueckfrageProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("application", { name: /Grundriss/ });
  await screen.findByTestId("grundriss-geraet-w-steckdose");
}

function druecken(ziel: Element) {
  for (const t of ["pointerdown", "pointerup", "click"]) fireEvent(ziel, new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 }));
}

const punkt = (wert: string | null) => (wert ?? "").split(",").map(Number) as [number, number];
const symbolMitte = (id: string) => {
  const r = screen.getByTestId(`grundriss-geraet-${id}`).querySelector("rect.grundriss__geraet-treffer") as SVGRectElement;
  return [Number(r.getAttribute("x")) + 12, Number(r.getAttribute("y")) + 12] as [number, number];
};

describe("Gerätesymbole im Grundriss", () => {
  it("Wandgeräte am gleichen Grundrisspunkt: versetzt, beide mit Linie zum selben Montagepunkt", async () => {
    await grundriss();
    for (const id of ["w-steckdose", "w-leuchte"]) {
      expect(screen.getByTestId(`grundriss-geraet-${id}`).dataset.versetzt).toBe("ja");
      const zuordnung = screen.getByTestId(`grundriss-zuordnung-${id}`);
      const linie = zuordnung.querySelector("line") as SVGLineElement;
      // Linie: vom Symbol zum markierten Montagepunkt.
      expect([Number(linie.getAttribute("x1")), Number(linie.getAttribute("y1"))]).toEqual(symbolMitte(id));
      expect(Number(linie.getAttribute("x2"))).toBeCloseTo(punkt(zuordnung.dataset.montage ?? null)[0], 1);
      expect(zuordnung.querySelector(".grundriss__montagepunkt")).not.toBeNull();
    }
    expect(screen.getByTestId("grundriss-zuordnung-w-steckdose").dataset.montage).toBe(screen.getByTestId("grundriss-zuordnung-w-leuchte").dataset.montage);
    const [a, b] = [symbolMitte("w-steckdose"), symbolMitte("w-leuchte")];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(18);
  });

  it("Innen- und Außengerät derselben Wandstelle: Außen bleibt unversetzt auf der anderen Wandseite", async () => {
    await grundriss();
    expect(screen.getByTestId("grundriss-geraet-w-aussen").dataset.versetzt).toBe("nein");
    expect(screen.queryByTestId("grundriss-zuordnung-w-aussen")).toBeNull();
    // Innen (Raum oberhalb im Bild) gegen außen (unterhalb).
    const montageInnen = punkt(screen.getByTestId("grundriss-zuordnung-w-steckdose").dataset.montage ?? null);
    expect(symbolMitte("w-aussen")[1]).toBeGreaterThan(montageInnen[1]);
    expect(symbolMitte("w-steckdose")[1]).toBeLessThan(montageInnen[1]);
  });

  it("dichte Deckengeräte: Gruppe mit Anzahl und Montagepunkten; Aufklappen und Auswahl treffen das richtige Gerät", async () => {
    await grundriss();
    const gruppe = screen.getByTestId("grundriss-geraetegruppe-d0");
    expect(gruppe.textContent).toContain("6");
    expect(gruppe.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("grundriss-geraet-d3")).toBeNull();
    // Montagepunkte aller Mitglieder sind markiert (Decke: Ring).
    expect(screen.getByTestId("grundriss-gruppenzuordnung-d0").querySelectorAll(".grundriss__montagepunkt--decke")).toHaveLength(6);

    druecken(gruppe);
    const d3 = await screen.findByTestId("grundriss-geraet-d3");
    expect(screen.getByTestId("grundriss-geraetegruppe-d0").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("grundriss-zuordnung-d3")).toBeTruthy();

    druecken(d3.querySelector("rect.grundriss__geraet-treffer") as Element);
    await waitFor(() => expect(screen.getByTestId("grundriss-geraet-d3").getAttribute("class")).toContain("grundriss__geraet--ausgewaehlt"));
    expect(screen.getByTestId("grundriss-zuordnung-d3").getAttribute("class")).toContain("grundriss__zuordnung--ausgewaehlt");
    for (const andere of ["d0", "d1", "d2", "d4", "d5"]) {
      expect(screen.getByTestId(`grundriss-geraet-${andere}`).getAttribute("class")).not.toContain("--ausgewaehlt");
    }
    // Die Gruppe des gewählten Geräts bleibt sichtbar aufgeklappt.
    druecken(screen.getByTestId("grundriss-geraetegruppe-d0"));
    expect(screen.getByTestId("grundriss-geraet-d3")).toBeTruthy();
  });

  it("Auswahl eines versetzten Wandsymbols trifft genau dieses Gerät; nichts wird gespeichert oder verschoben", async () => {
    await grundriss();
    druecken(screen.getByTestId("grundriss-geraet-w-leuchte").querySelector("rect.grundriss__geraet-treffer") as Element);
    await waitFor(() => expect(screen.getByTestId("grundriss-geraet-w-leuchte").getAttribute("class")).toContain("--ausgewaehlt"));
    expect(screen.getByTestId("grundriss-geraet-w-steckdose").getAttribute("class")).not.toContain("--ausgewaehlt");
    // Die Eigenschaften zeigen die gespeicherte Höhe der Wandleuchte (180 cm), nicht die der Steckdose.
    expect(await screen.findByText(/Wand 1 · Mitte 180 cm über Boden/)).toBeTruthy();
    expect(screen.queryByText(/Wand 1 · Mitte 30 cm über Boden/)).toBeNull();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});
