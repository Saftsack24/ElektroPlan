import type { components } from "@elektroplan/api-client";

import type { Halt, Versatzart } from "./verlauf";

type RiserOut = components["schemas"]["RiserOut"];
type RiserCreate = components["schemas"]["RiserCreate"];

/**
 * Entwurf eines Steigwegs - reine Funktionen, ohne React (Phase 6a.5).
 *
 * Ein Entwurf ist bis zum Speichern rein lokal. Ein vorhandener Halt behält
 * seine Server-ID (`id`); spätere Leitungswege verweisen darauf. Ein neuer
 * Halt hat `id = null` und einen lokalen Schlüssel - die ID vergibt der Server.
 * Ein angebundenes Geschoss ohne Lage (`x_mm = null`) ist noch nicht gesetzt
 * und verhindert das Speichern; erfunden wird keine Lage.
 */

export interface Haltentwurf {
  schluessel: string;
  id: string | null;
  floor_id: string;
  x_mm: number | null;
  y_mm: number | null;
}

export interface Steigwegentwurf {
  id: string | null;
  version: number | null;
  name: string;
  note: string;
  offset_mode: Versatzart;
  halte: Haltentwurf[];
}

let zaehler = 0;

function neuerSchluessel(): string {
  zaehler += 1;
  return `neu-${zaehler}`;
}

export function neuerEntwurf(): Steigwegentwurf {
  return { id: null, version: null, name: "", note: "", offset_mode: "orthogonal", halte: [] };
}

export function ausServer(riser: RiserOut): Steigwegentwurf {
  return {
    id: riser.id,
    version: riser.version,
    name: riser.name,
    note: riser.note ?? "",
    offset_mode: riser.offset_mode,
    halte: riser.stops.map((s) => ({ schluessel: s.id, id: s.id, floor_id: s.floor_id, x_mm: s.x_mm, y_mm: s.y_mm })),
  };
}

function vergleichswert(e: Steigwegentwurf): string {
  return JSON.stringify({
    name: e.name.trim(),
    note: e.note.trim(),
    offset_mode: e.offset_mode,
    halte: [...e.halte]
      .map((h) => [h.id ?? h.schluessel, h.floor_id, h.x_mm, h.y_mm])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
  });
}

/** Weicht der Entwurf vom gespeicherten Stand ab? Ein neuer Entwurf ist immer offen. */
export function istGeaendert(entwurf: Steigwegentwurf, gespeichert: Steigwegentwurf | null): boolean {
  if (gespeichert === null) return true;
  return vergleichswert(entwurf) !== vergleichswert(gespeichert);
}

export function haltAuf(entwurf: Steigwegentwurf, floorId: string): Haltentwurf | undefined {
  return entwurf.halte.find((h) => h.floor_id === floorId);
}

/** Bindet ein Geschoss an - ohne Lage, außer sie wird ausdrücklich mitgegeben. */
export function geschossAnbinden(
  entwurf: Steigwegentwurf,
  floorId: string,
  lage: { x_mm: number; y_mm: number } | null = null,
): Steigwegentwurf {
  if (haltAuf(entwurf, floorId) !== undefined) return entwurf;
  return {
    ...entwurf,
    halte: [
      ...entwurf.halte,
      { schluessel: neuerSchluessel(), id: null, floor_id: floorId, x_mm: lage?.x_mm ?? null, y_mm: lage?.y_mm ?? null },
    ],
  };
}

export function geschossLoesen(entwurf: Steigwegentwurf, floorId: string): Steigwegentwurf {
  return { ...entwurf, halte: entwurf.halte.filter((h) => h.floor_id !== floorId) };
}

/** Setzt oder verschiebt den Halt eines Geschosses; die ID bleibt erhalten. */
export function haltSetzen(entwurf: Steigwegentwurf, floorId: string, x_mm: number, y_mm: number): Steigwegentwurf {
  const angebunden = geschossAnbinden(entwurf, floorId);
  return {
    ...angebunden,
    halte: angebunden.halte.map((h) => (h.floor_id === floorId ? { ...h, x_mm, y_mm } : h)),
  };
}

/** Einzelne Koordinate ändern (Maßeingabe). */
export function koordinateSetzen(
  entwurf: Steigwegentwurf,
  floorId: string,
  achse: "x_mm" | "y_mm",
  wert: number,
): Steigwegentwurf {
  return {
    ...entwurf,
    halte: entwurf.halte.map((h) => (h.floor_id === floorId ? { ...h, [achse]: wert } : h)),
  };
}

/** Halte mit vollständiger Lage - nur die gehen in Verlauf und Länge ein. */
export function gesetzteHalte(entwurf: Steigwegentwurf): Halt[] {
  return entwurf.halte.flatMap((h) =>
    h.x_mm === null || h.y_mm === null ? [] : [{ schluessel: h.schluessel, floor_id: h.floor_id, x_mm: h.x_mm, y_mm: h.y_mm }],
  );
}

/** Angebundene Geschosse, deren Übergabepunkt noch nicht gesetzt ist. */
export function fehlendeLagen(entwurf: Steigwegentwurf): string[] {
  return entwurf.halte.filter((h) => h.x_mm === null || h.y_mm === null).map((h) => h.floor_id);
}

/** Anfragekörper für Anlegen und Ersetzen. Nur aufrufen, wenn keine Lage fehlt. */
export function anfrage(entwurf: Steigwegentwurf): RiserCreate {
  const note = entwurf.note.trim();
  return {
    name: entwurf.name.trim(),
    note: note === "" ? null : note,
    offset_mode: entwurf.offset_mode,
    stops: entwurf.halte.map((h) => {
      if (h.x_mm === null || h.y_mm === null) throw new Error("Übergabepunkt ohne Lage.");
      return h.id === null
        ? { floor_id: h.floor_id, x_mm: h.x_mm, y_mm: h.y_mm }
        : { id: h.id, floor_id: h.floor_id, x_mm: h.x_mm, y_mm: h.y_mm };
    }),
  };
}
