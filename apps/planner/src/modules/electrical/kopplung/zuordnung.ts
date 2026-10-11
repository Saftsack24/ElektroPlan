/**
 * Wandzuordnung (Wandkopplung, Phase 6a, ADR 0024) - Übersetzung des
 * Planungsstands in die reine Topologie und verständliche Bezeichnungen.
 *
 * Gespeichert ist je Kopplung nur die Entscheidung (`shared`/`separate`); die
 * Wirkung je Abschnitt leitet `topologie/wandtopologie.ts` ab - dieselbe Regel
 * wie der Server. Vorschläge (Kandidaten) berechnet nur der Server; hier werden
 * sie nur angezeigt. Nichts wird automatisch gekoppelt.
 *
 * Bewusst ohne Editor-Abhängigkeiten: Die lazy geladene 3D-Ansicht nutzt die
 * Datei ebenfalls.
 */
import type { components } from "@elektroplan/api-client";

import type { TopoKopplung } from "../topologie/wandtopologie";
import { paarSchluessel } from "../topologie/wandtopologie";

type Schemas = components["schemas"];
export type KopplungImPlan = Schemas["WallLinkOut"];
export type KandidatImPlan = Schemas["WallLinkCandidateOut"];
export type Kandidatengrund = KandidatImPlan["reasons"][number];

/** Gespeicherte Kopplungen als Eingabe der Topologie. */
export function kopplungenAus(links: readonly KopplungImPlan[] | undefined): TopoKopplung[] {
  return (links ?? []).map((k) => ({ id: k.id, wandA: k.wall_a_id, wandB: k.wall_b_id, beziehung: k.relation }));
}

/** Kandidaten des Servers je Wandpaar (`paarSchluessel`). */
export function paarKandidatenAus(
  kandidaten: readonly KandidatImPlan[] | undefined,
): ReadonlyMap<string, { readonly art: KandidatImPlan["kind"]; readonly gruende: KandidatImPlan["reasons"] }> {
  return new Map(
    (kandidaten ?? []).map((k) => [paarSchluessel(k.wall_a_id, k.wall_b_id), { art: k.kind, gruende: k.reasons }] as const),
  );
}

/** Kopplungen, an denen eine der Wände beteiligt ist. */
export function kopplungenDerWaende(
  links: readonly KopplungImPlan[] | undefined,
  wandIds: ReadonlySet<string>,
): KopplungImPlan[] {
  return (links ?? []).filter((k) => wandIds.has(k.wall_a_id) || wandIds.has(k.wall_b_id));
}

export const BEZIEHUNG_TEXT: Record<KopplungImPlan["relation"], string> = {
  shared: "Gemeinsame Bauwand",
  separate: "Getrennte Wände",
};

/** Was die Entscheidung bewirkt - kurz und ohne Fachchinesisch. */
export const BEZIEHUNG_ERKLAERUNG: Record<KopplungImPlan["relation"], string> = {
  shared:
    "Eine Wand zwischen beiden Räumen: Türen und Fenster gehen durch und gelten auf beiden Seiten. Außen montiert werden kann hier nichts.",
  separate:
    "Zwei Wände auf derselben Linie (z. B. zweischalige Trennwand oder Fuge): Öffnungen gelten nur für ihre eigene Wand. Die Fläche zwischen beiden ist keine Fassade – außen montiert werden kann hier nichts.",
};

export const KANDIDAT_TEXT: Record<KandidatImPlan["kind"], string> = {
  suggested: "Zuordnung offen – Vorschlag: gemeinsame Bauwand",
  "decision-needed": "Zuordnung offen – bitte festlegen",
  "not-linkable": "Nicht eindeutig zuordenbar",
};

export const GRUND_TEXT: Record<Kandidatengrund, string> = {
  ambiguous: "Auf einem Stück liegen mehr als zwei Wände (dritter Raum oder überschneidende Zuordnung).",
  "thickness-differs": "Die beiden Wände sind unterschiedlich stark erfasst.",
  "contour-open": "Mindestens eine Raumkontur ist noch nicht geschlossen.",
  "openings-on-both-sides": "Auf beiden Seiten ist an derselben Stelle eine Öffnung erfasst.",
};

export const STATUS_TEXT: Record<KopplungImPlan["status"], string> = {
  active: "wirksam",
  ambiguous: "teilweise nicht eindeutig – dort vorsichtig wie unentschieden",
  broken: "unterbrochen – die Wände liegen nicht mehr aufeinander; die Zuordnung wirkt erst wieder, wenn sie passen",
};

/** Solange nichts festgelegt ist, gilt die vorsichtige Regel von Phase 5. */
export const OFFEN_ERKLAERUNG =
  "Solange nichts festgelegt ist, gilt die vorsichtige Regel: Türen und Fenster des Nachbarraums gelten auch hier, außen montiert werden kann nichts.";
