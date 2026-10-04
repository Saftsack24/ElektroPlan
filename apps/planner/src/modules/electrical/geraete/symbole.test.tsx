import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Geraetetyp } from "./katalog";
import { Geraetelegende, Geraetesymbol, SYMBOLSCHLUESSEL } from "./symbole";

/** Startumfang des Systemkatalogs (apps/backend/app/modules/electrical/catalog.py). */
const KATALOG = [
  "socket_single",
  "socket_double",
  "socket_triple",
  "socket_outdoor",
  "switch_single",
  "switch_two_way",
  "switch_series",
  "light_ceiling",
  "light_recessed",
  "light_wall",
  "light_outdoor",
  "data_single",
  "data_double",
];

describe("Planungssymbole (T1)", () => {
  it("jeder ausgelieferte Gerätetyp hat ein eigenes Symbol", () => {
    expect(KATALOG.filter((k) => !SYMBOLSCHLUESSEL.includes(k))).toEqual([]);
  });

  it("unbekannter Schlüssel fällt auf das Symbol der Kategorie zurück, nichts von außen", () => {
    const { container } = render(<Geraetesymbol typ={{ symbol_key: "<script>", category: "light" }} />);
    expect(container.querySelector("svg circle")).not.toBeNull();
    expect(container.innerHTML).not.toContain("script");
  });

  it("Legende nach Kategorien, nur aktive Typen, mit Montageflächen und ohne Normanspruch", () => {
    const t = (key: string, label: string, teile: Partial<Geraetetyp>): Geraetetyp => ({
      key,
      label,
      category: "socket",
      symbol_key: key,
      allows_wall_interior: true,
      allows_wall_exterior: false,
      allows_ceiling: false,
      default_center_height_mm: 300,
      width_mm: 80,
      height_mm: 80,
      sort_order: 1,
      is_active: true,
      ...teile,
    });
    render(
      <Geraetelegende
        typen={
          new Map([
            ["a", t("a", "Steckdose", {})],
            ["b", t("b", "Außenleuchte (Wand)", { category: "light", allows_wall_interior: false, allows_wall_exterior: true })],
            ["c", t("c", "Alt", { is_active: false })],
          ])
        }
      />,
    );
    expect(screen.getByRole("region", { name: "Steckdosen" })).toHaveTextContent("Steckdose· Wand innen");
    expect(screen.getByRole("region", { name: "Leuchten" })).toHaveTextContent("Fassade außen");
    expect(screen.queryByText("Alt")).toBeNull();
    expect(screen.getByText(/keine Normdarstellung/)).toBeInTheDocument();
  });
});
