/**
 * Öffnungen direkt mit der Maus platzieren und verschieben (Phase 4b.2) -
 * reine Funktionen, ohne DOM.
 *
 * Die Zeigerposition wird auf die Wand projiziert; die **Mitte** der Öffnung
 * folgt ihr, gefangen auf 50 mm ab Wandanfang. Die Öffnung bleibt dabei
 * vollständig in dem atomaren Wandabschnitt, über dem der Zeiger steht
 * (`topologie/wandtopologie.ts`): Sie liegt also ganz auf dem gemeinsamen
 * Stück zweier Räume oder ganz auf einem nicht geteilten Stück - nie halb
 * darüber. Ob sie zwei Räume verbindet, entscheidet dieselbe exakte Regel
 * wie für gespeicherte Öffnungen (`bereichEinordnen`).
 *
 * Gespeichert wird nichts: Das Ergebnis ist ein Abstand in ganzen
 * Millimetern für den lokalen Entwurf. Die Serverprüfung bleibt verbindlich.
 */
import type { Oeffnungsart, Raumentwurf } from "./entwurf";
import { OEFFNUNG_STANDARD, projektion } from "./werkzeuge";
import type { Punkt } from "./geometrie";
import { alsZahl, abgerundet, aufgerundet, ganzeLage, vergleichen } from "../topologie/lage";
import type { Oeffnungseinordnung } from "../topologie/oeffnungen";
import { bereichEinordnen, fremdeBereiche, oeffnungenEinordnen } from "../topologie/oeffnungen";
import type { TopoWand, Wandabschnitt, Wandteilung, Wandtopologie } from "../topologie/wandtopologie";
import { wandtopologie } from "../topologie/wandtopologie";
import { OEFFNUNGSART_LABEL } from "../texte";

/** Dativ mit Artikel - „mit der vorhandenen Tür", „mit dem vorhandenen Fenster". */
const VORHANDEN: Record<Oeffnungsart, string> = {
  door: "der vorhandenen Tür",
  window: "dem vorhandenen Fenster",
  passage: "dem vorhandenen Durchgang",
};

/** Standardfang für Öffnungen: 5 cm. Unabhängig vom Zeichenraster. */
export const OEFFNUNG_FANG_MM = 50;

// ----------------------------------------------------------- Topologie

/** Wand im Editor: Topologie plus Stärke für die Darstellung. */
export interface EditorWand extends TopoWand {
  readonly staerkeMm: number;
}

export type EditorTopologie = Wandtopologie<EditorWand>;
export type EditorEinordnung = ReadonlyMap<string, Oeffnungseinordnung<EditorWand>>;

interface Raumwaende {
  readonly id: string;
  readonly walls: Raumentwurf["walls"];
}

/**
 * Topologie des gezeigten Geschosses: aktiver Raum aus dem Entwurf, alle
 * anderen aus dem Serverstand - dieselbe Ableitung wie in der 3D-Ansicht.
 */
export function editorTopologie(floorId: string, raeume: readonly Raumwaende[]): EditorTopologie {
  return wandtopologie(
    floorId,
    raeume.flatMap((raum) =>
      raum.walls.map((w) => ({
        id: w.id,
        raumId: raum.id,
        start: { x: w.x1_mm, y: w.y1_mm },
        ende: { x: w.x2_mm, y: w.y2_mm },
        staerkeMm: w.thickness_mm,
        oeffnungen: w.openings.map((o) => ({
          oeffnungId: o.id,
          art: o.kind,
          offsetMm: o.offset_mm,
          breiteMm: o.width_mm,
          hoeheMm: o.height_mm,
          bruestungMm: o.sill_height_mm,
        })),
      })),
    ),
  );
}

export function editorEinordnung(topologie: EditorTopologie): EditorEinordnung {
  return oeffnungenEinordnen(topologie);
}

// ------------------------------------------------------- Wand unter Zeiger

export interface Wandtreffer {
  readonly raumId: string;
  readonly wandId: string;
}

/** Abstand eines Punkts zu einer Strecke (Gleitkomma - nur Zeigereingabe). */
function abstandZurStrecke(p: Punkt, a: Punkt, b: Punkt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Die Wand unter dem Zeiger: innerhalb der halben Wandstärke plus `radiusMm`.
 * Liegen mehrere Wände übereinander (gemeinsame Wand zweier Räume), gewinnt
 * die des aktiven Raums - so bleibt eine neue Tür im bearbeiteten Raum, und
 * ihr Nachbar wird abgeleitet. Sonst die nächste, bei Gleichstand die erste.
 */
export function wandUnterZeiger(
  topologie: EditorTopologie,
  welt: Punkt,
  radiusMm: number,
  aktiverRaum: string | null,
): Wandtreffer | null {
  let bester: { treffer: Wandtreffer; abstand: number; aktiv: boolean } | null = null;
  for (const teilung of topologie.teilung.values()) {
    const w = teilung.wand;
    const abstand = abstandZurStrecke(welt, w.start, w.ende);
    if (abstand > w.staerkeMm / 2 + radiusMm) continue;
    const aktiv = w.raumId === aktiverRaum;
    const besser =
      bester === null ||
      (aktiv && !bester.aktiv) ||
      (aktiv === bester.aktiv && abstand < bester.abstand);
    if (besser) bester = { treffer: { raumId: w.raumId, wandId: w.id }, abstand, aktiv };
  }
  return bester?.treffer ?? null;
}

// ------------------------------------------------------------ Platzierung

export type Platzierung =
  | {
      readonly ok: true;
      readonly raumId: string;
      readonly wandId: string;
      readonly offsetMm: number;
      readonly breiteMm: number;
      readonly klasse: "gemeinsam" | "aussen";
      readonly nachbarRaumId: string | null;
      readonly abschnitt: Wandabschnitt<EditorWand>;
    }
  | {
      readonly ok: false;
      readonly raumId: string;
      readonly wandId: string;
      /** Gezeigte (rote) Lage, falls es eine gibt. */
      readonly offsetMm: number | null;
      readonly breiteMm: number;
      readonly grund: string;
    };

export interface Platzierungsoptionen {
  readonly breiteMm: number;
  /** Fangschritt in mm; 1 bedeutet: ganze Millimeter, kein Fang. */
  readonly fangMm: number;
  /** Beim Verschieben: die bewegte Öffnung selbst. */
  readonly ohneOeffnungId?: string;
  readonly laengeText: (mm: number) => string;
  readonly raumName: (raumId: string) => string;
}

/**
 * Lage einer Öffnung, deren Mitte über dem Zeiger liegt. Liefert entweder
 * einen gültigen ganzzahligen Abstand samt abgeleiteter Raumverbindung oder
 * eine deutsche Begründung, warum hier nichts gesetzt werden kann.
 */
export function platzierungBerechnen(
  teilung: Wandteilung<EditorWand>,
  zeiger: Punkt,
  optionen: Platzierungsoptionen,
): Platzierung {
  const { wand, grenzen, abschnitte, mass } = teilung;
  const { breiteMm, laengeText: mm, raumName } = optionen;
  const basis = { raumId: wand.raumId, wandId: wand.id, breiteMm };
  if (breiteMm > teilung.laengeMm) {
    return { ok: false, ...basis, offsetMm: null, grund: `Die Öffnung (${mm(breiteMm)}) ist breiter als die Wand (${mm(teilung.laengeMm)}).` };
  }

  // 1. Abschnitt unter dem Zeiger (Zeigereingabe - Gleitkomma genügt).
  const entwurfswand = {
    x1_mm: wand.start.x,
    y1_mm: wand.start.y,
    x2_mm: wand.ende.x,
    y2_mm: wand.ende.y,
  };
  const p = projektion({ ...entwurfswand, id: wand.id, thickness_mm: wand.staerkeMm, openings: [] }, zeiger);
  let index = abschnitte.findIndex((_, i) => p <= alsZahl(grenzen[i + 1] as typeof grenzen[number], mass));
  if (index < 0) index = abschnitte.length - 1;
  const abschnitt = abschnitte[index] as Wandabschnitt<EditorWand>;

  // 2. Exakte, ganzzahlige Grenzen dieses Abschnitts auf der Wand.
  const unten = aufgerundet(grenzen[index] as typeof grenzen[number], mass);
  const oben = abgerundet(grenzen[index + 1] as typeof grenzen[number], mass);
  if (oben - unten < breiteMm) {
    const nachbar = abschnitt.raumIds.find((r) => r !== wand.raumId);
    const wo =
      abschnitt.lage === "gemeinsam" && nachbar !== undefined
        ? `in den gemeinsamen Abschnitt mit „${raumName(nachbar)}“`
        : "in dieses Wandstück";
    return { ok: false, ...basis, offsetMm: null, grund: `Die Öffnung (${mm(breiteMm)}) passt nicht ${wo} (${mm(oben - unten)}).` };
  }

  // 3. Mitte unter den Zeiger, auf den Fang ab Wandanfang, in den Abschnitt begrenzt.
  const roh = p - breiteMm / 2;
  const gefangen = optionen.fangMm > 1 ? Math.round(roh / optionen.fangMm) * optionen.fangMm : Math.round(roh);
  const offsetMm = Math.min(Math.max(gefangen, unten), oben - breiteMm) + 0;

  // 4. Dieselbe exakte Einordnung wie für gespeicherte Öffnungen.
  const e = bereichEinordnen(teilung, offsetMm, breiteMm);
  if (e.klasse === "konflikt" || e.klasse === "ungueltig") {
    const grund =
      e.grund === "mehrdeutig"
        ? `Hier liegen Wände von mehr als zwei Räumen (${e.raumIds.map((r) => `„${raumName(r)}“`).join(", ")}). Eine Raumverbindung wäre nicht eindeutig - bitte an anderer Stelle setzen.`
        : "An dieser Stelle ist die Raumverbindung nicht eindeutig - bitte etwas verschieben.";
    return { ok: false, ...basis, offsetMm, grund };
  }

  // 5. Keine Überlappung - weder mit Öffnungen dieser Wand noch mit solchen,
  //    die ein Nachbarraum auf derselben Wand gespeichert hat.
  const ende = offsetMm + breiteMm;
  const eigene = wand.oeffnungen.find(
    (o) => o.oeffnungId !== optionen.ohneOeffnungId && offsetMm < o.offsetMm + o.breiteMm && o.offsetMm < ende,
  );
  if (eigene !== undefined) {
    return {
      ok: false,
      ...basis,
      offsetMm,
      grund: `Überschneidet sich mit ${VORHANDEN[eigene.art]} bei ${mm(eigene.offsetMm)}.`,
    };
  }
  const fremde = fremdeBereiche(teilung).find(
    (f) =>
      f.oeffnungId !== optionen.ohneOeffnungId &&
      vergleichen(ganzeLage(offsetMm), f.bereich.s1, mass) < 0 &&
      vergleichen(f.bereich.s0, ganzeLage(ende), mass) < 0,
  );
  if (fremde !== undefined) {
    return {
      ok: false,
      ...basis,
      offsetMm,
      grund: `Überschneidet sich mit einer Öffnung, die in „${raumName(fremde.raumId)}“ an dieser Wand gespeichert ist.`,
    };
  }

  return {
    ok: true,
    ...basis,
    offsetMm,
    klasse: e.klasse,
    nachbarRaumId: e.nachbarRaumId,
    abschnitt: e.abschnitte[0] as Wandabschnitt<EditorWand>,
  };
}

/** Standardbreite einer neuen Öffnung dieser Art. */
export function standardbreite(art: Oeffnungsart): number {
  return OEFFNUNG_STANDARD[art].width_mm;
}

/** Verständlicher Text zur Vorschau - in der Anzeigeeinheit des Benutzers. */
export function platzierungsText(
  platzierung: Platzierung,
  art: Oeffnungsart,
  raumName: (raumId: string) => string,
  mm: (mm: number) => string,
): string {
  if (!platzierung.ok) return platzierung.grund;
  const lage =
    platzierung.klasse === "gemeinsam" && platzierung.nachbarRaumId !== null
      ? `verbindet „${raumName(platzierung.raumId)}“ und „${raumName(platzierung.nachbarRaumId)}“`
      : "nicht geteilte Wand – kein zweiter Raum";
  return `${OEFFNUNGSART_LABEL[art]} · ${lage} · Abstand ${mm(platzierung.offsetMm)}`;
}

/** Text zur abgeleiteten Raumverbindung einer gespeicherten Öffnung. */
export function verbindungsText(
  e: Oeffnungseinordnung<EditorWand> | undefined,
  raumName: (raumId: string) => string,
): string {
  if (e === undefined) return "";
  switch (e.klasse) {
    case "gemeinsam":
      return `Verbindet „${raumName(e.raumIds[0] ?? "")}“ und „${raumName(e.nachbarRaumId ?? "")}“`;
    case "aussen":
      return "An einer nicht geteilten Wand – kein zweiter Raum";
    case "ungueltig":
      return "Passt nicht in ihre Wand";
    case "konflikt":
      switch (e.grund) {
        case "mehrdeutig":
          return "Raumverbindung nicht eindeutig: Auf diesem Wandstück liegen mehr als zwei Räume.";
        case "grenze":
          return "Raumverbindung nicht eindeutig: Die Öffnung reicht über die Grenze zweier Nachbarräume.";
        case "teilweise":
          return "Raumverbindung nicht eindeutig: Die Öffnung liegt nur teilweise auf der gemeinsamen Wand.";
        case "art":
          return "Widerspruch: Auf der Gegenseite ist hier eine Öffnung anderer Art gespeichert.";
        default:
          return "Widerspruch: Auf der Gegenseite überlappt eine anders erfasste Öffnung.";
      }
  }
}
