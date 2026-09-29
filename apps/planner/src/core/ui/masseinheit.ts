import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import {
  STANDARD_MASSEINHEIT,
  istMasseinheit,
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
 * * Standard ist `cm`; gespeichert wird die Wahl **lokal im Browser, je
 *   angemeldetem Benutzer** (`elektroplan.masseinheit.<user_id>`). Zwei
 *   Benutzer desselben Browsers haben also getrennte Einstellungen; ein
 *   Betriebswechsel desselben Benutzers behält seine Wahl. Sie ändert nie
 *   gespeicherte Planmaße.
 * * Solange niemand angemeldet ist (Anmeldung lädt noch, abgemeldet), gilt
 *   der Standard - die Wahl eines anderen Benutzers wird nie gezeigt.
 *   Den Benutzer setzt `AuthProvider` über {@link masseinheitBenutzerSetzen}.
 * * Eine Änderung wirkt sofort in jeder Komponente, die {@link useMasseinheit}
 *   oder {@link useMasse} benutzt - ohne Neuladen und ohne Provider
 *   (`useSyncExternalStore`). Ein zweiter Tab desselben Benutzers zieht über
 *   das `storage`-Ereignis nach.
 * * Ohne nutzbaren Speicher (privates Fenster, gesperrt) gilt die Wahl bis
 *   zum Neuladen - kein Fehler.
 *
 * Die eigentliche Umrechnung steht in `core/masse.ts`.
 */
const PRAEFIX = "elektroplan.masseinheit";

/**
 * Browserweiter Schlüssel aus Bedienungsnacharbeit 1 (4b.1). Er wird beim
 * ersten Anmelden einmalig für diesen Benutzer übernommen und danach entfernt.
 */
export const MASSEINHEIT_SCHLUESSEL_ALT = PRAEFIX;

export function masseinheitSchluessel(benutzerId: string): string {
  return `${PRAEFIX}.${benutzerId}`;
}

let benutzer: string | null = null;
let aktuell: Masseinheit | null = null;
const hoerer = new Set<() => void>();

function gespeichert(): Masseinheit {
  if (benutzer === null) return STANDARD_MASSEINHEIT;
  try {
    const wert = window.localStorage.getItem(masseinheitSchluessel(benutzer));
    return istMasseinheit(wert) ? wert : STANDARD_MASSEINHEIT;
  } catch {
    return STANDARD_MASSEINHEIT;
  }
}

function benachrichtigen() {
  for (const h of [...hoerer]) h();
}

function speicherGeaendert(event: StorageEvent) {
  if (benutzer === null) return;
  if (event.key !== masseinheitSchluessel(benutzer) && event.key !== null) return;
  const neu = gespeichert();
  if (neu === aktuell) return;
  aktuell = neu;
  benachrichtigen();
}

/** Einmalige Übernahme der früheren, browserweiten Wahl für den ersten Benutzer. */
function altenWertUebernehmen(benutzerId: string) {
  try {
    const alt = window.localStorage.getItem(MASSEINHEIT_SCHLUESSEL_ALT);
    if (alt === null) return;
    const schluessel = masseinheitSchluessel(benutzerId);
    if (istMasseinheit(alt) && window.localStorage.getItem(schluessel) === null) {
      window.localStorage.setItem(schluessel, alt);
    }
    window.localStorage.removeItem(MASSEINHEIT_SCHLUESSEL_ALT);
  } catch {
    // Ohne Speicher gibt es nichts zu übernehmen.
  }
}

/**
 * Meldet den angemeldeten Benutzer (`user_id`) - oder `null` beim Laden und
 * nach dem Abmelden. Wechselt der Benutzer, gilt sofort dessen Einstellung.
 */
export function masseinheitBenutzerSetzen(benutzerId: string | null) {
  if (benutzerId === benutzer) return;
  benutzer = benutzerId;
  if (benutzerId !== null) altenWertUebernehmen(benutzerId);
  const neu = gespeichert();
  const vorher = aktuell;
  aktuell = neu;
  if (neu !== vorher) benachrichtigen();
}

export function masseinheit(): Masseinheit {
  if (aktuell === null) aktuell = gespeichert();
  return aktuell;
}

export function masseinheitSetzen(einheit: Masseinheit) {
  if (einheit === masseinheit()) return;
  aktuell = einheit;
  if (benutzer !== null) {
    try {
      window.localStorage.setItem(masseinheitSchluessel(benutzer), einheit);
    } catch {
      // Ohne Speicher gilt die Wahl bis zum Neuladen.
    }
  }
  benachrichtigen();
}

function abonnieren(hoerer_: () => void): () => void {
  hoerer.add(hoerer_);
  // Genau ein globaler Listener, solange jemand zuhört - auch unter
  // StrictMode, das Abonnieren und Abmelden doppelt durchspielt.
  if (hoerer.size === 1) window.addEventListener("storage", speicherGeaendert);
  return () => {
    hoerer.delete(hoerer_);
    if (hoerer.size === 0) window.removeEventListener("storage", speicherGeaendert);
  };
}

/** Nur für Tests: vergisst Benutzer und gelesenen Wert (ohne Benachrichtigung). */
export function masseinheitZuruecksetzen() {
  aktuell = null;
  benutzer = null;
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
