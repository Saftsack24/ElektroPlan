import { render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AKTION } from "./aktionssymbole";
import { Dialog } from "./Dialog";
import { MitSymbol, Symbol } from "./Symbol";

/** Einheitliches Icon-System (Phase 4d). */
describe("Symbol", () => {
  it("ist rein dekorativ und nicht fokussierbar", () => {
    const { container } = render(<Symbol icon={AKTION.loeschen} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("überlässt den zugänglichen Namen dem Text", () => {
    render(
      <button type="button">
        <MitSymbol icon={AKTION.anlegen}>Neuer Kunde</MitSymbol>
      </button>,
    );
    expect(screen.getByRole("button", { name: "Neuer Kunde" })).toBeInTheDocument();
  });

  it("nutzt für den Dialog-Schließen-Knopf aria-label und Tooltip", () => {
    render(
      <Dialog offen titel="Test" onClose={() => undefined}>
        <p>Inhalt</p>
      </Dialog>,
    );
    const knopf = screen.getByRole("button", { name: "Dialog schließen" });
    expect(knopf).toHaveAttribute("title", "Dialog schließen");
    expect(knopf.textContent).toBe("");
  });
});

/** Keine Emojis und Pfeilzeichen mehr als Aktionsicons im Quelltext der Oberfläche. */
describe("Aktionsicons im Quelltext", () => {
  function dateien(verzeichnis: string): string[] {
    return readdirSync(verzeichnis).flatMap((name) => {
      const pfad = join(verzeichnis, name);
      if (statSync(pfad).isDirectory()) return dateien(pfad);
      return pfad.endsWith(".tsx") && !pfad.endsWith(".test.tsx") ? [pfad] : [];
    });
  }

  it("enthält kein ✕ und keine Pfeilzeichen in Links oder Knöpfen", () => {
    const wurzel = join(__dirname, "..", "..");
    const funde = dateien(wurzel).filter((pfad) => {
      const text = readFileSync(pfad, "utf-8");
      return />\s*[✕←→🗑✎⚙]/u.test(text) || /[✕🗑✎⚙]\s*</u.test(text);
    });
    expect(funde).toEqual([]);
  });
});
