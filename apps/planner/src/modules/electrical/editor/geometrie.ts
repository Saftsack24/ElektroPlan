/**
 * Ganzzahlige Raumgeometrie im Browser - ein **Spiegel** der Serverregeln.
 *
 * Vorlage ist `apps/backend/app/modules/electrical/geometry.py` (ADR 0013).
 * Der Spiegel dient ausschließlich der unmittelbaren Rückmeldung beim
 * Zeichnen: Längen, Fläche und die Markierung offensichtlicher Fehler. Die
 * **verbindliche** Prüfung bleibt serverseitig; der Editor speichert immer
 * über den Server und übernimmt dessen Antwort.
 *
 * Gegen stillen Drift sichert eine gemeinsame, versionierte Beispielsammlung
 * (`testdata/geometry/raumgeometrie.v1.json`), die Backend- und Frontendtests
 * gleichermaßen prüfen.
 *
 * **Einheiten.** Alles in ganzen Millimetern. Die Rechnung bleibt exakt, weil
 * alle Zwischenwerte weit unter 2^53 liegen: Koordinaten sind auf ±1 km
 * begrenzt, Quadrate von Differenzen also auf 8·10^12.
 */

export interface Punkt {
  readonly x: number;
  readonly y: number;
}

/** Gerichtetes Wandsegment mit stabilem Schlüssel (der Wand-ID). */
export interface Segment {
  readonly key: string;
  readonly start: Punkt;
  readonly ende: Punkt;
}

export interface Befund {
  readonly code: string;
  readonly keys: readonly string[];
}

export const MIN_KOORDINATE_MM = -1_000_000;
export const MAX_KOORDINATE_MM = 1_000_000;
export const MIN_WANDLAENGE_MM = 100;
export const MAX_WANDLAENGE_MM = 100_000;
export const MIN_KONTUR_WAENDE = 3;

// ------------------------------------------------------------ Streckenlänge

/** Exakte ganzzahlige Quadratwurzel (abgerundet) einer nicht negativen Zahl. */
export function ganzzahligeWurzel(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError("Die Wurzel wird nur aus nicht negativen ganzen Zahlen gezogen.");
  }
  let wurzel = Math.floor(Math.sqrt(n));
  // Math.sqrt kann bei großen Werten um eins daneben liegen - korrigieren.
  while (wurzel * wurzel > n) wurzel -= 1;
  while ((wurzel + 1) * (wurzel + 1) <= n) wurzel += 1;
  return wurzel;
}

/** `round(sqrt(n))` rein ganzzahlig - identisch zu `rounded_sqrt` im Backend. */
export function gerundeteWurzel(n: number): number {
  return Math.floor((ganzzahligeWurzel(4 * n) + 1) / 2);
}

/** Länge in ganzen Millimetern, kaufmännisch gerundet (ADR 0013). */
export function streckenlaenge(start: Punkt, ende: Punkt): number {
  const dx = ende.x - start.x;
  const dy = ende.y - start.y;
  return gerundeteWurzel(dx * dx + dy * dy);
}

export function gleich(a: Punkt, b: Punkt): boolean {
  return a.x === b.x && a.y === b.y;
}

// ------------------------------------------------------ Lage zweier Segmente

function drehsinn(a: Punkt, b: Punkt, c: Punkt): -1 | 0 | 1 {
  const wert = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return wert > 0 ? 1 : wert < 0 ? -1 : 0;
}

function aufStrecke(p: Punkt, a: Punkt, b: Punkt): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/** Haben zwei Segmente einen gemeinsamen Punkt? Berührung zählt. */
export function schneiden(a: Segment, b: Segment): boolean {
  const o1 = drehsinn(a.start, a.ende, b.start);
  const o2 = drehsinn(a.start, a.ende, b.ende);
  const o3 = drehsinn(b.start, b.ende, a.start);
  const o4 = drehsinn(b.start, b.ende, a.ende);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && aufStrecke(b.start, a.start, a.ende)) ||
    (o2 === 0 && aufStrecke(b.ende, a.start, a.ende)) ||
    (o3 === 0 && aufStrecke(a.start, b.start, b.ende)) ||
    (o4 === 0 && aufStrecke(a.ende, b.start, b.ende))
  );
}

function nachbarSauber(erste: Segment, zweite: Segment): boolean {
  if (drehsinn(erste.start, erste.ende, zweite.ende) !== 0) return true;
  const vorwaerts =
    (erste.ende.x - erste.start.x) * (zweite.ende.x - zweite.start.x) +
    (erste.ende.y - erste.start.y) * (zweite.ende.y - zweite.start.y);
  return vorwaerts > 0;
}

// ------------------------------------------------------------------ Fläche

export function doppelteFlaeche(punkte: readonly Punkt[]): number {
  let summe = 0;
  for (let i = 0; i < punkte.length; i += 1) {
    const a = punkte[i] as Punkt;
    const b = punkte[(i + 1) % punkte.length] as Punkt;
    summe += a.x * b.y - b.x * a.y;
  }
  return summe;
}

/** Fläche in mm², gerundet wie im Backend (halbe mm² aufwärts). */
export function flaecheMm2(punkte: readonly Punkt[]): number {
  return Math.floor((Math.abs(doppelteFlaeche(punkte)) + 1) / 2);
}

export function umfangMm(segmente: readonly Segment[]): number {
  return segmente.reduce((summe, s) => summe + streckenlaenge(s.start, s.ende), 0);
}

// ------------------------------------------------------------ Konturprüfung

function segmentBefunde(s: Segment): Befund[] {
  if (gleich(s.start, s.ende)) return [{ code: "wall-degenerate", keys: [s.key] }];
  const befunde: Befund[] = [];
  const imBereich = (p: Punkt) =>
    p.x >= MIN_KOORDINATE_MM &&
    p.x <= MAX_KOORDINATE_MM &&
    p.y >= MIN_KOORDINATE_MM &&
    p.y <= MAX_KOORDINATE_MM;
  if (!imBereich(s.start) || !imBereich(s.ende)) {
    befunde.push({ code: "coordinate-out-of-range", keys: [s.key] });
  }
  const laenge = streckenlaenge(s.start, s.ende);
  if (laenge < MIN_WANDLAENGE_MM || laenge > MAX_WANDLAENGE_MM) {
    befunde.push({ code: "wall-length-implausible", keys: [s.key] });
  }
  return befunde;
}

function ungeordneteEnden(s: Segment): string {
  const a = `${s.start.x},${s.start.y}`;
  const b = `${s.ende.x},${s.ende.y}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Entwurfsregeln - identisch zu `draft_problems` im Backend. */
export function entwurfsBefunde(segmente: readonly Segment[]): Befund[] {
  const befunde = segmente.flatMap(segmentBefunde);
  if (befunde.length > 0) return befunde;

  const gesehen = new Map<string, string>();
  for (const s of segmente) {
    const schluessel = ungeordneteEnden(s);
    const vorher = gesehen.get(schluessel);
    if (vorher !== undefined) {
      befunde.push({ code: "wall-duplicate", keys: [vorher, s.key] });
    } else {
      gesehen.set(schluessel, s.key);
    }
  }

  const n = segmente.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = segmente[i] as Segment;
      const b = segmente[j] as Segment;
      const nachbarn = j === i + 1 || (n >= MIN_KONTUR_WAENDE && i === 0 && j === n - 1);
      if (nachbarn) {
        const geordnet: [Segment, Segment] | null = gleich(a.ende, b.start)
          ? [a, b]
          : gleich(b.ende, a.start)
            ? [b, a]
            : null;
        if (geordnet === null) {
          if (schneiden(a, b)) befunde.push({ code: "walls-intersect", keys: [a.key, b.key] });
        } else if (!nachbarSauber(geordnet[0], geordnet[1])) {
          befunde.push({ code: "wall-backtracks", keys: [a.key, b.key] });
        }
      } else if (schneiden(a, b)) {
        befunde.push({ code: "walls-intersect", keys: [a.key, b.key] });
      }
    }
  }
  return befunde;
}

/** Zusatzregeln der geschlossenen Kontur - identisch zu `closed_contour_problems`. */
export function konturBefunde(segmente: readonly Segment[]): Befund[] {
  if (segmente.length < MIN_KONTUR_WAENDE) return [{ code: "contour-too-few-walls", keys: [] }];
  const befunde: Befund[] = [];
  for (let i = 0; i < segmente.length - 1; i += 1) {
    const a = segmente[i] as Segment;
    const b = segmente[i + 1] as Segment;
    if (!gleich(a.ende, b.start)) befunde.push({ code: "contour-gap", keys: [a.key, b.key] });
  }
  const erste = segmente[0] as Segment;
  const letzte = segmente[segmente.length - 1] as Segment;
  if (!gleich(letzte.ende, erste.start)) {
    befunde.push({ code: "contour-not-closed", keys: [letzte.key, erste.key] });
  }
  if (befunde.length === 0 && doppelteFlaeche(segmente.map((s) => s.start)) === 0) {
    befunde.push({ code: "contour-without-area", keys: [] });
  }
  return befunde;
}

export interface Konturbericht {
  readonly status: "draft" | "valid";
  readonly befunde: readonly Befund[];
  readonly flaecheMm2: number | null;
  readonly umfangMm: number | null;
}

/** Abgeleiteter Konturzustand - identisch zu `contour_report`. */
export function konturbericht(segmente: readonly Segment[]): Konturbericht {
  const befunde = [...entwurfsBefunde(segmente), ...konturBefunde(segmente)];
  if (befunde.length > 0) {
    return {
      status: "draft",
      befunde,
      flaecheMm2: null,
      umfangMm: segmente.length > 0 ? umfangMm(segmente) : null,
    };
  }
  return {
    status: "valid",
    befunde: [],
    flaecheMm2: flaecheMm2(segmente.map((s) => s.start)),
    umfangMm: umfangMm(segmente),
  };
}

// ---------------------------------------------------------------- Öffnungen

export interface Abschnitt {
  readonly key: string;
  readonly abstand: number;
  readonly breite: number;
}

/**
 * Öffnung gegen ihre Wand und die übrigen Öffnungen - wie `opening_problems`.
 * Berührung an der Kante ist erlaubt, echte Überdeckung nicht.
 */
export function oeffnungsBefunde(
  oeffnung: Abschnitt,
  wandlaenge: number,
  andere: readonly Abschnitt[],
): Befund[] {
  const befunde: Befund[] = [];
  if (oeffnung.breite <= 0) befunde.push({ code: "opening-width-not-positive", keys: [oeffnung.key] });
  if (oeffnung.abstand < 0) befunde.push({ code: "opening-offset-negative", keys: [oeffnung.key] });
  if (befunde.length > 0) return befunde;
  const ende = oeffnung.abstand + oeffnung.breite;
  if (ende > wandlaenge) befunde.push({ code: "opening-exceeds-wall", keys: [oeffnung.key] });
  for (const anderer of andere) {
    if (anderer.key === oeffnung.key) continue;
    if (oeffnung.abstand < anderer.abstand + anderer.breite && anderer.abstand < ende) {
      befunde.push({ code: "openings-overlap", keys: [oeffnung.key, anderer.key] });
    }
  }
  return befunde;
}
