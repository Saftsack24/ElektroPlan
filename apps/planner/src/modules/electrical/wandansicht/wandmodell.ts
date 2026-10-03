/**
 * Was die Wandansicht zeigt - reine Ableitung aus Entwurf und Topologie.
 *
 * Quelle ist **derselbe** Stand wie im Grundriss: aktiver Raum aus dem
 * Entwurf, alle anderen vom Server (`editor/platzierung.ts::editorTopologie`).
 * Hier entsteht nichts Neues und nichts wird gespeichert.
 *
 * * **eigene Öffnungen** - an dieser Wand gespeichert,
 * * **abgeleitete Öffnungen** - ein Nachbarraum hat sie an seiner
 *   deckungsgleichen Wand gespeichert (ADR 0016, „eine Öffnung als
 *   Quelle“). Sie erscheinen gespiegelt an der richtigen Stelle, tragen ihre
 *   eine fachliche ID und lassen sich nur an der Quelle bearbeiten,
 * * **Abschnitte** - welche Stücke der Wand an welchen Raum grenzen, samt
 *   dessen Deckenhöhe.
 */
import type { EntwurfWand, Oeffnungsart } from "../editor/entwurf";
import { MAX_OEFFNUNG_MM, MIN_OEFFNUNG_MM, oeffnungsBefunde, oeffnungsHoehenBefunde } from "../editor/geometrie";
import type { EditorEinordnung, EditorTopologie } from "../editor/platzierung";
import { alsZahl } from "../topologie/lage";
import { fremdeBereiche } from "../topologie/oeffnungen";
import { OEFFNUNGSART_LABEL } from "../texte";
import type { Ansichtsrechteck, Wandbezug } from "./wandbezug";
import { punktInAnsicht, rechteckInAnsicht } from "./wandbezug";

export interface AnsichtsOeffnung extends Ansichtsrechteck {
  readonly id: string;
  readonly art: Oeffnungsart;
  /** Gespeicherte Werte - für Eigenschaften und Rückrechnung. */
  readonly offsetMm: number;
  readonly breiteMm: number;
  readonly hoeheMm: number;
  readonly bruestungMm: number;
  /** An dieser Wand gespeichert (`true`) oder aus dem Nachbarraum abgeleitet. */
  readonly eigen: boolean;
  /** Bei abgeleiteten: Raum und Wand der gespeicherten Quelle. */
  readonly quelleRaumId: string;
  readonly quelleWandId: string;
  /** Verständliche Befunde (passt nicht in die Wand, zu hoch, Überschneidung …). */
  readonly befunde: readonly string[];
}

export interface Ansichtsabschnitt {
  readonly links: number;
  readonly rechts: number;
  /** Andere Räume auf diesem Wandstück (sortiert). */
  readonly nachbarn: readonly string[];
  readonly mehrdeutig: boolean;
}

export interface Wandmodell {
  readonly oeffnungen: readonly AnsichtsOeffnung[];
  readonly abschnitte: readonly Ansichtsabschnitt[];
}

const BEFUND_TEXT: Record<string, string> = {
  "opening-exceeds-wall": "ragt über die Wand hinaus",
  "opening-offset-negative": "beginnt vor der Wand",
  "opening-width-not-positive": "hat keine Breite",
  "openings-overlap": "überschneidet eine andere Öffnung",
  "opening-exceeds-room-height": "ist höher als der Raum",
  "window-needs-sill": "Fenster ohne Brüstung",
  "sill-only-for-window": "Brüstung ist nur beim Fenster möglich",
  "opening-height-not-positive": "hat keine Höhe",
  "opening-too-small": "ist schmaler oder niedriger als 10 cm",
  "konflikt-mehrdeutig": "Raumverbindung nicht eindeutig (mehr als zwei Räume)",
  "konflikt-grenze": "reicht über die Grenze zweier Nachbarräume",
  "konflikt-teilweise": "liegt nur teilweise auf der gemeinsamen Wand",
  "konflikt-widerspruch": "widerspricht einer auf der Gegenseite erfassten Öffnung",
  "konflikt-art": "auf der Gegenseite als andere Art erfasst",
};

export function befundText(code: string): string {
  return BEFUND_TEXT[code] ?? code;
}

/** Kurzname einer Öffnung für Hilfslinien und Fangziele: „Fenster 2“. */
export function oeffnungsName(o: Pick<AnsichtsOeffnung, "art">, nummer: number): string {
  return `${OEFFNUNGSART_LABEL[o.art]} ${nummer}`;
}

/**
 * Baut das Modell einer Wand. `wand` ist die gespeicherte bzw. entworfene
 * Wand des betrachteten Raums, `raumhoeheMm` dessen effektive Höhe.
 */
export function wandmodell(
  bezug: Wandbezug,
  wand: EntwurfWand,
  topologie: EditorTopologie,
  einordnung: EditorEinordnung,
): Wandmodell {
  const L = bezug.laengeMm;
  const spannen = wand.openings.map((o) => ({ key: o.id, abstand: o.offset_mm, breite: o.width_mm }));
  const eigene: AnsichtsOeffnung[] = wand.openings.map((o) => {
    const codes = [
      ...oeffnungsBefunde({ key: o.id, abstand: o.offset_mm, breite: o.width_mm }, L, spannen),
      ...oeffnungsHoehenBefunde(o.id, o.kind, o.height_mm, o.sill_height_mm, bezug.hoeheMm),
    ].map((b) => b.code);
    if (o.width_mm < MIN_OEFFNUNG_MM || o.height_mm < MIN_OEFFNUNG_MM) codes.push("opening-too-small");
    const e = einordnung.get(o.id);
    if (e?.klasse === "konflikt") codes.push(`konflikt-${e.grund ?? "unbekannt"}`);
    return {
      ...rechteckInAnsicht(bezug, o),
      id: o.id,
      art: o.kind,
      offsetMm: o.offset_mm,
      breiteMm: o.width_mm,
      hoeheMm: o.height_mm,
      bruestungMm: o.sill_height_mm,
      eigen: true,
      quelleRaumId: bezug.raumId,
      quelleWandId: wand.id,
      befunde: [...new Set(codes)],
    };
  });

  const teilung = topologie.teilung.get(wand.id);
  const abgeleitete: AnsichtsOeffnung[] = [];
  const abschnitte: Ansichtsabschnitt[] = [];
  if (teilung !== undefined) {
    for (const f of fremdeBereiche(teilung)) {
      const quelle = topologie.teilung.get(f.wandId)?.wand.oeffnungen.find((o) => o.oeffnungId === f.oeffnungId);
      if (quelle === undefined) continue;
      // Auf schrägen Wänden kann eine Grenze irrational sein - nur für die
      // Anzeige in Gleitkomma; gespeichert wird hier nichts.
      const a = punktInAnsicht(bezug, alsZahl(f.bereich.s0, teilung.mass));
      const b = punktInAnsicht(bezug, alsZahl(f.bereich.s1, teilung.mass));
      const e = einordnung.get(f.oeffnungId);
      abgeleitete.push({
        id: f.oeffnungId,
        art: quelle.art,
        links: Math.min(a, b),
        rechts: Math.max(a, b),
        unten: quelle.bruestungMm,
        oben: quelle.bruestungMm + quelle.hoeheMm,
        offsetMm: quelle.offsetMm,
        breiteMm: quelle.breiteMm,
        hoeheMm: quelle.hoeheMm,
        bruestungMm: quelle.bruestungMm,
        eigen: false,
        quelleRaumId: f.raumId,
        quelleWandId: f.wandId,
        befunde: e?.klasse === "konflikt" ? [`konflikt-${e.grund ?? "unbekannt"}`] : [],
      });
    }
    teilung.abschnitte.forEach((abschnitt, i) => {
      const a = punktInAnsicht(bezug, alsZahl(teilung.grenzen[i] ?? { ganz: 0, stufen: 0 }, teilung.mass));
      const b = punktInAnsicht(bezug, alsZahl(teilung.grenzen[i + 1] ?? { ganz: L, stufen: 0 }, teilung.mass));
      abschnitte.push({
        links: Math.min(a, b),
        rechts: Math.max(a, b),
        nachbarn: abschnitt.raumIds.filter((r) => r !== bezug.raumId),
        mehrdeutig: abschnitt.mehrdeutig,
      });
    });
  }
  abschnitte.sort((x, y) => x.links - y.links);
  const oeffnungen = [...eigene, ...abgeleitete].sort((x, y) => x.links - y.links || (x.id < y.id ? -1 : 1));
  return { oeffnungen, abschnitte };
}

/** Grenzen einer Öffnungsgröße - wie `MIN_OPENING_SIZE_MM`/`MAX_OPENING_SIZE_MM`. */
export const GROESSE = { min: MIN_OEFFNUNG_MM, max: MAX_OEFFNUNG_MM } as const;
