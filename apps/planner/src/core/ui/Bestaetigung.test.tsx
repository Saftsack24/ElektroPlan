import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Bestaetigung } from "./Bestaetigung";

/**
 * Rückfrage vor folgenreichen Aktionen (Phase 4.2): Fokus, Escape,
 * Fokusrückgabe und Sperre während der Ausführung.
 */
function Aufbau({ laeuft = false, onBestaetigen = vi.fn() }) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOffen(true)}>
        Sperren
      </button>
      <Bestaetigung
        offen={offen}
        titel="Zugang sperren?"
        bestaetigenLabel="Zugang sperren"
        gefaehrlich
        laeuft={laeuft}
        onBestaetigen={onBestaetigen}
        onAbbrechen={() => setOffen(false)}
      >
        <p>Die Person kann danach nicht mehr arbeiten.</p>
      </Bestaetigung>
    </>
  );
}

describe("Bestätigungsdialog", () => {
  it("setzt den Fokus auf Abbrechen und gibt ihn beim Schließen zurück", () => {
    render(<Aufbau />);
    const ausloeser = screen.getByRole("button", { name: "Sperren" });
    ausloeser.focus();
    fireEvent.click(ausloeser);

    expect(screen.getByRole("dialog", { name: "Zugang sperren?" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abbrechen" }));

    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(ausloeser);
  });

  it("schließt mit Escape, ohne zu bestätigen", () => {
    const onBestaetigen = vi.fn();
    render(<Aufbau onBestaetigen={onBestaetigen} />);
    fireEvent.click(screen.getByRole("button", { name: "Sperren" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onBestaetigen).not.toHaveBeenCalled();
  });

  it("sperrt Knöpfe und Escape, solange die Aktion läuft", () => {
    render(<Aufbau laeuft />);
    fireEvent.click(screen.getByRole("button", { name: "Sperren" }));
    expect(screen.getByRole("button", { name: "Wird ausgeführt ..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDisabled();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
