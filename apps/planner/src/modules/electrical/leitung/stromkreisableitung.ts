import type { Planergeraet, Stromkreis, Verteilung } from "../stromkreise/daten";

export type Eignung = { readonly ok: true } | { readonly ok: false; readonly grund: string };

/**
 * Kann ein Gerät Start oder Ziel einer Leitung sein (Phase 6c, L2)? Lagegeräte von Verteilungen und
 * zuordenbare Geräte (Steckdose, Schalter, Leuchte, Abzweigdose) - nicht außen montiert, keine
 * Datendose, keine Verteilung ohne Eintrag. Mit verständlichem Grund.
 */
export function geraetEignung(
  id: string,
  geraete: readonly Pick<Planergeraet, "id" | "kategorie" | "zuordenbar">[],
  verteilungen: readonly Pick<Verteilung, "placement_device_id">[],
  aussen: (id: string) => boolean,
): Eignung {
  const g = geraete.find((x) => x.id === id);
  if (g === undefined) return { ok: false, grund: "Dieses Gerät ist im gespeicherten Stand nicht bekannt." };
  if (aussen(id)) return { ok: false, grund: "Außen montierte Geräte werden noch nicht angeschlossen." };
  if (verteilungen.some((v) => v.placement_device_id === id)) return { ok: true };
  if (g.kategorie === "distribution") return { ok: false, grund: "Diese Verteilung ist in der Ansicht „Stromkreise“ noch nicht angelegt." };
  if (!g.zuordenbar) return { ok: false, grund: "Datendosen werden nicht über Stromkreise angeschlossen." };
  return { ok: true };
}

/**
 * Stromkreis einer neuen Leitung aus den vorhandenen Zuordnungen (Phase 6c, Entwurf §7.3) - rein.
 *
 * Eine Leitung gehört zu genau einem Stromkreis; beide Endgeräte müssen ihm zugeordnet oder
 * Lagegerät seiner Verteilung sein. Nicht zugeordnete Endgeräte werden nur **ausdrücklich**
 * beim Speichern zugeordnet; ein Gerät eines anderen Stromkreises wird nie umgehängt.
 */
export type Ableitung =
  | {
      readonly art: "eindeutig";
      readonly kreisId: string;
      readonly grund: string;
      /** Endgeräte, die beim Speichern diesem Stromkreis zugeordnet werden müssen. */
      readonly zuordnen: readonly string[];
    }
  | { readonly art: "wahl"; readonly kreise: readonly Stromkreis[]; readonly grund: string; readonly zuordnen: readonly string[] }
  | { readonly art: "konflikt"; readonly text: string };

interface Endpunkt {
  readonly id: string;
  /** Verteilung, deren Lagegerät es ist. */
  readonly verteilung: Verteilung | null;
  /** Stromkreis, dem es zugeordnet ist. */
  readonly kreis: Stromkreis | null;
}

export function stromkreisAbleiten(
  startId: string | null,
  endId: string | null,
  kreise: readonly Stromkreis[],
  verteilungen: readonly Verteilung[],
  kreisName: (k: Stromkreis) => string,
): Ableitung {
  const endpunkt = (id: string): Endpunkt => ({
    id,
    verteilung: verteilungen.find((v) => v.placement_device_id === id) ?? null,
    kreis: kreise.find((k) => k.device_ids.includes(id)) ?? null,
  });
  const verteilungName = (v: Verteilung) => `${v.code}${v.name === "" ? "" : ` ${v.name}`}`;
  if (startId === null) return { art: "konflikt", text: "Die Leitung hat kein Startgerät." };
  const a = endpunkt(startId);
  const b = endId === null ? null : endpunkt(endId);
  const pruefen = (k: Stromkreis, zuordnen: readonly string[], grund: string): Ableitung => ({ art: "eindeutig", kreisId: k.id, grund, zuordnen });
  const wahl = (liste: readonly Stromkreis[], zuordnen: readonly string[], grund: string): Ableitung => {
    if (liste.length === 0) return { art: "konflikt", text: "Es gibt keinen passenden Stromkreis – bitte zuerst in der Ansicht „Stromkreise“ anlegen." };
    const [einziger] = liste;
    return liste.length === 1 && einziger !== undefined ? pruefen(einziger, zuordnen, `${grund} (einziger Stromkreis)`) : { art: "wahl", kreise: liste, grund, zuordnen };
  };
  const anVerteilung = (v: Verteilung) => kreise.filter((k) => k.board_id === v.id);
  const offen = (p: Endpunkt) => (p.verteilung === null && p.kreis === null ? [p.id] : []);

  // Ein Endgerät ist Lagegerät einer Verteilung (Start oder Ziel).
  const verteilungsseite = a.verteilung !== null ? a : b?.verteilung != null ? b : null;
  const andere = verteilungsseite === a ? b : a;
  if (verteilungsseite?.verteilung != null) {
    const v = verteilungsseite.verteilung;
    if (andere === null) return wahl(anVerteilung(v), [], `ab ${verteilungName(v)}`);
    if (andere.verteilung !== null) return { art: "konflikt", text: "Eine Leitung verbindet nicht zwei Verteilungen." };
    if (andere.kreis !== null) {
      if (andere.kreis.board_id !== v.id) {
        return {
          art: "konflikt",
          text: `Das Gerät gehört zu ${kreisName(andere.kreis)} an einer anderen Verteilung – eine Leitung ab ${verteilungName(v)} kann es nicht versorgen.`,
        };
      }
      return pruefen(andere.kreis, [], "aus der Zuordnung des Geräts");
    }
    return wahl(anVerteilung(v), [andere.id], `Stromkreis von ${verteilungName(v)} wählen`);
  }
  // Keine Verteilung beteiligt.
  if (b === null) return a.kreis !== null ? pruefen(a.kreis, [], "aus der Zuordnung des Startgeräts") : wahl(kreise, [a.id], "Stromkreis wählen");
  if (a.kreis !== null && b.kreis !== null) {
    if (a.kreis.id !== b.kreis.id) {
      return { art: "konflikt", text: `Start gehört zu ${kreisName(a.kreis)}, Ziel zu ${kreisName(b.kreis)} – Geräte werden nicht umgehängt.` };
    }
    return pruefen(a.kreis, [], "aus der Zuordnung beider Geräte");
  }
  if (a.kreis !== null) return pruefen(a.kreis, offen(b), "aus der Zuordnung des Startgeräts");
  if (b.kreis !== null) return pruefen(b.kreis, offen(a), "aus der Zuordnung des Zielgeräts");
  return wahl(kreise, [...offen(a), ...offen(b)], "Stromkreis wählen");
}
