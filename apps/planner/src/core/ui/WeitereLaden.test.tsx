import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WeitereLaden } from "./WeitereLaden";

describe("Nachladen einer cursorbasierten Liste", () => {
  it("zeigt keinen Knopf, wenn es nichts mehr zu laden gibt", () => {
    render(<WeitereLaden sichtbar={false} laedt={false} anzahl={3} onLaden={vi.fn()} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Alle 3 Einträge geladen.")).toBeTruthy();
  });

  it("zeigt bei einer leeren Liste gar nichts an", () => {
    const { container } = render(
      <WeitereLaden sichtbar={false} laedt={false} anzahl={0} onLaden={vi.fn()} />,
    );

    expect(container.textContent).toBe("");
  });

  it("nennt keine Seitenzahlen, sondern den Ladestand", () => {
    // Die API kennt nur Cursor - Seitennummern waeren eine Behauptung, die
    // sie nicht deckt (docs/api.md, Abschnitt 4).
    render(<WeitereLaden sichtbar laedt={false} anzahl={25} onLaden={vi.fn()} />);

    expect(screen.getByText("25 Einträge geladen")).toBeTruthy();
    expect(screen.queryByText(/Seite/)).toBeNull();
  });

  it("laedt auf Klick nach", () => {
    const onLaden = vi.fn();
    render(<WeitereLaden sichtbar laedt={false} anzahl={25} onLaden={onLaden} />);

    fireEvent.click(screen.getByRole("button", { name: "Weitere laden" }));

    expect(onLaden).toHaveBeenCalledTimes(1);
  });

  it("sperrt den Knopf waehrend des Ladens", () => {
    const onLaden = vi.fn();
    render(<WeitereLaden sichtbar laedt anzahl={25} onLaden={onLaden} />);

    const knopf = screen.getByRole("button", { name: "Wird geladen ..." });
    expect(knopf.hasAttribute("disabled")).toBe(true);
    fireEvent.click(knopf);
    expect(onLaden).not.toHaveBeenCalled();
  });
});
