import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useMasse } from "../../../core/ui/masseinheit";
import { ganzzahligeWurzel } from "../editor/geometrie";
import type { Punkt } from "../editor/geometrie";
import type { Bildpunkt } from "../editor/viewport";
import type { AnsichtsDeckengeraet } from "../deckenansicht/deckengeraete";
import type { Deckenwand } from "../deckenansicht/deckenmodell";
import { geraetezustand } from "../stromkreise/zuordnung";
import type { Fangziel } from "../wandansicht/wandfang";
import "./leitung.css";
import { inAnsichtBearbeitbar } from "./daten";
import type { Leitungswerte } from "./entwurf";
import { wegpunktEinfuegen, wegpunktEntfernen, wegpunktErsetzen, wegpunkteEinfuegenAn } from "./entwurf";
import type { Anschlusspunkt, Fangeinstellung } from "./flaechen";
import { achseFangen, anschlussFangen, deckenstrecken } from "./flaechen";
import type { Leitungskontext } from "./kontext";
import type { Wegpunkt } from "./laenge";
import type { Leitungswerkzeug } from "./Wandleitungen";
import { DOPPELKLICK_MS, andereEcke, geraetImRing, istKlick, lEcke, wiederholtLetzten } from "./zeichnen";
import type { Flaechenzusatz, Zeigerereignis } from "./zusatz";

/** Markierungsring eines Geräts in Schritt 1 - zugleich der Fangradius für Geräteklicks (Bildpunkte). */
const START_RING_PX = 17;

interface Kandidat {
  readonly x: number;
  readonly y: number;
  readonly ok: boolean;
  readonly grund: string | null;
  readonly werte: Leitungswerte;
  readonly index: number;
  readonly zielX: Fangziel | null;
  readonly zielY: Fangziel | null;
  readonly anschluss: string | null;
  readonly von: Punkt | null;
  /** Ecke der rechtwinkligen Führung (6c, L2, F6) - ein Schritt mit dem Punkt. */
  readonly ecke?: Punkt | null;
  readonly hinweis?: string | null;
}

/** Punkt auf der Wandachse im Abstand `abstand` - nur, wenn er auf ganzen Millimetern liegt. */
function achspunkt(w: Pick<Deckenwand, "start" | "ende">, abstand: number): Punkt | null {
  const dx = w.ende.x - w.start.x;
  const dy = w.ende.y - w.start.y;
  const q = dx * dx + dy * dy;
  const l = ganzzahligeWurzel(q);
  if (l * l !== q || l === 0 || abstand < 0 || abstand > l) return null;
  if ((dx * abstand) % l !== 0 || (dy * abstand) % l !== 0) return null;
  return { x: w.start.x + (dx * abstand) / l, y: w.start.y + (dy * abstand) / l };
}

/**
 * Leitungsplanung in der Deckenansicht (Phase 6b.4, Zeichenablauf seit 6c L2) - dieselben Gesten wie an
 * der Wand. Standard ist die rechtwinklige Führung mit sichtbarer Ecke (F6); „Gerade“ (W) setzt
 * einzelne gerade Strecken. Jede Teilstrecke liegt vollständig in der echten Raumkontur (auch im
 * L-Raum); geprüft wird mit der gemeinsamen Längenfunktion.
 */
export function useDeckenleitungen({
  k,
  raumId,
  waende,
  geraete,
  werkzeug,
  setWerkzeug,
  fangAktiv,
  rasterMm,
  onStatus,
}: {
  k: Leitungskontext | undefined;
  raumId: string | undefined;
  waende: readonly Deckenwand[];
  geraete: readonly AnsichtsDeckengeraet[];
  werkzeug: string;
  setWerkzeug: (w: "auswahl" | Exclude<Leitungswerkzeug, "durchfuehrung">) => void;
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
  const laufend = useRef<
    { art: "setzen"; start: { x: number; y: number }; massstab: number; bewegt: boolean } | { art: "ziehen"; index: number; gueltig: boolean } | null
  >(null);
  const zuletzt = useRef<{ zeit: number; schluessel: string } | null>(null);
  const vorher = useRef<{ x: string | null; y: string | null }>({ x: null, y: null });
  const [werkzeugVorher, setWerkzeugVorher] = useState(werkzeug);
  if (werkzeugVorher !== werkzeug) {
    setWerkzeugVorher(werkzeug);
    setKandidatState(null);
  }

  const p = k?.planung;
  const e = p?.entwurf ?? null;
  const darf = p !== undefined && p.darfLeitungen && e !== null && e.status !== "speichert" && raumId !== undefined;
  const zeichnet = p?.ablauf != null && !p.dialogOffen && werkzeug !== "zuordnen" && werkzeug !== "pan";
  const schritt = p?.ablauf?.schritt ?? null;
  const raum = raumId === undefined ? undefined : p?.vorbereitet?.raeume.get(raumId);

  const andere = useMemo(() => {
    if (p === undefined || raumId === undefined) return [];
    return p.leitungen
      .filter((l) => l.id !== e?.cableId)
      .map((l) => {
        const r = p.ergebnisse.get(l.id);
        return { l, strecken: r === undefined ? [] : deckenstrecken(r, raumId) };
      })
      .filter((x) => x.strecken.length > 0);
  }, [p, raumId, e?.cableId]);

  const relevant = useMemo(() => {
    const ids = new Set(andere.map((x) => x.l.id));
    const hier = new Set(geraete.map((g) => g.id));
    for (const l of p?.leitungen ?? []) {
      if ((l.start_device_id !== null && hier.has(l.start_device_id)) || (l.end_device_id !== null && hier.has(l.end_device_id))) ids.add(l.id);
    }
    if (e?.cableId != null) ids.add(e.cableId);
    return ids;
  }, [andere, geraete, p?.leitungen, e?.cableId]);

  const punkte = useMemo(() => {
    if (e === null || raumId === undefined) return [];
    return e.werte.wegpunkte.flatMap((wp, index) => (wp.art === "ceiling" && wp.raumId === raumId ? [{ index, x: wp.x, y: wp.y }] : []));
  }, [e, raumId]);

  const fang = (massstab: number, altKey: boolean): Fangeinstellung => ({ aktiv: fangAktiv, ausgesetzt: altKey, massstab, rasterMm });

  const anschluesse = (nachbarn: readonly (Wegpunkt | undefined)[]): Anschlusspunkt[] => {
    if (raum === undefined || k === undefined) return [];
    const ergebnis: Anschlusspunkt[] = [];
    for (const n of nachbarn) {
      if (n?.art !== "wand" || n.hoeheMm !== raum.hoeheMm) continue;
      const w = waende.find((x) => x.id === n.wandId);
      if (w === undefined) continue;
      const pt = achspunkt(w, n.abstandMm);
      if (pt !== null) ergebnis.push({ a: pt.x, b: pt.y, text: `Übergang von ${k.wandName(n.wandId)}` });
    }
    return ergebnis;
  };

  const ziele = (nachbarn: readonly Punkt[]): { x: Fangziel[]; y: Fangziel[] } => {
    const x: Fangziel[] = [];
    const y: Fangziel[] = [];
    for (const w of waende) {
      x.push({ id: `ecke:${w.id}:x`, art: "wandkante", wert: w.start.x, text: `Raumecke W${w.nummer}` });
      y.push({ id: `ecke:${w.id}:y`, art: "wandkante", wert: w.start.y, text: `Raumecke W${w.nummer}` });
    }
    for (const g of geraete) {
      x.push({ id: `geraet:${g.id}:x`, art: "oeffnungsmitte", wert: g.x, text: `Flucht ${g.typ?.label ?? "Gerät"}` });
      y.push({ id: `geraet:${g.id}:y`, art: "oeffnungsmitte", wert: g.y, text: `Flucht ${g.typ?.label ?? "Gerät"}` });
    }
    nachbarn.forEach((n, i) => {
      x.push({ id: `nachbar:${i}:x`, art: "hoehe", wert: n.x, text: "Flucht des Nachbarpunkts" });
      y.push({ id: `nachbar:${i}:y`, art: "hoehe", wert: n.y, text: "Flucht des Nachbarpunkts" });
    });
    andere.forEach(({ strecken }, i) =>
      strecken.forEach((s, j) => {
        for (const [t, pt] of [["a", s.a], ["b", s.b]] as const) {
          x.push({ id: `trasse:${i}:${j}:${t}:x`, art: "hoehe", wert: pt.x, text: "vorhandene Trasse" });
          y.push({ id: `trasse:${i}:${j}:${t}:y`, art: "hoehe", wert: pt.y, text: "vorhandene Trasse" });
        }
      }),
    );
    return { x, y };
  };

  const kandidatFuer = (rohX: number, rohY: number, ev: { altKey: boolean; massstab: number }, ersetzen: number | null): Kandidat | null => {
    if (e === null || p === undefined || p.vorbereitetEntwurf === null || raumId === undefined) return null;
    const w = e.werte;
    const index = ersetzen ?? (e.auswahl === null ? w.wegpunkte.length : e.auswahl + 1);
    const vor = w.wegpunkte[index - 1];
    const nach = ersetzen === null ? w.wegpunkte[index] : w.wegpunkte[index + 1];
    const f = fang(ev.massstab, ev.altKey);
    const flucht = [vor, nach].flatMap((n) => (n?.art === "ceiling" && n.raumId === raumId ? [{ x: n.x, y: n.y }] : []));
    const versuchen = (x: number, y: number) => {
      const wp: Wegpunkt = { art: "ceiling", raumId, x: x + 0, y: y + 0 };
      const werte = ersetzen === null ? wegpunktEinfuegen(w, wp, index - 1 < 0 ? null : index - 1).werte : wegpunktErsetzen(w, ersetzen, wp);
      return { werte, geprueft: p.pruefen(werte, index) ?? { ok: false as const, grund: "Der Plan ist noch nicht geladen." } };
    };
    const ap = anschlussFangen({ a: rohX, b: rohY }, anschluesse([vor, nach]), f);
    let x: number;
    let y: number;
    let zielX: Fangziel | null = null;
    let zielY: Fangziel | null = null;
    if (ap !== null) {
      x = ap.a;
      y = ap.b;
    } else {
      const z = ziele(flucht);
      const fx = achseFangen(rohX, z.x, f, vorher.current.x);
      const fy = achseFangen(rohY, z.y, f, vorher.current.y);
      x = fx.wert;
      y = fy.wert;
      zielX = fx.ziel;
      zielY = fy.ziel;
    }
    let { werte, geprueft } = versuchen(x, y);
    if (!geprueft.ok && ap === null) {
      const frei = versuchen(Math.round(rohX), Math.round(rohY));
      if (frei.geprueft.ok) {
        x = Math.round(rohX);
        y = Math.round(rohY);
        ({ werte, geprueft } = frei);
        zielX = null;
        zielY = null;
      }
    }
    vorher.current = { x: zielX?.id ?? null, y: zielY?.id ?? null };
    const von = vor?.art === "ceiling" && vor.raumId === raumId ? { x: vor.x, y: vor.y } : null;
    return { x, y, ok: geprueft.ok, grund: geprueft.ok ? null : geprueft.grund, werte, index, zielX, zielY, anschluss: ap?.text ?? null, von };
  };

  /** Neuer Deckenpunkt im Zeichenablauf: ans Ende, rechtwinklig mit sichtbarer Ecke oder gerade (F6). */
  const neuerKandidat = (rohX: number, rohY: number, ev: { altKey: boolean; massstab: number }): Kandidat | null => {
    if (e === null || p === undefined || p.vorbereitetEntwurf === null || raumId === undefined) return null;
    const w = e.werte;
    const nach = p.ablauf?.einfuegenNach ?? null;
    const index = nach === null || nach >= w.wegpunkte.length ? w.wegpunkte.length : nach + 1;
    const vor = w.wegpunkte[index - 1];
    const f = fang(ev.massstab, ev.altKey);
    const von = vor?.art === "ceiling" && vor.raumId === raumId ? { x: vor.x, y: vor.y } : null;
    const rechtwinklig = (p.ablauf?.fuehrung ?? "rechtwinklig") === "rechtwinklig";
    const eckenwahl = p.ablauf?.ecke ?? "waagerecht";
    const versuchen = (x: number, y: number, ecke: typeof eckenwahl) => {
      const knick = rechtwinklig && von !== null ? lEcke({ a: von.x, b: von.y }, { a: x, b: y }, ecke) : null;
      const neue: Wegpunkt[] = [...(knick === null ? [] : [{ art: "ceiling" as const, raumId, x: knick.a, y: knick.b }]), { art: "ceiling", raumId, x: x + 0, y: y + 0 }];
      const werte = wegpunkteEinfuegenAn(w, index, neue);
      const geprueft = p.pruefen(werte, neue.map((_, i) => index + i)) ?? { ok: false as const, grund: "Der Plan ist noch nicht geladen." };
      return { werte, geprueft, ecke: knick === null ? null : { x: knick.a, y: knick.b } };
    };
    const ap = anschlussFangen({ a: rohX, b: rohY }, anschluesse([vor]), f);
    let x: number;
    let y: number;
    let zielX: Fangziel | null = null;
    let zielY: Fangziel | null = null;
    if (ap !== null) {
      x = ap.a;
      y = ap.b;
    } else {
      const z = ziele(von === null ? [] : [von]);
      const fx = achseFangen(rohX, z.x, f, vorher.current.x);
      const fy = achseFangen(rohY, z.y, f, vorher.current.y);
      x = fx.wert;
      y = fy.wert;
      zielX = fx.ziel;
      zielY = fy.ziel;
    }
    let versuch = versuchen(x, y, eckenwahl);
    let hinweis: string | null = null;
    const echteZiele = [zielX, zielY].filter((z): z is Fangziel => z !== null && z.art !== "raster");
    if (!versuch.geprueft.ok && ap === null && echteZiele.length > 0) {
      const frei = versuchen(Math.round(rohX), Math.round(rohY), eckenwahl);
      if (frei.geprueft.ok) {
        hinweis = `Fang ausgesetzt: ${echteZiele.map((z) => z.text).join(", ")} wäre ungültig`;
        x = Math.round(rohX);
        y = Math.round(rohY);
        versuch = frei;
        zielX = null;
        zielY = null;
      }
    }
    if (!versuch.geprueft.ok && versuch.ecke !== null && versuchen(x, y, andereEcke(eckenwahl)).geprueft.ok) {
      hinweis = "Andere Ecke wäre gültig: Ecke wechseln (K)";
    }
    vorher.current = { x: zielX?.id ?? null, y: zielY?.id ?? null };
    return {
      x,
      y,
      ok: versuch.geprueft.ok,
      grund: versuch.geprueft.ok ? null : versuch.geprueft.grund,
      werte: versuch.werte,
      index,
      zielX,
      zielY,
      anschluss: ap?.text ?? null,
      von,
      ecke: versuch.ecke,
      hinweis,
    };
  };


  const status = (c: Kandidat, aktion: string) => {
    if (!c.ok) {
      onStatus(`Nicht möglich: ${c.grund ?? ""}`);
      return;
    }
    const eingerastet = [c.anschluss, ...[c.zielX, c.zielY].filter((z): z is Fangziel => z !== null && z.art !== "raster").map((z) => z.text)].filter(
      (t): t is string => t !== null,
    );
    onStatus(
      `${aktion === "setzen" ? "Nächster Klick: " : ""}${c.ecke != null ? "Ecke und " : ""}Wegpunkt ${c.index + 1 + (c.ecke != null ? 1 : 0)} ${aktion}: ${masse.punkt(c.x, c.y)}${eingerastet.length > 0 ? ` · eingerastet: ${[...new Set(eingerastet)].join(", ")}` : ""}${c.hinweis != null ? ` · ${c.hinweis}` : ""}`,
    );
  };

  const geraetGeklickt = (id: string) => {
    if (p === undefined) return;
    setKandidat(null);
    onStatus(p.geraetGewaehlt(id));
  };

  const geraetVorschau = (id: string) => {
    if (p === undefined || e === null) return;
    const g = p.geraetPruefen(id);
    if (!g.ok) onStatus(`Nicht möglich: ${g.grund}`);
    else if (e.werte.startId === null) onStatus(`Nächster Klick: Startgerät ${p.geraetName(id)}`);
    else if (id === e.werte.startId) onStatus("Das ist das Startgerät – ein anderes Gerät beendet die Leitung.");
    else onStatus(`Nächster Klick: beendet am Zielgerät ${p.geraetName(id)}`);
  };

  const zuordnungUmschalten = (id: string) => {
    const z = k?.zuordnung;
    if (z === undefined || z.entwurf === null || p === undefined || !p.darfStromkreise) return;
    const zuordnung = new Map(p.kreise.flatMap((kr) => kr.device_ids.map((d) => [d, kr] as const)));
    const art = geraetezustand(id, p.geraete.find((x) => x.id === id)?.zuordenbar === true, z.entwurf, zuordnung);
    if (art === "nicht-zuordenbar") {
      onStatus("Dieses Gerät lässt sich keinem Stromkreis zuordnen.");
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

  const setzen = (c: Kandidat) => {
    if (!c.ok) {
      onStatus(`Nicht gesetzt: ${c.grund ?? ""}`);
      return;
    }
    const neu = c.werte.wegpunkte[c.index + (c.ecke != null ? 1 : 0)];
    const jetzt = Date.now();
    const z = zuletzt.current;
    const schluessel = JSON.stringify(neu);
    if (neu === undefined || wiederholtLetzten(c.werte.wegpunkte.slice(0, c.index), neu) || (z !== null && jetzt - z.zeit < DOPPELKLICK_MS && z.schluessel === schluessel)) return;
    zuletzt.current = { zeit: jetzt, schluessel };
    if (p?.ablauf?.einfuegenNach != null) p.setAblauf({ einfuegenNach: null });
    p?.dispatch({ typ: "aendern", werte: c.werte, auswahl: null });
    onStatus(`${c.ecke != null ? "Ecke und " : ""}Wegpunkt ${c.index + 1 + (c.ecke != null ? 1 : 0)} gesetzt – noch nicht gespeichert.`);
  };

  // Gerät unter dem Zeiger - auch wenn eine bestehende Leitung darüber liegt (Ring wie in Schritt 1).
  const geraetBei = (ev: Zeigerereignis): string | null => {
    const getroffen = ev.ziel?.closest?.("[data-geraet]")?.getAttribute("data-geraet") ?? null;
    if (getroffen !== null) return getroffen;
    // Ersatz über den Ring nur in Schritt 1 (dort reagieren nur Geräte) oder wenn eine bestehende Leitung
    // über dem Gerät liegt - sonst bleibt ein Klick neben einem Gerät ein Wegpunkt.
    if (schritt !== "start" && ev.ziel?.closest?.(".leitung-treffer") == null) return null;
    return geraetImRing(ev.welt, ev.massstab, geraete, START_RING_PX);
  };

  const zusatz: Flaechenzusatz = {
    cursor: zeichnet && darf ? "crosshair" : werkzeug === "zuordnen" ? "pointer" : null,
    druecken: (ev) => {
      if (k === undefined || p === undefined) return false;
      const geraet = geraetBei(ev);
      if (zeichnet && darf && schritt === "start") {
        if (geraet !== null) geraetGeklickt(geraet);
        else onStatus("Zuerst ein Startgerät anklicken – markierte Geräte sind möglich.");
        return true;
      }
      const punkt = ev.ziel?.closest?.("[data-wegpunkt]")?.getAttribute("data-wegpunkt") ?? null;
      if (punkt !== null && e !== null) {
        const index = Number(punkt);
        p.dispatch({ typ: "auswaehlen", auswahl: index });
        if (darf) {
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
      if (zeichnet && darf) {
        if (geraet !== null) {
          geraetGeklickt(geraet);
          return true;
        }
        if (kandidatRef.current === null) setKandidat(neuerKandidat(ev.welt.x, ev.welt.y, ev));
        laufend.current = { art: "setzen", start: ev.welt, massstab: ev.massstab, bewegt: false };
        return true;
      }
      const leitung = ev.ziel?.closest?.("[data-leitung]")?.getAttribute("data-leitung") ?? null;
      if (leitung !== null && e === null) {
        setGewaehlt(leitung);
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
        status(c, "verschieben");
        if (c.ok) {
          l.gueltig = true;
          p?.dispatch({ typ: "ziehen-vorschau", werte: c.werte });
        }
        return true;
      }
      if (aktiv && l?.art === "setzen") {
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
        if (c !== null) status(c, "setzen");
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
        onStatus(l.gueltig ? "Verschoben – noch nicht gespeichert." : "Keine gültige neue Lage – nichts geändert.");
        return;
      }
      if (l?.art === "setzen") {
        const c = kandidatRef.current;
        if (l.bewegt) {
          onStatus("Nicht gesetzt – zum Setzen ohne Bewegung klicken.");
          return;
        }
        setKandidat(null);
        if (c !== null) setzen(c);
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

  /** Escape: Ziehen → Vorschau → Punktauswahl → „danach einfügen“ → Werkzeug beenden. Nie den Entwurf. */
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
      if (event.key.startsWith("Arrow") && index !== null && wp?.art === "ceiling" && wp.raumId === raumId && darf) {
        event.preventDefault();
        const schrittweite = event.shiftKey ? 100 : 10;
        const dx = event.key === "ArrowLeft" ? -schrittweite : event.key === "ArrowRight" ? schrittweite : 0;
        const dy = event.key === "ArrowUp" ? schrittweite : event.key === "ArrowDown" ? -schrittweite : 0;
        const werte = wegpunktErsetzen(e.werte, index, { ...wp, x: wp.x + dx, y: wp.y + dy });
        const geprueft = p.pruefen(werte, index);
        if (geprueft === null) return true;
        if (!geprueft.ok) {
          onStatus(`Nicht verschoben: ${geprueft.grund}`);
          return true;
        }
        p.dispatch({ typ: "aendern", werte });
        onStatus(`Verschoben: ${masse.punkt(wp.x + dx, wp.y + dy)}`);
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
        return true;
      }
      if (kk === "w" && zeichnet) {
        p.setAblauf({ fuehrung: p.ablauf?.fuehrung === "gerade" ? "rechtwinklig" : "gerade" });
        setKandidat(null);
        return true;
      }
    }
    if (kk === "l" && !strg && !event.altKey && k !== undefined && p.darfLeitungen) {
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

  const zeichnen = (b: (x: number, y: number) => Bildpunkt): ReactNode => {
    if (p === undefined || raumId === undefined) return null;
    const teile: ReactNode[] = [];
    for (const { l, strecken } of andere) {
      strecken.forEach((s, i) => {
        const a = b(s.a.x, s.a.y);
        const c = b(s.b.x, s.b.y);
        teile.push(
          <g key={`andere-${l.id}-${i}`} data-leitung={l.id}>
            <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} className={`leitung leitung--andere leitung--${l.status}${l.id === gewaehlt ? " leitung--gewaehlt" : ""}${s.anschluss ? " leitung--anschluss" : ""}`} />
            <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} className="leitung-treffer" />
          </g>,
        );
      });
    }
    if (p.ergebnis !== null && e !== null) {
      deckenstrecken(p.ergebnis, raumId).forEach((s, i) => {
        const a = b(s.a.x, s.a.y);
        const c = b(s.b.x, s.b.y);
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
    for (const pt of punkte) {
      const m = b(pt.x, pt.y);
      const istGewaehlt = e?.auswahl === pt.index;
      teile.push(
        <g key={`wp-${pt.index}`} data-wegpunkt={pt.index} data-testid={`wegpunkt-${pt.index}`}>
          <circle cx={m.x} cy={m.y} r={8} className={`leitung-punkt${istGewaehlt ? " leitung-punkt--gewaehlt" : ""}`}>
            <title>{`Wegpunkt ${pt.index + 1}`}</title>
          </circle>
          <text x={m.x} y={m.y + 3.5} textAnchor="middle" className={`leitung-punkt-text${istGewaehlt ? " leitung-punkt-text--gewaehlt" : ""}`}>
            {pt.index + 1}
          </text>
        </g>,
      );
    }
    if (zeichnet && schritt === "start") {
      for (const g of geraete) {
        const m = b(g.x, g.y);
        const ok = p.geraetPruefen(g.id).ok;
        teile.push(<circle key={`start-${g.id}`} cx={m.x} cy={m.y} r={START_RING_PX} className={`leitung-start-ring${ok ? "" : " leitung-start-ring--nein"}`} data-testid={`startgeraet-${g.id}`} data-moeglich={ok ? "ja" : "nein"} />);
      }
    }
    if (kandidat !== null) {
      const m = b(kandidat.x, kandidat.y);
      const klasse = `leitung-kandidat-strecke${kandidat.ok ? "" : " leitung-kandidat-strecke--fehler"}`;
      if (kandidat.von !== null && kandidat.ecke != null) {
        const a = b(kandidat.von.x, kandidat.von.y);
        const c = b(kandidat.ecke.x, kandidat.ecke.y);
        teile.push(<line key="kandidat-strecke-1" x1={a.x} y1={a.y} x2={c.x} y2={c.y} className={klasse} data-testid="leitung-kandidat-strecke" />);
        teile.push(<line key="kandidat-strecke-2" x1={c.x} y1={c.y} x2={m.x} y2={m.y} className={klasse} data-testid="leitung-kandidat-strecke" />);
        teile.push(<circle key="kandidat-ecke" cx={c.x} cy={c.y} r={4} className={`leitung-kandidat${kandidat.ok ? "" : " leitung-kandidat--fehler"}`} data-testid="leitung-kandidat-ecke" />);
      } else if (kandidat.von !== null) {
        const a = b(kandidat.von.x, kandidat.von.y);
        teile.push(<line key="kandidat-strecke" x1={a.x} y1={a.y} x2={m.x} y2={m.y} className={klasse} data-testid="leitung-kandidat-strecke" />);
      }
      teile.push(
        <circle key="kandidat" cx={m.x} cy={m.y} r={6} data-testid="leitung-kandidat" data-gueltig={kandidat.ok ? "ja" : "nein"} className={`leitung-kandidat${kandidat.ok ? "" : " leitung-kandidat--fehler"}`} />,
      );
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
        const m = b(g.x, g.y);
        teile.push(<circle key={`zu-${g.id}`} cx={m.x} cy={m.y} r={17} className={`zuordnung-ring zuordnung-ring--${art}`} data-testid={`zuordnung-${g.id}`} data-zustand={art} />);
      }
    }
    return <g data-testid="leitungsebene">{teile}</g>;
  };

  return { zusatz, taste, escape, relevant, gewaehlt, setGewaehlt };
}
