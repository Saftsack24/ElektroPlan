import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STANDARD_DARSTELLUNG,
  darstellungAbonnieren,
  darstellungLesen,
  darstellungSetzen,
  darstellungStarten,
  darstellungVorschauBeenden,
  darstellungVorschauen,
  darstellungszustand,
  useDarstellung,
} from "./darstellung";

const wurzel = () => document.documentElement;

/** Ersetzt `matchMedia`; `setzen(true)` simuliert ein dunkles System. */
function systemschema(dunkel: boolean) {
  const hoerer = new Set<() => void>();
  const medien = {
    matches: dunkel,
    addEventListener: (_typ: string, h: () => void) => hoerer.add(h),
    removeEventListener: (_typ: string, h: () => void) => hoerer.delete(h),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => medien));
  return {
    setzen(neu: boolean) {
      medien.matches = neu;
      for (const h of [...hoerer]) h();
    },
    get hoerer() {
      return hoerer.size;
    },
  };
}

const aufraeumen: (() => void)[] = [];

/** Startet die Beobachtung wie main.tsx und meldet sie nach dem Test ab. */
function starten(): () => void {
  const beenden = darstellungStarten();
  aufraeumen.push(beenden);
  return beenden;
}

afterEach(() => {
  for (const beenden of aufraeumen.splice(0)) beenden();
  vi.unstubAllGlobals();
});

function Anzeige() {
  const zustand = useDarstellung();
  return (
    <p>
      {zustand.darstellung.modus}/{zustand.darstellung.akzent}/{zustand.farbschema}
    </p>
  );
}

describe("Darstellung: altes Speicherformat", () => {
  it("liest das alte lokale Format (Version 1) für die einmalige Übernahme", () => {
    expect(darstellungLesen('{"version":1,"modus":"dark","akzent":"teal"}')).toEqual({ modus: "dark", akzent: "teal" });
  });

  it("fällt bei defekten, fremden oder veralteten Werten auf den Standard zurück", () => {
    expect(darstellungLesen(null)).toEqual(STANDARD_DARSTELLUNG);
    expect(darstellungLesen("{kaputt")).toEqual(STANDARD_DARSTELLUNG);
    expect(darstellungLesen('"dark"')).toEqual(STANDARD_DARSTELLUNG);
    expect(darstellungLesen("null")).toEqual(STANDARD_DARSTELLUNG);
    expect(darstellungLesen('{"version":2,"modus":"dark","akzent":"teal"}')).toEqual(STANDARD_DARSTELLUNG);
    expect(darstellungLesen('{"modus":"dark","akzent":"teal"}')).toEqual(STANDARD_DARSTELLUNG);
  });

  it("ersetzt nur ein unbekanntes oder fehlendes Feld durch den Standard", () => {
    expect(darstellungLesen('{"version":1,"modus":"sepia","akzent":"teal"}')).toEqual({
      modus: "system",
      akzent: "teal",
    });
    expect(darstellungLesen('{"version":1,"modus":"dark"}')).toEqual({ modus: "dark", akzent: "blue" });
    expect(darstellungLesen('{"version":1,"modus":"light","akzent":"#ff00ff"}')).toEqual({
      modus: "light",
      akzent: "blue",
    });
  });
});

describe("Darstellung: gültiger Stand", () => {
  it("ist ohne Wahl System mit ElektroPlan Blau", () => {
    systemschema(false);
    starten();
    darstellungSetzen(null);
    expect(darstellungszustand().darstellung).toEqual(STANDARD_DARSTELLUNG);
    expect(wurzel().dataset["themeMode"]).toBe("system");
    expect(wurzel().dataset["theme"]).toBe("light");
    expect(wurzel().dataset["accent"]).toBe("blue");
  });

  it("zeigt nach dem Abmelden (null) nie die Wahl des vorherigen Benutzers", () => {
    darstellungSetzen({ modus: "dark", akzent: "green" });
    expect(wurzel().dataset["theme"]).toBe("dark");
    darstellungSetzen(null);
    expect(darstellungszustand().darstellung).toEqual(STANDARD_DARSTELLUNG);
    expect(wurzel().dataset["accent"]).toBe("blue");
    expect(wurzel().dataset["themeMode"]).toBe("system");
  });

  it("liest und schreibt selbst keinen Browser-Speicher", () => {
    const lesen = vi.spyOn(Storage.prototype, "getItem");
    const schreiben = vi.spyOn(Storage.prototype, "setItem");
    starten();
    darstellungSetzen({ modus: "dark", akzent: "teal" });
    darstellungVorschauen({ modus: "light", akzent: "orange" });
    darstellungVorschauBeenden();
    expect(lesen).not.toHaveBeenCalled();
    expect(schreiben).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("benachrichtigt React-Komponenten", () => {
    render(<Anzeige />);
    act(() => darstellungSetzen({ modus: "dark", akzent: "teal" }));
    expect(screen.getByText("dark/teal/dark")).toBeInTheDocument();
  });
});

describe("Darstellung: System, Hell, Dunkel", () => {
  it("folgt im Systemmodus dem Betriebssystem - auch bei einem Wechsel zur Laufzeit", () => {
    const system = systemschema(false);
    starten();
    expect(wurzel().dataset["theme"]).toBe("light");
    system.setzen(true);
    expect(wurzel().dataset["theme"]).toBe("dark");
    expect(wurzel().style.colorScheme).toBe("dark");
  });

  it("hält Hell und Dunkel unabhängig vom Betriebssystem", () => {
    const system = systemschema(true);
    starten();
    darstellungSetzen({ modus: "light", akzent: "blue" });
    expect(wurzel().dataset["theme"]).toBe("light");
    system.setzen(false);
    system.setzen(true);
    expect(wurzel().dataset["theme"]).toBe("light");
    darstellungSetzen({ modus: "dark", akzent: "blue" });
    system.setzen(false);
    expect(wurzel().dataset["theme"]).toBe("dark");
  });

  it("meldet Beobachtern einen Systemwechsel nur im Systemmodus", () => {
    const system = systemschema(false);
    starten();
    const beobachter = vi.fn();
    const abmelden = darstellungAbonnieren(beobachter);
    system.setzen(true);
    expect(beobachter).toHaveBeenCalledTimes(1);
    darstellungSetzen({ modus: "light", akzent: "blue" });
    beobachter.mockClear();
    system.setzen(false);
    system.setzen(true);
    expect(beobachter).not.toHaveBeenCalled();
    abmelden();
  });

  it("meldet sich beim Beenden vom Systemschema ab", () => {
    const system = systemschema(false);
    const beenden = starten();
    expect(system.hoerer).toBe(1);
    beenden();
    expect(system.hoerer).toBe(0);
  });
});

describe("Darstellung: Akzent und Vorschau", () => {
  it("setzt das Akzentschema als Wurzelattribut", () => {
    darstellungSetzen({ modus: "system", akzent: "orange" });
    expect(wurzel().dataset["accent"]).toBe("orange");
  });

  it("zeigt eine Vorschau sofort, ohne sie zu speichern, und stellt danach den gespeicherten Stand her", () => {
    darstellungSetzen({ modus: "light", akzent: "green" });
    darstellungVorschauen({ modus: "dark", akzent: "violet" });
    expect(wurzel().dataset["theme"]).toBe("dark");
    expect(wurzel().dataset["accent"]).toBe("violet");
    expect(darstellungszustand().vorschau).toBe(true);
    expect(darstellungszustand().gespeichert).toEqual({ modus: "light", akzent: "green" });
    darstellungVorschauBeenden();
    expect(wurzel().dataset["theme"]).toBe("light");
    expect(wurzel().dataset["accent"]).toBe("green");
  });

  it("beendet eine Vorschau, sobald ein neuer gültiger Stand kommt (etwa Abmelden)", () => {
    darstellungVorschauen({ modus: "dark", akzent: "violet" });
    darstellungSetzen(null);
    expect(darstellungszustand().vorschau).toBe(false);
    expect(wurzel().dataset["accent"]).toBe("blue");
  });
});
