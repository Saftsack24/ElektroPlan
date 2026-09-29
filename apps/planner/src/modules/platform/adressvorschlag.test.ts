import type { CustomerOut } from "@elektroplan/api-client";
import { describe, expect, it } from "vitest";

import { ANFANGSHERKUNFT, manuellGeaendert, vorschlagAnwenden } from "./adressvorschlag";
import type { Adresse } from "./adressvorschlag";

const LEER: Adresse = { site_street: "", site_postal_code: "", site_city: "", site_country_code: "DE" };

function kunde(teil: Partial<CustomerOut>): CustomerOut {
  return {
    id: "k",
    customer_number: "KD-00001",
    kind: "private",
    name: "K",
    contact_person: null,
    email: null,
    phone: null,
    billing_street: null,
    billing_postal_code: null,
    billing_city: null,
    billing_country_code: "DE",
    anonymized_at: null,
    version: 1,
    created_at: "",
    updated_at: "",
    ...teil,
  };
}

describe("Adressvorschlag", () => {
  it("füllt leere Felder und markiert nur übernommene", () => {
    const { werte, herkunft } = vorschlagAnwenden(LEER, ANFANGSHERKUNFT, kunde({ billing_city: "Celle" }));
    expect(werte).toEqual({ ...LEER, site_city: "Celle" });
    expect(herkunft).toEqual({ site_city: "kunde", site_country_code: "kunde" });
  });

  it("überschreibt eigene Eingaben nur beim ausdrücklichen Übernehmen", () => {
    const eigene = { ...LEER, site_city: "Laatzen" };
    const herkunft = manuellGeaendert({ site_city: "kunde" }, "site_city");
    expect(vorschlagAnwenden(eigene, herkunft, kunde({ billing_city: "Celle" })).werte.site_city).toBe("Laatzen");
    expect(
      vorschlagAnwenden(eigene, herkunft, kunde({ billing_city: "Celle" }), { erzwingen: true }).werte.site_city,
    ).toBe("Celle");
  });

  it("lässt beim ausdrücklichen Übernehmen fehlende Kundenangaben unberührt", () => {
    const eigene = { ...LEER, site_street: "Eigene Str. 1" };
    const { werte } = vorschlagAnwenden(eigene, {}, kunde({ billing_city: "Celle" }), { erzwingen: true });
    expect(werte.site_street).toBe("Eigene Str. 1");
  });

  it("fällt beim Ländercode nie auf leer", () => {
    const { werte } = vorschlagAnwenden(LEER, ANFANGSHERKUNFT, kunde({ billing_country_code: "" }));
    expect(werte.site_country_code).toBe("DE");
  });

  it("ist eine Momentaufnahme: das Ergebnis teilt keinen Zustand mit dem Kunden", () => {
    const k = kunde({ billing_city: "Celle" });
    const { werte } = vorschlagAnwenden(LEER, ANFANGSHERKUNFT, k);
    k.billing_city = "Hameln";
    expect(werte.site_city).toBe("Celle");
  });
});
