import type { CustomerOut } from "@elektroplan/api-client";

/**
 * Kunden, die für eine **neue** Projektzuordnung in Frage kommen.
 *
 * Der Server lehnt anonymisierte Kunden mit `404` ab (docs/api.md, Abschnitt
 * "Zustand des Kunden bei der Projektzuordnung"). Die Auswahl darf sie
 * deshalb gar nicht erst anbieten — sonst führt die Oberfläche in eine
 * Sackgasse, die der Server ohnehin verweigert.
 *
 * Ausgeblendete Kunden stehen ohnehin nicht in der Liste; die Prüfung hier
 * betrifft nur den anonymisierten Fall, weil ein solcher Kunde sichtbar
 * bleibt, damit bestehende Projekte zuordenbar sind.
 */
export function zuordenbareKunden(kunden: readonly CustomerOut[]): CustomerOut[] {
  return kunden.filter((kunde) => kunde.anonymized_at === null);
}
