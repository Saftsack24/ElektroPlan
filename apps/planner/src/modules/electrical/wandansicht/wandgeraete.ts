/**
 * Geräte in der Wandansicht - Lage, Einrasten, Prüfung, Hilfslinien (Phase 5, ADR 0023).
 *
 * **Bezugspunkt ist die Gerätemitte.** Gespeichert ist `center_offset_mm` ab
 * Anfang der gerichteten Wand und `center_height_mm` über FFB. In der Ansicht
 * gilt für die Mitte
 *
 *     u = anfangLinks ? c : L − c        (und ebenso c = anfangLinks ? u : L − u)
 *
 * - ohne Breite, anders als bei Öffnungen, deren gespeicherter Abstand die
 * Kante meint. Die Formel ist ihre eigene Umkehrung und ganzzahlig; weder
 * Blickrichtung noch Seite verändern einen gespeicherten Wert.
 *
 * Die betrachtete **Seite ist die Montagefläche**: innen = `wall_interior`,
 * außen = `wall_exterior`. Geräte der anderen Seite gehören nicht zu dieser
 * Fläche und werden hier nicht als montiert gezeichnet.
 *
 * Die Gerätegeometrie ist das Planungsmaß des Typs (gerade mm) - nie die
 * Größe des Symbols.
 */
import type { EntwurfGeraet, Montageflaeche } from "../editor/entwurf";
import type { EditorWand } from "../editor/platzierung";
import type { Befund, Rechteck } from "../geraete/geraetepruefung";
import { befundText, erlaubtAuf, ueberdecken, wandgeraetBefunde, wandrechteck } from "../geraete/geraetepruefung";
import { pruefmass } from "../geraete/geraeteentwurf";
import type { Geraetetyp, Geraetetypen } from "../geraete/katalog";
import type { Wandteilung } from "../topologie/wandtopologie";
import type { Fangziel } from "./wandfang";
import { fangen } from "./wandfang";
import type { Fangzustand } from "./wandziehen";
import type { Ansichtsrechteck, Wandbezug, Wandseite } from "./wandbezug";
import type { Masslinie, Nachbar } from "./masslinien";

export function flaecheDerSeite(seite: Wandseite): Exclude<Montageflaeche, "ceiling"> {
  return seite === "innen" ? "wall_interior" : "wall_exterior";
}

/** Gespeicherte Mitte ↔ Mitte in der Ansicht - dieselbe Formel in beide Richtungen. */
export function mitteInAnsicht(bezug: Pick<Wandbezug, "anfangLinks" | "laengeMm">, mitteMm: number): number {
  return (bezug.anfangLinks ? mitteMm : bezug.laengeMm - mitteMm) + 0;
}

export const mitteAusAnsicht = mitteInAnsicht;

export interface AnsichtsGeraet extends Ansichtsrechteck {
  readonly id: string;
  readonly typ: Geraetetyp | undefined;
  readonly schluessel: string;
  /** Mitte in der Ansicht. */
  readonly u: number;
  readonly h: number;
  readonly label: string | null;
  /** Gespeicherte Mitte ab Wandanfang. */
  readonly mitteMm: number;
  readonly befunde: readonly string[];
}

function ansichtsrechteck(bezug: Wandbezug, mitte: number, mittelhoehe: number, typ: Geraetetyp | undefined): Ansichtsrechteck {
  const u = mitteInAnsicht(bezug, mitte);
  const hb = Math.floor((typ?.width_mm ?? 80) / 2);
  const hh = Math.floor((typ?.height_mm ?? 80) / 2);
  return { links: u - hb, rechts: u + hb, unten: mittelhoehe - hh, oben: mittelhoehe + hh };
}

/** Geräte dieser Wand und Seite in Ansichtskoordinaten, von links nach rechts. */
export function geraeteInAnsicht(
  bezug: Wandbezug,
  geraete: readonly EntwurfGeraet[],
  typen: Geraetetypen,
  befunde: ReadonlyMap<string, readonly string[]>,
): AnsichtsGeraet[] {
  const flaeche = flaecheDerSeite(bezug.seite);
  return geraete
    .filter((g) => g.wall_id === bezug.wandId && g.mounting_surface === flaeche && g.center_offset_mm !== null && g.center_height_mm !== null)
    .map((g) => {
      const typ = typen.get(g.device_type_key);
      const mitte = g.center_offset_mm ?? 0;
      const h = g.center_height_mm ?? 0;
      return {
        ...ansichtsrechteck(bezug, mitte, h, typ),
        id: g.id,
        typ,
        schluessel: g.device_type_key,
        u: mitteInAnsicht(bezug, mitte),
        h,
        label: g.label,
        mitteMm: mitte,
        befunde: befunde.get(g.id) ?? [],
      };
    })
    .sort((a, b) => a.u - b.u || (a.id < b.id ? -1 : 1));
}

// ------------------------------------------------------------- Prüfung

export type Geraetepruefung = { readonly ok: true; readonly mitte: number; readonly mittelhoehe: number } | { readonly ok: false; readonly grund: string };

/**
 * Ist diese Lage zulässig? Dieselben Regeln wie der Server: Fläche erlaubt,
 * ganz in der Wand und unter der Decke, keine eigene oder abgeleitete
 * Öffnung, außen kein geteiltes Wandstück, keine Überdeckung mit einem
 * anderen Gerät derselben Fläche.
 */
export function geraetLagePruefen(
  bezug: Wandbezug,
  wand: Pick<EditorWand, "start" | "ende" | "oeffnungen">,
  teilung: Wandteilung<EditorWand> | undefined,
  typ: Geraetetyp,
  u: number,
  h: number,
  andere: readonly AnsichtsGeraet[],
  ohneId?: string,
): Geraetepruefung {
  if (!Number.isSafeInteger(u) || !Number.isSafeInteger(h)) return { ok: false, grund: "Gespeichert werden nur ganze Millimeter." };
  const flaeche = flaecheDerSeite(bezug.seite);
  const mass = pruefmass(typ);
  if (!erlaubtAuf(mass, flaeche)) {
    return { ok: false, grund: bezug.seite === "innen" ? `„${typ.label}“ ist nur für die Außenseite vorgesehen.` : `„${typ.label}“ ist nicht für die Fassade vorgesehen.` };
  }
  const mitte = mitteAusAnsicht(bezug, u);
  const r: Rechteck = wandrechteck(mitte, h, mass);
  const befunde: Befund[] = wandgeraetBefunde("neu", flaeche, r, wand, bezug.hoeheMm, teilung);
  const erster = befunde[0];
  if (erster !== undefined) return { ok: false, grund: befundText(erster.code) };
  const imWeg = andere.find((g) => g.id !== ohneId && ueberdecken(r, wandrechteck(g.mitteMm, g.h, { breite: g.typ?.width_mm ?? 80, hoehe: g.typ?.height_mm ?? 80 })));
  if (imWeg !== undefined) return { ok: false, grund: `Überdeckt ${imWeg.typ?.label ?? "ein anderes Gerät"}.` };
  return { ok: true, mitte, mittelhoehe: h };
}

// ------------------------------------------------------------- Einrasten

export interface Lagekontext {
  readonly laengeMm: number;
  readonly hoeheMm: number;
  readonly typ: Geraetetyp;
  /** Öffnungen der Ansicht (eigene und abgeleitete) als Rechtecke mit Namen. */
  readonly oeffnungen: readonly Nachbar[];
  /** Andere Geräte dieser Fläche. */
  readonly geraete: readonly AnsichtsGeraet[];
  readonly fang: Fangzustand;
}

export interface Lageergebnis {
  readonly u: number;
  readonly h: number;
  readonly zielWaagerecht: Fangziel | null;
  readonly zielSenkrecht: Fangziel | null;
}

function optionen(f: Fangzustand, bezug: number, vorher: string | null | undefined) {
  return { aktiv: f.aktiv, ausgesetzt: f.ausgesetzt, massstab: f.massstab, rasterMm: f.rasterMm, rasterBezug: bezug, vorher: vorher ?? null };
}

function geraeteName(g: AnsichtsGeraet, nummer: number): string {
  return `${g.typ?.label ?? "Gerät"} ${nummer}`;
}

/**
 * Gefangene Mitte für eine rohe Zeigerlage (`u`, `h` Gleitkomma). Waagerecht:
 * Kanten an Wandkanten und Kanten anderer Elemente, Mitte an Wandmitte und
 * Mitten anderer Elemente. Senkrecht: Mitte an der Standardhöhe des Typs und
 * an gleicher Höhe anderer Geräte, Unterkante am Boden, Oberkante an der Decke.
 */
export function geraetLage(rohU: number, rohH: number, k: Lagekontext): Lageergebnis {
  const hb = Math.floor(k.typ.width_mm / 2);
  const hh = Math.floor(k.typ.height_mm / 2);
  const kanteL: Fangziel[] = [{ id: "wand-links", art: "wandkante", wert: 0, text: "linke Wandkante" }];
  const kanteR: Fangziel[] = [{ id: "wand-rechts", art: "wandkante", wert: k.laengeMm, text: "rechte Wandkante" }];
  const mitte: Fangziel[] = [{ id: "wand-mitte", art: "wandmitte", wert: k.laengeMm / 2, text: "Wandmitte" }];
  const hoeheM: Fangziel[] = [];
  if (k.typ.default_center_height_mm !== null) {
    hoeheM.push({ id: "standardhoehe", art: "hoehe", wert: k.typ.default_center_height_mm, text: `Standardhöhe ${k.typ.label}` });
  }
  const unten: Fangziel[] = [{ id: "boden", art: "wandkante", wert: 0, text: "Boden" }];
  const oben: Fangziel[] = [{ id: "decke", art: "wandkante", wert: k.hoeheMm, text: "Decke" }];
  for (const o of k.oeffnungen) {
    kanteL.push({ id: `kante:${o.id}:rechts`, art: "oeffnungskante", wert: o.rechts, text: `Kante ${o.name}` });
    kanteR.push({ id: `kante:${o.id}:links`, art: "oeffnungskante", wert: o.links, text: `Kante ${o.name}` });
    mitte.push({ id: `mitte:${o.id}`, art: "oeffnungsmitte", wert: (o.links + o.rechts) / 2, text: `Mitte ${o.name}` });
  }
  k.geraete.forEach((g, i) => {
    const name = geraeteName(g, i + 1);
    mitte.push({ id: `achse:${g.id}`, art: "oeffnungsmitte", wert: g.u, text: `Achse ${name}` });
    kanteL.push({ id: `gkante:${g.id}:rechts`, art: "oeffnungskante", wert: g.rechts, text: `neben ${name}` });
    kanteR.push({ id: `gkante:${g.id}:links`, art: "oeffnungskante", wert: g.links, text: `neben ${name}` });
    hoeheM.push({ id: `hoehe:${g.id}`, art: "hoehe", wert: g.h, text: `gleiche Höhe wie ${name}` });
  });
  const fw = fangen(
    [
      { wert: rohU - hb, versatz: -hb, ziele: kanteL },
      { wert: rohU + hb, versatz: hb, ziele: kanteR },
      { wert: rohU, versatz: 0, ziele: mitte },
    ],
    optionen(k.fang, rohU, k.fang.vorherWaagerecht),
  );
  const fs = fangen(
    [
      { wert: rohH, versatz: 0, ziele: hoeheM },
      { wert: rohH - hh, versatz: -hh, ziele: unten },
      { wert: rohH + hh, versatz: hh, ziele: oben },
    ],
    optionen(k.fang, rohH, k.fang.vorherSenkrecht),
  );
  return {
    u: Math.round(rohU + fw.verschiebung) + 0,
    h: Math.round(rohH + fs.verschiebung) + 0,
    zielWaagerecht: fw.ziel,
    zielSenkrecht: fs.ziel,
  };
}

// ------------------------------------------------------------- Hilfslinien

/**
 * Maße zu einem Gerät - **Achsmaße zur Mitte**, so ausdrücklich benannt:
 * Mitte von links/rechts (Wandkante bis Gerätemitte), Mitte über Boden
 * (Fußboden bis Mitte), Oberkante bis Decke; dazu der **freie** Abstand Kante
 * zu Kante zum nächsten Element links und rechts (Gerät oder Öffnung).
 */
export function geraetemasslinien(
  g: Ansichtsrechteck & { readonly u: number; readonly h: number },
  laengeMm: number,
  hoeheMm: number,
  andere: readonly Nachbar[],
  mm: (wert: number) => string,
): Masslinie[] {
  const linien: Masslinie[] = [];
  linien.push({ id: "mitte-links", achse: "waagerecht", reihe: 0, von: 0, bis: g.u, art: "rand", bezeichnung: "Mitte von links (Achsmaß)", text: mm(g.u) });
  linien.push({ id: "mitte-rechts", achse: "waagerecht", reihe: 0, von: g.u, bis: laengeMm, art: "rand", bezeichnung: "Mitte von rechts (Achsmaß)", text: mm(laengeMm - g.u) });
  const nebeneinander = andere.filter((o) => o.unten < g.oben && g.unten < o.oben);
  const links = nebeneinander.filter((o) => (o.links + o.rechts) / 2 < g.u).sort((a, b) => b.rechts - a.rechts)[0];
  const rechts = nebeneinander.filter((o) => (o.links + o.rechts) / 2 >= g.u).sort((a, b) => a.links - b.links)[0];
  if (links !== undefined) {
    const frei = g.links - links.rechts;
    linien.push(
      frei >= 0
        ? { id: "nachbar-links", achse: "waagerecht", reihe: 1, von: links.rechts, bis: g.links, art: "nachbar", bezeichnung: `frei zu ${links.name}`, text: `frei ${mm(frei)}` }
        : { id: "nachbar-links", achse: "waagerecht", reihe: 1, von: g.links, bis: links.rechts, art: "ueberschneidung", bezeichnung: `überschneidet ${links.name}`, text: "überschneidet" },
    );
  }
  if (rechts !== undefined) {
    const frei = rechts.links - g.rechts;
    linien.push(
      frei >= 0
        ? { id: "nachbar-rechts", achse: "waagerecht", reihe: 1, von: g.rechts, bis: rechts.links, art: "nachbar", bezeichnung: `frei zu ${rechts.name}`, text: `frei ${mm(frei)}` }
        : { id: "nachbar-rechts", achse: "waagerecht", reihe: 1, von: rechts.links, bis: g.rechts, art: "ueberschneidung", bezeichnung: `überschneidet ${rechts.name}`, text: "überschneidet" },
    );
  }
  linien.push({ id: "mitte-boden", achse: "senkrecht", reihe: 0, von: 0, bis: g.h, art: "bruestung", bezeichnung: "Mitte über Boden (Achsmaß)", text: mm(g.h) });
  if (g.oben <= hoeheMm) {
    linien.push({ id: "decke", achse: "senkrecht", reihe: 0, von: g.oben, bis: hoeheMm, art: "decke", bezeichnung: "Oberkante bis Decke", text: mm(hoeheMm - g.oben) });
  } else {
    linien.push({ id: "decke", achse: "senkrecht", reihe: 0, von: hoeheMm, bis: g.oben, art: "ueberschneidung", bezeichnung: "Oberkante über der Decke", text: `${mm(g.oben - hoeheMm)} über der Decke` });
  }
  return linien;
}

export { geraeteName };
