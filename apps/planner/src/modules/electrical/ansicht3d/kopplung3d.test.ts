import { describe, expect, it } from "vitest";

import { fugenGeometrie, wandGeometrie } from "./geometrien";
import type { KopplungImPlan } from "./modell";
import { szenenmodellAus } from "./szenenmodell";
import { plan, rechteck } from "./testplan";

/**
 * Wandkopplung in der 3D-Ansicht (Phase 6a, ADR 0024): `separate` als zwei
 * Halbkörper je Raumseite, Öffnung nur im eigenen; `shared` und unentschieden
 * ein Körper; unterbrochene Kopplungen als Hinweis. Synthetische Daten:
 * A (0,0)-(4000,3000), B (4000,0)-(7000,3000); `a-w1` und `b-w3` liegen
 * gegenläufig aufeinander.
 */
function kopplung(relation: "shared" | "separate", status: KopplungImPlan["status"] = "active"): KopplungImPlan {
  return {
    id: "k1",
    wall_a_id: "a-w1",
    wall_b_id: "b-w3",
    relation,
    origin: "user",
    status,
    thickness_conflict: false,
    version: 1,
    created_at: "2026-10-06T08:00:00Z",
    updated_at: "2026-10-06T08:00:00Z",
  };
}

function raeume(staerkeB = 115) {
  return [
    rechteck("a", "A", [0, 0], [4000, 3000], { oeffnungen: { 1: [{ id: "t1", offset: 1000, breite: 900, hoehe: 2000 }] } }),
    rechteck("b", "B", [4000, 0], [7000, 3000], { staerke: staerkeB }),
  ];
}

const gemeinsameWand = (modell: ReturnType<typeof szenenmodellAus>) =>
  modell.waende.find((w) => w.quellen.some((q) => q.id === "a-w1") && w.quellen.some((q) => q.id === "b-w3"));

describe("3D: getrennte Wände", () => {
  it("zwei Halbkörper je auf der Raumseite, die Tür schneidet nur den eigenen", () => {
    const modell = szenenmodellAus(plan(raeume(), "geschoss-1", [kopplung("separate")]));
    const wand = gemeinsameWand(modell);
    expect(wand?.zuordnung).toBe("separate");
    expect(wand?.kopplungId).toBe("k1");
    const halb = new Map(wand?.halbkoerper.map((h) => [h.raumId, h]));
    // Kanonische Richtung nach Norden: A liegt links (westlich), B rechts (östlich).
    expect([halb.get("a")?.q0Mm, halb.get("a")?.q1Mm]).toEqual([-57.5, 0]);
    expect([halb.get("b")?.q0Mm, halb.get("b")?.q1Mm]).toEqual([0, 57.5]);
    expect(halb.get("a")?.teile.length).toBeGreaterThan(1);
    expect(halb.get("b")?.teile).toEqual([{ s0: 0, s1: 3000, h0: 0, h1: 2500 }]);

    const tuer = wand?.oeffnungen.find((o) => o.id === "t1");
    expect(tuer?.klasse).toBe("getrennt");
    expect(tuer?.querMm).toBe(-28.75);
    expect(modell.warnungen.map((w) => w.code)).toContain("oeffnung-einseitig");
  });

  it("verschiedene Stärken sind bei getrennten Wänden kein Konflikt", () => {
    const getrennt = szenenmodellAus(plan(raeume(240), "geschoss-1", [kopplung("separate")]));
    expect(getrennt.warnungen.map((w) => w.code)).not.toContain("wand-staerke-abweichend");
    const halb = new Map(gemeinsameWand(getrennt)?.halbkoerper.map((h) => [h.raumId, h]));
    expect(halb.get("b")?.q1Mm).toBe(120);

    const gemeinsam = szenenmodellAus(plan(raeume(240), "geschoss-1", [kopplung("shared")]));
    const warnung = gemeinsam.warnungen.find((w) => w.code === "wand-staerke-abweichend");
    expect(warnung?.titel).toBe("Widersprüchliche Stärke der gemeinsamen Bauwand");
  });

  it("Geometrie: zwei Körper in einem Mesh und eine Trennfuge", () => {
    const modell = szenenmodellAus(plan(raeume(), "geschoss-1", [kopplung("separate")]));
    const wand = gemeinsameWand(modell);
    expect(wand).toBeDefined();
    if (wand === undefined) return;
    expect(wandGeometrie(wand, modell.transformation)).not.toBeNull();
    expect(fugenGeometrie(wand, modell.transformation)).not.toBeNull();
  });
});

describe("3D: gemeinsame Bauwand und offene Zuordnung", () => {
  it("shared bleibt ein Körper, die Tür verbindet beide Räume", () => {
    const modell = szenenmodellAus(plan(raeume(), "geschoss-1", [kopplung("shared")]));
    const wand = gemeinsameWand(modell);
    expect(wand?.zuordnung).toBe("shared");
    expect(wand?.halbkoerper).toEqual([]);
    expect(wand?.oeffnungen.find((o) => o.id === "t1")?.klasse).toBe("gemeinsam");
    if (wand !== undefined) expect(fugenGeometrie(wand, modell.transformation)).toBeNull();
  });

  it("ohne Kopplung: unentschieden mit dem Vorschlag des Servers", () => {
    const modell = szenenmodellAus(
      plan(raeume(), "geschoss-1", [], [{ wall_a_id: "a-w1", wall_b_id: "b-w3", kind: "suggested", reasons: [] }]),
    );
    const wand = gemeinsameWand(modell);
    expect(wand?.zuordnung).toBe("undecided");
    expect(wand?.kandidat).toEqual({ art: "suggested", gruende: [] });
  });

  it("unterbrochene Kopplung erscheint als Hinweis und wirkt nicht", () => {
    const verschoben = [
      raeume()[0] as ReturnType<typeof rechteck>,
      rechteck("b", "B", [4500, 0], [7000, 3000]),
    ];
    const modell = szenenmodellAus(plan(verschoben, "geschoss-1", [kopplung("separate", "broken")]));
    const hinweis = modell.warnungen.find((w) => w.code === "kopplung-unterbrochen");
    expect(hinweis?.text).toMatch(/„A“ und „B“/);
    expect(modell.waende.some((w) => w.zuordnung === "separate")).toBe(false);
  });
});
