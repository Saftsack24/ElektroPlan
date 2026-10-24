import type { ApiClient, components } from "@elektroplan/api-client";

import { querschnittAnzeigen } from "../stromkreise/daten";

/**
 * Kabelvorlagen, Betriebsstandard und Projektvorgabe (Phase 6c, ADR 0027, Entwurf §8, §20).
 *
 * Nur Lesen, Umrechnen und Texte - geschrieben wird in den Dialogen über die V1-API
 * mit Versionsprüfung. Vorgaben sind Vorschlagsquellen: Eine Änderung schreibt
 * **keine** bestehende Leitung um.
 */
type Schemas = components["schemas"];
export type Kabelvorlage = Schemas["CableTemplateOut"];
export type Betriebsstandard = Schemas["PlanningDefaultsOut"];
export type Projektvorgabe = Schemas["ProjectPlanningDefaultsOut"];
export type WirksameVorgaben = Schemas["EffectivePlanningDefaultsOut"];
export type Vorgabenbasis = Schemas["DefaultsBasisOut"];
export type Herkunft = Schemas["EffectiveSpecOut"]["origin"];
export type Endpunktart = Schemas["EffectiveAllowanceOut"]["endpoint_kind"];

export const VORGABEN_RECHT = "electrical.defaults.manage";

export const vorlagenSchluessel = () => ["electrical", "cable-templates"] as const;
export const betriebsstandardSchluessel = () => ["electrical", "planning-defaults"] as const;
export const projektvorgabeSchluessel = (projektId: string) => ["electrical", "project-defaults", projektId] as const;
/** Präfix aller wirksamen Vorgaben eines Projekts - nach jeder Vorgabenänderung ungültig. */
export const wirksamSchluessel = (projektId: string) => ["electrical", "effective-defaults", projektId] as const;

export function vorlagenAbfrage(api: ApiClient) {
  return {
    queryKey: vorlagenSchluessel(),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.get("/api/v1/modules/electrical/cable-templates", { signal }),
  };
}

export function betriebsstandardAbfrage(api: ApiClient) {
  return {
    queryKey: betriebsstandardSchluessel(),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.get("/api/v1/modules/electrical/planning-defaults", { signal }),
  };
}

export function projektvorgabeAbfrage(api: ApiClient, projektId: string) {
  return {
    queryKey: projektvorgabeSchluessel(projektId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get("/api/v1/modules/electrical/projects/{project_id}/planning-defaults", { path: { project_id: projektId }, signal }),
  };
}

export interface Leitungsbezug {
  readonly circuitId: string;
  readonly startId: string | null;
  readonly endId: string | null;
}

/**
 * Wirksame Vorgaben - je Leitung mit Stromkreis, Start und Ziel. Immer frisch (`staleTime 0`):
 * Der Dialog merkt sich die Basis, mit der er gelesen hat (Entwurf §8.6).
 */
export function wirksamAbfrage(api: ApiClient, projektId: string, bezug: Leitungsbezug | null) {
  return {
    queryKey: [...wirksamSchluessel(projektId), bezug?.circuitId ?? null, bezug?.startId ?? null, bezug?.endId ?? null] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get("/api/v1/modules/electrical/projects/{project_id}/planning-defaults/effective", {
        path: { project_id: projektId },
        query:
          bezug === null
            ? {}
            : {
                circuit_id: bezug.circuitId,
                ...(bezug.startId !== null ? { start_device_id: bezug.startId } : {}),
                ...(bezug.endId !== null ? { end_device_id: bezug.endId } : {}),
              },
        signal,
      }),
    staleTime: 0,
  };
}

// ------------------------------------------------------------------ Prozent

const PROZENT_EINGABE = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

/** „12,5“ → „12.5“; leer = `null`. Höchstens zwei Nachkommastellen, 0 bis 100 (wie der Server). */
export function prozentLesen(text: string): { ok: true; wert: string | null } | { ok: false; fehler: string } {
  const roh = text.trim().replace(/\s*%$/, "");
  if (roh === "") return { ok: true, wert: null };
  const t = PROZENT_EINGABE.exec(roh);
  if (t === null) return { ok: false, fehler: "Bitte einen Prozentsatz mit höchstens zwei Nachkommastellen angeben, z. B. 20 oder 12,5." };
  const wert = t[2] === undefined ? t[1] ?? "" : `${t[1] ?? ""}.${t[2]}`;
  if (Number(wert) > 100) return { ok: false, fehler: "Der Prozentsatz liegt zwischen 0 und 100." };
  return { ok: true, wert: String(Number(wert)) === wert ? wert : wert.replace(/^0+(?=\d)/, "") };
}

/** „20.00“ → „20“, „12.50“ → „12,5“ - Anzeige ohne überflüssige Nullen. */
export function prozentAnzeigen(wert: string | null): string {
  if (wert === null) return "–";
  const [ganz, nach = ""] = wert.split(".");
  const rest = nach.replace(/0+$/, "");
  return `${ganz ?? "0"}${rest === "" ? "" : `,${rest}`} %`;
}

/** Eingabetext eines gespeicherten Prozentsatzes. */
export function prozentAlsEingabe(wert: string | null): string {
  return wert === null ? "" : prozentAnzeigen(wert).replace(" %", "");
}

// ------------------------------------------------------------------ Texte

export const ENDPUNKTART_TEXT: Record<Endpunktart, string> = {
  board: "an einer Verteilung",
  junction: "an einer Abzweigdose",
  device: "an einem Gerät",
};

/** Herkunft verständlich (Entwurf §8.5) - ohne IDs. */
export function herkunftText(herkunft: Herkunft, ebene?: "project" | "office" | null): string {
  const quelle = ebene === "project" ? "Projektvorgabe" : ebene === "office" ? "Betriebsstandard" : null;
  switch (herkunft) {
    case "circuit_override":
      return "aus Stromkreis (aktivierte Vorgabe)";
    case "device_type_template":
      return quelle === null ? "Vorlage des Gerätetyps" : `Vorlage des Gerätetyps (${quelle})`;
    case "default_template":
      return quelle === null ? "Standardvorlage" : `Standardvorlage (${quelle})`;
    case "project_default":
      return "Projektvorgabe";
    case "office_default":
      return "Betriebsstandard";
    case "manual":
      return "abweichend";
    case "legacy":
      return "vor 6c erfasst";
    case "none":
      return "keine Vorgabe";
  }
}

export function vorlageText(v: Pick<Kabelvorlage, "name" | "cable_type" | "conductor_count" | "cross_section_mm2">): string {
  return `${v.name} – ${v.cable_type} ${v.conductor_count} × ${querschnittAnzeigen(v.cross_section_mm2)}`;
}

/** Hinweise der Vorgabenkette (Codes aus `defaults_chain.py`). */
export const HINWEIS_TEXT: Record<string, string> = {
  "circuit-proposal-not-activated": "Am Stromkreis stehen andere Kabelangaben – nicht als Vorgabe aktiviert.",
  "circuit-override-incomplete": "Die aktivierte Stromkreisvorgabe ist unvollständig – fehlende Angaben bleiben fehlend.",
  "template-inactive": "Eine zugeordnete Kabelvorlage ist deaktiviert und wird nicht vorgeschlagen.",
  "start-template-differs": "Das Startgerät hätte eine andere Kabelvorlage – maßgeblich ist das Zielgerät.",
};
