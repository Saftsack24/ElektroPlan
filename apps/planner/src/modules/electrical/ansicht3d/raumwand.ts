/**
 * Raumseitige Wand in der 3D-Ansicht (Phase 4f) - reine Ableitung.
 *
 * Die Szene besteht aus **Wandkörpern je atomarem Abschnitt** (ADR 0016,
 * 4b.2): Eine lange Wand des großen Raums, an der zwei kleinere Räume liegen,
 * ist in der Szene zwei Körper. Wählt man sie vom großen Raum aus, ist aber
 * die **ganze Wand dieses Raums** gemeint - die eine gespeicherte Wand, nicht
 * der Abschnitt hinter einem bestimmten Nachbarn.
 *
 * Diese Schicht unterscheidet deshalb:
 *
 * * die **Raumwand**: die gespeicherte Wand eines Raums (`LogischeWand`) mit
 *   voller Länge - Auswahlziel `{ art: "raumwand", id: <Wand-ID> }`,
 * * ihre **Abschnitte**: die Wandkörper, die sie überdeckt, mit den
 *   angrenzenden Räumen - weiter wichtig für Topologie, Öffnungsspiegelung und
 *   Deckenhöhen, aber keine Grenze der Auswahl.
 *
 * Es wird **keine** Raumwand über mehrere Räume zusammengefasst und keine
 * physische Wandidentität angelegt (T10 bleibt offen).
 *
 * **Fassade** (Nachtrag): Von **außen** angeklickt, ist bei einer Außenwand die
 * durchgehende Fassade gemeint - auch wenn mehrere Räume dahinter liegen.
 * Eine Fassade ist eine reine Ansichtsgruppe: nicht geteilte Abschnitte
 * (`lage = "aussen"`) auf **derselben** exakten Geraden, die lückenlos
 * aneinanderstoßen (Ende des einen = Anfang des nächsten, ganze Millimeter).
 * Sie endet an Gebäudeecken (andere Gerade), an Lücken und an gemeinsamen
 * Abschnitten. Türen und Fenster teilen keine Abschnitte und unterbrechen sie
 * deshalb nicht. Für die Wandansicht wird der angeklickte Abschnitt
 * mitgegeben; ohne ihn bietet die Seitenleiste die Raumwahl an.
 *
 * **Welche Raumseite wurde angeklickt?** Die Szene liefert die Normale der
 * getroffenen Fläche. Zeigt sie quer zur Wand, liegt die angeklickte Seite
 * links oder rechts der kanonischen Abschnittsrichtung; dort liegt genau der
 * Raum, dessen Inneres auf dieser Seite ist (Umlaufsinn: gegen den
 * Uhrzeigersinn → innen links der Wandrichtung). Trifft der Klick die Krone
 * oder eine Stirnseite einer **gemeinsamen** Wand, ist die Seite nicht
 * bestimmbar: Dann wird nichts geraten, sondern die Raumwahl angeboten
 * (`{ art: "wandseite", id: <Abschnitts-ID> }`).
 */
import type { Auswahl, LogischeWand, PunktMm, Raum3d, Wand3d } from "./modell";

export interface Fassadenabschnitt {
  /** ID des Wandkörpers (`Wand3d.id`). */
  readonly id: string;
  readonly raumId: string;
  /** Die gespeicherte Wand dieses Raums, die den Abschnitt trägt. */
  readonly wandId: string;
  /** Lage entlang der Fassade, ab ihrem kanonischen Anfang. */
  readonly vonMm: number;
  readonly bisMm: number;
}

export interface Fassade3d {
  /** Stabil: die sortierten Abschnitts-IDs. */
  readonly id: string;
  readonly laengeMm: number;
  readonly abschnitte: readonly Fassadenabschnitt[];
  readonly oeffnungIds: readonly string[];
}

const gleich = (a: PunktMm, b: PunktMm) => a.x === b.x && a.y === b.y;

/** Durchgehende, geradlinige Außenwände - abgeleitet, nie gespeichert. */
export function fassadenAus(waende: readonly Wand3d[]): Fassade3d[] {
  const nachGerade = new Map<string, Wand3d[]>();
  for (const w of waende) {
    if (w.lage !== "aussen" || w.quellen.length === 0) continue;
    nachGerade.set(w.gerade, [...(nachGerade.get(w.gerade) ?? []), w]);
  }
  const fassaden: Fassade3d[] = [];
  for (const schluessel of [...nachGerade.keys()].sort()) {
    // Kanonische Richtung: lexikografisch kleinerer Punkt zuerst - auf einer
    // Geraden ist die Reihenfolge der Anfänge damit die Lage entlang der Linie.
    const reihe = [...(nachGerade.get(schluessel) as Wand3d[])].sort(
      (a, b) => a.start.x - b.start.x || a.start.y - b.start.y,
    );
    let kette: Wand3d[] = [];
    const abschliessen = () => {
      if (kette.length === 0) return;
      const anfang = (kette[0] as Wand3d).start;
      const abschnitte = kette.map((w) => {
        const q = w.quellen[0] as LogischeWand;
        return {
          id: w.id,
          raumId: q.raumId,
          wandId: q.id,
          vonMm: Math.round(laenge(anfang, w.start)),
          bisMm: Math.round(laenge(anfang, w.ende)),
        };
      });
      fassaden.push({
        id: kette.map((w) => w.id).sort().join("|"),
        laengeMm: Math.round(laenge(anfang, (kette[kette.length - 1] as Wand3d).ende)),
        abschnitte,
        oeffnungIds: [...new Set(kette.flatMap((w) => w.oeffnungen.map((o) => o.id)))].sort(),
      });
      kette = [];
    };
    for (const w of reihe) {
      const letzte = kette[kette.length - 1];
      if (letzte !== undefined && !gleich(letzte.ende, w.start)) abschliessen();
      kette.push(w);
    }
    abschliessen();
  }
  return fassaden;
}

export interface Raumwandabschnitt {
  /** ID des Wandkörpers (`Wand3d.id`). */
  readonly id: string;
  /** Lage auf der Raumwand, ab ihrem Anfang - nur zur Anzeige gerundet. */
  readonly vonMm: number;
  readonly bisMm: number;
  /** Andere Räume auf diesem Abschnitt (sortiert). */
  readonly nachbarn: readonly string[];
  readonly mehrdeutig: boolean;
}

export interface Raumwand3d {
  /** ID der gespeicherten Wand. */
  readonly id: string;
  readonly raumId: string;
  /** Position in der Raumkontur, ab 1 - wie „Wand n“ im Grundriss. */
  readonly nummer: number;
  readonly laengeMm: number;
  readonly staerkeMm: number;
  readonly hoeheMm: number;
  readonly abschnitte: readonly Raumwandabschnitt[];
  /** Eigene und aus Nachbarräumen abgeleitete Öffnungen auf dieser Wand - je ID einmal. */
  readonly oeffnungIds: readonly string[];
}

function laenge(a: PunktMm, b: PunktMm): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Innen links der Wandrichtung? (Kontur gegen den Uhrzeigersinn.) */
export function innenLinks(raum: Pick<Raum3d, "kontur">): boolean {
  let summe = 0;
  const k = raum.kontur;
  for (let i = 0; i < k.length; i += 1) {
    const a = k[i] as PunktMm;
    const b = k[(i + 1) % k.length] as PunktMm;
    summe += a.x * b.y - b.x * a.y;
  }
  return summe > 0;
}

export function raumwaendeAus(
  raeume: readonly Raum3d[],
  logisch: readonly LogischeWand[],
  waende: readonly Wand3d[],
): Raumwand3d[] {
  const nummern = new Map<string, number>();
  const zaehler = new Map<string, number>();
  for (const w of logisch) {
    const n = (zaehler.get(w.raumId) ?? 0) + 1;
    zaehler.set(w.raumId, n);
    nummern.set(w.id, n);
  }
  const raumIds = new Set(raeume.map((r) => r.id));
  return logisch
    .filter((w) => raumIds.has(w.raumId))
    .map((w) => {
      const eigene = waende.filter((k) => k.quellen.some((q) => q.id === w.id));
      const abschnitte = eigene
        .map((k) => {
          const a = laenge(w.start, k.start);
          const b = laenge(w.start, k.ende);
          return {
            id: k.id,
            vonMm: Math.round(Math.min(a, b)),
            bisMm: Math.round(Math.max(a, b)),
            nachbarn: k.raumIds.filter((r) => r !== w.raumId),
            mehrdeutig: k.raumIds.length > 2,
          };
        })
        .sort((x, y) => x.vonMm - y.vonMm);
      const oeffnungIds = [...new Set(eigene.flatMap((k) => k.oeffnungen.map((o) => o.id)))].sort();
      return {
        id: w.id,
        raumId: w.raumId,
        nummer: nummern.get(w.id) ?? 0,
        laengeMm: Math.round(laenge(w.start, w.ende)),
        staerkeMm: w.staerkeMm,
        hoeheMm: w.raumhoeheMm,
        abschnitte,
        oeffnungIds,
      };
    });
}

/** Normale der getroffenen Fläche im Grundriss (x, y) und ihr Höhenanteil. */
export interface Trefferflaeche {
  readonly x: number;
  readonly y: number;
  readonly hoehe: number;
}

/**
 * Die Auswahl zu einem Treffer auf einem Wandkörper - die ganze Raumwand der
 * angeklickten Seite, oder die ausdrückliche Raumwahl, wenn sie nicht
 * eindeutig ist.
 */
export function raumseiteAuswahl(
  wand: Wand3d,
  raeume: readonly Raum3d[],
  flaeche: Trefferflaeche,
  fassadeVon: (abschnittId: string) => string | undefined = () => undefined,
): Auswahl {
  const quellen = wand.quellen;
  const raumIds = [...new Set(quellen.map((q) => q.raumId))];

  const dx = wand.ende.x - wand.start.x;
  const dy = wand.ende.y - wand.start.y;
  const l = Math.hypot(dx, dy) || 1;
  const quer = (flaeche.x * -dy + flaeche.y * dx) / l; // > 0: linke Seite der kanonischen Richtung
  const entlang = Math.abs((flaeche.x * dx + flaeche.y * dy) / l);
  const seitlich = Math.abs(quer) > 0.5 && entlang < 0.5 && Math.abs(flaeche.hoehe) < 0.5;
  const links = quer > 0;
  const innen = new Map(raeume.map((r) => [r.id, innenLinks(r)] as const));
  const innenseiteLinks = (q: LogischeWand) => {
    const gleichgerichtet = (q.ende.x - q.start.x) * dx + (q.ende.y - q.start.y) * dy > 0;
    return gleichgerichtet === (innen.get(q.raumId) ?? true);
  };

  // Nur ein Raum am Abschnitt: von innen dessen Wand, von außen die Fassade.
  if (raumIds.length === 1) {
    const q = quellen[0] as LogischeWand;
    const fassade = wand.lage === "aussen" ? fassadeVon(wand.id) : undefined;
    if (fassade === undefined) return { art: "raumwand", id: q.id };
    // Krone oder Stirnseite einer Außenwand: innen oder außen? Nicht raten.
    if (!seitlich) return { art: "wandseite", id: wand.id };
    return innenseiteLinks(q) === links ? { art: "raumwand", id: q.id } : { art: "fassade", id: fassade, abschnitt: wand.id };
  }
  if (!seitlich) return { art: "wandseite", id: wand.id };

  const treffer = quellen.filter((q) => {
    return innenseiteLinks(q) === links;
  });
  const raeumeDerSeite = [...new Set(treffer.map((q) => q.raumId))];
  if (raeumeDerSeite.length !== 1) return { art: "wandseite", id: wand.id };
  // Zwei Wände desselben Raums auf einem Abschnitt (Doppelung): die erste nach ID.
  const gewaehlt = [...treffer].sort((a, b) => (a.id < b.id ? -1 : 1))[0] as LogischeWand;
  return { art: "raumwand", id: gewaehlt.id };
}
