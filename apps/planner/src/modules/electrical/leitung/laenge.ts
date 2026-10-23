/**
 * Leitungsweg, Länge und Status - Spiegel von `cable_length.py` (Phase 6b.2, ADR 0026).
 *
 * Das Backend ist die fachliche Referenz; dieser Spiegel liefert dieselben
 * Ergebnisse für die unmittelbare Rückmeldung im Leitungsentwurf (ab 6b.4).
 * Die gemeinsame Fixture `testdata/geometry/leitung.v1.json` hält beide gleich.
 *
 * Wiederverwendet, nicht kopiert: Wandtopologie und Kopplungsstatus
 * (`topologie/wandtopologie.ts`), Abschnittstransformation und Fremdöffnungen
 * (`topologie/oeffnungen.ts`), exakte Lagen (`topologie/lage.ts`), Kontur und
 * Rundung (`editor/geometrie.ts`), Punkt im Polygon (`geraete/geraetepruefung.ts`),
 * Steigwegverlauf und -status (`steigweg/verlauf.ts`).
 *
 * Weg: Startgerät – Anschluss – W1 … Wn – Anschluss – Endgerät. Übergänge,
 * Statusregeln und Rundung wie im Backend (siehe dort und Entwurf §17):
 * `conflict` bei jedem ungültigen Befund, sonst `incomplete` bei fehlenden
 * Teilen, sonst `confirmed`. Eine ungültige Strecke trägt nichts bei und ist nie
 * eine gültige Null. Ganze Millimeter, je Strecke einmal gerundet, keine
 * Fließkommarechnung bis auf `Math.sqrt` als Startwert der exakten Ganzzahlwurzel.
 *
 * Keine Bemessung, keine Normaussage, kein Material, kein Preis.
 */
import type { Punkt } from "../editor/geometrie";
import { ganzzahligeWurzel, konturbericht, streckenlaenge } from "../editor/geometrie";
import { punktImPolygon } from "../geraete/geraetepruefung";
import type { Halt, SteigwegGeschoss, Verlaufspunkt, Versatzart } from "../steigweg/verlauf";
import { steigwegAuswerten } from "../steigweg/verlauf";
import type { Lage, Linienmass } from "../topologie/lage";
import { ganzeLage, lage, minus, vergleichen } from "../topologie/lage";
import { bereicheUeberlappen, fremdeBereiche, lageUebertragen } from "../topologie/oeffnungen";
import type { LokalerBereich } from "../topologie/oeffnungen";
import type { Abschnittsquelle, TopoKopplung, TopoWand, Wandteilung, Wandtopologie } from "../topologie/wandtopologie";
import { kopplungsstatus, wandtopologie } from "../topologie/wandtopologie";

// ------------------------------------------------------------------ Eingabe

export type Planungsflaeche = "wall" | "ceiling" | "floor" | "riser" | "shaft";
export type Geraeteflaeche = "wall_interior" | "wall_exterior" | "ceiling";

export interface LeitungsRaum {
  readonly id: string;
  readonly geschossId: string;
  /** Effektive lichte Raumhöhe. */
  readonly hoeheMm: number;
  /** Wände in Konturreihenfolge. */
  readonly waende: readonly TopoWand[];
}

export interface LeitungsGeraet {
  readonly id: string;
  readonly raumId: string;
  readonly flaeche: Geraeteflaeche;
  readonly wandId?: string | null;
  readonly abstandMm?: number | null;
  readonly hoeheMm?: number | null;
  readonly x?: number | null;
  readonly y?: number | null;
}

export interface Durchfuehrung {
  readonly id: string;
  readonly kopplungId: string;
  /** Lage an `wandA` der Kopplung. */
  readonly abstandMm: number;
  readonly hoeheMm: number;
}

export interface LeitungsSteigweg {
  readonly id: string;
  readonly versatz: Versatzart;
  readonly halte: readonly Halt[];
}

export interface Leitungsplan {
  readonly geschosse: readonly SteigwegGeschoss[];
  readonly raeume: readonly LeitungsRaum[];
  readonly kopplungen: readonly TopoKopplung[];
  readonly geraete: readonly LeitungsGeraet[];
  readonly durchfuehrungen: readonly Durchfuehrung[];
  readonly steigwege: readonly LeitungsSteigweg[];
}

export type Wegpunkt =
  | { readonly art: "wand"; readonly wandId: string; readonly abstandMm: number; readonly hoeheMm: number }
  | { readonly art: "ceiling" | "floor"; readonly raumId: string; readonly x: number; readonly y: number }
  | { readonly art: "durchfuehrung"; readonly durchfuehrungId: string }
  | { readonly art: "uebergang"; readonly wandId: string; readonly abstandMm: number; readonly oeffnungId: string | null }
  | {
      readonly art: "steigweg";
      readonly steigwegId: string;
      readonly vonHalt: string;
      readonly vonHoeheMm: number;
      readonly nachHalt: string;
      readonly nachHoeheMm: number;
    };

export interface Leitung {
  readonly id: string;
  readonly startGeraetId: string | null;
  readonly endGeraetId: string | null;
  readonly wegpunkte: readonly Wegpunkt[];
  readonly startzugabeMm: number;
  readonly endzugabeMm: number;
  /** Feste Reserve (Bestand); bei Prozentreserve `0`. */
  readonly reserveMm: number;
  /**
   * Prozentreserve (Phase 6c V1, ADR 0027) als Dezimaltext, `null` = feste Reserve. Zählt auf
   * die geometrische Länge, aufgerundet - und nur bei `confirmed`.
   */
  readonly reserveProzent: string | null;
  readonly kabeltyp: string | null;
  readonly leiterzahl: number | null;
  /** Dezimalzahl als Zeichenkette (ADR 0005) - nie `number`. */
  readonly querschnittMm2: string | null;
}

// ------------------------------------------------------------------ Ergebnis

export type Leitungsstatus = "confirmed" | "incomplete" | "conflict";
export type Befundart = "conflict" | "missing";
export type Streckenart =
  | "connection"
  | "wall"
  | "corner"
  | "wall-ceiling"
  | "wall-floor"
  | "ceiling"
  | "floor"
  | "penetration"
  | "opening-crossing"
  | "riser"
  | "shaft";

export interface Leitungsbefund {
  readonly code: string;
  readonly art: Befundart;
  /** `start`, `end`, `route`, `w3` oder `w2-w3`. */
  readonly ort: string;
}

export interface Wandlauf {
  readonly typ: "wand";
  readonly wandId: string;
  readonly mass: Linienmass;
  readonly vonLage: Lage;
  readonly vonHoeheMm: number;
  readonly bisLage: Lage;
  readonly bisHoeheMm: number;
  readonly laengeMm: number;
}

export interface Flaechenlauf {
  readonly typ: "flaeche";
  readonly flaeche: "ceiling" | "floor";
  readonly raumId: string;
  readonly start: Punkt;
  readonly ende: Punkt;
  readonly laengeMm: number;
}

export interface Steigweglauf {
  readonly typ: "steigweg";
  readonly steigwegId: string;
  readonly abschnitt: number;
  /** Genutzt ab dieser Höhe über dem unteren FFB. */
  readonly abHoeheMm: number;
  /** Nur bei bestätigter Höhenlage. */
  readonly senkrechtMm: number | null;
  readonly waagerechtMm: number;
  /** In Leitungsrichtung, absolute Höhen. */
  readonly verlauf: readonly Verlaufspunkt[];
}

export interface Schachtlauf {
  readonly typ: "schacht";
  readonly steigwegId: string;
  readonly haltId: string;
  /** Genutzte Höhe über dem FFB des Halts (größerer der beiden Werte). */
  readonly hoeheMm: number;
  /** In Leitungsrichtung: aufwärts 0 → h, abwärts h → 0. */
  readonly vonHoeheMm: number;
  readonly bisHoeheMm: number;
}

export type Lauf = Wandlauf | Flaechenlauf | Steigweglauf | Schachtlauf;

export interface Leitungsstrecke {
  readonly art: Streckenart;
  readonly ort: string;
  readonly besitzerId: string;
  readonly laeufe: readonly Lauf[];
  /** `null` nur bei unbekannter senkrechter Steigweglänge. */
  readonly laengeMm: number | null;
  readonly bekanntMm: number;
}

export interface Leitungsergebnis {
  readonly leitungId: string;
  readonly strecken: readonly Leitungsstrecke[];
  readonly geometrischMm: number;
  /** Anschlusszugaben + Reserve (soweit bekannt). */
  readonly zugabenMm: number;
  /** Start- und Endzugabe, ohne Reserve. */
  readonly anschlusszugabenMm: number;
  /** `null` = Prozentreserve noch offen (Leitung nicht `confirmed`). */
  readonly reserveMm: number | null;
  readonly reserveOffen: boolean;
  readonly status: Leitungsstatus;
  /** Nur bei `confirmed`. */
  readonly laengeMm: number | null;
  /** Ausdrücklich eine Teilsumme, wenn nicht `confirmed`. */
  readonly bekanntMm: number;
  readonly vollstaendigSpezifiziert: boolean;
  readonly befunde: readonly Leitungsbefund[];
  readonly durchfuehrungen: readonly string[];
  readonly bodenuebergaenge: number;
}

/** Deutsche Texte je Code - die Codes sind dieselben wie im Backend. */
export const LEITUNG_BEFUND_TEXT: Record<string, string> = {
  "start-not-placed": "Die Leitung hat keinen platzierten Startpunkt.",
  "end-not-placed": "Die Leitung hat keinen platzierten Endpunkt.",
  "end-device-missing": "Die Leitung hat noch kein Endgerät (offene Planung).",
  "endpoint-unknown": "Das Endgerät ist nicht bekannt.",
  "endpoint-exterior": "Außen montierte Geräte werden noch nicht angeschlossen.",
  "endpoint-surface-unknown": "Die Montagefläche des Endgeräts ist nicht bekannt.",
  "route-empty": "Der Leitungsweg ist noch nicht geplant.",
  "route-not-reaching-start": "Der Weg erreicht das Startgerät nicht.",
  "route-not-reaching-end": "Der Weg erreicht das Endgerät nicht.",
  "waypoint-wall-unknown": "Der Wegpunkt liegt an keiner bekannten Wand.",
  "waypoint-outside-wall": "Der Wegpunkt liegt außerhalb der Wandfläche.",
  "waypoint-in-opening": "Der Wegpunkt liegt in einer Öffnung.",
  "waypoint-room-unknown": "Der Wegpunkt liegt in keinem bekannten Raum.",
  "contour-open": "Decken- und Fußbodenwege brauchen eine geschlossene Raumkontur.",
  "waypoint-outside-room": "Der Wegpunkt liegt nicht in der Raumkontur.",
  "wall-diagonal": "Auf der Wand sind nur waagerechte und senkrechte Strecken zulässig.",
  "wall-through-opening": "Die Wandstrecke führt durch eine Öffnung.",
  "connection-through-opening": "Die Anschlussstrecke führt durch eine Öffnung.",
  "wall-change-without-corner": "Ein Wandwechsel ist nur über eine gemeinsame Ecke möglich.",
  "room-change-without-crossing":
    "Ein Raumwechsel ist nur über eine Durchführung, einen Bodenübergang oder einen Steigweg möglich.",
  "wall-ceiling-transition": "Der Übergang Wand – Decke liegt nicht an derselben Stelle.",
  "wall-floor-transition": "Der Übergang Wand – Fußboden liegt nicht an derselben Stelle.",
  "surface-change-not-allowed": "Decke und Fußboden sind nicht direkt verbunden.",
  "area-outside-contour": "Die Strecke verlässt die Raumkontur.",
  "penetration-unknown": "Die Durchführung ist nicht bekannt.",
  "penetration-link-not-active": "Die Wandkopplung der Durchführung ist nicht aktiv.",
  "penetration-outside-shared-section": "Die Durchführung liegt nicht in einem gemeinsamen Wandabschnitt.",
  "penetration-height": "Die Durchführung liegt nicht unter beiden Raumhöhen.",
  "penetration-in-opening": "Die Durchführung liegt in einer Öffnung.",
  "penetration-sequence": "Vor oder nach der Durchführung fehlt ein Wandpunkt ihrer Wand.",
  "opening-crossing-opening-removed": "Bodenübergang ohne Tür oder Durchgang.",
  "opening-crossing-window": "Ein Bodenübergang ist an einem Fenster nicht möglich.",
  "opening-crossing-outside": "Der Bodenübergang liegt außerhalb der Öffnung.",
  "opening-crossing-not-connecting": "Die Öffnung verbindet die beiden Räume nicht.",
  "opening-crossing-off-grid": "Der Bodenübergang liegt nicht auf ganzen Millimetern.",
  "opening-crossing-sequence": "Vor und nach dem Bodenübergang muss je ein Fußbodenpunkt der beiden Räume liegen.",
  "riser-unknown": "Der Steigweg ist nicht bekannt.",
  "riser-stop-unknown": "Der Halt gehört nicht zu diesem Steigweg.",
  "riser-same-stop": "Ein- und Ausstieg liegen am selben Halt.",
  "riser-height": "Die Höhe am Halt ist ungültig.",
  "riser-entry-height": "Der Einstieg liegt nicht unterhalb des nächsten Geschosses.",
  "riser-transfer": "Der Wegpunkt liegt nicht genau am Halt des Steigwegs.",
  "riser-elevation-unconfirmed": "Eine Höhenlage im genutzten Steigweg ist nicht bestätigt – Länge unvollständig.",
  "riser-elevation-inconsistent": "Die Höhenlagen im genutzten Steigweg widersprechen sich.",
};

// ------------------------------------------------------------------ Rundung

const PROZENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/**
 * Prozentreserve auf die geometrische Länge, auf ganze mm **aufgerundet** - Spiegel von
 * `percent_reserve_mm`. Ganzzahlig ohne Gleitkomma: `P = p·100`, `r = ⌊(g·P + 9 999) / 10 000⌋`.
 */
export function prozentReserveMm(geometrischMm: number, prozent: string): number {
  const treffer = PROZENT.exec(prozent);
  const hundertstel = treffer === null ? Number.NaN : Number(treffer[1]) * 100 + Number((treffer[2] ?? "").padEnd(2, "0"));
  if (!(hundertstel <= 10_000)) throw new RangeError("Prozentsatz 0 bis 100 mit höchstens zwei Nachkommastellen.");
  if (!Number.isSafeInteger(geometrischMm) || geometrischMm < 0) throw new RangeError("Die geometrische Länge ist nie negativ.");
  return Math.floor((geometrischMm * hundertstel + 9_999) / 10_000);
}

/** `round(ganz + stufen·√m)` kaufmännisch, rein ganzzahlig - wie `rounded_position`. */
export function gerundeteLage(wert: Lage, mass: Linienmass): number {
  if (wert.stufen === 0) return wert.ganz;
  if (mass.wurzel !== null) return wert.ganz + wert.stufen * mass.wurzel;
  const wurzel = ganzzahligeWurzel(4 * wert.stufen * wert.stufen * mass.m);
  const doppelt = 2 * wert.ganz + 1 + (wert.stufen > 0 ? wurzel : -(wurzel + 1));
  return Math.floor(doppelt / 2);
}

function betrag(wert: Lage, mass: Linienmass): Lage {
  return vergleichen(wert, ganzeLage(0), mass) < 0 ? lage(-wert.ganz, -wert.stufen, mass) : wert;
}

// ------------------------------------------------------------------ Vorbereitung

interface Wandinfo {
  readonly wand: TopoWand;
  readonly raum: LeitungsRaum;
  readonly laengeMm: number;
  readonly teilung: Wandteilung<TopoWand>;
  readonly schrittX: number;
  readonly schrittY: number;
  readonly schritte: number;
}

export interface VorbereiteterPlan {
  readonly plan: Leitungsplan;
  readonly raeume: ReadonlyMap<string, LeitungsRaum>;
  readonly waende: ReadonlyMap<string, Wandinfo>;
  readonly topologien: ReadonlyMap<string, Wandtopologie<TopoWand>>;
  readonly kopplungen: ReadonlyMap<string, TopoKopplung>;
  readonly geraete: ReadonlyMap<string, LeitungsGeraet>;
  readonly durchfuehrungen: ReadonlyMap<string, Durchfuehrung>;
  readonly steigwege: ReadonlyMap<string, LeitungsSteigweg>;
  readonly geschossIds: ReadonlySet<string>;
  readonly konturGueltig: ReadonlyMap<string, boolean>;
  readonly polygone: ReadonlyMap<string, readonly Punkt[]>;
  readonly umlauf: ReadonlyMap<string, number>;
}

function ggt(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

function doppelteFlaecheVon(punkte: readonly Punkt[]): number {
  let summe = 0;
  for (let i = 0; i < punkte.length; i += 1) {
    const a = punkte[i] as Punkt;
    const b = punkte[(i + 1) % punkte.length] as Punkt;
    summe += a.x * b.y - b.x * a.y;
  }
  return summe;
}

export function planVorbereiten(plan: Leitungsplan): VorbereiteterPlan {
  const nachGeschoss = new Map<string, TopoWand[]>();
  for (const raum of plan.raeume) {
    const liste = nachGeschoss.get(raum.geschossId) ?? [];
    liste.push(...raum.waende);
    nachGeschoss.set(raum.geschossId, liste);
  }
  // Je Geschoss getrennt: gleiche Koordinaten auf zwei Geschossen überlappen nicht.
  const topologien = new Map<string, Wandtopologie<TopoWand>>();
  const teilungen = new Map<string, Wandteilung<TopoWand>>();
  for (const [geschossId, waende] of nachGeschoss) {
    const topologie = wandtopologie(geschossId, waende, plan.kopplungen);
    topologien.set(geschossId, topologie);
    for (const [id, teilung] of topologie.teilung) teilungen.set(id, teilung);
  }
  const waende = new Map<string, Wandinfo>();
  const konturGueltig = new Map<string, boolean>();
  const polygone = new Map<string, readonly Punkt[]>();
  const umlauf = new Map<string, number>();
  for (const raum of plan.raeume) {
    const segmente = raum.waende.map((w) => ({ key: w.id, start: w.start, ende: w.ende }));
    konturGueltig.set(raum.id, segmente.length > 0 && konturbericht(segmente).status === "valid");
    const polygon = raum.waende.map((w) => w.start);
    polygone.set(raum.id, polygon);
    umlauf.set(raum.id, doppelteFlaecheVon(polygon) > 0 ? 1 : -1);
    for (const wand of raum.waende) {
      const teilung = teilungen.get(wand.id);
      if (teilung === undefined) continue;
      const dx = wand.ende.x - wand.start.x;
      const dy = wand.ende.y - wand.start.y;
      const teiler = ggt(dx, dy);
      waende.set(wand.id, {
        wand,
        raum,
        laengeMm: teilung.laengeMm,
        teilung,
        schrittX: dx / teiler,
        schrittY: dy / teiler,
        schritte: teiler,
      });
    }
  }
  return {
    plan,
    raeume: new Map(plan.raeume.map((r) => [r.id, r])),
    waende,
    topologien,
    kopplungen: new Map(plan.kopplungen.map((k) => [k.id, k])),
    geraete: new Map(plan.geraete.map((g) => [g.id, g])),
    durchfuehrungen: new Map(plan.durchfuehrungen.map((d) => [d.id, d])),
    steigwege: new Map(plan.steigwege.map((s) => [s.id, s])),
    geschossIds: new Set(plan.geschosse.map((g) => g.id)),
    konturGueltig,
    polygone,
    umlauf,
  };
}

// ------------------------------------------------------------------ Wandachse

function wandlageVon(info: Wandinfo, p: Punkt): Lage | null {
  const w = info.wand;
  if (p.x === w.start.x && p.y === w.start.y) return ganzeLage(0);
  if (p.x === w.ende.x && p.y === w.ende.y) return ganzeLage(info.laengeMm);
  const px = p.x - w.start.x;
  const py = p.y - w.start.y;
  if (px * info.schrittY - py * info.schrittX !== 0) return null;
  const j = (px * info.schrittX + py * info.schrittY) / info.teilung.mass.m;
  if (!(0 < j && j < info.schritte)) return null;
  return lage(0, j, info.teilung.mass);
}

function achspunkt(info: Wandinfo, abstandMm: number): Punkt | null {
  if (abstandMm === 0) return info.wand.start;
  if (abstandMm === info.laengeMm) return info.wand.ende;
  const wurzel = info.teilung.mass.wurzel;
  if (wurzel === null || abstandMm % wurzel !== 0) return null;
  const j = abstandMm / wurzel;
  if (!(0 < j && j < info.schritte)) return null;
  return { x: info.wand.start.x + j * info.schrittX, y: info.wand.start.y + j * info.schrittY };
}

/** Lage im Bereich `[a, b]` (Kanten eingeschlossen)? */
function imBereich(a: Lage, b: Lage, stelle: Lage, mass: Linienmass): boolean {
  return vergleichen(a, stelle, mass) <= 0 && vergleichen(stelle, b, mass) <= 0;
}

/** Quellen von `wandA`/`wandB` im `shared`-Abschnitt dieser Kopplung - wie `shared_sources`. */
export function gemeinsameQuellen(
  vorbereitet: VorbereiteterPlan,
  kopplung: TopoKopplung,
  stelle: Lage,
): [Abschnittsquelle<TopoWand>, Abschnittsquelle<TopoWand>] | null {
  const info = vorbereitet.waende.get(kopplung.wandA);
  if (info === undefined) return null;
  const mass = info.teilung.mass;
  for (let i = 0; i < info.teilung.abschnitte.length; i += 1) {
    const abschnitt = info.teilung.abschnitte[i];
    const a = info.teilung.grenzen[i];
    const b = info.teilung.grenzen[i + 1];
    if (abschnitt === undefined || a === undefined || b === undefined) continue;
    if (abschnitt.zuordnung !== "shared" || abschnitt.kopplungId !== kopplung.id) continue;
    if (!imBereich(a, b, stelle, mass)) continue;
    const qa = abschnitt.quellen.find((q) => q.wand.id === kopplung.wandA);
    const qb = abschnitt.quellen.find((q) => q.wand.id === kopplung.wandB);
    if (qa === undefined || qb === undefined) continue;
    return [qa, qb];
  }
  return null;
}

// ------------------------------------------------------------------ Kontur

function kreuz(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function drehsinn(a: Punkt, b: Punkt, c: Punkt): number {
  return Math.sign(kreuz(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y));
}

function imKasten(p: Punkt, a: Punkt, b: Punkt): boolean {
  return (
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)
  );
}

function aufKante(p: Punkt, a: Punkt, b: Punkt): boolean {
  return drehsinn(a, b, p) === 0 && imKasten(p, a, b);
}

function gleichePunkte(a: Punkt, b: Punkt): boolean {
  return a.x === b.x && a.y === b.y;
}

function imGeschlossenen(polygon: readonly Punkt[], p: Punkt): boolean {
  for (let i = 0; i < polygon.length; i += 1) {
    if (aufKante(p, polygon[i] as Punkt, polygon[(i + 1) % polygon.length] as Punkt)) return true;
  }
  return punktImPolygon(p, polygon);
}

function imWinkel(v: Punkt, vor: Punkt, nach: Punkt, dx: number, dy: number, umlauf: number): boolean {
  const [erster, zweiter] = umlauf > 0 ? [nach, vor] : [vor, nach];
  const e1x = erster.x - v.x;
  const e1y = erster.y - v.y;
  const e2x = zweiter.x - v.x;
  const e2y = zweiter.y - v.y;
  if (kreuz(e1x, e1y, e2x, e2y) > 0) return kreuz(e1x, e1y, dx, dy) >= 0 && kreuz(dx, dy, e2x, e2y) >= 0;
  return !(kreuz(e2x, e2y, dx, dy) > 0 && kreuz(dx, dy, e1x, e1y) > 0);
}

/** Liegt die Strecke `a-b` vollständig in der geschlossenen Kontur? Exakt, Rand = innen. */
export function streckeInKontur(polygon: readonly Punkt[], umlauf: number, a: Punkt, b: Punkt): boolean {
  if (!imGeschlossenen(polygon, a) || !imGeschlossenen(polygon, b)) return false;
  if (gleichePunkte(a, b)) return true;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    const p = polygon[i] as Punkt;
    const q = polygon[(i + 1) % n] as Punkt;
    if (drehsinn(a, b, p) * drehsinn(a, b, q) < 0 && drehsinn(p, q, a) * drehsinn(p, q, b) < 0) return false;
  }
  for (let i = 0; i < n; i += 1) {
    const v = polygon[i] as Punkt;
    const vor = polygon[(i - 1 + n) % n] as Punkt;
    const nach = polygon[(i + 1) % n] as Punkt;
    if (gleichePunkte(v, a)) {
      if (!imWinkel(v, vor, nach, dx, dy, umlauf)) return false;
    } else if (gleichePunkte(v, b)) {
      if (!imWinkel(v, vor, nach, -dx, -dy, umlauf)) return false;
    } else if (aufKante(v, a, b) && !(imWinkel(v, vor, nach, dx, dy, umlauf) && imWinkel(v, vor, nach, -dx, -dy, umlauf))) {
      return false;
    }
  }
  for (let i = 0; i < n; i += 1) {
    const p = polygon[i] as Punkt;
    const q = polygon[(i + 1) % n] as Punkt;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    for (const [ende, sx, sy] of [
      [a, dx, dy],
      [b, -dx, -dy],
    ] as const) {
      if (gleichePunkte(ende, p) || gleichePunkte(ende, q) || !aufKante(ende, p, q)) continue;
      if (umlauf * kreuz(ex, ey, sx, sy) < 0) return false;
    }
  }
  return true;
}

// ------------------------------------------------------------------ Orte

interface WandOrt {
  readonly typ: "wand";
  readonly wandId: string;
  readonly lage: Lage;
  readonly hoeheMm: number;
}

interface FlaechenOrt {
  readonly typ: "flaeche";
  readonly flaeche: "ceiling" | "floor";
  readonly raumId: string;
  readonly punkt: Punkt;
}

interface HaltOrt {
  readonly typ: "halt";
  readonly steigwegId: string;
  readonly halt: Halt;
  readonly hoeheMm: number;
}

type Ort = WandOrt | FlaechenOrt | HaltOrt;

interface Zweiseitig {
  readonly typ: "zweiseitig";
  readonly art: "penetration" | "opening-crossing";
  readonly besitzerId: string;
  readonly seiten: readonly [WandOrt | FlaechenOrt, WandOrt | FlaechenOrt];
}

interface Steigwegnutzung {
  readonly typ: "nutzung";
  readonly eintritt: HaltOrt;
  readonly austritt: HaltOrt;
  readonly strecken: readonly Leitungsstrecke[];
}

function besitzerSchluessel(ort: WandOrt | FlaechenOrt): string {
  return ort.typ === "wand" ? ort.wandId : ort.raumId;
}

// ------------------------------------------------------------------ Analyse

class Weg {
  readonly strecken: Leitungsstrecke[] = [];
  readonly befunde: Leitungsbefund[] = [];

  constructor(private readonly p: VorbereiteterPlan) {}

  konflikt(code: string, ort: string): void {
    this.befunde.push({ code, art: "conflict", ort });
  }

  fehlt(code: string, ort: string): void {
    this.befunde.push({ code, art: "missing", ort });
  }

  hinzufuegen(art: Streckenart, ort: string, besitzerId: string, laeufe: readonly Lauf[] = [], laengeMm = 0): void {
    this.strecken.push({ art, ort, besitzerId, laeufe, laengeMm, bekanntMm: laengeMm });
  }

  private wand(id: string): Wandinfo {
    return this.p.waende.get(id) as Wandinfo;
  }

  oeffnungGetroffen(wandId: string, a: Lage, b: Lage, h1: number, h2: number): boolean {
    const info = this.wand(wandId);
    const mass = info.teilung.mass;
    const [lo, hi] = vergleichen(a, b, mass) <= 0 ? [a, b] : [b, a];
    const unten = Math.min(h1, h2);
    const oben = Math.max(h1, h2);
    const lauf: LokalerBereich = { s0: lo, s1: hi };
    const flaechen: { bereich: LokalerBereich; bruestung: number; hoehe: number }[] = info.wand.oeffnungen.map((o) => ({
      bereich: { s0: ganzeLage(o.offsetMm), s1: ganzeLage(o.offsetMm + o.breiteMm) },
      bruestung: o.bruestungMm,
      hoehe: o.hoeheMm,
    }));
    for (const fremd of fremdeBereiche(info.teilung)) {
      const oeffnung = this.p.waende.get(fremd.wandId)?.wand.oeffnungen.find((o) => o.oeffnungId === fremd.oeffnungId);
      if (oeffnung === undefined) continue;
      flaechen.push({ bereich: fremd.bereich, bruestung: oeffnung.bruestungMm, hoehe: oeffnung.hoeheMm });
    }
    for (const { bereich, bruestung, hoehe } of flaechen) {
      // Die Unterkante einer bodentiefen Öffnung zählt zur Öffnung - dort ist keine Wand.
      const untergrenze = bruestung > 0 ? bruestung : -1;
      const obergrenze = bruestung + hoehe;
      const senkrecht =
        unten === oben ? untergrenze < unten && unten < obergrenze : Math.max(unten, untergrenze) < Math.min(oben, obergrenze);
      if (senkrecht && bereicheUeberlappen(lauf, bereich, mass)) return true;
    }
    return false;
  }

  wandlauf(a: WandOrt, b: WandOrt): Wandlauf | null {
    const mass = this.wand(a.wandId).teilung.mass;
    let laenge: number;
    if (a.hoeheMm === b.hoeheMm) laenge = gerundeteLage(betrag(minus(b.lage, a.lage, mass), mass), mass);
    else if (vergleichen(a.lage, b.lage, mass) === 0) laenge = Math.abs(b.hoeheMm - a.hoeheMm);
    else return null;
    return {
      typ: "wand",
      wandId: a.wandId,
      mass,
      vonLage: a.lage,
      vonHoeheMm: a.hoeheMm,
      bisLage: b.lage,
      bisHoeheMm: b.hoeheMm,
      laengeMm: laenge,
    };
  }

  geraeteOrt(geraetId: string | null, ort: "start" | "end"): Ort | null {
    if (geraetId === null) {
      this.fehlt(ort === "end" ? "end-device-missing" : "start-not-placed", ort);
      return null;
    }
    const geraet = this.p.geraete.get(geraetId);
    if (geraet === undefined) {
      this.konflikt("endpoint-unknown", ort);
      return null;
    }
    if (geraet.flaeche === "wall_exterior") {
      this.konflikt("endpoint-exterior", ort);
      return null;
    }
    if (geraet.flaeche === "wall_interior") {
      const info = this.p.waende.get(geraet.wandId ?? "");
      if (
        info === undefined ||
        info.raum.id !== geraet.raumId ||
        geraet.abstandMm === null ||
        geraet.abstandMm === undefined ||
        geraet.hoeheMm === null ||
        geraet.hoeheMm === undefined
      ) {
        this.konflikt("endpoint-surface-unknown", ort);
        return null;
      }
      return { typ: "wand", wandId: info.wand.id, lage: ganzeLage(geraet.abstandMm), hoeheMm: geraet.hoeheMm };
    }
    if (this.p.raeume.has(geraet.raumId) && geraet.x !== null && geraet.x !== undefined && geraet.y !== null && geraet.y !== undefined) {
      return { typ: "flaeche", flaeche: "ceiling", raumId: geraet.raumId, punkt: { x: geraet.x, y: geraet.y } };
    }
    this.konflikt("endpoint-surface-unknown", ort);
    return null;
  }

  anschliessen(geraet: Ort, ort: Ort, bezug: "start" | "end"): void {
    const amStart = bezug === "start";
    if (geraet.typ === "wand" && ort.typ === "wand") {
      if (geraet.wandId === ort.wandId) {
        const knick: WandOrt = { typ: "wand", wandId: geraet.wandId, lage: geraet.lage, hoeheMm: ort.hoeheMm };
        const senkrecht = this.wandlauf(geraet, knick) as Wandlauf;
        const waagerecht = this.wandlauf(knick, ort) as Wandlauf;
        if (
          [senkrecht, waagerecht].some((l) => this.oeffnungGetroffen(l.wandId, l.vonLage, l.bisLage, l.vonHoeheMm, l.bisHoeheMm))
        ) {
          this.konflikt("connection-through-opening", bezug);
          return;
        }
        const laeufe = amStart ? [senkrecht, waagerecht] : [umkehren(waagerecht), umkehren(senkrecht)];
        this.hinzufuegen("connection", bezug, geraet.wandId, laeufe, senkrecht.laengeMm + waagerecht.laengeMm);
        return;
      }
    } else if (geraet.typ === "flaeche" && ort.typ === "flaeche" && ort.flaeche === "ceiling" && ort.raumId === geraet.raumId) {
      const [start, ende] = amStart ? [geraet.punkt, ort.punkt] : [ort.punkt, geraet.punkt];
      const lauf = this.flaechenlauf("ceiling", geraet.raumId, start, ende, bezug);
      if (lauf !== null) this.hinzufuegen("connection", bezug, geraet.raumId, [lauf], lauf.laengeMm);
      return;
    }
    this.fehlt(amStart ? "route-not-reaching-start" : "route-not-reaching-end", bezug);
  }

  flaechenlauf(flaeche: "ceiling" | "floor", raumId: string, a: Punkt, b: Punkt, ort: string): Flaechenlauf | null {
    if (this.p.konturGueltig.get(raumId) !== true) {
      this.konflikt("contour-open", ort);
      return null;
    }
    if (!streckeInKontur(this.p.polygone.get(raumId) ?? [], this.p.umlauf.get(raumId) ?? 1, a, b)) {
      this.konflikt("area-outside-contour", ort);
      return null;
    }
    return { typ: "flaeche", flaeche, raumId, start: a, ende: b, laengeMm: streckenlaenge(a, b) };
  }

  aufloesen(index: number, wp: Wegpunkt): Ort | Zweiseitig | Steigwegnutzung | null {
    const ort = `w${index}`;
    switch (wp.art) {
      case "wand": {
        const info = this.p.waende.get(wp.wandId);
        if (info === undefined) {
          this.konflikt("waypoint-wall-unknown", ort);
          return null;
        }
        if (!(0 <= wp.abstandMm && wp.abstandMm <= info.laengeMm && 0 <= wp.hoeheMm && wp.hoeheMm <= info.raum.hoeheMm)) {
          this.konflikt("waypoint-outside-wall", ort);
          return null;
        }
        const stelle = ganzeLage(wp.abstandMm);
        if (this.oeffnungGetroffen(wp.wandId, stelle, stelle, wp.hoeheMm, wp.hoeheMm)) {
          this.konflikt("waypoint-in-opening", ort);
          return null;
        }
        return { typ: "wand", wandId: wp.wandId, lage: stelle, hoeheMm: wp.hoeheMm };
      }
      case "ceiling":
      case "floor": {
        if (!this.p.raeume.has(wp.raumId)) {
          this.konflikt("waypoint-room-unknown", ort);
          return null;
        }
        if (this.p.konturGueltig.get(wp.raumId) !== true) {
          this.konflikt("contour-open", ort);
          return null;
        }
        const punkt = { x: wp.x, y: wp.y };
        if (!imGeschlossenen(this.p.polygone.get(wp.raumId) ?? [], punkt)) {
          this.konflikt("waypoint-outside-room", ort);
          return null;
        }
        return { typ: "flaeche", flaeche: wp.art, raumId: wp.raumId, punkt };
      }
      case "durchfuehrung":
        return this.durchfuehrung(wp.durchfuehrungId, ort);
      case "uebergang":
        return this.uebergang(wp.wandId, wp.abstandMm, wp.oeffnungId, ort);
      case "steigweg":
        return this.steigweg(wp, ort);
    }
  }

  durchfuehrung(id: string, ort: string): Zweiseitig | null {
    const d = this.p.durchfuehrungen.get(id);
    const k = d === undefined ? undefined : this.p.kopplungen.get(d.kopplungId);
    if (d === undefined || k === undefined || !this.p.waende.has(k.wandA) || !this.p.waende.has(k.wandB)) {
      this.konflikt("penetration-unknown", ort);
      return null;
    }
    const infoA = this.wand(k.wandA);
    const infoB = this.wand(k.wandB);
    const topologie = this.p.topologien.get(infoA.raum.geschossId);
    if (topologie === undefined || kopplungsstatus(topologie, k) !== "active") {
      this.konflikt("penetration-link-not-active", ort);
      return null;
    }
    const mass = infoA.teilung.mass;
    const stelle = ganzeLage(d.abstandMm);
    const paar = gemeinsameQuellen(this.p, k, stelle);
    if (paar === null) {
      this.konflikt("penetration-outside-shared-section", ort);
      return null;
    }
    if (!(0 <= d.hoeheMm && d.hoeheMm < Math.min(infoA.raum.hoeheMm, infoB.raum.hoeheMm))) {
      this.konflikt("penetration-height", ort);
      return null;
    }
    if (this.oeffnungGetroffen(k.wandA, stelle, stelle, d.hoeheMm, d.hoeheMm)) {
      this.konflikt("penetration-in-opening", ort);
      return null;
    }
    const gegenlage = lageUebertragen(stelle, paar[0], paar[1], mass);
    return {
      typ: "zweiseitig",
      art: "penetration",
      besitzerId: d.id,
      seiten: [
        { typ: "wand", wandId: k.wandA, lage: stelle, hoeheMm: d.hoeheMm },
        { typ: "wand", wandId: k.wandB, lage: gegenlage, hoeheMm: d.hoeheMm },
      ],
    };
  }

  uebergang(wandId: string, abstandMm: number, oeffnungId: string | null, ort: string): Zweiseitig | null {
    const info = this.p.waende.get(wandId);
    if (info === undefined) {
      this.konflikt("waypoint-wall-unknown", ort);
      return null;
    }
    const oeffnung = info.wand.oeffnungen.find((o) => o.oeffnungId === oeffnungId);
    if (oeffnungId === null || oeffnung === undefined) {
      this.konflikt("opening-crossing-opening-removed", ort);
      return null;
    }
    if (oeffnung.art !== "door" && oeffnung.art !== "passage") {
      this.konflikt("opening-crossing-window", ort);
      return null;
    }
    if (!(oeffnung.offsetMm <= abstandMm && abstandMm <= oeffnung.offsetMm + oeffnung.breiteMm)) {
      this.konflikt("opening-crossing-outside", ort);
      return null;
    }
    const nachbarn = new Set<string>();
    let verbindet = true;
    const mass = info.teilung.mass;
    const stelle = ganzeLage(abstandMm);
    info.teilung.abschnitte.forEach((abschnitt, i) => {
      const a = info.teilung.grenzen[i];
      const b = info.teilung.grenzen[i + 1];
      if (a === undefined || b === undefined || !imBereich(a, b, stelle, mass)) return;
      if (abschnitt.quellen.length !== 2 || (abschnitt.zuordnung !== "shared" && abschnitt.zuordnung !== "undecided")) {
        verbindet = false;
        return;
      }
      for (const q of abschnitt.quellen) if (q.wand.id !== wandId) nachbarn.add(q.wand.raumId);
    });
    if (!verbindet || nachbarn.size !== 1 || nachbarn.has(info.raum.id)) {
      this.konflikt("opening-crossing-not-connecting", ort);
      return null;
    }
    const punkt = achspunkt(info, abstandMm);
    if (punkt === null) {
      this.konflikt("opening-crossing-off-grid", ort);
      return null;
    }
    const nachbar = [...nachbarn][0] as string;
    return {
      typ: "zweiseitig",
      art: "opening-crossing",
      besitzerId: oeffnung.oeffnungId,
      seiten: [
        { typ: "flaeche", flaeche: "floor", raumId: info.raum.id, punkt },
        { typ: "flaeche", flaeche: "floor", raumId: nachbar, punkt },
      ],
    };
  }

  steigweg(wp: Extract<Wegpunkt, { art: "steigweg" }>, ort: string): Steigwegnutzung | null {
    const steigweg = this.p.steigwege.get(wp.steigwegId);
    if (steigweg === undefined) {
      this.konflikt("riser-unknown", ort);
      return null;
    }
    const erster = steigweg.halte.find((h) => h.schluessel === wp.vonHalt);
    const letzter = steigweg.halte.find((h) => h.schluessel === wp.nachHalt);
    if (erster === undefined || letzter === undefined || steigweg.halte.some((h) => !this.p.geschossIds.has(h.floor_id))) {
      this.konflikt("riser-stop-unknown", ort);
      return null;
    }
    if (erster.schluessel === letzter.schluessel) {
      this.konflikt("riser-same-stop", ort);
      return null;
    }
    if (wp.vonHoeheMm < 0 || wp.nachHoeheMm < 0) {
      this.konflikt("riser-height", ort);
      return null;
    }
    const auswertung = steigwegAuswerten(this.p.plan.geschosse, steigweg.halte, steigweg.versatz);
    const reihenfolge = auswertung.halte.map((h) => h.schluessel);
    const a = reihenfolge.indexOf(erster.schluessel);
    const b = reihenfolge.indexOf(letzter.schluessel);
    const aufwaerts = a < b;
    const [lo, hi] = aufwaerts ? [a, b] : [b, a];
    const untenHoehe = aufwaerts ? wp.vonHoeheMm : wp.nachHoeheMm;
    const obenHoehe = aufwaerts ? wp.nachHoeheMm : wp.vonHoeheMm;
    const abschnitte = auswertung.abschnitte.slice(lo, hi);
    if (abschnitte.some((s) => s.status === "elevation-inconsistent")) {
      this.konflikt("riser-elevation-inconsistent", ort);
      return null;
    }
    const einstieg = abschnitte[0]?.senkrecht_mm ?? null;
    if (einstieg !== null && untenHoehe >= einstieg) {
      this.konflikt("riser-entry-height", ort);
      return null;
    }
    if (abschnitte.some((s) => s.status === "elevation-unconfirmed")) this.fehlt("riser-elevation-unconfirmed", ort);

    const laeufe: Steigweglauf[] = abschnitte.map((abschnitt, i) => {
      const ab = i === 0 ? untenHoehe : 0;
      const punkte = abschnitt.verlauf.map((p) => ({ ...p }));
      const anfang = punkte[0] as Verlaufspunkt;
      punkte[0] = { x_mm: anfang.x_mm, y_mm: anfang.y_mm, z_mm: anfang.z_mm + ab };
      const verlauf = punkte.filter(
        (p, j) => j === 0 || !(p.x_mm === punkte[j - 1]?.x_mm && p.y_mm === punkte[j - 1]?.y_mm && p.z_mm === punkte[j - 1]?.z_mm),
      );
      return {
        typ: "steigweg",
        steigwegId: steigweg.id,
        abschnitt: lo + i,
        abHoeheMm: ab,
        senkrechtMm: abschnitt.senkrecht_mm === null ? null : abschnitt.senkrecht_mm - ab,
        waagerechtMm: abschnitt.waagerecht_mm,
        verlauf: aufwaerts ? verlauf : [...verlauf].reverse(),
      };
    });
    if (!aufwaerts) laeufe.reverse();
    const bekannt = laeufe.reduce((s, l) => s + l.waagerechtMm + (l.senkrechtMm ?? 0), 0);
    const vollstaendig = laeufe.every((l) => l.senkrechtMm !== null);
    const steigstrecke: Leitungsstrecke = {
      art: "riser",
      ort,
      besitzerId: steigweg.id,
      laeufe,
      laengeMm: vollstaendig ? bekannt : null,
      bekanntMm: bekannt,
    };
    const oberer = auswertung.halte[hi] as Halt;
    let strecken: Leitungsstrecke[] = [steigstrecke];
    if (obenHoehe > 0) {
      const schacht: Leitungsstrecke = {
        art: "shaft",
        ort,
        besitzerId: steigweg.id,
        laeufe: [
          {
            typ: "schacht",
            steigwegId: steigweg.id,
            haltId: oberer.schluessel,
            hoeheMm: obenHoehe,
            vonHoeheMm: aufwaerts ? 0 : obenHoehe,
            bisHoeheMm: aufwaerts ? obenHoehe : 0,
          },
        ],
        laengeMm: obenHoehe,
        bekanntMm: obenHoehe,
      };
      strecken = aufwaerts ? [steigstrecke, schacht] : [schacht, steigstrecke];
    }
    return {
      typ: "nutzung",
      eintritt: { typ: "halt", steigwegId: steigweg.id, halt: erster, hoeheMm: wp.vonHoeheMm },
      austritt: { typ: "halt", steigwegId: steigweg.id, halt: letzter, hoeheMm: wp.nachHoeheMm },
      strecken,
    };
  }

  amHalt(ort: Ort, halt: HaltOrt): boolean {
    const ziel = { x: halt.halt.x_mm, y: halt.halt.y_mm };
    if (ort.typ === "wand") {
      const info = this.wand(ort.wandId);
      if (info.raum.geschossId !== halt.halt.floor_id || ort.hoeheMm !== halt.hoeheMm) return false;
      const stelle = wandlageVon(info, ziel);
      return stelle !== null && vergleichen(stelle, ort.lage, info.teilung.mass) === 0;
    }
    if (ort.typ === "flaeche") {
      const raum = this.p.raeume.get(ort.raumId) as LeitungsRaum;
      const erwartet = ort.flaeche === "ceiling" ? raum.hoeheMm : 0;
      return raum.geschossId === halt.halt.floor_id && gleichePunkte(ort.punkt, ziel) && halt.hoeheMm === erwartet;
    }
    return false;
  }

  schritt(a: Ort, b: Ort, ort: string): void {
    if (a.typ === "halt" || b.typ === "halt") {
      const [halt, anderer] = a.typ === "halt" ? [a, b] : [b as HaltOrt, a];
      if (!this.amHalt(anderer, halt)) this.konflikt("riser-transfer", ort);
      return;
    }
    if (this.raumVon(a) !== this.raumVon(b)) {
      this.konflikt("room-change-without-crossing", ort);
      return;
    }
    if (a.typ === "wand" && b.typ === "wand") {
      this.wandschritt(a, b, ort);
    } else if (a.typ === "flaeche" && b.typ === "flaeche") {
      if (a.flaeche !== b.flaeche) {
        this.konflikt("surface-change-not-allowed", ort);
        return;
      }
      const lauf = this.flaechenlauf(a.flaeche, a.raumId, a.punkt, b.punkt, ort);
      if (lauf !== null) this.hinzufuegen(a.flaeche, ort, a.raumId, [lauf], lauf.laengeMm);
    } else {
      const [wand, flaeche] = a.typ === "wand" ? [a, b as FlaechenOrt] : [b as WandOrt, a];
      this.uebergangWandFlaeche(wand, flaeche, ort);
    }
  }

  raumVon(ort: WandOrt | FlaechenOrt): string {
    return ort.typ === "wand" ? this.wand(ort.wandId).raum.id : ort.raumId;
  }

  wandschritt(a: WandOrt, b: WandOrt, ort: string): void {
    if (a.wandId === b.wandId) {
      const lauf = this.wandlauf(a, b);
      if (lauf === null) {
        this.konflikt("wall-diagonal", ort);
        return;
      }
      if (this.oeffnungGetroffen(a.wandId, a.lage, b.lage, a.hoeheMm, b.hoeheMm)) {
        this.konflikt("wall-through-opening", ort);
        return;
      }
      this.hinzufuegen("wall", ort, a.wandId, [lauf], lauf.laengeMm);
      return;
    }
    const erste = this.wand(a.wandId);
    const zweite = this.wand(b.wandId);
    const m1 = erste.teilung.mass;
    const m2 = zweite.teilung.mass;
    const vorwaerts =
      gleichePunkte(erste.wand.ende, zweite.wand.start) &&
      vergleichen(a.lage, ganzeLage(erste.laengeMm), m1) === 0 &&
      vergleichen(b.lage, ganzeLage(0), m2) === 0;
    const rueckwaerts =
      gleichePunkte(erste.wand.start, zweite.wand.ende) &&
      vergleichen(a.lage, ganzeLage(0), m1) === 0 &&
      vergleichen(b.lage, ganzeLage(zweite.laengeMm), m2) === 0;
    if ((vorwaerts || rueckwaerts) && a.hoeheMm === b.hoeheMm) {
      this.hinzufuegen("corner", ort, b.wandId);
      return;
    }
    this.konflikt("wall-change-without-corner", ort);
  }

  uebergangWandFlaeche(wand: WandOrt, flaeche: FlaechenOrt, ort: string): void {
    const info = this.wand(wand.wandId);
    const decke = flaeche.flaeche === "ceiling";
    const erwartet = decke ? info.raum.hoeheMm : 0;
    const stelle = wandlageVon(info, flaeche.punkt);
    if (wand.hoeheMm === erwartet && stelle !== null && vergleichen(stelle, wand.lage, info.teilung.mass) === 0) {
      this.hinzufuegen(decke ? "wall-ceiling" : "wall-floor", ort, wand.wandId);
      return;
    }
    this.konflikt(decke ? "wall-ceiling-transition" : "wall-floor-transition", ort);
  }
}

function umkehren(lauf: Wandlauf): Wandlauf {
  return {
    ...lauf,
    vonLage: lauf.bisLage,
    vonHoeheMm: lauf.bisHoeheMm,
    bisLage: lauf.vonLage,
    bisHoeheMm: lauf.vonHoeheMm,
  };
}

function seiteWaehlen(
  item: Zweiseitig,
  davor: string | null,
  danach: string | null,
): [WandOrt | FlaechenOrt, WandOrt | FlaechenOrt] | null {
  const [erste, zweite] = item.seiten;
  const schluessel = [besitzerSchluessel(erste), besitzerSchluessel(zweite)];
  if (davor !== null && schluessel.includes(davor)) return davor === schluessel[0] ? [erste, zweite] : [zweite, erste];
  if (danach !== null && schluessel.includes(danach)) return danach === schluessel[0] ? [zweite, erste] : [erste, zweite];
  return null;
}

function uebergangsSeiten(
  item: Zweiseitig,
  davor: string | null,
  danach: string | null,
): [WandOrt | FlaechenOrt, WandOrt | FlaechenOrt] | null {
  const [erste, zweite] = item.seiten;
  const schluessel = [besitzerSchluessel(erste), besitzerSchluessel(zweite)];
  if (davor === null || danach === null || davor === danach || !schluessel.includes(davor) || !schluessel.includes(danach)) {
    return null;
  }
  return davor === schluessel[0] ? [erste, zweite] : [zweite, erste];
}

function nachbarSchluessel(
  wp: Wegpunkt | null,
  ort: Ort | Zweiseitig | Steigwegnutzung | null,
  art: Zweiseitig["art"],
): string | null {
  if (art === "penetration") {
    if (ort !== null && ort.typ === "wand") return ort.wandId;
    return wp !== null && wp.art === "wand" ? wp.wandId : null;
  }
  if (ort !== null && ort.typ === "flaeche" && ort.flaeche === "floor") return ort.raumId;
  if (wp !== null && wp.art === "floor" && ort === null) return wp.raumId;
  return null;
}

/** Weg, Teilstrecken, Status und Längen einer Leitung - Spiegel von `analyse_cable`. */
export function leitungAuswerten(vorbereitet: VorbereiteterPlan, leitung: Leitung): Leitungsergebnis {
  const weg = new Weg(vorbereitet);
  const start = weg.geraeteOrt(leitung.startGeraetId, "start");
  const ende = weg.geraeteOrt(leitung.endGeraetId, "end");
  const wegpunkte = leitung.wegpunkte;
  const anzahl = wegpunkte.length;
  const aufgeloest = wegpunkte.map((wp, i) => weg.aufloesen(i, wp));

  const eintritte: (Ort | null)[] = [];
  const austritte: (Ort | null)[] = [];
  const innen: (readonly Leitungsstrecke[] | null)[] = [];
  aufgeloest.forEach((item, i) => {
    const ort = `w${i}`;
    if (item !== null && item.typ === "zweiseitig") {
      const davorOrt = i > 0 ? (austritte[i - 1] ?? null) : start;
      const danachWp = i + 1 < anzahl ? (wegpunkte[i + 1] ?? null) : null;
      const danachOrt = i + 1 < anzahl ? (aufgeloest[i + 1] ?? null) : ende;
      const davor = nachbarSchluessel(i > 0 ? (wegpunkte[i - 1] ?? null) : null, davorOrt, item.art);
      const danach = nachbarSchluessel(danachWp, danachOrt, item.art);
      const gewaehlt = item.art === "penetration" ? seiteWaehlen(item, davor, danach) : uebergangsSeiten(item, davor, danach);
      if (gewaehlt === null) {
        weg.konflikt(item.art === "penetration" ? "penetration-sequence" : "opening-crossing-sequence", ort);
        eintritte.push(null);
        austritte.push(null);
        innen.push(null);
        return;
      }
      eintritte.push(gewaehlt[0]);
      austritte.push(gewaehlt[1]);
      innen.push([{ art: item.art, ort, besitzerId: item.besitzerId, laeufe: [], laengeMm: 0, bekanntMm: 0 }]);
    } else if (item !== null && item.typ === "nutzung") {
      eintritte.push(item.eintritt);
      austritte.push(item.austritt);
      innen.push(item.strecken);
    } else {
      eintritte.push(item);
      austritte.push(item);
      innen.push(null);
    }
  });

  if (anzahl === 0) {
    weg.fehlt("route-empty", "route");
  } else {
    const ersterEintritt = eintritte[0] ?? null;
    if (start !== null && ersterEintritt !== null) weg.anschliessen(start, ersterEintritt, "start");
    for (let i = 0; i < anzahl; i += 1) {
      const strecken = innen[i];
      if (strecken !== null && strecken !== undefined) weg.strecken.push(...strecken);
      if (i + 1 < anzahl) {
        const links = austritte[i] ?? null;
        const rechts = eintritte[i + 1] ?? null;
        if (links !== null && rechts !== null) weg.schritt(links, rechts, `w${i}-w${i + 1}`);
      }
    }
    const letzterAustritt = austritte[anzahl - 1] ?? null;
    if (ende !== null && letzterAustritt !== null) weg.anschliessen(ende, letzterAustritt, "end");
  }

  const geometrisch = weg.strecken.reduce((s, x) => s + x.bekanntMm, 0);
  const status: Leitungsstatus = weg.befunde.some((b) => b.art === "conflict")
    ? "conflict"
    : weg.befunde.length > 0
      ? "incomplete"
      : "confirmed";
  const anschlusszugaben = leitung.startzugabeMm + leitung.endzugabeMm;
  const reserve =
    leitung.reserveProzent === null
      ? leitung.reserveMm
      : status === "confirmed"
        ? prozentReserveMm(geometrisch, leitung.reserveProzent)
        : null;
  const zugaben = anschlusszugaben + (reserve ?? 0);
  const durchfuehrungen: string[] = [];
  for (const s of weg.strecken) {
    if (s.art === "penetration" && !durchfuehrungen.includes(s.besitzerId)) durchfuehrungen.push(s.besitzerId);
  }
  return {
    leitungId: leitung.id,
    strecken: weg.strecken,
    geometrischMm: geometrisch,
    zugabenMm: zugaben,
    anschlusszugabenMm: anschlusszugaben,
    reserveMm: reserve,
    reserveOffen: reserve === null,
    status,
    laengeMm: status === "confirmed" ? geometrisch + zugaben : null,
    bekanntMm: geometrisch + zugaben,
    vollstaendigSpezifiziert: leitung.kabeltyp !== null && leitung.leiterzahl !== null && leitung.querschnittMm2 !== null,
    befunde: weg.befunde,
    durchfuehrungen,
    bodenuebergaenge: weg.strecken.filter((s) => s.art === "opening-crossing").length,
  };
}

export function leitungenAuswerten(plan: Leitungsplan, leitungen: readonly Leitung[]): Leitungsergebnis[] {
  const vorbereitet = planVorbereiten(plan);
  return leitungen.map((l) => leitungAuswerten(vorbereitet, l));
}

/** Text zu einem Befundcode. */
export function leitungsbefundText(code: string): string {
  return LEITUNG_BEFUND_TEXT[code] ?? code;
}
