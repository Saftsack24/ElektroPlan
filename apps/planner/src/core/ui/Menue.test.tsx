import { fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ArbeitsbereichProvider, useArbeitsbereich, useArbeitsbereichAktiv } from "./arbeitsbereich";
import { Menue } from "./Menue";

/** Aufklappmenü und Arbeitsbereich-Modus (Phase 6c, L1) – fachneutrale Bausteine. */
describe("Menü", () => {
  function zeigen(onFang = vi.fn(), onRaster = vi.fn()) {
    const fenster = vi.fn();
    window.addEventListener("keydown", fenster);
    render(
      <Menue
        label="Ansicht und Hilfe"
        text="Ansicht"
        abschnitte={[
          { punkte: [{ art: "schalter", label: "Fang", gewaehlt: true, onWahl: onFang }] },
          { titel: "Raster", punkte: [{ art: "wahl", label: "Raster 10 cm", gewaehlt: true, onWahl: onRaster }, { art: "wahl", label: "Raster 50 cm", gewaehlt: false, onWahl: onRaster }] },
          { punkte: [{ label: "Gesperrt", gesperrt: true, gesperrtGrund: "geht gerade nicht", onWahl: vi.fn() }] },
        ]}
      />,
    );
    return { fenster, aufraeumen: () => window.removeEventListener("keydown", fenster) };
  }

  it("Rollen, Zustand und Fokus beim Öffnen; Pfeiltasten wandern", () => {
    const { aufraeumen } = zeigen();
    const knopf = screen.getByRole("button", { name: "Ansicht und Hilfe" });
    expect(knopf).toHaveAttribute("aria-haspopup", "menu");
    expect(knopf).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(knopf);
    expect(knopf).toHaveAttribute("aria-expanded", "true");
    const menue = screen.getByRole("menu", { name: "Ansicht und Hilfe" });
    const fang = within(menue).getByRole("menuitemcheckbox", { name: "Fang" });
    expect(fang).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(fang);
    fireEvent.keyDown(menue, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(menue).getByRole("menuitemradio", { name: "Raster 10 cm" }));
    fireEvent.keyDown(menue, { key: "End" });
    expect(document.activeElement).toHaveAccessibleName("Gesperrt");
    aufraeumen();
  });

  it("Escape schließt nur das Menü – keine zweite Wirkung außerhalb – und gibt den Fokus zurück", () => {
    const { fenster, aufraeumen } = zeigen();
    fireEvent.click(screen.getByRole("button", { name: "Ansicht und Hilfe" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ansicht und Hilfe" }));
    expect(fenster).not.toHaveBeenCalled();
    aufraeumen();
  });

  it("Wahl führt aus und schließt; gesperrte Einträge tun nichts", () => {
    const onRaster = vi.fn();
    const { aufraeumen } = zeigen(vi.fn(), onRaster);
    fireEvent.click(screen.getByRole("button", { name: "Ansicht und Hilfe" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Raster 50 cm" }));
    expect(onRaster).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ansicht und Hilfe" }));
    const gesperrt = screen.getByRole("menuitem", { name: "Gesperrt" });
    expect(gesperrt).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(gesperrt);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // Ein Klick außerhalb schließt.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    aufraeumen();
  });
});

describe("Arbeitsbereich", () => {
  it("ist aktiv, solange eine Ansicht ihn anmeldet, und ohne Rahmen wirkungslos", () => {
    const rahmen = ({ children }: { children: ReactNode }) => <ArbeitsbereichProvider>{children}</ArbeitsbereichProvider>;
    const { result, rerender, unmount } = renderHook(
      ({ an }: { an: boolean }) => {
        useArbeitsbereich(an);
        return useArbeitsbereichAktiv();
      },
      { wrapper: rahmen, initialProps: { an: true } },
    );
    expect(result.current).toBe(true);
    rerender({ an: false });
    expect(result.current).toBe(false);
    unmount();
    // Ohne Rahmen (etwa im Test eines einzelnen Tabs): kein Fehler, nie aktiv.
    const ohne = renderHook(() => {
      useArbeitsbereich(true);
      return useArbeitsbereichAktiv();
    });
    expect(ohne.result.current).toBe(false);
  });
});
