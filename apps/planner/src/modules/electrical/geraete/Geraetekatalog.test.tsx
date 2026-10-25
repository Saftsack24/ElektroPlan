import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { masseinheitSetzen } from "../../../core/ui/masseinheit";
import { Geraetekatalog } from "./Geraetekatalog";
import type { Katalogmodus, Verteilungsangebot } from "./Geraetekatalog";
import type { Geraetetyp } from "./katalog";
import { typenNachSchluessel } from "./katalog";

/**
 * Gerätekatalog als Dialog (Phase 6c, K1): Suche, Kategorien, Auswahl, Tastatur,
 * Flächenbeschränkung, Typmodus mit deaktiviertem Bestandstyp und der Eintrag
 * „Verteilung platzieren …“. Synthetische Typen in der Form des Servers.
 */
const typ = (key: string, label: string, category: string, teile: Partial<Geraetetyp> = {}): Geraetetyp => ({
  key,
  label,
  category: category as Geraetetyp["category"],
  symbol_key: key,
  allows_wall_interior: true,
  allows_wall_exterior: false,
  allows_ceiling: false,
  default_center_height_mm: 300,
  width_mm: 80,
  height_mm: 80,
  sort_order: 10,
  is_active: true,
  origin: "system",
  description: null,
  version: 1,
  device_count: 0,
  template_count: 0,
  ...teile,
});
const TYPEN = typenNachSchluessel([
  typ("socket_single", "Steckdose", "socket", { sort_order: 10 }),
  typ("socket_outdoor", "Steckdose, außen geeignet", "socket", { allows_wall_exterior: true, sort_order: 20 }),
  typ("switch_single", "Ausschalter", "switch", { default_center_height_mm: 1050, sort_order: 30 }),
  typ("light_ceiling", "Deckenleuchte (Auslass)", "light", { allows_wall_interior: false, allows_ceiling: true, default_center_height_mm: null, sort_order: 40 }),
  typ("junction_box", "Abzweigdose", "junction", { allows_ceiling: true, sort_order: 50 }),
  typ("socket_alt", "Steckdose (alt)", "socket", { is_active: false, sort_order: 60 }),
  typ("distribution_board", "Verteilung", "distribution", { width_mm: 550, height_mm: 700, default_center_height_mm: 1400, sort_order: 90 }),
]);

beforeEach(() => {
  act(() => masseinheitSetzen("cm"));
});

function zeigen(modus: Katalogmodus, { onWahl = vi.fn(() => undefined as string | undefined), verteilung }: { onWahl?: (key: string) => string | undefined; verteilung?: Verteilungsangebot } = {}) {
  const onClose = vi.fn();
  render(<Geraetekatalog typen={TYPEN} modus={modus} onWahl={onWahl} onClose={onClose} verteilung={verteilung} />);
  return { dialog: screen.getByRole("dialog"), onWahl, onClose };
}

const kacheln = (dialog: HTMLElement) => within(dialog).getAllByRole("radio").map((k) => k.getAttribute("data-testid")?.replace("katalog-kachel-", ""));

describe("Gerätekatalog (K1)", () => {
  it("zeigt frei wählbare, aktive Typen als Kacheln – ohne Verteilung und ohne deaktivierte", () => {
    const { dialog } = zeigen({ art: "platzieren", flaeche: null, start: null });
    expect(within(dialog).getByRole("heading", { name: "Gerät auswählen" })).toBeInTheDocument();
    expect(kacheln(dialog)).toEqual(["socket_single", "socket_outdoor", "switch_single", "light_ceiling", "junction_box"]);
    // Kurze Angaben: Fläche und Standardhöhe; Details der Auswahl knapp darunter.
    expect(within(dialog).getByTestId("katalog-kachel-switch_single")).toHaveTextContent("Wand · 105 cm");
    expect(within(dialog).getByTestId("katalog-kachel-light_ceiling")).toHaveTextContent("Decke");
    expect(within(dialog).getByTestId("katalog-details")).toHaveTextContent("Montage: Wand innen · Standardhöhe Mitte 30 cm");
  });

  it("sucht über Bezeichnung, Kategorie und Alltagsbegriffe, filtert nach Kategorie", () => {
    const { dialog } = zeigen({ art: "platzieren", flaeche: null, start: null });
    const suche = within(dialog).getByRole("searchbox", { name: "Gerät suchen" });
    fireEvent.change(suche, { target: { value: "lampe" } });
    expect(kacheln(dialog)).toEqual(["light_ceiling"]);
    fireEvent.change(suche, { target: { value: "Steckdose außen" } });
    expect(kacheln(dialog)).toEqual(["socket_outdoor"]);
    fireEvent.change(suche, { target: { value: "decke" } });
    expect(kacheln(dialog)).toEqual(["light_ceiling", "junction_box"]);
    fireEvent.change(suche, { target: { value: "xyz" } });
    expect(within(dialog).getByText("Kein Gerätetyp passt zur Suche.")).toBeInTheDocument();
    fireEvent.change(suche, { target: { value: "" } });
    const kategorien = within(dialog).getByRole("navigation", { name: "Kategorien" });
    fireEvent.click(within(kategorien).getByRole("button", { name: /Schalter/ }));
    expect(within(kategorien).getByRole("button", { name: /Schalter/ })).toHaveAttribute("aria-pressed", "true");
    expect(kacheln(dialog)).toEqual(["switch_single"]);
  });

  it("Tastatur: Pfeile wandern mit Fokus, Pos1/Ende springen, Enter übernimmt; nur eine Kachel im Tab-Ablauf", () => {
    const { dialog, onWahl } = zeigen({ art: "platzieren", flaeche: null, start: null });
    const erste = within(dialog).getByTestId("katalog-kachel-socket_single");
    expect(within(dialog).getAllByRole("radio").filter((k) => k.tabIndex === 0)).toEqual([erste]);
    erste.focus();
    fireEvent.keyDown(erste, { key: "ArrowRight" });
    const zweite = within(dialog).getByTestId("katalog-kachel-socket_outdoor");
    expect(zweite).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(zweite);
    fireEvent.keyDown(zweite, { key: "End" });
    expect(within(dialog).getByTestId("katalog-kachel-junction_box")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(onWahl).toHaveBeenCalledWith("socket_single");
  });

  it("auf einer festgelegten Fläche: unpassende Typen sichtbar, aber mit Grund nicht platzierbar", () => {
    const { dialog, onWahl } = zeigen({ art: "platzieren", flaeche: "ceiling", start: null });
    // Erster platzierbarer Typ ist vorgewählt.
    expect(within(dialog).getByTestId("katalog-kachel-light_ceiling")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(dialog).getByTestId("katalog-kachel-socket_single"));
    expect(within(dialog).getByTestId("katalog-kachel-socket_single")).toHaveTextContent("nur Wand");
    expect(within(dialog).getByTestId("katalog-details")).toHaveTextContent("Auf „Decke“ nicht vorgesehen – nur Wand innen.");
    expect(within(dialog).getByRole("button", { name: "Platzieren" })).toBeDisabled();
    fireEvent.doubleClick(within(dialog).getByTestId("katalog-kachel-socket_single"));
    expect(onWahl).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId("katalog-kachel-junction_box"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Platzieren" }));
    expect(onWahl).toHaveBeenCalledWith("junction_box");
  });

  it("Typmodus: nur Typen der Fläche, deaktivierter Bestandstyp sichtbar und nicht neu wählbar, Grund des Aufrufers bleibt sichtbar", () => {
    const onWahl = vi.fn((key: string) => (key === "switch_single" ? "Das Gerät überdeckt ein anderes." : undefined));
    const { dialog } = zeigen({ art: "typ", flaeche: "wall_interior", aktuell: "socket_alt" }, { onWahl });
    expect(within(dialog).getByRole("heading", { name: "Gerätetyp ändern" })).toBeInTheDocument();
    expect(kacheln(dialog)).toEqual(["socket_single", "socket_outdoor", "switch_single", "junction_box", "socket_alt"]);
    const bestand = within(dialog).getByTestId("katalog-kachel-socket_alt");
    expect(bestand).toHaveAttribute("aria-checked", "true");
    expect(bestand).toHaveTextContent("nicht mehr angeboten");
    expect(within(dialog).getByTestId("katalog-details")).toHaveTextContent("aktueller Typ");
    expect(within(dialog).getByRole("button", { name: "Typ übernehmen" })).toBeDisabled();
    fireEvent.click(within(dialog).getByTestId("katalog-kachel-switch_single"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Typ übernehmen" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Nicht übernommen: Das Gerät überdeckt ein anderes.");
  });

  it("„Verteilung platzieren …“ listet unplatzierte Verteilungen oder nennt den Sperrgrund", () => {
    const onBoard = vi.fn();
    const { dialog, onClose } = zeigen(
      { art: "platzieren", flaeche: null, start: null },
      { verteilung: { verteilungen: [{ id: "uv2", code: "UV2", name: "UV Keller" }], gesperrt: null, onWahl: onBoard } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Verteilung platzieren …" }));
    expect(within(dialog).queryByRole("radiogroup")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Platzieren" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Verteilung UV2 platzieren" }));
    expect(onBoard).toHaveBeenCalledWith("uv2");
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("gesperrter Verteilungseintrag nennt den Grund statt einer Aktion", () => {
    const { dialog } = zeigen(
      { art: "platzieren", flaeche: "ceiling", start: null },
      { verteilung: { verteilungen: [{ id: "uv2", code: "UV2", name: "UV" }], gesperrt: "Verteilungen sitzen an der Wand.", onWahl: vi.fn() } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Verteilung platzieren …" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Verteilungen sitzen an der Wand.");
    expect(within(dialog).queryByRole("button", { name: /Verteilung UV2 platzieren/ })).toBeNull();
  });
});
