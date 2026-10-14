import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useMasse } from "../../../core/ui/masseinheit";
import { ganzzahligeWurzel } from "../editor/geometrie";
import type { Punkt } from "../editor/geometrie";
import type { Bildpunkt } from "../editor/viewport";
import { geraetezustand } from "../stromkreise/zuordnung";
import type { AnsichtsGeraet } from "../wandansicht/wandgeraete";
import type { Wandbezug } from "../wandansicht/wandbezug";
import type { Fangziel } from "../wandansicht/wandfang";
import type { Wandmodell } from "../wandansicht/wandmodell";
import "./leitung.css";
import { inAnsichtBearbeitbar } from "./daten";
import type { Leitungswerte } from "./entwurf";
import { durchfuehrungDaneben, durchfuehrungEinfuegen, wegpunktEinfuegen, wegpunktEntfernen, wegpunktErsetzen } from "./entwurf";
import { durchfuehrungsWandlage, durchfuehrungsziel, istNeu, neuerSchluessel } from "./durchfuehrung";
import type { Anschlusspunkt, Fangeinstellung } from "./flaechen";
import {
  achseFangen,
  anschlussFangen,
  rechtwinkligeLagen,
  wandFangziele,
  wandpunktAusAnsicht,
  wandpunktInAnsicht,
  wandstrecken,
  wandtrassen,
  zonenlinien,
} from "./flaechen";
import type { Leitungskontext } from "./kontext";
import type { Wegpunkt } from "./laenge";
import type { Flaechenzusatz, Zeigerereignis } from "./zusatz";

/** Werkzeuge der Leitungsplanung in einer Ansicht; „durchfuehrung“ legt eine neue im Entwurf an (6b.5). */
export type Leitungswerkzeug = "leitung" | "zuordnen" | "durchfuehrung";

interface Kandidat {
  readonly u: number;
  readonly h: number;
  readonly ok: boolean;
  readonly grund: string | null;
  readonly werte: Leitungswerte;
  readonly index: number;
  readonly zielU: Fangziel | null;
  readonly zielH: Fangziel | null;
  readonly anschluss: string | null;
  /** Vorgänger auf dieser Wand - für die gestrichelte Vorschau der Strecke. */
  readonly von: { u: number; h: number } | null;
}

/** Lage einer Durchführung auf dieser Wand (Eigentümerseite oder Gegenlage). */
interface Wanddurchfuehrung {
  readonly id: string;
  readonly u: number;
  readonly h: number;
  readonly fehler: boolean;
  /** Nur im Entwurf - entsteht erst mit der Leitung. */
  readonly neu: boolean;
}

function ganzerAbstand(a: Punkt, b: Punkt): number | null {
  const q = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const w = ganzzahligeWurzel(q);
  return w * w === q ? w : null;
}

/**
 * Leitungsplanung in der Wandansicht (Phase 6b.4).
 *
 * Gesten: Werkzeug „Leitung“ (L) - Klick auf die Wand setzt einen Wegpunkt
 * (nach dem gewählten, sonst ans Ende), Klick auf ein Gerät des Stromkreises
 * setzt Start- bzw. Endgerät, Klick auf eine Durchführung nimmt sie in den Weg
 * auf. Ein Wegpunkt lässt sich in jedem Werkzeug ziehen - eine Bewegung ist ein
 * Rückgängig-Schritt. Pfeiltasten verschieben ihn um 1 cm (Umschalt 10 cm),
 * Entf entfernt ihn, Enter schließt das Zeichnen ab, Escape bricht ab.
 */
export function useWandleitungen({
  k,
  bezug,
  modell,
  geraete,
  werkzeug,
  setWerkzeug,
  fangAktiv,
  rasterMm,
  onStatus,
}: {
  k: Leitungskontext | undefined;
  bezug: Wandbezug | null;
  modell: Wandmodell | null;
  geraete: readonly AnsichtsGeraet[];
  werkzeug: string;
  setWerkzeug: (w: "auswahl" | Leitungswerkzeug) => void;
  fangAktiv: boolean;
  rasterMm: number;
  onStatus: (text: string) => void;
}) {
  const masse = useMasse();
  const [kandidat, setKandidatState] = useState<Kandidat | null>(null);
  // Das Loslassen liest den Kandidaten aus der Ref: Folgen Bewegung und Loslassen vor dem nächsten
  // Rendern, sähe es sonst einen veralteten Vorschaupunkt (Nachkorrektur 6b.5, wie im Grundriss).
  const kandidatRef = useRef<Kandidat | null>(null);
  const setKandidat = (c: Kandidat | null) => {
    kandidatRef.current = c;
    setKandidatState(c);
  };
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [durchfuehrungId, setDurchfuehrungId] = useState<string | null>(null);
  const laufend = useRef<{ art: "setzen" } | { art: "ziehen"; index: number; gueltig: boolean } | null>(null);
  const vorher = useRef<{ u: string | null; h: string | null }>({ u: null, h: null });

  // Anderes Werkzeug: keine alte Vorschau stehen lassen.
  const [werkzeugVorher, setWerkzeugVorher] = useState(werkzeug);
  if (werkzeugVorher !== werkzeug) {
    setWerkzeugVorher(werkzeug);
    setKandidatState(null);
  }

  const p = k?.planung;
  const e = p?.entwurf ?? null;
  const innen = bezug?.seite !== "aussen";
  const darf = p !== undefined && p.darfLeitungen && e !== null && e.status !== "speichert" && innen;

  // ------------------------------------------------------------ Daten der Wand

  const neueDurchfuehrungen = e?.werte.neueDurchfuehrungen;
  const durchfuehrungen: Wanddurchfuehrung[] = useMemo(() => {
    if (p === undefined || bezug === null) return [];
    const gespeichert = p.durchfuehrungen.flatMap((d) => {
      if (d.wall_a_id === bezug.wandId) return [{ id: d.id, u: wandpunktInAnsicht(bezug, d.offset_mm, d.height_mm).u, h: d.height_mm, fehler: d.problem_code !== null, neu: false }];
      if (d.wall_b_id === bezug.wandId && d.opposite_offset !== null) {
        return [{ id: d.id, u: wandpunktInAnsicht(bezug, d.opposite_offset.rounded_mm, d.height_mm).u, h: d.height_mm, fehler: d.problem_code !== null, neu: false }];
      }
      return [];
    });
    // Neue Durchführungen des Entwurfs: Gegenlage über dieselbe geprüfte Transformation.
    const v = p.vorbereitetEntwurf;
    const neue = (neueDurchfuehrungen ?? []).flatMap((n) => {
      const d = v?.durchfuehrungen.get(n.schluessel);
      const lage = v === null || d === undefined ? null : durchfuehrungsWandlage(v, d, bezug.wandId);
      return lage === null ? [] : [{ id: n.schluessel, u: wandpunktInAnsicht(bezug, lage, n.hoeheMm).u, h: n.hoeheMm, fehler: false, neu: true }];
    });
    return [...gespeichert, ...neue];
  }, [p, bezug, neueDurchfuehrungen]);

  const andere = useMemo(() => {
    if (p === undefined || bezug === null) return [];
    return p.leitungen
      .filter((l) => l.id !== e?.cableId)
      .map((l) => {
        const r = p.ergebnisse.get(l.id);
        return { l, strecken: r === undefined ? [] : wandstrecken(r, bezug) };
      })
      .filter((x) => x.strecken.length > 0);
  }, [p, bezug, e?.cableId]);

  const relevant = useMemo(() => {
    const ids = new Set(andere.map((x) => x.l.id));
    const hier = new Set(geraete.map((g) => g.id));
    for (const l of p?.leitungen ?? []) {
      if ((l.start_device_id !== null && hier.has(l.start_device_id)) || hier.has(l.end_device_id)) ids.add(l.id);
    }
    if (e?.cableId != null) ids.add(e.cableId);
    return ids;
  }, [andere, geraete, p?.leitungen, e?.cableId]);

  /** Wegpunkte des Entwurfs auf dieser Wand. */
  const punkte = useMemo(() => {
    // Leitungen verlaufen innen - auf der Außenseite keine Wegpunkte.
    if (e === null || bezug === null || p === undefined || !innen) return [];
    return e.werte.wegpunkte.flatMap((wp, index) => {
      if (wp.art === "wand" && wp.wandId === bezug.wandId) return [{ index, ...wandpunktInAnsicht(bezug, wp.abstandMm, wp.hoeheMm), fest: false }];
      if (wp.art === "durchfuehrung") {
        const d = durchfuehrungen.find((x) => x.id === wp.durchfuehrungId);
        return d === undefined ? [] : [{ index, u: d.u, h: d.h, fest: true }];
      }
      return [];
    });
  }, [e, bezug, p, durchfuehrungen, innen]);

  // ------------------------------------------------------------ Kandidat

  const fang = (massstab: number, altKey: boolean): Fangeinstellung => ({ aktiv: fangAktiv, ausgesetzt: altKey, massstab, rasterMm });

  /** Lage eines Wegpunkts auf dieser Wand - Wandpunkt oder Durchführung hier, sonst `null`. */
  const aufDieserWand = (wp: Wegpunkt | undefined): { u: number; h: number } | null => {
    if (wp === undefined || bezug === null) return null;
    if (wp.art === "wand" && wp.wandId === bezug.wandId) return wandpunktInAnsicht(bezug, wp.abstandMm, wp.hoeheMm);
    if (wp.art === "durchfuehrung") {
      const d = durchfuehrungen.find((x) => x.id === wp.durchfuehrungId);
      return d === undefined ? null : { u: d.u, h: d.h };
    }
    return null;
  };

  /** Ausdrückliche Anschlusspunkte am Weg: Ecke zur Nachbarwand, Übergang von der Decke. */
  const anschluesse = (nachbarn: readonly (Wegpunkt | undefined)[]): Anschlusspunkt[] => {
    const v = p?.vorbereitet;
    if (v === undefined || v === null || bezug === null) return [];
    const hier = v.waende.get(bezug.wandId);
    if (hier === undefined) return [];
    const ergebnis: Anschlusspunkt[] = [];
    for (const n of nachbarn) {
      if (n === undefined) continue;
      if (n.art === "wand" && n.wandId !== bezug.wandId) {
        const dort = v.waende.get(n.wandId);
        if (dort === undefined || dort.raum.id !== hier.raum.id) continue;
        const gleich = (a: Punkt, b: Punkt) => a.x === b.x && a.y === b.y;
        if (gleich(dort.wand.ende, hier.wand.start) && n.abstandMm === dort.laengeMm) {
          ergebnis.push({ a: wandpunktInAnsicht(bezug, 0, n.hoeheMm).u, b: n.hoeheMm, text: `Ecke zu ${k?.wandName(n.wandId) ?? "Nachbarwand"}` });
        } else if (gleich(dort.wand.start, hier.wand.ende) && n.abstandMm === 0) {
          ergebnis.push({ a: wandpunktInAnsicht(bezug, hier.laengeMm, n.hoeheMm).u, b: n.hoeheMm, text: `Ecke zu ${k?.wandName(n.wandId) ?? "Nachbarwand"}` });
        }
      }
      if (n.art === "ceiling" && n.raumId === hier.raum.id) {
        const a = hier.wand.start;
        const b = hier.wand.ende;
        const quer = (b.x - a.x) * (n.y - a.y) - (b.y - a.y) * (n.x - a.x);
        const abstand = ganzerAbstand(a, { x: n.x, y: n.y });
        const innerhalb = (n.x - a.x) * (b.x - a.x) + (n.y - a.y) * (b.y - a.y) >= 0;
        if (quer === 0 && innerhalb && abstand !== null && abstand <= hier.laengeMm) {
          ergebnis.push({ a: wandpunktInAnsicht(bezug, abstand, hier.raum.hoeheMm).u, b: hier.raum.hoeheMm, text: "Übergang von der Decke" });
        }
      }
    }
    return ergebnis;
  };

  const kandidatFuer = (rohU: number, rohH: number, ereignis: Pick<Zeigerereignis, "altKey" | "massstab">, ersetzen: number | null): Kandidat | null => {
    if (e === null || p === undefined || p.vorbereitetEntwurf === null || bezug === null || modell === null) return null;
    const w = e.werte;
    const index = ersetzen ?? (e.auswahl === null ? w.wegpunkte.length : e.auswahl + 1);
    const vor = w.wegpunkte[index - 1];
    const nach = ersetzen === null ? w.wegpunkte[index] : w.wegpunkte[index + 1];
    const f = fang(ereignis.massstab, ereignis.altKey);
    const gleicheWand = [aufDieserWand(vor), aufDieserWand(nach)].filter((x): x is { u: number; h: number } => x !== null);
    const ziele = wandFangziele({
      laengeMm: bezug.laengeMm,
      hoeheMm: bezug.hoeheMm,
      geraete: geraete.map((g) => ({ id: g.id, name: p.geraetName(g.id).replace(/ \(.*\)$/, ""), u: g.u, h: g.h })),
      durchfuehrungen,
      oeffnungen: modell.oeffnungen.map((o, i) => ({ id: o.id, name: `Öffnung ${i + 1}`, links: o.links, rechts: o.rechts, unten: o.unten, oben: o.oben })),
      trassen: wandtrassen(andere.flatMap((x) => x.strecken)),
      zonen: zonenlinien(bezug.laengeMm, bezug.hoeheMm, modell.oeffnungen),
    });

    const versuchen = (u: number, h: number) => {
      const wp = wandpunktAusAnsicht(bezug, u, h);
      const werte = ersetzen === null ? wegpunktEinfuegen(w, wp, index - 1 < 0 ? null : index - 1).werte : wegpunktErsetzen(w, ersetzen, wp);
      // Ohne gewählten Punkt am Ende einfügen: `nach` = Index - 1 ergibt genau diese Stelle.
      const geprueft = p.pruefen(werte, index) ?? { ok: false as const, grund: "Der Plan ist noch nicht geladen." };
      return { werte, geprueft };
    };

    const ap = anschlussFangen({ a: rohU, b: rohH }, anschluesse([vor, nach]), f);
    let u: number;
    let h: number;
    let zielU: Fangziel | null = null;
    let zielH: Fangziel | null = null;
    if (ap !== null) {
      u = ap.a;
      h = ap.b;
    } else {
      const lage = rechtwinkligeLagen({ u: rohU, h: rohH }, gleicheWand)[0] ?? { u: null, h: null };
      const fu = lage.u !== null ? { wert: lage.u, ziel: null } : achseFangen(rohU, ziele.u, f, vorher.current.u);
      const fh = lage.h !== null ? { wert: lage.h, ziel: null } : achseFangen(rohH, ziele.h, f, vorher.current.h);
      u = fu.wert;
      h = fh.wert;
      zielU = fu.ziel;
      zielH = fh.ziel;
    }
    let { werte, geprueft } = versuchen(u, h);
    // Ein Fangziel darf keine ungültige Lage erzwingen: dann ohne Fang (Raster/ganze mm) versuchen.
    if (!geprueft.ok && ap === null && (zielU?.art !== "raster" || zielH?.art !== "raster")) {
      const lage = rechtwinkligeLagen({ u: rohU, h: rohH }, gleicheWand)[0] ?? { u: null, h: null };
      const frei = versuchen(lage.u ?? Math.round(rohU), lage.h ?? Math.round(rohH));
      if (frei.geprueft.ok) {
        u = lage.u ?? Math.round(rohU);
        h = lage.h ?? Math.round(rohH);
        ({ werte, geprueft } = frei);
        zielU = null;
        zielH = null;
      }
    }
    vorher.current = { u: zielU?.id ?? null, h: zielH?.id ?? null };
    const von = aufDieserWand(vor);
    return {
      u,
      h,
      ok: geprueft.ok,
      grund: geprueft.ok ? null : geprueft.grund,
      werte,
      index,
      zielU,
      zielH,
      anschluss: ap?.text ?? null,
      von,
    };
  };

  const kandidatStatus = (c: Kandidat, aktion: string) => {
    if (!c.ok) {
      onStatus(`Nicht möglich: ${c.grund ?? ""}`);
      return;
    }
    const eingerastet = [c.anschluss, ...[c.zielU, c.zielH].filter((z): z is Fangziel => z !== null && z.art !== "raster").map((z) => z.text)].filter(
      (t): t is string => t !== null,
    );
    onStatus(
      `Wegpunkt ${c.index + 1} ${aktion}: ${masse.anzeigen(c.u)} von links · ${masse.anzeigen(c.h)} über Boden${eingerastet.length > 0 ? ` · eingerastet: ${[...new Set(eingerastet)].join(", ")}` : ""}`,
    );
  };

  // ------------------------------------------------------------ Endgeräte, Durchführung, Zuordnung

  const geraetGeklickt = (id: string) => {
    if (e === null || p === undefined) return;
    const w = e.werte;
    const erlaubt = p.endpunkte(w.circuitId).some((g) => g.id === id);
    if (!erlaubt) {
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

  const durchfuehrungAufnehmen = (id: string) => {
    if (e === null || p === undefined) return;
    const w = e.werte;
    const index = e.auswahl === null ? w.wegpunkte.length : e.auswahl + 1;
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
    p.dispatch({ typ: "aendern", werte, auswahl: index });
    onStatus(`Durchführung als Wegpunkt ${index + 1} aufgenommen – weiter auf der Gegenseite („Gegenseite“ bzw. Arbeitsfläche wechseln).`);
  };

  /**
   * Neue Durchführung an dieser Stelle (6b.5): nur in einem aktiven, eindeutigen gemeinsamen
   * Abschnitt; gespeichert wird sie erst mit der Leitung. Lage und Höhe auf ganze Zentimeter.
   */
  const durchfuehrungAnlegen = (rohU: number, rohH: number) => {
    if (e === null || p === undefined || bezug === null || p.vorbereitetEntwurf === null) return;
    const stelle = wandpunktAusAnsicht(bezug, Math.round(rohU / 10) * 10, Math.round(rohH / 10) * 10);
    if (stelle.art !== "wand") return;
    const ziel = durchfuehrungsziel(p.vorbereitetEntwurf, bezug.wandId, stelle.abstandMm);
    if (!ziel.ok) {
      onStatus(`Keine Durchführung: ${ziel.grund}`);
      return;
    }
    const w = e.werte;
    const nach = e.auswahl ?? (w.wegpunkte.length === 0 ? null : w.wegpunkte.length - 1);
    const neu = { schluessel: neuerSchluessel(), kopplungId: ziel.kopplungId, abstandMm: ziel.abstandMm, hoeheMm: stelle.hoeheMm };
    const { werte, index } = durchfuehrungEinfuegen(w, neu, nach);
    const geprueft = p.pruefen(werte, index);
    if (geprueft === null) return;
    if (!geprueft.ok) {
      onStatus(`Keine Durchführung: ${geprueft.grund}`);
      return;
    }
    p.dispatch({ typ: "aendern", werte, auswahl: index });
    onStatus(`Neue Durchführung als Wegpunkt ${index + 1} – entsteht erst beim Speichern der Leitung. Weiter auf der Gegenseite.`);
  };

  const zuordnungUmschalten = (id: string) => {
    const z = k?.zuordnung;
    if (z === undefined || z.entwurf === null || p === undefined || !p.darfStromkreise) return;
    const g = p.geraete.find((x) => x.id === id);
    const zuordnung = new Map(p.kreise.flatMap((kr) => kr.device_ids.map((d) => [d, kr] as const)));
    const art = geraetezustand(id, g?.zuordenbar === true, z.entwurf, zuordnung);
    if (art === "nicht-zuordenbar") {
      onStatus("Dieses Gerät lässt sich keinem Stromkreis zuordnen (Datendose oder Lage einer Verteilung).");
      return;
    }
    if (art === "anderer") {
      const anderer = zuordnung.get(id);
      onStatus(`Gehört zu ${anderer === undefined ? "einem anderen Stromkreis" : p.kreisName(anderer)} – wird nicht still umgehängt.`);
      return;
    }
    z.umschalten(id);
    onStatus(art === "dieser" ? "Zuordnung im Entwurf entfernt – noch nicht gespeichert." : "Im Entwurf zugeordnet – noch nicht gespeichert.");
  };

  // ------------------------------------------------------------ Zeiger

  const zusatz: Flaechenzusatz = {
    cursor: (werkzeug === "leitung" || werkzeug === "durchfuehrung") && darf ? "crosshair" : werkzeug === "zuordnen" ? "pointer" : null,
    druecken: (ev) => {
      if (k === undefined || p === undefined || bezug === null) return false;
      const ziel = ev.ziel;
      const punkt = ziel?.closest?.("[data-wegpunkt]")?.getAttribute("data-wegpunkt") ?? null;
      if (punkt !== null && e !== null) {
        const index = Number(punkt);
        p.dispatch({ typ: "auswaehlen", auswahl: index });
        const wp = e.werte.wegpunkte[index];
        if (darf && wp?.art === "wand") {
          p.dispatch({ typ: "ziehen-beginnen" });
          laufend.current = { art: "ziehen", index, gueltig: false };
        }
        onStatus(`Wegpunkt ${index + 1} gewählt – ziehen verschiebt ihn, Entf entfernt ihn, neue Punkte folgen ihm.`);
        return true;
      }
      const geraet = ziel?.closest?.("[data-geraet]")?.getAttribute("data-geraet") ?? null;
      if (werkzeug === "zuordnen" && k.zuordnung.entwurf !== null) {
        if (geraet !== null) zuordnungUmschalten(geraet);
        return true;
      }
      const durchfuehrung = ziel?.closest?.("[data-durchfuehrung]")?.getAttribute("data-durchfuehrung") ?? null;
      if (werkzeug === "durchfuehrung" && darf) {
        if (durchfuehrung !== null) durchfuehrungAufnehmen(durchfuehrung);
        else durchfuehrungAnlegen(ev.welt.x, ev.welt.y);
        return true;
      }
      if (werkzeug === "leitung" && darf) {
        if (geraet !== null) {
          geraetGeklickt(geraet);
          return true;
        }
        if (durchfuehrung !== null) {
          durchfuehrungAufnehmen(durchfuehrung);
          return true;
        }
        const c = kandidatFuer(ev.welt.x, ev.welt.y, ev, null);
        setKandidat(c);
        if (c !== null) kandidatStatus(c, "setzen");
        laufend.current = { art: "setzen" };
        return true;
      }
      if (durchfuehrung !== null) {
        setDurchfuehrungId(durchfuehrung);
        setGewaehlt(null);
        return true;
      }
      const leitung = ziel?.closest?.("[data-leitung]")?.getAttribute("data-leitung") ?? null;
      if (leitung !== null && e === null) {
        setGewaehlt(leitung);
        setDurchfuehrungId(null);
        return true;
      }
      return false;
    },
    bewegen: (ev, aktiv) => {
      const l = laufend.current;
      if (aktiv && l?.art === "ziehen") {
        const c = kandidatFuer(ev.welt.x, ev.welt.y, ev, l.index);
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
        const c = kandidatFuer(ev.welt.x, ev.welt.y, ev, null);
        setKandidat(c);
        if (c !== null) kandidatStatus(c, "setzen");
        return true;
      }
      return false;
    },
    loslassen: () => {
      const l = laufend.current;
      laufend.current = null;
      if (l?.art === "ziehen") {
        setKandidat(null);
        p?.dispatch({ typ: "ziehen-beenden" });
        if (!l.gueltig) onStatus("Keine gültige neue Lage – nichts geändert.");
        else onStatus("Verschoben – noch nicht gespeichert.");
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
        p?.dispatch({ typ: "aendern", werte: c.werte, auswahl: c.index });
        onStatus(`Wegpunkt ${c.index + 1} gesetzt – noch nicht gespeichert.`);
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

  /** Tasten der Leitungsplanung; `true` = verarbeitet. */
  const taste = (event: KeyboardEvent<HTMLDivElement>): boolean => {
    if (p === undefined) return false;
    const strg = event.ctrlKey || event.metaKey;
    const kk = event.key.toLowerCase();
    if (e !== null) {
      if (strg && kk === "s") {
        event.preventDefault();
        void p.speichern();
        return true;
      }
      if (strg && kk === "z" && !event.shiftKey) {
        event.preventDefault();
        p.dispatch({ typ: "rueckgaengig" });
        return true;
      }
      if (strg && (kk === "y" || (kk === "z" && event.shiftKey))) {
        event.preventDefault();
        p.dispatch({ typ: "wiederholen" });
        return true;
      }
      if (strg || event.altKey) return false;
      const index = e.auswahl;
      const wp = index === null ? undefined : e.werte.wegpunkte[index];
      if ((event.key === "Delete" || event.key === "Backspace") && index !== null && wp !== undefined && darf && inAnsichtBearbeitbar(wp)) {
        event.preventDefault();
        p.dispatch({ typ: "aendern", werte: wegpunktEntfernen(e.werte, index), auswahl: index > 0 ? index - 1 : null });
        onStatus(`Wegpunkt ${index + 1} entfernt – noch nicht gespeichert.`);
        return true;
      }
      if (event.key.startsWith("Arrow") && index !== null && wp?.art === "wand" && bezug !== null && wp.wandId === bezug.wandId && darf) {
        event.preventDefault();
        const schritt = event.shiftKey ? 100 : 10;
        const a = wandpunktInAnsicht(bezug, wp.abstandMm, wp.hoeheMm);
        const du = event.key === "ArrowLeft" ? -schritt : event.key === "ArrowRight" ? schritt : 0;
        const dh = event.key === "ArrowUp" ? schritt : event.key === "ArrowDown" ? -schritt : 0;
        const neu = wandpunktAusAnsicht(bezug, a.u + du, a.h + dh);
        const werte = wegpunktErsetzen(e.werte, index, neu);
        const geprueft = p.pruefen(werte, index);
        if (geprueft === null) return true;
        if (!geprueft.ok) {
          onStatus(`Nicht verschoben: ${geprueft.grund}`);
          return true;
        }
        p.dispatch({ typ: "aendern", werte });
        onStatus(`Verschoben: ${masse.anzeigen(a.u + du)} von links · ${masse.anzeigen(a.h + dh)} über Boden`);
        return true;
      }
      if (event.key === "Enter" && werkzeug === "leitung") {
        event.preventDefault();
        setWerkzeug("auswahl");
        setKandidat(null);
        onStatus(e.werte.endId === null ? "Zeichnen beendet – bitte noch das Endgerät wählen." : "Zeichnen beendet – Länge und Befunde prüfen, dann speichern.");
        return true;
      }
      if (kk === "l" && darf) {
        setWerkzeug("leitung");
        return true;
      }
      if (kk === "u" && darf) {
        setWerkzeug("durchfuehrung");
        return true;
      }
    }
    if (k?.zuordnung.entwurf != null && !strg && kk === "z") {
      setWerkzeug("zuordnen");
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------ Zeichnen

  const zeichnen = (b: (x: number, y: number) => Bildpunkt): ReactNode => {
    if (p === undefined || bezug === null) return null;
    const teile: ReactNode[] = [];
    if (werkzeug === "leitung" && darf && modell !== null) {
      for (const z of zonenlinien(bezug.laengeMm, bezug.hoeheMm, modell.oeffnungen)) {
        const a = z.achse === "h" ? b(0, z.wert) : b(z.wert, 0);
        const c = z.achse === "h" ? b(bezug.laengeMm, z.wert) : b(z.wert, bezug.hoeheMm);
        teile.push(
          <g key={`zone-${z.achse}-${z.wert}`} data-testid="leitung-hilfslinie">
            <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} className="leitung-zone" />
            {z.achse === "h" && (
              <text x={c.x - 4} y={c.y - 3} textAnchor="end" className="leitung-zone-text">
                {z.text}
              </text>
            )}
          </g>,
        );
      }
    }
    if (innen) {
      for (const { l, strecken } of andere) {
        const klasse = `leitung leitung--andere leitung--${l.status}${l.id === gewaehlt ? " leitung--gewaehlt" : ""}`;
        strecken.forEach((s, i) => {
          const a = b(s.u1, s.h1);
          const c = b(s.u2, s.h2);
          teile.push(
            <g key={`andere-${l.id}-${i}`} data-leitung={l.id}>
              <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} className={`${klasse}${s.anschluss ? " leitung--anschluss" : ""}`} />
              <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} className="leitung-treffer">
                <title>{`Leitung ${l.label ?? ""} – ${l.status === "confirmed" ? "bestätigt" : l.status === "conflict" ? "Konflikt" : "unvollständig"}`}</title>
              </line>
            </g>,
          );
        });
      }
      if (p.ergebnis !== null && e !== null) {
        wandstrecken(p.ergebnis, bezug).forEach((s, i) => {
          const a = b(s.u1, s.h1);
          const c = b(s.u2, s.h2);
          teile.push(
            <line
              key={`entwurf-${i}`}
              x1={a.x}
              y1={a.y}
              x2={c.x}
              y2={c.y}
              data-testid="leitung-entwurf-strecke"
              className={`leitung leitung--entwurf leitung--${p.ergebnis?.status ?? "incomplete"}${s.anschluss ? " leitung--anschluss" : ""}`}
            />,
          );
        });
      }
    }
    for (const d of durchfuehrungen) {
      const m = b(d.u, d.h);
      teile.push(
        <g key={`d-${d.id}`} data-durchfuehrung={d.id} data-testid={`durchfuehrung-${d.id}`}>
          <circle
            cx={m.x}
            cy={m.y}
            r={7}
            data-neu={d.neu ? "ja" : undefined}
            className={`leitung-durchfuehrung${d.neu ? " leitung-durchfuehrung--neu" : ""}${d.fehler ? " leitung-durchfuehrung--fehler" : ""}${d.id === durchfuehrungId ? " leitung-durchfuehrung--gewaehlt" : ""}`}
          >
            <title>{d.neu ? "Neue Durchführung – entsteht erst beim Speichern der Leitung" : "Durchführung"}</title>
          </circle>
          <line x1={m.x - 4} y1={m.y - 4} x2={m.x + 4} y2={m.y + 4} className="leitung" />
          <line x1={m.x - 4} y1={m.y + 4} x2={m.x + 4} y2={m.y - 4} className="leitung" />
        </g>,
      );
    }
    for (const pt of punkte) {
      const m = b(pt.u, pt.h);
      const gewaehltIst = e?.auswahl === pt.index;
      teile.push(
        <g key={`wp-${pt.index}`} data-wegpunkt={pt.index} data-testid={`wegpunkt-${pt.index}`}>
          <circle cx={m.x} cy={m.y} r={8} className={`leitung-punkt${gewaehltIst ? " leitung-punkt--gewaehlt" : ""}${pt.fest ? " leitung-punkt--fest" : ""}`}>
            <title>{`Wegpunkt ${pt.index + 1}${pt.fest ? " (Durchführung)" : darf ? " – ziehen zum Verschieben" : ""}`}</title>
          </circle>
          <text x={m.x} y={m.y + 3.5} textAnchor="middle" className={`leitung-punkt-text${gewaehltIst ? " leitung-punkt-text--gewaehlt" : ""}`}>
            {pt.index + 1}
          </text>
        </g>,
      );
    }
    if (kandidat !== null) {
      const m = b(kandidat.u, kandidat.h);
      if (kandidat.von !== null) {
        const a = b(kandidat.von.u, kandidat.von.h);
        teile.push(<line key="kandidat-strecke" x1={a.x} y1={a.y} x2={m.x} y2={m.y} className={`leitung-kandidat-strecke${kandidat.ok ? "" : " leitung-kandidat-strecke--fehler"}`} />);
      }
      for (const z of [kandidat.zielU, kandidat.zielH]) {
        if (z === null || z.art === "raster") continue;
        const senkrecht = z === kandidat.zielU;
        const a = senkrecht ? b(z.wert, 0) : b(0, z.wert);
        const c = senkrecht ? b(z.wert, bezug.hoeheMm) : b(bezug.laengeMm, z.wert);
        teile.push(<line key={`kfang-${z.id}`} x1={a.x} y1={a.y} x2={c.x} y2={c.y} className="ansicht__fang" data-testid="leitung-fangziel" />);
      }
      teile.push(
        <circle
          key="kandidat"
          cx={m.x}
          cy={m.y}
          r={6}
          data-testid="leitung-kandidat"
          data-gueltig={kandidat.ok ? "ja" : "nein"}
          className={`leitung-kandidat${kandidat.ok ? "" : " leitung-kandidat--fehler"}`}
        />,
      );
    }
    if (werkzeug === "zuordnen" && k?.zuordnung.entwurf != null) {
      const zuordnung = new Map(p.kreise.flatMap((kr) => kr.device_ids.map((d) => [d, kr] as const)));
      for (const g of geraete) {
        const art = geraetezustand(g.id, p.geraete.find((x) => x.id === g.id)?.zuordenbar === true, k.zuordnung.entwurf, zuordnung);
        const m = b(g.u, g.h);
        teile.push(<circle key={`zu-${g.id}`} cx={m.x} cy={m.y} r={17} className={`zuordnung-ring zuordnung-ring--${art}`} data-testid={`zuordnung-${g.id}`} data-zustand={art} />);
      }
    }
    return <g data-testid="leitungsebene">{teile}</g>;
  };

  const gewaehlteDurchfuehrung = durchfuehrungId === null || istNeu(durchfuehrungId) ? null : (p?.durchfuehrungen.find((d) => d.id === durchfuehrungId) ?? null);
  return { zusatz, taste, relevant, gewaehlt, setGewaehlt, gewaehlteDurchfuehrung, setDurchfuehrungId, setKandidat };
}
