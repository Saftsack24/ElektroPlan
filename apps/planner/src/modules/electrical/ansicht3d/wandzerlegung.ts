/**
 * Wandkörper mit Aussparungen - ohne CSG.
 *
 * Eine Wand ist in ihren lokalen Koordinaten ein Rechteck: `s` läuft entlang
 * der Wand von 0 bis zur Wandlänge, `h` von 0 (Fertigfußboden) bis zur
 * Darstellungshöhe. Öffnungen sind darin achsenparallele Rechtecke. Die Wand
 * wird entlang **sämtlicher** Öffnungskanten in ein Raster zerlegt; jede
 * Zelle ist entweder vollständig Aussparung oder vollständig Wand. Die
 * Wandzellen werden spaltenweise senkrecht und danach waagerecht zu
 * möglichst wenigen Rechtecken zusammengefasst.
 *
 * Das Ergebnis ist deterministisch, rein ganzzahlig und frei von Flächen mit
 * Nullausdehnung: Rastergrenzen sind sortiert und eindeutig, jede Zelle ist
 * also echt positiv groß. Überlappende Aussparungen ergeben von selbst ihre
 * Vereinigung - genau die Darstellungsregel für widersprüchlich erfasste
 * Öffnungen (ADR 0016).
 */

/** Rechteck in lokalen Wandkoordinaten, halboffen `[s0, s1) × [h0, h1)`. */
export interface Wandrechteck {
  readonly s0: number;
  readonly s1: number;
  readonly h0: number;
  readonly h1: number;
}

function ganzePositive(zahl: number): boolean {
  return Number.isSafeInteger(zahl) && zahl > 0;
}

/**
 * Beschneidet ein Rechteck auf die Wandfläche. Liefert `null`, wenn nichts
 * mit positiver Fläche übrig bleibt.
 */
export function beschneiden(
  rechteck: Wandrechteck,
  laengeMm: number,
  hoeheMm: number,
): Wandrechteck | null {
  const s0 = Math.max(0, rechteck.s0);
  const s1 = Math.min(laengeMm, rechteck.s1);
  const h0 = Math.max(0, rechteck.h0);
  const h1 = Math.min(hoeheMm, rechteck.h1);
  return s1 > s0 && h1 > h0 ? { s0, s1, h0, h1 } : null;
}

/** Gemeinsame Fläche > 0? Berührung an einer Kante zählt nicht (ADR 0013). */
export function ueberlappen(a: Wandrechteck, b: Wandrechteck): boolean {
  return a.s0 < b.s1 && b.s0 < a.s1 && a.h0 < b.h1 && b.h0 < a.h1;
}

export function gleichesRechteck(a: Wandrechteck, b: Wandrechteck): boolean {
  return a.s0 === b.s0 && a.s1 === b.s1 && a.h0 === b.h0 && a.h1 === b.h1;
}

function grenzen(werte: number[]): number[] {
  return [...new Set(werte)].sort((a, b) => a - b);
}

/**
 * Zerlegt die Wandfläche `[0, laenge) × [0, hoehe)` abzüglich der
 * Aussparungen in Wandrechtecke.
 *
 * Ungültige Maße (nicht ganzzahlig, ≤ 0) liefern eine leere Liste: Der
 * Aufrufer hat sie bereits als Warnung gemeldet; hier wird nur verhindert,
 * dass daraus Geometrie entsteht. Aussparungen außerhalb der Wand werden
 * beschnitten, leere verworfen.
 */
export function wandZerlegen(
  laengeMm: number,
  hoeheMm: number,
  aussparungen: readonly Wandrechteck[],
): Wandrechteck[] {
  if (!ganzePositive(laengeMm) || !ganzePositive(hoeheMm)) return [];

  const loecher = aussparungen
    .map((r) => beschneiden(r, laengeMm, hoeheMm))
    .filter((r): r is Wandrechteck => r !== null);

  const xs = grenzen([0, laengeMm, ...loecher.flatMap((r) => [r.s0, r.s1])]);
  const ys = grenzen([0, hoeheMm, ...loecher.flatMap((r) => [r.h0, r.h1])]);

  const istLoch = (s0: number, s1: number, h0: number, h1: number) =>
    loecher.some((r) => r.s0 <= s0 && r.s1 >= s1 && r.h0 <= h0 && r.h1 >= h1);

  const fertig: Wandrechteck[] = [];
  // Senkrechte Läufe der vorigen Spalte, die noch verlängert werden können.
  let offen: Wandrechteck[] = [];

  for (let i = 0; i + 1 < xs.length; i += 1) {
    const s0 = xs[i] as number;
    const s1 = xs[i + 1] as number;

    // 1. Senkrechte Läufe dieser Spalte.
    const laeufe: { h0: number; h1: number }[] = [];
    for (let j = 0; j + 1 < ys.length; j += 1) {
      const h0 = ys[j] as number;
      const h1 = ys[j + 1] as number;
      if (istLoch(s0, s1, h0, h1)) continue;
      const letzter = laeufe[laeufe.length - 1];
      if (letzter !== undefined && letzter.h1 === h0) letzter.h1 = h1;
      else laeufe.push({ h0, h1 });
    }

    // 2. Waagerecht verlängern, wo die vorige Spalte denselben Lauf hatte.
    const naechste: Wandrechteck[] = [];
    for (const lauf of laeufe) {
      const vorher = offen.find((r) => r.h0 === lauf.h0 && r.h1 === lauf.h1 && r.s1 === s0);
      naechste.push(vorher === undefined ? { s0, s1, ...lauf } : { ...vorher, s1 });
    }
    for (const r of offen) {
      if (!naechste.some((n) => n.s0 === r.s0 && n.h0 === r.h0 && n.h1 === r.h1)) fertig.push(r);
    }
    offen = naechste;
  }
  fertig.push(...offen);

  // Stabile Reihenfolge unabhängig vom Zusammenfassen.
  return fertig.sort((a, b) => a.s0 - b.s0 || a.h0 - b.h0);
}
