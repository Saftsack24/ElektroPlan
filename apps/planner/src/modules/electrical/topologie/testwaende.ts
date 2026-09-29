/**
 * Testhilfe: Planungsstand → Topologiewände. Dieselbe Übersetzung nimmt die
 * 3D-Ansicht vor; hier ohne deren Gültigkeitsprüfung, damit die reine
 * Topologie auf beliebigen Plänen getestet werden kann.
 */
import type { components } from "@elektroplan/api-client";

import type { TopoWand } from "./wandtopologie";

type Geschossplan = components["schemas"]["FloorPlanOut"];

export function topoWaendeAus(plan: Geschossplan): TopoWand[] {
  return plan.rooms.flatMap((raum) =>
    raum.walls.map((w) => ({
      id: w.id,
      raumId: raum.id,
      start: { x: w.x1_mm, y: w.y1_mm },
      ende: { x: w.x2_mm, y: w.y2_mm },
      oeffnungen: w.openings.map((o) => ({
        oeffnungId: o.id,
        art: o.kind,
        offsetMm: o.offset_mm,
        breiteMm: o.width_mm,
        hoeheMm: o.height_mm,
        bruestungMm: o.sill_height_mm,
      })),
    })),
  );
}
