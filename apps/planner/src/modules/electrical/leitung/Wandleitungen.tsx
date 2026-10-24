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
import { durchfuehrungDaneben, durchfuehrungEinfuegen, wegpunktEinfuegen, wegpunktEntfernen, wegpunktErsetzen, wegpunkteEinfuegenAn } from "./entwurf";
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
import { DOPPELKLICK_MS, andereEcke, geraetImRing, istKlick, lEcke, wiederholtLetzten } from "./zeichnen";
import type { Flaechenzusatz, Zeigerereignis } from "./zusatz";

/** Markierungsring eines Geräts in Schritt 1 - zugleich der Fangradius für Geräteklicks (Bildpunkte). */
const START_RING_PX = 17;

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
  /** Ecke der L-Führung (Phase 6c, L2) - wird mit dem Punkt als **ein** Schritt gesetzt. */
  readonly ecke?: { u: number; h: number } | null;
  /** Zusatz zur Vorschau, etwa „Fang ausgesetzt …“ oder „Andere Ecke wäre gültig …“. */
  readonly hinweis?: string | null;
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
 * Leitungsplanung in der Wandansicht (Phase 6b.4, Zeichenablauf seit 6c L2, Entwurf §18.3/§18.4).
 *
 * „Leitung hinzufügen“: 1 Klick auf ein Gerät = Startgerät; 2 jeder Klick auf die Wand setzt genau die
 * angezeigte Vorschau ans Ende – liegt sie nicht auf einer Achse des letzten Punkts, mit sichtbarer
 * L-Ecke (erst waagerecht, „Ecke wechseln“ K) als **ein** Schritt; 3 Klick auf ein anderes Gerät =
 * Ziel, der Abschlussdialog öffnet. Doppelklick oder Enter schließen offen ab. Ein Klick ist Drücken und
 * Loslassen ohne Bewegung. Ein Klick auf einen Punkt wählt ihn nur; Ziehen verschiebt ihn (ein Schritt),
 * Pfeiltasten 1 cm (Umschalt 10 cm), Entf entfernt ihn. Escape bricht stufenweise ab und beendet zuletzt
 * das Werkzeug – nie den Entwurf.
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
  const laufend = useRef<
    { art: "setzen"; start: { x: number; y: number }; massstab: number; bewegt: boolean } | { art: "ziehen"; index: number; gueltig: boolean } | null
  >(null);
  /** Zuletzt gesetzter Punkt - der zweite Klick eines Doppelklicks setzt dort nichts. */
  const zuletzt = useRef<{ zeit: number; schluessel: string } | null>(null);
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
  // Der Zeichenablauf gehört zum Gebäude (6c, L2); Durchführung und Zuordnen sind eigene Werkzeuge.
  const zeichnet = p?.ablauf != null && !p.dialogOffen && werkzeug !== "durchfuehrung" && werkzeug !== "zuordnen" && werkzeug !== "pan";
  const schritt = p?.ablauf?.schritt ?? null;

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
      if ((l.start_device_id !== null && hier.has(l.start_device_id)) || (l.end_device_id !== null && hier.has(l.end_device_id))) ids.add(l.id);
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

  /**
   * Neuer Punkt im Zeichenablauf (6c, L2): immer ans Ende - außer ausdrücklich „danach einfügen“.
   * Liegt das Ziel nicht auf einer Achse des letzten Punkts dieser Wand, entsteht eine sichtbare
   * L-Ecke nach der gewählten Eckenrichtung; beide Teilstrecken werden geprüft. Ein Fangziel, das zu
   * einer ungültigen Lage führt, wird ausgesetzt - mit Hinweis, nie still.
   */
  const neuerKandidat = (rohU: number, rohH: number, ereignis: Pick<Zeigerereignis, "altKey" | "massstab">): Kandidat | null => {
    if (e === null || p === undefined || p.vorbereitetEntwurf === null || bezug === null || modell === null) return null;
    const w = e.werte;
    const nach = p.ablauf?.einfuegenNach ?? null;
    const index = nach === null || nach >= w.wegpunkte.length ? w.wegpunkte.length : nach + 1;
    const vor = w.wegpunkte[index - 1];
    const von = aufDieserWand(vor);
    const f = fang(ereignis.massstab, ereignis.altKey);
    const eckenwahl = p.ablauf?.ecke ?? "waagerecht";
    const ziele = wandFangziele({
      laengeMm: bezug.laengeMm,
      hoeheMm: bezug.hoeheMm,
      geraete: geraete.map((g) => ({ id: g.id, name: p.geraetName(g.id).replace(/ \(.*\)$/, ""), u: g.u, h: g.h })),
      durchfuehrungen,
      oeffnungen: modell.oeffnungen.map((o, i) => ({ id: o.id, name: `Öffnung ${i + 1}`, links: o.links, rechts: o.rechts, unten: o.unten, oben: o.oben })),
      trassen: wandtrassen(andere.flatMap((x) => x.strecken)),
      zonen: zonenlinien(bezug.laengeMm, bezug.hoeheMm, modell.oeffnungen),
    });
    const versuchen = (u: number, h: number, ecke: typeof eckenwahl) => {
      const knick = von === null ? null : lEcke({ a: von.u, b: von.h }, { a: u, b: h }, ecke);
      const neue: Wegpunkt[] = [...(knick === null ? [] : [wandpunktAusAnsicht(bezug, knick.a, knick.b)]), wandpunktAusAnsicht(bezug, u, h)];
      const werte = wegpunkteEinfuegenAn(w, index, neue);
      const geprueft = p.pruefen(werte, neue.map((_, i) => index + i)) ?? { ok: false as const, grund: "Der Plan ist noch nicht geladen." };
      return { werte, geprueft, ecke: knick === null ? null : { u: knick.a, h: knick.b } };
    };
    const ap = anschlussFangen({ a: rohU, b: rohH }, anschluesse([vor]), f);
    let u: number;
    let h: number;
    let zielU: Fangziel | null = null;
    let zielH: Fangziel | null = null;
    if (ap !== null) {
      u = ap.a;
      h = ap.b;
    } else {
      const fu = achseFangen(rohU, ziele.u, f, vorher.current.u);
      const fh = achseFangen(rohH, ziele.h, f, vorher.current.h);
      u = fu.wert;
      h = fh.wert;
      zielU = fu.ziel;
      zielH = fh.ziel;
    }
    let versuch = versuchen(u, h, eckenwahl);
    let hinweis: string | null = null;
    const echteZiele = [zielU, zielH].filter((z): z is Fangziel => z !== null && z.art !== "raster");
    if (!versuch.geprueft.ok && ap === null && echteZiele.length > 0) {
      const frei = versuchen(Math.round(rohU), Math.round(rohH), eckenwahl);
      if (frei.geprueft.ok) {
        hinweis = `Fang ausgesetzt: ${echteZiele.map((z) => z.text).join(", ")} wäre ungültig`;
        u = Math.round(rohU);
        h = Math.round(rohH);
        versuch = frei;
        zielU = null;
        zielH = null;
      }
    }
    if (!versuch.geprueft.ok && versuch.ecke !== null && versuchen(u, h, andereEcke(eckenwahl)).geprueft.ok) {
      hinweis = "Andere Ecke wäre gültig: Ecke wechseln (K)";
    }
    vorher.current = { u: zielU?.id ?? null, h: zielH?.id ?? null };
    return {
      u,
      h,
      ok: versuch.geprueft.ok,
      grund: versuch.geprueft.ok ? null : versuch.geprueft.grund,
      werte: versuch.werte,
      index,
      zielU,
      zielH,
      anschluss: ap?.text ?? null,
      von,
      ecke: versuch.ecke,
      hinweis,
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
      `${aktion === "setzen" ? "Nächster Klick: " : ""}${c.ecke != null ? "Ecke und " : ""}Wegpunkt ${c.index + 1 + (c.ecke != null ? 1 : 0)} ${aktion}: ${masse.anzeigen(c.u)} von links · ${masse.anzeigen(c.h)} über Boden${eingerastet.length > 0 ? ` · eingerastet: ${[...new Set(eingerastet)].join(", ")}` : ""}${c.hinweis != null ? ` · ${c.hinweis}` : ""}`,
    );
  };

  // ------------------------------------------------------------ Endgeräte, Durchführung, Zuordnung

  const geraetGeklickt = (id: string) => {
    if (p === undefined) return;
    setKandidat(null);
    onStatus(p.geraetGewaehlt(id));
  };

  /** Was ein Klick auf dieses Gerät bewirken würde - vor dem Klick sichtbar (Entwurf §18.4). */
  const geraetVorschau = (id: string) => {
    if (p === undefined || e === null) return;
    const g = p.geraetPruefen(id);
    if (!g.ok) onStatus(`Nicht möglich: ${g.grund}`);
    else if (e.werte.startId === null) onStatus(`Nächster Klick: Startgerät ${p.geraetName(id)}`);
    else if (id === e.werte.startId) onStatus("Das ist das Startgerät – ein anderes Gerät beendet die Leitung.");
    else onStatus(`Nächster Klick: beendet am Zielgerät ${p.geraetName(id)}`);
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

  /** Einen geprüften Kandidaten übernehmen - genau die angezeigte Geometrie, ein Rückgängig-Schritt. */
  const uebernehmen = (c: Kandidat) => {
    if (p === undefined || e === null) return;
    if (!c.ok) {
      onStatus(`Nicht gesetzt: ${c.grund ?? ""}`);
      return;
    }
    const neu = c.werte.wegpunkte[c.index + (c.ecke != null ? 1 : 0)];
    const davor = c.werte.wegpunkte.slice(0, c.index);
    const jetzt = Date.now();
    const z = zuletzt.current;
    // Der zweite Klick eines Doppelklicks oder ein Klick auf den letzten Punkt setzt nichts doppelt.
    const schluessel = JSON.stringify(neu);
    if (neu === undefined || wiederholtLetzten(davor, neu) || (z !== null && jetzt - z.zeit < DOPPELKLICK_MS && z.schluessel === schluessel)) return;
    p.dispatch({ typ: "aendern", werte: c.werte, auswahl: null });
    if (p.ablauf?.einfuegenNach != null) p.setAblauf({ einfuegenNach: null });
    zuletzt.current = { zeit: jetzt, schluessel };
    onStatus(`${c.ecke != null ? "Ecke und " : ""}Wegpunkt ${c.index + 1 + (c.ecke != null ? 1 : 0)} gesetzt – noch nicht gespeichert. Weiter zeichnen, Zielgerät anklicken oder doppelklicken.`);
  };

  // Gerät unter dem Zeiger - auch wenn eine bestehende Leitung darüber liegt (Ring wie in Schritt 1).
  const geraetBei = (ev: Zeigerereignis): string | null => {
    const getroffen = ev.ziel?.closest?.("[data-geraet]")?.getAttribute("data-geraet") ?? null;
    if (getroffen !== null) return getroffen;
    // Ersatz über den Ring nur in Schritt 1 (dort reagieren nur Geräte) oder wenn eine bestehende Leitung
    // über dem Gerät liegt - sonst bleibt ein Klick neben einem Gerät ein Wegpunkt.
    if (schritt !== "start" && ev.ziel?.closest?.(".leitung-treffer") == null) return null;
    return geraetImRing(ev.welt, ev.massstab, geraete.map((g) => ({ id: g.id, x: g.u, y: g.h })), START_RING_PX);
  };

  const zusatz: Flaechenzusatz = {
    cursor: zeichnet && darf ? "crosshair" : werkzeug === "durchfuehrung" && darf ? "crosshair" : werkzeug === "zuordnen" ? "pointer" : null,
    druecken: (ev) => {
      if (k === undefined || p === undefined || bezug === null) return false;
      const ziel = ev.ziel;
      const geraet = geraetBei(ev);
      // Schritt 1: nur Geräte reagieren.
      if (zeichnet && darf && schritt === "start") {
        if (geraet !== null) geraetGeklickt(geraet);
        else onStatus("Zuerst ein Startgerät anklicken – markierte Geräte sind möglich.");
        return true;
      }
      const punkt = ziel?.closest?.("[data-wegpunkt]")?.getAttribute("data-wegpunkt") ?? null;
      if (punkt !== null && e !== null) {
        const index = Number(punkt);
        p.dispatch({ typ: "auswaehlen", auswahl: index });
        const wp = e.werte.wegpunkte[index];
        if (darf && wp?.art === "wand") {
          p.dispatch({ typ: "ziehen-beginnen" });
          laufend.current = { art: "ziehen", index, gueltig: false };
        }
        setKandidat(null);
        onStatus(`Wegpunkt ${index + 1} gewählt – ziehen verschiebt ihn, Entf entfernt ihn. Neue Punkte kommen weiter ans Ende.`);
        return true;
      }
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
      if (zeichnet && darf) {
        if (geraet !== null) {
          geraetGeklickt(geraet);
          return true;
        }
        if (durchfuehrung !== null) {
          durchfuehrungAufnehmen(durchfuehrung);
          return true;
        }
        // Ohne vorherige Bewegung (Tastatur, Berührung) die Vorschau an dieser Stelle bestimmen.
        if (kandidatRef.current === null) setKandidat(neuerKandidat(ev.welt.x, ev.welt.y, ev));
        laufend.current = { art: "setzen", start: ev.welt, massstab: ev.massstab, bewegt: false };
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
      if (aktiv && l?.art === "setzen") {
        // Gesetzt wird, was angezeigt war - eine Bewegung beim Drücken macht daraus keinen Klick.
        if (!istKlick(l.start, ev.welt, l.massstab)) l.bewegt = true;
        return true;
      }
      if (!aktiv && zeichnet && darf) {
        const geraet = geraetBei(ev);
        if (geraet !== null) {
          setKandidat(null);
          geraetVorschau(geraet);
          return true;
        }
        if (schritt === "start") {
          setKandidat(null);
          onStatus("1 Startgerät wählen – auf ein markiertes Gerät klicken.");
          return true;
        }
        const c = neuerKandidat(ev.welt.x, ev.welt.y, ev);
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
        if (l.bewegt) {
          onStatus("Nicht gesetzt – zum Setzen ohne Bewegung klicken.");
          return;
        }
        setKandidat(null);
        if (c !== null) uebernehmen(c);
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
    doppelklick: () => {
      if (!zeichnet || p === undefined) return false;
      setKandidat(null);
      const text = p.abschliessen();
      if (text !== null) onStatus(text);
      return true;
    },
    zeichnen: (b) => zeichnen(b),
  };

  // ------------------------------------------------------------ Tastatur

  /**
   * Escape im Zeichenablauf (Entwurf §18.4): Ziehen → Vorschau → Punktauswahl → „danach einfügen“ →
   * Werkzeug beenden. Verwirft nie den Entwurf. `true` = verarbeitet.
   */
  const escape = (): boolean => {
    if (zusatz.abbrechen()) return true;
    if (kandidat !== null) {
      setKandidat(null);
      return true;
    }
    if (e !== null && e.auswahl !== null) {
      p?.dispatch({ typ: "auswaehlen", auswahl: null });
      return true;
    }
    if (p?.ablauf != null && p.ablauf.einfuegenNach !== null) {
      p.setAblauf({ einfuegenNach: null });
      return true;
    }
    if (p?.ablauf != null) {
      p.ablaufBeenden();
      onStatus("Werkzeug beendet – der Entwurf bleibt erhalten.");
      return true;
    }
    return false;
  };

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
      if (event.key === "Enter" && zeichnet) {
        event.preventDefault();
        setKandidat(null);
        const text = p.abschliessen();
        if (text !== null) onStatus(text);
        return true;
      }
      if (kk === "k" && zeichnet) {
        p.setAblauf({ ecke: p.ablauf?.ecke === "senkrecht" ? "waagerecht" : "senkrecht" });
        setKandidat(null);
        onStatus(`Ecke: zuerst ${p.ablauf?.ecke === "senkrecht" ? "waagerecht" : "senkrecht"} – gilt bis zum nächsten Punkt.`);
        return true;
      }
      if (kk === "u" && darf) {
        setWerkzeug("durchfuehrung");
        return true;
      }
    }
    if (kk === "l" && !strg && !event.altKey && k !== undefined && p.darfLeitungen && innen) {
      const grund = k.leitungZeichnen();
      if (grund !== null) onStatus(grund);
      return true;
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
    if (zeichnet && darf && modell !== null) {
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
    // Schritt 1: Geräte, die Start sein können, sind markiert; andere gedimmt (Grund beim Zeigen).
    if (zeichnet && schritt === "start" && p.ablauf !== null) {
      for (const g of geraete) {
        const m = b(g.u, g.h);
        const ok = p.geraetPruefen(g.id).ok;
        teile.push(<circle key={`start-${g.id}`} cx={m.x} cy={m.y} r={START_RING_PX} className={`leitung-start-ring${ok ? "" : " leitung-start-ring--nein"}`} data-testid={`startgeraet-${g.id}`} data-moeglich={ok ? "ja" : "nein"} />);
      }
    }
    if (kandidat !== null) {
      const m = b(kandidat.u, kandidat.h);
      const klasse = `leitung-kandidat-strecke${kandidat.ok ? "" : " leitung-kandidat-strecke--fehler"}`;
      if (kandidat.von !== null && kandidat.ecke != null) {
        const a = b(kandidat.von.u, kandidat.von.h);
        const c = b(kandidat.ecke.u, kandidat.ecke.h);
        teile.push(<line key="kandidat-strecke-1" x1={a.x} y1={a.y} x2={c.x} y2={c.y} className={klasse} data-testid="leitung-kandidat-strecke" />);
        teile.push(<line key="kandidat-strecke-2" x1={c.x} y1={c.y} x2={m.x} y2={m.y} className={klasse} data-testid="leitung-kandidat-strecke" />);
        teile.push(<circle key="kandidat-ecke" cx={c.x} cy={c.y} r={4} className={`leitung-kandidat${kandidat.ok ? "" : " leitung-kandidat--fehler"}`} data-testid="leitung-kandidat-ecke" />);
      } else if (kandidat.von !== null) {
        const a = b(kandidat.von.u, kandidat.von.h);
        teile.push(<line key="kandidat-strecke" x1={a.x} y1={a.y} x2={m.x} y2={m.y} className={klasse} data-testid="leitung-kandidat-strecke" />);
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
      // Grund bzw. Wirkung am Zeiger - vor dem Klick (Entwurf §18.4).
      const text = kandidat.ok ? kandidat.hinweis : kandidat.grund;
      if (text != null) {
        teile.push(
          <text key="kandidat-text" x={m.x + 10} y={m.y - 10} className={`leitung-kandidat-text${kandidat.ok ? "" : " leitung-kandidat-text--fehler"}`} data-testid="leitung-kandidat-text">
            {text}
          </text>,
        );
      }
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
  return { zusatz, taste, escape, relevant, gewaehlt, setGewaehlt, gewaehlteDurchfuehrung, setDurchfuehrungId, setKandidat };
}
