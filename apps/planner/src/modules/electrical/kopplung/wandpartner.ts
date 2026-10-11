/**
 * Wandpartner einer Raumwand - rein, ohne DOM (Phase 6a, ADR 0024).
 *
 * Für die gewählte Wand: Welche Wände anderer Räume liegen exakt auf ihr, in
 * welchem Zustand ist die Zuordnung (offen, gemeinsam, getrennt, unterbrochen),
 * und was schlägt der Server vor? Grundlage ist die Topologie des **gezeigten**
 * Stands (Entwurf des aktiven Raums, sonst Serverstand) - eine verschobene Wand
 * zeigt ihre Kopplung also sofort als „unterbrochen“, bevor gespeichert wird.
 */
import { alsZahl } from "../topologie/lage";
import type { Kopplungsstatus, TopoWand, Wandtopologie } from "../topologie/wandtopologie";
import { kopplungsstatus, paarSchluessel } from "../topologie/wandtopologie";
import type { KandidatImPlan, KopplungImPlan } from "./zuordnung";

export interface Wandpartner {
  readonly wandId: string;
  readonly raumId: string;
  readonly kopplung: KopplungImPlan | null;
  /** Lokal abgeleiteter Status der Kopplung (gezeigter Stand), sonst `null`. */
  readonly status: Kopplungsstatus | null;
  /** Einordnung des Servers für ein ungekoppeltes Paar (gespeicherter Stand). */
  readonly kandidat: { readonly art: KandidatImPlan["kind"]; readonly gruende: KandidatImPlan["reasons"] } | null;
  /** Auf einem Teil des gemeinsamen Bereichs liegt eine weitere Wand. */
  readonly mehrdeutig: boolean;
  /** Gemeinsame Bereiche auf der eigenen Wand, ab deren Anfang (gerundet, nur Anzeige). */
  readonly bereiche: readonly { readonly vonMm: number; readonly bisMm: number }[];
  /** Beide Raumwände tragen eine andere Stärke. */
  readonly staerkeAbweichend: boolean;
}

/**
 * Partner der Wand `wandId`: zuerst die exakt überlappenden Wände anderer
 * Räume (in Wandrichtung), danach gespeicherte Kopplungen dieser Wand ohne
 * gemeinsamen Abschnitt (unterbrochen).
 */
export function wandpartner<W extends TopoWand & { readonly staerkeMm?: number }>(
  topologie: Wandtopologie<W>,
  wandId: string,
  kopplungen: readonly KopplungImPlan[],
  kandidaten: readonly KandidatImPlan[],
): Wandpartner[] {
  const teilung = topologie.teilung.get(wandId);
  const nachPaar = new Map(kopplungen.map((k) => [paarSchluessel(k.wall_a_id, k.wall_b_id), k] as const));
  const kandidatNachPaar = new Map(kandidaten.map((k) => [paarSchluessel(k.wall_a_id, k.wall_b_id), k] as const));
  const eigene = teilung?.wand;
  const ergebnis = new Map<string, { wand: W; bereiche: { vonMm: number; bisMm: number }[]; mehrdeutig: boolean }>();

  teilung?.abschnitte.forEach((abschnitt, i) => {
    if (abschnitt.lage !== "gemeinsam" || eigene === undefined) return;
    const von = Math.round(alsZahl(teilung.grenzen[i] ?? { ganz: 0, stufen: 0 }, teilung.mass));
    const bis = Math.round(alsZahl(teilung.grenzen[i + 1] ?? { ganz: 0, stufen: 0 }, teilung.mass));
    for (const q of abschnitt.quellen) {
      if (q.wand.id === wandId || q.wand.raumId === eigene.raumId) continue;
      const eintrag = ergebnis.get(q.wand.id) ?? { wand: q.wand, bereiche: [], mehrdeutig: false };
      const letzter = eintrag.bereiche[eintrag.bereiche.length - 1];
      if (letzter !== undefined && letzter.bisMm === von) letzter.bisMm = bis;
      else eintrag.bereiche.push({ vonMm: von, bisMm: bis });
      eintrag.mehrdeutig ||= abschnitt.quellen.length > 2;
      ergebnis.set(q.wand.id, eintrag);
    }
  });

  const partner: Wandpartner[] = [...ergebnis.values()].map(({ wand, bereiche, mehrdeutig }) => {
    const schluessel = paarSchluessel(wandId, wand.id);
    const kopplung = nachPaar.get(schluessel) ?? null;
    const kandidat = kopplung === null ? (kandidatNachPaar.get(schluessel) ?? null) : null;
    return {
      wandId: wand.id,
      raumId: wand.raumId,
      kopplung,
      status: kopplung === null ? null : kopplungsstatus(topologie, { id: kopplung.id, wandA: kopplung.wall_a_id, wandB: kopplung.wall_b_id, beziehung: kopplung.relation }),
      kandidat: kandidat === null ? null : { art: kandidat.kind, gruende: kandidat.reasons },
      mehrdeutig,
      bereiche,
      staerkeAbweichend: eigene?.staerkeMm !== undefined && wand.staerkeMm !== undefined && eigene.staerkeMm !== wand.staerkeMm,
    };
  });

  // Gespeicherte Kopplungen dieser Wand ohne gemeinsamen Abschnitt: unterbrochen.
  for (const k of kopplungen) {
    const andere = k.wall_a_id === wandId ? k.wall_b_id : k.wall_b_id === wandId ? k.wall_a_id : null;
    if (andere === null || ergebnis.has(andere)) continue;
    partner.push({
      wandId: andere,
      raumId: topologie.teilung.get(andere)?.wand.raumId ?? "",
      kopplung: k,
      status: "broken",
      kandidat: null,
      mehrdeutig: false,
      bereiche: [],
      staerkeAbweichend: false,
    });
  }
  return partner;
}

export type Partnerzustand = "offen" | "vorschlag" | "nicht-eindeutig" | "gemeinsam" | "getrennt" | "unterbrochen";

/** Der eine Zustand, den die Oberfläche zeigt. */
export function partnerzustand(p: Wandpartner): Partnerzustand {
  if (p.kopplung !== null) {
    if (p.status === "broken") return "unterbrochen";
    return p.kopplung.relation === "shared" ? "gemeinsam" : "getrennt";
  }
  if (p.mehrdeutig || p.kandidat?.art === "not-linkable") return "nicht-eindeutig";
  return p.kandidat?.art === "suggested" ? "vorschlag" : "offen";
}
