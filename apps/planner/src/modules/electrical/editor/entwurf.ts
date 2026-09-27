/**
 * Der lokale Entwurf eines Raums - und seine Übersetzung von und zur API.
 *
 * Der Entwurf ist **keine zweite Geometriedatenhaltung**: Er entsteht immer aus
 * dem zuletzt geladenen Serverstand (`GET …/floors/{id}/plan`), lebt nur bis
 * zum Speichern und wird danach durch die Serverantwort ersetzt. Er enthält
 * ausschließlich das, was `PUT /rooms/{id}/contour` als Zielzustand erwartet.
 *
 * Feldnamen folgen bewusst der API (`x1_mm`, `offset_mm` …): Die Umwandlung
 * in den Anfragekörper ist dann eine reine Kopie, und der generierte Typ
 * `RoomContourUpdate` prüft sie zur Übersetzungszeit.
 */
import type { components } from "@elektroplan/api-client";

import type { Punkt, Segment } from "./geometrie";

type Schemas = components["schemas"];
export type RaumImPlan = Schemas["RoomPlanOut"];
export type Geschossplan = Schemas["FloorPlanOut"];
export type Konturanfrage = Schemas["RoomContourUpdate"];
export type Oeffnungsart = Schemas["ContourOpeningIn"]["kind"];

export interface EntwurfOeffnung {
  readonly id: string;
  readonly kind: Oeffnungsart;
  readonly offset_mm: number;
  readonly width_mm: number;
  readonly height_mm: number;
  readonly sill_height_mm: number;
}

export interface EntwurfWand {
  readonly id: string;
  readonly x1_mm: number;
  readonly y1_mm: number;
  readonly x2_mm: number;
  readonly y2_mm: number;
  readonly thickness_mm: number;
  readonly openings: readonly EntwurfOeffnung[];
}

export interface Raumentwurf {
  readonly roomId: string;
  readonly walls: readonly EntwurfWand[];
  /** Öffnungen des Serverstands, die ausdrücklich entfernt wurden. */
  readonly entfernteOeffnungen: readonly string[];
}

/** Der gespeicherte Stand des aktiven Raums, wie ihn der Server geliefert hat. */
export interface Raumbasis {
  readonly raum: RaumImPlan;
  readonly entwurf: Raumentwurf;
}

/** Übliche Innenwand - nur ein Startwert (wie `DEFAULT_WALL_THICKNESS_MM`). */
export const STANDARD_WANDSTAERKE_MM = 115;

export function basisAus(raum: RaumImPlan): Raumbasis {
  return {
    raum,
    entwurf: {
      roomId: raum.id,
      entfernteOeffnungen: [],
      walls: raum.walls.map((wand) => ({
        id: wand.id,
        x1_mm: wand.x1_mm,
        y1_mm: wand.y1_mm,
        x2_mm: wand.x2_mm,
        y2_mm: wand.y2_mm,
        thickness_mm: wand.thickness_mm,
        openings: wand.openings.map((oeffnung) => ({
          id: oeffnung.id,
          kind: oeffnung.kind,
          offset_mm: oeffnung.offset_mm,
          width_mm: oeffnung.width_mm,
          height_mm: oeffnung.height_mm,
          sill_height_mm: oeffnung.sill_height_mm,
        })),
      })),
    },
  };
}

/** Der Zielzustand als Anfragekörper - vollständig, in Konturreihenfolge. */
export function alsKonturanfrage(entwurf: Raumentwurf): Konturanfrage {
  return {
    walls: entwurf.walls.map((wand) => ({
      id: wand.id,
      x1_mm: wand.x1_mm,
      y1_mm: wand.y1_mm,
      x2_mm: wand.x2_mm,
      y2_mm: wand.y2_mm,
      thickness_mm: wand.thickness_mm,
      openings: wand.openings.map((oeffnung) => ({ ...oeffnung })),
    })),
    removed_opening_ids: [...entwurf.entfernteOeffnungen],
  };
}

/** Gleicher fachlicher Stand? Reihenfolge und alle Werte zählen. */
export function gleicherStand(a: Raumentwurf, b: Raumentwurf): boolean {
  return JSON.stringify(alsKonturanfrage(a)) === JSON.stringify(alsKonturanfrage(b));
}

export function start(wand: EntwurfWand): Punkt {
  return { x: wand.x1_mm, y: wand.y1_mm };
}

export function ende(wand: EntwurfWand): Punkt {
  return { x: wand.x2_mm, y: wand.y2_mm };
}

export function segmenteAus(walls: readonly EntwurfWand[]): Segment[] {
  return walls.map((wand) => ({ key: wand.id, start: start(wand), ende: ende(wand) }));
}

/** Neue, clientseitig erzeugte UUID (ADR 0007, docs/offline-sync.md). */
export function neueId(): string {
  return crypto.randomUUID();
}
