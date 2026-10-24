/**
 * Synthetischer Planungsstand der Leitungstests (Phase 6b.4) - Beispiel aus
 * Entwurf §6.4: Diele (0,0)–(4200,3000), Küche (4200,0)–(8000,3000), Raumhöhe
 * je 2500, Diele.Ost = `diele-w1` ist `wall_a` der gemeinsamen Bauwand mit
 * Küche.West = `kueche-w3`. UV1 an Diele.Süd bei 500/1400, Steckdose an
 * Küche.West bei 900/300, Durchführung an Diele.Ost bei 2100/2200 (Gegenlage
 * 900). Erwartet: 8 500 mm geometrisch, mit Zugaben 500 + 200 = 9 200 mm.
 */
import type { components } from "@elektroplan/api-client";

import { rechteck } from "../ansicht3d/testplan";

type Schemas = components["schemas"];

const ZEIT = "2026-10-13T08:00:00Z";

export const DIELE = rechteck("diele", "Diele", [0, 0], [4200, 3000], {
  nummer: "0.01",
  geraete: [
    { id: "uv1", typ: "distribution_board", wand: 0, mitte: 500, hoehe: 1400 },
    { id: "sd-diele", typ: "socket_single", wand: 0, mitte: 3000, hoehe: 300 },
  ],
});

export const KUECHE = rechteck("kueche", "Küche", [4200, 0], [8000, 3000], {
  nummer: "0.02",
  geraete: [{ id: "sd-kueche", typ: "socket_single", wand: 3, mitte: 900, hoehe: 300 }],
});

export const KOPPLUNG = {
  id: "kopplung-1",
  wall_a_id: "diele-w1",
  wall_b_id: "kueche-w3",
  relation: "shared" as const,
  origin: "user" as const,
  status: "active" as const,
  thickness_conflict: false,
  version: 1,
  created_at: ZEIT,
  updated_at: ZEIT,
};

export function geschossplan(rooms = [DIELE, KUECHE]): Schemas["FloorPlanOut"] {
  return { floor_id: "geschoss-1", project_id: "projekt-1", rooms, wall_links: [KOPPLUNG], wall_link_candidates: [] };
}

export const GESCHOSS = {
  id: "geschoss-1",
  building_id: "gebaeude-1",
  name: "Erdgeschoss",
  level: 0,
  elevation_mm: 0,
  elevation_confirmed: true,
  default_ceiling_height_mm: 2500,
  version: 1,
  created_at: ZEIT,
  updated_at: ZEIT,
};

export const DURCHFUEHRUNG: Schemas["PenetrationOut"] = {
  id: "d1",
  wall_link_id: "kopplung-1",
  wall_a_id: "diele-w1",
  wall_b_id: "kueche-w3",
  floor_id: "geschoss-1",
  offset_mm: 2100,
  height_mm: 2200,
  note: null,
  opposite_offset: { whole: 900, steps: 0, rounded_mm: 900 },
  problem_code: null,
  cable_ids: ["l1"],
  version: 3,
  created_at: ZEIT,
  updated_at: ZEIT,
};

export const VERTEILUNG = { id: "board-1", building_id: "gebaeude-1", code: "UV1", name: "UV Diele", note: null, placement_device_id: "uv1", version: 1, created_at: ZEIT, updated_at: ZEIT };

export function stromkreis(over: Partial<Schemas["CircuitOut"]> = {}): Schemas["CircuitOut"] {
  return {
    id: "f3",
    board_id: "board-1",
    designation: "F3",
    name: "Steckdosen",
    sort_order: 0,
    proposed_cable_type: "NYM-J",
    proposed_conductor_count: 3,
    proposed_cross_section_mm2: "1.50",
    protective_device: null,
    rcd_group: null,
    phase_count: null,
    note: null,
    device_ids: ["sd-diele", "sd-kueche"],
    proposal_overrides_templates: false,
    version: 5,
    created_at: ZEIT,
    updated_at: ZEIT,
    ...over,
  };
}

export const WEG_L1: Schemas["CableWaypointOut"][] = [
  { kind: "wall", wall_id: "diele-w0", offset_mm: 500, height_mm: 2200 },
  { kind: "wall", wall_id: "diele-w0", offset_mm: 4200, height_mm: 2200 },
  { kind: "wall", wall_id: "diele-w1", offset_mm: 0, height_mm: 2200 },
  { kind: "penetration", penetration_id: "d1" },
];

export function leitung(over: Partial<Schemas["CableOut"]> = {}): Schemas["CableOut"] {
  return {
    id: "l1",
    circuit_id: "f3",
    label: "L1",
    start_device_id: "uv1",
    end_device_id: "sd-kueche",
    cable_type: "NYM-J",
    conductor_count: 3,
    cross_section_mm2: "1.50",
    start_allowance_mm: 500,
    end_allowance_mm: 200,
    reserve_mm: 0,
    reserve_mode: "fixed",
    reserve_percent: null,
    reserve_effective_mm: 0,
    reserve_pending: false,
    connection_allowance_mm: 700,
    spec_origin: "legacy",
    reserve_origin: "legacy",
    allowance_origin: "legacy",
    cable_template_id: null,
    cable_template_version: null,
    defaults_office_version: null,
    defaults_project_version: null,
    waypoints: WEG_L1,
    status: "confirmed",
    geometric_mm: 8500,
    allowance_mm: 700,
    length_mm: 9200,
    known_mm: 9200,
    spec_complete: true,
    deviates_from_proposal: false,
    problems: [],
    segments: [],
    penetration_ids: ["d1"],
    opening_crossings: 0,
    version: 2,
    created_at: ZEIT,
    updated_at: ZEIT,
    ...over,
  };
}

export const TYPEN = [
  {
    key: "socket_single",
    label: "Steckdose",
    category: "socket",
    symbol_key: "socket_single",
    allows_wall_interior: true,
    allows_wall_exterior: false,
    allows_ceiling: false,
    default_center_height_mm: 300,
    width_mm: 80,
    height_mm: 80,
    sort_order: 10,
    is_active: true,
  },
  {
    key: "distribution_board",
    label: "Verteilung",
    category: "distribution",
    symbol_key: "distribution_board",
    allows_wall_interior: true,
    allows_wall_exterior: false,
    allows_ceiling: false,
    default_center_height_mm: 1400,
    width_mm: 550,
    height_mm: 700,
    sort_order: 5,
    is_active: true,
  },
  {
    key: "ceiling_light",
    label: "Deckenleuchte",
    category: "light",
    symbol_key: "ceiling_light",
    allows_wall_interior: false,
    allows_wall_exterior: false,
    allows_ceiling: true,
    default_center_height_mm: null,
    width_mm: 200,
    height_mm: 200,
    sort_order: 20,
    is_active: true,
  },
];

/** Kabelvorlage (synthetisch, keine Betriebsvorgabe). */
export function vorlage(over: Partial<Schemas["CableTemplateOut"]> = {}): Schemas["CableTemplateOut"] {
  return {
    id: "vorlage-dose",
    name: "Test Dose",
    cable_type: "TEST-A",
    conductor_count: 3,
    cross_section_mm2: "1.50",
    is_active: true,
    sort_order: 0,
    in_use: false,
    version: 1,
    created_at: ZEIT,
    updated_at: ZEIT,
    ...over,
  };
}

/**
 * Wirksame Planungsvorgaben (Phase 6c) wie vom Server - synthetisch. `for_cable` folgt der Abfrage
 * (Stromkreis, Start, Ziel), sonst `null`.
 */
export function wirksam(
  query: { circuit_id?: string; start_device_id?: string; end_device_id?: string } | undefined,
  over: {
    reserve?: string;
    zugaben?: [number, number];
    kabel?: [string | null, number | null, string | null];
    kabelHerkunft?: Schemas["EffectiveSpecOut"]["origin"];
    vorlageId?: string | null;
    basis?: Partial<Schemas["DefaultsBasisOut"]>;
    hinweise?: string[];
  } = {},
): Schemas["EffectivePlanningDefaultsOut"] {
  const reserve = { percent: over.reserve ?? "20.00", origin: "project_default" as const };
  const basis = { office_version: 1, project_version: 1, ...(over.basis ?? {}) };
  const [start, ende] = over.zugaben ?? [500, 200];
  const [typ, leiter, quer] = over.kabel ?? ["TEST-A", 3, "1.50"];
  return {
    project_id: "projekt-1",
    project_status: "active",
    basis,
    reserve,
    allowances: [
      { endpoint_kind: "board", value_mm: start, origin: "office_default" },
      { endpoint_kind: "junction", value_mm: 0, origin: "none" },
      { endpoint_kind: "device", value_mm: ende, origin: "office_default" },
    ],
    default_template: null,
    device_type_templates: [],
    templates: [vorlage()],
    for_cable:
      query?.circuit_id === undefined
        ? null
        : {
            circuit_id: query.circuit_id,
            start_device_id: query.start_device_id ?? null,
            end_device_id: query.end_device_id ?? null,
            spec: {
              origin: over.kabelHerkunft ?? "device_type_template",
              cable_type: typ,
              conductor_count: leiter,
              cross_section_mm2: quer,
              cable_template_id: over.vorlageId === undefined ? "vorlage-dose" : over.vorlageId,
              level: "office",
              deciding_device_id: query.end_device_id ?? null,
            },
            reserve,
            allowances: { origin: "office_default", start_mm: start, end_mm: ende, start_origin: "office_default", end_origin: "office_default" },
            hints: (over.hinweise ?? []).map((code) => ({ code, template_id: null, device_id: null })),
            basis: { ...basis, cable_template_id: over.vorlageId === undefined ? "vorlage-dose" : over.vorlageId, cable_template_version: 1 },
          },
  };
}
