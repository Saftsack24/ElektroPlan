import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STANDARD_DARSTELLUNG,
  darstellungAbonnieren,
  darstellungBenutzerSetzen,
  darstellungLesen,
  darstellungSchluessel,
  darstellungSchreiben,
  darstellungSpeichern,
  darstellungStarten,
  darstellungVorschauBeenden,
  darstellungVorschauen,
  darstellungszustand,
  useDarstellung,
} from "./darstellung";

const ANNA = "11111111-1111-4111-8111-111111111111";
const BERT = "22222222-2222-4222-8222-222222222222";

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

describe("Darstellung: Speicherformat", () => {
  it("liest und schreibt ein versioniertes Format", () => {
    const text = darstellungSchreiben({ modus: "dark", akzent: "teal" });
    expect(JSON.parse(text)).toEqual({ version: 1, modus: "dark", akzent: "teal" });
    expect(darstellungLesen(text)).toEqual({ modus: "dark", akzent: "teal" });
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

describe("Darstellung: Benutzer und Speicher", () => {
  it("ist ohne gespeicherte Wahl System mit ElektroPlan Blau", () => {
    systemschema(false);
    starten();
    darstellungBenutzerSetzen(ANNA);
    expect(darstellungszustand().darstellung).toEqual(STANDARD_DARSTELLUNG);
    expect(wurzel().dataset["themeMode"]).toBe("system");
    expect(wurzel().dataset["theme"]).toBe("light");
    expect(wurzel().dataset["accent"]).toBe("blue");
  });

  it("trennt zwei Benutzer im selben Browser", () => {
    darstellungBenutzerSetzen(ANNA);
    darstellungSpeichern({ modus: "dark", akzent: "violet" });
    darstellungBenutzerSetzen(BERT);
    expect(darstellungszustand().darstellung).toEqual(STANDARD_DARSTELLUNG);
    darstellungSpeichern({ modus: "light", akzent: "orange" });
    darstellungBenutzerSetzen(ANNA);
    expect(darstellungszustand().darstellung).toEqual({ modus: "dark", akzent: "violet" });
    expect(darstellungLesen(window.localStorage.getItem(darstellungSchluessel(BERT)))).toEqual({
      modus: "light",
      akzent: "orange",
    });
  });

  it("zeigt nach dem Abmelden und beim Laden nie die Wahl des vorherigen Benutzers", () => {
    darstellungBenutzerSetzen(ANNA);
    darstellungSpeichern({ modus: "dark", akzent: "green" });
    expect(wurzel().dataset["theme"]).toBe("dark");
    darstellungBenutzerSetzen(null);
    expect(darstellungszustand().darstellung).toEqual(STANDARD_DARSTELLUNG);
    expect(wurzel().dataset["accent"]).toBe("blue");
    expect(wurzel().dataset["themeMode"]).toBe("system");
  });

  it("zieht eine Änderung desselben Benutzers aus einem anderen Tab nach", () => {
    starten();
    darstellungBenutzerSetzen(ANNA);
    render(<Anzeige />);
    window.localStorage.setItem(darstellungSchluessel(ANNA), darstellungSchreiben({ modus: "dark", akzent: "teal" }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: darstellungSchluessel(ANNA) }));
    });
    expect(screen.getByText("dark/teal/dark")).toBeInTheDocument();
    expect(wurzel().dataset["accent"]).toBe("teal");
  });

  it("ignoriert den Tab eines anderen Benutzers", () => {
    starten();
    darstellungBenutzerSetzen(ANNA);
    window.localStorage.setItem(darstellungSchluessel(BERT), darstellungSchreiben({ modus: "dark", akzent: "teal" }));
    window.dispatchEvent(new StorageEvent("storage", { key: darstellungSchluessel(BERT) }));
    expect(darstellungszustand().darstellung).toEqual(STANDARD_DARSTELLUNG);
  });

  it("bleibt ohne nutzbaren Speicher bedienbar", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("gesperrt");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("gesperrt");
    });
    darstellungBenutzerSetzen(ANNA);
    expect(darstellungszustand().darstellung).toEqual(STANDARD_DARSTELLUNG);
    darstellungSpeichern({ modus: "dark", akzent: "green" });
    expect(darstellungszustand().darstellung).toEqual({ modus: "dark", akzent: "green" });
    expect(wurzel().dataset["theme"]).toBe("dark");
    vi.restoreAllMocks();
  });
});

describe("Darstellung: System, Hell, Dunkel", () => {
  it("folgt im Systemmodus dem Betriebssystem - auch bei einem Wechsel zur Laufzeit", () => {
    const system = systemschema(false);
    starten();
    darstellungBenutzerSetzen(ANNA);
    expect(wurzel().dataset["theme"]).toBe("light");
    system.setzen(true);
    expect(wurzel().dataset["theme"]).toBe("dark");
    expect(wurzel().style.colorScheme).toBe("dark");
  });

  it("hält Hell und Dunkel unabhängig vom Betriebssystem", () => {
    const system = systemschema(true);
    starten();
    darstellungBenutzerSetzen(ANNA);
    darstellungSpeichern({ modus: "light", akzent: "blue" });
    expect(wurzel().dataset["theme"]).toBe("light");
    system.setzen(false);
    system.setzen(true);
    expect(wurzel().dataset["theme"]).toBe("light");
    darstellungSpeichern({ modus: "dark", akzent: "blue" });
    system.setzen(false);
    expect(wurzel().dataset["theme"]).toBe("dark");
  });

  it("meldet Beobachtern einen Systemwechsel nur im Systemmodus", () => {
    const system = systemschema(false);
    starten();
    darstellungBenutzerSetzen(ANNA);
    const beobachter = vi.fn();
    const abmelden = darstellungAbonnieren(beobachter);
    system.setzen(true);
    expect(beobachter).toHaveBeenCalledTimes(1);
    darstellungSpeichern({ modus: "light", akzent: "blue" });
    beobachter.mockClear();
    system.setzen(false);
    system.setzen(true);
    expect(beobachter).not.toHaveBeenCalled();
    abmelden();
  });

  it("meldet sich beim Beenden vom Systemschema und von anderen Tabs ab", () => {
    const system = systemschema(false);
    const beenden = starten();
    expect(system.hoerer).toBe(1);
    beenden();
    expect(system.hoerer).toBe(0);
  });
});

describe("Darstellung: Akzent und Vorschau", () => {
  it("setzt das Akzentschema als Wurzelattribut", () => {
    darstellungBenutzerSetzen(ANNA);
    darstellungSpeichern({ modus: "system", akzent: "orange" });
    expect(wurzel().dataset["accent"]).toBe("orange");
  });

  it("zeigt eine Vorschau sofort, ohne sie zu speichern, und stellt danach den gespeicherten Stand her", () => {
    darstellungBenutzerSetzen(ANNA);
    darstellungSpeichern({ modus: "light", akzent: "green" });
    darstellungVorschauen({ modus: "dark", akzent: "violet" });
    expect(wurzel().dataset["theme"]).toBe("dark");
    expect(wurzel().dataset["accent"]).toBe("violet");
    expect(darstellungszustand().vorschau).toBe(true);
    expect(darstellungLesen(window.localStorage.getItem(darstellungSchluessel(ANNA)))).toEqual({
      modus: "light",
      akzent: "green",
    });
    darstellungVorschauBeenden();
    expect(wurzel().dataset["theme"]).toBe("light");
    expect(wurzel().dataset["accent"]).toBe("green");
  });

  it("beendet eine Vorschau beim Benutzerwechsel", () => {
    darstellungBenutzerSetzen(ANNA);
    darstellungVorschauen({ modus: "dark", akzent: "violet" });
    darstellungBenutzerSetzen(BERT);
    expect(darstellungszustand().vorschau).toBe(false);
    expect(wurzel().dataset["accent"]).toBe("blue");
  });
});
