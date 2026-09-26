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
 * hat (ADR 0005, ADR 0007). Längen zeigt die Oberfläche in Millimetern - so, wie
 * sie erfasst werden.
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
