import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useMasse } from "../../../core/ui/masseinheit";
import type { Punkt } from "../editor/geometrie";
import type { Bildpunkt } from "../editor/viewport";
import "./leitung.css";
import type { Leitungswerte } from "./entwurf";
import { durchfuehrungDaneben, durchfuehrungEinfuegen, wegpunktEinfuegen, wegpunktEntfernen, wegpunktErsetzen } from "./entwurf";
import { durchfuehrungsziel, neuerSchluessel } from "./durchfuehrung";
import { betroffeneOrte, konfliktAn } from "./flaechen";
import type { Fangpunkt, Planflaeche } from "./grundriss";
import { achsenpunkt, achsgitterpunkt, grundrissFangen, grundrissstrecken, raumFuer, raumseite, raumVon, wandhoeheIn } from "./grundriss";
import type { Leitungskontext } from "./kontext";
import type { VorbereiteterPlan, Wegpunkt } from "./laenge";
import { leitungsbefundText } from "./laenge";
import type { Grundrisseinstellung } from "./LeitungsplanungProvider";
import { steigwegText } from "./Leitungsbereich";
import type { Flaechenzusatz, Zeigerereignis } from "./zusatz";

/** Treffer einer Raumwand unter dem Zeiger - wie beim Öffnungswerkzeug (Raumseite zählt). */
export type Wandtreffer = { readonly ok: true; readonly raumId: string; readonly wandId: string } | { readonly ok: false; readonly grund: string } | null;

/** Steigweg, der gerade gewählt wird: Einstieg an einem Halt dieses Geschosses. */
export interface Steigwahl {
  readonly steigwegId: string;
  readonly haltId: string;
  /** Höhe des Einstiegs über dem FFB des Halts - folgt aus dem Wegpunkt davor. */
  readonly einstiegMm: number;
  /** Index, an dem der Steigwegpunkt eingefügt wird. */
  readonly index: number;
}

interface Kandidat {
  readonly punkt: Punkt;
  readonly ok: boolean;
  readonly grund: string | null;
  readonly werte: Leitungswerte;
  readonly index: number;
  readonly text: string;
  /** Vorgänger auf diesem Geschoss - für die gestrichelte Vorschau. */
  readonly von: Punkt | null;
}

/** Abstand der Wandwege von der Achse zur Raumseite, in Bildpunkten. */
const SEITE_PX = 5;
/** Fangradius in Bildpunkten. */
const FANG_PX = 12;
/**
 * Ab diesem Maßstab (Bildpunkte je Meter) stehen Steigwegnamen und Fortsetzungen ausgeschrieben im
 * Plan; darunter nur ein Pfeil - sonst überdecken sie Raum- und Maßtexte (Nachkorrektur 6b.5). Die
 * volle Angabe bleibt erreichbar: am gewählten Wegpunkt, als Titel und in der Wegpunktliste.
 */
const AUSFUEHRLICH_AB_PX_JE_M = 120;

const FLAECHE_TEXT: Record<Planflaeche, string> = { wand: "Wand", decke: "Decke", fussboden: "Fußboden" };
const STATUS_TEXT: Record<string, string> = { confirmed: "bestätigt", incomplete: "unvollständig", conflict: "Konflikt" };

/**
 * Leitungsplanung im Grundriss (Phase 6b.5, Entwurf §5.5, §9.1).
 *
 * Werkzeug „Leitung“: Ein Klick setzt nach der gewählten Ebene einen
 * Fußboden-, Wand- oder Deckenpunkt (nach dem gewählten Wegpunkt, sonst ans
 * Ende). Klick auf eine Tür oder einen Durchgang (Ebene Fußboden) setzt
 * ausdrücklich einen Bodenübergang, Klick auf einen Steigweghalt beginnt die
 * Steigwegnutzung, Klick auf ein Gerät des Stromkreises setzt Start- bzw.
 * Endgerät. Werkzeug „Durchführung“: Klick auf eine gemeinsame Bauwand legt im
 * Entwurf eine neue Durchführung an. Fußboden- und Deckenpunkte lassen sich
 * ziehen - eine Bewegung ist ein Rückgängig-Schritt.
 *
 * Die Ebenenwahl gilt nur für **neue** Punkte; vorhandene Wegpunkte werden nie
 * umgewandelt. Es entsteht kein Punkt, den niemand gesetzt hat.
 */
export function useGrundrissleitungen({
  k,
  einstellung,
  floorId,
  wandUnterZeiger,
  fangAktiv,
  rasterMm,
  onStatus,
}: {
  k: Leitungskontext | undefined;
  einstellung: Grundrisseinstellung | null;
  floorId: string;
  wandUnterZeiger: (welt: Punkt, massstab: number) => Wandtreffer;
  fangAktiv: boolean;
  rasterMm: number;
  onStatus: (text: string | null) => void;
}) {
  const masse = useMasse();
  const [kandidat, setKandidatState] = useState<Kandidat | null>(null);
  // Das Loslassen liest den Kandidaten aus der Ref: Es darf nie einen Stand vor dem letzten Rendern sehen.
  const kandidatRef = useRef<Kandidat | null>(null);
  const setKandidat = (c: Kandidat | null) => {
    kandidatRef.current = c;
    setKandidatState(c);
  };
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [steigwahl, setSteigwahl] = useState<Steigwahl | null>(null);
  const laufend = useRef<{ art: "setzen" } | { art: "ziehen"; index: number; gueltig: boolean } | null>(null);

  const p = k?.planung;
  const e = p?.entwurf ?? null;
  const v = p?.vorbereitetEntwurf ?? null;
  const werkzeug = einstellung?.werkzeug ?? "aus";
  const ebene = einstellung?.ebene ?? "fussboden";
  const darf = p !== undefined && p.darfLeitungen && e !== null && e.status !== "speichert";

  // Anderes Werkzeug oder andere Ebene: keine alte Vorschau stehen lassen.
  const [wahlVorher, setWahlVorher] = useState(`${werkzeug}|${ebene}`);
  if (wahlVorher !== `${werkzeug}|${ebene}`) {
    setWahlVorher(`${werkzeug}|${ebene}`);
    setKandidatState(null);
  }

  // ------------------------------------------------------------ Daten des Geschosses

  /** Steighalte auf diesem Geschoss. */
  const halte = useMemo(
    () =>
      (p?.steigwege ?? []).flatMap((s) =>
        s.stops.filter((h) => h.floor_id === floorId).map((h) => ({ steigwegId: s.id, name: s.name, haltId: h.id, punkt: { x: h.x_mm, y: h.y_mm } })),
      ),
    [p?.steigwege, floorId],
  );

  /** Gespeicherte Leitungen mit Läufen auf diesem Geschoss (Serverstand). */
  const andere = useMemo(() => {
    if (p === undefined) return [];
    return p.leitungen
      .filter((l) => l.id !== e?.cableId)
      .map((l) => ({
        l,
        teile: l.segments
          .filter((s) => s.floor_id === floorId && s.points.length >= 2 && ["wall", "ceiling", "floor", "connection"].includes(s.kind))
          .map((s): { flaeche: Planflaeche; wandId: string | null; punkte: Punkt[] } => ({
            flaeche: s.kind === "floor" ? "fussboden" : s.kind === "ceiling" ? "decke" : v?.waende.has(s.owner_id) === true ? "wand" : "decke",
            wandId: v?.waende.has(s.owner_id) === true ? s.owner_id : null,
            punkte: s.points.map((q) => ({ x: q.x_mm, y: q.y_mm })),
          })),
      }))
      .filter((x) => x.teile.length > 0);
  }, [p, e?.cableId, floorId, v]);

  const relevant = useMemo(() => {
    const ids = new Set(andere.map((x) => x.l.id));
    if (e?.cableId != null) ids.add(e.cableId);
    return ids;
  }, [andere, e?.cableId]);

  /** Lage eines Wegpunkts im Grundriss dieses Geschosses - sonst `null`. */
  const planpunkt = (wp: Wegpunkt | undefined): { punkt: Punkt; wandId: string | null } | null => {
    if (wp === undefined || v === null) return null;
    switch (wp.art) {
      case "floor":
      case "ceiling":
        return v.raeume.get(wp.raumId)?.geschossId === floorId ? { punkt: { x: wp.x, y: wp.y }, wandId: null } : null;
      case "wand": {
        const info = v.waende.get(wp.wandId);
        return info !== undefined && info.raum.geschossId === floorId ? { punkt: achsenpunkt(info, wp.abstandMm), wandId: wp.wandId } : null;
      }
      case "uebergang": {
        const info = v.waende.get(wp.wandId);
        return info !== undefined && info.raum.geschossId === floorId ? { punkt: achsenpunkt(info, wp.abstandMm), wandId: null } : null;
      }
      case "durchfuehrung": {
        const d = v.durchfuehrungen.get(wp.durchfuehrungId);
        const kopplung = d === undefined ? undefined : v.kopplungen.get(d.kopplungId);
        const info = kopplung === undefined ? undefined : v.waende.get(kopplung.wandA);
        return d !== undefined && info !== undefined && info.raum.geschossId === floorId ? { punkt: achsenpunkt(info, d.abstandMm), wandId: null } : null;
      }
      case "steigweg": {
        const s = p?.steigwege.find((x) => x.id === wp.steigwegId);
        const h = s?.stops.find((x) => (x.id === wp.vonHalt || x.id === wp.nachHalt) && x.floor_id === floorId);
        return h === undefined ? null : { punkt: { x: h.x_mm, y: h.y_mm }, wandId: null };
      }
    }
  };

  // ------------------------------------------------------------ Kandidat

  const einfuegeIndex = (w: Leitungswerte) => (e?.auswahl === null || e?.auswahl === undefined ? w.wegpunkte.length : e.auswahl + 1);

  /** Fangziele für Fußboden- und Deckenpunkte dieses Geschosses. */
  const flaechenziele = (vp: VorbereiteterPlan, decke: boolean): Fangpunkt[] => {
    const ziele: Fangpunkt[] = [];
    for (const h of halte) ziele.push({ punkt: h.punkt, text: `Steigweghalt ${h.name}` });
    for (const g of vp.geraete.values()) {
      if (vp.raeume.get(g.raumId)?.geschossId !== floorId) continue;
      if (g.flaeche === "ceiling" && decke && g.x != null && g.y != null) ziele.push({ punkt: { x: g.x, y: g.y }, text: `Gerät ${p?.geraetName(g.id) ?? ""}` });
      if (g.flaeche === "wall_interior" && g.wandId != null && g.abstandMm != null) {
        const info = vp.waende.get(g.wandId);
        const fuss = info === undefined ? null : achsgitterpunkt(info, achsenpunkt(info, g.abstandMm));
        if (fuss !== null && fuss.abstandMm === g.abstandMm) ziele.push({ punkt: fuss.punkt, text: `${decke ? "Achse über" : "Fußpunkt"} ${p?.geraetName(g.id) ?? "Gerät"}` });
      }
    }
    return ziele;
  };

  /** Nächster Achspunkt einer Wand dieses Geschosses (Übergang Wand ↔ Fläche). */
  const achsziel = (vp: VorbereiteterPlan, roh: Punkt, radiusMm: number): Fangpunkt | null => {
    let bestes: { ziel: Fangpunkt; quer: number } | null = null;
    for (const info of vp.waende.values()) {
      if (info.raum.geschossId !== floorId) continue;
      const g = achsgitterpunkt(info, roh);
      if (g.abstandMm === null || g.querMm > radiusMm) continue;
      if (Math.hypot(g.punkt.x - roh.x, g.punkt.y - roh.y) > radiusMm * 2) continue;
      if (bestes === null || g.querMm < bestes.quer) bestes = { ziel: { punkt: g.punkt, text: "Wandachse (Übergang zur Wand)" }, quer: g.querMm };
    }
    return bestes?.ziel ?? null;
  };

  const kandidatFuer = (roh: Punkt, ereignis: Pick<Zeigerereignis, "altKey" | "massstab">, ersetzen: number | null): Kandidat | null => {
    if (e === null || p === undefined || v === null) return null;
    const w = e.werte;
    const index = ersetzen ?? einfuegeIndex(w);
    const vor = w.wegpunkte[index - 1];
    const radiusMm = FANG_PX / ereignis.massstab;
    const f = { aktiv: fangAktiv, ausgesetzt: ereignis.altKey, radiusMm, rasterMm };
    const art = ersetzen === null ? ebene : w.wegpunkte[ersetzen]?.art === "ceiling" ? "decke" : "fussboden";
    let wp: Wegpunkt;
    let punkt: Punkt;
    let text: string;
    if (art === "wand") {
      const t = wandUnterZeiger(roh, ereignis.massstab);
      if (t === null || !t.ok) {
        return { punkt: roh, ok: false, grund: t === null ? "Für einen Wandpunkt auf eine Raumwand zeigen." : t.grund, werte: w, index, text: "", von: planpunkt(vor)?.punkt ?? null };
      }
      const info = v.waende.get(t.wandId);
      if (info === undefined) return null;
      const { start, ende } = info.wand;
      const laenge = info.laengeMm;
      const roheLage = ((roh.x - start.x) * (ende.x - start.x) + (roh.y - start.y) * (ende.y - start.y)) / Math.max(1, laenge);
      // Fang entlang der Wand: Wandenden, Achslage des Vorgängers, Geräte, Raster.
      const lagen: { wert: number; text: string }[] = [
        { wert: 0, text: "Wandanfang" },
        { wert: laenge, text: "Wandende" },
      ];
      const vorPunkt = planpunkt(vor);
      if (vorPunkt !== null) {
        const g = achsgitterpunkt(info, vorPunkt.punkt);
        if (g.abstandMm !== null && g.querMm === 0) lagen.push({ wert: g.abstandMm, text: "Lage des vorigen Punkts" });
      }
      for (const g of v.geraete.values()) {
        if (g.wandId === t.wandId && g.abstandMm != null) lagen.push({ wert: g.abstandMm, text: `Gerät ${p.geraetName(g.id)}` });
      }
      let abstand = Math.min(laenge, Math.max(0, Math.round(roheLage)));
      text = "";
      if (fangAktiv && !ereignis.altKey) {
        const naechste = lagen.filter((l) => Math.abs(l.wert - roheLage) <= radiusMm).sort((a, b) => Math.abs(a.wert - roheLage) - Math.abs(b.wert - roheLage))[0];
        if (naechste !== undefined) {
          abstand = naechste.wert;
          text = naechste.text;
        } else abstand = Math.min(laenge, Math.max(0, Math.round(roheLage / rasterMm) * rasterMm));
      }
      const hoehe = wandhoeheIn(einstellung?.wandhoehe ?? 300, info.raum.hoeheMm);
      wp = { art: "wand", wandId: t.wandId, abstandMm: abstand, hoeheMm: Math.min(hoehe, info.raum.hoeheMm) };
      punkt = achsenpunkt(info, abstand);
    } else {
      const decke = art === "decke";
      const ziele = flaechenziele(v, decke);
      const achse = achsziel(v, roh, radiusMm);
      if (achse !== null) ziele.push(achse);
      const fang = grundrissFangen(roh, ziele, f);
      const raumId = raumFuer(v, floorId, fang.punkt, roh, raumVon(v, vor));
      if (raumId === null) {
        return {
          punkt: fang.punkt,
          ok: false,
          grund: `Außerhalb eines Raums – ${decke ? "Decken" : "Fußboden"}punkte liegen in der Kontur eines Raums dieses Geschosses.`,
          werte: w,
          index,
          text: "",
          von: planpunkt(vor)?.punkt ?? null,
        };
      }
      wp = { art: decke ? "ceiling" : "floor", raumId, x: fang.punkt.x, y: fang.punkt.y };
      punkt = fang.punkt;
      text = fang.text ?? "";
    }
    const werte = ersetzen === null ? wegpunktEinfuegen(w, wp, index - 1 < 0 ? null : index - 1).werte : wegpunktErsetzen(w, ersetzen, wp);
    const geprueft = p.pruefen(werte, index);
    if (geprueft === null) return null;
    const von = planpunkt(ersetzen === null ? vor : w.wegpunkte[ersetzen - 1])?.punkt ?? null;
    return { punkt, ok: geprueft.ok, grund: geprueft.ok ? null : geprueft.grund, werte, index, text, von };
  };

  const kandidatStatus = (c: Kandidat, aktion: string) => {
    if (!c.ok) {
      onStatus(`Nicht möglich: ${c.grund ?? ""}`);
      return;
    }
    const wp = c.werte.wegpunkte[c.index];
    const ort = wp?.art === "wand" ? `${k?.wandName(wp.wandId) ?? ""} · ${masse.anzeigen(wp.abstandMm)} ab Wandanfang · ${masse.anzeigen(wp.hoeheMm)} hoch` : masse.punkt(c.punkt.x, c.punkt.y);
    onStatus(`Wegpunkt ${c.index + 1} ${aktion} (${wp === undefined ? "" : FLAECHE_TEXT[wp.art === "wand" ? "wand" : wp.art === "ceiling" ? "decke" : "fussboden"]}): ${ort}${c.text !== "" ? ` · eingerastet: ${c.text}` : ""}`);
  };

  // ------------------------------------------------------------ Aktionen

  const uebernehmen = (werte: Leitungswerte, index: number, text: string) => {
    p?.dispatch({ typ: "aendern", werte, auswahl: index });
    onStatus(text);
  };

  const geraetGeklickt = (id: string) => {
    if (e === null || p === undefined) return;
    const w = e.werte;
    if (!p.endpunkte(w.circuitId).some((g) => g.id === id)) {
      onStatus("Dieses Gerät ist weder die Verteilung noch dem Stromkreis zugeordnet – erst zuordnen, dann anschließen.");
      return;
    }
    if (w.startId === null && id !== w.endId) {
      p.dispatch({ typ: "aendern", werte: { ...w, startId: id } });
      onStatus(`Startgerät: ${p.geraetName(id)} – jetzt den Verlauf setzen.`);
    } else if (id === w.startId) {
      onStatus("Dieses Gerät ist bereits das Startgerät.");
    } else {
      p.dispatch({ typ: "aendern", werte: { ...w, endId: id } });
      onStatus(`Endgerät: ${p.geraetName(id)} – Länge und Befunde prüfen, dann speichern.`);
    }
  };

  /** Bodenübergang an einer Tür oder einem Durchgang - nur ausdrücklich gesetzt (D11). */
  const uebergangSetzen = (wandId: string, oeffnungId: string, roh: Punkt, ereignis: Pick<Zeigerereignis, "altKey" | "massstab">) => {
    if (e === null || p === undefined || v === null) return;
    const info = v.waende.get(wandId);
    const o = info?.wand.oeffnungen.find((x) => x.oeffnungId === oeffnungId);
    if (info === undefined || o === undefined) {
      onStatus("Diese Öffnung ist im gespeicherten Stand nicht bekannt.");
      return;
    }
    if (o.art === "window") {
      onStatus("Kein Bodenübergang an einem Fenster – nur an einer Tür oder einem Durchgang.");
      return;
    }
    const { start, ende } = info.wand;
    const roheLage = ((roh.x - start.x) * (ende.x - start.x) + (roh.y - start.y) * (ende.y - start.y)) / Math.max(1, info.laengeMm);
    const kanten = [
      { wert: o.offsetMm, text: "Türkante" },
      { wert: o.offsetMm + Math.round(o.breiteMm / 2), text: "Türmitte" },
      { wert: o.offsetMm + o.breiteMm, text: "Türkante" },
    ];
    let abstand = Math.min(o.offsetMm + o.breiteMm, Math.max(o.offsetMm, Math.round(roheLage)));
    let text = "";
    if (fangAktiv && !ereignis.altKey) {
      const radiusMm = FANG_PX / ereignis.massstab;
      const naechste = kanten.filter((x) => Math.abs(x.wert - roheLage) <= radiusMm).sort((a, b) => Math.abs(a.wert - roheLage) - Math.abs(b.wert - roheLage))[0];
      if (naechste !== undefined) {
        abstand = naechste.wert;
        text = naechste.text;
      }
    }
    const w = e.werte;
    const index = einfuegeIndex(w);
    const werte = wegpunktEinfuegen(w, { art: "uebergang", wandId, abstandMm: abstand, oeffnungId }, index - 1 < 0 ? null : index - 1).werte;
    const geprueft = p.pruefen(werte, index);
    if (geprueft === null) return;
    // Als letzter Punkt fehlt die Gegenseite noch - das ist ein Zwischenstand, kein Fehler der Stelle.
    const konflikt = konfliktAn(geprueft.ergebnis, betroffeneOrte(index, werte.wegpunkte.length));
    const nurReihenfolge = konflikt?.code === "opening-crossing-sequence" && index === werte.wegpunkte.length - 1;
    if (konflikt !== null && !nurReihenfolge) {
      onStatus(`Kein Bodenübergang: ${leitungsbefundText(konflikt.code)}`);
      return;
    }
    uebernehmen(
      werte,
      index,
      `Bodenübergang als Wegpunkt ${index + 1}${text !== "" ? ` (${text})` : ""} – ${nurReihenfolge ? "jetzt den Fußbodenpunkt im Nachbarraum setzen." : "noch nicht gespeichert."}`,
    );
  };

  /** Neue Durchführung an der angeklickten Raumwand - Höhe wie neue Wandpunkte. */
  const durchfuehrungAnlegen = (roh: Punkt, massstab: number) => {
    if (e === null || p === undefined || v === null) return;
    const t = wandUnterZeiger(roh, massstab);
    if (t === null || !t.ok) {
      onStatus(t === null ? "Für eine Durchführung auf eine gemeinsame Bauwand zeigen." : t.grund);
      return;
    }
    const info = v.waende.get(t.wandId);
    if (info === undefined) return;
    const { start, ende } = info.wand;
    const roheLage = ((roh.x - start.x) * (ende.x - start.x) + (roh.y - start.y) * (ende.y - start.y)) / Math.max(1, info.laengeMm);
    const abstand = Math.min(info.laengeMm, Math.max(0, fangAktiv ? Math.round(roheLage / rasterMm) * rasterMm : Math.round(roheLage)));
    const ziel = durchfuehrungsziel(v, t.wandId, abstand);
    if (!ziel.ok) {
      onStatus(`Keine Durchführung: ${ziel.grund}`);
      return;
    }
    const hoehe = wandhoeheIn(einstellung?.wandhoehe ?? 300, info.raum.hoeheMm);
    const w = e.werte;
    const nach = e.auswahl ?? (w.wegpunkte.length === 0 ? null : w.wegpunkte.length - 1);
    const neu = { schluessel: neuerSchluessel(), kopplungId: ziel.kopplungId, abstandMm: ziel.abstandMm, hoeheMm: hoehe };
    const { werte, index } = durchfuehrungEinfuegen(w, neu, nach);
    const geprueft = p.pruefen(werte, index);
    if (geprueft === null) return;
    if (!geprueft.ok) {
      onStatus(`Keine Durchführung: ${geprueft.grund}`);
      return;
    }
    uebernehmen(werte, index, `Neue Durchführung als Wegpunkt ${index + 1} (${masse.anzeigen(hoehe)} hoch) – entsteht erst beim Speichern der Leitung.`);
  };

  const durchfuehrungAufnehmen = (id: string) => {
    if (e === null || p === undefined) return;
    const w = e.werte;
    const index = einfuegeIndex(w);
    const daneben = durchfuehrungDaneben(w, index, id);
    if (daneben !== null) {
      onStatus(`Diese Durchführung ist bereits Wegpunkt ${daneben + 1} – weiter mit einem Wandpunkt auf der Gegenseite.`);
      return;
    }
    const werte = wegpunktEinfuegen(w, { art: "durchfuehrung", durchfuehrungId: id }, index - 1 < 0 ? null : index - 1).werte;
    const geprueft = p.pruefen(werte, index);
    if (geprueft === null) return;
    if (!geprueft.ok) {
      onStatus(`Durchführung nicht aufgenommen: ${geprueft.grund}`);
      return;
    }
    uebernehmen(werte, index, `Durchführung als Wegpunkt ${index + 1} aufgenommen.`);
  };

  /** Einstiegshöhe am Halt, wenn der Wegpunkt genau dort liegt - sonst `null`. */
  const einstiegAm = (wp: Wegpunkt | undefined, halt: Punkt): number | null => {
    if (wp === undefined || v === null) return null;
    if ((wp.art === "floor" || wp.art === "ceiling") && wp.x === halt.x && wp.y === halt.y && v.raeume.get(wp.raumId)?.geschossId === floorId) {
      return wp.art === "floor" ? 0 : (v.raeume.get(wp.raumId)?.hoeheMm ?? null);
    }
    if (wp.art === "wand") {
      const info = v.waende.get(wp.wandId);
      if (info === undefined || info.raum.geschossId !== floorId) return null;
      const g = achsgitterpunkt(info, halt);
      return g.querMm === 0 && g.abstandMm === wp.abstandMm && g.punkt.x === halt.x && g.punkt.y === halt.y ? wp.hoeheMm : null;
    }
    return null;
  };

  /** Steighalt geklickt: ggf. erst einen Punkt am Halt setzen (ausdrücklich), dann den Steigweg wählen. */
  const haltGeklickt = (steigwegId: string, haltId: string) => {
    if (e === null || p === undefined || v === null) return;
    const halt = halte.find((h) => h.steigwegId === steigwegId && h.haltId === haltId);
    if (halt === undefined) return;
    const w = e.werte;
    let index = einfuegeIndex(w);
    const vor = w.wegpunkte[index - 1];
    // Fortsetzung nach einem Steigweg: der Punkt am Ausstiegshalt - auf Fußboden (Ausstieg 0) oder Decke.
    if (vor?.art === "steigweg" && vor.nachHalt === haltId) {
      const raumId = raumFuer(v, floorId, halt.punkt, halt.punkt, null);
      if (raumId === null) {
        onStatus("Der Halt liegt in keinem eindeutigen Raum dieses Geschosses – hier kann nicht fortgesetzt werden.");
        return;
      }
      const decke = vor.nachHoeheMm > 0 && vor.nachHoeheMm === v.raeume.get(raumId)?.hoeheMm;
      if (vor.nachHoeheMm > 0 && !decke) {
        onStatus("Der Ausstieg liegt über dem Fußboden – weiter mit einem Wandpunkt genau über dem Halt (Ebene Wand) in dieser Höhe.");
        return;
      }
      const wp: Wegpunkt = { art: decke ? "ceiling" : "floor", raumId, x: halt.punkt.x, y: halt.punkt.y };
      const neu = wegpunktEinfuegen(w, wp, index - 1).werte;
      const geprueft = p.pruefen(neu, index);
      if (geprueft === null) return;
      if (!geprueft.ok) {
        onStatus(`Nicht fortgesetzt: ${geprueft.grund}`);
        return;
      }
      uebernehmen(neu, index, `Fortsetzung am Halt als Wegpunkt ${index + 1} (${decke ? "Decke" : "Fußboden"}) – weiter zum Endgerät.`);
      return;
    }
    let einstieg = einstiegAm(vor, halt.punkt);
    if (einstieg === null) {
      if (ebene === "wand") {
        onStatus("Für den Einstieg zuerst einen Fußboden- oder Deckenpunkt genau am Halt setzen (Ebene Fußboden oder Decke).");
        return;
      }
      const raumId = raumFuer(v, floorId, halt.punkt, halt.punkt, raumVon(v, w.wegpunkte[index - 1]));
      if (raumId === null) {
        onStatus("Der Halt liegt in keinem eindeutigen Raum dieses Geschosses – Einstieg hier nicht möglich.");
        return;
      }
      const wp: Wegpunkt = { art: ebene === "decke" ? "ceiling" : "floor", raumId, x: halt.punkt.x, y: halt.punkt.y };
      const neu = wegpunktEinfuegen(w, wp, index - 1 < 0 ? null : index - 1).werte;
      const geprueft = p.pruefen(neu, index);
      if (geprueft === null) return;
      if (!geprueft.ok) {
        onStatus(`Kein Punkt am Halt: ${geprueft.grund}`);
        return;
      }
      p.dispatch({ typ: "aendern", werte: neu, auswahl: index });
      index += 1;
      einstieg = ebene === "decke" ? (v.raeume.get(raumId)?.hoeheMm ?? 0) : 0;
    }
    setSteigwahl({ steigwegId, haltId, einstiegMm: einstieg, index });
    onStatus(`Steigweg ${halt.name}: Zielhalt und Ausstieg im Seitenfeld wählen – Verlauf und Länge erscheinen vor dem Übernehmen.`);
  };

  // ------------------------------------------------------------ Zeiger

  const leitungAn = (ziel: Element | null) => ziel?.closest?.("[data-leitung]")?.getAttribute("data-leitung") ?? null;

  const zusatz: Flaechenzusatz = {
    cursor: werkzeug !== "aus" && darf ? "crosshair" : null,
    druecken: (ev) => {
      if (p === undefined) return false;
      const ziel = ev.ziel;
      const punkt = ziel?.closest?.("[data-wegpunkt]")?.getAttribute("data-wegpunkt") ?? null;
      if (punkt !== null && e !== null) {
        const index = Number(punkt);
        p.dispatch({ typ: "auswaehlen", auswahl: index });
        const wp = e.werte.wegpunkte[index];
        if (darf && (wp?.art === "floor" || wp?.art === "ceiling")) {
          p.dispatch({ typ: "ziehen-beginnen" });
          laufend.current = { art: "ziehen", index, gueltig: false };
        }
        onStatus(`Wegpunkt ${index + 1} gewählt – neue Punkte folgen ihm${darf ? "; Entf entfernt ihn" : ""}.`);
        return true;
      }
      if (werkzeug === "aus" || !darf) {
        const leitung = leitungAn(ziel);
        if (leitung !== null && e === null) {
          setGewaehlt(leitung);
          return true;
        }
        return false;
      }
      const halt = ziel?.closest?.("[data-steighalt]")?.getAttribute("data-steighalt") ?? null;
      if (halt !== null && werkzeug === "leitung") {
        const [steigwegId, haltId] = halt.split("|") as [string, string];
        haltGeklickt(steigwegId, haltId);
        return true;
      }
      const durchfuehrung = ziel?.closest?.("[data-durchfuehrung]")?.getAttribute("data-durchfuehrung") ?? null;
      if (durchfuehrung !== null) {
        durchfuehrungAufnehmen(durchfuehrung);
        return true;
      }
      if (werkzeug === "durchfuehrung") {
        durchfuehrungAnlegen(ev.welt, ev.massstab);
        return true;
      }
      if (ziel?.closest?.("[data-geraetegruppe]") != null) return false;
      const geraet = ziel?.closest?.("[data-geraet]")?.getAttribute("data-geraet") ?? null;
      if (geraet !== null) {
        geraetGeklickt(geraet);
        return true;
      }
      const oeffnung = ziel?.closest?.("[data-oeffnung]");
      const oeffnungId = oeffnung?.getAttribute("data-oeffnung") ?? null;
      const oeffnungWand = oeffnung?.getAttribute("data-wand") ?? null;
      if (ebene === "fussboden" && oeffnungId !== null && oeffnungWand !== null) {
        uebergangSetzen(oeffnungWand, oeffnungId, ev.welt, ev);
        return true;
      }
      const c = kandidatFuer(ev.welt, ev, null);
      setKandidat(c);
      if (c !== null) kandidatStatus(c, "setzen");
      laufend.current = { art: "setzen" };
      return true;
    },
    bewegen: (ev, aktiv) => {
      const l = laufend.current;
      if (aktiv && l?.art === "ziehen") {
        const c = kandidatFuer(ev.welt, ev, l.index);
        setKandidat(c);
        if (c === null) return true;
        kandidatStatus(c, "verschieben");
        if (c.ok) {
          l.gueltig = true;
          p?.dispatch({ typ: "ziehen-vorschau", werte: c.werte });
        }
        return true;
      }
      if ((aktiv && l?.art === "setzen") || (!aktiv && werkzeug === "leitung" && darf)) {
        const c = kandidatFuer(ev.welt, ev, null);
        setKandidat(c);
        return false;
      }
      return false;
    },
    loslassen: () => {
      const l = laufend.current;
      laufend.current = null;
      if (l?.art === "ziehen") {
        setKandidat(null);
        p?.dispatch({ typ: "ziehen-beenden" });
        onStatus(l.gueltig ? "Verschoben – noch nicht gespeichert." : "Keine gültige neue Lage – nichts geändert.");
        return;
      }
      if (l?.art === "setzen") {
        const c = kandidatRef.current;
        setKandidat(null);
        if (c === null) return;
        if (!c.ok) {
          onStatus(`Nicht gesetzt: ${c.grund ?? ""}`);
          return;
        }
        uebernehmen(c.werte, c.index, `Wegpunkt ${c.index + 1} gesetzt${c.text !== "" ? ` (eingerastet: ${c.text})` : ""} – noch nicht gespeichert.`);
      }
    },
    abbrechen: () => {
      const l = laufend.current;
      laufend.current = null;
      setKandidat(null);
      if (l?.art === "ziehen") {
        p?.dispatch({ typ: "ziehen-abbrechen" });
        onStatus("Bewegung abgebrochen – nichts geändert.");
        return true;
      }
      return l !== null;
    },
    zeichnen: (b) => zeichnen(b),
  };

  // ------------------------------------------------------------ Tastatur

  /** Tasten der Leitungsplanung im Grundriss; `true` = verarbeitet. */
  const taste = (event: KeyboardEvent): boolean => {
    if (p === undefined || e === null || einstellung === null) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const index = e.auswahl;
    if ((event.key === "Delete" || event.key === "Backspace") && index !== null && darf && e.werte.wegpunkte[index] !== undefined) {
      event.preventDefault();
      p.dispatch({ typ: "aendern", werte: wegpunktEntfernen(e.werte, index), auswahl: index > 0 ? index - 1 : null });
      onStatus(`Wegpunkt ${index + 1} entfernt – noch nicht gespeichert.`);
      return true;
    }
    if (event.key === "Escape") {
      const bewegung = zusatz.abbrechen();
      if (bewegung || kandidat !== null || steigwahl !== null) {
        setKandidat(null);
        setSteigwahl(null);
        return true;
      }
    }
    if (event.key === "Enter" && werkzeug !== "aus") {
      einstellung.setWerkzeug("aus");
      setKandidat(null);
      onStatus(e.werte.endId === null ? "Zeichnen beendet – bitte noch das Endgerät wählen." : "Zeichnen beendet – Länge und Befunde prüfen, dann speichern.");
      return true;
    }
    if (!darf) return false;
    const kk = event.key.toLowerCase();
    if (kk === "l") einstellung.setWerkzeug("leitung");
    else if (kk === "u") einstellung.setWerkzeug("durchfuehrung");
    else if (kk === "1") einstellung.setEbene("fussboden");
    else if (kk === "2") einstellung.setEbene("wand");
    else if (kk === "3") einstellung.setEbene("decke");
    else return false;
    return true;
  };

  // ------------------------------------------------------------ Zeichnen

  const seitlich = (a: Bildpunkt, wandId: string | null): Bildpunkt => {
    const n = wandId === null || v === null ? null : raumseite(v, wandId);
    // Bildschirm-y zeigt wie Welt-y nach unten - die Richtung bleibt gleich.
    return n === null ? a : { x: a.x + n.x * SEITE_PX, y: a.y + n.y * SEITE_PX };
  };

  const zeichnen = (b: (x: number, y: number) => Bildpunkt): ReactNode => {
    if (p === undefined) return null;
    const teile: ReactNode[] = [];
    const ausfuehrlich = Math.abs(b(1000, 0).x - b(0, 0).x) >= AUSFUEHRLICH_AB_PX_JE_M;
    for (const { l, teile: stuecke } of andere) {
      const klasse = `leitung-plan leitung-plan--andere leitung-plan--${l.status}${l.id === gewaehlt ? " leitung-plan--gewaehlt" : ""}`;
      stuecke.forEach((s, i) => {
        const d = s.punkte.map((q, j) => {
          const m = seitlich(b(q.x, q.y), s.wandId);
          return `${j === 0 ? "M" : "L"}${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
        });
        teile.push(
          <g key={`andere-${l.id}-${i}`} data-leitung={l.id} data-testid={`plan-leitung-${l.id}`}>
            <path d={d.join("")} className={`${klasse} leitung-plan--${s.flaeche}`} />
            <path d={d.join("")} className="leitung-treffer">
              <title>{`Leitung ${l.label ?? ""} – ${FLAECHE_TEXT[s.flaeche]} – ${STATUS_TEXT[l.status] ?? l.status}`}</title>
            </path>
          </g>,
        );
      });
    }
    if (e !== null && v !== null && p.ergebnis !== null) {
      const status = p.ergebnis.status;
      grundrissstrecken(v, p.ergebnis, floorId).forEach((s, i) => {
        const a = seitlich(b(s.a.x, s.a.y), s.wandId);
        const c = seitlich(b(s.b.x, s.b.y), s.wandId);
        teile.push(
          <line
            key={`entwurf-${i}`}
            x1={a.x}
            y1={a.y}
            x2={c.x}
            y2={c.y}
            data-testid="plan-entwurf-strecke"
            data-flaeche={s.flaeche}
            className={`leitung-plan leitung-plan--entwurf leitung-plan--${status} leitung-plan--${s.flaeche}`}
          />,
        );
      });
    }
    // Steighalte: Einstieg nur, solange das Werkzeug „Leitung“ aktiv ist.
    if (e !== null && werkzeug === "leitung" && darf) {
      for (const h of halte) {
        const m = b(h.punkt.x, h.punkt.y);
        teile.push(
          <g key={`halt-${h.steigwegId}-${h.haltId}`} data-steighalt={`${h.steigwegId}|${h.haltId}`} data-testid={`plan-halt-${h.haltId}`}>
            <rect x={m.x - 8} y={m.y - 8} width={16} height={16} className="leitung-halt">
              <title>{`Steigweg ${h.name} – Klick: Steigweg nutzen`}</title>
            </rect>
            {ausfuehrlich && (
              <text x={m.x + 11} y={m.y - 9} className="leitung-plan-text" data-testid="plan-halt-name">
                {h.name}
              </text>
            )}
          </g>,
        );
      }
    }
    if (e !== null && v !== null) {
      // Neue Durchführungen des Entwurfs (an der Eigentümerwand).
      for (const n of e.werte.neueDurchfuehrungen) {
        const kopplung = v.kopplungen.get(n.kopplungId);
        const info = kopplung === undefined ? undefined : v.waende.get(kopplung.wandA);
        if (info === undefined || info.raum.geschossId !== floorId) continue;
        const lage = achsenpunkt(info, n.abstandMm);
        const m = b(lage.x, lage.y);
        teile.push(
          // Nur Anzeige: Die neue Durchführung ist schon Wegpunkt; ihre Marke liegt auf der Achse und
          // würde sonst den Klick auf die Gegenseite abfangen (Befund der Browserabnahme 6b.5).
          <circle
            key={`neu-${n.schluessel}`}
            cx={m.x}
            cy={m.y}
            r={7}
            style={{ pointerEvents: "none" }}
            className="leitung-durchfuehrung leitung-durchfuehrung--neu"
            data-testid="plan-neue-durchfuehrung"
          >
            <title>Neue Durchführung – entsteht erst beim Speichern der Leitung</title>
          </circle>,
        );
      }
      // Wegpunkte des Entwurfs auf diesem Geschoss; Steigwege mit ausdrücklicher Fortsetzung.
      e.werte.wegpunkte.forEach((wp, index) => {
        const lage = planpunkt(wp);
        if (lage === null) return;
        const m = seitlich(b(lage.punkt.x, lage.punkt.y), lage.wandId);
        const gewaehltIst = e.auswahl === index;
        // Im Werkzeug sind nur die Punkte der gewählten Ebene greifbar (Fußboden bzw. Decke, zum Ziehen).
        // Alle anderen Marken lassen den Klick durch - sonst verdeckten sie die Wandachse genau dort, wo
        // der Übergang gesetzt wird (Befund der Browserabnahme 6b.5). Gewählt werden sie über die Liste.
        const greifbar = werkzeug === "leitung" && ((ebene === "fussboden" && wp.art === "floor") || (ebene === "decke" && wp.art === "ceiling"));
        const durchlaessig = werkzeug !== "aus" && !greifbar;
        teile.push(
          <g
            key={`wp-${index}`}
            data-wegpunkt={durchlaessig ? undefined : index}
            data-testid={`plan-wegpunkt-${index}`}
            data-art={wp.art}
            style={durchlaessig ? { pointerEvents: "none" } : undefined}
          >
            <circle cx={m.x} cy={m.y} r={8} className={`leitung-punkt leitung-punkt--${wp.art}${gewaehltIst ? " leitung-punkt--gewaehlt" : ""}`}>
              <title>{`Wegpunkt ${index + 1}${wp.art === "steigweg" ? ` – ${steigwegText(wp, p, masse.anzeigen)}` : ""}`}</title>
            </circle>
            <text x={m.x} y={m.y + 3.5} textAnchor="middle" className={`leitung-punkt-text${gewaehltIst ? " leitung-punkt-text--gewaehlt" : ""}`}>
              {index + 1}
            </text>
          </g>,
        );
        if (wp.art === "steigweg") {
          const s = p.steigwege.find((x) => x.id === wp.steigwegId);
          const hier = s?.stops.find((x) => (x.id === wp.vonHalt || x.id === wp.nachHalt) && x.floor_id === floorId);
          const dort = s?.stops.find((x) => (x.id === wp.vonHalt || x.id === wp.nachHalt) && x.id !== hier?.id);
          if (hier !== undefined && dort !== undefined) {
            const weiter = hier.id === wp.vonHalt;
            const volltext = weiter ? `weiter in ${p.geschossName(dort.floor_id)} (${s?.name ?? ""})` : `kommt aus ${p.geschossName(dort.floor_id)} (${s?.name ?? ""})`;
            const ebeneHier = p.geschosse.find((g) => g.id === hier.floor_id)?.level ?? 0;
            const ebeneDort = p.geschosse.find((g) => g.id === dort.floor_id)?.level ?? 0;
            // Kurz: Pfeil in die Richtung des anderen Geschosses. Ausgeschrieben bei großem Maßstab oder Auswahl.
            const kurz = ebeneDort > ebeneHier ? "↑" : "↓";
            teile.push(
              <text
                key={`steig-${index}`}
                x={m.x + 12}
                y={m.y + 16}
                className="leitung-plan-text"
                data-testid="plan-steigweg-fortsetzung"
                data-volltext={volltext}
              >
                <title>{volltext}</title>
                {ausfuehrlich || gewaehltIst ? volltext : kurz}
              </text>,
            );
          }
        }
      });
    }
    if (kandidat !== null) {
      const m = b(kandidat.punkt.x, kandidat.punkt.y);
      if (kandidat.von !== null) {
        const a = b(kandidat.von.x, kandidat.von.y);
        teile.push(<line key="kandidat-strecke" x1={a.x} y1={a.y} x2={m.x} y2={m.y} className={`leitung-kandidat-strecke${kandidat.ok ? "" : " leitung-kandidat-strecke--fehler"}`} />);
      }
      teile.push(
        <circle key="kandidat" cx={m.x} cy={m.y} r={6} data-testid="plan-leitung-kandidat" data-gueltig={kandidat.ok ? "ja" : "nein"} className={`leitung-kandidat${kandidat.ok ? "" : " leitung-kandidat--fehler"}`} />,
      );
    }
    return <g data-testid="plan-leitungsebene">{teile}</g>;
  };

  return { zusatz, taste, relevant, gewaehlt, setGewaehlt, steigwahl, setSteigwahl };
}
