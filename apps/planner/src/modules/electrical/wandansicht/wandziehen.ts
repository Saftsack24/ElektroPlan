/**
 * Verschieben und Größe ändern in der Wandansicht - reine Funktionen.
 *
 * Eingabe ist das Rechteck zu **Beginn** der Bewegung und die gesamte
 * Zeigerverschiebung seitdem (`du`, `dh` in mm der Ansicht, Gleitkomma).
 * Ausgabe ist ein ganzzahliges Rechteck - gefangen über `wandfang.ts`. Ob es
 * zulässig ist, entscheidet danach `wandpruefung.ts`; der Aufrufer behält bei
 * einer unzulässigen Lage die letzte gültige.
 *
 * * Verschieben: waagerecht immer; senkrecht nur ein **Fenster** - Tür und
 *   Durchgang stehen nach den bestehenden Regeln auf dem Boden.
 * * Griffe: links und rechts ändern die Breite (die Gegenkante bleibt), oben
 *   die Höhe (die Unterkante bleibt), unten beim Fenster die Brüstung (die
 *   Oberkante bleibt).
 */
import type { Fangergebnis, Fangziel, Nachbaroeffnung } from "./wandfang";
import { fangen, senkrechteZiele, waagerechteZiele } from "./wandfang";
import type { Ansichtsrechteck } from "./wandbezug";

export type Griff = "links" | "rechts" | "oben" | "unten";
export type Bewegung = { readonly art: "verschieben" } | { readonly art: "groesse"; readonly griff: Griff };

export interface Fangzustand {
  readonly aktiv: boolean;
  readonly ausgesetzt: boolean;
  readonly massstab: number;
  readonly rasterMm: number;
  readonly vorherWaagerecht?: string | null;
  readonly vorherSenkrecht?: string | null;
}

export interface Bewegungskontext {
  readonly laengeMm: number;
  readonly hoeheMm: number;
  readonly andere: readonly Nachbaroeffnung[];
  readonly fenster: boolean;
  readonly fang: Fangzustand;
}

export interface Bewegungsergebnis {
  readonly rechteck: Ansichtsrechteck;
  readonly zielWaagerecht: Fangziel | null;
  readonly zielSenkrecht: Fangziel | null;
}

function optionen(f: Fangzustand, rasterBezug: number, vorher: string | null | undefined) {
  return { aktiv: f.aktiv, ausgesetzt: f.ausgesetzt, massstab: f.massstab, rasterMm: f.rasterMm, rasterBezug, vorher: vorher ?? null };
}

const KEIN_FANG: Fangergebnis = { verschiebung: 0, ziel: null };

/** Gefangenes Rechteck nach einer Bewegung. */
export function bewegen(start: Ansichtsrechteck, bewegung: Bewegung, du: number, dh: number, k: Bewegungskontext): Bewegungsergebnis {
  const breite = start.rechts - start.links;
  const hoehe = start.oben - start.unten;
  const h = waagerechteZiele(k.laengeMm, k.andere);
  const v = senkrechteZiele(k.andere);
  const decke: Fangziel = { id: "decke", art: "wandkante", wert: k.hoeheMm, text: "Decke" };

  if (bewegung.art === "verschieben") {
    const links = start.links + du;
    const fw = fangen(
      [
        { wert: links, versatz: 0, ziele: h.links },
        { wert: links + breite, versatz: breite, ziele: h.rechts },
        { wert: links + breite / 2, versatz: breite / 2, ziele: h.mitte },
      ],
      optionen(k.fang, links, k.fang.vorherWaagerecht),
    );
    const neuLinks = Math.round(links + fw.verschiebung);
    let unten = start.unten;
    let fs = KEIN_FANG;
    if (k.fenster) {
      const roh = start.unten + dh;
      fs = fangen(
        [
          { wert: roh, versatz: 0, ziele: v.unten },
          { wert: roh + hoehe, versatz: hoehe, ziele: [...v.oben, decke] },
        ],
        optionen(k.fang, roh, k.fang.vorherSenkrecht),
      );
      unten = Math.round(roh + fs.verschiebung);
    }
    return {
      rechteck: { links: neuLinks, rechts: neuLinks + breite, unten, oben: unten + hoehe },
      zielWaagerecht: fw.ziel,
      zielSenkrecht: fs.ziel,
    };
  }

  switch (bewegung.griff) {
    case "links": {
      const roh = start.links + du;
      const f = fangen([{ wert: roh, versatz: 0, ziele: h.links }], optionen(k.fang, roh, k.fang.vorherWaagerecht));
      return { rechteck: { ...start, links: Math.round(roh + f.verschiebung) }, zielWaagerecht: f.ziel, zielSenkrecht: null };
    }
    case "rechts": {
      const roh = start.rechts + du;
      const f = fangen([{ wert: roh, versatz: 0, ziele: h.rechts }], optionen(k.fang, roh, k.fang.vorherWaagerecht));
      return { rechteck: { ...start, rechts: Math.round(roh + f.verschiebung) }, zielWaagerecht: f.ziel, zielSenkrecht: null };
    }
    case "oben": {
      const roh = start.oben + dh;
      const f = fangen([{ wert: roh, versatz: 0, ziele: [...v.oben, decke] }], optionen(k.fang, roh, k.fang.vorherSenkrecht));
      return { rechteck: { ...start, oben: Math.round(roh + f.verschiebung) }, zielWaagerecht: null, zielSenkrecht: f.ziel };
    }
    case "unten": {
      if (!k.fenster) return { rechteck: start, zielWaagerecht: null, zielSenkrecht: null };
      const roh = start.unten + dh;
      const f = fangen([{ wert: roh, versatz: 0, ziele: v.unten }], optionen(k.fang, roh, k.fang.vorherSenkrecht));
      return { rechteck: { ...start, unten: Math.round(roh + f.verschiebung) }, zielWaagerecht: null, zielSenkrecht: f.ziel };
    }
  }
}

/**
 * Lage einer **neuen** Öffnung unter dem Zeiger: Mitte waagerecht unter dem
 * Zeiger, gefangen wie beim Verschieben; Unterkante = Standardbrüstung der Art
 * (Tür und Durchgang auf dem Boden).
 */
export function platzieren(
  zeigerU: number,
  masse: { breite: number; hoehe: number; bruestung: number },
  k: Bewegungskontext,
): Bewegungsergebnis {
  const start: Ansichtsrechteck = {
    links: zeigerU - masse.breite / 2,
    rechts: zeigerU + masse.breite / 2,
    unten: masse.bruestung,
    oben: masse.bruestung + masse.hoehe,
  };
  const ergebnis = bewegen(start, { art: "verschieben" }, 0, 0, { ...k, fenster: false });
  return ergebnis;
}
