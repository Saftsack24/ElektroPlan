/**
 * Planungsstand → Szenenmodell. Rein, deterministisch, ohne DOM, WebGL oder
 * React - vollständig mit Unit-Tests prüfbar.
 *
 * Grundregeln (ADR 0016):
 *
 * * Nur Räume mit geschlossener, gültiger Kontur (`contour_status = valid`)
 *   werden dargestellt. Ein Entwurf erzeugt keinen scheinbar korrekten
 *   3D-Raum; er erscheint in `ausgelassen` mit Begründung.
 * * Wandhöhe = effektive Raumhöhe (T8). Kein Wandtyp; „gemeinsam"/„außen"
 *   ist abgeleitet.
 * * Wände werden nur für die Darstellung in atomare Abschnitte zerlegt und
 *   je Abschnitt einmal gezeigt (T9, `wandgruppen.ts` auf der gemeinsamen
 *   Topologie `topologie/wandtopologie.ts`, dieselbe wie im 2D-Editor).
 * * Alle Werte bleiben ganze Millimeter; die Transformation in Szenenmeter
 *   steht im Modell und wird erst beim Geometrieaufbau angewandt.
 */
import type { Fassade3d, Raumwand3d } from "./raumwand";
import { fassadenAus, raumwaendeAus } from "./raumwand";
import type {
  Auswahl,
  AusgelassenerRaum,
  Geschossplan,
  LogischeWand,
  Oeffnung3d,
  PunktMm,
  Raum3d,
  RaumImPlan,
  Szenenmodell,
  Wand3d,
  Warnung,
} from "./modell";
import { auswahlSchluessel, raumBezeichnung } from "./modell";
import type { GrenzenMm } from "./transformation";
import { transformationFuer } from "./transformation";
import { MM_TEXT, wandGruppieren } from "./wandgruppen";
import type { Laengentext } from "./wandgruppen";

export const LEERES_MODELL: Szenenmodell = {
  floorId: null,
  transformation: transformationFuer(null),
  grenzen: null,
  hoeheMaxMm: 0,
  raumanzahlGesamt: 0,
  raeume: [],
  waende: [],
  raumwaende: [],
  fassaden: [],
  oeffnungen: [],
  ausgelassen: [],
  warnungen: [],
};

const ganz = (zahl: unknown): zahl is number => typeof zahl === "number" && Number.isSafeInteger(zahl);

/**
 * Prüft einen als gültig gemeldeten Raum noch einmal defensiv. Die
 * Serverprüfung ist verbindlich; hier geht es nur darum, bei unerwarteten
 * Daten keine kaputte Geometrie zu erzeugen. Liefert den Grund oder `null`.
 */
function darstellungsHindernis(raum: RaumImPlan, floorId: string): string | null {
  if (raum.floor_id !== floorId) return "Der Raum gehört zu einem anderen Geschoss.";
  if (raum.contour_status !== "valid") {
    return "Die Raumkontur ist noch nicht geschlossen (Entwurf). Im 2D-Editor vervollständigen.";
  }
  if (!ganz(raum.effective_height_mm) || raum.effective_height_mm <= 0) {
    return "Die Raumhöhe ist nicht auswertbar.";
  }
  const waende = raum.walls;
  if (waende.length < 3) return "Die Kontur hat weniger als drei Wände.";
  for (const [index, wand] of waende.entries()) {
    const werte = [wand.x1_mm, wand.y1_mm, wand.x2_mm, wand.y2_mm, wand.thickness_mm];
    if (!werte.every(ganz) || wand.thickness_mm <= 0) {
      return "Eine Wand hat keine auswertbaren Maße.";
    }
    const naechste = waende[(index + 1) % waende.length];
    if (naechste === undefined || wand.x2_mm !== naechste.x1_mm || wand.y2_mm !== naechste.y1_mm) {
      return "Die Wände schließen nicht lückenlos aneinander an.";
    }
    if (wand.x1_mm === wand.x2_mm && wand.y1_mm === wand.y2_mm) {
      return "Eine Wand hat keine Länge.";
    }
  }
  return null;
}

function grenzenVon(raeume: readonly Raum3d[], randMm: number): GrenzenMm | null {
  const punkte = raeume.flatMap((r) => r.kontur);
  if (punkte.length === 0) return null;
  const xs = punkte.map((p) => p.x);
  const ys = punkte.map((p) => p.y);
  return {
    minX: Math.min(...xs) - randMm,
    minY: Math.min(...ys) - randMm,
    maxX: Math.max(...xs) + randMm,
    maxY: Math.max(...ys) + randMm,
  };
}

/**
 * Szenenmodell aus dem Planungsstand eines Geschosses. `null` oder
 * `undefined` (noch nicht geladen) ergibt das leere Modell - kein Fehler.
 */
export function szenenmodellAus(
  plan: Geschossplan | null | undefined,
  laengentext: Laengentext = MM_TEXT,
): Szenenmodell {
  if (plan === null || plan === undefined) return LEERES_MODELL;
  const rooms: readonly RaumImPlan[] = Array.isArray(plan.rooms) ? plan.rooms : [];

  const raeume: Raum3d[] = [];
  const ausgelassen: AusgelassenerRaum[] = [];
  const logisch: LogischeWand[] = [];

  for (const raum of rooms) {
    const bezeichnung = raumBezeichnung({ name: raum.name, nummer: raum.room_number });
    const grund = darstellungsHindernis(raum, plan.floor_id);
    if (grund !== null) {
      ausgelassen.push({ id: raum.id, bezeichnung, grund });
      continue;
    }
    const kontur: PunktMm[] = raum.walls.map((w) => ({ x: w.x1_mm, y: w.y1_mm }));
    raeume.push({
      id: raum.id,
      name: raum.name,
      nummer: raum.room_number,
      hoeheMm: raum.effective_height_mm,
      flaecheM2: raum.area_m2,
      wandanzahl: raum.walls.length,
      kontur,
      farbindex: raeume.length,
    });
    for (const wand of raum.walls) {
      logisch.push({
        id: wand.id,
        raumId: raum.id,
        start: { x: wand.x1_mm, y: wand.y1_mm },
        ende: { x: wand.x2_mm, y: wand.y2_mm },
        staerkeMm: wand.thickness_mm,
        raumhoeheMm: raum.effective_height_mm,
        oeffnungen: wand.openings.map((o) => ({
          oeffnungId: o.id,
          wandId: wand.id,
          raumId: raum.id,
          art: o.kind,
          offsetMm: o.offset_mm,
          breiteMm: o.width_mm,
          hoeheMm: o.height_mm,
          bruestungMm: o.sill_height_mm,
        })),
      });
    }
  }

  const namen = new Map(raeume.map((r) => [r.id, raumBezeichnung(r)]));
  const raumName = (id: string) => namen.get(id) ?? "unbekannter Raum";

  const { waende, warnungen } = wandGruppieren(plan.floor_id, logisch, raumName, laengentext);
  // Eine (als Konflikt) über eine Abschnittsgrenze reichende Öffnung steckt in
  // mehreren Wandkörpern - als fachliches Objekt zählt sie einmal.
  const oeffnungen: Oeffnung3d[] = [...new Map(waende.flatMap((w) => w.oeffnungen).map((o) => [o.id, o] as const)).values()];

  const randMm = Math.ceil(Math.max(0, ...waende.map((w) => w.staerkeMm)) / 2);
  const grenzen = grenzenVon(raeume, randMm);

  return {
    floorId: plan.floor_id,
    transformation: transformationFuer(grenzen),
    grenzen,
    hoeheMaxMm: Math.max(0, ...raeume.map((r) => r.hoeheMm)),
    raumanzahlGesamt: rooms.length,
    raeume,
    waende,
    raumwaende: raumwaendeAus(raeume, logisch, waende),
    fassaden: fassadenAus(waende),
    oeffnungen,
    ausgelassen,
    warnungen,
  };
}

// ------------------------------------------------ Auswahl im Szenenmodell

export type Objekt =
  | { readonly art: "raum"; readonly raum: Raum3d }
  | { readonly art: "wand"; readonly wand: Wand3d }
  | { readonly art: "raumwand"; readonly raumwand: Raumwand3d }
  | { readonly art: "wandseite"; readonly wand: Wand3d }
  | { readonly art: "fassade"; readonly fassade: Fassade3d; readonly abschnitt: string | null }
  | { readonly art: "oeffnung"; readonly oeffnung: Oeffnung3d; readonly wand: Wand3d };

/** Das fachliche Objekt hinter einer Auswahl - oder `null`, wenn es fehlt. */
export function objektZu(modell: Szenenmodell, auswahl: Auswahl | null): Objekt | null {
  if (auswahl === null) return null;
  if (auswahl.art === "raum") {
    const raum = modell.raeume.find((r) => r.id === auswahl.id);
    return raum === undefined ? null : { art: "raum", raum };
  }
  if (auswahl.art === "wand" || auswahl.art === "wandseite") {
    const wand = modell.waende.find((w) => w.id === auswahl.id);
    return wand === undefined ? null : auswahl.art === "wand" ? { art: "wand", wand } : { art: "wandseite", wand };
  }
  if (auswahl.art === "fassade") {
    const fassade = modell.fassaden.find((f) => f.id === auswahl.id);
    if (fassade === undefined) return null;
    const abschnitt = fassade.abschnitte.some((a) => a.id === auswahl.abschnitt) ? (auswahl.abschnitt ?? null) : null;
    return { art: "fassade", fassade, abschnitt };
  }
  if (auswahl.art === "raumwand") {
    const raumwand = modell.raumwaende.find((w) => w.id === auswahl.id);
    return raumwand === undefined ? null : { art: "raumwand", raumwand };
  }
  const oeffnung = modell.oeffnungen.find((o) => o.id === auswahl.id);
  const wand = oeffnung && modell.waende.find((w) => w.id === oeffnung.wandId);
  return oeffnung === undefined || wand === undefined ? null : { art: "oeffnung", oeffnung, wand };
}

/** Warnungen, die sich (auch) auf dieses Objekt beziehen. */
export function warnungenZu(modell: Szenenmodell, auswahl: Auswahl): Warnung[] {
  const schluessel = auswahlSchluessel(auswahl);
  return modell.warnungen.filter((w) => w.bezug.some((b) => auswahlSchluessel(b) === schluessel));
}
