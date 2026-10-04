import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Auswahl, Szenenmodell } from "./modell";
import type { Geraetesichtbarkeit, Rueckmeldung } from "./szene";
import { plan, rechteck } from "./testplan";

/** 3D-Ansicht mit Geräten (Phase 5): Schalter, Auswahl, „An Wand/Decke bearbeiten“, Rückkehr. */
const api = { get: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }) }));

const { default: Ansicht3d } = await import("./Ansicht3d");

class Attrappe {
  readonly setzePlan = vi.fn<(modell: Szenenmodell, optionen: { einpassen: boolean }) => void>();
  readonly setzeAuswahl = vi.fn<(auswahl: Auswahl | null) => void>();
  readonly setzeGeraetesichtbarkeit = vi.fn<(s: Geraetesichtbarkeit) => void>();
  readonly einpassen = vi.fn();
  readonly standardansicht = vi.fn();
  readonly draufsicht = vi.fn();
  readonly zoomen = vi.fn();
  readonly entsorgen = vi.fn();
  readonly kamerastand = vi.fn(() => ({ position: [1, 2, 3] as const, ziel: [0, 0, 0] as const }));
  readonly kamerastandSetzen = vi.fn();
  constructor(
    readonly behaelter: HTMLElement,
    readonly rueckmeldung: Rueckmeldung,
  ) {}
}

let szenen: Attrappe[];
const onWandansicht = vi.fn();
const onDeckenansicht = vi.fn();
const fabrik = (b: HTMLElement, r: Rueckmeldung) => {
  const s = new Attrappe(b, r);
  szenen.push(s);
  return s;
};

const PLAN = plan([
  rechteck("wohnen", "Wohnen", [0, 0], [5000, 4000], {
    geraete: [
      { id: "leuchte", typ: "light_ceiling", x: 2500, y: 2000 },
      { id: "aussen", typ: "light_outdoor", wand: 0, seite: "aussen", mitte: 2000, hoehe: 2000 },
    ],
  }),
]);

beforeEach(() => {
  vi.clearAllMocks();
  szenen = [];
  api.get.mockImplementation((pfad: string) => Promise.resolve(pfad.endsWith("/device-types") ? [] : PLAN));
});

function zeigen(anfang?: Parameters<typeof Ansicht3d>[0]["anfang"]) {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={c}>
      <Ansicht3d
        floorId="geschoss-1"
        geschossLabel="EG"
        onAnsicht={vi.fn()}
        onWandansicht={onWandansicht}
        onDeckenansicht={onDeckenansicht}
        anfang={anfang ?? null}
        szeneErzeugen={fabrik}
      />
    </QueryClientProvider>,
  );
}

const waehlen = (auswahl: Auswahl) => act(() => szenen.at(-1)!.rueckmeldung.auswahl(auswahl));

describe("Geräte in der 3D-Ansicht (Phase 5)", () => {
  it("Schalter direkt über der Ansicht: Standard Wand und Decke sichtbar, zugänglicher Zustand", async () => {
    zeigen();
    await screen.findByText(/2 Geräte/);
    const gruppe = screen.getByRole("group", { name: "Geräte in der 3D-Ansicht" });
    const wand = within(gruppe).getByRole("button", { name: /Wandgeräte/ });
    const decke = within(gruppe).getByRole("button", { name: /Deckengeräte/ });
    const text = within(gruppe).getByRole("button", { name: /Beschriftungen/ });
    expect([wand, decke, text].map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "true", "false"]);
    expect(szenen[0]!.setzeGeraetesichtbarkeit).toHaveBeenLastCalledWith({ wand: true, decke: true, beschriftung: false });
    fireEvent.click(text);
    fireEvent.click(wand);
    expect(szenen[0]!.setzeGeraetesichtbarkeit).toHaveBeenLastCalledWith({ wand: false, decke: true, beschriftung: true });
    expect(wand).toHaveAttribute("aria-pressed", "false");
  });

  it("Deckengerät: Eigenschaften in der Seitenleiste und „An Decke bearbeiten“ mit Kamera und Auswahl", async () => {
    zeigen();
    await screen.findByText(/2 Geräte/);
    waehlen({ art: "geraet", id: "leuchte" });
    const seite = screen.getByRole("complementary", { name: "Informationen zur 3D-Ansicht" });
    expect(within(seite).getByText(/Deckenhöhe des Raums/)).toBeInTheDocument();
    fireEvent.click(within(seite).getByRole("button", { name: "An Decke bearbeiten" }));
    expect(onDeckenansicht).toHaveBeenCalledWith(
      { raumId: "wohnen", geraetId: "leuchte" },
      {
        floorId: "geschoss-1",
        kamera: { position: [1, 2, 3], ziel: [0, 0, 0] },
        auswahl: { art: "geraet", id: "leuchte" },
        sichtbarkeit: { wand: true, decke: true, beschriftung: false },
      },
    );
  });

  it("Wandgerät außen: „An Wand bearbeiten“ öffnet die Außenseite mit dem Gerät", async () => {
    zeigen();
    await screen.findByText(/2 Geräte/);
    waehlen({ art: "geraet", id: "aussen" });
    fireEvent.click(screen.getByRole("button", { name: "An Wand bearbeiten" }));
    expect(onWandansicht).toHaveBeenCalledWith({ raumId: "wohnen", wandId: "wohnen-w0", seite: "aussen", geraetId: "aussen" }, expect.anything());
  });

  it("ausgeblendetes Gerät verliert die Auswahl; Rückkehr stellt Kamera, Auswahl und Schalter her", async () => {
    const { unmount } = zeigen();
    await screen.findByText(/2 Geräte/);
    waehlen({ art: "geraet", id: "leuchte" });
    fireEvent.click(screen.getByRole("button", { name: /Deckengeräte/ }));
    expect(szenen[0]!.setzeAuswahl).toHaveBeenLastCalledWith(null);
    unmount();

    zeigen({
      floorId: "geschoss-1",
      kamera: { position: [4, 5, 6], ziel: [1, 0, 1] },
      auswahl: { art: "geraet", id: "aussen" },
      sichtbarkeit: { wand: true, decke: false, beschriftung: true },
    });
    await screen.findByText(/2 Geräte/);
    const s = szenen.at(-1)!;
    expect(s.kamerastandSetzen).toHaveBeenCalledWith({ position: [4, 5, 6], ziel: [1, 0, 1] });
    expect(s.setzeAuswahl).toHaveBeenLastCalledWith({ art: "geraet", id: "aussen" });
    expect(s.setzeGeraetesichtbarkeit).toHaveBeenLastCalledWith({ wand: true, decke: false, beschriftung: true });
  });
});
