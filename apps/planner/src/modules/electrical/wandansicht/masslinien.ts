/**
 * Maß- und Hilfslinien der Wandansicht - welche Maße zu einer Öffnung gehören.
 *
 * Reine Funktion; gezeichnet wird im Bildraum (`WandZeichenflaeche.tsx`),
 * damit Text und Linien bei jedem Zoom gleich groß und lesbar bleiben.
 *
 * **Maßbedeutung** (ADR 0022):
 *
 * | Maß | von - bis |
 * |---|---|
 * | Abstand von links / rechts | Wandkante bis **Kante** der Öffnung (lichtes Maß) |
 * | Breite, Höhe | Kante bis Kante der Öffnung |
 * | Brüstung über Boden | Fertigfußboden bis Unterkante |
 * | Abstand zur Decke | Oberkante bis Decke (effektive Raumhöhe) |
 * | frei zu … | **freier** Abstand Kante zu Kante zur nächsten Öffnung links bzw. rechts |
 *
 * Mitten- oder Achsmaße erscheinen hier nicht; wo sie gezeigt werden (Eigenschaften),
 * heißen sie ausdrücklich „Achsmaß“.
 *
 * **Nur die nächsten Nachbarn**: je Seite die nächste Öffnung derselben Wand
 * (eigene oder abgeleitete). Auf einer Wand liegen Öffnungen nebeneinander,
 * nie übereinander (der Server verbietet überlappende Bereiche) - deshalb ist
 * die waagerechte Nachbarschaft die räumlich relevante. Eine Überschneidung
 * (nur in einem ungültigen Entwurf möglich) erscheint als „überschneidet“,
 * nie als positiver Abstand.
 */
import type { Ansichtsrechteck } from "./wandbezug";

export type Massart = "rand" | "breite" | "nachbar" | "ueberschneidung" | "bruestung" | "hoehe" | "decke";

export interface Masslinie {
  readonly id: string;
  readonly achse: "waagerecht" | "senkrecht";
  /** Reihe: 0 = unter dem Fußboden (Wandkanten), 1 = über der Öffnung (Nachbarn). */
  readonly reihe: 0 | 1;
  readonly von: number;
  readonly bis: number;
  readonly art: Massart;
  /** Verständliche Bezeichnung - für Tooltip und Bildschirmleser. */
  readonly bezeichnung: string;
  /** Kurztext auf der Linie. */
  readonly text: string;
}

export interface Nachbar extends Ansichtsrechteck {
  readonly id: string;
  readonly name: string;
}

export function masslinien(
  r: Ansichtsrechteck,
  laengeMm: number,
  hoeheMm: number,
  andere: readonly Nachbar[],
  mm: (wert: number) => string,
): Masslinie[] {
  const linien: Masslinie[] = [];
  const waagerecht = (id: string, reihe: 0 | 1, von: number, bis: number, art: Massart, bezeichnung: string, text: string) =>
    linien.push({ id, achse: "waagerecht", reihe, von, bis, art, bezeichnung, text });
  const senkrecht = (id: string, von: number, bis: number, art: Massart, bezeichnung: string, text: string) =>
    linien.push({ id, achse: "senkrecht", reihe: 0, von, bis, art, bezeichnung, text });

  // Reihe 0: Wandkante - Öffnung - Wandkante.
  waagerecht("links", 0, 0, r.links, "rand", "Abstand von links", mm(r.links));
  waagerecht("breite", 0, r.links, r.rechts, "breite", "Breite", mm(r.rechts - r.links));
  waagerecht("rechts", 0, r.rechts, laengeMm, "rand", "Abstand von rechts", mm(laengeMm - r.rechts));

  // Reihe 1: nächste Nachbarn, freier Abstand Kante zu Kante.
  const mitte = (r.links + r.rechts) / 2;
  const linksVon = andere.filter((o) => (o.links + o.rechts) / 2 < mitte).sort((a, b) => b.rechts - a.rechts)[0];
  const rechtsVon = andere.filter((o) => (o.links + o.rechts) / 2 >= mitte).sort((a, b) => a.links - b.links)[0];
  if (linksVon !== undefined) {
    const frei = r.links - linksVon.rechts;
    if (frei >= 0) waagerecht("nachbar-links", 1, linksVon.rechts, r.links, "nachbar", `frei zu ${linksVon.name}`, `frei ${mm(frei)}`);
    else waagerecht("nachbar-links", 1, r.links, linksVon.rechts, "ueberschneidung", `überschneidet ${linksVon.name}`, "überschneidet");
  }
  if (rechtsVon !== undefined) {
    const frei = rechtsVon.links - r.rechts;
    if (frei >= 0) waagerecht("nachbar-rechts", 1, r.rechts, rechtsVon.links, "nachbar", `frei zu ${rechtsVon.name}`, `frei ${mm(frei)}`);
    else waagerecht("nachbar-rechts", 1, rechtsVon.links, r.rechts, "ueberschneidung", `überschneidet ${rechtsVon.name}`, "überschneidet");
  }

  // Senkrecht: Brüstung, Höhe, Abstand zur Decke.
  if (r.unten > 0) senkrecht("bruestung", 0, r.unten, "bruestung", "Brüstung über Boden", mm(r.unten));
  senkrecht("hoehe", r.unten, r.oben, "hoehe", "Höhe", mm(r.oben - r.unten));
  if (r.oben <= hoeheMm) senkrecht("decke", r.oben, hoeheMm, "decke", "Abstand zur Decke", mm(hoeheMm - r.oben));
  else senkrecht("decke", hoeheMm, r.oben, "ueberschneidung", "Oberkante über der Decke", `${mm(r.oben - hoeheMm)} über der Decke`);
  return linien;
}

/** Ungefähre Textbreite in Pixeln (11 px Schrift) - nur zum Ausweichen von Beschriftungen. */
export function textbreitePx(text: string): number {
  return text.length * 6.4 + 8;
}
