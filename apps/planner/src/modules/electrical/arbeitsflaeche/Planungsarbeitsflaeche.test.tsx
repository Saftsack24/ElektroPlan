import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Leitungskontext } from "../leitung/kontext";
import { Entwurfsleiste, RueckgaengigKnoepfe } from "./Kontextleiste";
import type { Arbeitsflaechenzustand } from "./Planungsarbeitsflaeche";
import { Planungsarbeitsflaeche, useArbeitsflaeche } from "./Planungsarbeitsflaeche";

/**
 * Planungsarbeitsfläche (Phase 6c.0) als Baustein: Panel, Maximierung, Tastatur,
 * Fokus und – entscheidend – kein Neueinhängen der Zeichenfläche.
 *
 * jsdom rechnet kein Layout: Diese Tests prüfen Zustand, Zugänglichkeit und
 * Erhalt im Baum, nicht Pixelmaße. Die Geometrie wird im Browser geprüft.
 */

let eingehaengt = 0;

/** Steht für eine Zeichenfläche mit eigenem Zustand (wie Viewport und Zeigerbewegung). */
function Flaeche() {
  const [zaehler, setZaehler] = useState(0);
  useEffect(() => {
    eingehaengt += 1;
  }, []);
  return (
    <button type="button" onClick={() => setZaehler((z) => z + 1)} data-testid="flaeche">
      Klicks {zaehler}
    </button>
  );
}

let zustand: Arbeitsflaechenzustand | null = null;

function Probe({ markierung = null as string | null }) {
  const af = useArbeitsflaeche();
  zustand = af;
  return (
    <Planungsarbeitsflaeche
      zustand={af}
      name="Probe-Arbeitsfläche"
      markierung={markierung}
      kopf={<p>Kopfzeile</p>}
      werkzeuge={<span>Werkzeuge</span>}
      kontext={<p>Kontext</p>}
      eigenschaften={<input aria-label="Name im Panel" />}
    >
      <Flaeche />
    </Planungsarbeitsflaeche>
  );
}

function matchMediaSetzen(breit: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: breit, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  eingehaengt = 0;
  zustand = null;
});

const eigenschaftenKnopf = () => screen.getByRole("button", { name: "Eigenschaften" });
const panel = () => screen.getByTestId("eigenschaftenpanel");

describe("Eigenschaftenpanel", () => {
  it("ist standardmäßig eingeklappt, inert und für Hilfstechnik verborgen", () => {
    render(<Probe />);
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "false");
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-controls", panel().id);
    expect(panel()).toHaveAttribute("inert");
    expect(panel()).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("textbox", { name: "Name im Panel" })).toBeNull();
    expect(screen.getByRole("region", { name: "Probe-Arbeitsfläche" })).toHaveAttribute("data-eigenschaften", "zu");
  });

  it("öffnet per Knopf mit Fokus in den Panelkopf und gibt ihn beim Schließen zurück", () => {
    render(<Probe />);
    eigenschaftenKnopf().focus();
    fireEvent.click(eigenschaftenKnopf());
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "true");
    expect(panel()).not.toHaveAttribute("inert");
    expect(panel()).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("textbox", { name: "Name im Panel" })).toBeInTheDocument();
    expect(document.activeElement).toBe(within(panel()).getByRole("heading", { name: "Eigenschaften" }));
    fireEvent.click(within(panel()).getByRole("button", { name: "Eigenschaften einklappen" }));
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(eigenschaftenKnopf());
  });

  it("zeigt bei eingeklapptem Panel eine kurze Markierung am Knopf", () => {
    render(<Probe markierung="Leitung" />);
    expect(screen.getByTestId("eigenschaften-markierung")).toHaveTextContent("Leitung");
    fireEvent.click(eigenschaftenKnopf());
    expect(screen.queryByTestId("eigenschaften-markierung")).toBeNull();
  });
});

describe("Maximieren und Erhalt der Zeichenfläche", () => {
  it("schaltet nur Klassen: die Zeichenfläche wird nicht neu eingehängt und behält ihren Zustand", () => {
    render(<Probe />);
    const flaeche = screen.getByTestId("flaeche");
    fireEvent.click(flaeche);
    fireEvent.click(flaeche);
    expect(flaeche).toHaveTextContent("Klicks 2");

    fireEvent.click(screen.getByRole("button", { name: "Zeichenfläche maximieren" }));
    const region = screen.getByRole("region", { name: "Probe-Arbeitsfläche" });
    expect(region).toHaveAttribute("data-maximiert");
    expect(region.className).toContain("fixed");
    fireEvent.click(eigenschaftenKnopf());
    fireEvent.click(eigenschaftenKnopf());
    // Eindeutiger Rückweg mit sichtbarem Text.
    fireEvent.click(screen.getByRole("button", { name: "Normale Ansicht" }));
    expect(region).not.toHaveAttribute("data-maximiert");

    expect(screen.getByTestId("flaeche")).toBe(flaeche);
    expect(flaeche).toHaveTextContent("Klicks 2");
    expect(eingehaengt).toBe(1);
  });

  it("M und E schalten per Tastatur; nicht in Eingabefeldern und nicht unter einem fremden Dialog", () => {
    render(<Probe />);
    const region = screen.getByRole("region", { name: "Probe-Arbeitsfläche" });
    fireEvent.keyDown(window, { key: "m" });
    expect(region).toHaveAttribute("data-maximiert");
    fireEvent.keyDown(window, { key: "M" });
    expect(region).not.toHaveAttribute("data-maximiert");
    fireEvent.keyDown(window, { key: "e" });
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "true");

    // Tippen im Panel: kein Kürzel.
    const feld = screen.getByRole("textbox", { name: "Name im Panel" });
    fireEvent.keyDown(feld, { key: "m" });
    fireEvent.keyDown(feld, { key: "e" });
    expect(region).not.toHaveAttribute("data-maximiert");
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "true");

    // Strg+M und wiederholte Tasten sind keine Kürzel der Arbeitsfläche.
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
    fireEvent.keyDown(window, { key: "m", repeat: true });
    expect(region).not.toHaveAttribute("data-maximiert");

    // Eine Rückfrage außerhalb der Arbeitsfläche hat die Tastatur.
    const fremd = document.createElement("dialog");
    fremd.setAttribute("open", "");
    document.body.appendChild(fremd);
    fireEvent.keyDown(window, { key: "m" });
    expect(region).not.toHaveAttribute("data-maximiert");
    fremd.remove();
  });

  it("während einer Zeigerbewegung wechselt das Layout nicht", () => {
    render(<Probe />);
    const region = screen.getByRole("region", { name: "Probe-Arbeitsfläche" });
    fireEvent.pointerDown(screen.getByTestId("flaeche"));
    fireEvent.keyDown(window, { key: "m" });
    expect(region).not.toHaveAttribute("data-maximiert");
    fireEvent.pointerUp(screen.getByTestId("flaeche"));
    fireEvent.keyDown(window, { key: "m" });
    expect(region).toHaveAttribute("data-maximiert");
  });
});

describe("Escape als letzte Stufe", () => {
  it("schmal: zuerst das überlagernde Panel, dann die Maximierung, dann nichts mehr", () => {
    matchMediaSetzen(false);
    render(<Probe />);
    fireEvent.click(eigenschaftenKnopf());
    fireEvent.click(screen.getByRole("button", { name: "Zeichenfläche maximieren" }));
    let erledigt = false;
    act(() => {
      erledigt = zustand?.escape() ?? false;
    });
    expect(erledigt).toBe(true);
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("region", { name: "Probe-Arbeitsfläche" })).toHaveAttribute("data-maximiert");
    act(() => {
      erledigt = zustand?.escape() ?? false;
    });
    expect(erledigt).toBe(true);
    expect(screen.getByRole("region", { name: "Probe-Arbeitsfläche" })).not.toHaveAttribute("data-maximiert");
    act(() => {
      erledigt = zustand?.escape() ?? false;
    });
    expect(erledigt).toBe(false);
  });

  it("breit: ein danebenstehendes Panel bleibt offen", () => {
    matchMediaSetzen(true);
    render(<Probe />);
    fireEvent.click(eigenschaftenKnopf());
    let erledigt = true;
    act(() => {
      erledigt = zustand?.escape() ?? true;
    });
    expect(erledigt).toBe(false);
    expect(eigenschaftenKnopf()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("Rückgängig und Wiederholen", () => {
  it("gebogene Pfeile mit Namen, Hinweis samt Kürzel und erkennbar gesperrtem Zustand", () => {
    const zurueck = vi.fn();
    const vor = vi.fn();
    const { rerender } = render(<RueckgaengigKnoepfe kannZurueck={false} kannVor={false} onZurueck={zurueck} onVor={vor} />);
    const r = screen.getByRole("button", { name: "Rückgängig" });
    const w = screen.getByRole("button", { name: "Wiederholen" });
    expect(r).toHaveAttribute("aria-keyshortcuts", "Control+Z");
    expect(w).toHaveAttribute("aria-keyshortcuts", "Control+Y Control+Shift+Z");
    expect(r).toHaveAttribute("aria-disabled", "true");
    expect(r).toHaveAccessibleDescription("Rückgängig (Strg+Z) – nichts rückgängig zu machen");
    expect(r.querySelector("svg.lucide-undo-2")).not.toBeNull();
    expect(w.querySelector("svg.lucide-redo-2")).not.toBeNull();
    // Gesperrt bleibt fokussierbar, löst aber nichts aus.
    r.focus();
    expect(document.activeElement).toBe(r);
    fireEvent.click(r);
    expect(zurueck).not.toHaveBeenCalled();

    rerender(<RueckgaengigKnoepfe kannZurueck kannVor={false} onZurueck={zurueck} onVor={vor} bezug="im Leitungsentwurf" />);
    expect(r).not.toHaveAttribute("aria-disabled");
    expect(r).toHaveAccessibleDescription("Rückgängig (Strg+Z)");
    expect(screen.getByRole("group", { name: "Rückgängig und Wiederholen im Leitungsentwurf" })).toBeInTheDocument();
    fireEvent.click(r);
    expect(zurueck).toHaveBeenCalledTimes(1);
  });
});

describe("Entwurfsleiste bei eingeklapptem Panel", () => {
  function kontext(werte: { fehler?: { meldung: string } | null; status?: string; ungespeichert?: boolean } = {}) {
    const speichern = vi.fn(() => Promise.resolve(true));
    const abschliessen = vi.fn(() => null);
    const leitungZeichnen = vi.fn();
    const k = {
      planung: {
        entwurf: {
          cableId: "l1",
          werte: { startId: "uv1" },
          status: werte.status ?? "bearbeiten",
          fehler: werte.fehler === undefined ? null : werte.fehler === null ? null : { ...werte.fehler, eintraege: [] },
        },
        ungespeichert: werte.ungespeichert ?? true,
        darfLeitungen: true,
        darfStromkreise: true,
        ablauf: null,
        speichern,
        abschliessen,
        leitungZeichnen,
      },
      zuordnung: { entwurf: null, fehler: null, konflikt: false, offen: false, speichert: false },
      leitungSchliessen: vi.fn(() => Promise.resolve(true)),
      zuordnungSchliessen: vi.fn(() => Promise.resolve(true)),
    } as unknown as Leitungskontext;
    return { k, speichern, abschliessen, leitungZeichnen };
  }

  it("zeigt Konflikt und Speichern an der Aktion und führt zu den Details", () => {
    const { k, speichern, abschliessen, leitungZeichnen } = kontext({ status: "konflikt", fehler: { meldung: "Die Leitung wurde inzwischen geändert." } });
    const details = vi.fn();
    render(<Entwurfsleiste k={k} panelOffen={false} onDetails={details} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Konflikt – Leitung nicht gespeichert: Die Leitung wurde inzwischen geändert.");
    expect(screen.getByTestId("entwurfsleiste-leitung")).toHaveTextContent("Leitungsentwurf: Konflikt – nicht gespeichert");
    fireEvent.click(screen.getByRole("button", { name: "Leitung speichern" }));
    expect(speichern).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Details und Entscheidung" }));
    expect(details).toHaveBeenCalledTimes(1);
    // Angaben im Abschlussdialog, Verlauf über „Weiterzeichnen“ (6c, L2/L3) - kein langes Formular.
    fireEvent.click(screen.getByRole("button", { name: "Angaben …" }));
    expect(abschliessen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Weiterzeichnen" }));
    expect(leitungZeichnen).toHaveBeenCalledTimes(1);
  });

  it("während gezeichnet wird, führt die Zeichenleiste – die Entwurfsleiste schweigt", () => {
    const { k } = kontext();
    (k.planung as unknown as { ablauf: unknown }).ablauf = { schritt: "verlauf" };
    render(<Entwurfsleiste k={k} panelOffen={false} onDetails={() => undefined} />);
    expect(screen.queryByTestId("entwurfsleiste-leitung")).toBeNull();
  });

  it("bei offenem Panel gilt dessen Formular – die Leiste nennt nur den Stand", () => {
    const { k } = kontext({ fehler: { meldung: "Querschnitt fehlt." } });
    render(<Entwurfsleiste k={k} panelOffen onDetails={() => undefined} />);
    expect(screen.getByTestId("entwurfsleiste-leitung")).toHaveTextContent("Leitungsentwurf: nicht gespeichert");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Leitung speichern" })).toBeNull();
  });
});

describe("Höhenregel (L1)", () => {
  it("füllt die restliche Fensterhöhe und hält bei niedrigem Fenster die Mindestfläche – dann scrollt die Seite", () => {
    const vorher = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    render(<Probe />);
    const region = screen.getByRole("region", { name: "Probe-Arbeitsfläche" });
    // jsdom misst 0 für alles über dem Rahmen: 700 − 12 px Rand.
    expect(region.style.height).toBe("688px");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    // Nicht kleiner als Werkzeuge + Kontext + Mindestfläche (220 px): kein Stauchen ins Unbedienbare.
    expect(region.style.height).toBe("220px");
    // Maximiert gilt das Fenster selbst – keine gesetzte Höhe.
    fireEvent.click(screen.getByRole("button", { name: "Zeichenfläche maximieren" }));
    expect(region.style.height).toBe("");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: vorher });
  });

  it("liegt die Fläche tief (schmal viel darüber), füllt sie nach einmaligem Scrollen das Fenster", () => {
    const vorher = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      // Oberkante 600 px: Darunter blieben nur 88 px – weniger als die Mindestfläche (jsdom misst sonst 0).
      return DOMRect.fromRect({ x: 0, y: this.getAttribute("aria-label") === "Probe-Arbeitsfläche" ? 600 : 0, width: 0, height: 0 });
    });
    render(<Probe />);
    // Statt dauerhaft nur 220 px: die ganze Fensterhöhe abzüglich der Ränder (700 − 2 × 12).
    expect(screen.getByRole("region", { name: "Probe-Arbeitsfläche" }).style.height).toBe("676px");
    vi.restoreAllMocks();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: vorher });
  });

  it("Maximieren und zurück (Knopf oder Escape) lässt die eingerollte Arbeitsfläche dort, wo sie war (§21.6 Nacharbeit)", () => {
    // Die Seite ist zur Arbeitsfläche gescrollt; maximiert wird sie kurz, und der Browser setzt die Position
    // auf 0 - zurück in der normalen Ansicht muss die Arbeitsfläche wieder an derselben Stelle stehen.
    // Wie im Browser: Ohne feste Höhe (maximiert) ist die Seite kurz, die Position wird auf 0 gekappt.
    let gewuenscht = 325;
    const region = () => document.querySelector<HTMLElement>("[data-arbeitsflaeche]");
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => (region()?.style.height === "" ? 0 : gewuenscht) });
    const scrollTo = vi.fn((_x: number, y: number) => {
      gewuenscht = y;
    });
    vi.stubGlobal("scrollTo", scrollTo);
    render(<Probe />);
    expect(window.scrollY).toBe(325);
    fireEvent.click(screen.getByRole("button", { name: "Zeichenfläche maximieren" }));
    expect(window.scrollY).toBe(0);
    gewuenscht = 0;
    fireEvent.click(screen.getByRole("button", { name: "Normale Ansicht" }));
    expect(window.scrollY).toBe(325);
    // Ebenso über Escape (letzte Stufe), nach erneutem Maximieren per Taste M.
    fireEvent.keyDown(window, { key: "m" });
    gewuenscht = 0;
    act(() => {
      zustand?.escape();
    });
    expect(window.scrollY).toBe(325);
    // Ohne Maximieren wird nie gescrollt.
    scrollTo.mockClear();
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0, writable: true });
  });

  it("staucht bei fester Höhe nur die Zeichenfläche – Kopf, Werkzeuge und Kontext behalten ihre Höhe", () => {
    render(<Probe />);
    // Ein umbrechender Kopf darf nicht über die Werkzeugleiste laufen (Befund der Browserprüfung, 375 px).
    for (const text of ["Kopfzeile", "Werkzeuge", "Kontext"]) {
      expect(screen.getByText(text).closest(".shrink-0")).not.toBeNull();
    }
  });
});
