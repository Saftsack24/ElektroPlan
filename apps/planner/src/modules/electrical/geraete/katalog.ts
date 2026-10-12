/**
 * Gerätekatalog (Phase 5, ADR 0023) - geladen vom Server, nie im Browser erfunden.
 *
 * Der Katalog ist ein Systemkatalog des Servers (`GET …/device-types`). Hier
 * stehen nur die Abfrage und die deutschen Bezeichnungen der Flächen und
 * Kategorien - an genau einer Stelle, damit Wand-, Decken-, Grundriss- und
 * 3D-Ansicht dieselben Wörter benutzen.
 */
import type { ApiClient, components } from "@elektroplan/api-client";

import type { Montageflaeche } from "../editor/entwurf";

export type Geraetetyp = components["schemas"]["DeviceTypeOut"];
export type Geraetekategorie = Geraetetyp["category"];
export type Geraetetypen = ReadonlyMap<string, Geraetetyp>;

export function katalogSchluessel() {
  return ["electrical", "device-types"] as const;
}

export function katalogAbfrage(api: ApiClient) {
  return {
    queryKey: katalogSchluessel(),
    queryFn: () => api.get("/api/v1/modules/electrical/device-types"),
    // Der Katalog ändert sich nur mit einem Seed - nicht während einer Sitzung.
    staleTime: 10 * 60 * 1000,
  };
}

export function typenNachSchluessel(liste: readonly Geraetetyp[] | undefined): Geraetetypen {
  return new Map((liste ?? []).map((t) => [t.key, t]));
}

export const FLAECHE_LABEL: Record<Montageflaeche, string> = {
  wall_interior: "Wand innen",
  wall_exterior: "Fassade außen",
  ceiling: "Decke",
};

export const KATEGORIE_LABEL: Record<Geraetekategorie, string> = {
  socket: "Steckdosen",
  switch: "Schalter",
  light: "Leuchten",
  data: "Netzwerk",
  // Phase 6b.0 (ADR 0026): Lage einer Verteilung und Abzweigdose - Geräte wie alle anderen.
  distribution: "Verteilungen",
  junction: "Abzweigdosen",
};

export const KATEGORIEN: readonly Geraetekategorie[] = ["socket", "switch", "light", "data", "distribution", "junction"];

export function erlaubt(typ: Geraetetyp, flaeche: Montageflaeche): boolean {
  return flaeche === "ceiling" ? typ.allows_ceiling : flaeche === "wall_exterior" ? typ.allows_wall_exterior : typ.allows_wall_interior;
}

/** Wählbare Typen für eine Fläche - nur aktive, in Katalogreihenfolge. */
export function typenFuer(typen: Geraetetypen, flaeche: Montageflaeche): Geraetetyp[] {
  return [...typen.values()].filter((t) => t.is_active && erlaubt(t, flaeche)).sort((a, b) => a.sort_order - b.sort_order);
}

/** Bezeichnung eines Geräts: eigene Beschriftung, sonst der Typ. */
export function geraetName(typ: Geraetetyp | undefined, label: string | null, schluessel: string): string {
  const name = typ?.label ?? schluessel;
  return label !== null && label !== "" ? `${name} „${label}“` : name;
}
