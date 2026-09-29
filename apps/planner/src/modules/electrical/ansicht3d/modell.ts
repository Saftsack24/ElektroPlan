/**
 * Das abgeleitete Szenenmodell der 3D-Ansicht - nur Typen und Schlüssel.
 *
 * Es entsteht vollständig aus `GET …/floors/{id}/plan` (`szenenmodell.ts`),
 * ist unveränderlich und enthält ausschließlich **fachliche Millimeter**.
 * Erst die Geometrieschicht (`geometrien.ts`) rechnet über die hier
 * mitgeführte `Transformation` in Szenenmeter um. Nichts davon wird je
 * zurückgeschrieben (ADR 0016).
 */
import type { components } from "@elektroplan/api-client";

import type { Oeffnungsklasse } from "../topologie/oeffnungen";
import type { TopoOeffnung, TopoWand } from "../topologie/wandtopologie";
import type { GrenzenMm, Transformation } from "./transformation";
import type { Wandrechteck } from "./wandzerlegung";

type Schemas = components["schemas"];
export type Geschossplan = Schemas["FloorPlanOut"];
export type RaumImPlan = Schemas["RoomPlanOut"];
export type WandImPlan = Schemas["WallPlanOut"];
export type OeffnungImPlan = Schemas["OpeningOut"];
export type Oeffnungsart = OeffnungImPlan["kind"];

export interface PunktMm {
  readonly x: number;
  readonly y: number;
}

// ------------------------------------------------------------------ Auswahl

export type Objektart = "raum" | "wand" | "oeffnung";

/**
 * Kleine, fachliche Auswahlreferenz - das Einzige, was aus der Szene in den
 * React-State gelangt. Kein Three.js-Objekt.
 *
 * * Raum: die Raum-ID.
 * * Wand: die ID des atomaren Wandabschnitts (`topologie/wandtopologie.ts`) -
 *   die sortierten IDs der beteiligten logischen Wände, mit `+` verbunden,
 *   und nur bei einem Teilstück zusätzlich dessen Endpunkte (`a+b@0,0~3000,0`).
 * * Öffnung: die sortierten IDs der deckungsgleich erfassten Öffnungen -
 *   bei einer einmal gespeicherten Öffnung also einfach deren ID.
 */
export interface Auswahl {
  readonly art: Objektart;
  readonly id: string;
}

export function auswahlSchluessel(auswahl: Auswahl): string {
  return `${auswahl.art}:${auswahl.id}`;
}

export function gleicheAuswahl(a: Auswahl | null, b: Auswahl | null): boolean {
  return a === b || (a !== null && b !== null && a.art === b.art && a.id === b.id);
}

export { gruppenId } from "../topologie/wandtopologie";

// ------------------------------------------------------------ Bestandteile

export interface Raum3d {
  readonly id: string;
  readonly name: string;
  readonly nummer: string | null;
  /** `effective_height_mm` - nach T8 die Höhe aller Wände dieses Raums. */
  readonly hoeheMm: number;
  /** Vom Server berechnet (Dezimalstring), hier nur durchgereicht. */
  readonly flaecheM2: string | null;
  readonly wandanzahl: number;
  /** Eckpunkte in Konturreihenfolge (Startpunkte der Wände). */
  readonly kontur: readonly PunktMm[];
  /** Index in die ruhige Farbpalette der Böden. */
  readonly farbindex: number;
}

/** Eine Öffnung genau so, wie sie an ihrer Wand erfasst ist. */
export interface Oeffnungsquelle extends TopoOeffnung {
  readonly wandId: string;
  readonly raumId: string;
}

/** Gespeicherte, gerichtete Wand eines Raums (unverändert übernommen). */
export interface LogischeWand extends TopoWand {
  readonly staerkeMm: number;
  /** Nach T8: die effektive Höhe des eigenen Raums. */
  readonly raumhoeheMm: number;
  readonly oeffnungen: readonly Oeffnungsquelle[];
}

/**
 * Abgeleitete Lage eines Wandabschnitts (T8). Kein gespeicherter Wandtyp:
 * „gemeinsam" heißt, dass Wände anderer Räume exakt auf demselben Stück
 * derselben Geraden liegen, „aussen" heißt: nicht geteilt.
 */
export type Wandlage = "gemeinsam" | "aussen";

/**
 * Öffnung in der Darstellung - deckungsgleiche Erfassungen zusammengefasst.
 * Eine Öffnung, die (als Konflikt) über eine Abschnittsgrenze reicht,
 * erscheint in jedem berührten Wandkörper mit derselben ID.
 */
export interface Oeffnung3d {
  readonly id: string;
  /** ID der Darstellungswand (`Wand3d.id`). */
  readonly wandId: string;
  /** Art der zuerst erfassten Quelle; `arten` nennt alle. */
  readonly art: Oeffnungsart;
  readonly arten: readonly Oeffnungsart[];
  /** Rechteck in der kanonischen Richtung der Darstellungswand, auf sie beschnitten. */
  readonly rechteck: Wandrechteck;
  /** Gespeicherte Erfassungen; die erste ist die Eigentümerwand. */
  readonly quellen: readonly Oeffnungsquelle[];
  /** Abgeleitete Einordnung (`topologie/oeffnungen.ts`). */
  readonly klasse: Oeffnungsklasse;
  /** Verbundene Räume: bei `gemeinsam` Quellraum und Nachbar, sonst der Quellraum. */
  readonly raumIds: readonly string[];
}

/** Darstellungswand: ein atomarer Wandabschnitt mit seinen logischen Wänden. */
export interface Wand3d {
  readonly id: string;
  /** Kanonische Richtung: lexikografisch kleinerer Endpunkt zuerst. */
  readonly start: PunktMm;
  readonly ende: PunktMm;
  readonly laengeMm: number;
  /** Darstellungsstärke: größte beteiligte Wandstärke. */
  readonly staerkeMm: number;
  /** Darstellungshöhe: größte beteiligte Raumhöhe. */
  readonly hoeheMm: number;
  readonly lage: Wandlage;
  readonly raumIds: readonly string[];
  readonly quellen: readonly LogischeWand[];
  readonly oeffnungen: readonly Oeffnung3d[];
  /** Verbleibende Wandbereiche nach Abzug aller Aussparungen. */
  readonly teile: readonly Wandrechteck[];
  /**
   * Freie Enden werden um die halbe Stärke verlängert (Eckschluss). Setzt
   * sich die Gerade in einem weiteren Abschnitt fort, entfällt das - sonst
   * lägen dort zwei Körper übereinander und flimmerten.
   */
  readonly verlaengernAmStart: boolean;
  readonly verlaengernAmEnde: boolean;
}

// ---------------------------------------------------------------- Warnungen

export type Warnungscode =
  | "oeffnung-dublette"
  | "oeffnung-art-abweichend"
  | "oeffnung-widerspruechlich"
  | "oeffnung-ueberlappung"
  | "oeffnung-grenze"
  | "oeffnung-teilweise"
  | "oeffnung-mehrdeutig"
  | "oeffnung-ungueltig"
  | "wand-staerke-abweichend"
  | "wand-hoehe-abweichend"
  | "wand-mehrfach"
  | "wand-doppelt-im-raum"
  | "wand-ungueltig";

/**
 * Darstellungswarnung. Sie beschreibt einen Befund in den **gespeicherten**
 * Daten und die Darstellungsregel, die daraus folgt - sie bereinigt nichts.
 */
export interface Warnung {
  readonly id: string;
  readonly code: Warnungscode;
  readonly titel: string;
  readonly text: string;
  readonly bezug: readonly Auswahl[];
}

export interface AusgelassenerRaum {
  readonly id: string;
  readonly bezeichnung: string;
  readonly grund: string;
}

export interface Szenenmodell {
  readonly floorId: string | null;
  readonly transformation: Transformation;
  /** `null` bei einem Plan ohne darstellbaren Raum. */
  readonly grenzen: GrenzenMm | null;
  readonly hoeheMaxMm: number;
  readonly raumanzahlGesamt: number;
  readonly raeume: readonly Raum3d[];
  readonly waende: readonly Wand3d[];
  readonly oeffnungen: readonly Oeffnung3d[];
  readonly ausgelassen: readonly AusgelassenerRaum[];
  readonly warnungen: readonly Warnung[];
}

export function raumBezeichnung(raum: { name: string; nummer?: string | null }): string {
  return raum.nummer ? `${raum.nummer} ${raum.name}` : raum.name;
}
