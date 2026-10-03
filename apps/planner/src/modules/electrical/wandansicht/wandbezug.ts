/**
 * Wandansicht: Blickrichtung und Maßbezug - die **eine** Transformation
 * zwischen gespeicherter Lage und angezeigter Wand (Phase 4f, ADR 0022).
 *
 * Gespeichert ist eine Öffnung als Abstand `offset_mm` vom **Anfang der
 * gerichteten Wand** (ADR 0013), Breite, Höhe und Brüstung. Die Richtung einer
 * Wand ist aber eine Folge des Umlaufsinns der Raumkontur - für einen
 * Handwerker bedeutungslos. Die Wandansicht zeigt die Wand deshalb immer so,
 * wie man sie **aus dem Raum heraus** sieht: Man steht im Raum und blickt auf
 * die Wand.
 *
 * **Links und rechts** folgen allein aus dieser Blickrichtung:
 *
 * * Läuft die Kontur gegen den Uhrzeigersinn (positive Fläche), liegt das
 *   Rauminnere links der Wandrichtung. Wer davor steht und auf die Wand
 *   blickt, hat das **Wandende links** und den Wandanfang rechts.
 * * Läuft sie im Uhrzeigersinn, ist es umgekehrt: **Wandanfang links**.
 *
 * Damit ist die Ansicht unabhängig davon, in welche Richtung die Wand
 * gespeichert ist - eine umgekehrte Kontur (`konturUmkehren`) ändert die
 * gespeicherten Abstände, nicht das Bild.
 *
 * **Koordinaten der Ansicht** (ganze Millimeter):
 *
 * | Größe | Bedeutung |
 * |---|---|
 * | `u` | waagerechter Abstand von der **linken** Wandkante der Ansicht |
 * | `h` | Höhe über Fertigfußboden (FFB) |
 *
 * Für einen Bereich `[offset, offset + breite]` gilt
 *
 *     links  = anfangLinks ? offset : L − offset − breite
 *     offset = anfangLinks ? links  : L − links  − breite
 *
 * mit der kaufmännisch gerundeten Wandlänge `L` (ADR 0013). Beide Richtungen
 * sind dieselbe Formel - ganzzahlig und ohne Rundung, also verlustfrei.
 * Die Bildschirmposition entsteht wie im Grundriss über `editor/viewport.ts`
 * mit `x = u`, `y = h`.
 *
 * Die Blickrichtung braucht eine **geschlossene** Kontur: Nur dann ist innen
 * und außen eindeutig. Für eine offene Kontur gibt es keine Wandansicht.
 *
 * **Wandseite** (Nachtrag 4f): Eine Wand hat zwei Seiten - die Innenseite
 * des Raums und die Außenseite (Fassade oder Nachbarraum). Später werden innen
 * etwa Steckdosen, außen Fassadenleuchten gesetzt. Die Seite ist ein reiner
 * **Ansichtskontext**: Von außen betrachtet steht man vor der Wand mit dem
 * Rücken zum Raum - links und rechts sind gegenüber innen vertauscht, die
 * Blickrichtung kehrt sich um. Gespeichert bleibt dieselbe Wand mit denselben
 * Öffnungen; ein Seitenwechsel ändert keinen Wert. Keine physische
 * Wandidentität, kein Geräteobjektmodell.
 */
import type { EntwurfWand } from "../editor/entwurf";
import { ende, segmenteAus, start } from "../editor/entwurf";
import { doppelteFlaeche, konturbericht, streckenlaenge } from "../editor/geometrie";

export type Umlauf = "gegen-uhrzeigersinn" | "im-uhrzeigersinn";

/** Von welcher Seite die Wand betrachtet und später bestückt wird. */
export type Wandseite = "innen" | "aussen";

export interface Wandbezug {
  readonly raumId: string;
  readonly wandId: string;
  /** Position der Wand in der Kontur, ab 1 - wie „Wand n“ im Grundriss. */
  readonly wandNummer: number;
  /** Kaufmännisch gerundete Wandlänge in mm (ADR 0013). */
  readonly laengeMm: number;
  /** Effektive Raumhöhe in mm - Höhe der Wand (ADR 0016, T8). */
  readonly hoeheMm: number;
  readonly staerkeMm: number;
  /** Betrachtete Seite: Innenseite des Raums oder Außenseite. */
  readonly seite: Wandseite;
  /** Liegt der gespeicherte Wandanfang links in der Ansicht? */
  readonly anfangLinks: boolean;
  /** Blickrichtung im Grundriss - verständliche Orientierung. */
  readonly blick: string;
  /** Nummer der Wand, die an der linken bzw. rechten Kante anschließt. */
  readonly nachbarLinks: number | null;
  readonly nachbarRechts: number | null;
}

export type Bezugsergebnis = { readonly ok: true; readonly bezug: Wandbezug } | { readonly ok: false; readonly grund: string };

/** Umlaufsinn einer geschlossenen Kontur - `null`, wenn sie nicht geschlossen ist. */
export function umlaufsinn(walls: readonly EntwurfWand[]): Umlauf | null {
  if (konturbericht(segmenteAus(walls)).status !== "valid") return null;
  const flaeche = doppelteFlaeche(walls.map(start));
  return flaeche > 0 ? "gegen-uhrzeigersinn" : "im-uhrzeigersinn";
}

const RICHTUNGEN = ["rechts", "oben rechts", "oben", "oben links", "links", "unten links", "unten", "unten rechts"] as const;

/** Achtelrichtung eines Vektors im Grundriss (y nach oben) als Text. */
export function richtungstext(dx: number, dy: number): string {
  const winkel = Math.atan2(dy, dx);
  const index = ((Math.round(winkel / (Math.PI / 4)) % 8) + 8) % 8;
  return `nach ${RICHTUNGEN[index]}`;
}

/**
 * Bezug einer Wand aus Sicht ihres Raums. `walls` ist die vollständige,
 * geordnete Kontur des Raums (Entwurf oder Serverstand).
 */
export function wandbezug(
  raumId: string,
  walls: readonly EntwurfWand[],
  wandId: string,
  raumhoeheMm: number,
  seite: Wandseite = "innen",
): Bezugsergebnis {
  const index = walls.findIndex((w) => w.id === wandId);
  const wand = walls[index];
  if (wand === undefined) {
    return { ok: false, grund: "Diese Wand gibt es im aktuellen Stand des Raums nicht (mehr) – etwa nach „Rückgängig“." };
  }
  const umlauf = umlaufsinn(walls);
  if (umlauf === null) {
    return {
      ok: false,
      grund: "Die Raumkontur ist nicht geschlossen. Erst mit geschlossener Kontur ist eindeutig, welche Seite der Wand innen liegt.",
    };
  }
  const innenAnfangLinks = umlauf === "im-uhrzeigersinn";
  // Von außen ist alles gespiegelt: Blick zum Raum hin, links und rechts vertauscht.
  const anfangLinks = seite === "innen" ? innenAnfangLinks : !innenAnfangLinks;
  const dx = wand.x2_mm - wand.x1_mm;
  const dy = wand.y2_mm - wand.y1_mm;
  // Blick vom Rauminneren auf die Wand = nach außen: rechts der Wandrichtung
  // bei gegen den Uhrzeigersinn, links davon im Uhrzeigersinn. Von außen umgekehrt.
  const blick = anfangLinks ? richtungstext(-dy, dx) : richtungstext(dy, -dx);
  const n = walls.length;
  const vorher = ((index - 1 + n) % n) + 1;
  const nachher = ((index + 1) % n) + 1;
  return {
    ok: true,
    bezug: {
      raumId,
      wandId,
      wandNummer: index + 1,
      laengeMm: streckenlaenge(start(wand), ende(wand)),
      hoeheMm: raumhoeheMm,
      staerkeMm: wand.thickness_mm,
      seite,
      anfangLinks,
      blick,
      // An der Kante mit dem Wandanfang schließt die Vorgängerin an.
      nachbarLinks: anfangLinks ? vorher : nachher,
      nachbarRechts: anfangLinks ? nachher : vorher,
    },
  };
}

// ------------------------------------------------------------ Transformation

/** Waagerechter Bereich in der Ansicht: linke und rechte Kante, ab linker Wandkante. */
export interface Ansichtsbereich {
  readonly links: number;
  readonly rechts: number;
}

/** Gespeicherter Bereich `[offset, offset + breite]` → Ansicht. */
export function inAnsicht(bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm">, offsetMm: number, breiteMm: number): Ansichtsbereich {
  const links = bezug.anfangLinks ? offsetMm : bezug.laengeMm - offsetMm - breiteMm;
  return { links: links + 0, rechts: links + breiteMm + 0 };
}

/** Linke Kante in der Ansicht → gespeicherter Abstand vom Wandanfang. */
export function ausAnsicht(bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm">, linksMm: number, breiteMm: number): number {
  return (bezug.anfangLinks ? linksMm : bezug.laengeMm - linksMm - breiteMm) + 0;
}

/**
 * Ein Punkt entlang der Wand (Abstand vom Wandanfang, auch gebrochen - etwa
 * eine Abschnittsgrenze auf einer schrägen Wand) → `u` in der Ansicht.
 * Dieselbe Formel ist ihre eigene Umkehrung.
 */
export function punktInAnsicht(bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm">, abstandMm: number): number {
  return bezug.anfangLinks ? abstandMm : bezug.laengeMm - abstandMm;
}

/** Vollständiges Rechteck einer Öffnung in der Ansicht. */
export interface Ansichtsrechteck extends Ansichtsbereich {
  /** Unterkante = Brüstung über FFB. */
  readonly unten: number;
  /** Oberkante über FFB. */
  readonly oben: number;
}

export function rechteckInAnsicht(
  bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm">,
  o: { offset_mm: number; width_mm: number; height_mm: number; sill_height_mm: number },
): Ansichtsrechteck {
  return { ...inAnsicht(bezug, o.offset_mm, o.width_mm), unten: o.sill_height_mm, oben: o.sill_height_mm + o.height_mm };
}

/** Rechteck der Ansicht → gespeicherte Werte (ganze Millimeter). */
export function rechteckAusAnsicht(
  bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm">,
  r: Ansichtsrechteck,
): { offset_mm: number; width_mm: number; height_mm: number; sill_height_mm: number } {
  const breite = r.rechts - r.links;
  return { offset_mm: ausAnsicht(bezug, r.links, breite), width_mm: breite, height_mm: r.oben - r.unten, sill_height_mm: r.unten };
}
