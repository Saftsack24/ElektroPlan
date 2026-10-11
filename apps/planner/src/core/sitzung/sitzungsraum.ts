import { QueryClient } from "@tanstack/react-query";

/**
 * Sitzungsraum: alles, was im Browser zu **einem** Sitzungskontext gehört
 * (Sicherheitsauftrag 2026-10-10, Befund 1).
 *
 * Ein Sitzungskontext ist Benutzer + Betrieb + Mitgliedschaft - gelesen aus
 * dem Access Token, den der Server ausgestellt hat. Jeder Kontext erhält einen
 * **eigenen** Raum mit
 *
 * - eigenem `QueryClient`: Abfrage- und Mutationsdaten zweier Kontexte liegen
 *   nie im selben Cache, gleich welche Abfrageschlüssel ein Modul wählt;
 * - eigenem Abbruchsignal: Jeder API-Client des Raums hängt daran.
 *
 * Wechselt der Kontext (Abmelden, anderer Benutzer, anderer Betrieb, Verlust
 * der Sitzung), wird der alte Raum **beendet**: laufende Anfragen werden
 * abgebrochen, eine dennoch eintreffende Antwort verworfen, Abfragen und
 * Mutationen gelöscht. Der `AuthProvider` baut die Oberfläche danach mit dem
 * neuen Raum neu auf - Komponenten mit Daten des alten Kontexts gibt es dann
 * nicht mehr.
 *
 * Browserspeicher wird **nicht** angefasst: Persönliche Einstellungen liegen
 * je Mitgliedschaft im eigenen Cache (`core/einstellungen/persoenlich.ts`).
 */

export interface Sitzungskontext {
  readonly benutzerId: string;
  readonly betriebId: string;
  readonly mitgliedId: string;
}

export interface Sitzungsraum {
  /** Fortlaufend; jeder Raum ist ein eigener, auch bei gleichem Kontext. */
  readonly id: number;
  /** `anonym`, `<benutzer>:<betrieb>:<mitglied>` oder ein Ersatzschlüssel. */
  readonly schluessel: string;
  readonly kontext: Sitzungskontext | null;
  readonly queryClient: QueryClient;
  /** Wird ausgelöst, sobald der Raum endet. */
  readonly signal: AbortSignal;
  readonly aktiv: boolean;
  /** Bricht alles ab und löscht alle Daten des Raums. Mehrfach aufrufbar. */
  beenden(): void;
}

export const ANONYMER_SCHLUESSEL = "anonym";

function base64UrlDekodieren(teil: string): string {
  const base64 = teil.replace(/-/g, "+").replace(/_/g, "/");
  const aufgefuellt = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binaer = atob(aufgefuellt);
  const bytes = Uint8Array.from(binaer, (zeichen) => zeichen.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Liest Benutzer, Betrieb und Mitgliedschaft aus einem Access Token.
 *
 * **Keine** Signaturprüfung - die macht der Server bei jeder Anfrage. Hier
 * geht es nur darum, Daten verschiedener Sitzungen im Browser zu trennen.
 */
export function kontextAusToken(token: string): Sitzungskontext | null {
  const teile = token.split(".");
  if (teile.length !== 3 || !teile[1]) return null;
  try {
    const nutzlast = JSON.parse(base64UrlDekodieren(teile[1])) as Record<string, unknown>;
    const { sub, org, mid } = nutzlast;
    if (typeof sub !== "string" || typeof org !== "string" || typeof mid !== "string") return null;
    if (!sub || !org || !mid) return null;
    return { benutzerId: sub, betriebId: org, mitgliedId: mid };
  } catch {
    return null;
  }
}

/** Kurzer, nicht umkehrbarer Fingerabdruck - der Token selbst bleibt aus dem Schlüssel. */
function fingerabdruck(wert: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < wert.length; i += 1) {
    const c = wert.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2246822519);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/**
 * Schlüssel des Sitzungskontexts. Ein Token ohne lesbaren Kontext erhält
 * einen eigenen Schlüssel je Token - lieber einmal zu oft getrennt als zwei
 * Sitzungen vermischt.
 */
export function kontextSchluessel(token: string | null): {
  schluessel: string;
  kontext: Sitzungskontext | null;
} {
  if (token === null) return { schluessel: ANONYMER_SCHLUESSEL, kontext: null };
  const kontext = kontextAusToken(token);
  if (kontext === null) return { schluessel: `unbekannt:${fingerabdruck(token)}`, kontext: null };
  return {
    schluessel: `${kontext.benutzerId}:${kontext.betriebId}:${kontext.mitgliedId}`,
    kontext,
  };
}

/** Gleiche Grundeinstellungen wie bisher in `App.tsx`. */
export function abfrageClientErzeugen(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
    },
  });
}

let naechsteId = 1;

export function sitzungsraumErzeugen(schluessel: string, kontext: Sitzungskontext | null): Sitzungsraum {
  const controller = new AbortController();
  const queryClient = abfrageClientErzeugen();
  let aktiv = true;
  const id = naechsteId;
  naechsteId += 1;
  return {
    id,
    schluessel,
    kontext,
    queryClient,
    signal: controller.signal,
    get aktiv() {
      return aktiv;
    },
    beenden() {
      if (!aktiv) return;
      aktiv = false;
      // Zuerst abbrechen: Jede laufende Anfrage des Raums endet mit
      // AbortError, eine spät eintreffende Antwort wird im API-Client verworfen.
      controller.abort();
      void queryClient.cancelQueries();
      // Dann alle Daten löschen - Abfragen und Mutationen samt optimistischer
      // Zwischenstände. Ein Modul, das danach noch in diesen Client schreibt,
      // schreibt in einen Cache, den niemand mehr anzeigt.
      queryClient.getMutationCache().clear();
      queryClient.clear();
    },
  };
}
