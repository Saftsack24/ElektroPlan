import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Dispatch, PointerEvent as ReactPointerEvent, ReactNode, Ref } from "react";

import { useMasse } from "../../../core/ui/masseinheit";
import "../darstellung.css";
import "./wandansicht.css";
import type { Oeffnungsart, Raumentwurf } from "../editor/entwurf";
import { neueId } from "../editor/entwurf";
import type { EditorWand } from "../editor/platzierung";
import type { Bildpunkt, Groesse, Viewport } from "../editor/viewport";
import { bildZuWelt, einpassen, groesseAendern, verschieben, weltZuBild, zoomen } from "../editor/viewport";
import { OEFFNUNG_STANDARD, oeffnungAendern, oeffnungEinfuegen } from "../editor/werkzeuge";
import type { Aktion } from "../editor/zustand";
import type { Wandteilung } from "../topologie/wandtopologie";
import { OEFFNUNGSART_LABEL } from "../texte";
import type { Masslinie } from "./masslinien";
import { masslinien, textbreitePx } from "./masslinien";
import type { Fangziel, Nachbaroeffnung } from "./wandfang";
import type { Ansichtsrechteck, Wandbezug } from "./wandbezug";
import type { AnsichtsOeffnung, Wandmodell } from "./wandmodell";
import { lagePruefen } from "./wandpruefung";
import type { Bewegung, Bewegungskontext, Griff } from "./wandziehen";
import { bewegen, platzieren } from "./wandziehen";

export type Wandwerkzeug = "auswahl" | "pan" | Oeffnungsart;

const OEFFNUNG_KLASSE: Record<Oeffnungsart, string> = {
  door: "ansicht__oeffnung--door",
  window: "ansicht__oeffnung--window",
  passage: "ansicht__oeffnung--passage",
};

/** Was die Fläche nach außen anbietet - Escape bricht damit eine Bewegung ab. */
export interface ZeichenflaecheGriff {
  /** `true`, wenn eine laufende Bewegung abgebrochen wurde. */
  abbrechen: () => boolean;
  ansichtZuruecksetzen: () => void;
  zoom: (faktor: number) => void;
}

interface Laufend {
  readonly art: "bewegung" | "platzieren" | "pan";
  readonly pointerId: number;
  readonly element: Element;
  readonly startBild: Bildpunkt;
  readonly startViewport: Viewport;
  readonly bewegung?: Bewegung;
  readonly oeffnungId?: string;
  readonly start?: Ansichtsrechteck;
  readonly ab?: Raumentwurf;
  letzte?: Ansichtsrechteck | null;
  vorherH?: string | null;
  vorherV?: string | null;
}

/** Vorschau beim Platzieren oder Bewegen - reine Anzeige. */
interface Vorschau {
  readonly rechteck: Ansichtsrechteck;
  readonly ok: boolean;
  readonly grund: string | null;
  readonly zielH: Fangziel | null;
  readonly zielV: Fangziel | null;
  /** Öffnung, die gerade bewegt wird (für Maßlinien gegen die übrigen). */
  readonly oeffnungId: string | null;
}

interface Props {
  bezug: Wandbezug;
  modell: Wandmodell;
  teilung: Wandteilung<EditorWand> | undefined;
  entwurf: Raumentwurf | null;
  dispatch: Dispatch<Aktion>;
  editierbar: boolean;
  werkzeug: Wandwerkzeug;
  onWerkzeug: (w: Wandwerkzeug) => void;
  gewaehlt: string | null;
  onWaehlen: (id: string | null) => void;
  rasterMm: number;
  fangAktiv: boolean;
  raumName: (raumId: string) => string;
  /** Nachbarräume mit eigener (abweichender) Deckenhöhe. */
  nachbarHoehe: (raumId: string) => number | null;
  /** Statuszeile unter der Fläche. */
  onStatus: (text: string) => void;
  griff?: Ref<ZeichenflaecheGriff>;
}

const RUECKFALL: Groesse = { breite: 900, hoehe: 480 };
/** Rand für Maßlinien und Beschriftungen in Pixeln. */
const RAND = 72;

function nachbarn(modell: Wandmodell, ohne: string | null): Nachbaroeffnung[] {
  let nummer = 0;
  return modell.oeffnungen
    .map((o) => ({ o, n: (nummer += 1) }))
    .filter(({ o }) => o.id !== ohne)
    .map(({ o, n }) => ({
      id: o.id,
      name: `${OEFFNUNGSART_LABEL[o.art]} ${n}`,
      links: o.links,
      rechts: o.rechts,
      unten: o.unten,
      oben: o.oben,
      fenster: o.art === "window",
    }));
}

/**
 * SVG-Zeichenfläche der Wandansicht. Welt = Ansichtskoordinaten `(u, h)` in
 * Millimetern, gezeichnet über dieselben reinen Viewport-Funktionen wie der
 * Grundriss. Zoom und Verschieben ändern nur den Viewport, nie Daten.
 */
export function WandZeichenflaeche(props: Props) {
  const { bezug, modell, editierbar, werkzeug, gewaehlt, dispatch } = props;
  const masse = useMasse();
  const huelle = useRef<HTMLDivElement>(null);
  const flaeche = useRef<SVGSVGElement>(null);
  const [groesse, setGroesse] = useState<Groesse>(RUECKFALL);
  const groesseRef = useRef(groesse);
  const [viewport, setViewport] = useState<Viewport>(() => einpassenWand(bezug, RUECKFALL));
  const [vorschau, setVorschau] = useState<Vorschau | null>(null);
  const laufend = useRef<Laufend | null>(null);
  const L = bezug.laengeMm;
  const H = bezug.hoeheMm;

  const ansichtZuruecksetzen = () => setViewport(einpassenWand(bezug, groesseRef.current));

  // Größe beobachten: Maßstab und Mitte bleiben, nichts springt.
  useEffect(() => {
    const element = huelle.current;
    if (element === null) return undefined;
    let erstesMal = true;
    const messen = () => {
      const r = element.getBoundingClientRect();
      const neu = r.width > 0 && r.height > 0 ? { breite: r.width, hoehe: r.height } : RUECKFALL;
      const alt = groesseRef.current;
      if (alt.breite === neu.breite && alt.hoehe === neu.hoehe && !erstesMal) return;
      groesseRef.current = neu;
      setGroesse(neu);
      setViewport((v) => (erstesMal ? einpassenWand(bezug, neu) : groesseAendern(v, alt, neu)));
      erstesMal = false;
    };
    messen();
    if (typeof ResizeObserver === "undefined") return undefined;
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(element);
    return () => beobachter.disconnect();
    // Nur beim Einhängen und bei einer anderen Wand neu einpassen.
  }, [bezug.wandId, bezug.raumId]);

  // Mausrad zoomt um den Zeiger - nicht passiv, damit die Seite nicht scrollt.
  useEffect(() => {
    const svg = flaeche.current;
    if (svg === null) return undefined;
    const rad = (event: WheelEvent) => {
      event.preventDefault();
      const r = svg.getBoundingClientRect();
      const faktor = Math.exp(-event.deltaY * 0.0015);
      setViewport((v) => zoomen(v, faktor, { x: event.clientX - r.left, y: event.clientY - r.top }));
    };
    svg.addEventListener("wheel", rad, { passive: false });
    return () => svg.removeEventListener("wheel", rad);
  }, []);

  const freigeben = () => {
    const l = laufend.current;
    laufend.current = null;
    if (l !== null && l.element.hasPointerCapture?.(l.pointerId)) l.element.releasePointerCapture?.(l.pointerId);
  };

  /** Bricht eine laufende Bewegung ab - Entwurf zurück, Zeiger frei, keine Historie. */
  const abbrechen = (): boolean => {
    const l = laufend.current;
    if (l === null) return false;
    freigeben();
    setVorschau(null);
    if (l.art === "bewegung") dispatch({ typ: "ziehen-abbrechen" });
    props.onStatus("Bewegung abgebrochen - nichts geändert.");
    return true;
  };

  useImperativeHandle(props.griff, () => ({
    abbrechen,
    ansichtZuruecksetzen,
    zoom: (faktor: number) =>
      setViewport((v) => zoomen(v, faktor, { x: groesseRef.current.breite / 2, y: groesseRef.current.hoehe / 2 })),
  }));

  // Beim Aushängen (Dialog geschlossen) darf keine Bewegung hängen bleiben.
  useEffect(
    () => () => {
      if (laufend.current?.art === "bewegung") dispatch({ typ: "ziehen-abbrechen" });
      laufend.current = null;
    },
    [dispatch],
  );

  const bildpunkt = (event: ReactPointerEvent): Bildpunkt => {
    const r = flaeche.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
  };

  const kontext = (ohne: string | null, fenster: boolean, altKey: boolean, l?: Laufend | null): Bewegungskontext => ({
    laengeMm: L,
    hoeheMm: H,
    andere: nachbarn(modell, ohne),
    fenster,
    fang: {
      aktiv: props.fangAktiv,
      ausgesetzt: altKey,
      massstab: viewport.massstab,
      rasterMm: props.rasterMm,
      vorherWaagerecht: l?.vorherH ?? null,
      vorherSenkrecht: l?.vorherV ?? null,
    },
  });

  const pruefen = (art: Oeffnungsart, r: Ansichtsrechteck, ohne?: string) =>
    lagePruefen(bezug, props.teilung, art, r, { ohneOeffnungId: ohne, laengeText: masse.anzeigen, raumName: props.raumName });

  const neueVorschau = (art: Oeffnungsart, welt: { x: number }, altKey: boolean): Vorschau => {
    const std = OEFFNUNG_STANDARD[art];
    const e = platzieren(welt.x, { breite: std.width_mm, hoehe: std.height_mm, bruestung: std.sill_height_mm }, kontext(null, false, altKey));
    const p = pruefen(art, e.rechteck);
    return { rechteck: e.rechteck, ok: p.ok, grund: p.ok ? null : p.grund, zielH: e.zielWaagerecht, zielV: null, oeffnungId: null };
  };

  const statusFuer = (v: Vorschau, art: Oeffnungsart, aktion: string) => {
    const r = v.rechteck;
    const lage = `${OEFFNUNGSART_LABEL[art]} ${aktion}: von links ${masse.anzeigen(r.links)} · Breite ${masse.anzeigen(r.rechts - r.links)} · Höhe ${masse.anzeigen(r.oben - r.unten)}${
      r.unten > 0 ? ` · Brüstung ${masse.anzeigen(r.unten)}` : ""
    }`;
    const fang = [...new Set([v.zielH, v.zielV].filter((z): z is Fangziel => z !== null).map((z) => z.text))];
    props.onStatus(v.ok ? `${lage}${fang.length > 0 ? ` · eingerastet: ${fang.join(", ")}` : ""}` : `Nicht möglich: ${v.grund ?? ""}`);
  };

  // ------------------------------------------------------------ Zeiger

  const druecken = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bild = bildpunkt(event);
    const einfangen = (art: Laufend["art"], extra: Partial<Laufend> = {}) => {
      // Einfangen ist eine Hilfe gegen verlorene Zeiger, keine Voraussetzung: Kennt der
      // Browser den Zeiger nicht (mehr), wirft er - die Bewegung läuft trotzdem.
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // ohne Einfangen weiter
      }
      laufend.current = { art, pointerId: event.pointerId, element: event.currentTarget, startBild: bild, startViewport: viewport, ...extra };
    };
    if (event.button === 1 || (event.button === 0 && werkzeug === "pan")) {
      event.preventDefault();
      einfangen("pan");
      return;
    }
    if (event.button !== 0) return;
    const ziel = (event.target as Element).closest?.("[data-oeffnung]");
    const id = ziel?.getAttribute("data-oeffnung") ?? null;
    const griff = (ziel?.getAttribute("data-griff") ?? null) as Griff | null;

    if (werkzeug !== "auswahl" && werkzeug !== "pan" && editierbar && id === null) {
      const v = neueVorschau(werkzeug, bildZuWelt(viewport, bild), event.altKey);
      setVorschau(v);
      statusFuer(v, werkzeug, "setzen");
      einfangen("platzieren");
      return;
    }
    if (id === null) {
      props.onWaehlen(null);
      return;
    }
    props.onWaehlen(id);
    const o = modell.oeffnungen.find((x) => x.id === id);
    if (o === undefined || !o.eigen || !editierbar || props.entwurf === null) return;
    const bewegung: Bewegung = griff === null ? { art: "verschieben" } : { art: "groesse", griff };
    dispatch({ typ: "ziehen-beginnen" });
    einfangen("bewegung", { bewegung, oeffnungId: id, start: o, ab: props.entwurf, letzte: null });
  };

  const bewegenZeiger = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bild = bildpunkt(event);
    const welt = bildZuWelt(viewport, bild);
    const l = laufend.current;
    if (l?.art === "pan") {
      setViewport(verschieben(l.startViewport, bild.x - l.startBild.x, bild.y - l.startBild.y));
      return;
    }
    if (l?.art === "bewegung" && l.start !== undefined && l.bewegung !== undefined && l.ab !== undefined && l.oeffnungId !== undefined) {
      const o = modell.oeffnungen.find((x) => x.id === l.oeffnungId);
      if (o === undefined) return;
      const start = bildZuWelt(l.startViewport, l.startBild);
      const e = bewegen(l.start, l.bewegung, welt.x - start.x, welt.y - start.y, kontext(o.id, o.art === "window", event.altKey, l));
      l.vorherH = e.zielWaagerecht?.id ?? null;
      l.vorherV = e.zielSenkrecht?.id ?? null;
      // Ein Fangziel darf keine ungültige Lage erzwingen: dann ohne Fang versuchen.
      let rechteck = e.rechteck;
      let p = pruefen(o.art, rechteck, o.id);
      let zielH = e.zielWaagerecht;
      let zielV = e.zielSenkrecht;
      if (!p.ok && (zielH !== null || zielV !== null)) {
        const frei = bewegen(l.start, l.bewegung, welt.x - start.x, welt.y - start.y, kontext(o.id, o.art === "window", true, l));
        const p2 = pruefen(o.art, frei.rechteck, o.id);
        if (p2.ok) {
          rechteck = frei.rechteck;
          p = p2;
          zielH = null;
          zielV = null;
        }
      }
      const v: Vorschau = { rechteck, ok: p.ok, grund: p.ok ? null : p.grund, zielH, zielV, oeffnungId: o.id };
      setVorschau(v);
      statusFuer(v, o.art, l.bewegung.art === "verschieben" ? "verschieben" : "Größe ändern");
      if (!p.ok) return; // Die letzte gültige Lage bleibt im Entwurf.
      l.letzte = rechteck;
      dispatch({ typ: "ziehen-vorschau", entwurf: oeffnungAendern(l.ab, bezug.wandId, o.id, p.werte) });
      return;
    }
    if (werkzeug !== "auswahl" && werkzeug !== "pan" && editierbar) {
      const v = neueVorschau(werkzeug, welt, event.altKey);
      setVorschau(v);
      statusFuer(v, werkzeug, "setzen");
      return;
    }
    const u = Math.round(welt.x);
    const h = Math.round(welt.y);
    props.onStatus(
      u >= 0 && u <= L && h >= 0 && h <= H
        ? `Zeiger: ${masse.anzeigen(u)} von links · ${masse.anzeigen(h)} über Boden`
        : "Zeiger außerhalb der Wand",
    );
  };

  const loslassen = () => {
    const l = laufend.current;
    if (l === null) return;
    freigeben();
    if (l.art === "bewegung") {
      setVorschau(null);
      dispatch({ typ: "ziehen-beenden" });
      if (l.letzte === null || l.letzte === undefined) props.onStatus("Keine gültige neue Lage - nichts geändert.");
      return;
    }
    if (l.art === "platzieren" && vorschau !== null && werkzeug !== "auswahl" && werkzeug !== "pan" && props.entwurf !== null) {
      const art = werkzeug;
      const v = vorschau;
      setVorschau(null);
      if (!v.ok) {
        props.onStatus(`Nicht gesetzt: ${v.grund ?? ""}`);
        return;
      }
      const p = pruefen(art, v.rechteck);
      if (!p.ok) return;
      const id = neueId();
      // Genau eine neue Öffnung an genau dieser Wand; Standardmaße der Art.
      const mitNeuer = oeffnungEinfuegen(props.entwurf, bezug.wandId, art, p.werte.offset_mm, id);
      dispatch({ typ: "aendern", entwurf: mitNeuer });
      props.onWaehlen(id);
      props.onWerkzeug("auswahl");
      props.onStatus(`${OEFFNUNGSART_LABEL[art]} gesetzt - noch nicht gespeichert.`);
    }
  };

  const systemAbbruch = () => {
    if (laufend.current !== null) abbrechen();
  };

  // ------------------------------------------------------------ Zeichnen

  const b = (u: number, h: number) => weltZuBild(viewport, { x: u, y: h });
  const lu = b(0, 0);
  const ro = b(L, H);
  const elemente: ReactNode[] = [];

  // Raster auf der Wandfläche (ab linker Kante und Fußboden).
  let schritt = props.rasterMm;
  while (schritt * viewport.massstab < 8) schritt *= schritt % 250 === 0 ? 2 : 5;
  const raster: string[] = [];
  for (let u = schritt; u < L; u += schritt) raster.push(`M${b(u, 0).x.toFixed(1)} ${lu.y.toFixed(1)}V${ro.y.toFixed(1)}`);
  for (let h = schritt; h < H; h += schritt) raster.push(`M${lu.x.toFixed(1)} ${b(0, h).y.toFixed(1)}H${ro.x.toFixed(1)}`);

  // Abschnitte und Nachbarräume über der Decke.
  modell.abschnitte.forEach((a, i) => {
    const x1 = b(a.links, H).x;
    const x2 = b(a.rechts, H).x;
    const gemeinsam = a.nachbarn.length > 0;
    const text = a.mehrdeutig
      ? "mehrdeutig - mehr als zwei Räume"
      : gemeinsam
        ? `angrenzend: ${a.nachbarn.map(props.raumName).join(", ")}`
        : "nicht geteilt (Außenwand)";
    elemente.push(
      <g key={`abschnitt-${i}`} data-testid="wandabschnitt">
        <rect
          x={x1}
          y={ro.y - 26}
          width={Math.max(x2 - x1, 1)}
          height={18}
          className={`ansicht__abschnitt${a.mehrdeutig ? " ansicht__abschnitt--mehrdeutig" : gemeinsam ? " ansicht__abschnitt--gemeinsam" : ""}`}
        >
          <title>{text}</title>
        </rect>
        {x2 - x1 > textbreitePx(text) && (
          <text x={(x1 + x2) / 2} y={ro.y - 13} textAnchor="middle" className="ansicht__text ansicht__text--klein">
            {text}
          </text>
        )}
      </g>,
    );
    for (const nachbar of a.nachbarn) {
      const hoehe = props.nachbarHoehe(nachbar);
      if (hoehe === null || hoehe === H) continue;
      const y = b(0, hoehe).y;
      elemente.push(
        <g key={`nachbardecke-${i}-${nachbar}`}>
          <line x1={x1} y1={y} x2={x2} y2={y} className="ansicht__nachbardecke" />
          <text x={x1 + 4} y={y - 4} className="ansicht__text ansicht__text--warnung">
            {`Decke ${props.raumName(nachbar)}: ${masse.anzeigen(hoehe)} (abweichend)`}
          </text>
        </g>,
      );
    }
  });

  // Öffnungen.
  const nummern = new Map(modell.oeffnungen.map((o, i) => [o.id, i + 1]));
  for (const o of modell.oeffnungen) {
    const p1 = b(o.links, o.oben);
    const p2 = b(o.rechts, o.unten);
    const ausgewaehlt = o.id === gewaehlt;
    const k = ["ansicht__oeffnung", OEFFNUNG_KLASSE[o.art]];
    if (!o.eigen) k.push("ansicht__oeffnung--abgeleitet");
    else if (editierbar) k.push("ansicht__oeffnung--bearbeitbar");
    if (o.befunde.length > 0) k.push("ansicht__oeffnung--fehler");
    if (ausgewaehlt) k.push("ansicht__oeffnung--ausgewaehlt");
    const name = `${OEFFNUNGSART_LABEL[o.art]} ${nummern.get(o.id) ?? ""}`;
    const titel = o.eigen
      ? `${name}${editierbar ? " - ziehen zum Verschieben" : ""}`
      : `${name} - gespeichert in „${props.raumName(o.quelleRaumId)}“, hier abgeleitet`;
    elemente.push(
      <g key={o.id}>
        <rect
          x={p1.x}
          y={p1.y}
          width={Math.max(p2.x - p1.x, 1)}
          height={Math.max(p2.y - p1.y, 1)}
          className={k.join(" ")}
          data-oeffnung={o.id}
          data-testid={`ansicht-oeffnung-${o.id}`}
          aria-label={titel}
        >
          <title>{titel}</title>
        </rect>
        <text x={(p1.x + p2.x) / 2} y={p1.y + 16} textAnchor="middle" className="ansicht__text ansicht__text--klein">
          {o.eigen ? name : `${name} · aus ${props.raumName(o.quelleRaumId)}`}
          {o.befunde.length > 0 ? " ⚠" : ""}
        </text>
      </g>,
    );
  }

  // Griffe der gewählten, bearbeitbaren Öffnung.
  const auswahl = modell.oeffnungen.find((o) => o.id === gewaehlt);
  if (auswahl !== undefined && auswahl.eigen && editierbar && vorschau === null) {
    elemente.push(<Griffe key="griffe" o={auswahl} b={b} />);
  }

  // Vorschau, Fangziele, Maßlinien.
  const aktiv: (Ansichtsrechteck & { id: string | null }) | null =
    vorschau !== null ? { ...vorschau.rechteck, id: vorschau.oeffnungId } : auswahl !== undefined ? { ...auswahl, id: auswahl.id } : null;
  if (vorschau !== null) {
    const p1 = b(vorschau.rechteck.links, vorschau.rechteck.oben);
    const p2 = b(vorschau.rechteck.rechts, vorschau.rechteck.unten);
    elemente.push(
      <rect
        key="vorschau"
        x={p1.x}
        y={p1.y}
        width={Math.max(p2.x - p1.x, 1)}
        height={Math.max(p2.y - p1.y, 1)}
        className={vorschau.ok ? "ansicht__vorschau" : "ansicht__vorschau ansicht__vorschau--fehler"}
        data-testid="wand-vorschau"
        data-gueltig={vorschau.ok ? "ja" : "nein"}
      />,
    );
    if (!vorschau.ok) {
      elemente.push(
        <text key="vorschau-x" x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2} textAnchor="middle" className="ansicht__text ansicht__masstext--ueberschneidung">
          nicht möglich
        </text>,
      );
    }
    for (const z of [vorschau.zielH, vorschau.zielV]) {
      if (z === null || z.art === "raster") continue;
      const senkrecht = z === vorschau.zielH;
      const a = senkrecht ? b(z.wert, 0) : b(0, z.wert);
      elemente.push(
        <g key={`fang-${z.id}`} data-testid="fangziel">
          {senkrecht ? (
            <line x1={a.x} y1={ro.y - 30} x2={a.x} y2={lu.y + 8} className="ansicht__fang" />
          ) : (
            <line x1={lu.x - 8} y1={a.y} x2={ro.x + 8} y2={a.y} className="ansicht__fang" />
          )}
          <text x={senkrecht ? a.x + 4 : ro.x - 4} y={senkrecht ? ro.y - 32 : a.y - 4} textAnchor={senkrecht ? "start" : "end"} className="ansicht__text ansicht__text--warnung">
            {z.text}
          </text>
        </g>,
      );
    }
  }
  if (aktiv !== null) {
    const andere = nachbarn(modell, aktiv.id).map((n) => ({ ...n }));
    elemente.push(<Masse key="masse" linien={masslinien(aktiv, L, H, andere, masse.anzeigen)} b={b} aktiv={aktiv} lu={lu} />);
  }

  const cursor = werkzeug === "pan" ? "grab" : werkzeug === "auswahl" ? "default" : "crosshair";

  return (
    <div ref={huelle} className="relative h-full min-h-[300px] touch-none overflow-hidden rounded-ep border border-line bg-canvas">
      <svg
        ref={flaeche}
        className="ansicht__svg"
        role="application"
        aria-label={`Wandansicht: Wand ${bezug.wandNummer}, ${masse.anzeigen(L)} breit, ${masse.anzeigen(H)} hoch`}
        tabIndex={0}
        width={groesse.breite}
        height={groesse.hoehe}
        style={{ cursor }}
        onPointerDown={druecken}
        onPointerMove={bewegenZeiger}
        onPointerUp={loslassen}
        onPointerCancel={systemAbbruch}
        onLostPointerCapture={() => {
          if (laufend.current !== null) systemAbbruch();
        }}
        onPointerLeave={() => {
          if (laufend.current === null) setVorschau(null);
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <rect x={lu.x} y={ro.y} width={Math.max(ro.x - lu.x, 1)} height={Math.max(lu.y - ro.y, 1)} className="ansicht__wand" data-testid="wandflaeche" />
        <path d={raster.join("")} className="ansicht__raster" aria-hidden="true" />
        <line x1={lu.x - 40} y1={lu.y} x2={ro.x + 40} y2={lu.y} className="ansicht__boden" />
        <text x={lu.x - 44} y={lu.y + 4} textAnchor="end" className="ansicht__text ansicht__text--klein">
          Boden (FFB)
        </text>
        <line x1={lu.x - 40} y1={ro.y} x2={ro.x + 40} y2={ro.y} className="ansicht__decke" />
        <text x={lu.x - 44} y={ro.y + 4} textAnchor="end" className="ansicht__text ansicht__text--klein">
          {`Decke ${masse.anzeigen(H)}`}
        </text>
        <text x={lu.x} y={lu.y + 58} className="ansicht__text">
          {`◂ links${bezug.nachbarLinks !== null ? ` · Wand ${bezug.nachbarLinks}` : ""}`}
        </text>
        <text x={ro.x} y={lu.y + 58} textAnchor="end" className="ansicht__text">
          {`${bezug.nachbarRechts !== null ? `Wand ${bezug.nachbarRechts} · ` : ""}rechts ▸`}
        </text>
        {elemente}
      </svg>
    </div>
  );
}

/** Passt Wand plus Rand für Beschriftungen in die Fläche. */
function einpassenWand(bezug: Wandbezug, groesse: Groesse): Viewport {
  return einpassen({ minX: 0, minY: 0, maxX: bezug.laengeMm, maxY: bezug.hoeheMm }, groesse, RAND);
}

/** Griffe: links, rechts (Breite), oben (Höhe), unten beim Fenster (Brüstung). Treffer 20 px. */
function Griffe({ o, b }: { o: AnsichtsOeffnung; b: (u: number, h: number) => Bildpunkt }) {
  const mitteU = (o.links + o.rechts) / 2;
  const mitteH = (o.unten + o.oben) / 2;
  const griffe: { griff: Griff; p: Bildpunkt; ew: boolean; label: string }[] = [
    { griff: "links", p: b(o.links, mitteH), ew: true, label: "Breite ändern (linke Kante)" },
    { griff: "rechts", p: b(o.rechts, mitteH), ew: true, label: "Breite ändern (rechte Kante)" },
    { griff: "oben", p: b(mitteU, o.oben), ew: false, label: "Höhe ändern (Oberkante)" },
  ];
  if (o.art === "window") griffe.push({ griff: "unten", p: b(mitteU, o.unten), ew: false, label: "Brüstung ändern (Unterkante)" });
  return (
    <g>
      {griffe.map(({ griff, p, ew, label }) => (
        <g key={griff} data-oeffnung={o.id} data-griff={griff} data-testid={`griff-${griff}`}>
          <rect x={p.x - 7} y={p.y - 7} width={14} height={14} className="ansicht__griff" />
          <rect x={p.x - 10} y={p.y - 10} width={20} height={20} className={`ansicht__griff-treffer ${ew ? "ansicht__griff-treffer--ew" : "ansicht__griff-treffer--ns"}`}>
            <title>{label}</title>
          </rect>
        </g>
      ))}
    </g>
  );
}

/**
 * Maßlinien im Bildraum. Zu kurze Strecken tragen ihren Text versetzt
 * darunter (Reihe 0) bzw. darüber (Reihe 1), damit sich Texte nicht decken.
 */
function Masse({
  linien,
  b,
  aktiv,
  lu,
}: {
  linien: readonly Masslinie[];
  b: (u: number, h: number) => Bildpunkt;
  aktiv: Ansichtsrechteck;
  lu: Bildpunkt;
}) {
  const teile: ReactNode[] = [];
  let versatz = 0;
  for (const l of linien) {
    const klasse =
      l.art === "ueberschneidung" ? "ansicht__mass ansicht__mass--ueberschneidung" : l.art === "nachbar" ? "ansicht__mass ansicht__mass--nachbar" : "ansicht__mass";
    const textklasse = l.art === "ueberschneidung" ? "ansicht__masstext ansicht__masstext--ueberschneidung" : "ansicht__masstext";
    if (l.achse === "waagerecht") {
      const y = l.reihe === 0 ? lu.y + 24 : b(0, aktiv.oben).y - 12;
      const x1 = b(l.von, 0).x;
      const x2 = b(l.bis, 0).x;
      if (Math.abs(x2 - x1) < 0.5 && l.art === "rand") continue;
      const passt = Math.abs(x2 - x1) >= textbreitePx(l.text);
      if (!passt) versatz = versatz === 14 ? 28 : 14;
      const ty = passt ? y - 4 : l.reihe === 0 ? y + versatz : y - versatz;
      teile.push(
        <g key={l.id} data-testid={`mass-${l.id}`} aria-label={`${l.bezeichnung}: ${l.text}`}>
          <line x1={x1} y1={y} x2={x2} y2={y} className={klasse} />
          <line x1={x1} y1={y - 5} x2={x1} y2={y + 5} className={klasse} />
          <line x1={x2} y1={y - 5} x2={x2} y2={y + 5} className={klasse} />
          <text x={(x1 + x2) / 2} y={ty} textAnchor="middle" className={textklasse}>
            <title>{l.bezeichnung}</title>
            {l.text}
          </text>
        </g>,
      );
    } else {
      const x = b(aktiv.rechts, 0).x + 18;
      const y1 = b(0, l.von).y;
      const y2 = b(0, l.bis).y;
      if (Math.abs(y2 - y1) < 0.5) continue;
      teile.push(
        <g key={l.id} data-testid={`mass-${l.id}`} aria-label={`${l.bezeichnung}: ${l.text}`}>
          <line x1={x} y1={y1} x2={x} y2={y2} className={klasse} />
          <line x1={x - 5} y1={y1} x2={x + 5} y2={y1} className={klasse} />
          <line x1={x - 5} y1={y2} x2={x + 5} y2={y2} className={klasse} />
          <text x={x + 6} y={(y1 + y2) / 2 + 4} className={textklasse}>
            <title>{l.bezeichnung}</title>
            {l.text}
          </text>
        </g>,
      );
    }
  }
  return <g aria-hidden="false">{teile}</g>;
}
