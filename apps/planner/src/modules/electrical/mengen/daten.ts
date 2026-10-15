import type { ApiClient, components } from "@elektroplan/api-client";

import { querschnittAnzeigen } from "../stromkreise/daten";

/**
 * Mengenübersicht eines Gebäudes (Phase 6b.6, Entwurf §6.5/§21) - Abfrage und Texte.
 *
 * Die Mengen rechnet ausschließlich der Server aus dem **gespeicherten** Stand
 * (`GET /buildings/{id}/cabling-summary`); hier wird nichts summiert oder
 * nachgerechnet, nur benannt.
 */
export type Mengenuebersicht = components["schemas"]["CablingSummaryOut"];
export type Mengengruppe = components["schemas"]["CablingGroupOut"];
export type Mengenleitung = components["schemas"]["CablingCableOut"];
export type Mengeneimer = components["schemas"]["CablingBucketOut"];
export type Flaechenmenge = components["schemas"]["CablingSurfaceOut"];

export function mengenSchluessel(buildingId: string) {
  return ["electrical", "cabling-summary", buildingId] as const;
}

export function mengenAbfrage(api: ApiClient, buildingId: string) {
  return {
    queryKey: mengenSchluessel(buildingId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get("/api/v1/modules/electrical/buildings/{building_id}/cabling-summary", { path: { building_id: buildingId }, signal }),
    // Immer frisch beim Öffnen: Mengen folgen jeder Änderung an Leitungen, Räumen und Zuordnungen.
    staleTime: 0,
  };
}

/** „NYM-J 3 × 1,5 mm²“ - die tatsächlichen Angaben einer Gruppe. */
export function gruppenName(g: Pick<Mengengruppe, "cable_type" | "conductor_count" | "cross_section_mm2">): string {
  return `${g.cable_type} ${g.conductor_count} × ${querschnittAnzeigen(g.cross_section_mm2)}`;
}

const ANGABE: Record<Mengenleitung["missing_spec"][number], string> = {
  cable_type: "Leitungstyp",
  conductor_count: "Leiterzahl",
  cross_section_mm2: "Querschnitt",
};

/** „Querschnitt fehlt“, „Leitungstyp und Leiterzahl fehlen“ - konkret, nie ein Standardwert. */
export function fehlendText(fehlend: readonly Mengenleitung["missing_spec"][number][]): string {
  const namen = fehlend.map((f) => ANGABE[f]);
  if (namen.length === 0) return "";
  if (namen.length === 1) return `${namen[0] ?? ""} fehlt`;
  return `${namen.slice(0, -1).join(", ")} und ${namen.at(-1) ?? ""} fehlen`;
}

/** Vorhandene Angaben einer Leitung, Fehlendes als „–“: „NYM-J · 3 Leiter · – mm²“. */
export function angabenText(l: Pick<Mengenleitung, "cable_type" | "conductor_count" | "cross_section_mm2">): string {
  return `${l.cable_type ?? "– (Typ)"} · ${l.conductor_count === null ? "– Leiter" : `${l.conductor_count} Leiter`} · ${
    l.cross_section_mm2 === null ? "– mm²" : querschnittAnzeigen(l.cross_section_mm2)
  }`;
}

export const FLAECHE_TEXT: Record<Flaechenmenge["surface"], string> = {
  wall: "Wand",
  ceiling: "Decke",
  floor: "Fußboden",
  riser: "Steigweg",
  shaft: "Schachtfortsetzung",
};

export const STATUS_TEXT: Record<Mengenleitung["status"], string> = {
  confirmed: "bestätigt",
  incomplete: "unvollständig",
  conflict: "Konflikt",
};
