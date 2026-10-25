import type { ApiClient, components } from "@elektroplan/api-client";

import type { Geraetekategorie, Geraetetypen } from "../geraete/katalog";
import { geraetName } from "../geraete/katalog";

type Schemas = components["schemas"];
export type Verteilung = Schemas["DistributionBoardOut"];
export type Stromkreis = Schemas["CircuitOut"];
type Geschossplan = Schemas["FloorPlanOut"];
type FloorOut = Schemas["FloorOut"];

/**
 * Daten der Stromkreisverwaltung (Phase 6b.1, ADR 0026) - reine Funktionen und
 * Abfragen, ohne React.
 *
 * Alle Abfragen laufen im sitzungsgebundenen Query-Client (`sitzungsraum.ts`):
 * Nach einem Benutzer- oder Betriebswechsel ist der Cache leer, laufende
 * Anfragen sind abgebrochen. Das `signal` der Abfrage wird zusätzlich
 * weitergereicht, damit eine überholte Anfrage beim Gebäudewechsel endet.
 */

export function verteilungenSchluessel(buildingId: string) {
  return ["electrical", "distribution-boards", buildingId] as const;
}

export function stromkreiseSchluessel(buildingId: string) {
  return ["electrical", "circuits", buildingId] as const;
}

export function verteilungenAbfrage(api: ApiClient, buildingId: string) {
  return {
    queryKey: verteilungenSchluessel(buildingId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get("/api/v1/modules/electrical/buildings/{building_id}/distribution-boards", {
        path: { building_id: buildingId },
        signal,
      }),
    staleTime: 0,
  };
}

export function stromkreiseAbfrage(api: ApiClient, buildingId: string) {
  return {
    queryKey: stromkreiseSchluessel(buildingId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get("/api/v1/modules/electrical/buildings/{building_id}/circuits", {
        path: { building_id: buildingId },
        signal,
      }),
    staleTime: 0,
  };
}

/** Kategorien, die einem Stromkreis zugeordnet werden können - Spiegel von `ASSIGNABLE_CATEGORIES`. */
export const ZUORDENBAR: ReadonlySet<Geraetekategorie> = new Set<Geraetekategorie>(["socket", "switch", "light", "junction", "connection"]);

/** Ein gespeichertes Gerät des Gebäudes mit Lage im Grundriss seines Geschosses. */
export interface Planergeraet {
  id: string;
  floorId: string;
  geschoss: string;
  raumId: string;
  raum: string;
  typKey: string;
  kategorie: Geraetekategorie | undefined;
  name: string;
  /** Lage im Grundriss (Wandgeräte auf der Wandachse, Deckengeräte an ihrer Stelle). */
  x_mm: number;
  y_mm: number;
  zuordenbar: boolean;
}

/**
 * Alle **gespeicherten** Geräte eines Gebäudes aus den Planabfragen seiner
 * Geschosse. Ungespeicherte Geräte eines offenen Raumentwurfs kommen hier nie
 * vor - sie sind kein Zuordnungsziel.
 */
export function geraeteDesGebaeudes(
  geschosse: readonly Pick<FloorOut, "id" | "name" | "level">[],
  plaene: ReadonlyMap<string, Geschossplan>,
  typen: Geraetetypen,
): Planergeraet[] {
  const ergebnis: Planergeraet[] = [];
  const geordnet = [...geschosse].sort((a, b) => b.level - a.level);
  for (const geschoss of geordnet) {
    const plan = plaene.get(geschoss.id);
    if (plan === undefined) continue;
    for (const raum of [...plan.rooms].sort((a, b) => a.name.localeCompare(b.name, "de"))) {
      const waende = new Map(raum.walls.map((w) => [w.id, w]));
      for (const g of raum.devices) {
        const typ = typen.get(g.device_type_key);
        let x = g.x_mm;
        let y = g.y_mm;
        if (g.wall_id !== null) {
          const w = waende.get(g.wall_id);
          if (w === undefined) continue;
          const laenge = Math.hypot(w.x2_mm - w.x1_mm, w.y2_mm - w.y1_mm) || 1;
          const t = (g.center_offset_mm ?? 0) / laenge;
          x = Math.round(w.x1_mm + (w.x2_mm - w.x1_mm) * t);
          y = Math.round(w.y1_mm + (w.y2_mm - w.y1_mm) * t);
        }
        if (x === null || y === null) continue;
        ergebnis.push({
          id: g.id,
          floorId: geschoss.id,
          geschoss: geschoss.name,
          raumId: raum.id,
          raum: raum.name,
          typKey: g.device_type_key,
          kategorie: typ?.category,
          name: geraetName(typ, g.label, g.device_type_key),
          x_mm: x,
          y_mm: y,
          zuordenbar: typ !== undefined && ZUORDENBAR.has(typ.category),
        });
      }
    }
  }
  return ergebnis;
}

/** Stromkreis je zugeordnetem Gerät. */
export function zuordnungNachGeraet(stromkreise: readonly Stromkreis[]): Map<string, Stromkreis> {
  const ergebnis = new Map<string, Stromkreis>();
  for (const kreis of stromkreise) for (const id of kreis.device_ids) ergebnis.set(id, kreis);
  return ergebnis;
}

/** Verständliche Bezeichnung eines Stromkreises mit seiner Verteilung, ohne IDs. */
export function kreisBezeichnung(kreis: Pick<Stromkreis, "designation" | "name" | "board_id">, verteilungen: readonly Verteilung[]): string {
  const verteilung = verteilungen.find((v) => v.id === kreis.board_id);
  return `${verteilung === undefined ? "" : `${verteilung.code} · `}${kreis.designation} ${kreis.name}`.trim();
}

/** Lagegeräte (`distribution_board`), die noch keine andere Verteilung platzieren. */
export function freieLagegeraete(
  geraete: readonly Planergeraet[],
  verteilungen: readonly Verteilung[],
  ausser: string | null,
): Planergeraet[] {
  const belegt = new Set(
    verteilungen.filter((v) => v.id !== ausser && v.placement_device_id !== null).map((v) => v.placement_device_id),
  );
  return geraete.filter((g) => g.typKey === "distribution_board" && !belegt.has(g.id));
}

// ------------------------------------------------------- Zuordnungsentwurf

export interface Zuordnungsentwurf {
  circuitId: string;
  version: number;
  basis: ReadonlySet<string>;
  auswahl: ReadonlySet<string>;
}

export function zuordnungAus(kreis: Stromkreis): Zuordnungsentwurf {
  const ids = new Set(kreis.device_ids);
  return { circuitId: kreis.id, version: kreis.version, basis: ids, auswahl: new Set(ids) };
}

export function zuordnungUmschalten(entwurf: Zuordnungsentwurf, id: string): Zuordnungsentwurf {
  const auswahl = new Set(entwurf.auswahl);
  if (auswahl.has(id)) auswahl.delete(id);
  else auswahl.add(id);
  return { ...entwurf, auswahl };
}

export function zuordnungGeaendert(entwurf: Zuordnungsentwurf): boolean {
  if (entwurf.basis.size !== entwurf.auswahl.size) return true;
  for (const id of entwurf.auswahl) if (!entwurf.basis.has(id)) return true;
  return false;
}

/** Querschnitt aus der Eingabe (Komma oder Punkt) als API-Dezimalstring; `null` = leer. */
export function querschnittLesen(text: string): { ok: true; wert: string | null } | { ok: false; fehler: string } {
  const roh = text.trim().replace(/\s*mm²?$/i, "").replace(",", ".");
  if (roh === "") return { ok: true, wert: null };
  if (!/^[0-9]{1,4}(\.[0-9]{1,2})?$/.test(roh)) {
    return { ok: false, fehler: "Bitte einen Querschnitt wie 1,5 oder 2,5 (höchstens zwei Nachkommastellen) angeben." };
  }
  if (/^0+(\.0+)?$/.test(roh)) return { ok: false, fehler: "Der Querschnitt muss größer als 0 sein." };
  return { ok: true, wert: roh };
}

/** Querschnitt für die Anzeige: „1,5 mm²“ (Server liefert „1.50“). */
export function querschnittAnzeigen(wert: string | null): string {
  if (wert === null) return "—";
  const [ganz, bruch = ""] = wert.split(".");
  const rest = bruch.replace(/0+$/, "");
  return `${ganz}${rest === "" ? "" : `,${rest}`} mm²`;
}

/** Querschnitt als Eingabetext: „1,5“. */
export function querschnittAlsEingabe(wert: string | null): string {
  return wert === null ? "" : querschnittAnzeigen(wert).replace(" mm²", "");
}
