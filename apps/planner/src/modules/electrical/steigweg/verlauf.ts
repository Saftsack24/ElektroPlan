/**
 * Verlauf und Länge eines Steigwegs - Spiegel von `riser_course.py` (ADR 0025).
 *
 * Eine reine Funktion für Längen, 2D-Grundriss und 3D-Vorschau: Alle drei
 * lesen dieselbe Polylinie. Die gemeinsame Fixture
 * `testdata/geometry/steigweg.v1.json` hält Server und Oberfläche gleich.
 *
 * Verlauf eines Abschnitts (unterer Halt U, oberer Halt O):
 *
 * 1. senkrecht am **unteren** Übergabepunkt von FFB unten bis FFB oben,
 * 2. waagerecht auf der Ebene des **oberen** FFB zum oberen Halt -
 *    `orthogonal` zuerst x, dann y; `direct` eine waagerechte Gerade
 *    (keine 3D-Diagonale),
 * 3. Teilstrecken der Länge 0 entfallen.
 *
 * Achsparallele Teile sind exakt, die schräge `direct`-Gerade wird einmal
 * kaufmännisch gerundet - ganzzahlig wie `geometry.rounded_sqrt`.
 *
 * Verlässlichkeit getrennt: senkrechte Längen gibt es nur, wenn beide
 * Höhenlagen bestätigt sind und das höhere Geschoss höher liegt. Nichts wird
 * aus der Geschossebene oder der Standardhöhe abgeleitet. Ein vereinfachter
 * Planungsverlauf - keine Aussage über Machbarkeit, Brandschutz oder Normen.
 */

import { gerundeteWurzel } from "../editor/geometrie";

export type Versatzart = "orthogonal" | "direct";
export type Abschnittstatus = "confirmed" | "elevation-unconfirmed" | "elevation-inconsistent";
export type Steigwegstatus = "confirmed" | "incomplete" | "conflict" | "single-stop" | "no-stops";
export type Abschnitthinweis = "floor-gap-below-ceiling-height";

export interface SteigwegGeschoss {
  id: string;
  level: number;
  elevation_mm: number;
  elevation_confirmed: boolean;
  default_ceiling_height_mm: number;
}

export interface Halt {
  /** Stabile ID des Halts oder ein lokaler Schlüssel für einen neuen. */
  schluessel: string;
  floor_id: string;
  x_mm: number;
  y_mm: number;
}

export interface Verlaufspunkt {
  x_mm: number;
  y_mm: number;
  z_mm: number;
}

export interface Abschnitt {
  unten: Halt;
  oben: Halt;
  durchquert: string[];
  status: Abschnittstatus;
  verlauf: Verlaufspunkt[];
  senkrecht_mm: number | null;
  waagerecht_mm: number;
  laenge_mm: number | null;
  hinweise: Abschnitthinweis[];
}

export interface Steigwegauswertung {
  halte: Halt[];
  abschnitte: Abschnitt[];
  status: Steigwegstatus;
  /** Bei `confirmed` die Länge, sonst ausdrücklich nur eine **Teilsumme**. */
  bekannt_mm: number;
  laenge_mm: number | null;
}

export function steigwegVerlauf(
  unten: Pick<Halt, "x_mm" | "y_mm">,
  oben: Pick<Halt, "x_mm" | "y_mm">,
  zUnten: number,
  zOben: number,
  versatz: Versatzart,
): Verlaufspunkt[] {
  const punkte: Verlaufspunkt[] = [
    { x_mm: unten.x_mm, y_mm: unten.y_mm, z_mm: zUnten },
    { x_mm: unten.x_mm, y_mm: unten.y_mm, z_mm: zOben },
  ];
  if (versatz === "orthogonal") punkte.push({ x_mm: oben.x_mm, y_mm: unten.y_mm, z_mm: zOben });
  punkte.push({ x_mm: oben.x_mm, y_mm: oben.y_mm, z_mm: zOben });
  const verlauf: Verlaufspunkt[] = [];
  for (const p of punkte) {
    const letzter = verlauf[verlauf.length - 1];
    if (letzter === undefined || letzter.x_mm !== p.x_mm || letzter.y_mm !== p.y_mm || letzter.z_mm !== p.z_mm) {
      verlauf.push(p);
    }
  }
  return verlauf;
}

export function waagerechteLaenge(verlauf: readonly Verlaufspunkt[]): number {
  let summe = 0;
  for (let i = 1; i < verlauf.length; i += 1) {
    const a = verlauf[i - 1];
    const b = verlauf[i];
    if (a === undefined || b === undefined || a.z_mm !== b.z_mm) continue;
    const dx = b.x_mm - a.x_mm;
    const dy = b.y_mm - a.y_mm;
    summe += dx === 0 || dy === 0 ? Math.abs(dx) + Math.abs(dy) : gerundeteWurzel(dx * dx + dy * dy);
  }
  return summe;
}

/** Abschnitte, Status und Längen - Spiegel von `analyse_riser`. */
export function steigwegAuswerten(
  geschosse: readonly SteigwegGeschoss[],
  halte: readonly Halt[],
  versatz: Versatzart,
): Steigwegauswertung {
  const nachId = new Map(geschosse.map((g) => [g.id, g]));
  const bekannteHalte = halte.filter((h) => nachId.has(h.floor_id));
  // Wie `analyse_riser`: nach Ebene, bei gleicher Ebene nach Halt-ID - nie nach der
  // Eingabereihenfolge. Gespeicherte Halte haben je Steigweg verschiedene Ebenen
  // (UNIQUE je Geschoss, UNIQUE Ebene je Gebäude); ungespeicherte Entwürfe oder
  // widersprüchliche Geschossdaten dürfen trotzdem nicht je nach Reihenfolge gültig werden.
  const geordnet = [...bekannteHalte].sort((a, b) => {
    const ebene = (nachId.get(a.floor_id)?.level ?? 0) - (nachId.get(b.floor_id)?.level ?? 0);
    if (ebene !== 0) return ebene;
    return a.schluessel < b.schluessel ? -1 : a.schluessel > b.schluessel ? 1 : 0;
  });
  const nachEbene = [...geschosse].sort((a, b) => a.level - b.level);
  const abschnitte: Abschnitt[] = [];
  for (let i = 1; i < geordnet.length; i += 1) {
    const unten = geordnet[i - 1];
    const oben = geordnet[i];
    if (unten === undefined || oben === undefined) continue;
    const gu = nachId.get(unten.floor_id);
    const go = nachId.get(oben.floor_id);
    if (gu === undefined || go === undefined) continue;
    const verlauf = steigwegVerlauf(unten, oben, gu.elevation_mm, go.elevation_mm, versatz);
    const anstieg = go.elevation_mm - gu.elevation_mm;
    const status: Abschnittstatus = !(gu.elevation_confirmed && go.elevation_confirmed)
      ? "elevation-unconfirmed"
      : anstieg <= 0
        ? "elevation-inconsistent"
        : "confirmed";
    const waagerecht = waagerechteLaenge(verlauf);
    const senkrecht = status === "confirmed" ? anstieg : null;
    abschnitte.push({
      unten,
      oben,
      durchquert: nachEbene.filter((g) => gu.level < g.level && g.level < go.level).map((g) => g.id),
      status,
      verlauf,
      senkrecht_mm: senkrecht,
      waagerecht_mm: waagerecht,
      laenge_mm: senkrecht === null ? null : senkrecht + waagerecht,
      hinweise:
        status === "confirmed" && anstieg < gu.default_ceiling_height_mm ? ["floor-gap-below-ceiling-height"] : [],
    });
  }
  const bekannt = abschnitte.reduce((s, a) => s + a.waagerecht_mm + (a.senkrecht_mm ?? 0), 0);
  const status: Steigwegstatus =
    geordnet.length === 0
      ? "no-stops"
      : geordnet.length === 1
        ? "single-stop"
        : abschnitte.some((a) => a.status === "elevation-inconsistent")
          ? "conflict"
          : abschnitte.some((a) => a.status === "elevation-unconfirmed")
            ? "incomplete"
            : "confirmed";
  return {
    halte: geordnet,
    abschnitte,
    status,
    bekannt_mm: bekannt,
    laenge_mm: status === "confirmed" ? bekannt : null,
  };
}
