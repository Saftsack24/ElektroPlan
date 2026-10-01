import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import {
  STANDARD_MASSEINHEIT,
  mitEinheit,
  mmAlsEingabe,
  mmAlsEingabeOptional,
  mmAnzeigen,
  mmAnzeigenOptional,
  mmAusEingabe,
  mmAusEingabeOptional,
  punktAnzeigen,
} from "../masse";
import type { Masseinheit } from "../masse";

/**
 * Persönliche Anzeigeeinheit für Längenmaße - fachneutrale Core-Infrastruktur.
 *
 * * Standard ist `cm`; wählbar sind `mm`, `cm` und `m`. Gespeichert wird die
 *   Wahl seit Phase 4e **serverseitig je Benutzer und Betrieb**; den Abgleich
 *   mit Server und Browser-Cache übernimmt `core/einstellungen/persoenlich.ts`
 *   und setzt hier nur den gültigen Wert ({@link masseinheitSetzen}). Diese
 *   Datei liest und schreibt keinen Speicher. Sie ändert nie gespeicherte
 *   Planmaße - die bleiben ganze Millimeter.
 * * Solange niemand angemeldet ist, gilt der Standard.
 * * Eine Änderung wirkt sofort in jeder Komponente, die {@link useMasseinheit}
 *   oder {@link useMasse} benutzt - ohne Neuladen und ohne Provider
 *   (`useSyncExternalStore`).
 * * Der Einstellungsdialog zeigt eine Wahl zunächst nur als Vorschau
 *   ({@link masseinheitVorschauen}); gültig wird sie erst nach dem
 *   erfolgreichen Speichern, Abbrechen beendet die Vorschau.
 *
 * Die eigentliche Umrechnung steht in `core/masse.ts`.
 */

/** Lokaler Schlüssel aus Phase 4b.2 - nur noch Quelle der einmaligen Übernahme. */
export function alterMasseinheitsschluessel(benutzerId: string): string {
  return `elektroplan.masseinheit.${benutzerId}`;
}

/** Noch älterer, browserweiter Schlüssel aus Phase 4b.1 - ebenso nur zur Übernahme. */
export const MASSEINHEIT_SCHLUESSEL_BROWSERWEIT = "elektroplan.masseinheit";

let aktuell: Masseinheit = STANDARD_MASSEINHEIT;
let vorschau: Masseinheit | null = null;
const hoerer = new Set<() => void>();

function benachrichtigen() {
  for (const h of [...hoerer]) h();
}

/** Die wirksame Einheit - während einer Vorschau die Vorschau. */
export function masseinheit(): Masseinheit {
  return vorschau ?? aktuell;
}

/** Die für den Benutzer gültige Einheit, unabhängig von einer Vorschau. */
export function gespeicherteMasseinheit(): Masseinheit {
  return aktuell;
}

/** Zeigt eine Einheit sofort an, ohne sie zu speichern. */
export function masseinheitVorschauen(einheit: Masseinheit) {
  const vorher = masseinheit();
  vorschau = einheit;
  if (einheit !== vorher) benachrichtigen();
}

/** Beendet eine Vorschau; es gilt wieder die gespeicherte Einheit. */
export function masseinheitVorschauBeenden() {
  if (vorschau === null) return;
  const vorher = masseinheit();
  vorschau = null;
  if (masseinheit() !== vorher) benachrichtigen();
}

/**
 * Setzt die gültige Einheit und beendet eine Vorschau - `null` heißt:
 * niemand angemeldet, es gilt der Standard. Gespeichert wird hier nichts.
 */
export function masseinheitSetzen(einheit: Masseinheit | null) {
  const vorher = masseinheit();
  vorschau = null;
  aktuell = einheit ?? STANDARD_MASSEINHEIT;
  if (aktuell !== vorher) benachrichtigen();
}

function abonnieren(hoerer_: () => void): () => void {
  hoerer.add(hoerer_);
  return () => {
    hoerer.delete(hoerer_);
  };
}

/** Nur für Tests: vergisst Einheit und Vorschau (ohne Benachrichtigung). */
export function masseinheitZuruecksetzen() {
  aktuell = STANDARD_MASSEINHEIT;
  vorschau = null;
}

export function useMasseinheit(): Masseinheit {
  return useSyncExternalStore(abonnieren, masseinheit, () => STANDARD_MASSEINHEIT);
}

/** Formatierung und Einlesen in der aktuellen Einheit - für Komponenten. */
export function useMasse() {
  const einheit = useMasseinheit();
  return useMemo(
    () => ({
      einheit,
      anzeigen: (mm: number) => mmAnzeigen(mm, einheit),
      anzeigenOptional: (mm: number | null | undefined) => mmAnzeigenOptional(mm, einheit),
      punkt: (x: number, y: number) => punktAnzeigen(x, y, einheit),
      alsEingabe: (mm: number) => mmAlsEingabe(mm, einheit),
      alsEingabeOptional: (mm: number | null | undefined) => mmAlsEingabeOptional(mm, einheit),
      lesen: (text: string) => mmAusEingabe(text, einheit),
      lesenOptional: (text: string) => mmAusEingabeOptional(text, einheit),
      label: (text: string) => mitEinheit(text, einheit),
    }),
    [einheit],
  );
}

export type Masse = ReturnType<typeof useMasse>;

/**
 * Meldet einen Einheitenwechsel, während die Komponente montiert ist - etwa
 * damit ein offenes Formular seine noch nicht übernommenen Eingabetexte
 * umrechnet, statt „115" plötzlich als Zentimeter zu lesen.
 */
export function useEinheitenwechsel(beiWechsel: (von: Masseinheit, nach: Masseinheit) => void) {
  const einheit = useMasseinheit();
  const vorher = useRef(einheit);
  const rueckruf = useRef(beiWechsel);
  useEffect(() => {
    rueckruf.current = beiWechsel;
  });
  useEffect(() => {
    if (vorher.current === einheit) return;
    const von = vorher.current;
    vorher.current = einheit;
    rueckruf.current(von, einheit);
  }, [einheit]);
}
