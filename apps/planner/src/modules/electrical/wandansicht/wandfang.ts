/**
 * Einrasten in der Wandansicht - zentral und deterministisch (Phase 4f, ADR 0022).
 *
 * Gefangen wird **eine Achse** auf einmal (waagerecht oder senkrecht). Der
 * Aufrufer beschreibt die beweglichen Merkmale (etwa linke Kante, Mitte und
 * rechte Kante einer gezogenen Öffnung) und je Merkmal die möglichen Ziele.
 * Gewählt wird das Ziel, dessen Verschiebung am kleinsten ist.
 *
 * **Toleranz** in Bildschirmpixeln (`toleranzPx / massstab` mm): Das Verhalten
 * bleibt bei jeder Zoomstufe gleich bedienbar.
 *
 * **Prioritäten** bei gleich weitem Abstand (exakt gleicher Verschiebung):
 *
 * 1. Wandkante
 * 2. Kante einer anderen Öffnung
 * 3. gleiche Höhe (Brüstung, Oberkante)
 * 4. Wandmitte
 * 5. Mitte einer anderen Öffnung
 *
 * danach die kleinere resultierende Verschiebung nach Vorzeichen (links
 * zuerst) und zuletzt die Ziel-ID - das Ergebnis hängt nie von der
 * Reihenfolge der Eingabe ab.
 *
 * **Kein Flackern:** Ein im vorigen Schritt gewähltes Ziel bleibt bis zur
 * 1,5-fachen Toleranz aktiv, solange kein anderes Ziel um mehr als die halbe
 * Toleranz näher liegt (Hysterese).
 *
 * **Raster** ist der Rückfall, wenn kein Objektziel in Reichweite ist:
 * gemessen ab der linken Wandkante bzw. dem Fußboden. **Aus** (Schalter oder
 * `Alt`): ganze Millimeter, sonst nichts.
 *
 * Das Ergebnis ist immer eine **ganzzahlige** Verschiebung. Ob die neue Lage
 * fachlich zulässig ist, entscheidet der Aufrufer danach
 * (`wandpruefung.ts`) - ein Fangziel darf nie eine ungültige Lage erzwingen.
 */

export type Zielart = "wandkante" | "oeffnungskante" | "hoehe" | "wandmitte" | "oeffnungsmitte" | "raster";

const RANG: Record<Zielart, number> = {
  wandkante: 0,
  oeffnungskante: 1,
  hoehe: 2,
  wandmitte: 3,
  oeffnungsmitte: 4,
  raster: 5,
};

export interface Fangziel {
  /** Stabile Kennung, etwa `wand-links`, `kante:<id>:links`. */
  readonly id: string;
  readonly art: Zielart;
  /** Lage des Ziels in mm der Ansicht (darf gebrochen sein, z. B. Wandmitte). */
  readonly wert: number;
  /** Kurzer Text für die Hervorhebung („Wandmitte", „Kante Fenster"). */
  readonly text: string;
}

/** Ein bewegliches Merkmal mit seinen Zielen - etwa die linke Kante. */
export interface Merkmal {
  /** Aktuelle (ungefangene) Lage in mm. */
  readonly wert: number;
  /**
   * Fester Abstand des Merkmals zur Bezugslage (`rasterBezug`), etwa `0` für
   * die linke Kante, die halbe Breite für die Mitte. Damit wird die gefangene
   * Lage **exakt** aus dem Ziel berechnet - unabhängig vom Gleitkommarauschen
   * der Zeigerposition.
   */
  readonly versatz: number;
  readonly ziele: readonly Fangziel[];
}

export interface Fangoptionen {
  readonly aktiv: boolean;
  /** `Alt` gedrückt: vorübergehend aus. */
  readonly ausgesetzt: boolean;
  /** Pixel je Millimeter. */
  readonly massstab: number;
  readonly toleranzPx?: number;
  /** Rasterweite in mm - der Rückfall. */
  readonly rasterMm: number;
  /** Welche Lage auf das Raster fällt (z. B. die linke Kante). */
  readonly rasterBezug: number;
  /** Ziel des vorigen Schritts - für die Hysterese. */
  readonly vorher?: string | null;
}

export interface Fangergebnis {
  /** Ganzzahlige Verschiebung, die auf alle Merkmale anzuwenden ist. */
  readonly verschiebung: number;
  readonly ziel: Fangziel | null;
}

export const FANG_TOLERANZ_PX = 10;

interface Treffer {
  readonly ziel: Fangziel;
  readonly delta: number;
  readonly versatz: number;
}

function besser(a: Treffer, b: Treffer): boolean {
  const da = Math.abs(a.delta);
  const db = Math.abs(b.delta);
  if (da !== db) return da < db;
  if (RANG[a.ziel.art] !== RANG[b.ziel.art]) return RANG[a.ziel.art] < RANG[b.ziel.art];
  if (a.delta !== b.delta) return a.delta < b.delta;
  return a.ziel.id < b.ziel.id;
}

/**
 * Sucht für eine **rohe** (ungefangene, gebrochene) Verschiebung der
 * Merkmale das beste Fangziel. `merkmale[i].wert` ist die Lage **nach** der
 * rohen Verschiebung.
 */
export function fangen(merkmale: readonly Merkmal[], optionen: Fangoptionen): Fangergebnis {
  if (!optionen.aktiv || optionen.ausgesetzt) {
    return { verschiebung: Math.round(optionen.rasterBezug) - optionen.rasterBezug + 0, ziel: null };
  }
  const toleranz = (optionen.toleranzPx ?? FANG_TOLERANZ_PX) / optionen.massstab;
  let bester: Treffer | null = null;
  let vorherig: Treffer | null = null;
  for (const merkmal of merkmale) {
    for (const ziel of merkmal.ziele) {
      const treffer = { ziel, delta: ziel.wert - merkmal.wert, versatz: merkmal.versatz };
      if (ziel.id === optionen.vorher && Math.abs(treffer.delta) <= toleranz * 1.5) {
        if (vorherig === null || besser(treffer, vorherig)) vorherig = treffer;
      }
      if (Math.abs(treffer.delta) > toleranz) continue;
      if (bester === null || besser(treffer, bester)) bester = treffer;
    }
  }
  let gewaehlt = bester;
  if (vorherig !== null && (bester === null || Math.abs(vorherig.delta) - Math.abs(bester.delta) <= toleranz / 2)) {
    gewaehlt = vorherig;
  }
  if (gewaehlt !== null) {
    // Ganze Millimeter, exakt aus dem Ziel: Bezugslage = Ziel − Versatz. Ein
    // halber Millimeter (Mitte einer ungeraden Breite) rundet aufwärts.
    return { verschiebung: Math.round(gewaehlt.ziel.wert - gewaehlt.versatz) - optionen.rasterBezug + 0, ziel: gewaehlt.ziel };
  }
  const r = optionen.rasterMm;
  const aufRaster = Math.round(optionen.rasterBezug / r) * r;
  return {
    verschiebung: aufRaster - optionen.rasterBezug + 0,
    ziel: { id: `raster:${aufRaster}`, art: "raster", wert: aufRaster, text: "Raster" },
  };
}

// --------------------------------------------------------- Ziellisten

export interface Nachbaroeffnung {
  readonly id: string;
  readonly name: string;
  readonly links: number;
  readonly rechts: number;
  readonly unten: number;
  readonly oben: number;
  readonly fenster: boolean;
}

/** Waagerechte Ziele einer bewegten Öffnung: Kanten und Mitten. */
export function waagerechteZiele(
  laengeMm: number,
  andere: readonly Nachbaroeffnung[],
): { links: Fangziel[]; rechts: Fangziel[]; mitte: Fangziel[] } {
  const links: Fangziel[] = [{ id: "wand-links", art: "wandkante", wert: 0, text: "linke Wandkante" }];
  const rechts: Fangziel[] = [{ id: "wand-rechts", art: "wandkante", wert: laengeMm, text: "rechte Wandkante" }];
  const mitte: Fangziel[] = [{ id: "wand-mitte", art: "wandmitte", wert: laengeMm / 2, text: "Wandmitte" }];
  for (const o of andere) {
    // Bündig anstoßen oder an derselben Kante ausrichten.
    links.push({ id: `kante:${o.id}:rechts`, art: "oeffnungskante", wert: o.rechts, text: `Kante ${o.name}` });
    links.push({ id: `kante:${o.id}:links`, art: "oeffnungskante", wert: o.links, text: `Kante ${o.name}` });
    rechts.push({ id: `kante:${o.id}:links`, art: "oeffnungskante", wert: o.links, text: `Kante ${o.name}` });
    rechts.push({ id: `kante:${o.id}:rechts`, art: "oeffnungskante", wert: o.rechts, text: `Kante ${o.name}` });
    mitte.push({ id: `mitte:${o.id}`, art: "oeffnungsmitte", wert: (o.links + o.rechts) / 2, text: `Mitte ${o.name}` });
  }
  return { links, rechts, mitte };
}

/** Senkrechte Ziele: gleiche Brüstung anderer Fenster, gleiche Oberkante aller Öffnungen. */
export function senkrechteZiele(andere: readonly Nachbaroeffnung[]): { unten: Fangziel[]; oben: Fangziel[] } {
  const unten: Fangziel[] = [];
  const oben: Fangziel[] = [];
  for (const o of andere) {
    if (o.fenster) unten.push({ id: `bruestung:${o.id}`, art: "hoehe", wert: o.unten, text: `gleiche Brüstung wie ${o.name}` });
    oben.push({ id: `oberkante:${o.id}`, art: "hoehe", wert: o.oben, text: `gleiche Oberkante wie ${o.name}` });
  }
  return { unten, oben };
}
