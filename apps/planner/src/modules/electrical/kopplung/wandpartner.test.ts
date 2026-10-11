import { describe, expect, it } from "vitest";

import type { TopoWand } from "../topologie/wandtopologie";
import { wandtopologie } from "../topologie/wandtopologie";
import { partnerzustand, wandpartner } from "./wandpartner";
import type { KandidatImPlan, KopplungImPlan } from "./zuordnung";
import { kopplungenAus } from "./zuordnung";

/** A.a2 (4000,0)->(4000,3000) und B.b4 (4000,3000)->(4000,0) liegen aufeinander. */
function waende(versatz = 0, staerkeB = 115): (TopoWand & { staerkeMm: number })[] {
  const wand = (id: string, raumId: string, x1: number, y1: number, x2: number, y2: number, staerkeMm = 115) => ({
    id,
    raumId,
    start: { x: x1, y: y1 },
    ende: { x: x2, y: y2 },
    oeffnungen: [],
    staerkeMm,
  });
  return [wand("a2", "A", 4000, 0, 4000, 3000), wand("b4", "B", 4000 + versatz, 3000, 4000 + versatz, 0, staerkeB)];
}

function kopplung(relation: "shared" | "separate"): KopplungImPlan {
  return {
    id: "k1",
    wall_a_id: "a2",
    wall_b_id: "b4",
    relation,
    origin: "backfill",
    status: "active",
    thickness_conflict: false,
    version: 3,
    created_at: "2026-10-06T08:00:00Z",
    updated_at: "2026-10-06T08:00:00Z",
  };
}

const vorschlag: KandidatImPlan = { wall_a_id: "a2", wall_b_id: "b4", kind: "suggested", reasons: [] };

describe("Wandpartner", () => {
  it("offen mit Vorschlag: Bereich und Partnerwand, keine Kopplung", () => {
    const [p] = wandpartner(wandtopologie("g", waende()), "a2", [], [vorschlag]);
    expect(p).toMatchObject({ wandId: "b4", raumId: "B", kopplung: null, bereiche: [{ vonMm: 0, bisMm: 3000 }] });
    expect(p && partnerzustand(p)).toBe("vorschlag");
  });

  it("gemeinsam und getrennt aus der gespeicherten Kopplung - auch von der anderen Seite", () => {
    for (const relation of ["shared", "separate"] as const) {
      const links = [kopplung(relation)];
      const topologie = wandtopologie("g", waende(), kopplungenAus(links));
      const [vonB] = wandpartner(topologie, "b4", links, []);
      expect(vonB?.wandId).toBe("a2");
      expect(vonB && partnerzustand(vonB)).toBe(relation === "shared" ? "gemeinsam" : "getrennt");
    }
  });

  it("verschobene Wand im Entwurf: sofort als unterbrochen erkennbar", () => {
    const links = [kopplung("shared")];
    const [p] = wandpartner(wandtopologie("g", waende(1), kopplungenAus(links)), "a2", links, []);
    expect(p).toMatchObject({ wandId: "b4", status: "broken", bereiche: [] });
    expect(p && partnerzustand(p)).toBe("unterbrochen");
  });

  it("abweichende Stärke wird bei gemeinsamer Bauwand erkannt", () => {
    const links = [kopplung("shared")];
    const [p] = wandpartner(wandtopologie("g", waende(0, 240), kopplungenAus(links)), "a2", links, []);
    expect(p?.staerkeAbweichend).toBe(true);
  });

  it("nicht koppelbar bei einer dritten Wand", () => {
    const dritte = { id: "c1", raumId: "C", start: { x: 4000, y: 0 }, ende: { x: 4000, y: 1500 }, oeffnungen: [], staerkeMm: 115 };
    const partner = wandpartner(wandtopologie("g", [...waende(), dritte]), "a2", [], []);
    expect(partner.map((p) => [p.wandId, partnerzustand(p)])).toEqual([
      ["b4", "nicht-eindeutig"],
      ["c1", "nicht-eindeutig"],
    ]);
  });

  it("ohne Nachbarn: keine Partner", () => {
    expect(wandpartner(wandtopologie("g", waende(1)), "a2", [], [])).toEqual([]);
  });
});
