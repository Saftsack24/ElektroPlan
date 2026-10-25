/**
 * Gerätekatalog (Phase 5, ADR 0023) - geladen vom Server, nie im Browser erfunden.
 *
 * Der Katalog kommt vom Server (`GET …/device-types`): Systemtypen und seit K2
 * (ADR 0030) die eigenen Typen des Betriebs. Hier
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
    queryFn: ({ signal }: { signal: AbortSignal }) => api.get("/api/v1/modules/electrical/device-types", { signal }),
    // Systemtypen ändern sich nur mit einem Seed; eigene Typen (K2) invalidieren den Schlüssel
    // nach jeder Änderung selbst.
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
  // Phase 6c K2 (ADR 0030): fest angeschlossene Verbraucher (Herd, Durchlauferhitzer …).
  connection: "Geräteanschluss/Festanschluss",
};

export const KATEGORIEN: readonly Geraetekategorie[] = ["socket", "switch", "light", "data", "distribution", "junction", "connection"];

/** Kategorien für eigene Typen (K2) – nie die Verteilung (Spiegel von `CUSTOM_TYPE_CATEGORIES`). */
export const EIGENE_KATEGORIEN: readonly Exclude<Geraetekategorie, "distribution">[] = ["socket", "switch", "light", "data", "junction", "connection"];

/** Eigener Typ des Betriebs (K2) – sonst ein Systemtyp des Katalogs. */
export function istEigenerTyp(typ: Pick<Geraetetyp, "origin">): boolean {
  return typ.origin === "organization";
}

/** Verwendet: Geräte oder Vorlagenzuordnungen verweisen darauf – Kategorie und Planungsmaß gesperrt. */
export function istVerwendet(typ: Pick<Geraetetyp, "device_count" | "template_count">): boolean {
  return typ.device_count > 0 || typ.template_count > 0;
}

export function erlaubt(typ: Geraetetyp, flaeche: Montageflaeche): boolean {
  return flaeche === "ceiling" ? typ.allows_ceiling : flaeche === "wall_exterior" ? typ.allows_wall_exterior : typ.allows_wall_interior;
}

/**
 * Frei wählbare Typen für eine Fläche - nur aktive, in Katalogreihenfolge. Die Verteilung
 * fehlt bewusst: Ihr Lagegerät entsteht nur über „Im Plan platzieren“ (6c, VP), damit nie
 * ein Lagegerät ohne Verteilung entsteht.
 */
export function typenFuer(typen: Geraetetypen, flaeche: Montageflaeche): Geraetetyp[] {
  return [...typen.values()]
    .filter((t) => t.is_active && t.category !== "distribution" && erlaubt(t, flaeche))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Bezeichnung eines Geräts: eigene Beschriftung, sonst der Typ. */
export function geraetName(typ: Geraetetyp | undefined, label: string | null, schluessel: string): string {
  const name = typ?.label ?? schluessel;
  return label !== null && label !== "" ? `${name} „${label}“` : name;
}
