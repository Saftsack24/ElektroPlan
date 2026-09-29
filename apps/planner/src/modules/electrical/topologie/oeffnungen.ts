/**
 * Abgeleitete Raumverbindungen gespeicherter Öffnungen (Phase 4b.2).
 *
 * Eine Tür, ein Fenster oder ein Durchgang ist genau **eine** gespeicherte
 * Öffnung an genau **einer** Wand - ihrer Eigentümerwand. Liegt ihr ganzer
 * waagerechter Bereich in genau einem gemeinsamen atomaren Abschnitt
 * (`wandtopologie.ts`) mit genau zwei Räumen, verbindet sie diese beiden
 * Räume. Der zweite Raum ist **nur abgeleitet**: keine zweite Zeile, kein
 * zweiter Schreibvorgang, keine Paar-ID.
 *
 * Wo die Nachbarschaft nicht eindeutig ist, wird nichts geraten:
 *
 * | Lage der Öffnung | Einordnung |
 * |---|---|
 * | ganz in einem gemeinsamen Abschnitt, zwei Räume | `gemeinsam` |
 * | ganz in einem nicht geteilten Abschnitt | `aussen` |
 * | Abschnitt mit mehr als zwei Räumen | `konflikt` / `mehrdeutig` |
 * | über die Grenze zweier verschiedener Nachbarn | `konflikt` / `grenze` |
 * | nur teilweise im gemeinsamen Abschnitt | `konflikt` / `teilweise` |
 * | Gegenseite trägt eine überlappende, andere Öffnung | `konflikt` / `widerspruch` |
 * | Gegenseite trägt dasselbe Rechteck mit anderer Art | `konflikt` / `art` |
 * | passt nicht in die eigene Wand | `ungueltig` |
 *
 * Eine auf beiden Raumseiten **exakt gleich** erfasste Öffnung (nach
 * Richtungsumrechnung gleiche Art, Lage, Breite, Höhe und Brüstung) ist eine
 * reine Darstellungsdublette: Sie bleibt `gemeinsam`, wird in der
 * Darstellung einmal gezeigt und zur späteren Bereinigung gemeldet. Daten
 * werden nie verändert.
 */
import type { Lage, Linienmass } from "./lage";
import { ganzeLage, gleicheLage, minus, plus, vergleichen } from "./lage";
import type { Abschnittsquelle, TopoOeffnung, TopoWand, Wandabschnitt, Wandteilung, Wandtopologie } from "./wandtopologie";

export type Oeffnungsklasse = "gemeinsam" | "aussen" | "konflikt" | "ungueltig";

export type Konfliktgrund = "mehrdeutig" | "grenze" | "teilweise" | "widerspruch" | "art";

/** Einordnung eines waagerechten Bereichs auf einer Wand. */
export interface Bereichseinordnung<W extends TopoWand> {
  readonly klasse: Oeffnungsklasse;
  readonly grund: Konfliktgrund | null;
  /** Berührte Abschnitte (positive Länge), in Wandrichtung. */
  readonly abschnitte: readonly Wandabschnitt<W>[];
  /** Eigener Raum und - bei `gemeinsam` - der abgeleitete Nachbar. */
  readonly raumIds: readonly string[];
  readonly nachbarRaumId: string | null;
}

export interface Oeffnungseinordnung<W extends TopoWand> extends Bereichseinordnung<W> {
  readonly oeffnung: TopoOeffnung;
  /** Die Eigentümerwand - hier ist die Öffnung gespeichert. */
  readonly wand: W;
  /** Exakt gleich erfasste Öffnungen der Gegenseite (reine Darstellungsdubletten). */
  readonly dubletten: readonly string[];
  /** Überlappende, aber nicht gleiche Öffnungen der Gegenseite. */
  readonly widersprueche: readonly string[];
}

// -------------------------------------------------------- lokale Lage

/** Waagerechter Bereich in der kanonischen Richtung eines Abschnitts - exakt. */
export interface LokalerBereich {
  readonly s0: Lage;
  readonly s1: Lage;
}

/**
 * Überträgt einen Bereich `[offset, offset + breite]` der Quellwand in die
 * kanonische Richtung des Abschnitts. Läuft die Quellwand entgegen, zählt er
 * vom anderen Ende: `bis − offset − breite` (für eine vollständig
 * deckungsgleiche Wand also `Wandlänge − Abstand − Breite`, wie in ADR 0016).
 */
export function lokalerBereich<W extends TopoWand>(
  quelle: Abschnittsquelle<W>,
  offsetMm: number,
  breiteMm: number,
  mass: Linienmass,
): LokalerBereich {
  const a = ganzeLage(offsetMm);
  const b = ganzeLage(offsetMm + breiteMm);
  return quelle.umgekehrt
    ? { s0: minus(quelle.bis, b, mass), s1: minus(quelle.bis, a, mass) }
    : { s0: minus(a, quelle.von, mass), s1: minus(b, quelle.von, mass) };
}

/** Umkehrung: ein lokaler Bereich des Abschnitts auf der Quellwand, ab deren Anfang. */
export function wandbereich<W extends TopoWand>(
  quelle: Abschnittsquelle<W>,
  bereich: LokalerBereich,
  mass: Linienmass,
): LokalerBereich {
  return quelle.umgekehrt
    ? { s0: minus(quelle.bis, bereich.s1, mass), s1: minus(quelle.bis, bereich.s0, mass) }
    : { s0: plus(bereich.s0, quelle.von, mass), s1: plus(bereich.s1, quelle.von, mass) };
}

/** Echte Überdeckung positiver Länge - Berührung an der Kante zählt nicht. */
export function bereicheUeberlappen(a: LokalerBereich, b: LokalerBereich, mass: Linienmass): boolean {
  return vergleichen(a.s0, b.s1, mass) < 0 && vergleichen(b.s0, a.s1, mass) < 0;
}

function gleicherBereich(a: LokalerBereich, b: LokalerBereich, mass: Linienmass): boolean {
  return gleicheLage(a.s0, b.s0, mass) && gleicheLage(a.s1, b.s1, mass);
}

// ------------------------------------------------------ Bereich einordnen

/**
 * Ordnet einen Bereich `[offset, offset + breite]` auf einer Wand ein -
 * dieselbe Regel für gespeicherte Öffnungen, die Platzierungsvorschau und
 * das Verschieben im 2D-Editor.
 */
export function bereichEinordnen<W extends TopoWand>(
  teilung: Wandteilung<W>,
  offsetMm: number,
  breiteMm: number,
): Bereichseinordnung<W> {
  const eigener = teilung.wand.raumId;
  const ungueltig: Bereichseinordnung<W> = {
    klasse: "ungueltig",
    grund: null,
    abschnitte: [],
    raumIds: [eigener],
    nachbarRaumId: null,
  };
  const ganz = [offsetMm, breiteMm].every(Number.isSafeInteger);
  if (!ganz || offsetMm < 0 || breiteMm <= 0 || offsetMm + breiteMm > teilung.laengeMm) return ungueltig;

  const { mass, grenzen } = teilung;
  const anfang = ganzeLage(offsetMm);
  const ende = ganzeLage(offsetMm + breiteMm);
  const beruehrt = teilung.abschnitte.filter((_, i) => {
    const von = grenzen[i] as Lage;
    const bis = grenzen[i + 1] as Lage;
    return vergleichen(von, ende, mass) < 0 && vergleichen(anfang, bis, mass) < 0;
  });
  if (beruehrt.length === 0) return ungueltig;

  const gleicheRaeume = beruehrt.every((a) => a.raumIds.join("|") === (beruehrt[0] as Wandabschnitt<W>).raumIds.join("|"));
  const konflikt = (grund: Konfliktgrund): Bereichseinordnung<W> => ({
    klasse: "konflikt",
    grund,
    abschnitte: beruehrt,
    raumIds: [...new Set(beruehrt.flatMap((a) => a.raumIds))].sort(),
    nachbarRaumId: null,
  });

  if (beruehrt.some((a) => a.mehrdeutig)) return konflikt("mehrdeutig");
  if (!gleicheRaeume) {
    return beruehrt.some((a) => a.lage === "aussen") ? konflikt("teilweise") : konflikt("grenze");
  }
  const raeume = (beruehrt[0] as Wandabschnitt<W>).raumIds;
  const nachbar = raeume.find((r) => r !== eigener) ?? null;
  if (nachbar === null) {
    return { klasse: "aussen", grund: null, abschnitte: beruehrt, raumIds: [eigener], nachbarRaumId: null };
  }
  return { klasse: "gemeinsam", grund: null, abschnitte: beruehrt, raumIds: [eigener, nachbar], nachbarRaumId: nachbar };
}

// ---------------------------------------------------- alle Öffnungen

interface Teil<W extends TopoWand> {
  readonly oeffnung: TopoOeffnung;
  readonly wand: W;
  readonly bereich: LokalerBereich;
}

/**
 * Ordnet jede gespeicherte Öffnung des Geschosses ein. Liefert eine Map
 * Öffnungs-ID → Einordnung. Die Eingabe bleibt unverändert.
 */
export function oeffnungenEinordnen<W extends TopoWand>(
  topologie: Wandtopologie<W>,
): ReadonlyMap<string, Oeffnungseinordnung<W>> {
  const basis = new Map<string, Bereichseinordnung<W> & { oeffnung: TopoOeffnung; wand: W }>();
  for (const teilung of topologie.teilung.values()) {
    for (const oeffnung of teilung.wand.oeffnungen) {
      const e = bereichEinordnen(teilung, oeffnung.offsetMm, oeffnung.breiteMm);
      basis.set(oeffnung.oeffnungId, { ...e, oeffnung, wand: teilung.wand });
    }
  }

  // Gegenseiten vergleichen: nur Öffnungen verschiedener Quellwände desselben
  // gemeinsamen Abschnitts. Gleiche Wand prüft der Server (openings-overlap).
  const dubletten = new Map<string, Set<string>>();
  const widersprueche = new Map<string, { ids: Set<string>; grund: Konfliktgrund }>();
  const merken = <T>(map: Map<string, T>, id: string, neu: () => T) => {
    const vorhanden = map.get(id);
    if (vorhanden !== undefined) return vorhanden;
    const wert = neu();
    map.set(id, wert);
    return wert;
  };
  for (const abschnitt of topologie.abschnitte) {
    if (abschnitt.lage !== "gemeinsam") continue;
    const teile: Teil<W>[] = [];
    for (const quelle of abschnitt.quellen) {
      for (const oeffnung of quelle.wand.oeffnungen) {
        if (basis.get(oeffnung.oeffnungId)?.klasse === "ungueltig") continue;
        const bereich = lokalerBereich(quelle, oeffnung.offsetMm, oeffnung.breiteMm, abschnitt.mass);
        const aufAbschnitt: LokalerBereich = { s0: ganzeLage(0), s1: laengeIn(quelle, abschnitt.mass) };
        if (bereicheUeberlappen(bereich, aufAbschnitt, abschnitt.mass)) teile.push({ oeffnung, wand: quelle.wand, bereich });
      }
    }
    for (let i = 0; i < teile.length; i += 1) {
      for (let j = i + 1; j < teile.length; j += 1) {
        const a = teile[i] as Teil<W>;
        const b = teile[j] as Teil<W>;
        if (a.wand.id === b.wand.id || !bereicheUeberlappen(a.bereich, b.bereich, abschnitt.mass)) continue;
        const gleich =
          gleicherBereich(a.bereich, b.bereich, abschnitt.mass) &&
          a.oeffnung.hoeheMm === b.oeffnung.hoeheMm &&
          a.oeffnung.bruestungMm === b.oeffnung.bruestungMm;
        if (gleich && a.oeffnung.art === b.oeffnung.art) {
          merken(dubletten, a.oeffnung.oeffnungId, () => new Set<string>()).add(b.oeffnung.oeffnungId);
          merken(dubletten, b.oeffnung.oeffnungId, () => new Set<string>()).add(a.oeffnung.oeffnungId);
          continue;
        }
        const grund: Konfliktgrund = gleich ? "art" : "widerspruch";
        merken(widersprueche, a.oeffnung.oeffnungId, () => ({ ids: new Set<string>(), grund })).ids.add(b.oeffnung.oeffnungId);
        merken(widersprueche, b.oeffnung.oeffnungId, () => ({ ids: new Set<string>(), grund })).ids.add(a.oeffnung.oeffnungId);
      }
    }
  }

  const ergebnis = new Map<string, Oeffnungseinordnung<W>>();
  for (const id of [...basis.keys()].sort()) {
    const e = basis.get(id) as Bereichseinordnung<W> & { oeffnung: TopoOeffnung; wand: W };
    const w = widersprueche.get(id);
    const eigenerKonflikt = e.klasse === "konflikt" || e.klasse === "ungueltig";
    ergebnis.set(id, {
      ...e,
      // Ein Widerspruch zur Gegenseite macht eine sonst eindeutige Öffnung zum Konflikt.
      ...(w !== undefined && !eigenerKonflikt ? { klasse: "konflikt" as const, grund: w.grund, nachbarRaumId: null } : {}),
      dubletten: [...(dubletten.get(id) ?? [])].sort(),
      widersprueche: [...(w?.ids ?? [])].sort(),
    });
  }
  return ergebnis;
}

/** Länge des Abschnitts in seiner kanonischen Richtung, wie diese Quelle sie sieht. */
function laengeIn<W extends TopoWand>(quelle: Abschnittsquelle<W>, mass: Linienmass): Lage {
  return minus(quelle.bis, quelle.von, mass);
}

// ------------------------------------------ Öffnungen der Gegenseiten

/** Bereich einer Öffnung einer anderen Wand, übertragen auf eine Wand. */
export interface FremderBereich {
  readonly oeffnungId: string;
  readonly raumId: string;
  readonly wandId: string;
  /** Ab Anfang der betrachteten Wand, exakt. */
  readonly bereich: LokalerBereich;
}

/**
 * Öffnungen, die andere Wände auf den gemeinsamen Abschnitten dieser Wand
 * tragen - übertragen in deren Wandrichtung. Dient der Kollisionsprüfung
 * beim Platzieren und Verschieben: Eine neue Tür darf nicht in eine auf der
 * Gegenseite erfasste Öffnung gesetzt werden.
 */
export function fremdeBereiche<W extends TopoWand>(teilung: Wandteilung<W>): FremderBereich[] {
  const ergebnis = new Map<string, FremderBereich>();
  for (const abschnitt of teilung.abschnitte) {
    const eigene = abschnitt.quellen.find((q) => q.wand.id === teilung.wand.id);
    if (eigene === undefined) continue;
    for (const quelle of abschnitt.quellen) {
      if (quelle.wand.id === teilung.wand.id) continue;
      const aufAbschnitt: LokalerBereich = { s0: ganzeLage(0), s1: laengeIn(quelle, abschnitt.mass) };
      for (const oeffnung of quelle.wand.oeffnungen) {
        if (ergebnis.has(oeffnung.oeffnungId)) continue;
        const lokal = lokalerBereich(quelle, oeffnung.offsetMm, oeffnung.breiteMm, abschnitt.mass);
        if (!bereicheUeberlappen(lokal, aufAbschnitt, abschnitt.mass)) continue;
        ergebnis.set(oeffnung.oeffnungId, {
          oeffnungId: oeffnung.oeffnungId,
          raumId: quelle.wand.raumId,
          wandId: quelle.wand.id,
          bereich: wandbereich(eigene, lokal, abschnitt.mass),
        });
      }
    }
  }
  return [...ergebnis.values()];
}
