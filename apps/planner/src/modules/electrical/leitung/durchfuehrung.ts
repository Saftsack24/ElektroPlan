/**
 * Durchführungen im Leitungsentwurf (Phase 6b.5, Entwurf §5.2).
 *
 * Eine **neue** Durchführung lebt nur im Entwurf (`neueDurchfuehrungen`) und
 * entsteht beim Speichern atomar mit der Leitung über `new_penetrations` - wer
 * verwirft, hinterlässt nichts auf dem Server.
 *
 * Zulässig ist eine Stelle nur in einem **aktiven, eindeutigen `shared`-Abschnitt**
 * genau einer Kopplung - nie bei `undecided`, `separate`, mehrdeutig (mehr als zwei
 * Räume) oder unterbrochen. Gespeichert wird die Lage einmal an der Eigentümerwand
 * `wall_a`; die Gegenlage ergibt sich über dieselbe geprüfte
 * Abschnittstransformation wie im Server (`lageUebertragen`, Spiegel von
 * `topology.transfer`) - nie als zweite gespeicherte Geometrie.
 */
import { lageUebertragen } from "../topologie/oeffnungen";
import { ganzeLage, vergleichen } from "../topologie/lage";
import type { TopoWand, Wandabschnitt } from "../topologie/wandtopologie";
import { kopplungsstatus } from "../topologie/wandtopologie";
import type { Durchfuehrung, VorbereiteterPlan } from "./laenge";
import { gemeinsameQuellen, gerundeteLage } from "./laenge";

/** Eine Durchführung, die erst mit der Leitung gespeichert wird. */
export interface NeueDurchfuehrung {
  /** Schlüssel im Entwurf; beim Speichern `new_penetration_key`. */
  readonly schluessel: string;
  readonly kopplungId: string;
  /** Lage an `wall_a` der Kopplung, ab deren Wandanfang. */
  readonly abstandMm: number;
  readonly hoeheMm: number;
}

/** Präfix lokaler Schlüssel - unterscheidet sie sicher von Server-IDs (UUIDs beginnen nie so). */
export const NEU_PRAEFIX = "neu-";

/**
 * Höchstlänge des Schlüssels - wie `NewPenetrationIn.key` im Server (40). Ein längerer Schlüssel
 * ließ das Speichern scheitern (Befund der Browserabnahme 6b.5); ein Test prüft die Grenze gegen
 * `apps/backend/openapi.json`.
 */
export const SCHLUESSEL_MAX = 40;

export function istNeu(id: string): boolean {
  return id.startsWith(NEU_PRAEFIX);
}

export function neuerSchluessel(): string {
  // 4 + 32 Zeichen: die UUID ohne Bindestriche.
  return `${NEU_PRAEFIX}${crypto.randomUUID().replaceAll("-", "")}`;
}

/** Lage einer Durchführung auf einer ihrer beiden Wände (ab deren Anfang), gerundet - sonst `null`. */
export function durchfuehrungsWandlage(v: VorbereiteterPlan, d: Durchfuehrung, wandId: string): number | null {
  const k = v.kopplungen.get(d.kopplungId);
  if (k === undefined) return null;
  if (wandId === k.wandA) return d.abstandMm;
  if (wandId !== k.wandB) return null;
  const info = v.waende.get(k.wandA);
  const paar = gemeinsameQuellen(v, k, ganzeLage(d.abstandMm));
  if (info === undefined || paar === null) return null;
  return gerundeteLage(lageUebertragen(ganzeLage(d.abstandMm), paar[0], paar[1], info.teilung.mass), info.teilung.mass);
}

export type Durchfuehrungsziel =
  | { readonly ok: true; readonly kopplungId: string; readonly abstandMm: number }
  | { readonly ok: false; readonly grund: string };

const ZUORDNUNG_GRUND: Record<string, string> = {
  "no-partner": "Hier grenzt kein zweiter Raum an – eine Durchführung braucht eine gemeinsame Bauwand.",
  undecided: "Die Wandzuordnung ist hier noch nicht entschieden. Erst als gemeinsame Bauwand zuordnen.",
  separate: "Hier sind es getrennte Wände – eine Durchführung ist nur durch eine gemeinsame Bauwand vorgesehen.",
};

/**
 * Kopplung und Lage an `wall_a` für eine neue Durchführung an `wandId` bei
 * `abstandMm` (ab Anfang dieser Wand). Eindeutig oder mit verständlichem Grund
 * abgelehnt - nie eine beliebige Zuordnung.
 */
export function durchfuehrungsziel(v: VorbereiteterPlan, wandId: string, abstandMm: number): Durchfuehrungsziel {
  const info = v.waende.get(wandId);
  if (info === undefined) return { ok: false, grund: "Die Wand ist im gespeicherten Stand nicht bekannt." };
  const teilung = info.teilung;
  const mass = teilung.mass;
  const stelle = ganzeLage(abstandMm);
  const treffer: Wandabschnitt<TopoWand>[] = [];
  teilung.abschnitte.forEach((a, i) => {
    const von = teilung.grenzen[i];
    const bis = teilung.grenzen[i + 1];
    if (von !== undefined && bis !== undefined && vergleichen(von, stelle, mass) <= 0 && vergleichen(stelle, bis, mass) <= 0) treffer.push(a);
  });
  const abschnitt = treffer[0];
  if (abschnitt === undefined) return { ok: false, grund: "Die Stelle liegt nicht auf der Wand." };
  if (treffer.some((a) => a.kopplungId !== abschnitt.kopplungId || a.zuordnung !== abschnitt.zuordnung)) {
    return { ok: false, grund: "Die Stelle liegt genau auf einer Abschnittsgrenze – bitte etwas versetzen." };
  }
  if (abschnitt.mehrdeutig) return { ok: false, grund: "Hier treffen mehr als zwei Räume zusammen – keine eindeutige Durchführung möglich." };
  if (abschnitt.zuordnung !== "shared" || abschnitt.kopplungId === null) {
    return { ok: false, grund: ZUORDNUNG_GRUND[abschnitt.zuordnung] ?? "Hier ist keine Durchführung möglich." };
  }
  const k = v.kopplungen.get(abschnitt.kopplungId);
  const topologie = v.topologien.get(info.raum.geschossId);
  if (k === undefined || topologie === undefined) return { ok: false, grund: "Die Wandzuordnung ist nicht bekannt." };
  const status = kopplungsstatus(topologie, k);
  if (status !== "active") {
    return {
      ok: false,
      grund:
        status === "ambiguous"
          ? "Die gemeinsame Bauwand ist mehrdeutig zugeordnet – erst klären."
          : "Die Wandzuordnung ist unterbrochen – erst in der Wandzuordnung prüfen.",
    };
  }
  if (wandId === k.wandA) return { ok: true, kopplungId: k.id, abstandMm };
  const von = abschnitt.quellen.find((q) => q.wand.id === wandId);
  const nach = abschnitt.quellen.find((q) => q.wand.id === k.wandA);
  if (von === undefined || nach === undefined) return { ok: false, grund: "Die Gegenwand ist nicht eindeutig." };
  return { ok: true, kopplungId: k.id, abstandMm: gerundeteLage(lageUebertragen(stelle, von, nach, mass), mass) };
}
