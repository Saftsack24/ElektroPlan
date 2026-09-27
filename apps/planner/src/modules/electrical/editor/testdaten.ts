/** Synthetische Testdaten des Editors - ein Raum 5 × 4 m mit vier Wänden. */
import type { RaumImPlan } from "./entwurf";

function wand(id: string, x1: number, y1: number, x2: number, y2: number) {
  return {
    id,
    room_id: "raum-1",
    sort_order: 0,
    x1_mm: x1,
    y1_mm: y1,
    x2_mm: x2,
    y2_mm: y2,
    thickness_mm: 115,
    length_mm: 0,
    opening_count: 0,
    version: 1,
    created_at: "2026-09-26T08:00:00Z",
    updated_at: "2026-09-26T08:00:00Z",
    openings: [],
  };
}

export const RAUM: RaumImPlan = {
  id: "raum-1",
  floor_id: "geschoss-1",
  name: "Wohnzimmer",
  room_number: "0.01",
  height_mm: null,
  effective_height_mm: 2500,
  contour_status: "valid",
  wall_count: 4,
  area_mm2: 20_000_000,
  area_m2: "20.000",
  perimeter_mm: 18_000,
  version: 5,
  created_at: "2026-09-26T08:00:00Z",
  updated_at: "2026-09-26T08:00:00Z",
  contour_problems: [],
  walls: [
    wand("w1", 0, 0, 5000, 0),
    wand("w2", 5000, 0, 5000, 4000),
    wand("w3", 5000, 4000, 0, 4000),
    wand("w4", 0, 4000, 0, 0),
  ],
};

