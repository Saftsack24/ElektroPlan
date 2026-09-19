import { render, screen } from "@testing-library/react";
import { lazy } from "react";
import { describe, expect, it } from "vitest";

import { ProjectTabsProvider, useProjectTabs } from "./ProjectTabs";
import type { ProjectTab } from "./types";

const seite = lazy(() => Promise.resolve({ default: () => <div /> }));

function Anzeige() {
  const tabs = useProjectTabs();
  return <span data-testid="tabs">{tabs.map((tab) => tab.label).join(", ") || "keine"}</span>;
}

describe("Projekt-Tabs der Fachmodule", () => {
  it("liefert ohne Provider eine leere Liste", () => {
    // Genau der Zustand von Phase 2: Es ist kein Fachmodul registriert.
    render(<Anzeige />);

    expect(screen.getByTestId("tabs").textContent).toBe("keine");
  });

  it("reicht die Beitraege der Composition Root durch", () => {
    const tabs: ProjectTab[] = [
      { id: "electrical-plan", label: "Elektroplanung", order: 20, element: seite },
      { id: "material", label: "Material", order: 30, element: seite },
    ];

    render(
      <ProjectTabsProvider tabs={tabs}>
        <Anzeige />
      </ProjectTabsProvider>,
    );

    expect(screen.getByTestId("tabs").textContent).toBe("Elektroplanung, Material");
  });
});
