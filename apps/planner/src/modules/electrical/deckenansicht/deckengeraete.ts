/**
 * Deckengeräte in der Deckenansicht - Lage, Einrasten, Prüfung, Maße (Phase 5, ADR 0023).
 *
 * Koordinaten sind die des Grundrisses (ganze mm, y nach oben); die
 * Deckenansicht zeigt sie in Grundrissausrichtung (Deckenspiegel, nicht
 * seitenverkehrt). Bezugspunkt ist die Gerätemitte. Eine Höhe wird nicht
 * gespeichert: Deckengeräte sitzen auf der effektiven Raumhöhe.
 *
 * **Maße zu tatsächlich vorhandenen Wänden:** Von der Gerätemitte aus wird in
 * vier Achsrichtungen bis zur ersten Wand der echten Kontur gemessen - bei
 * einem L-Raum also bis zur einspringenden Wand, nicht bis zu einer gedachten
 * Rechteckkante. Die Prüfung verwendet die echte Kontur (`geraetepruefung.ts`).
 */
import type { EntwurfGeraet } from "../editor/entwurf";
import type { Punkt } from "../editor/geometrie";
import { befundText, deckengeraetBefunde, deckenrechteck, ueberdecken } from "../geraete/geraetepruefung";
import type { Geraetetyp, Geraetetypen } from "../geraete/katalog";
import type { Fangziel } from "../wandansicht/wandfang";
import { fangen } from "../wandansicht/wandfang";
import type { Deckenwand } from "./deckenmodell";

export type Richtung = "links" | "rechts" | "oben" | "unten";

export interface Wandtreffer {
  readonly richtung: Richtung;
  /** Senkrechter Abstand Mitte bis Wand entlang der Achse (Gleitkomma, nur Anzeige). */
  readonly abstand: number;
  readonly punkt: Punkt;
  readonly wandNummer: number;
}

/** Erste Wand der Kontur in jeder Achsrichtung ab `p` - oder `null`, wenn keine. */
export function wandabstaende(waende: readonly Deckenwand[], p: Punkt): Record<Richtung, Wandtreffer | null> {
  const ergebnis: Record<Richtung, Wandtreffer | null> = { links: null, rechts: null, oben: null, unten: null };
  const nimm = (richtung: Richtung, abstand: number, punkt: Punkt, wandNummer: number) => {
    const alt = ergebnis[richtung];
    if (abstand >= 0 && (alt === null || abstand < alt.abstand)) ergebnis[richtung] = { richtung, abstand, punkt, wandNummer };
  };
  for (const w of waende) {
    const { start: a, ende: b } = w;
    // Waagerechter Strahl: Wände, die die Höhe p.y kreuzen (nicht waagerechte).
    if (a.y !== b.y && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)) {
      const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (x <= p.x) nimm("links", p.x - x, { x, y: p.y }, w.nummer);
      if (x >= p.x) nimm("rechts", x - p.x, { x, y: p.y }, w.nummer);
    }
    // Senkrechter Strahl.
    if (a.x !== b.x && Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x)) {
      const y = a.y + ((p.x - a.x) * (b.y - a.y)) / (b.x - a.x);
      if (y <= p.y) nimm("unten", p.y - y, { x: p.x, y }, w.nummer);
      if (y >= p.y) nimm("oben", y - p.y, { x: p.x, y }, w.nummer);
    }
  }
  return ergebnis;
}

export interface AnsichtsDeckengeraet {
  readonly id: string;
  readonly typ: Geraetetyp | undefined;
  readonly schluessel: string;
  readonly x: number;
  readonly y: number;
  readonly label: string | null;
  readonly befunde: readonly string[];
}

export function deckengeraeteAus(
  geraete: readonly EntwurfGeraet[],
  typen: Geraetetypen,
  befunde: ReadonlyMap<string, readonly string[]>,
): AnsichtsDeckengeraet[] {
  return geraete
    .filter((g) => g.mounting_surface === "ceiling" && g.x_mm !== null && g.y_mm !== null)
    .map((g) => ({
      id: g.id,
      typ: typen.get(g.device_type_key),
      schluessel: g.device_type_key,
      x: g.x_mm ?? 0,
      y: g.y_mm ?? 0,
      label: g.label,
      befunde: befunde.get(g.id) ?? [],
    }));
}

export type Deckenpruefung = { readonly ok: true } | { readonly ok: false; readonly grund: string };

/** Dieselben Regeln wie der Server: Typ erlaubt, ganz in der echten Kontur, keine Überdeckung. */
export function deckenlagePruefen(
  typ: Geraetetyp,
  x: number,
  y: number,
  waende: readonly Deckenwand[],
  andere: readonly AnsichtsDeckengeraet[],
  ohneId?: string,
): Deckenpruefung {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return { ok: false, grund: "Gespeichert werden nur ganze Millimeter." };
  if (!typ.allows_ceiling) return { ok: false, grund: `„${typ.label}“ ist nicht für die Decke vorgesehen.` };
  const mass = { breite: typ.width_mm, hoehe: typ.height_mm };
  const r = deckenrechteck(x, y, mass);
  const befunde = deckengeraetBefunde("neu", r, waende.map((w) => ({ id: w.id, start: w.start, ende: w.ende })));
  const erster = befunde[0];
  if (erster !== undefined) return { ok: false, grund: befundText(erster.code) };
  const imWeg = andere.find(
    (g) => g.id !== ohneId && ueberdecken(r, deckenrechteck(g.x, g.y, { breite: g.typ?.width_mm ?? 100, hoehe: g.typ?.height_mm ?? 100 })),
  );
  if (imWeg !== undefined) return { ok: false, grund: `Überdeckt ${imWeg.typ?.label ?? "ein anderes Gerät"}.` };
  return { ok: true };
}

export interface Deckenfang {
  readonly aktiv: boolean;
  readonly ausgesetzt: boolean;
  readonly massstab: number;
  readonly rasterMm: number;
  readonly vorherX?: string | null;
  readonly vorherY?: string | null;
}

export interface Deckenlage {
  readonly x: number;
  readonly y: number;
  readonly zielX: Fangziel | null;
  readonly zielY: Fangziel | null;
}

/**
 * Gefangene Mitte für eine rohe Zeigerlage. X und Y getrennt: Kanten an
 * achsparallelen Wänden (bündig), Achsen anderer Deckengeräte (gleiche Flucht),
 * sonst Raster des Grundrisses.
 */
export function deckenlage(rohX: number, rohY: number, typ: Geraetetyp, waende: readonly Deckenwand[], andere: readonly AnsichtsDeckengeraet[], f: Deckenfang): Deckenlage {
  const hb = Math.floor(typ.width_mm / 2);
  const hh = Math.floor(typ.height_mm / 2);
  const kantenX: Fangziel[] = [];
  const kantenY: Fangziel[] = [];
  for (const w of waende) {
    if (w.start.x === w.ende.x) kantenX.push({ id: `wand:${w.id}`, art: "wandkante", wert: w.start.x, text: `an Wand ${w.nummer}` });
    if (w.start.y === w.ende.y) kantenY.push({ id: `wand:${w.id}`, art: "wandkante", wert: w.start.y, text: `an Wand ${w.nummer}` });
  }
  const achsenX: Fangziel[] = andere.map((g, i) => ({ id: `achse:${g.id}`, art: "oeffnungsmitte", wert: g.x, text: `Flucht ${g.typ?.label ?? "Gerät"} ${i + 1}` }));
  const achsenY: Fangziel[] = andere.map((g, i) => ({ id: `achse:${g.id}`, art: "oeffnungsmitte", wert: g.y, text: `Flucht ${g.typ?.label ?? "Gerät"} ${i + 1}` }));
  const opt = (bezug: number, vorher: string | null | undefined) => ({
    aktiv: f.aktiv,
    ausgesetzt: f.ausgesetzt,
    massstab: f.massstab,
    rasterMm: f.rasterMm,
    rasterBezug: bezug,
    vorher: vorher ?? null,
  });
  const fx = fangen(
    [
      { wert: rohX - hb, versatz: -hb, ziele: kantenX },
      { wert: rohX + hb, versatz: hb, ziele: kantenX },
      { wert: rohX, versatz: 0, ziele: achsenX },
    ],
    opt(rohX, f.vorherX),
  );
  const fy = fangen(
    [
      { wert: rohY - hh, versatz: -hh, ziele: kantenY },
      { wert: rohY + hh, versatz: hh, ziele: kantenY },
      { wert: rohY, versatz: 0, ziele: achsenY },
    ],
    opt(rohY, f.vorherY),
  );
  return { x: Math.round(rohX + fx.verschiebung) + 0, y: Math.round(rohY + fy.verschiebung) + 0, zielX: fx.ziel, zielY: fy.ziel };
}
