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
import { wegpunktEinfuegen, wegpunktEntfernen, wegpunktErsetzen } from "./entwurf";
import type { Anschlusspunkt, Fangeinstellung } from "./flaechen";
import { achseFangen, anschlussFangen, deckenstrecken } from "./flaechen";
import type { Leitungskontext } from "./kontext";
import type { Wegpunkt } from "./laenge";
import type { Leitungswerkzeug } from "./Wandleitungen";
import type { Flaechenzusatz } from "./zusatz";

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
 * Leitungsplanung in der Deckenansicht (Phase 6b.4) - dieselben Gesten wie an
 * der Wand. Deckenstrecken sind gerade und liegen vollständig in der echten
 * Raumkontur (auch im L-Raum); geprüft wird mit der gemeinsamen Längenfunktion.
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
  const laufend = useRef<{ art: "setzen" } | { art: "ziehen"; index: number; gueltig: boolean } | null>(null);
  const vorher = useRef<{ x: string | null; y: string | null }>({ x: null, y: null });
  const [werkzeugVorher, setWerkzeugVorher] = useState(werkzeug);
  if (werkzeugVorher !== werkzeug) {
    setWerkzeugVorher(werkzeug);
    setKandidatState(null);
  }

  const p = k?.planung;
  const e = p?.entwurf ?? null;
  const darf = p !== undefined && p.darfLeitungen && e !== null && e.status !== "speichert" && raumId !== undefined;
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
      if ((l.start_device_id !== null && hier.has(l.start_device_id)) || hier.has(l.end_device_id)) ids.add(l.id);
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

  const status = (c: Kandidat, aktion: string) => {
    if (!c.ok) {
      onStatus(`Nicht möglich: ${c.grund ?? ""}`);
      return;
    }
    const eingerastet = [c.anschluss, ...[c.zielX, c.zielY].filter((z): z is Fangziel => z !== null && z.art !== "raster").map((z) => z.text)].filter(
      (t): t is string => t !== null,
    );
    onStatus(`Wegpunkt ${c.index + 1} ${aktion}: ${masse.punkt(c.x, c.y)}${eingerastet.length > 0 ? ` · eingerastet: ${[...new Set(eingerastet)].join(", ")}` : ""}`);
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

  const zusatz: Flaechenzusatz = {
    cursor: werkzeug === "leitung" && darf ? "crosshair" : werkzeug === "zuordnen" ? "pointer" : null,
    druecken: (ev) => {
      if (k === undefined || p === undefined) return false;
      const punkt = ev.ziel?.closest?.("[data-wegpunkt]")?.getAttribute("data-wegpunkt") ?? null;
      if (punkt !== null && e !== null) {
        const index = Number(punkt);
        p.dispatch({ typ: "auswaehlen", auswahl: index });
        if (darf) {
          p.dispatch({ typ: "ziehen-beginnen" });
          laufend.current = { art: "ziehen", index, gueltig: false };
        }
        onStatus(`Wegpunkt ${index + 1} gewählt – ziehen verschiebt ihn, Entf entfernt ihn, neue Punkte folgen ihm.`);
        return true;
      }
      const geraet = ev.ziel?.closest?.("[data-geraet]")?.getAttribute("data-geraet") ?? null;
      if (werkzeug === "zuordnen" && k.zuordnung.entwurf !== null) {
        if (geraet !== null) zuordnungUmschalten(geraet);
        return true;
      }
      if (werkzeug === "leitung" && darf) {
        if (geraet !== null) {
          geraetGeklickt(geraet);
          return true;
        }
        const c = kandidatFuer(ev.welt.x, ev.welt.y, ev, null);
        setKandidat(c);
        if (c !== null) status(c, "setzen");
        laufend.current = { art: "setzen" };
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
      if ((aktiv && l?.art === "setzen") || (!aktiv && werkzeug === "leitung" && darf)) {
        const c = kandidatFuer(ev.welt.x, ev.welt.y, ev, null);
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
        const schritt = event.shiftKey ? 100 : 10;
        const dx = event.key === "ArrowLeft" ? -schritt : event.key === "ArrowRight" ? schritt : 0;
        const dy = event.key === "ArrowUp" ? schritt : event.key === "ArrowDown" ? -schritt : 0;
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
    if (kandidat !== null) {
      const m = b(kandidat.x, kandidat.y);
      if (kandidat.von !== null) {
        const a = b(kandidat.von.x, kandidat.von.y);
        teile.push(<line key="kandidat-strecke" x1={a.x} y1={a.y} x2={m.x} y2={m.y} className={`leitung-kandidat-strecke${kandidat.ok ? "" : " leitung-kandidat-strecke--fehler"}`} />);
      }
      teile.push(
        <circle key="kandidat" cx={m.x} cy={m.y} r={6} data-testid="leitung-kandidat" data-gueltig={kandidat.ok ? "ja" : "nein"} className={`leitung-kandidat${kandidat.ok ? "" : " leitung-kandidat--fehler"}`} />,
      );
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

  return { zusatz, taste, relevant, gewaehlt, setGewaehlt };
}
