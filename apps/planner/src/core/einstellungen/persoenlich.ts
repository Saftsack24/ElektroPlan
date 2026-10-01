import { ApiError } from "@elektroplan/api-client";
import type { ApiClient, PreferencesIn, PreferencesOut } from "@elektroplan/api-client";
import { useSyncExternalStore } from "react";

import { STANDARD_MASSEINHEIT, istMasseinheit } from "../masse";
import type { Masseinheit } from "../masse";
import {
  STANDARD_DARSTELLUNG,
  alterDarstellungsschluessel,
  darstellungLesen,
  darstellungSetzen,
  istAkzent,
  istModus,
} from "../theme/darstellung";
import type { AkzentId, Darstellungsmodus } from "../theme/darstellung";
import {
  MASSEINHEIT_SCHLUESSEL_BROWSERWEIT,
  alterMasseinheitsschluessel,
  masseinheitSetzen,
} from "../ui/masseinheit";

/**
 * Persönliche Einstellungen: Server, Browser-Cache und einmalige Übernahme
 * (Phase 4e, ADR 0021).
 *
 * **Der Server ist die Wahrheit.** Nach der Anmeldung gilt, was der Server
 * für diesen Benutzer in diesem Betrieb gespeichert hat (`GET
 * /me/preferences`). Der Browser hält nur einen **Cache je Mitgliedschaft**
 * (`elektroplan.einstellungen.<member_id>`), damit die eigene Darstellung
 * schon vor der Serverantwort erscheint. Ein Cache eines anderen Benutzers wird
 * nie gelesen - der Schlüssel enthält die Mitgliedschaft.
 *
 * **Einmalige Übernahme.** Hat der Server noch nichts gespeichert, sieht diese
 * Datei einmal nach den alten lokalen Einträgen aus Phase 4c.2
 * (`elektroplan.darstellung.<user_id>`, `elektroplan.masseinheit.<user_id>`,
 * davor browserweit `elektroplan.masseinheit`). Gültige Werte gehen per
 * `POST` an den Server; danach werden die alten Einträge entfernt und nie
 * wieder gelesen. Legt ein zweites Gerät gleichzeitig an, gewinnt der Server
 * (`409 preferences-exist` → Serverstand laden). Ohne gültige alten Werte gilt
 * der Standard (Wie das System, ElektroPlan Blau, cm), und angelegt wird erst
 * beim ersten Speichern.
 *
 * **Ändern** nur mit der Version des Serverstands (`PUT` mit `If-Match`).
 * Hat ein anderes Gerät inzwischen gespeichert, antwortet der Server `409`;
 * dann wird dessen Stand geladen und angewendet, und der Aufrufer erhält
 * {@link EinstellungsKonflikt}.
 *
 * Angewendet wird ausschließlich über `core/theme/darstellung.ts` (Theme,
 * `data-theme`, `matchMedia`) und `core/ui/masseinheit.ts`.
 */

export interface PersoenlicheEinstellungen {
  readonly modus: Darstellungsmodus;
  readonly akzent: AkzentId;
  readonly einheit: Masseinheit;
}

export const STANDARD_EINSTELLUNGEN: PersoenlicheEinstellungen = Object.freeze({
  modus: STANDARD_DARSTELLUNG.modus,
  akzent: STANDARD_DARSTELLUNG.akzent,
  einheit: STANDARD_MASSEINHEIT,
});

export function gleicheEinstellungen(a: PersoenlicheEinstellungen, b: PersoenlicheEinstellungen): boolean {
  return a.modus === b.modus && a.akzent === b.akzent && a.einheit === b.einheit;
}

const CACHE_PRAEFIX = "elektroplan.einstellungen";
const CACHE_VERSION = 2;

export function cacheSchluessel(mitgliedId: string): string {
  return `${CACHE_PRAEFIX}.${mitgliedId}`;
}

/** Ein anderes Gerät hat zwischenzeitlich gespeichert; sein Stand gilt jetzt. */
export class EinstellungsKonflikt extends Error {
  constructor() {
    super("Die Einstellungen wurden inzwischen auf einem anderen Gerät geändert.");
    this.name = "EinstellungsKonflikt";
  }
}

// ------------------------------------------------------------ Zustand

export interface Einstellungsabgleich {
  /** Version des Serverstands; `null`, solange der Server nichts gespeichert hat. */
  readonly serverVersion: number | null;
  /** Der Serverstand ist seit der Anmeldung mindestens einmal gelesen worden. */
  readonly geladen: boolean;
  /** Der letzte Abgleich mit dem Server ist gescheitert (Netz, Server). */
  readonly fehler: boolean;
}

const ABGLEICH_LEER: Einstellungsabgleich = Object.freeze({ serverVersion: null, geladen: false, fehler: false });

interface Identitaet {
  readonly benutzerId: string;
  readonly mitgliedId: string;
}

let identitaet: Identitaet | null = null;
let abgleich: Einstellungsabgleich = ABGLEICH_LEER;
let gueltig: PersoenlicheEinstellungen = STANDARD_EINSTELLUNGEN;
/** Zählt jede An- und Abmeldung; spät eintreffende Antworten werden verworfen. */
let generation = 0;
const hoerer = new Set<() => void>();

function abgleichSetzen(neu: Partial<Einstellungsabgleich>) {
  abgleich = { ...abgleich, ...neu };
  for (const h of [...hoerer]) h();
}

function anwenden(werte: PersoenlicheEinstellungen) {
  gueltig = werte;
  darstellungSetzen({ modus: werte.modus, akzent: werte.akzent });
  masseinheitSetzen(werte.einheit);
}

/** Die gültigen Werte - ohne eine laufende Vorschau. */
export function gueltigeEinstellungen(): PersoenlicheEinstellungen {
  return gueltig;
}

// ------------------------------------------------------------ Cache

function cacheLesen(mitgliedId: string): { werte: PersoenlicheEinstellungen; version: number } | null {
  let roh: string | null;
  try {
    roh = window.localStorage.getItem(cacheSchluessel(mitgliedId));
  } catch {
    return null;
  }
  if (roh === null) return null;
  try {
    const wert = JSON.parse(roh) as Record<string, unknown> | null;
    if (typeof wert !== "object" || wert === null || wert["version"] !== CACHE_VERSION) return null;
    const { modus, akzent, einheit, server_version: serverVersion } = wert;
    // Beschädigt oder unbekannt: nicht teilweise übernehmen - der Server liefert gleich.
    if (!istModus(modus) || !istAkzent(akzent) || !istMasseinheit(einheit)) return null;
    if (typeof serverVersion !== "number" || !Number.isInteger(serverVersion) || serverVersion < 1) return null;
    return { werte: { modus, akzent, einheit }, version: serverVersion };
  } catch {
    return null;
  }
}

function cacheSchreiben(mitgliedId: string, werte: PersoenlicheEinstellungen, version: number) {
  try {
    window.localStorage.setItem(
      cacheSchluessel(mitgliedId),
      JSON.stringify({ version: CACHE_VERSION, ...werte, server_version: version }),
    );
  } catch {
    // Ohne Speicher: Es gilt weiter der Serverstand im Speicher dieses Tabs.
  }
}

function speicherGeaendert(event: StorageEvent) {
  if (identitaet === null) return;
  if (event.key !== cacheSchluessel(identitaet.mitgliedId)) return;
  // Ein anderer Tab desselben Benutzers hat einen neuen Serverstand erhalten.
  const neu = cacheLesen(identitaet.mitgliedId);
  if (neu === null) return;
  abgleichSetzen({ serverVersion: neu.version });
  if (!gleicheEinstellungen(neu.werte, gueltig)) anwenden(neu.werte);
}

// ------------------------------------------------------------ Altbestand

interface Altbestand {
  readonly werte: PersoenlicheEinstellungen;
  readonly schluessel: readonly string[];
}

/** Liest die alten lokalen Einträge des Benutzers - `null`, wenn keiner gültig ist. */
export function altbestandLesen(benutzerId: string): Altbestand | null {
  const schluessel = [
    alterDarstellungsschluessel(benutzerId),
    alterMasseinheitsschluessel(benutzerId),
    MASSEINHEIT_SCHLUESSEL_BROWSERWEIT,
  ];
  let darstellungRoh: string | null;
  let einheitRoh: string | null;
  let einheitBrowserweit: string | null;
  try {
    darstellungRoh = window.localStorage.getItem(schluessel[0] ?? "");
    einheitRoh = window.localStorage.getItem(schluessel[1] ?? "");
    einheitBrowserweit = window.localStorage.getItem(MASSEINHEIT_SCHLUESSEL_BROWSERWEIT);
  } catch {
    return null;
  }
  const darstellung = darstellungRoh === null ? null : darstellungLesen(darstellungRoh);
  // darstellungLesen ersetzt Unlesbares durch den Standard - das zählt nicht als Wahl.
  const darstellungGueltig =
    darstellungRoh !== null && darstellung !== null && istGueltigesAltformat(darstellungRoh);
  const einheit = istMasseinheit(einheitRoh) ? einheitRoh : istMasseinheit(einheitBrowserweit) ? einheitBrowserweit : null;
  if (!darstellungGueltig && einheit === null) return null;
  return {
    werte: {
      modus: darstellungGueltig && darstellung !== null ? darstellung.modus : STANDARD_EINSTELLUNGEN.modus,
      akzent: darstellungGueltig && darstellung !== null ? darstellung.akzent : STANDARD_EINSTELLUNGEN.akzent,
      einheit: einheit ?? STANDARD_EINSTELLUNGEN.einheit,
    },
    schluessel,
  };
}

function istGueltigesAltformat(roh: string): boolean {
  try {
    const wert = JSON.parse(roh) as Record<string, unknown> | null;
    return typeof wert === "object" && wert !== null && wert["version"] === 1;
  } catch {
    return false;
  }
}

function altbestandEntfernen(benutzerId: string) {
  try {
    window.localStorage.removeItem(alterDarstellungsschluessel(benutzerId));
    window.localStorage.removeItem(alterMasseinheitsschluessel(benutzerId));
    window.localStorage.removeItem(MASSEINHEIT_SCHLUESSEL_BROWSERWEIT);
  } catch {
    // nichts zu entfernen
  }
}

// ------------------------------------------------------------ Server

function ausServer(antwort: PreferencesOut): PersoenlicheEinstellungen {
  // Der Server liefert nur bekannte Werte; eine ältere Oberfläche fällt
  // trotzdem kontrolliert auf den Standard zurück.
  return {
    modus: istModus(antwort.theme_mode) ? antwort.theme_mode : STANDARD_EINSTELLUNGEN.modus,
    akzent: istAkzent(antwort.accent) ? antwort.accent : STANDARD_EINSTELLUNGEN.akzent,
    einheit: istMasseinheit(antwort.length_unit) ? antwort.length_unit : STANDARD_EINSTELLUNGEN.einheit,
  };
}

function fuerServer(werte: PersoenlicheEinstellungen): PreferencesIn {
  return { theme_mode: werte.modus, accent: werte.akzent, length_unit: werte.einheit };
}

function serverstandUebernehmen(wer: Identitaet, antwort: PreferencesOut) {
  const werte = ausServer(antwort);
  cacheSchreiben(wer.mitgliedId, werte, antwort.version);
  // Ab jetzt gibt es einen Serverstand - der Altbestand darf nie mehr gewinnen.
  altbestandEntfernen(wer.benutzerId);
  abgleichSetzen({ serverVersion: antwort.version, geladen: true, fehler: false });
  anwenden(werte);
}

/**
 * Meldet den angemeldeten Benutzer (oder `null` beim Laden und nach dem
 * Abmelden). Wendet **sofort** den Cache dieser Mitgliedschaft an - oder den
 * Standard. Den Server fragt danach {@link einstellungenLaden}.
 */
export function einstellungenAnmelden(neu: Identitaet | null) {
  if (neu?.mitgliedId === identitaet?.mitgliedId && neu?.benutzerId === identitaet?.benutzerId) return;
  generation += 1;
  identitaet = neu === null ? null : { benutzerId: neu.benutzerId, mitgliedId: neu.mitgliedId };
  // Andere Tabs desselben Benutzers: Ein neuer Serverstand landet dort im Cache.
  if (typeof window !== "undefined") {
    window.removeEventListener("storage", speicherGeaendert);
    if (identitaet !== null) window.addEventListener("storage", speicherGeaendert);
  }
  if (identitaet === null) {
    abgleichSetzen(ABGLEICH_LEER);
    anwenden(STANDARD_EINSTELLUNGEN);
    return;
  }
  const cache = cacheLesen(identitaet.mitgliedId);
  abgleichSetzen({ serverVersion: cache?.version ?? null, geladen: false, fehler: false });
  anwenden(cache?.werte ?? STANDARD_EINSTELLUNGEN);
}

/**
 * Liest den Serverstand und wendet ihn an; ohne Serverstand einmalig die
 * Übernahme des Altbestands. Fehler (Netz, Server) lassen den Cache stehen und
 * werden nur im Zustand vermerkt.
 */
export async function einstellungenLaden(api: ApiClient): Promise<void> {
  const wer = identitaet;
  const meine = generation;
  if (wer === null) return;
  try {
    const antwort = await api.get("/api/v1/me/preferences");
    if (meine !== generation) return;
    if (antwort.stored) {
      serverstandUebernehmen(wer, antwort);
      return;
    }
    const alt = altbestandLesen(wer.benutzerId);
    if (alt === null) {
      // Kein Serverstand, kein Altbestand: Standard; angelegt wird beim ersten Speichern.
      abgleichSetzen({ serverVersion: null, geladen: true, fehler: false });
      anwenden(STANDARD_EINSTELLUNGEN);
      return;
    }
    try {
      const angelegt = await api.post("/api/v1/me/preferences", { body: fuerServer(alt.werte) });
      if (meine !== generation) return;
      serverstandUebernehmen(wer, angelegt);
    } catch (error) {
      if (meine !== generation) return;
      if (error instanceof ApiError && error.errorType === "preferences-exist") {
        // Ein anderes Gerät war schneller: dessen Stand gilt.
        const aktuell = await api.get("/api/v1/me/preferences");
        if (meine !== generation) return;
        serverstandUebernehmen(wer, aktuell);
        return;
      }
      // Übernahme gescheitert: Altbestand bleibt für den nächsten Versuch, bis
      // dahin gilt er im Speicher.
      abgleichSetzen({ serverVersion: null, geladen: true, fehler: true });
      anwenden(alt.werte);
    }
  } catch {
    if (meine !== generation) return;
    abgleichSetzen({ fehler: true });
  }
}

/**
 * Speichert die Werte serverseitig und wendet sie danach an.
 *
 * Wirft {@link EinstellungsKonflikt}, wenn ein anderes Gerät inzwischen
 * gespeichert hat - dessen Stand ist dann bereits angewendet. Jeder andere
 * Fehler wird unverändert weitergereicht; dann gilt der bisherige Stand.
 */
export async function einstellungenSpeichern(api: ApiClient, werte: PersoenlicheEinstellungen): Promise<void> {
  const wer = identitaet;
  const meine = generation;
  if (wer === null) throw new Error("Niemand angemeldet.");
  const version = abgleich.serverVersion;
  try {
    const antwort =
      version === null
        ? await api.post("/api/v1/me/preferences", { body: fuerServer(werte) })
        : await api.put("/api/v1/me/preferences", { ifMatch: version, body: fuerServer(werte) });
    if (meine !== generation) return;
    serverstandUebernehmen(wer, antwort);
  } catch (error) {
    if (
      meine === generation &&
      error instanceof ApiError &&
      (error.errorType === "version-conflict" ||
        error.errorType === "preferences-exist" ||
        error.errorType === "not-found")
    ) {
      const aktuell = await api.get("/api/v1/me/preferences");
      if (meine !== generation) return;
      if (aktuell.stored) serverstandUebernehmen(wer, aktuell);
      else abgleichSetzen({ serverVersion: null });
      throw new EinstellungsKonflikt();
    }
    throw error;
  }
}

/** Liest den Serverstand erneut - etwa beim Öffnen des Einstellungsdialogs. */
export function einstellungenAktualisieren(api: ApiClient): Promise<void> {
  return einstellungenLaden(api);
}

function abonnieren(hoerer_: () => void): () => void {
  hoerer.add(hoerer_);
  return () => {
    hoerer.delete(hoerer_);
  };
}

export function einstellungsabgleich(): Einstellungsabgleich {
  return abgleich;
}

export function useEinstellungsabgleich(): Einstellungsabgleich {
  return useSyncExternalStore(abonnieren, einstellungsabgleich, () => ABGLEICH_LEER);
}

/** Nur für Tests: vergisst Benutzer, Abgleich und Werte. */
export function einstellungenZuruecksetzen() {
  if (typeof window !== "undefined") window.removeEventListener("storage", speicherGeaendert);
  identitaet = null;
  abgleich = ABGLEICH_LEER;
  gueltig = STANDARD_EINSTELLUNGEN;
  generation += 1;
}
