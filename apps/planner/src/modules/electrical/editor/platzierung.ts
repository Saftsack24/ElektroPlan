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

/** Ergebnis der Raumseitenwahl: eine Wand - oder ein verständlicher Grund. */
export type Raumwandtreffer = { readonly ok: true; readonly treffer: Wandtreffer } | { readonly ok: false; readonly grund: string };

/**
 * Die Wand **der angeklickten Raumseite** (Phase 4f): Liegen Wände mehrerer
 * Räume übereinander (gemeinsame Wand), entscheidet, auf welcher Seite der
 * Wandlinie der Zeiger steht - also in welchem Raum. Die Innenseite einer Wand
 * folgt aus dem Umlaufsinn ihres Raums (gegen den Uhrzeigersinn: links der
 * Wandrichtung). Steht der Zeiger genau auf der Linie oder außerhalb beider
 * Räume, wird nichts geraten: Dann gilt der bearbeitete Raum, sonst ein Grund.
 */
export function raumwandUnterZeiger(
  topologie: EditorTopologie,
  welt: Punkt,
  radiusMm: number,
  raeume: readonly Raumwaende[],
  aktiverRaum: string | null,
): Raumwandtreffer | null {
  const kandidaten: { treffer: Wandtreffer; abstand: number; innen: boolean }[] = [];
  const innenLinks = new Map(
    raeume.map((r) => [r.id, doppelteFlaecheVon(r.walls) > 0] as const),
  );
  for (const teilung of topologie.teilung.values()) {
    const w = teilung.wand;
    const abstand = abstandZurStrecke(welt, w.start, w.ende);
    if (abstand > w.staerkeMm / 2 + radiusMm) continue;
    const kreuz = (w.ende.x - w.start.x) * (welt.y - w.start.y) - (w.ende.y - w.start.y) * (welt.x - w.start.x);
    const links = innenLinks.get(w.raumId) ?? true;
    const innen = links ? kreuz > 0 : kreuz < 0;
    kandidaten.push({ treffer: { raumId: w.raumId, wandId: w.id }, abstand, innen });
  }
  if (kandidaten.length === 0) return null;
  const naechste = (liste: typeof kandidaten) =>
    [...liste].sort((a, b) => a.abstand - b.abstand || (a.treffer.wandId < b.treffer.wandId ? -1 : 1))[0]?.treffer;
  const raumIds = new Set(kandidaten.map((k) => k.treffer.raumId));
  if (raumIds.size === 1) return { ok: true, treffer: naechste(kandidaten) as Wandtreffer };
  const innen = kandidaten.filter((k) => k.innen);
  if (new Set(innen.map((k) => k.treffer.raumId)).size === 1) return { ok: true, treffer: naechste(innen) as Wandtreffer };
  const aktiv = kandidaten.filter((k) => k.treffer.raumId === aktiverRaum);
  if (aktiv.length > 0) return { ok: true, treffer: naechste(aktiv) as Wandtreffer };
  return { ok: false, grund: "Hier liegen Wände mehrerer Räume übereinander. Bitte etwas weiter in den gewünschten Raum klicken." };
}

function doppelteFlaecheVon(walls: Raumentwurf["walls"]): number {
  return walls.reduce((s, w) => s + (w.x1_mm * w.y2_mm - w.x2_mm * w.y1_mm), 0);
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
  readonly ohneOeffnungId?: string | undefined;
  readonly laengeText: (mm: number) => string;
  readonly raumName: (raumId: string) => string;
  /**
   * Wie eine vorhandene Öffnung in Meldungen benannt wird. Standard: Abstand
   * ab Wandanfang („bei 100 cm“) wie im Grundriss; die Wandansicht nennt die
   * Lage in ihrem eigenen Bezug („211,5 cm von links“).
   */
  readonly lageText?: ((offsetMm: number, breiteMm: number) => string) | undefined;
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

  // 4.-5. Einordnung und Überlappung - dieselbe Prüfung wie in der Wandansicht.
  const pruefung = bereichPruefen(teilung, offsetMm, breiteMm, optionen);
  if (!pruefung.ok) return { ok: false, ...basis, offsetMm, grund: pruefung.grund };
  return { ok: true, ...basis, offsetMm, klasse: pruefung.klasse, nachbarRaumId: pruefung.nachbarRaumId, abschnitt: pruefung.abschnitt };
}

export type Bereichspruefung =
  | {
      readonly ok: true;
      readonly klasse: "gemeinsam" | "aussen";
      readonly nachbarRaumId: string | null;
      readonly abschnitt: Wandabschnitt<EditorWand>;
    }
  | { readonly ok: false; readonly grund: string };

/**
 * Darf eine Öffnung den waagerechten Bereich `[offset, offset + breite]` ihrer
 * Wand einnehmen? Dieselbe Regel für Platzieren und Verschieben im
 * Grundriss und in der Wandansicht (Phase 4f):
 *
 * 1. vollständig in der Wand (gerundete Länge),
 * 2. eindeutige Raumverbindung - exakt wie bei gespeicherten Öffnungen,
 * 3. keine Überlappung mit Öffnungen dieser Wand,
 * 4. keine Überlappung mit Öffnungen, die ein Nachbarraum auf derselben
 *    Wand gespeichert hat.
 *
 * Berührung an einer Kante ist erlaubt - wie beim Server.
 */
export function bereichPruefen(
  teilung: Wandteilung<EditorWand>,
  offsetMm: number,
  breiteMm: number,
  optionen: Pick<Platzierungsoptionen, "ohneOeffnungId" | "laengeText" | "raumName" | "lageText">,
): Bereichspruefung {
  const { wand, mass } = teilung;
  const { laengeText: mm, raumName } = optionen;
  if (!Number.isSafeInteger(offsetMm) || !Number.isSafeInteger(breiteMm) || breiteMm <= 0) {
    return { ok: false, grund: "Lage und Breite müssen ganze Millimeter sein." };
  }
  if (offsetMm < 0 || offsetMm + breiteMm > teilung.laengeMm) {
    return { ok: false, grund: `Die Öffnung muss vollständig in der Wand (${mm(teilung.laengeMm)}) liegen.` };
  }
  const e = bereichEinordnen(teilung, offsetMm, breiteMm);
  if (e.klasse === "konflikt" || e.klasse === "ungueltig") {
    const grund =
      e.grund === "mehrdeutig"
        ? `Hier liegen Wände von mehr als zwei Räumen (${e.raumIds.map((r) => `„${raumName(r)}“`).join(", ")}). Eine Raumverbindung wäre nicht eindeutig - bitte an anderer Stelle setzen.`
        : e.grund === "teilweise"
          ? "Die Öffnung läge nur teilweise auf der gemeinsamen Wand - bitte ganz auf das gemeinsame oder ganz auf das nicht geteilte Wandstück setzen."
          : e.grund === "grenze"
            ? "Die Öffnung reichte über die Grenze zweier Nachbarräume - bitte etwas verschieben."
            : "An dieser Stelle ist die Raumverbindung nicht eindeutig - bitte etwas verschieben.";
    return { ok: false, grund };
  }

  const ende = offsetMm + breiteMm;
  const eigene = wand.oeffnungen.find(
    (o) => o.oeffnungId !== optionen.ohneOeffnungId && offsetMm < o.offsetMm + o.breiteMm && o.offsetMm < ende,
  );
  if (eigene !== undefined) {
    const lage = optionen.lageText?.(eigene.offsetMm, eigene.breiteMm) ?? `bei ${mm(eigene.offsetMm)}`;
    return { ok: false, grund: `Überschneidet sich mit ${VORHANDEN[eigene.art]} ${lage}.` };
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
      grund: `Überschneidet sich mit einer Öffnung, die in „${raumName(fremde.raumId)}“ an dieser Wand gespeichert ist.`,
    };
  }
  return { ok: true, klasse: e.klasse, nachbarRaumId: e.nachbarRaumId, abschnitt: e.abschnitte[0] as Wandabschnitt<EditorWand> };
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
