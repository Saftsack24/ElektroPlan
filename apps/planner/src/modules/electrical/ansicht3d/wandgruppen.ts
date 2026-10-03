/**
 * Wandkörper der 3D-Ansicht aus atomaren Wandabschnitten (T9, ADR 0016,
 * präzisiert in Phase 4b.2).
 *
 * Die Erkennung selbst steckt in der gemeinsamen, reinen Topologieschicht
 * (`topologie/wandtopologie.ts`, `topologie/oeffnungen.ts`), die auch der
 * 2D-Editor verwendet. Hier wird daraus die Darstellung:
 *
 * * **ein Wandkörper je atomarem Abschnitt** - eine lange Flurwand neben drei
 *   kurzen Raumwänden wird also abschnittsweise genau einmal extrudiert;
 *   nicht geteilte Reststücke bleiben eigene Körper,
 * * freie Enden werden um die halbe Stärke verlängert, Stöße auf derselben
 *   Geraden nicht (sonst lägen dort Körper übereinander und flimmerten),
 * * eine einmal gespeicherte Öffnung schneidet den gemeinsamen Körper über
 *   die volle Stärke; ihre zweite Raumseite ist abgeleitet,
 * * Konflikte in den **gespeicherten** Daten werden als Warnung mit der
 *   Darstellungsregel gemeldet - nichts wird bereinigt.
 *
 * Alle Entscheidungen fallen exakt auf ganzen Millimetern bzw. exakten Lagen
 * (`topologie/lage.ts`); erst das fertige Rechteck wird für die Darstellung
 * auf ganze Millimeter gerundet.
 */
import type { LokalerBereich, Oeffnungseinordnung } from "../topologie/oeffnungen";
import { bereicheUeberlappen, lokalerBereich, oeffnungenEinordnen } from "../topologie/oeffnungen";
import type { Wandabschnitt } from "../topologie/wandtopologie";
import { wandtopologie } from "../topologie/wandtopologie";
import { alsZahl, ganzeLage, gleicheLage, minus } from "../topologie/lage";
import { OEFFNUNGSART_LABEL } from "../texte";
import type {
  LogischeWand,
  Oeffnung3d,
  Oeffnungsart,
  Oeffnungsquelle,
  Wand3d,
  Warnung,
  Warnungscode,
} from "./modell";
import { auswahlSchluessel, gruppenId } from "./modell";
import type { Auswahl } from "./modell";
import type { Wandrechteck } from "./wandzerlegung";
import { beschneiden, ueberlappen, wandZerlegen } from "./wandzerlegung";

export { kanonisch } from "../topologie/wandtopologie";

// -------------------------------------------------------------- Warnungen

export type RaumName = (raumId: string) => string;

/**
 * Die ID ergibt sich aus Code und Bezug; `zusatz` unterscheidet Befunde mit
 * demselben Bezug (etwa mehrere nicht darstellbare Öffnungen einer Wand).
 */
export function warnung(
  code: Warnungscode,
  titel: string,
  text: string,
  bezug: readonly Auswahl[],
  zusatz?: string,
): Warnung {
  const id = `${code}|${bezug.map(auswahlSchluessel).join("|")}${zusatz === undefined ? "" : `|${zusatz}`}`;
  return { id, code, titel, text, bezug };
}

/**
 * Formatiert Längen in Hinweistexten - in der Anzeigeeinheit des Benutzers
 * (`core/masse.ts`). Gerechnet und gruppiert wird unverändert in Millimetern;
 * nur der Text hängt von der Einheit ab.
 */
export type Laengentext = (mm: number) => string;

export const MM_TEXT: Laengentext = (wert) => `${wert.toLocaleString("de-DE")} mm`;

function oeffnungText(q: Oeffnungsquelle, mm: Laengentext): string {
  const bruestung = q.bruestungMm > 0 ? `, Brüstung ${mm(q.bruestungMm)}` : "";
  return `${OEFFNUNGSART_LABEL[q.art]} ${mm(q.breiteMm)} × ${mm(q.hoeheMm)}, Abstand ${mm(q.offsetMm)}${bruestung}`;
}

function liste(namen: readonly string[]): string {
  const zitiert = namen.map((n) => `„${n}“`);
  if (zitiert.length <= 1) return zitiert.join("");
  return `${zitiert.slice(0, -1).join(", ")} und ${zitiert[zitiert.length - 1] ?? ""}`;
}

// ------------------------------------------------------------- Prüfungen

/** Eine erfasste Öffnung passt in ihre Wand und unter ihre Raumhöhe? */
function oeffnungPasst(q: Oeffnungsquelle, laengeMm: number, raumhoeheMm: number): boolean {
  const ganz = [q.offsetMm, q.breiteMm, q.hoeheMm, q.bruestungMm].every(Number.isSafeInteger);
  return (
    ganz &&
    q.breiteMm > 0 &&
    q.hoeheMm > 0 &&
    q.offsetMm >= 0 &&
    q.bruestungMm >= 0 &&
    q.offsetMm + q.breiteMm <= laengeMm &&
    q.bruestungMm + q.hoeheMm <= raumhoeheMm
  );
}

// ------------------------------------------------------------ Wandkörper

export interface Gruppierung {
  readonly waende: Wand3d[];
  readonly warnungen: Warnung[];
}

interface Kandidat {
  readonly quelle: Oeffnungsquelle;
  /** Exakter waagerechter Bereich im Abschnitt - Grundlage jeder Gleichheit. */
  readonly bereich: LokalerBereich;
  /** Auf ganze Millimeter gerundet und auf den Abschnitt beschnitten - nur Darstellung. */
  readonly rechteck: Wandrechteck;
}

/**
 * Bildet die Wandkörper **eines** Geschosses. Wände mit anderem Geschoss
 * gehören nicht in denselben Aufruf; der Geradenschlüssel enthält das
 * Geschoss trotzdem, damit eine Vermischung nie zu einer Gruppe führt.
 */
export function wandGruppieren(
  floorId: string,
  waende: readonly LogischeWand[],
  raumName: RaumName,
  mm: Laengentext = MM_TEXT,
): Gruppierung {
  const topologie = wandtopologie(floorId, waende);
  const einordnung = oeffnungenEinordnen(topologie);
  const warnungen = new Map<string, Warnung>();
  const melden = (w: Warnung) => warnungen.set(w.id, w);

  // Ungültige Öffnungen einmal je Wand melden und nicht darstellen.
  const ungueltig = new Set<string>();
  for (const teilung of topologie.teilung.values()) {
    const wandRef: Auswahl = { art: "wand", id: (teilung.abschnitte[0] as Wandabschnitt<LogischeWand>).id };
    for (const q of teilung.wand.oeffnungen) {
      if (oeffnungPasst(q, teilung.laengeMm, teilung.wand.raumhoeheMm)) continue;
      ungueltig.add(q.oeffnungId);
      melden(
        warnung(
          "oeffnung-ungueltig",
          "Öffnung nicht darstellbar",
          `Eine Öffnung in „${raumName(teilung.wand.raumId)}“ (${oeffnungText(q, mm)}) passt nicht in ihre Wand ` +
            `(Länge ${mm(teilung.laengeMm)}, Raumhöhe ${mm(teilung.wand.raumhoeheMm)}). Sie wird in 3D ausgelassen.`,
          [wandRef],
          q.oeffnungId,
        ),
      );
    }
  }

  const ergebnis = topologie.abschnitte.map((abschnitt) => {
    const { wand, warnungen: befunde } = darstellungswand(abschnitt, einordnung, ungueltig, raumName, mm);
    befunde.forEach(melden);
    return wand;
  });

  for (const e of einordnung.values()) {
    const befund = einordnungsBefund(e, raumName, mm);
    if (befund !== null) melden(befund);
  }
  return { waende: ergebnis, warnungen: [...warnungen.values()] };
}

function darstellungswand(
  abschnitt: Wandabschnitt<LogischeWand>,
  einordnung: ReadonlyMap<string, Oeffnungseinordnung<LogischeWand>>,
  ungueltig: ReadonlySet<string>,
  raumName: RaumName,
  mm: Laengentext,
): { wand: Wand3d; warnungen: Warnung[] } {
  const quellen = abschnitt.quellen.map((q) => q.wand);
  const { id, laengeMm, mass } = abschnitt;
  const wandRef: Auswahl = { art: "wand", id };
  const staerkeMm = Math.max(...quellen.map((w) => w.staerkeMm));
  const hoeheMm = Math.max(...quellen.map((w) => w.raumhoeheMm));
  const warnungen: Warnung[] = [];

  if (abschnitt.mehrdeutig) {
    warnungen.push(
      warnung(
        "wand-mehrfach",
        "Wand mehr als zwei Räumen zugeordnet",
        `Ungewöhnlich: Auf diesem Wandabschnitt liegen Wände von ${liste(abschnitt.raumIds.map(raumName))} exakt übereinander. ` +
          "Er wird als ein Wandkörper gezeigt; eine eindeutige Nachbarschaft gibt es hier nicht. Bitte die Räume im 2D-Editor prüfen.",
        [wandRef],
      ),
    );
  }
  if (abschnitt.doppeltImRaum) {
    const doppelt = abschnitt.raumIds.filter((r) => quellen.filter((w) => w.raumId === r).length > 1);
    warnungen.push(
      warnung(
        "wand-doppelt-im-raum",
        "Wand im selben Raum doppelt",
        `Im Raum ${liste(doppelt.map(raumName))} liegen zwei Wände exakt übereinander. ` +
          "Die Darstellung zeigt sie einmal; bitte im 2D-Editor prüfen.",
        [wandRef],
      ),
    );
  }
  if (new Set(quellen.map((w) => w.staerkeMm)).size > 1) {
    warnungen.push(
      warnung(
        "wand-staerke-abweichend",
        "Unterschiedliche Wandstärke",
        `Dieser gemeinsame Wandabschnitt ist unterschiedlich stark erfasst: ${quellen
          .map((w) => `„${raumName(w.raumId)}“ ${mm(w.staerkeMm)}`)
          .join(", ")}. Dargestellt wird die größere Stärke (${mm(staerkeMm)}). ` +
          "Die gespeicherten Werte bleiben unverändert.",
        [wandRef],
      ),
    );
  }
  if (new Set(quellen.map((w) => w.raumhoeheMm)).size > 1) {
    warnungen.push(
      warnung(
        "wand-hoehe-abweichend",
        "Unterschiedliche Raumhöhe",
        `Die angrenzenden Räume sind unterschiedlich hoch: ${quellen
          .map((w) => `„${raumName(w.raumId)}“ ${mm(w.raumhoeheMm)}`)
          .join(", ")}. Der gemeinsame Wandabschnitt wird mit der größeren Höhe (${mm(hoeheMm)}) gezeigt. ` +
          "Die gespeicherten Werte bleiben unverändert.",
        [wandRef],
      ),
    );
  }

  // Öffnungen aller Quellwände, die diesen Abschnitt berühren, in seine
  // kanonische Richtung übertragen.
  const kandidaten: Kandidat[] = [];
  for (const quelle of abschnitt.quellen) {
    const aufAbschnitt: LokalerBereich = { s0: ganzeLage(0), s1: minus(quelle.bis, quelle.von, mass) };
    for (const q of quelle.wand.oeffnungen) {
      if (ungueltig.has(q.oeffnungId)) continue;
      const bereich = lokalerBereich(quelle, q.offsetMm, q.breiteMm, mass);
      if (!bereicheUeberlappen(bereich, aufAbschnitt, mass)) continue;
      const roh: Wandrechteck = {
        s0: Math.round(alsZahl(bereich.s0, mass)),
        s1: Math.round(alsZahl(bereich.s1, mass)),
        h0: q.bruestungMm,
        h1: q.bruestungMm + q.hoeheMm,
      };
      const rechteck = beschneiden(roh, laengeMm, hoeheMm);
      if (rechteck !== null) kandidaten.push({ quelle: q, bereich, rechteck });
    }
  }

  const oeffnungen = oeffnungenZusammenfassen(kandidaten, id, einordnung, abschnitt);
  warnungen.push(...ueberlappungsBefunde(oeffnungen, wandRef, raumName, mm));

  const wand: Wand3d = {
    id,
    start: abschnitt.start,
    ende: abschnitt.ende,
    laengeMm,
    staerkeMm,
    hoeheMm,
    lage: abschnitt.lage,
    gerade: abschnitt.gerade,
    raumIds: abschnitt.raumIds,
    quellen,
    oeffnungen,
    teile: wandZerlegen(
      laengeMm,
      hoeheMm,
      oeffnungen.map((o) => o.rechteck),
    ),
    verlaengernAmStart: !abschnitt.fortgesetztAmStart,
    verlaengernAmEnde: !abschnitt.fortgesetztAmEnde,
  };
  return { wand, warnungen };
}

/**
 * Exakt gleiche Erfassungen (gleicher waagerechter Bereich, gleiche Höhe und
 * Brüstung) werden **eine** Darstellungsöffnung - die Dublette zweier
 * Raumseiten erscheint also einmal.
 */
function oeffnungenZusammenfassen(
  kandidaten: readonly Kandidat[],
  wandId: string,
  einordnung: ReadonlyMap<string, Oeffnungseinordnung<LogischeWand>>,
  abschnitt: Wandabschnitt<LogischeWand>,
): Oeffnung3d[] {
  const { mass } = abschnitt;
  const gleich = (a: Kandidat, b: Kandidat) =>
    gleicheLage(a.bereich.s0, b.bereich.s0, mass) &&
    gleicheLage(a.bereich.s1, b.bereich.s1, mass) &&
    a.quelle.bruestungMm === b.quelle.bruestungMm &&
    a.quelle.hoeheMm === b.quelle.hoeheMm;
  const gruppen: Kandidat[][] = [];
  for (const kandidat of kandidaten) {
    const gruppe = gruppen.find((g) => g[0] !== undefined && gleich(g[0], kandidat));
    if (gruppe === undefined) gruppen.push([kandidat]);
    else gruppe.push(kandidat);
  }
  return gruppen
    .map((gruppe): Oeffnung3d => {
      const quellen = gruppe.map((k) => k.quelle);
      const arten: Oeffnungsart[] = [...new Set(quellen.map((q) => q.art))];
      const e = quellen.map((q) => einordnung.get(q.oeffnungId)).filter((x) => x !== undefined);
      const klasse = e.some((x) => x.klasse === "konflikt") ? "konflikt" : (e[0]?.klasse ?? "aussen");
      return {
        id: gruppenId(quellen.map((q) => q.oeffnungId)),
        wandId,
        art: arten[0] ?? "door",
        arten,
        rechteck: (gruppe[0] as Kandidat).rechteck,
        quellen,
        klasse,
        raumIds: [...new Set(e.flatMap((x) => x.raumIds))],
      };
    })
    .sort((a, b) => a.rechteck.s0 - b.rechteck.s0 || a.rechteck.h0 - b.rechteck.h0 || a.id.localeCompare(b.id));
}

/** Überlappende, nicht gleiche Darstellungsöffnungen desselben Abschnitts. */
function ueberlappungsBefunde(
  oeffnungen: readonly Oeffnung3d[],
  wandRef: Auswahl,
  raumName: RaumName,
  mm: Laengentext,
): Warnung[] {
  const warnungen: Warnung[] = [];
  const raeumeVon = (o: Oeffnung3d) => [...new Set(o.quellen.map((q) => q.raumId))];

  for (const o of oeffnungen) {
    if (o.arten.length > 1) {
      warnungen.push(
        warnung(
          "oeffnung-art-abweichend",
          "Öffnungsart widersprüchlich",
          `Dieselbe Öffnung ist unterschiedlich erfasst: ${o.quellen
            .map((q) => `in „${raumName(q.raumId)}“ als ${OEFFNUNGSART_LABEL[q.art]}`)
            .join(", ")}. Die Aussparung wird gezeigt; die Art bitte im 2D-Editor angleichen.`,
          [{ art: "oeffnung", id: o.id }, wandRef],
        ),
      );
    }
  }

  for (let i = 0; i < oeffnungen.length; i += 1) {
    for (let j = i + 1; j < oeffnungen.length; j += 1) {
      const a = oeffnungen[i] as Oeffnung3d;
      const b = oeffnungen[j] as Oeffnung3d;
      if (!ueberlappen(a.rechteck, b.rechteck)) continue;
      const bezug: Auswahl[] = [{ art: "oeffnung", id: a.id }, { art: "oeffnung", id: b.id }, wandRef];
      const beschreibung = [...a.quellen, ...b.quellen]
        .map((q) => `„${raumName(q.raumId)}“: ${oeffnungText(q, mm)}`)
        .join("; ");
      const zweiSeiten =
        raeumeVon(a).some((r) => !raeumeVon(b).includes(r)) || raeumeVon(b).some((r) => !raeumeVon(a).includes(r));
      warnungen.push(
        zweiSeiten
          ? warnung(
              "oeffnung-widerspruechlich",
              "Öffnung auf beiden Seiten verschieden erfasst",
              `Die Öffnungen der beiden Raumseiten überlappen sich, sind aber nicht gleich (${beschreibung}). ` +
                "Die 3D-Ansicht spart beide Rechtecke zusammen aus. Bitte im 2D-Editor angleichen.",
              bezug,
            )
          : warnung(
              "oeffnung-ueberlappung",
              "Öffnungen überlappen sich",
              `Zwei Öffnungen derselben Wand überlappen sich (${beschreibung}). Beide werden ausgespart.`,
              bezug,
            ),
      );
    }
  }
  return warnungen;
}

/** Hinweise aus der abgeleiteten Einordnung einer gespeicherten Öffnung. */
function einordnungsBefund(
  e: Oeffnungseinordnung<LogischeWand>,
  raumName: RaumName,
  mm: Laengentext,
): Warnung | null {
  const q = e.oeffnung as Oeffnungsquelle;
  const eigene: Auswahl = { art: "oeffnung", id: e.dubletten.length > 0 ? gruppenId([q.oeffnungId, ...e.dubletten]) : q.oeffnungId };
  const waende: Auswahl[] = e.abschnitte.map((a) => ({ art: "wand", id: a.id }));
  const beschrieben = `${oeffnungText(q, mm)} in „${raumName(q.raumId)}“`;
  if (e.klasse === "konflikt" && e.grund === "mehrdeutig") {
    return warnung(
      "oeffnung-mehrdeutig",
      "Raumverbindung nicht eindeutig",
      `Die Öffnung (${beschrieben}) liegt auf einem Wandabschnitt mehrerer Räume (${liste(e.raumIds.map(raumName))}). ` +
        "Welche zwei Räume sie verbindet, wird nicht geraten. Bitte die Wände im 2D-Editor bereinigen.",
      [eigene, ...waende],
    );
  }
  if (e.klasse === "konflikt" && e.grund === "grenze") {
    return warnung(
      "oeffnung-grenze",
      "Öffnung über der Grenze zweier Nachbarräume",
      `Die Öffnung (${beschrieben}) reicht über die Grenze zwischen ${liste(
        e.raumIds.filter((r) => r !== q.raumId).map(raumName),
      )}. Sie wird ausgespart, verbindet aber keinen bestimmten Nachbarraum. Bitte im 2D-Editor verschieben.`,
      [eigene, ...waende],
    );
  }
  if (e.klasse === "konflikt" && e.grund === "teilweise") {
    return warnung(
      "oeffnung-teilweise",
      "Öffnung nur teilweise in der gemeinsamen Wand",
      `Die Öffnung (${beschrieben}) liegt nur zum Teil auf dem gemeinsamen Wandabschnitt. Sie wird ausgespart, ` +
        "gilt aber nicht als Verbindung zweier Räume. Bitte im 2D-Editor ganz auf den gemeinsamen Abschnitt oder davon weg schieben.",
      [eigene, ...waende],
    );
  }
  if (e.dubletten.length > 0) {
    return warnung(
      "oeffnung-dublette",
      "Öffnung auf beiden Raumseiten erfasst",
      `Dieselbe Öffnung (${oeffnungText(q, mm)}) ist in ${liste(e.raumIds.map(raumName))} exakt gleich gespeichert. ` +
        "Sie wird einmal gezeigt. Eine Erfassung genügt - die zweite kann später im 2D-Editor entfernt werden; " +
        "neue Öffnungen werden nur einmal gespeichert.",
      [eigene, ...waende],
    );
  }
  return null;
}
