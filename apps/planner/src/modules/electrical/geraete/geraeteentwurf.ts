/**
 * Geräte im Raumentwurf ändern - reine Funktionen (Phase 5, ADR 0023).
 *
 * Wie bei Öffnungen: Ein gespeichertes Gerät verschwindet nie still, es wird
 * ausdrücklich als entfernt vermerkt. Montagefläche und Wand eines Geräts
 * ändern sich nicht - der Server lehnt das ab; verschieben geht nur innerhalb
 * seiner Fläche.
 */
import type { EntwurfGeraet, Montageflaeche, Raumentwurf } from "../editor/entwurf";
import type { Geraetetyp } from "./katalog";
import type { Pruefmass } from "./geraetepruefung";

function sortiert(geraete: readonly EntwurfGeraet[]): EntwurfGeraet[] {
  // Wie der Server: nach ID (bytegenau).
  return [...geraete].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function geraetEinfuegen(entwurf: Raumentwurf, geraet: EntwurfGeraet): Raumentwurf {
  return { ...entwurf, geraete: sortiert([...entwurf.geraete, geraet]) };
}

export function geraetAendern(
  entwurf: Raumentwurf,
  id: string,
  werte: Partial<Pick<EntwurfGeraet, "device_type_key" | "center_offset_mm" | "center_height_mm" | "x_mm" | "y_mm" | "label">>,
): Raumentwurf {
  return { ...entwurf, geraete: entwurf.geraete.map((g) => (g.id === id ? { ...g, ...werte } : g)) };
}

export function geraetEntfernen(entwurf: Raumentwurf, id: string, gespeicherteIds: ReadonlySet<string>): Raumentwurf {
  const ohne = { ...entwurf, geraete: entwurf.geraete.filter((g) => g.id !== id) };
  return gespeicherteIds.has(id) ? { ...ohne, entfernteGeraete: [...ohne.entfernteGeraete, id] } : ohne;
}

export function neuesWandgeraet(
  id: string,
  typ: Pick<Geraetetyp, "key">,
  wandId: string,
  flaeche: Exclude<Montageflaeche, "ceiling">,
  mitte: number,
  mittelhoehe: number,
): EntwurfGeraet {
  return {
    id,
    device_type_key: typ.key,
    mounting_surface: flaeche,
    wall_id: wandId,
    center_offset_mm: mitte,
    center_height_mm: mittelhoehe,
    x_mm: null,
    y_mm: null,
    label: null,
  };
}

export function neuesDeckengeraet(id: string, typ: Pick<Geraetetyp, "key">, x: number, y: number): EntwurfGeraet {
  return {
    id,
    device_type_key: typ.key,
    mounting_surface: "ceiling",
    wall_id: null,
    center_offset_mm: null,
    center_height_mm: null,
    x_mm: x,
    y_mm: y,
    label: null,
  };
}

/** Geräte einer Wand, optional nur einer Seite. */
export function geraeteDerWand(entwurf: Pick<Raumentwurf, "geraete">, wandId: string, flaeche?: Montageflaeche): EntwurfGeraet[] {
  return entwurf.geraete.filter((g) => g.wall_id === wandId && (flaeche === undefined || g.mounting_surface === flaeche));
}

/** Prüfmaß eines Katalogtyps - für `geraetepruefung.ts`. */
export function pruefmass(typ: Geraetetyp): Pruefmass {
  return {
    breite: typ.width_mm,
    hoehe: typ.height_mm,
    innen: typ.allows_wall_interior,
    aussen: typ.allows_wall_exterior,
    decke: typ.allows_ceiling,
  };
}
