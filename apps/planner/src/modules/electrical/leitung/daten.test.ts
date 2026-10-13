import { describe, expect, it } from "vitest";

import { leitungAusServer, leitungsplanAus, liste, wegpunktAlsAnfrage, wegpunktAusServer } from "./daten";
import { leitungAuswerten, planVorbereiten } from "./laenge";
import { DURCHFUEHRUNG, GESCHOSS, geschossplan, leitung } from "./testdaten";

/**
 * Datenschicht der Leitungsplanung (Phase 6b.4): Die Vorschau rechnet mit der
 * gemeinsamen Längenfunktion über denselben Planungsstand wie der Server, und
 * kein Wegpunkt geht beim Hin und Zurück verloren.
 */
describe("Planungsstand für die Vorschau", () => {
  it("ergibt für das Beispiel §6.4 dieselben 8 500 / 9 200 mm wie der Server", () => {
    const plan = leitungsplanAus({ geschosse: [GESCHOSS], plaene: [geschossplan()], durchfuehrungen: [DURCHFUEHRUNG], steigwege: [] });
    const { leitung: l } = leitungAusServer(leitung());
    const ergebnis = leitungAuswerten(planVorbereiten(plan), l);
    expect(ergebnis.status).toBe("confirmed");
    expect(ergebnis.geometrischMm).toBe(8500);
    expect(ergebnis.laengeMm).toBe(9200);
    expect(ergebnis.befunde).toEqual([]);
  });

  it("übernimmt effektive Raumhöhe, Wände in Konturreihenfolge, Öffnungen, Kopplungen und Geräte", () => {
    const plan = leitungsplanAus({ geschosse: [GESCHOSS], plaene: [geschossplan()], durchfuehrungen: [DURCHFUEHRUNG], steigwege: [] });
    const diele = plan.raeume.find((r) => r.id === "diele");
    expect(diele?.hoeheMm).toBe(2500);
    expect(diele?.waende.map((w) => w.id)).toEqual(["diele-w0", "diele-w1", "diele-w2", "diele-w3"]);
    expect(plan.kopplungen).toEqual([{ id: "kopplung-1", wandA: "diele-w1", wandB: "kueche-w3", beziehung: "shared" }]);
    expect(plan.durchfuehrungen).toEqual([{ id: "d1", kopplungId: "kopplung-1", abstandMm: 2100, hoeheMm: 2200 }]);
    expect(plan.geraete.map((g) => g.id)).toEqual(["sd-diele", "sd-kueche", "uv1"]);
  });

  it("verträgt unvollständige Geschossangaben und leere Antworten", () => {
    const plan = leitungsplanAus({ geschosse: [{ id: "g" }], plaene: [], durchfuehrungen: [], steigwege: [] });
    expect(plan.geschosse).toEqual([{ id: "g", level: 0, elevation_mm: 0, elevation_confirmed: false, default_ceiling_height_mm: 2500 }]);
    expect(liste([], "cables")).toEqual([]);
    expect(liste(undefined, "cables")).toEqual([]);
    expect(liste({ cables: [1] }, "cables")).toEqual([1]);
  });
});

describe("Wegpunkte hin und zurück", () => {
  it("jede Art geht unverändert zurück an den Server - auch die, die 6b.4 nicht bearbeitet", () => {
    const roh = [
      { kind: "wall" as const, wall_id: "w", offset_mm: 10, height_mm: 20 },
      { kind: "ceiling" as const, room_id: "r", x_mm: 1, y_mm: 2 },
      { kind: "floor" as const, room_id: "r", x_mm: 3, y_mm: 4 },
      { kind: "penetration" as const, penetration_id: "p" },
      { kind: "opening_crossing" as const, wall_id: "w", offset_mm: 5, opening_id: null },
      { kind: "riser" as const, riser_id: "s", from_stop_id: "a", from_height_mm: 2200, to_stop_id: "b", to_height_mm: 0 },
    ];
    const zurueck = roh.map((wp) => wegpunktAlsAnfrage(wegpunktAusServer(wp) as NonNullable<ReturnType<typeof wegpunktAusServer>>));
    expect(zurueck).toEqual(roh);
  });

  it("eine unlesbare Zeile wird gezählt, nicht still verworfen", () => {
    const { leitung: l, unlesbar } = leitungAusServer(leitung({ waypoints: [{ kind: "wall", wall_id: null, offset_mm: 1, height_mm: 1 }, ...leitung().waypoints] }));
    expect(unlesbar).toBe(1);
    expect(l.wegpunkte).toHaveLength(4);
  });
});
