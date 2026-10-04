/**
 * Geräte in der 3D-Ansicht - reine Ableitung aus dem Planungsstand (Phase 5, ADR 0023).
 *
 * Nichts wird zurückgeschrieben. Alle Werte bleiben ganze Millimeter; erst die
 * Szene rechnet über die Transformation in Meter.
 *
 * * **Wandgeräte** sitzen auf der Wandfläche ihrer Montageseite: Anker auf der
 *   Wandachse an der gespeicherten Mitte, versetzt um die halbe Wandstärke zur
 *   Innenseite (`wall_interior`) bzw. zur Fassade (`wall_exterior`). Die Höhe ist
 *   die gespeicherte Mitte über FFB.
 * * **Deckengeräte** sitzen auf der **effektiven Raumhöhe** ihres Raums - so wie
 *   sie gespeichert sind: ohne eigene Höhe. Unterschiedliche Raumhöhen ergeben
 *   unterschiedliche Montagehöhen. Eine geschlossene Deckenfläche braucht es
 *   dafür nicht.
 *
 * Nur Räume, die die 3D-Ansicht darstellt (geschlossene, gültige Kontur), tragen
 * Geräte; die übrigen fehlen dort samt ihren Geräten.
 */
import type { components } from "@elektroplan/api-client";

import type { Geraetetyp } from "../geraete/katalog";
import type { PunktMm, RaumImPlan } from "./modell";

export type Montageflaeche = components["schemas"]["DeviceOut"]["mounting_surface"];

export interface Geraet3d {
  readonly id: string;
  readonly raumId: string;
  readonly flaeche: Montageflaeche;
  readonly typKey: string;
  readonly typ: Geraetetyp | undefined;
  /** Anzeigename: Typ, ggf. mit eigener Beschriftung. */
  readonly name: string;
  /** Text der Beschriftung in 3D: eigene Beschriftung, sonst der Typ. */
  readonly beschriftung: string;
  /** Anker im Grundriss (mm): auf der Wandfläche bzw. unter der Decke. */
  readonly anker: PunktMm;
  /** Mitte über FFB (Wand) bzw. effektive Raumhöhe (Decke). */
  readonly hoeheMm: number;
  /** Planungsmaß des Typs. */
  readonly breiteMm: number;
  readonly hoeheMassMm: number;
  /** Nur Wand: Einheitsvektor entlang der Wand und Normale zur Montageseite (Grundriss). */
  readonly entlang: PunktMm;
  readonly normale: PunktMm;
  readonly wandId: string | null;
  /** Wandnummer im Raum (ab 1) - nur Wand. */
  readonly wandNummer: number | null;
  /** Effektive Raumhöhe - für die Orientierungslinie zum Boden. */
  readonly raumhoeheMm: number;
}

/** Doppelte vorzeichenbehaftete Fläche - positiv gegen den Uhrzeigersinn. */
function doppelteFlaeche(punkte: readonly PunktMm[]): number {
  let summe = 0;
  punkte.forEach((p, i) => {
    const n = punkte[(i + 1) % punkte.length] as PunktMm;
    summe += p.x * n.y - n.x * p.y;
  });
  return summe;
}

export function geraeteAus(
  rooms: readonly RaumImPlan[],
  dargestellt: ReadonlySet<string>,
  typen: ReadonlyMap<string, Geraetetyp>,
): Geraet3d[] {
  const ergebnis: Geraet3d[] = [];
  for (const raum of rooms) {
    if (!dargestellt.has(raum.id)) continue;
    const devices = Array.isArray(raum.devices) ? raum.devices : [];
    if (devices.length === 0) continue;
    const gegenUhr = doppelteFlaeche(raum.walls.map((w) => ({ x: w.x1_mm, y: w.y1_mm }))) > 0;
    for (const g of devices) {
      const typ = typen.get(g.device_type_key);
      const name = g.label !== null && g.label !== "" ? `${typ?.label ?? g.device_type_key} „${g.label}“` : (typ?.label ?? g.device_type_key);
      const gemeinsam = {
        id: g.id,
        raumId: raum.id,
        flaeche: g.mounting_surface,
        typKey: g.device_type_key,
        typ,
        name,
        beschriftung: g.label ?? typ?.label ?? g.device_type_key,
        breiteMm: typ?.width_mm ?? 80,
        hoeheMassMm: typ?.height_mm ?? 80,
        raumhoeheMm: raum.effective_height_mm,
      };
      if (g.mounting_surface === "ceiling") {
        if (g.x_mm === null || g.y_mm === null) continue;
        ergebnis.push({
          ...gemeinsam,
          anker: { x: g.x_mm, y: g.y_mm },
          hoeheMm: raum.effective_height_mm,
          entlang: { x: 1, y: 0 },
          normale: { x: 0, y: 0 },
          wandId: null,
          wandNummer: null,
        });
        continue;
      }
      const index = raum.walls.findIndex((w) => w.id === g.wall_id);
      const w = raum.walls[index];
      if (w === undefined || g.center_offset_mm === null || g.center_height_mm === null) continue;
      const dx = w.x2_mm - w.x1_mm;
      const dy = w.y2_mm - w.y1_mm;
      const l = Math.hypot(dx, dy) || 1;
      const entlang = { x: dx / l, y: dy / l };
      // Innen liegt links der Wandrichtung bei gegen den Uhrzeigersinn, sonst rechts.
      const links = { x: -entlang.y, y: entlang.x };
      const innen = gegenUhr ? links : { x: -links.x, y: -links.y };
      const normale = g.mounting_surface === "wall_interior" ? innen : { x: -innen.x, y: -innen.y };
      const halb = w.thickness_mm / 2;
      const t = g.center_offset_mm / l;
      ergebnis.push({
        ...gemeinsam,
        anker: { x: w.x1_mm + dx * t + normale.x * halb, y: w.y1_mm + dy * t + normale.y * halb },
        hoeheMm: g.center_height_mm,
        entlang,
        normale,
        wandId: w.id,
        wandNummer: index + 1,
      });
    }
  }
  return ergebnis;
}
