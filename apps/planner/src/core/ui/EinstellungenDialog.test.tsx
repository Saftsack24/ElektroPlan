import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { describe, expect, it } from "vitest";

import {
  darstellungBenutzerSetzen,
  darstellungLesen,
  darstellungSchluessel,
  darstellungSpeichern,
  darstellungszustand,
} from "../theme/darstellung";
import { EinstellungenDialog } from "./EinstellungenDialog";
import { masseinheit, masseinheitBenutzerSetzen, masseinheitSchluessel, masseinheitSetzen } from "./masseinheit";

const ANNA = "11111111-1111-4111-8111-111111111111";
const wurzel = () => document.documentElement;

function Aufbau() {
  const [offen, setOffen] = useState(false);
  return (
    <StrictMode>
      <button type="button" onClick={() => setOffen(true)}>
        Einstellungen öffnen
      </button>
      <EinstellungenDialog offen={offen} onClose={() => setOffen(false)} />
    </StrictMode>
  );
}

function oeffnen() {
  darstellungBenutzerSetzen(ANNA);
  masseinheitBenutzerSetzen(ANNA);
  render(<Aufbau />);
  const knopf = screen.getByRole("button", { name: "Einstellungen öffnen" });
  knopf.focus();
  fireEvent.click(knopf);
  return screen.getByRole("dialog", { name: "Einstellungen" });
}

function gespeicherteDarstellung() {
  return darstellungLesen(window.localStorage.getItem(darstellungSchluessel(ANNA)));
}

describe("Einstellungsdialog", () => {
  it("gliedert Darstellung, Akzentfarbe und Maßeinheit und nennt den Speicherort", () => {
    const dialog = oeffnen();
    for (const gruppe of ["Darstellung", "Akzentfarbe", "Maßeinheit für Längen"]) {
      expect(within(dialog).getByRole("group", { name: gruppe })).toBeInTheDocument();
    }
    expect(within(dialog).getByText(/nur in diesem Browser/)).toBeInTheDocument();
    // Jede Akzentfarbe hat einen Namen - die Farbe allein trägt keine Aussage.
    for (const name of [/ElektroPlan Blau/, /Türkis/, /Grün/, /Violett/, /Orange/]) {
      expect(within(dialog).getByRole("radio", { name })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole("radio", { name: /Wie das System/ })).toHaveFocus();
  });

  it("zeigt Änderungen sofort als Vorschau, ohne zu speichern", () => {
    const dialog = oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dunkel" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Türkis/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Millimeter/ }));
    expect(wurzel().dataset["theme"]).toBe("dark");
    expect(wurzel().dataset["accent"]).toBe("teal");
    expect(masseinheit()).toBe("mm");
    expect(window.localStorage.getItem(darstellungSchluessel(ANNA))).toBeNull();
    expect(window.localStorage.getItem(masseinheitSchluessel(ANNA))).toBeNull();
  });

  it("Abbrechen stellt den gespeicherten Stand vollständig wieder her und gibt den Fokus zurück", async () => {
    darstellungBenutzerSetzen(ANNA);
    darstellungSpeichern({ modus: "light", akzent: "green" });
    masseinheitBenutzerSetzen(ANNA);
    masseinheitSetzen("cm");
    const dialog = oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dunkel" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Violett/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Millimeter/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(wurzel().dataset["theme"]).toBe("light");
    expect(wurzel().dataset["accent"]).toBe("green");
    expect(masseinheit()).toBe("cm");
    expect(gespeicherteDarstellung()).toEqual({ modus: "light", akzent: "green" });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(screen.getByRole("button", { name: "Einstellungen öffnen" })).toHaveFocus();
  });

  it("Escape wirkt wie Abbrechen", () => {
    const dialog = oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dunkel" }));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(darstellungszustand().darstellung.modus).toBe("system");
    expect(darstellungszustand().vorschau).toBe(false);
  });

  it("Übernehmen speichert Darstellung und Maßeinheit für den Benutzer", () => {
    const dialog = oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Hell" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Orange/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Millimeter/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gespeicherteDarstellung()).toEqual({ modus: "light", akzent: "orange" });
    expect(window.localStorage.getItem(masseinheitSchluessel(ANNA))).toBe("mm");
    expect(wurzel().dataset["accent"]).toBe("orange");
    expect(darstellungszustand().vorschau).toBe(false);
  });

  it("Zurücksetzen zeigt den Standard als Vorschau und speichert erst mit Übernehmen", () => {
    darstellungBenutzerSetzen(ANNA);
    darstellungSpeichern({ modus: "dark", akzent: "violet" });
    masseinheitBenutzerSetzen(ANNA);
    masseinheitSetzen("mm");
    const dialog = oeffnen();
    fireEvent.click(within(dialog).getByRole("button", { name: "Auf Standard zurücksetzen" }));
    expect(within(dialog).getByRole("radio", { name: /Wie das System/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /ElektroPlan Blau/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Zentimeter/ })).toBeChecked();
    expect(wurzel().dataset["accent"]).toBe("blue");
    expect(masseinheit()).toBe("cm");
    expect(gespeicherteDarstellung()).toEqual({ modus: "dark", akzent: "violet" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect(gespeicherteDarstellung()).toEqual({ modus: "system", akzent: "blue" });
    expect(window.localStorage.getItem(masseinheitSchluessel(ANNA))).toBe("cm");
  });

  it("beginnt beim erneuten Öffnen mit dem gespeicherten Stand", () => {
    let dialog = oeffnen();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dunkel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen öffnen" }));
    dialog = screen.getByRole("dialog", { name: "Einstellungen" });
    expect(within(dialog).getByRole("radio", { name: /Wie das System/ })).toBeChecked();
  });
});
