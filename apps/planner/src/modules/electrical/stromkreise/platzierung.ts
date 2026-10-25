import { ApiError } from "@elektroplan/api-client";
import type { ApiClient, components } from "@elektroplan/api-client";

import { befundText } from "../geraete/geraetepruefung";

type Schemas = components["schemas"];
export type Platzierungsantwort = Schemas["BoardPlacementOut"];

/**
 * Verteilung direkt im Plan platzieren (Phase 6c, Schritt VP, ADR 0028).
 *
 * Die Platzierung ist ein **eigener kleiner Entwurf**: Er lebt nur in der
 * Oberfläche, bis „Platzierung speichern“ Lagegerät und Verknüpfung in einer
 * Anfrage schreibt (`PUT …/distribution-boards/{id}/placement`). Abbrechen
 * verwirft ihn; serverseitig ist dann nichts entstanden. Ein offener
 * Raumentwurf wird nie mitgespeichert.
 */
export interface Verteilungsplatzierung {
  readonly boardId: string;
  readonly code: string;
  readonly name: string;
  /** Version der Verteilung beim Start (`If-Match`). */
  readonly version: number;
  /** Bisheriges Lagegerät („Position ändern“) oder `null` („Im Plan platzieren“). */
  readonly geraetId: string | null;
  readonly floorId: string;
  /** Raum, dessen Wand gewählt werden soll; `null`: jede Wand des Geschosses (Einstieg aus dem Gerätekatalog, K1). */
  readonly raumId: string | null;
}

/** Gewählte Lage auf einer Wand (Innenseite) - Mitte ab Wandanfang und Höhe über Fußboden. */
export interface Platzierungslage {
  readonly raumId: string;
  readonly raumVersion: number;
  readonly wandId: string;
  readonly mitteMm: number;
  readonly hoeheMm: number;
}

/** Standardhöhe der Gerätemitte, falls der Katalog keine nennt (Entwurf 6c §6.2: 1,40 m). */
export const VERTEILUNG_STANDARDHOEHE_MM = 1_400;

export function platzierungSpeichern(api: ApiClient, p: Verteilungsplatzierung, lage: Platzierungslage): Promise<Platzierungsantwort> {
  return api.put("/api/v1/modules/electrical/distribution-boards/{board_id}/placement", {
    path: { board_id: p.boardId },
    ifMatch: p.version,
    body: {
      room_id: lage.raumId,
      wall_id: lage.wandId,
      center_offset_mm: lage.mitteMm,
      center_height_mm: lage.hoeheMm,
      expected_room_version: lage.raumVersion,
    },
  });
}

export interface Platzierungsfehler {
  readonly text: string;
  /** Verteilung oder Raum wurde inzwischen geändert - neu laden; die Lage bleibt als Vorschlag. */
  readonly konflikt: boolean;
}

/** Verständliche Meldung zu einem Fehler beim Speichern der Platzierung. */
export function platzierungsfehler(error: unknown): Platzierungsfehler {
  if (!(error instanceof ApiError)) {
    return { text: "Die Platzierung konnte nicht gespeichert werden. Bitte erneut versuchen.", konflikt: false };
  }
  const codes = (error.problem?.errors ?? []).map((e) => e.code);
  if (codes.includes("board-placement-has-cables")) {
    // Der Server nennt die betroffenen Leitungen (Stromkreis, Bezeichnung, Endgeräte).
    return { text: error.userMessage, konflikt: false };
  }
  if (error.errorType === "version-conflict") {
    return {
      text: "Die Verteilung oder der Raum wurde inzwischen geändert. Bitte neu laden – die gewählte Lage bleibt als Vorschlag erhalten.",
      konflikt: true,
    };
  }
  if (error.errorType === "project-archived" || error.errorType === "project-completed") {
    return { text: "Das Projekt ist schreibgeschützt (abgeschlossen oder archiviert). Es wurde nichts gespeichert.", konflikt: false };
  }
  if (error.status === 403) {
    return { text: "Für das Platzieren einer Verteilung fehlt die Berechtigung.", konflikt: false };
  }
  if (error.status === 422 && codes.length > 0) {
    const texte = [...new Set(codes.map((c) => (c.startsWith("device") ? befundText(c) : (PLATZIERUNG_CODE[c] ?? null))).filter((t): t is string => t !== null))];
    if (texte.length > 0) return { text: `Nicht gespeichert: ${texte.join(" ")}`, konflikt: false };
  }
  return { text: error.userMessage, konflikt: false };
}

const PLATZIERUNG_CODE: Record<string, string> = {
  "board-placement-not-in-building": "Der Raum gehört nicht zum Gebäude dieser Verteilung.",
  "board-placement-wall-unknown": "Die Wand gehört nicht (mehr) zum gewählten Raum. Bitte neu laden.",
};
