import type { ApiClient, components } from "@elektroplan/api-client";

import type { SteigwegGeschoss } from "../steigweg/verlauf";
import type { Leitung, Leitungsplan, LeitungsRaum, Wegpunkt } from "./laenge";

type Schemas = components["schemas"];
export type LeitungAusServer = Schemas["CableOut"];
export type DurchfuehrungAusServer = Schemas["PenetrationOut"];
type Geschossplan = Schemas["FloorPlanOut"];
type FloorOut = Schemas["FloorOut"];
type RiserOut = Schemas["RiserOut"];
type WegpunktAusServer = Schemas["CableWaypointOut"];
export type WegpunktAnfrage = NonNullable<Schemas["CableIn"]["waypoints"]>[number];

/**
 * Daten der Leitungsplanung (Phase 6b.4, ADR 0026) - Abfragen und reine
 * Umwandlungen, ohne React.
 *
 * Die Vorschau im Leitungsentwurf rechnet mit **derselben** Funktion wie der
 * Server (`laenge.ts`, Spiegel von `cable_length.py`, gemeinsame Fixture).
 * Ihre Eingabe entsteht hier aus denselben gespeicherten Daten, die der Server
 * liest (`cable_rules.build_plan`): alle Geschosse des Gebäudes mit
 * Höhenlage, Räume mit effektiver Höhe und Wänden in Konturreihenfolge,
 * Öffnungen, Kopplungen, Geräte, Durchführungen und Steigwege.
 *
 * Alle Abfragen laufen im sitzungsgebundenen Query-Client und reichen das
 * `signal` weiter.
 */

export function leitungenSchluessel(buildingId: string) {
  return ["electrical", "cables", buildingId] as const;
}

export function leitungenAbfrage(api: ApiClient, buildingId: string) {
  return {
    queryKey: leitungenSchluessel(buildingId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get("/api/v1/modules/electrical/buildings/{building_id}/cables", { path: { building_id: buildingId }, signal }),
    staleTime: 0,
  };
}

export function durchfuehrungenSchluessel(floorId: string) {
  return ["electrical", "penetrations", floorId] as const;
}

export function durchfuehrungenAbfrage(api: ApiClient, floorId: string) {
  return {
    queryKey: durchfuehrungenSchluessel(floorId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get("/api/v1/modules/electrical/floors/{floor_id}/penetrations", { path: { floor_id: floorId }, signal }),
    staleTime: 0,
  };
}

/** Liste aus einer Antwort - ältere Testantworten liefern bisweilen `[]` statt des Objekts. */
export function liste<T>(wert: unknown, feld: string): T[] {
  if (wert === null || typeof wert !== "object" || Array.isArray(wert)) return [];
  const inhalt = (wert as Record<string, unknown>)[feld];
  return Array.isArray(inhalt) ? (inhalt as T[]) : [];
}

// ------------------------------------------------------------------ Planungsstand

/** Planungsstand des Gebäudes als Eingabe der Längenfunktion - wie `build_plan` im Backend. */
export function leitungsplanAus(eingabe: {
  geschosse: readonly Partial<FloorOut>[];
  plaene: readonly Geschossplan[];
  durchfuehrungen: readonly DurchfuehrungAusServer[];
  steigwege: readonly RiserOut[];
}): Leitungsplan {
  const geschosse: SteigwegGeschoss[] = eingabe.geschosse.flatMap((g) =>
    g.id === undefined
      ? []
      : [
          {
            id: g.id,
            level: g.level ?? 0,
            elevation_mm: g.elevation_mm ?? 0,
            elevation_confirmed: g.elevation_confirmed ?? false,
            default_ceiling_height_mm: g.default_ceiling_height_mm ?? 2500,
          },
        ],
  );
  const raeume: LeitungsRaum[] = [];
  const geraete: Leitungsplan["geraete"][number][] = [];
  const kopplungen = new Map<string, Leitungsplan["kopplungen"][number]>();
  for (const plan of eingabe.plaene) {
    const rooms = Array.isArray(plan.rooms) ? [...plan.rooms] : [];
    for (const raum of rooms.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const waende = [...raum.walls].sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : 1));
      raeume.push({
        id: raum.id,
        geschossId: raum.floor_id,
        hoeheMm: raum.effective_height_mm,
        waende: waende.map((w) => ({
          id: w.id,
          raumId: raum.id,
          start: { x: w.x1_mm, y: w.y1_mm },
          ende: { x: w.x2_mm, y: w.y2_mm },
          oeffnungen: [...(Array.isArray(w.openings) ? w.openings : [])]
            .sort((a, b) => a.offset_mm - b.offset_mm || (a.id < b.id ? -1 : 1))
            .map((o) => ({
              oeffnungId: o.id,
              art: o.kind,
              offsetMm: o.offset_mm,
              breiteMm: o.width_mm,
              hoeheMm: o.height_mm,
              bruestungMm: o.sill_height_mm,
            })),
        })),
      });
      for (const g of Array.isArray(raum.devices) ? raum.devices : []) {
        geraete.push({
          id: g.id,
          raumId: raum.id,
          flaeche: g.mounting_surface,
          wandId: g.wall_id,
          abstandMm: g.center_offset_mm,
          hoeheMm: g.center_height_mm,
          x: g.x_mm,
          y: g.y_mm,
        });
      }
    }
    for (const k of Array.isArray(plan.wall_links) ? plan.wall_links : []) {
      kopplungen.set(k.id, { id: k.id, wandA: k.wall_a_id, wandB: k.wall_b_id, beziehung: k.relation });
    }
  }
  return {
    geschosse,
    raeume,
    kopplungen: [...kopplungen.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    geraete: geraete.sort((a, b) => (a.id < b.id ? -1 : 1)),
    durchfuehrungen: [...eingabe.durchfuehrungen]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((d) => ({ id: d.id, kopplungId: d.wall_link_id, abstandMm: d.offset_mm, hoeheMm: d.height_mm })),
    steigwege: [...eingabe.steigwege]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((s) => ({
        id: s.id,
        versatz: s.offset_mode,
        halte: s.stops.map((h) => ({ schluessel: h.id, floor_id: h.floor_id, x_mm: h.x_mm, y_mm: h.y_mm })),
      })),
  };
}

// ------------------------------------------------------------------ Wegpunkte

/**
 * Gespeicherter Wegpunkt → Wegpunkt der Längenfunktion. Alle Arten bleiben
 * erhalten - auch die, die Wand- und Deckenansicht nicht bearbeiten
 * (Fußboden, Bodenübergang, Steigweg). Unvollständige Zeilen kann es nach dem
 * CHECK der Datenbank nicht geben; sie würden `null`.
 */
export function wegpunktAusServer(wp: WegpunktAusServer): Wegpunkt | null {
  switch (wp.kind) {
    case "wall":
      return wp.wall_id === null || wp.wall_id === undefined || wp.offset_mm == null || wp.height_mm == null
        ? null
        : { art: "wand", wandId: wp.wall_id, abstandMm: wp.offset_mm, hoeheMm: wp.height_mm };
    case "ceiling":
    case "floor":
      return wp.room_id == null || wp.x_mm == null || wp.y_mm == null ? null : { art: wp.kind, raumId: wp.room_id, x: wp.x_mm, y: wp.y_mm };
    case "penetration":
      return wp.penetration_id == null ? null : { art: "durchfuehrung", durchfuehrungId: wp.penetration_id };
    case "opening_crossing":
      return wp.wall_id == null || wp.offset_mm == null
        ? null
        : { art: "uebergang", wandId: wp.wall_id, abstandMm: wp.offset_mm, oeffnungId: wp.opening_id ?? null };
    case "riser":
      return wp.riser_id == null || wp.from_stop_id == null || wp.to_stop_id == null || wp.from_height_mm == null || wp.to_height_mm == null
        ? null
        : {
            art: "steigweg",
            steigwegId: wp.riser_id,
            vonHalt: wp.from_stop_id,
            vonHoeheMm: wp.from_height_mm,
            nachHalt: wp.to_stop_id,
            nachHoeheMm: wp.to_height_mm,
          };
    default:
      return null;
  }
}

/** Wegpunkt → Anfrageform. Jede Art geht unverändert zurück an den Server. */
export function wegpunktAlsAnfrage(wp: Wegpunkt): WegpunktAnfrage {
  switch (wp.art) {
    case "wand":
      return { kind: "wall", wall_id: wp.wandId, offset_mm: wp.abstandMm, height_mm: wp.hoeheMm };
    case "ceiling":
    case "floor":
      return { kind: wp.art, room_id: wp.raumId, x_mm: wp.x, y_mm: wp.y };
    case "durchfuehrung":
      return { kind: "penetration", penetration_id: wp.durchfuehrungId };
    case "uebergang":
      return { kind: "opening_crossing", wall_id: wp.wandId, offset_mm: wp.abstandMm, opening_id: wp.oeffnungId };
    case "steigweg":
      return {
        kind: "riser",
        riser_id: wp.steigwegId,
        from_stop_id: wp.vonHalt,
        from_height_mm: wp.vonHoeheMm,
        to_stop_id: wp.nachHalt,
        to_height_mm: wp.nachHoeheMm,
      };
  }
}

/** Gespeicherte Leitung → Eingabe der Längenfunktion (ungültige Zeilen fallen nie still weg). */
export function leitungAusServer(l: LeitungAusServer): { leitung: Leitung; unlesbar: number } {
  const wegpunkte: Wegpunkt[] = [];
  let unlesbar = 0;
  for (const wp of l.waypoints) {
    const w = wegpunktAusServer(wp);
    if (w === null) unlesbar += 1;
    else wegpunkte.push(w);
  }
  return {
    leitung: {
      id: l.id,
      startGeraetId: l.start_device_id,
      endGeraetId: l.end_device_id,
      wegpunkte,
      startzugabeMm: l.start_allowance_mm,
      endzugabeMm: l.end_allowance_mm,
      reserveMm: l.reserve_mm,
      kabeltyp: l.cable_type,
      leiterzahl: l.conductor_count,
      querschnittMm2: l.cross_section_mm2,
    },
    unlesbar,
  };
}

/** Kann die Wand- bzw. Deckenansicht diesen Wegpunkt bearbeiten (6b.4)? */
export function inAnsichtBearbeitbar(wp: Wegpunkt): boolean {
  return wp.art === "wand" || wp.art === "ceiling" || wp.art === "durchfuehrung";
}

/** Verständlicher Name einer Wegpunktart. */
export const WEGPUNKTART_LABEL: Record<Wegpunkt["art"], string> = {
  wand: "Wandpunkt",
  ceiling: "Deckenpunkt",
  floor: "Fußbodenpunkt",
  durchfuehrung: "Durchführung",
  uebergang: "Bodenübergang",
  steigweg: "Steigweg",
};
