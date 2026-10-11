/**
 * Szenenmodell → Three.js-Geometrien.
 *
 * Hier - und nur hier - werden Millimeter über die Transformation des
 * Szenenmodells zu Metern (`transformation.ts`). Die Funktionen erzeugen nur
 * `BufferGeometry`; Materialien, Meshes und Lebenszyklus gehören der
 * Szenenschicht (`szene.ts`).
 *
 * Wandkörper entstehen ohne CSG aus den rechteckigen Wandteilen
 * (`wandzerlegung.ts`) als Quader. Getrennte Wände (`separate`, Phase 6a)
 * bestehen aus zwei Halbkörpern - je Raum auf seiner Achsseite. Vertikale Flächen bilden Gruppe 0,
 * waagerechte (Wandkrone, Brüstungs- und Sturzflächen) Gruppe 1 - so tragen
 * sich überlagernde Kronen an Ecken dieselbe Farbe und flimmern nicht.
 */
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3 } from "three";

import type { Oeffnung3d, PunktMm, Raum3d, Wand3d } from "./modell";
import type { Wandrechteck } from "./wandzerlegung";
import type { Transformation } from "./transformation";
import { inMeter, inSzene } from "./transformation";

/** Böden liegen knapp über dem Orientierungsraster, damit nichts flimmert. */
export const BODEN_HOEHE_M = 0.002;
const UMRISS_HOEHE_M = 0.004;

/** Materialgruppen eines Wandkörpers. */
export const WANDGRUPPE_SENKRECHT = 0;
export const WANDGRUPPE_WAAGERECHT = 1;

/** Doppelte Dreiecksfläche im Grundriss - positiv gegen den Uhrzeigersinn. */
function kreuz(a: Vector2, b: Vector2, c: Vector2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Bodenfläche einer geschlossenen Kontur. Trianguliert mit `ShapeUtils`
 * (Earcut) - auch für L-Formen und andere konkave, einfache Konturen. Jedes
 * Dreieck wird so ausgerichtet, dass seine Normale nach oben zeigt.
 *
 * Liefert `null`, wenn keine Fläche entsteht; die Szene lässt den Boden dann
 * aus, statt eine falsche Fläche zu zeigen.
 */
export function bodenGeometrie(raum: Raum3d, t: Transformation): BufferGeometry | null {
  // Relativ zur Mitte in ganzen Millimetern triangulieren - exakt und klein.
  const punkte = raum.kontur.map((p) => new Vector2(p.x - t.mitteXMm, p.y - t.mitteYMm));
  if (punkte.length < 3) return null;
  const dreiecke = ShapeUtils.triangulateShape(punkte, []);
  const indizes: number[] = [];
  for (const [a, b, c] of dreiecke) {
    if (a === undefined || b === undefined || c === undefined) continue;
    const flaeche = kreuz(punkte[a] as Vector2, punkte[b] as Vector2, punkte[c] as Vector2);
    if (flaeche === 0) continue;
    indizes.push(...(flaeche > 0 ? [a, b, c] : [a, c, b]));
  }
  if (indizes.length === 0) return null;

  const positionen: number[] = [];
  const normalen: number[] = [];
  for (const p of raum.kontur) {
    const s = inSzene(t, p.x, p.y);
    positionen.push(s.x, BODEN_HOEHE_M, s.z);
    normalen.push(0, 1, 0);
  }
  const geometrie = new BufferGeometry();
  geometrie.setAttribute("position", new Float32BufferAttribute(positionen, 3));
  geometrie.setAttribute("normal", new Float32BufferAttribute(normalen, 3));
  geometrie.setIndex(indizes);
  geometrie.computeBoundingSphere();
  return geometrie;
}

/** Umriss eines Bodens als geschlossener Linienzug (für `LineLoop`). */
export function umrissGeometrie(raum: Raum3d, t: Transformation): BufferGeometry {
  const positionen = raum.kontur.flatMap((p) => {
    const s = inSzene(t, p.x, p.y);
    return [s.x, UMRISS_HOEHE_M, s.z];
  });
  const geometrie = new BufferGeometry();
  geometrie.setAttribute("position", new Float32BufferAttribute(positionen, 3));
  return geometrie;
}

/** Lokale Wandachsen in der Szene: entlang, quer, und der Startpunkt. */
interface Wandachsen {
  readonly ursprung: Vector3;
  /** Einheitsvektor entlang der kanonischen Richtung (waagerecht). */
  readonly entlang: Vector3;
  /** Einheitsvektor quer zur Wand (waagerecht). */
  readonly quer: Vector3;
  /** Meter je Wandmillimeter entlang - bildet `[0, Länge]` exakt auf die Strecke ab. */
  readonly meterJeS: number;
}

function wandachsen(start: PunktMm, ende: PunktMm, laengeMm: number, t: Transformation): Wandachsen {
  const a = inSzene(t, start.x, start.y);
  const b = inSzene(t, ende.x, ende.y);
  const ursprung = new Vector3(a.x, 0, a.z);
  const strecke = new Vector3(b.x - a.x, 0, b.z - a.z);
  const echteLaenge = strecke.length();
  const entlang = strecke.clone().normalize();
  const quer = new Vector3(-entlang.z, 0, entlang.x);
  return { ursprung, entlang, quer, meterJeS: laengeMm > 0 ? echteLaenge / laengeMm : 0 };
}

function punktAuf(achsen: Wandachsen, s: number, h: number, q: number): Vector3 {
  return achsen.ursprung
    .clone()
    .addScaledVector(achsen.entlang, s)
    .addScaledVector(achsen.quer, q)
    .setY(h);
}

/**
 * Sammelt Vierecke mit vorgegebener Außennormale als Dreiecke. Die
 * Windungsrichtung wird aus der Normale bestimmt - die Eckenreihenfolge des
 * Aufrufers spielt keine Rolle.
 */
class Vierecke {
  readonly positionen: number[] = [];
  readonly normalen: number[] = [];

  hinzufuegen(ecken: [Vector3, Vector3, Vector3, Vector3], normale: Vector3) {
    const [a, b, c, d] = ecken;
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    const folge = n.dot(normale) >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const p of folge) {
      this.positionen.push(p.x, p.y, p.z);
      this.normalen.push(normale.x, normale.y, normale.z);
    }
  }

  get anzahl(): number {
    return this.positionen.length / 3;
  }
}

/**
 * Wandkörper aus seinen Wandteilen. Teile, die an ein **freies** Wandende
 * stoßen, werden um die halbe Stärke verlängert: So schließen Ecken ohne
 * Kerbe. Setzt sich die Gerade in einem weiteren Abschnitt fort, entfällt
 * die Verlängerung - dort stoßen zwei Körper stumpf und ohne Überlagerung
 * aneinander. Die Verlängerung ist reine Darstellung.
 */
export function wandGeometrie(wand: Wand3d, t: Transformation): BufferGeometry | null {
  if (wand.laengeMm <= 0) return null;
  const halbkoerper = wand.halbkoerper ?? [];
  const koerper: { teile: readonly Wandrechteck[]; q0: number; q1: number }[] =
    halbkoerper.length > 0
      ? halbkoerper.map((h) => ({ teile: h.teile, q0: inMeter(h.q0Mm), q1: inMeter(h.q1Mm) }))
      : [{ teile: wand.teile, q0: -inMeter(wand.staerkeMm) / 2, q1: inMeter(wand.staerkeMm) / 2 }];
  if (koerper.every((k) => k.teile.length === 0)) return null;
  const achsen = wandachsen(wand.start, wand.ende, wand.laengeMm, t);
  const halb = inMeter(wand.staerkeMm) / 2;
  const senkrecht = new Vierecke();
  const waagerecht = new Vierecke();
  const oben = new Vector3(0, 1, 0);
  const unten = new Vector3(0, -1, 0);

  for (const { teile, q0, q1 } of koerper) {
    for (const teil of teile) {
      const s0 = teil.s0 * achsen.meterJeS - (teil.s0 === 0 && wand.verlaengernAmStart ? halb : 0);
      const s1 = teil.s1 * achsen.meterJeS + (teil.s1 === wand.laengeMm && wand.verlaengernAmEnde ? halb : 0);
      const h0 = inMeter(teil.h0);
      const h1 = inMeter(teil.h1);
      const p = (s: number, h: number, q: number) => punktAuf(achsen, s, h, q);

      // Längsseiten
      senkrecht.hinzufuegen([p(s0, h0, q1), p(s1, h0, q1), p(s1, h1, q1), p(s0, h1, q1)], achsen.quer);
      senkrecht.hinzufuegen(
        [p(s0, h0, q0), p(s1, h0, q0), p(s1, h1, q0), p(s0, h1, q0)],
        achsen.quer.clone().negate(),
      );
      // Stirnseiten (auch die Laibungen an Öffnungen)
      senkrecht.hinzufuegen(
        [p(s0, h0, q0), p(s0, h0, q1), p(s0, h1, q1), p(s0, h1, q0)],
        achsen.entlang.clone().negate(),
      );
      senkrecht.hinzufuegen([p(s1, h0, q0), p(s1, h0, q1), p(s1, h1, q1), p(s1, h1, q0)], achsen.entlang);
      // Oberseite (Krone oder Brüstung) und - über dem Boden - Unterseite (Sturz)
      waagerecht.hinzufuegen([p(s0, h1, q0), p(s1, h1, q0), p(s1, h1, q1), p(s0, h1, q1)], oben);
      if (teil.h0 > 0) {
        waagerecht.hinzufuegen([p(s0, h0, q0), p(s1, h0, q0), p(s1, h0, q1), p(s0, h0, q1)], unten);
      }
    }
  }

  const geometrie = new BufferGeometry();
  geometrie.setAttribute(
    "position",
    new Float32BufferAttribute([...senkrecht.positionen, ...waagerecht.positionen], 3),
  );
  geometrie.setAttribute("normal", new Float32BufferAttribute([...senkrecht.normalen, ...waagerecht.normalen], 3));
  geometrie.addGroup(0, senkrecht.anzahl, WANDGRUPPE_SENKRECHT);
  geometrie.addGroup(senkrecht.anzahl, waagerecht.anzahl, WANDGRUPPE_WAAGERECHT);
  geometrie.computeBoundingSphere();
  return geometrie;
}

/**
 * Auswahlfläche einer Öffnung: ein Rechteck in der Wandmitte, genau so groß
 * wie die Aussparung. Beim Fenster sichtbar als Glas, bei Tür und Durchgang
 * unsichtbar - aber per Raycasting treffbar.
 */
export function oeffnungsGeometrie(oeffnung: Oeffnung3d, wand: Wand3d, t: Transformation): BufferGeometry {
  const achsen = wandachsen(wand.start, wand.ende, wand.laengeMm, t);
  const r = oeffnung.rechteck;
  const s0 = r.s0 * achsen.meterJeS;
  const s1 = r.s1 * achsen.meterJeS;
  const h0 = inMeter(r.h0);
  const h1 = inMeter(r.h1);
  // Bei getrennten Wänden liegt die Fläche in der Mitte des eigenen Halbkörpers.
  const q = inMeter(oeffnung.querMm ?? 0);
  const flaeche = new Vierecke();
  flaeche.hinzufuegen(
    [punktAuf(achsen, s0, h0, q), punktAuf(achsen, s1, h0, q), punktAuf(achsen, s1, h1, q), punktAuf(achsen, s0, h1, q)],
    achsen.quer,
  );
  const geometrie = new BufferGeometry();
  geometrie.setAttribute("position", new Float32BufferAttribute(flaeche.positionen, 3));
  geometrie.setAttribute("normal", new Float32BufferAttribute(flaeche.normalen, 3));
  geometrie.computeBoundingSphere();
  return geometrie;
}

/**
 * Trennfuge einer getrennten Wand (`separate`): eine Linie auf der Wandachse
 * knapp über der niedrigeren Krone. Sie macht die zwei Bauwände sichtbar - reine
 * Darstellung, keine Maßangabe. `null` bei allen anderen Wänden.
 */
export function fugenGeometrie(wand: Wand3d, t: Transformation): BufferGeometry | null {
  const halbkoerper = wand.halbkoerper ?? [];
  if (halbkoerper.length < 2 || wand.laengeMm <= 0) return null;
  const achsen = wandachsen(wand.start, wand.ende, wand.laengeMm, t);
  const h = inMeter(Math.min(...halbkoerper.map((k) => k.hoeheMm))) + 0.003;
  const a = punktAuf(achsen, 0, h, 0);
  const b = punktAuf(achsen, wand.laengeMm * achsen.meterJeS, h, 0);
  const geometrie = new BufferGeometry();
  geometrie.setAttribute("position", new Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z], 3));
  return geometrie;
}
