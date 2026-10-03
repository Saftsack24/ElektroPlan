import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";

/** Ergänzungen aus Phase 4f: Escape zuerst dem Inhalt anbieten, große Arbeitsfläche. */
describe("Dialog", () => {
  it("Escape fragt zuerst den Inhalt; erledigt er es, bleibt der Dialog offen", () => {
    const schliessen = vi.fn();
    const escape = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    render(
      <Dialog offen titel="Arbeit" onClose={schliessen} onEscape={escape} groesse="gross">
        <p>Inhalt</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Arbeit" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(schliessen).not.toHaveBeenCalled();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(schliessen).toHaveBeenCalledTimes(1);
  });

  it("die große Variante schließt nicht über einen Klick auf den Rand", () => {
    const schliessen = vi.fn();
    render(
      <Dialog offen titel="Arbeit" onClose={schliessen} groesse="gross">
        <p>Inhalt</p>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("dialog", { name: "Arbeit" }));
    expect(schliessen).not.toHaveBeenCalled();
  });
});
