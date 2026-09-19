import { describe, expect, it } from "vitest";

import { zuordenbareKunden } from "./auswahl";

function kunde(name: string, anonymisiert: string | null) {
  return {
    id: name,
    customer_number: `KD-0000${name.length}`,
    kind: "private" as const,
    name,
    contact_person: null,
    email: null,
    phone: null,
    billing_street: null,
    billing_postal_code: null,
    billing_city: null,
    billing_country_code: "DE",
    anonymized_at: anonymisiert,
    version: 1,
    created_at: "2026-09-19T10:00:00Z",
    updated_at: "2026-09-19T10:00:00Z",
  };
}

describe("Kundenauswahl für neue Projekte", () => {
  it("bietet aktive Kunden an", () => {
    const auswahl = zuordenbareKunden([kunde("Ahrens", null), kunde("Bau GmbH", null)]);

    expect(auswahl.map((eintrag) => eintrag.name)).toEqual(["Ahrens", "Bau GmbH"]);
  });

  it("lässt anonymisierte Kunden weg", () => {
    // Der Server lehnt sie mit 404 ab - die Auswahl darf nicht in eine
    // Sackgasse führen.
    const auswahl = zuordenbareKunden([
      kunde("Ahrens", null),
      kunde("Geloeschter Kunde", "2026-09-19T12:00:00Z"),
    ]);

    expect(auswahl.map((eintrag) => eintrag.name)).toEqual(["Ahrens"]);
  });

  it("kommt mit einer leeren Liste zurecht", () => {
    expect(zuordenbareKunden([])).toEqual([]);
  });
});
