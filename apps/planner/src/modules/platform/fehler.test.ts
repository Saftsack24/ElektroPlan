import { ApiError } from "@elektroplan/api-client";
import { describe, expect, it } from "vitest";

import { alsFormularfehler, feldtext } from "./fehler";

const KUNDENFELDER = ["name", "email", "kind"] as const;

function problem(errors: { field: string; code: string; message: string }[]) {
  return new ApiError(
    422,
    {
      type: "https://elektroplan.internal/errors/validation-failed",
      title: "Ungueltige Eingabe",
      status: 422,
      detail: "Die Anfrage enthaelt ungueltige Werte.",
      errors,
    },
    null,
  );
}

describe("Fehlerübersetzung für Formulare", () => {
  it("bildet bekannte Codes auf deutsche Sätze ab", () => {
    expect(feldtext("missing")).toBe("Dieses Feld wird benötigt.");
    expect(feldtext("value_error")).toBe("Der Wert hat nicht das erwartete Format.");
  });

  it("nennt bei unbekanntem Code keine technische Rohmeldung", () => {
    const text = feldtext("json_invalid_whatever");

    expect(text).toBe("Diese Eingabe ist ungültig.");
    expect(text).not.toContain("json");
  });

  it("ordnet Feldfehler den Formularfeldern zu", () => {
    const ergebnis = alsFormularfehler(
      problem([{ field: "email", code: "value_error", message: "not a valid email" }]),
      KUNDENFELDER,
    );

    expect(ergebnis.felder).toEqual({ email: "Der Wert hat nicht das erwartete Format." });
    expect(ergebnis.fehler).toBe("Bitte die markierten Felder prüfen.");
  });

  it("gibt englische Rohmeldungen des Servers nicht weiter", () => {
    const ergebnis = alsFormularfehler(
      problem([{ field: "name", code: "missing", message: "Field required" }]),
      KUNDENFELDER,
    );

    expect(JSON.stringify(ergebnis)).not.toContain("Field required");
  });

  it("ignoriert Felder, die das Formular nicht kennt", () => {
    const ergebnis = alsFormularfehler(
      problem([{ field: "customer_number", code: "extra_forbidden", message: "x" }]),
      KUNDENFELDER,
    );

    expect(ergebnis.felder).toBeUndefined();
    expect(ergebnis.fehler).toBe("Die Anfrage enthaelt ungueltige Werte.");
  });

  it("nutzt bei einem Fachfehler die Meldung des Servers", () => {
    const konflikt = new ApiError(
      409,
      {
        type: "https://elektroplan.internal/errors/project-archived",
        title: "Projekt ist archiviert",
        status: 409,
        detail: "Projekt PR-2026-0001 ist archiviert und damit schreibgeschuetzt.",
      },
      null,
    );

    const ergebnis = alsFormularfehler(konflikt, KUNDENFELDER);

    expect(ergebnis.fehler).toContain("archiviert");
    expect(ergebnis.felder).toBeUndefined();
  });

  it("faengt Fehler ab, die gar keine API-Antwort sind", () => {
    const ergebnis = alsFormularfehler(new TypeError("Failed to fetch"), KUNDENFELDER);

    expect(ergebnis.fehler).toBe(
      "Die Anfrage konnte nicht gesendet werden. Bitte erneut versuchen.",
    );
    expect(JSON.stringify(ergebnis)).not.toContain("fetch");
  });
});
