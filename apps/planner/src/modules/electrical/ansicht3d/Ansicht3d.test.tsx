import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Profiler, StrictMode } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { darstellungAbonnieren, darstellungBenutzerSetzen, darstellungSpeichern, darstellungVorschauen } from "../../../core/theme/darstellung";
import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import type { Auswahl, Geschossplan, Szenenmodell } from "./modell";
import { Grundrissszene } from "./szene";
import type { Rueckmeldung } from "./szene";
import { testumgebung } from "./szenentest";
import { einfamilienhaus, plan, rechteck } from "./testplan";

/**
 * 3D-Ansicht als React-Komponente (Phase 4b).
 *
 * Die Szene wird über `szeneErzeugen` ersetzt: entweder durch eine
 * aufzeichnende Attrappe oder durch die echte `Grundrissszene` auf
 * Test-Doubles für WebGL. So bleibt geprüft, dass React die Szene einmal
 * erzeugt, gezielt aktualisiert und vollständig entsorgt.
 */
const api = { get: vi.fn() };
vi.mock("../../../core/auth/AuthProvider", () => ({ useAuth: () => ({ api }) }));

const { default: Ansicht3d } = await import("./Ansicht3d");

class Attrappe {
  readonly setzePlan = vi.fn<(modell: Szenenmodell, optionen: { einpassen: boolean }) => void>();
  readonly setzeAuswahl = vi.fn<(auswahl: Auswahl | null) => void>();
  readonly einpassen = vi.fn();
  readonly standardansicht = vi.fn();
  readonly draufsicht = vi.fn();
  readonly zoomen = vi.fn<(faktor: number) => void>();
  readonly entsorgen = vi.fn();
  constructor(
    readonly behaelter: HTMLElement,
    readonly rueckmeldung: Rueckmeldung,
  ) {}
}

let szenen: Attrappe[];
let fabrik: ReturnType<typeof vi.fn<(b: HTMLElement, r: Rueckmeldung) => Attrappe>>;
let plaene: Record<string, Geschossplan | Error>;
const onAnsicht = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  szenen = [];
  fabrik = vi.fn((b: HTMLElement, r: Rueckmeldung) => {
    const s = new Attrappe(b, r);
    szenen.push(s);
    return s;
  });
  plaene = { "geschoss-1": einfamilienhaus(), "geschoss-2": plan([], "geschoss-2") };
  api.get.mockImplementation((_pfad: string, optionen: { path: { floor_id: string } }) => {
    const p = plaene[optionen.path.floor_id];
    return p instanceof Error ? Promise.reject(p) : Promise.resolve(p);
  });
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function zeigen(
  props: Partial<{ floorId: string; szeneErzeugen: typeof fabrik | ((b: HTMLElement, r: Rueckmeldung) => Grundrissszene) }> = {},
  huelle: (kind: ReactNode) => ReactNode = (kind) => kind,
) {
  const c = client();
  const element = (p: typeof props) => (
    <QueryClientProvider client={c}>
      {huelle(
        <Ansicht3d
          floorId={p.floorId ?? "geschoss-1"}
          geschossLabel="Hauptgebäude · Erdgeschoss"
          onAnsicht={onAnsicht}
          szeneErzeugen={p.szeneErzeugen ?? fabrik}
        />,
      )}
    </QueryClientProvider>
  );
  const ergebnis = render(element(props));
  return { ...ergebnis, neu: (p: typeof props = props) => ergebnis.rerender(element(p)) };
}

async function geladen() {
  await screen.findByText(/7 von 7 Räumen dargestellt/);
}

function waehlen(auswahl: Auswahl) {
  act(() => szenen.at(-1)!.rueckmeldung.auswahl(auswahl));
}

describe("Lebenszyklus", () => {
  it("erzeugt die Szene einmal und übergibt den Plan mit Einpassen", async () => {
    zeigen();
    await geladen();
    expect(fabrik).toHaveBeenCalledTimes(1);
    const aufrufe = szenen[0]!.setzePlan.mock.calls;
    const letzter = aufrufe.at(-1)!;
    expect(letzter[0].raeume).toHaveLength(7);
    expect(letzter[1]).toEqual({ einpassen: true });
    expect(screen.getByRole("application", { name: "3D-Ansicht Hauptgebäude · Erdgeschoss" })).toBe(
      szenen[0]!.behaelter,
    );
  });

  it("baut bei einem reinen React-Re-Render nichts neu auf", async () => {
    const { neu } = zeigen();
    await geladen();
    const planAufrufe = szenen[0]!.setzePlan.mock.calls.length;
    neu();
    neu();
    expect(fabrik).toHaveBeenCalledTimes(1);
    expect(szenen[0]!.setzePlan.mock.calls.length).toBe(planAufrufe);
  });

  it("Geschosswechsel: dieselbe Szene, neuer Plan, erneut eingepasst", async () => {
    const { neu } = zeigen();
    await geladen();
    neu({ floorId: "geschoss-2" });
    expect(await screen.findByText(/noch kein Raum erfasst/)).toBeInTheDocument();
    expect(fabrik).toHaveBeenCalledTimes(1);
    const letzter = szenen[0]!.setzePlan.mock.calls.at(-1)!;
    expect(letzter[0].floorId).toBe("geschoss-2");
    expect(letzter[1]).toEqual({ einpassen: true });
  });

  it("entsorgt die Szene beim Unmount", async () => {
    const { unmount } = zeigen();
    await geladen();
    unmount();
    expect(szenen[0]!.entsorgen).toHaveBeenCalledTimes(1);
  });

  it("StrictMode: am Ende genau eine Szene, ein Canvas, keine verwaiste Bildschleife", async () => {
    const umgebungen: ReturnType<typeof testumgebung>[] = [];
    const echte = (b: HTMLElement, r: Rueckmeldung) => {
      const t = testumgebung();
      umgebungen.push(t);
      return new Grundrissszene(b, t.umgebung, r);
    };
    const { unmount } = zeigen({ szeneErzeugen: echte }, (kind) => <StrictMode>{kind}</StrictMode>);
    await geladen();
    expect(umgebungen.length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    const lebendig = umgebungen.filter((t) => t.renderer.dispose.mock.calls.length === 0);
    expect(lebendig).toHaveLength(1);
    // Verworfene Instanzen fordern keine Bilder mehr an.
    for (const t of umgebungen) if (t !== lebendig[0]) expect(t.offeneBilder).toBe(0);
    unmount();
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    for (const t of umgebungen) {
      expect(t.renderer.dispose).toHaveBeenCalledTimes(1);
      expect(t.offeneBilder).toBe(0);
    }
  });

  it("eine Kamerabewegung löst keinen React-Render aus", async () => {
    const umgebungen: ReturnType<typeof testumgebung>[] = [];
    const echte = (b: HTMLElement, r: Rueckmeldung) => {
      const t = testumgebung();
      umgebungen.push(t);
      return new Grundrissszene(b, t.umgebung, r);
    };
    const commits = vi.fn();
    zeigen({ szeneErzeugen: echte }, (kind) => (
      <Profiler id="3d" onRender={commits}>
        {kind}
      </Profiler>
    ));
    await geladen();
    const t = umgebungen[0]!;
    const vorher = commits.mock.calls.length;
    act(() => {
      t.controls.bewegen(30);
      for (let i = 0; i < 40; i += 1) t.bild();
    });
    expect(t.renderer.render.mock.calls.length).toBeGreaterThan(30);
    expect(commits.mock.calls.length).toBe(vorher);
  });
  it("Theme-Wechsel bei geöffneter Ansicht: dieselbe Szene, ein Canvas, kein React-Render", async () => {
    const umgebungen: ReturnType<typeof testumgebung>[] = [];
    const echte = (b: HTMLElement, r: Rueckmeldung) => {
      const t = testumgebung();
      // Die echte Core-Schnittstelle meldet den Wechsel - wie im Browser.
      t.umgebung.farbwechselBeobachten = darstellungAbonnieren;
      umgebungen.push(t);
      return new Grundrissszene(b, t.umgebung, r);
    };
    const commits = vi.fn();
    darstellungBenutzerSetzen("11111111-1111-4111-8111-111111111111");
    zeigen({ szeneErzeugen: echte }, (kind) => (
      <Profiler id="3d" onRender={commits}>
        {kind}
      </Profiler>
    ));
    await geladen();
    const t = umgebungen[0]!;
    act(() => t.bild());
    const farben = vi.spyOn(t.umgebung, "farben");
    const vorher = commits.mock.calls.length;
    act(() => {
      darstellungVorschauen({ modus: "dark", akzent: "teal" });
      darstellungSpeichern({ modus: "light", akzent: "orange" });
      darstellungSpeichern({ modus: "dark", akzent: "green" });
    });
    // Jeder Wechsel liest die Farben neu; gezeichnet wird höchstens ein Bild.
    expect(farben).toHaveBeenCalledTimes(3);
    expect(t.offeneBilder).toBe(1);
    expect(umgebungen).toHaveLength(1);
    expect(t.rendererErzeugen).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    expect(commits.mock.calls.length).toBe(vorher);
  });
});

describe("Zustände", () => {
  it("zeigt den Ladezustand", () => {
    api.get.mockReturnValue(new Promise(() => undefined));
    zeigen();
    expect(screen.getByText("Plan wird geladen …")).toBeInTheDocument();
  });

  it("meldet einen Ladefehler und lädt auf Wunsch erneut", async () => {
    plaene["geschoss-1"] = new Error("Netz");
    zeigen();
    expect(await screen.findByText(/konnte nicht geladen werden/)).toBeInTheDocument();
    plaene["geschoss-1"] = einfamilienhaus();
    fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));
    await geladen();
  });

  it("Geschoss ohne Räume ist ein normaler, leerer Zustand", async () => {
    zeigen({ floorId: "geschoss-2" });
    expect(await screen.findByText(/noch kein Raum erfasst/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zum 2D-Editor" }));
    expect(onAnsicht).toHaveBeenCalledWith("editor");
  });

  it("nennt Räume ohne gültige Kontur und stellt nichts Falsches dar", async () => {
    plaene["geschoss-1"] = plan([
      rechteck("e", "Abstellraum", [0, 0], [2000, 2000], { status: "draft", nummer: "0.09" }),
    ]);
    zeigen();
    expect(await screen.findByText(/Kein Raum dieses Geschosses hat eine geschlossene Kontur/)).toBeInTheDocument();
    const liste = screen.getByRole("heading", { name: "Nicht dargestellt (1)" }).parentElement!;
    expect(within(liste).getByText("0.09 Abstellraum")).toBeInTheDocument();
    expect(szenen[0]!.setzePlan.mock.calls.at(-1)![0].raeume).toEqual([]);
  });

  it("teilweise darstellbarer Plan: Warnungen und ausgelassene Räume stehen als Text", async () => {
    const haus = einfamilienhaus();
    plaene["geschoss-1"] = {
      ...haus,
      rooms: [...haus.rooms, rechteck("e", "Gäste-WC", [20_000, 0], [22_000, 2000], { status: "draft" })],
    };
    zeigen();
    expect(await screen.findByText(/7 von 8 Räumen dargestellt/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nicht dargestellt (1)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hinweise zur Darstellung (2)" })).toBeInTheDocument();
    // Nicht nur Farbe: jeder Hinweis trägt das Wort „Hinweis“.
    expect(screen.getByText(/^Hinweis: Öffnung auf beiden Raumseiten erfasst$/)).toBeInTheDocument();
    expect(screen.getByText(/^Hinweis: Öffnungsart widersprüchlich$/)).toBeInTheDocument();
    // Einmal gespeicherte Türen an gemeinsamen Wänden sind keine Auffälligkeit mehr.
    expect(screen.queryByText(/nur auf einer Raumseite/)).toBeNull();
  });

  it("WebGL nicht verfügbar: Hinweis mit Weg zum 2D-Editor und zur Tabelle", async () => {
    zeigen({
      szeneErzeugen: () => {
        throw new Error("kein WebGL");
      },
    });
    expect(await screen.findByText(/in diesem Browser nicht verfügbar/)).toBeInTheDocument();
    expect(screen.queryByRole("application")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Zu Tabellen & Details" }));
    expect(onAnsicht).toHaveBeenCalledWith("tabelle");
    // Die Informationen bleiben als Text verfügbar.
    await geladen();
    for (const knopf of ["Ansicht zurücksetzen", "Draufsicht"]) {
      expect(screen.getByRole("button", { name: knopf })).toBeDisabled();
    }
  });

  it("WebGL-Kontext verloren: Hinweis und Neustart mit frischer Szene", async () => {
    zeigen();
    await geladen();
    act(() => szenen[0]!.rueckmeldung.kontextVerloren());
    expect(screen.getByText(/WebGL-Kontext verloren/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ansicht neu starten" }));
    expect(szenen[0]!.entsorgen).toHaveBeenCalledTimes(1);
    expect(fabrik).toHaveBeenCalledTimes(2);
    expect(szenen[1]!.setzePlan.mock.calls.at(-1)![1]).toEqual({ einpassen: true });
    expect(screen.queryByText(/WebGL-Kontext verloren/)).toBeNull();
  });
});

describe("Auswahl und Bedienung", () => {
  it("zeigt einen ausgewählten Raum mit Fachdaten - ohne Eingabefelder", async () => {
    zeigen();
    await geladen();
    waehlen({ art: "raum", id: "flur" });
    const seite = screen.getByRole("complementary", { name: "Informationen zur 3D-Ansicht" });
    expect(within(seite).getByRole("heading", { name: "Raum 0.03 Flur" })).toBeInTheDocument();
    expect(within(seite).getByText("250 cm")).toBeInTheDocument();
    expect(within(seite).getByText("8")).toBeInTheDocument(); // Wände
    expect(within(seite).queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Speichern/ })).toBeNull();
    expect(szenen[0]!.setzeAuswahl).toHaveBeenLastCalledWith({ art: "raum", id: "flur" });
  });

  it("zeigt eine gemeinsame Wand mit Länge, Stärke, Höhe, Lage und Räumen", async () => {
    zeigen();
    await geladen();
    waehlen({ art: "wand", id: "flur-w1+hwr-w3" });
    const seite = screen.getByRole("complementary", { name: "Informationen zur 3D-Ansicht" });
    expect(within(seite).getByRole("heading", { name: "Gemeinsame Wand" })).toBeInTheDocument();
    expect(within(seite).getByText("400 cm")).toBeInTheDocument();
    expect(within(seite).getByText("11,5 cm")).toBeInTheDocument();
    expect(within(seite).getByText(/Gemeinsame Wand \(innen\) zwischen „0.03 Flur“ und „0.05 HWR“/)).toBeInTheDocument();
    expect(within(seite).getByText("0.03 Flur, 0.05 HWR")).toBeInTheDocument();
  });

  it("folgt der persönlichen Maßeinheit sofort - ohne neu einzupassen", async () => {
    zeigen();
    await geladen();
    waehlen({ art: "wand", id: "flur-w1+hwr-w3" });
    const seite = screen.getByRole("complementary", { name: "Informationen zur 3D-Ansicht" });
    expect(within(seite).getByText("400 cm")).toBeInTheDocument();
    const aufrufe = szenen[0]!.setzePlan.mock.calls.length;

    act(() => masseinheitSetzen("mm"));

    expect(within(seite).getByText("4.000 mm")).toBeInTheDocument();
    expect(within(seite).getByText("115 mm")).toBeInTheDocument();
    // Nur die Texte ändern sich: Die Szene wird ersetzt, aber nicht eingepasst.
    expect(szenen[0]!.setzePlan.mock.calls.length).toBe(aufrufe + 1);
    expect(szenen[0]!.setzePlan.mock.calls.at(-1)![1]).toEqual({ einpassen: false });
    expect(screen.getAllByText(/Tür 885 mm × 2\.010 mm/).length).toBeGreaterThan(0);
  });

  it("zeigt eine einmal gespeicherte gemeinsame Tür mit beiden Räumen - ohne Warnung", async () => {
    zeigen();
    await geladen();
    waehlen({ art: "oeffnung", id: "t-hwr" });
    const auswahl = screen.getByRole("heading", { name: "Auswahl" }).parentElement!;
    expect(within(auswahl).getByRole("heading", { name: "Tür" })).toBeInTheDocument();
    expect(within(auswahl).getByText("88,5 cm")).toBeInTheDocument();
    expect(within(auswahl).getByText("201 cm")).toBeInTheDocument();
    expect(within(auswahl).getByText("0 cm")).toBeInTheDocument();
    expect(within(auswahl).getByText("0.03 Flur")).toBeInTheDocument(); // gespeichert in
    expect(within(auswahl).getByText("Verbindet „0.03 Flur“ und „0.05 HWR“")).toBeInTheDocument();
    expect(within(auswahl).queryByText(/Hinweis:/)).toBeNull();
  });

  it("Escape hebt die Auswahl auf", async () => {
    zeigen();
    await geladen();
    waehlen({ art: "raum", id: "flur" });
    fireEvent.keyDown(screen.getByRole("application"), { key: "Escape" });
    expect(screen.getByText(/Nichts ausgewählt/)).toBeInTheDocument();
    expect(szenen[0]!.setzeAuswahl).toHaveBeenLastCalledWith(null);
  });

  it("ein Hinweis führt zum betroffenen Objekt", async () => {
    zeigen();
    await geladen();
    const hinweise = screen.getByRole("heading", { name: "Hinweise zur Darstellung (2)" }).parentElement!;
    fireEvent.click(within(hinweise).getAllByRole("button", { name: "In der Ansicht zeigen" })[0]!);
    expect(szenen[0]!.setzeAuswahl.mock.calls.at(-1)![0]?.art).toBe("oeffnung");
  });

  it("Auswahl bleibt nach dem Neuladen erhalten und verschwindet mit dem Objekt", async () => {
    const c = client();
    const anzeigen = () => (
      <QueryClientProvider client={c}>
        <Ansicht3d floorId="geschoss-1" geschossLabel="EG" onAnsicht={onAnsicht} szeneErzeugen={fabrik} />
      </QueryClientProvider>
    );
    render(anzeigen());
    await geladen();
    waehlen({ art: "raum", id: "kind" });

    const haus = einfamilienhaus();
    plaene["geschoss-1"] = { ...haus, rooms: haus.rooms.map((r) => (r.id === "kind" ? { ...r, name: "Kinderzimmer" } : r)) };
    await act(() => c.invalidateQueries());
    expect(await screen.findByRole("heading", { name: "Raum 0.07 Kinderzimmer" })).toBeInTheDocument();
    expect(szenen[0]!.setzePlan.mock.calls.at(-1)![1]).toEqual({ einpassen: false });

    plaene["geschoss-1"] = { ...haus, rooms: haus.rooms.filter((r) => r.id !== "kind") };
    await act(() => c.invalidateQueries());
    await waitFor(() => expect(screen.getByText(/Nichts ausgewählt/)).toBeInTheDocument());
    expect(szenen[0]!.setzeAuswahl).toHaveBeenLastCalledWith(null);
  });

  it("Kamerabedienknöpfe sind Knöpfe und steuern die Szene", async () => {
    zeigen();
    await geladen();
    const leiste = screen.getByRole("toolbar", { name: "Kamera der 3D-Ansicht" });
    fireEvent.click(within(leiste).getByRole("button", { name: "Ansicht zurücksetzen" }));
    fireEvent.click(within(leiste).getByRole("button", { name: "Isometrische Ansicht" }));
    fireEvent.click(within(leiste).getByRole("button", { name: "Draufsicht" }));
    fireEvent.click(within(leiste).getByRole("button", { name: "Näher" }));
    fireEvent.click(within(leiste).getByRole("button", { name: "Weiter weg" }));
    const s = szenen[0]!;
    expect(s.einpassen).toHaveBeenCalledTimes(1);
    expect(s.standardansicht).toHaveBeenCalledTimes(1);
    expect(s.draufsicht).toHaveBeenCalledTimes(1);
    expect(s.zoomen.mock.calls).toEqual([[1.25], [0.8]]);
    // Tastatur: echte Knöpfe, erreichbar, nicht deaktiviert.
    for (const knopf of within(leiste).getAllByRole("button")) {
      expect(knopf.tagName).toBe("BUTTON");
      expect(knopf).toBeEnabled();
    }
    // Kurze sichtbare Bedienhilfe.
    expect(screen.getByText(/Drehen: linke Maustaste ziehen/)).toBeInTheDocument();
  });
});
