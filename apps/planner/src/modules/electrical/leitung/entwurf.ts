/**
 * Leitungsentwurf (Phase 6b.4, Entwurf §9.3) - ein Reducer, rein und ohne React.
 *
 * Höchstens **ein** Leitungsentwurf ist offen; er gehört zum Planungskontext
 * (Geschoss im 2D-Editor) und nicht zu einer einzelnen Wand- oder
 * Deckenansicht. Ein Wechsel der Arbeitsfläche ändert ihn nicht.
 *
 * | Teil | Feld | Historie |
 * |---|---|---|
 * | zuletzt gespeicherter Stand | `basis` | nein |
 * | Entwurf | `werte` | ja - jede fachliche Änderung ein Schritt |
 * | Stand zu Beginn einer Ziehbewegung | `ziehenAb` | **ein** Schritt je Bewegung |
 * | gewählter Wegpunkt | `auswahl` | nein |
 * | Speicherablauf und Serverfehler | `status`, `fehler` | nein |
 *
 * Wegpunkte jeder Art bleiben unverändert erhalten - auch Fußboden-,
 * Bodenübergangs- und Steigwegpunkte, die hier nicht bearbeitet werden.
 */
import type { Wegpunkt } from "./laenge";

export interface Leitungswerte {
  readonly circuitId: string;
  /** Bezeichnung; leer = keine. */
  readonly label: string;
  readonly startId: string | null;
  readonly endId: string | null;
  /** Kabelangaben als Eingabetext - gelesen erst beim Speichern. */
  readonly kabeltyp: string;
  readonly leiterzahl: string;
  readonly querschnitt: string;
  readonly startzugabeMm: number;
  readonly endzugabeMm: number;
  readonly reserveMm: number;
  readonly wegpunkte: readonly Wegpunkt[];
}

export type Leitungsstatus = "bearbeiten" | "speichert" | "konflikt" | "fehler";

export interface Leitungsfehler {
  readonly meldung: string;
  readonly eintraege: readonly { readonly code: string; readonly meldung: string; readonly feld: string }[];
}

export interface Leitungsentwurf {
  /** `null` für eine neue, noch nicht gespeicherte Leitung. */
  readonly cableId: string | null;
  readonly version: number | null;
  readonly basis: Leitungswerte;
  readonly werte: Leitungswerte;
  readonly zurueck: readonly Leitungswerte[];
  readonly vor: readonly Leitungswerte[];
  readonly ziehenAb: Leitungswerte | null;
  /** Index des gewählten Wegpunkts - neue Punkte folgen ihm. */
  readonly auswahl: number | null;
  readonly status: Leitungsstatus;
  readonly fehler: Leitungsfehler | null;
}

export const MAX_LEITUNGSHISTORIE = 100;

export type Leitungsaktion =
  | { typ: "oeffnen"; entwurf: Leitungsentwurf }
  | { typ: "schliessen" }
  | { typ: "aendern"; werte: Leitungswerte; auswahl?: number | null }
  | { typ: "auswaehlen"; auswahl: number | null }
  | { typ: "ziehen-beginnen" }
  | { typ: "ziehen-vorschau"; werte: Leitungswerte }
  | { typ: "ziehen-beenden" }
  | { typ: "ziehen-abbrechen" }
  | { typ: "rueckgaengig" }
  | { typ: "wiederholen" }
  | { typ: "verwerfen" }
  | { typ: "speichern-beginnt" }
  | { typ: "gespeichert"; cableId: string; version: number; werte: Leitungswerte }
  | { typ: "gescheitert"; status: "konflikt" | "fehler"; fehler: Leitungsfehler }
  | { typ: "hinweis-schliessen" };

export function entwurfAus(cableId: string | null, version: number | null, werte: Leitungswerte): Leitungsentwurf {
  return { cableId, version, basis: werte, werte, zurueck: [], vor: [], ziehenAb: null, auswahl: null, status: "bearbeiten", fehler: null };
}

function gleicheWegpunkte(a: readonly Wegpunkt[], b: readonly Wegpunkt[]): boolean {
  return a.length === b.length && a.every((wp, i) => JSON.stringify(wp) === JSON.stringify(b[i]));
}

export function gleicheWerte(a: Leitungswerte, b: Leitungswerte): boolean {
  return (
    a.circuitId === b.circuitId &&
    a.label === b.label &&
    a.startId === b.startId &&
    a.endId === b.endId &&
    a.kabeltyp === b.kabeltyp &&
    a.leiterzahl === b.leiterzahl &&
    a.querschnitt === b.querschnitt &&
    a.startzugabeMm === b.startzugabeMm &&
    a.endzugabeMm === b.endzugabeMm &&
    a.reserveMm === b.reserveMm &&
    gleicheWegpunkte(a.wegpunkte, b.wegpunkte)
  );
}

/** Weicht der Entwurf vom gespeicherten Stand ab? Eine neue Leitung ist immer ungespeichert. */
export function leitungUngespeichert(e: Leitungsentwurf | null): boolean {
  return e !== null && (e.cableId === null || !gleicheWerte(e.basis, e.werte));
}

function begrenzt(liste: readonly Leitungswerte[]): readonly Leitungswerte[] {
  return liste.length > MAX_LEITUNGSHISTORIE ? liste.slice(liste.length - MAX_LEITUNGSHISTORIE) : liste;
}

function gueltigeAuswahl(auswahl: number | null, werte: Leitungswerte): number | null {
  return auswahl !== null && auswahl >= 0 && auswahl < werte.wegpunkte.length ? auswahl : null;
}

export function leitungsReducer(zustand: Leitungsentwurf | null, aktion: Leitungsaktion): Leitungsentwurf | null {
  if (aktion.typ === "oeffnen") return aktion.entwurf;
  if (zustand === null) return null;
  const e = zustand;
  switch (aktion.typ) {
    case "schliessen":
      return null;
    case "aendern": {
      if (gleicheWerte(aktion.werte, e.werte)) {
        return aktion.auswahl === undefined ? e : { ...e, auswahl: gueltigeAuswahl(aktion.auswahl, e.werte) };
      }
      return {
        ...e,
        werte: aktion.werte,
        zurueck: begrenzt([...e.zurueck, e.werte]),
        vor: [],
        auswahl: gueltigeAuswahl(aktion.auswahl === undefined ? e.auswahl : aktion.auswahl, aktion.werte),
        status: e.status === "speichert" ? e.status : "bearbeiten",
      };
    }
    case "auswaehlen":
      return { ...e, auswahl: gueltigeAuswahl(aktion.auswahl, e.werte) };
    case "ziehen-beginnen":
      return { ...e, ziehenAb: e.werte };
    case "ziehen-vorschau":
      return e.ziehenAb === null ? e : { ...e, werte: aktion.werte };
    case "ziehen-beenden": {
      if (e.ziehenAb === null) return e;
      // Eine Ziehbewegung ist genau ein Rückgängig-Schritt - ohne Änderung keiner.
      if (gleicheWerte(e.ziehenAb, e.werte)) return { ...e, ziehenAb: null };
      return { ...e, ziehenAb: null, zurueck: begrenzt([...e.zurueck, e.ziehenAb]), vor: [] };
    }
    case "ziehen-abbrechen":
      return e.ziehenAb === null ? e : { ...e, werte: e.ziehenAb, ziehenAb: null };
    case "rueckgaengig": {
      const vorher = e.zurueck[e.zurueck.length - 1];
      if (vorher === undefined || e.ziehenAb !== null) return e;
      return { ...e, werte: vorher, zurueck: e.zurueck.slice(0, -1), vor: [...e.vor, e.werte], auswahl: gueltigeAuswahl(e.auswahl, vorher) };
    }
    case "wiederholen": {
      const nachher = e.vor[e.vor.length - 1];
      if (nachher === undefined || e.ziehenAb !== null) return e;
      return { ...e, werte: nachher, vor: e.vor.slice(0, -1), zurueck: [...e.zurueck, e.werte], auswahl: gueltigeAuswahl(e.auswahl, nachher) };
    }
    case "verwerfen":
      return { ...e, werte: e.basis, zurueck: [], vor: [], ziehenAb: null, auswahl: null, status: "bearbeiten", fehler: null };
    case "speichern-beginnt":
      return { ...e, status: "speichert", fehler: null };
    case "gespeichert":
      return entwurfAus(aktion.cableId, aktion.version, aktion.werte);
    case "gescheitert":
      // Der Entwurf bleibt vollständig erhalten - nichts wird überschrieben.
      return { ...e, status: aktion.status, fehler: aktion.fehler };
    case "hinweis-schliessen":
      return { ...e, status: "bearbeiten", fehler: null };
  }
}

// ------------------------------------------------------------------ Wegpunkte

/** Neuer Punkt nach dem gewählten Wegpunkt, sonst am Ende; liefert Werte und neuen Index. */
export function wegpunktEinfuegen(werte: Leitungswerte, wp: Wegpunkt, nach: number | null): { werte: Leitungswerte; index: number } {
  const index = nach === null ? werte.wegpunkte.length : nach + 1;
  const wegpunkte = [...werte.wegpunkte.slice(0, index), wp, ...werte.wegpunkte.slice(index)];
  return { werte: { ...werte, wegpunkte }, index };
}

export function wegpunktErsetzen(werte: Leitungswerte, index: number, wp: Wegpunkt): Leitungswerte {
  return { ...werte, wegpunkte: werte.wegpunkte.map((alt, i) => (i === index ? wp : alt)) };
}

export function wegpunktEntfernen(werte: Leitungswerte, index: number): Leitungswerte {
  return { ...werte, wegpunkte: werte.wegpunkte.filter((_, i) => i !== index) };
}

// ------------------------------------------------------------------ Kabelangaben

export type Vorschlagsvergleich = "wie-vorschlag" | "abweichend" | "kein-vorschlag";

export interface Kabelvorschlag {
  readonly proposed_cable_type: string | null;
  readonly proposed_conductor_count: number | null;
  readonly proposed_cross_section_mm2: string | null;
}

/** Querschnitt „1,5“ / „1.50“ → vergleichbare Form „1.5“; leer = `null`. */
export function querschnittNormal(text: string | null): string | null {
  if (text === null) return null;
  const roh = text.trim().replace(/\s*mm²?$/i, "").replace(",", ".");
  if (roh === "") return null;
  const zahl = Number(roh);
  return Number.isFinite(zahl) ? String(zahl) : roh;
}

/** Je Kabelangabe: entspricht sie dem **aktuellen** Stromkreisvorschlag? */
export function vorschlagVergleichen(werte: Pick<Leitungswerte, "kabeltyp" | "leiterzahl" | "querschnitt">, kreis: Kabelvorschlag) {
  const vergleich = (wert: string | null, vorschlag: string | null): Vorschlagsvergleich =>
    vorschlag === null && wert === null ? "kein-vorschlag" : wert === vorschlag ? "wie-vorschlag" : "abweichend";
  const typ = werte.kabeltyp.trim() === "" ? null : werte.kabeltyp.trim();
  const zahl = werte.leiterzahl.trim() === "" ? null : werte.leiterzahl.trim();
  return {
    kabeltyp: vergleich(typ, kreis.proposed_cable_type),
    leiterzahl: vergleich(zahl, kreis.proposed_conductor_count === null ? null : String(kreis.proposed_conductor_count)),
    querschnitt: vergleich(querschnittNormal(werte.querschnitt), querschnittNormal(kreis.proposed_cross_section_mm2)),
  };
}

/** Leiterzahl aus der Eingabe: leer = `null`, sonst eine ganze Zahl 1 … 100. */
export function leiterzahlLesen(text: string): { ok: true; wert: number | null } | { ok: false; fehler: string } {
  const roh = text.trim();
  if (roh === "") return { ok: true, wert: null };
  if (!/^[0-9]{1,3}$/.test(roh) || Number(roh) < 1 || Number(roh) > 100) {
    return { ok: false, fehler: "Bitte eine Leiterzahl zwischen 1 und 100 angeben." };
  }
  return { ok: true, wert: Number(roh) };
}
