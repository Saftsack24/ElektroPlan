/**
 * Deutsche Bezeichnungen des Raummodells.
 *
 * Oberflaeche auf Deutsch, API-Werte auf Englisch (ADR 0008). Die Zuordnung
 * steht an genau einer Stelle, damit Liste, Dialoge und Hinweise dieselben
 * Woerter benutzen.
 */
import type { components } from "@elektroplan/api-client";

type Schemas = components["schemas"];

export type Oeffnungsart = Schemas["OpeningCreate"]["kind"];
export type Raumtyp = NonNullable<Schemas["RoomOut"]["room_type"]>;

/**
 * Raumtypen (T7, Phase 5): stabile technische Schlüssel, deutsche Namen. Nur
 * zur Einordnung - kein Typ löst etwas aus (keine Ausstattungsvorlage).
 */
export const RAUMTYPEN: readonly { wert: Raumtyp; label: string }[] = [
  { wert: "living_room", label: "Wohnzimmer" },
  { wert: "bedroom", label: "Schlafzimmer" },
  { wert: "children_room", label: "Kinderzimmer" },
  { wert: "kitchen", label: "Küche" },
  { wert: "bathroom", label: "Bad/WC" },
  { wert: "hallway", label: "Flur" },
  { wert: "office", label: "Büro" },
  { wert: "utility_room", label: "Hauswirtschaft" },
  { wert: "technical_room", label: "Technikraum" },
  { wert: "basement", label: "Keller" },
  { wert: "garage", label: "Garage" },
  { wert: "other", label: "Sonstiges" },
];

export const RAUMTYP_LABEL: Record<Raumtyp, string> = Object.fromEntries(RAUMTYPEN.map((t) => [t.wert, t.label])) as Record<Raumtyp, string>;

export function raumtypAusWert(wert: string): Raumtyp | null {
  return RAUMTYPEN.find((t) => t.wert === wert)?.wert ?? null;
}
export type Konturzustand = Schemas["RoomOut"]["contour_status"];

export const OEFFNUNGSARTEN: readonly { wert: Oeffnungsart; label: string }[] = [
  { wert: "door", label: "Tür" },
  { wert: "window", label: "Fenster" },
  { wert: "passage", label: "Durchgang" },
];

export const OEFFNUNGSART_LABEL: Record<Oeffnungsart, string> = {
  door: "Tür",
  window: "Fenster",
  passage: "Durchgang",
};

/** Einheitliche Bezeichnung in 2D und 3D. */
export const ANSICHT_ZURUECKSETZEN = "Ansicht zurücksetzen";
export const ANSICHT_ZURUECKSETZEN_2D =
  "Setzt Zoom und Ausschnitt auf den gesamten Grundriss zurück";
/** In 3D bleibt die Blickrichtung - die Standardausrichtung liefert „Isometrische Ansicht". */
export const ANSICHT_ZURUECKSETZEN_3D =
  "Setzt Zoom und Ausschnitt auf den gesamten Grundriss zurück; die Blickrichtung bleibt. Zur Standardausrichtung: „Isometrische Ansicht“";

export const KONTURZUSTAND_LABEL: Record<Konturzustand, string> = {
  draft: "Entwurf",
  valid: "Geschlossen",
};

/** Kurze Erklärung des Zustands - der Benutzer soll wissen, was fehlt. */
export const KONTURZUSTAND_ERKLAERUNG: Record<Konturzustand, string> = {
  draft:
    "Die Wände ergeben noch keine geschlossene Raumkontur. Das ist beim Erfassen normal.",
  valid: "Die Wände bilden eine geschlossene, überschneidungsfreie Raumkontur.",
};

/**
 * Flächenangabe des Servers (Dezimalstring) fuer die Anzeige aufbereiten.
 *
 * Das Frontend rechnet nicht: Es formatiert den Wert, den der Server geliefert
 * hat (ADR 0005, ADR 0007). Längen zeigt die Oberfläche in der persönlichen
 * Anzeigeeinheit (`core/masse.ts`), Flächen immer in m².
 */
export function flaecheAnzeigen(area_m2: string | null): string {
  if (area_m2 === null) return "—";
  const zahl = Number.parseFloat(area_m2);
  if (Number.isNaN(zahl)) return "—";
  return `${zahl.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} m²`;
}
