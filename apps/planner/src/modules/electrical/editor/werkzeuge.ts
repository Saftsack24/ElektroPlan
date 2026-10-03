/**
 * Zeichen- und Bearbeitungsoperationen als reine Funktionen.
 *
 * Jede Funktion nimmt einen Stand und liefert einen neuen - ohne DOM, ohne
 * Zeit, ohne Zufall (IDs werden hineingereicht). Punkte sind hier bereits
 * ganzzahlige Weltmillimeter; die Umrechnung vom Bildschirm und das Fangen
 * geschehen vorher (`viewport.ts`, `fang.ts`).
 *
 * Kann eine Operation fachlich nicht ausgeführt werden, liefert sie
 * `{ fehler }` mit einer deutschen Begründung statt stillschweigend etwas
 * anderes zu tun.
 */
import type { EntwurfOeffnung, EntwurfWand, Oeffnungsart, Raumentwurf } from "./entwurf";
import { ende, start } from "./entwurf";
import { gleich, streckenlaenge } from "./geometrie";
import type { Punkt } from "./geometrie";

export type Ergebnis<T> = { wert: T } | { fehler: string };

function wand(id: string, a: Punkt, b: Punkt, dicke: number): EntwurfWand {
  return { id, x1_mm: a.x, y1_mm: a.y, x2_mm: b.x, y2_mm: b.y, thickness_mm: dicke, openings: [] };
}

// ----------------------------------------------------------- neue Räume

/**
 * Rechteck aus zwei gegenüberliegenden Ecken: vier Wände, gegen den
 * Uhrzeigersinn, beginnend links unten - unabhängig von der Zugrichtung.
 */
export function rechteckWaende(
  a: Punkt,
  b: Punkt,
  dicke: number,
  ids: readonly [string, string, string, string],
): Ergebnis<EntwurfWand[]> {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX - minX < 100 || maxY - minY < 100) {
    return { fehler: "Ein Raum braucht mindestens 10 cm (100 mm) Breite und Tiefe." };
  }
  const ecken: Punkt[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  return {
    wert: ecken.map((ecke, i) => wand(ids[i] as string, ecke, ecken[(i + 1) % 4] as Punkt, dicke)),
  };
}

/** Polygon aus gesetzten Punkten: `n` Punkte ergeben `n` Wände, die letzte schließt. */
export function polygonWaende(
  punkte: readonly Punkt[],
  dicke: number,
  ids: readonly string[],
): Ergebnis<EntwurfWand[]> {
  if (punkte.length < 3) return { fehler: "Ein Raum braucht mindestens drei Eckpunkte." };
  if (ids.length < punkte.length) throw new Error("Zu wenige IDs für die Wände.");
  return {
    wert: punkte.map((p, i) => wand(ids[i] as string, p, punkte[(i + 1) % punkte.length] as Punkt, dicke)),
  };
}

/** Punkt an den Polygonzug anhängen; ein doppelter Punkt direkt hintereinander zählt nicht. */
export function punktAnhaengen(punkte: readonly Punkt[], p: Punkt): Punkt[] {
  const letzter = punkte[punkte.length - 1];
  if (letzter !== undefined && gleich(letzter, p)) return [...punkte];
  return [...punkte, p];
}

export function letztenPunktEntfernen(punkte: readonly Punkt[]): Punkt[] {
  return punkte.slice(0, -1);
}

/** Schließt ein Klick den Polygonzug? Nur auf dem Startpunkt und ab drei Punkten. */
export function schliesstPolygon(punkte: readonly Punkt[], p: Punkt): boolean {
  const erster = punkte[0];
  return punkte.length >= 3 && erster !== undefined && gleich(erster, p);
}

// --------------------------------------------------------------- Ecken

/** Alle Eckpunkte eines Raums, jeder Punkt einmal. */
export function ecken(walls: readonly EntwurfWand[]): Punkt[] {
  const gesehen = new Set<string>();
  const ergebnis: Punkt[] = [];
  for (const w of walls) {
    for (const p of [start(w), ende(w)]) {
      const schluessel = `${p.x},${p.y}`;
      if (!gesehen.has(schluessel)) {
        gesehen.add(schluessel);
        ergebnis.push(p);
      }
    }
  }
  return ergebnis;
}

/**
 * Verschiebt einen Eckpunkt: **jedes** Wandende an dieser Stelle wandert mit.
 * Bei einer geschlossenen Kontur sind das genau die beiden angrenzenden Wände -
 * es entsteht keine Lücke.
 */
export function eckeVerschieben(
  entwurf: Raumentwurf,
  alt: Punkt,
  neu: Punkt,
): Raumentwurf {
  if (gleich(alt, neu)) return entwurf;
  return {
    ...entwurf,
    walls: entwurf.walls.map((w) => {
      let ergebnis = w;
      if (gleich(start(w), alt)) ergebnis = { ...ergebnis, x1_mm: neu.x, y1_mm: neu.y };
      if (gleich(ende(w), alt)) ergebnis = { ...ergebnis, x2_mm: neu.x, y2_mm: neu.y };
      return ergebnis;
    }),
  };
}

// ---------------------------------------------------------- Wände

function wandIndex(entwurf: Raumentwurf, wandId: string): number {
  const index = entwurf.walls.findIndex((w) => w.id === wandId);
  if (index < 0) throw new Error(`Wand ${wandId} gehört nicht zum Entwurf.`);
  return index;
}

/**
 * Präzise Koordinaten einer Wand setzen. Angrenzende Wandenden, die am alten
 * Punkt lagen, wandern mit - so bleibt eine geschlossene Kontur geschlossen.
 */
export function wandKoordinatenSetzen(
  entwurf: Raumentwurf,
  wandId: string,
  werte: { x1_mm: number; y1_mm: number; x2_mm: number; y2_mm: number; thickness_mm: number },
): Raumentwurf {
  const alt = entwurf.walls[wandIndex(entwurf, wandId)] as EntwurfWand;
  let neu = eckeVerschieben(entwurf, start(alt), { x: werte.x1_mm, y: werte.y1_mm });
  neu = eckeVerschieben(neu, ende(alt), { x: werte.x2_mm, y: werte.y2_mm });
  return {
    ...neu,
    walls: neu.walls.map((w) =>
      w.id === wandId
        ? { ...w, x1_mm: werte.x1_mm, y1_mm: werte.y1_mm, x2_mm: werte.x2_mm, y2_mm: werte.y2_mm, thickness_mm: werte.thickness_mm }
        : w,
    ),
  };
}

/** Länge setzen: Der Startpunkt bleibt, der Endpunkt wandert in Wandrichtung. */
export function wandlaengeSetzen(
  entwurf: Raumentwurf,
  wandId: string,
  laenge: number,
  /** Anzeige in der persönlichen Einheit (`core/masse.ts`); ohne Angabe Millimeter. */
  mm: (wert: number) => string = (wert) => `${wert} mm`,
): Ergebnis<Raumentwurf> {
  const w = entwurf.walls[wandIndex(entwurf, wandId)] as EntwurfWand;
  const dx = w.x2_mm - w.x1_mm;
  const dy = w.y2_mm - w.y1_mm;
  const exakt = Math.hypot(dx, dy);
  if (exakt === 0) return { fehler: "Die Wand hat keine Richtung." };
  if (!Number.isInteger(laenge) || laenge < 100) {
    return { fehler: "Die Länge muss mindestens 10 cm (100 mm) betragen, in ganzen Millimetern." };
  }
  const neuesEnde = {
    x: Math.round(w.x1_mm + (dx / exakt) * laenge) + 0,
    y: Math.round(w.y1_mm + (dy / exakt) * laenge) + 0,
  };
  // Öffnungen werden nie still verschoben oder ungültig (Phase 4f): Passt eine
  // nicht mehr in die neue Länge, wird die Änderung verständlich abgelehnt.
  const neueLaenge = streckenlaenge(start(w), neuesEnde);
  const zuLang = w.openings.find((o) => o.offset_mm + o.width_mm > neueLaenge);
  if (zuLang !== undefined) {
    return {
      fehler: `Eine Öffnung dieser Wand endet bei ${mm(zuLang.offset_mm + zuLang.width_mm)} ab Wandanfang; die Wand wäre nur ${mm(neueLaenge)} lang. Bitte zuerst die Öffnung verschieben oder verkleinern.`,
    };
  }
  return { wert: eckeVerschieben(entwurf, ende(w), neuesEnde) };
}

/** Teilt eine Wand in der Mitte. Öffnungen müssen in der ersten Hälfte liegen. */
export function wandTeilen(
  entwurf: Raumentwurf,
  wandId: string,
  neueWandId: string,
): Ergebnis<Raumentwurf> {
  const index = wandIndex(entwurf, wandId);
  const w = entwurf.walls[index] as EntwurfWand;
  const mitte = { x: Math.round((w.x1_mm + w.x2_mm) / 2) + 0, y: Math.round((w.y1_mm + w.y2_mm) / 2) + 0 };
  const ersteLaenge = streckenlaenge(start(w), mitte);
  if (ersteLaenge < 100 || streckenlaenge(mitte, ende(w)) < 100) {
    return { fehler: "Die Wand ist zu kurz zum Teilen." };
  }
  if (w.openings.some((o) => o.offset_mm + o.width_mm > ersteLaenge)) {
    return {
      fehler:
        "Eine Öffnung liegt in der zweiten Wandhälfte. Öffnungen wechseln ihre Wand nicht - bitte die Öffnung zuerst verschieben oder entfernen.",
    };
  }
  const erste: EntwurfWand = { ...w, x2_mm: mitte.x, y2_mm: mitte.y };
  const zweite: EntwurfWand = { ...w, id: neueWandId, x1_mm: mitte.x, y1_mm: mitte.y, openings: [] };
  const walls = [...entwurf.walls];
  walls.splice(index, 1, erste, zweite);
  return { wert: { ...entwurf, walls } };
}

/** Entfernt eine Wand. Die Kontur ist danach offen - ein zulässiger Entwurf. */
export function wandEntfernen(entwurf: Raumentwurf, wandId: string): Ergebnis<Raumentwurf> {
  const w = entwurf.walls[wandIndex(entwurf, wandId)] as EntwurfWand;
  if (w.openings.length > 0) {
    return { fehler: "Diese Wand trägt noch Öffnungen. Bitte zuerst die Öffnungen entfernen." };
  }
  return { wert: { ...entwurf, walls: entwurf.walls.filter((x) => x.id !== wandId) } };
}

/**
 * Entfernt den Eckpunkt am Ende einer Wand: Sie und ihre Nachfolgerin werden
 * zu einer Wand. Die erste behält ID und Öffnungen; die zweite darf keine tragen.
 */
export function eckeEntfernen(entwurf: Raumentwurf, wandId: string): Ergebnis<Raumentwurf> {
  const n = entwurf.walls.length;
  if (n < 4) return { fehler: "Ein Raum braucht mindestens drei Wände." };
  const index = wandIndex(entwurf, wandId);
  const w = entwurf.walls[index] as EntwurfWand;
  const naechsteIndex = (index + 1) % n;
  const naechste = entwurf.walls[naechsteIndex] as EntwurfWand;
  if (!gleich(ende(w), start(naechste))) {
    return { fehler: "Die Wand endet nicht an ihrer Nachfolgerin - hier gibt es keinen Eckpunkt." };
  }
  if (naechste.openings.length > 0) {
    return { fehler: "Die folgende Wand trägt Öffnungen. Bitte zuerst die Öffnungen entfernen." };
  }
  const verbunden: EntwurfWand = { ...w, x2_mm: naechste.x2_mm, y2_mm: naechste.y2_mm };
  const walls = entwurf.walls
    .map((x, i) => (i === index ? verbunden : x))
    .filter((_, i) => i !== naechsteIndex);
  return { wert: { ...entwurf, walls } };
}

/**
 * Kehrt den Umlaufsinn um: Reihenfolge und Richtung jeder Wand. Öffnungen
 * behalten ihre Lage im Raum; ihr Abstand zählt danach vom anderen Wandende
 * (die Richtung ist fachlich bedeutsam, ADR 0013).
 */
export function konturUmkehren(entwurf: Raumentwurf): Raumentwurf {
  return {
    ...entwurf,
    walls: [...entwurf.walls].reverse().map((w) => {
      const laenge = streckenlaenge(start(w), ende(w));
      return {
        ...w,
        x1_mm: w.x2_mm,
        y1_mm: w.y2_mm,
        x2_mm: w.x1_mm,
        y2_mm: w.y1_mm,
        openings: w.openings.map((o) => ({ ...o, offset_mm: laenge - o.offset_mm - o.width_mm })),
      };
    }),
  };
}

// ---------------------------------------------------------- Öffnungen

/**
 * Projiziert einen Punkt auf die **gerichtete** Wand: Abstand vom Wandanfang
 * in Millimetern (Gleitkomma), begrenzt auf die Wand.
 */
export function projektion(w: EntwurfWand, p: Punkt): number {
  const dx = w.x2_mm - w.x1_mm;
  const dy = w.y2_mm - w.y1_mm;
  const exakt = Math.hypot(dx, dy);
  if (exakt === 0) return 0;
  const entlang = ((p.x - w.x1_mm) * dx + (p.y - w.y1_mm) * dy) / exakt;
  return Math.min(Math.max(entlang, 0), exakt);
}

export const OEFFNUNG_STANDARD: Record<
  Oeffnungsart,
  { width_mm: number; height_mm: number; sill_height_mm: number }
> = {
  // Übliche Baurichtmaße; frei änderbar, keine Norm (docs/security.md, Abs. 17).
  door: { width_mm: 885, height_mm: 2_010, sill_height_mm: 0 },
  window: { width_mm: 1_010, height_mm: 1_260, sill_height_mm: 900 },
  passage: { width_mm: 885, height_mm: 2_010, sill_height_mm: 0 },
};

/**
 * Fügt eine neue Öffnung mit den Standardmaßen ihrer Art an einem bereits
 * berechneten Abstand ein (`platzierung.ts`). Sie gehört genau dieser Wand.
 */
export function oeffnungEinfuegen(
  entwurf: Raumentwurf,
  wandId: string,
  art: Oeffnungsart,
  offsetMm: number,
  id: string,
): Raumentwurf {
  const oeffnung: EntwurfOeffnung = { id, kind: art, offset_mm: offsetMm, ...OEFFNUNG_STANDARD[art] };
  return mitWand(entwurf, wandId, (x) => ({ ...x, openings: sortiert([...x.openings, oeffnung]) }));
}

export function oeffnungAendern(
  entwurf: Raumentwurf,
  wandId: string,
  oeffnungId: string,
  werte: Partial<Omit<EntwurfOeffnung, "id">>,
): Raumentwurf {
  return mitWand(entwurf, wandId, (w) => ({
    ...w,
    openings: sortiert(w.openings.map((o) => (o.id === oeffnungId ? { ...o, ...werte } : o))),
  }));
}

/**
 * Entfernt eine Öffnung. War sie schon gespeichert, wird sie **ausdrücklich**
 * als entfernt vermerkt - der Server löscht eine Öffnung nie stillschweigend.
 */
export function oeffnungEntfernen(
  entwurf: Raumentwurf,
  wandId: string,
  oeffnungId: string,
  gespeicherteIds: ReadonlySet<string>,
): Raumentwurf {
  const ohne = mitWand(entwurf, wandId, (w) => ({
    ...w,
    openings: w.openings.filter((o) => o.id !== oeffnungId),
  }));
  return gespeicherteIds.has(oeffnungId)
    ? { ...ohne, entfernteOeffnungen: [...ohne.entfernteOeffnungen, oeffnungId] }
    : ohne;
}

function mitWand(
  entwurf: Raumentwurf,
  wandId: string,
  aendern: (w: EntwurfWand) => EntwurfWand,
): Raumentwurf {
  wandIndex(entwurf, wandId);
  return { ...entwurf, walls: entwurf.walls.map((w) => (w.id === wandId ? aendern(w) : w)) };
}

function sortiert(openings: EntwurfOeffnung[]): EntwurfOeffnung[] {
  // Wie der Server: nach Abstand, dann ID (bytegenau, nicht sprachabhängig).
  return [...openings].sort(
    (a, b) => a.offset_mm - b.offset_mm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
