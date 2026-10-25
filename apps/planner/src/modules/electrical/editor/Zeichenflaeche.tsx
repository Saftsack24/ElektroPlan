import { memo, useEffect, useMemo, useRef, useState } from "react";
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction,
} from "react";

import { useMasse } from "../../../core/ui/masseinheit";
import "../darstellung.css";
import "./grundriss.css";
import type { EntwurfWand, Oeffnungsart, Raumentwurf } from "./entwurf";
import { ende, start } from "./entwurf";
import { fangen } from "./fang";
import type { Fangziel } from "./fang";
import { entwurfsBefunde, streckenlaenge } from "./geometrie";
import type { Punkt } from "./geometrie";
import type { Bildpunkt, Groesse, Viewport } from "./viewport";
import {
  aufMillimeter,
  bildZuWelt,
  groesseAendern,
  sichtbareGrenzen,
  transformation,
  verschieben,
  weltZuBild,
  zoomen,
} from "./viewport";
import {
  eckeVerschieben,
  ecken,
  oeffnungAendern,
  punktAnhaengen,
  schliesstPolygon,
} from "./werkzeuge";
import { OEFFNUNGSART_LABEL } from "../texte";
import type { EditorEinordnung, EditorTopologie, EditorWand, Platzierung } from "./platzierung";
import {
  OEFFNUNG_FANG_MM,
  platzierungBerechnen,
  platzierungsText,
  raumwandUnterZeiger,
  verbindungsText,
} from "./platzierung";
import type { Aktion, Auswahl, EditorZustand } from "./zustand";
import type { Geraetetyp } from "../geraete/katalog";
import { SymbolImPlan } from "../geraete/symbole";
import { geraetelayout, SYMBOLGROESSE, type Symbollage } from "./geraetelayout";
import type { Flaechenzusatz } from "../leitung/zusatz";

/** Klasse je Öffnungsart (grundriss.css); ausgeschrieben statt zusammengesetzt. */
const OEFFNUNG_KLASSE: Record<Oeffnungsart, string> = {
  door: "grundriss__oeffnung--door",
  window: "grundriss__oeffnung--window",
  passage: "grundriss__oeffnung--passage",
};

/**
 * Ein Gerät im Grundriss (Phase 5): Ankerpunkt in Weltkoordinaten und - bei
 * Wandgeräten - die Richtung zur Montageseite (Einheitsvektor im Grundriss),
 * damit das Symbol neben der Wand auf der richtigen Seite steht. Reine Anzeige.
 */
export interface Geraetedarstellung {
  readonly id: string;
  readonly raumId: string;
  readonly aktiv: boolean;
  readonly typ: Geraetetyp | undefined;
  readonly name: string;
  readonly anker: Punkt;
  /** Versatz zur Montageseite in mm (halbe Wandstärke) und Richtung; Decke: 0. */
  readonly versatzMm: number;
  readonly richtung: Punkt;
  readonly decke: boolean;
  readonly fehler: boolean;
}

/** Ein Raum, wie er gezeichnet wird: aktiv aus dem Entwurf, sonst aus dem Serverstand. */
export interface Raumdarstellung {
  readonly id: string;
  readonly name: string;
  readonly nummer: string | null;
  readonly walls: readonly EntwurfWand[];
  readonly aktiv: boolean;
  readonly flaecheText: string;
}

interface Props {
  raeume: readonly Raumdarstellung[];
  zustand: EditorZustand;
  dispatch: Dispatch<Aktion>;
  viewport: Viewport;
  setViewport: Dispatch<SetStateAction<Viewport>>;
  onGroesse: (groesse: Groesse) => void;
  /** Zuletzt gemessene Größe, zu der der Viewport gehört (beim Wiedereinhängen). */
  anfangsGroesse?: Groesse;
  darfSchreiben: boolean;
  rasterMm: number;
  fangAktiv: boolean;
  fehlerKeys: ReadonlySet<string>;
  lokaleKeys: ReadonlySet<string>;
  onWaehlen: (auswahl: Auswahl) => void;
  onPolygonFertig: (punkte: readonly Punkt[]) => void;
  onRechteckFertig: (a: Punkt, b: Punkt) => void;
  /**
   * Werkzeug Tür/Fenster/Durchgang (Phase 4f): Der Klick wählt nur die Wand der
   * angeklickten Raumseite - gesetzt wird in deren Wandansicht.
   */
  onWandFuerOeffnung: (raumId: string, wandId: string) => void;
  /** Eine vorhandene Öffnung in ihrer Wandansicht bearbeiten (an der Eigentümerwand). */
  onOeffnungBearbeiten: (raumId: string, wandId: string, oeffnungId: string) => void;
  /**
   * K1: Klick neben jede Wand bei aktiver Wandwahl (etwa ein Deckengerät aus dem Katalog: in
   * den Raum klicken). `true`: verarbeitet, kein Hinweis „Auf eine Wand klicken“.
   */
  onFlaechenklick?: ((welt: Punkt) => boolean) | undefined;
  /** Kurzer Hinweis über der Zeichenfläche; `null` räumt ihn. */
  onHinweis: (text: string | null) => void;
  /** Was ein Klick auf eine Wand öffnet (L1: auch das Gerätewerkzeug). */
  oeffnungsart: Oeffnungsart | "geraet";
  geschossLabel: string;
  /** Gemeinsame Wandtopologie und abgeleitete Raumverbindungen (Phase 4b.2). */
  topologie: EditorTopologie;
  einordnung: EditorEinordnung;
  raumName: (raumId: string) => string;
  /** Phase 5: Geräte aller Räume des Geschosses. */
  geraete?: readonly Geraetedarstellung[];
  /** Doppelklick auf ein Gerät: in seiner Wand- oder Deckenansicht bearbeiten. */
  onGeraetBearbeiten?: (raumId: string, geraetId: string) => void;
  /**
   * Leitungsebene (Phase 6b.5): Sie hängt sich in die Zeigerereignisse ein. Übernimmt sie ein
   * Drücken nicht, gilt das bisherige Verhalten des Grundrisses unverändert.
   */
  zusatz?: Flaechenzusatz | undefined;
}

interface OeffnungZiehen {
  readonly art: "oeffnung";
  readonly wandId: string;
  readonly oeffnungId: string;
  readonly ab: Raumentwurf;
  readonly breiteMm: number;
  /** Raumverbindung zu Beginn - ein Wechsel wird nach dem Loslassen gemeldet. */
  readonly startText: string;
  readonly startKlasse: string;
  /** Zuletzt gültige Lage; eine ungültige Zeigerposition verändert nichts. */
  letzte: Platzierung | null;
}

type Ziehen =
  | { art: "pan"; start: Bildpunkt; viewport: Viewport }
  | { art: "ecke"; punkt: Punkt; ab: Raumentwurf; raumId: string }
  | OeffnungZiehen
  | { art: "zusatz" }
  | null;

/** Vorschau einer Öffnung beim Platzieren oder Verschieben - reine Anzeige. */
interface Oeffnungsvorschau {
  readonly platzierung: Platzierung;
  readonly art: Oeffnungsart;
  readonly text: string;
}

/** Hervorgehobene Wand beim Werkzeug Tür/Fenster/Durchgang - reine Anzeige. */
interface Wandvorschau {
  readonly wandId: string | null;
  readonly text: string;
  readonly ok: boolean;
}

/** Fangradius für Wände in Bildschirmpixeln (zusätzlich zur halben Wandstärke). */
const WANDRADIUS_PX = 10;

const RUECKFALL_GROESSE: Groesse = { breite: 900, hoehe: 560 };

function datensatz(ziel: EventTarget | null): DOMStringMap | null {
  const element = (ziel as Element | null)?.closest?.("[data-raum]");
  return element instanceof SVGElement || element instanceof HTMLElement ? element.dataset : null;
}


export function Zeichenflaeche(props: Props) {
  const {
    raeume,
    zustand,
    dispatch,
    viewport,
    setViewport,
    darfSchreiben,
    rasterMm,
    fangAktiv,
  } = props;
  // Nur sichtbare Beschriftungen folgen der Anzeigeeinheit; Geometrie,
  // Raster und Maßstab bleiben in Millimetern.
  const masse = useMasse();
  const huelle = useRef<HTMLDivElement>(null);
  const flaeche = useRef<SVGSVGElement>(null);
  // Wieder eingehängt (L1: nach einer Wand- oder Deckenfläche) beginnt die Fläche mit der zuletzt
  // gemessenen Größe – so passt `groesseAendern` den behaltenen Viewport ohne Sprung an.
  const [groesse, setGroesse] = useState<Groesse>(props.anfangsGroesse ?? RUECKFALL_GROESSE);
  const [zeiger, setZeiger] = useState<{ punkt: Punkt; ziel: Fangziel } | null>(null);
  const [vorschau, setVorschau] = useState<Oeffnungsvorschau | null>(null);
  const [wandvorschau, setWandvorschau] = useState<Wandvorschau | null>(null);
  // Aufgeklappte Gerätegruppe im Grundriss (reine Darstellung, Phase 5).
  const [offeneGruppe, setOffeneGruppe] = useState<string | null>(null);
  const ziehen = useRef<Ziehen>(null);
  // Zeiger, der während einer Ziehbewegung eingefangen ist - damit Escape
  // und Abbruch ihn sicher wieder freigeben.
  const eingefangen = useRef<{ element: Element; pointerId: number } | null>(null);
  // Ein Druck, der eine Öffnung gegriffen hat, darf danach keinen Klick
  // (neue Öffnung) mehr auslösen.
  const klickVerbraucht = useRef(false);
  const groesseRef = useRef(groesse);
  const { onGroesse } = props;

  // Größe beobachten: Der Maßstab bleibt, die Mitte bleibt - kein Springen.
  useEffect(() => {
    const element = huelle.current;
    if (element === null) return undefined;
    const messen = () => {
      const rechteck = element.getBoundingClientRect();
      const neu =
        rechteck.width > 0 && rechteck.height > 0
          ? { breite: rechteck.width, hoehe: rechteck.height }
          : RUECKFALL_GROESSE;
      const alt = groesseRef.current;
      if (alt.breite === neu.breite && alt.hoehe === neu.hoehe) return;
      setViewport((v) => groesseAendern(v, alt, neu));
      groesseRef.current = neu;
      setGroesse(neu);
    };
    messen();
    onGroesse(groesseRef.current);
    if (typeof ResizeObserver === "undefined") return undefined;
    const beobachter = new ResizeObserver(() => {
      messen();
      onGroesse(groesseRef.current);
    });
    beobachter.observe(element);
    return () => beobachter.disconnect();
  }, [setViewport, onGroesse]);

  // Mausrad-Zoom um den Zeiger. Passiv registrierte Listener dürften das
  // Scrollen der Seite nicht verhindern - deshalb von Hand und nicht passiv.
  useEffect(() => {
    const svg = flaeche.current;
    if (svg === null) return undefined;
    const rad = (event: WheelEvent) => {
      event.preventDefault();
      const r = svg.getBoundingClientRect();
      const anker = { x: event.clientX - r.left, y: event.clientY - r.top };
      const faktor = Math.exp(-event.deltaY * 0.0015);
      setViewport((v) => zoomen(v, faktor, anker));
    };
    svg.addEventListener("wheel", rad, { passive: false });
    return () => svg.removeEventListener("wheel", rad);
  }, [setViewport]);

  const endpunkte = useMemo(() => raeume.flatMap((r) => ecken(r.walls)), [raeume]);

  const einfangen = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    eingefangen.current = { element: event.currentTarget, pointerId: event.pointerId };
  };
  const freigeben = () => {
    const e = eingefangen.current;
    eingefangen.current = null;
    if (e !== null && e.element.hasPointerCapture?.(e.pointerId)) e.element.releasePointerCapture?.(e.pointerId);
  };

  // Escape (oder ein anderer Abbruch) beendet die Ziehbewegung im Reducer.
  // Dann auch hier: Zeiger freigeben, laufende Bewegung und Vorschau vergessen.
  useEffect(() => {
    const laufend = ziehen.current;
    if (zustand.ziehenAb !== null || laufend === null || laufend.art === "pan" || laufend.art === "zusatz") return;
    ziehen.current = null;
    freigeben();
    setVorschau(null);
  }, [zustand.ziehenAb]);

  const bildpunkt = (event: ReactPointerEvent | ReactMouseEvent): Bildpunkt => {
    const r = flaeche.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
  };

  const gefangen = (welt: Punkt, altKey: boolean, ohne?: Punkt) =>
    fangen(welt, {
      aktiv: fangAktiv,
      ausgesetzt: altKey,
      rasterMm,
      massstab: viewport.massstab,
      endpunkte:
        ohne === undefined
          ? [...endpunkte, ...zustand.zeichnung.slice(0, 1)]
          : endpunkte.filter((p) => p.x !== ohne.x || p.y !== ohne.y),
    });

  const aktiverRaum = zustand.entwurf?.roomId ?? null;
  const aktiveDarstellung = raeume.find((raum) => raum.aktiv);

  const fangMm = (altKey: boolean) => (fangAktiv && !altKey ? OEFFNUNG_FANG_MM : 1);

  /** Die Wand der angeklickten Raumseite - für Tür, Fenster, Durchgang. */
  const raumwand = (welt: Punkt) =>
    raumwandUnterZeiger(props.topologie, welt, WANDRADIUS_PX / viewport.massstab, raeume, aktiverRaum);

  const wandvorschauFuer = (welt: Punkt): Wandvorschau | null => {
    const e = raumwand(welt);
    if (e === null) return null;
    if (!e.ok) return { wandId: null, text: e.grund, ok: false };
    const raum = raeume.find((r) => r.id === e.treffer.raumId);
    const nummer = (raum?.walls.findIndex((w) => w.id === e.treffer.wandId) ?? -1) + 1;
    return {
      wandId: e.treffer.wandId,
      ok: true,
      text: `Wand ${nummer} von „${props.raumName(e.treffer.raumId)}“ – Klick öffnet die Wandansicht (${props.oeffnungsart === "geraet" ? "Gerät" : OEFFNUNGSART_LABEL[props.oeffnungsart]} setzen)`,
    };
  };

  /** Beginnt das Verschieben einer Öffnung des aktiven Raums. */
  const oeffnungGreifen = (event: ReactPointerEvent<SVGSVGElement>, wandId: string, oeffnungId: string) => {
    const entwurf = zustand.entwurf;
    const o = entwurf?.walls.find((w) => w.id === wandId)?.openings.find((x) => x.id === oeffnungId);
    if (entwurf === null || o === undefined) return;
    const e = props.einordnung.get(oeffnungId);
    ziehen.current = {
      art: "oeffnung",
      wandId,
      oeffnungId,
      ab: entwurf,
      breiteMm: o.width_mm,
      startText: verbindungsText(e, props.raumName),
      startKlasse: `${e?.klasse ?? ""}|${e?.nachbarRaumId ?? ""}`,
      letzte: null,
    };
    dispatch({ typ: "ziehen-beginnen" });
    einfangen(event);
  };

  const druecken = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bild = bildpunkt(event);
    if (event.button === 1 || (event.button === 0 && zustand.werkzeug === "pan")) {
      event.preventDefault();
      ziehen.current = { art: "pan", start: bild, viewport };
      einfangen(event);
      return;
    }
    if (event.button !== 0) return;
    klickVerbraucht.current = false;
    // Leitungsebene zuerst: Sie entscheidet selbst, ob sie den Druck übernimmt.
    if (props.zusatz?.druecken({ welt: bildZuWelt(viewport, bild), ziel: event.target as Element, altKey: event.altKey, massstab: viewport.massstab }) === true) {
      klickVerbraucht.current = true;
      ziehen.current = { art: "zusatz" };
      einfangen(event);
      return;
    }
    // Gerätegruppe auf- oder zuklappen - wählt nichts und ändert nichts.
    const gruppe = (event.target as Element | null)?.closest?.("[data-geraetegruppe]");
    if (gruppe instanceof SVGElement && gruppe.dataset.geraetegruppe !== undefined) {
      klickVerbraucht.current = true;
      const schluessel = gruppe.dataset.geraetegruppe;
      setOffeneGruppe((offen) => (offen === schluessel ? null : schluessel));
      return;
    }
    const daten = datensatz(event.target);
    const raumId = daten?.raum;

    // Ein Gerät (Phase 5) wählen - in jedem Werkzeug außer „Verschieben“.
    // Verschoben wird es in seiner Wand- oder Deckenansicht, nicht von oben.
    if (raumId !== undefined && daten?.geraet !== undefined) {
      klickVerbraucht.current = true;
      setVorschau(null);
      setWandvorschau(null);
      props.onWaehlen({ art: "geraet", raumId, geraetId: daten.geraet });
      return;
    }

    // Eine vorhandene Öffnung greifen - im Auswahl- und im Öffnungswerkzeug.
    // Die (auch abgeleitete) Darstellung trägt immer die Eigentümerwand: Ein
    // Klick wählt also stets die eine gespeicherte Öffnung.
    // Werkzeug Tür/Fenster/Durchgang: Eine vorhandene Öffnung wird in ihrer
    // Wandansicht bearbeitet - nicht von oben verschoben.
    if (zustand.werkzeug === "oeffnung" && raumId !== undefined && daten?.oeffnung !== undefined && daten.wand !== undefined) {
      klickVerbraucht.current = true;
      setWandvorschau(null);
      props.onOeffnungBearbeiten(raumId, daten.wand, daten.oeffnung);
      return;
    }
    if (zustand.werkzeug === "auswahl" && raumId !== undefined && daten?.oeffnung !== undefined && daten.wand !== undefined) {
      klickVerbraucht.current = true;
      setVorschau(null);
      props.onWaehlen({ art: "oeffnung", raumId, wandId: daten.wand, oeffnungId: daten.oeffnung });
      if (darfSchreiben && raumId === aktiverRaum) oeffnungGreifen(event, daten.wand, daten.oeffnung);
      return;
    }

    switch (zustand.werkzeug) {
      case "auswahl": {
        if (raumId === undefined || daten === null) {
          props.onWaehlen(null);
          return;
        }
        if (daten.ecke !== undefined) {
          const [x, y] = daten.ecke.split(",").map(Number) as [number, number];
          const punkt = { x, y };
          props.onWaehlen({ art: "ecke", raumId, punkt });
          if (darfSchreiben && raumId === aktiverRaum && zustand.entwurf !== null) {
            ziehen.current = { art: "ecke", punkt, ab: zustand.entwurf, raumId };
            dispatch({ typ: "ziehen-beginnen" });
            einfangen(event);
          }
          return;
        }
        if (daten.wand !== undefined) {
          props.onWaehlen({ art: "wand", raumId, wandId: daten.wand });
          return;
        }
        props.onWaehlen({ art: "raum", raumId });
        return;
      }
      case "rechteck":
      case "polygon":
      case "oeffnung":
      case "pan":
        // Zeichenwerkzeuge reagieren erst auf den abgeschlossenen Klick
        // (siehe ``klicken``): Öffnet ein Punkt einen Dialog, darf der Rest
        // desselben Klicks nicht im Dialog landen.
        return;
    }
  };

  const klicken = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !darfSchreiben) return;
    const welt = bildZuWelt(viewport, bildpunkt(event));
    switch (zustand.werkzeug) {
      case "rechteck": {
        const p = gefangen(welt, event.altKey).punkt;
        const erster = zustand.zeichnung[0];
        if (erster === undefined) {
          dispatch({ typ: "zeichnung", punkte: [p] });
        } else {
          dispatch({ typ: "zeichnung", punkte: [] });
          props.onRechteckFertig(erster, p);
        }
        return;
      }
      case "polygon": {
        const p = gefangen(welt, event.altKey).punkt;
        if (schliesstPolygon(zustand.zeichnung, p)) {
          dispatch({ typ: "zeichnung", punkte: [] });
          props.onPolygonFertig(zustand.zeichnung);
        } else {
          dispatch({ typ: "zeichnung", punkte: punktAnhaengen(zustand.zeichnung, p) });
        }
        return;
      }
      case "oeffnung": {
        if (klickVerbraucht.current) {
          klickVerbraucht.current = false;
          return;
        }
        // Nur die Wand wählen - gesetzt wird in der Wandansicht (Phase 4f).
        const e = raumwand(welt);
        if (e === null) {
          if (props.onFlaechenklick?.(welt) === true) return;
          props.onHinweis("Auf eine Wand klicken - die Wandansicht öffnet sich zum Setzen.");
          return;
        }
        if (!e.ok) {
          props.onHinweis(e.grund);
          return;
        }
        props.onHinweis(null);
        setWandvorschau(null);
        props.onWandFuerOeffnung(e.treffer.raumId, e.treffer.wandId);
        return;
      }
      default:
        return;
    }
  };

  const bewegen = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bild = bildpunkt(event);
    const welt = bildZuWelt(viewport, bild);
    const laufend = ziehen.current;
    if (laufend?.art === "pan") {
      setViewport(verschieben(laufend.viewport, bild.x - laufend.start.x, bild.y - laufend.start.y));
      return;
    }
    if (props.zusatz !== undefined && (laufend === null || laufend.art === "zusatz")) {
      const ereignis = { welt, ziel: event.target as Element, altKey: event.altKey, massstab: viewport.massstab };
      if (props.zusatz.bewegen(ereignis, laufend !== null) || laufend !== null) {
        setZeiger({ punkt: aufMillimeter(welt), ziel: "frei" });
        return;
      }
    }
    if (laufend?.art === "ecke") {
      const ziel = gefangen(welt, event.altKey, laufend.punkt);
      setZeiger(ziel);
      dispatch({ typ: "ziehen-vorschau", entwurf: eckeVerschieben(laufend.ab, laufend.punkt, ziel.punkt) });
      return;
    }
    if (laufend?.art === "oeffnung") {
      setZeiger({ punkt: aufMillimeter(welt), ziel: "frei" });
      // Nur entlang der eigenen Wand: Die Zeigerposition wird auf sie projiziert.
      const teilung = props.topologie.teilung.get(laufend.wandId);
      if (teilung === undefined) return;
      const platzierung = platzierungBerechnen(teilung, welt, {
        breiteMm: laufend.breiteMm,
        fangMm: fangMm(event.altKey),
        ohneOeffnungId: laufend.oeffnungId,
        laengeText: masse.anzeigen,
        raumName: props.raumName,
      });
      const art =
        laufend.ab.walls.find((w) => w.id === laufend.wandId)?.openings.find((o) => o.id === laufend.oeffnungId)?.kind ??
        "door";
      setVorschau({ platzierung, art, text: platzierungsText(platzierung, art, props.raumName, masse.anzeigen) });
      if (!platzierung.ok) return; // Kollision oder Grenze: die letzte gültige Lage bleibt.
      laufend.letzte = platzierung;
      dispatch({
        typ: "ziehen-vorschau",
        entwurf: oeffnungAendern(laufend.ab, laufend.wandId, laufend.oeffnungId, { offset_mm: platzierung.offsetMm }),
      });
      return;
    }
    if (zustand.werkzeug === "oeffnung" && darfSchreiben) setWandvorschau(wandvorschauFuer(welt));
    else if (wandvorschau !== null) setWandvorschau(null);
    setZeiger(gefangen(welt, event.altKey));
  };

  const loslassen = () => {
    const laufend = ziehen.current;
    ziehen.current = null;
    freigeben();
    if (laufend === null || laufend.art === "pan") return;
    if (laufend.art === "zusatz") {
      props.zusatz?.loslassen();
      return;
    }
    if (laufend.art === "ecke" && zeiger !== null) {
      props.onWaehlen({ art: "ecke", raumId: laufend.raumId, punkt: zeiger.punkt });
    }
    if (laufend.art === "oeffnung") {
      setVorschau(null);
      // Wechsel zwischen gemeinsamem und nicht geteiltem Wandstück: klar sagen.
      const nachher = laufend.letzte;
      if (nachher !== null && nachher.ok && `${nachher.klasse}|${nachher.nachbarRaumId ?? ""}` !== laufend.startKlasse) {
        const jetzt =
          nachher.klasse === "gemeinsam"
            ? `Sie verbindet jetzt „${props.raumName(nachher.raumId)}“ und „${props.raumName(nachher.nachbarRaumId ?? "")}“.`
            : "Sie liegt jetzt an einer nicht geteilten Wand und verbindet keine zwei Räume mehr.";
        props.onHinweis(`Öffnung verschoben. ${jetzt} Vorher: ${laufend.startText}.`);
      }
    }
    dispatch({ typ: "ziehen-beenden" });
  };

  /** Abbruch durch das System (Touch, verlorener Zeiger): Entwurf zurücksetzen. */
  const abbrechen = () => {
    const laufend = ziehen.current;
    if (laufend === null) return;
    ziehen.current = null;
    freigeben();
    setVorschau(null);
    if (laufend.art === "zusatz") {
      props.zusatz?.abbrechen();
      return;
    }
    if (laufend.art !== "pan") dispatch({ typ: "ziehen-abbrechen" });
  };

  const doppelklickGeraet = (event: { target: EventTarget | null }): boolean => {
    const daten = datensatz(event.target);
    if (daten?.geraet === undefined || daten.raum === undefined) return false;
    props.onGeraetBearbeiten?.(daten.raum, daten.geraet);
    return true;
  };

  const doppelklick = (event: ReactMouseEvent<SVGSVGElement>) => {
    // Ein aktives Leitungswerkzeug verarbeitet jeden Klick selbst - kein Ansichtswechsel nebenbei;
    // ein Doppelklick schließt dort offen ab (Phase 6c, L2).
    if (props.zusatz?.cursor != null) {
      props.zusatz.doppelklick?.();
      return;
    }
    if (doppelklickGeraet(event)) return;
    const daten = datensatz(event.target);
    if (zustand.werkzeug === "auswahl" && daten?.raum !== undefined && daten.oeffnung !== undefined && daten.wand !== undefined) {
      props.onOeffnungBearbeiten(daten.raum, daten.wand, daten.oeffnung);
      return;
    }
    if (zustand.werkzeug === "polygon" && zustand.zeichnung.length >= 3) {
      props.onPolygonFertig(zustand.zeichnung);
      dispatch({ typ: "zeichnung", punkte: [] });
    }
  };

  const cursor =
    zustand.werkzeug === "pan"
      ? "grab"
      : zustand.werkzeug === "auswahl"
        ? "default"
        : "crosshair";

  return (
    <div
      className="relative h-full touch-none overflow-hidden rounded-ep border border-line bg-canvas"
      ref={huelle}
    >
      <svg
        ref={flaeche}
        className="grundriss__svg"
        role="application"
        aria-label={`Grundriss ${props.geschossLabel}`}
        width={groesse.breite}
        height={groesse.hoehe}
        style={{ cursor: props.zusatz?.cursor ?? cursor }}
        onPointerDown={druecken}
        onPointerMove={bewegen}
        onPointerUp={loslassen}
        onPointerCancel={abbrechen}
        onLostPointerCapture={() => {
          // Nur ein unerwarteter Verlust bricht ab - `loslassen` hat bereits freigegeben.
          if (eingefangen.current !== null) abbrechen();
        }}
        onPointerLeave={() => {
          setZeiger(null);
          setWandvorschau(null);
          if (ziehen.current === null) setVorschau(null);
        }}
        onClick={klicken}
        onDoubleClick={doppelklick}
        onContextMenu={(event) => event.preventDefault()}
      >
        <Raster viewport={viewport} groesse={groesse} rasterMm={rasterMm} />
        <g transform={transformation(viewport)}>
          {raeume.map((raum) => (
            <RaumGrafik
              key={raum.id}
              raum={raum}
              auswahl={zustand.auswahl}
              fehlerKeys={raum.aktiv ? props.fehlerKeys : LEER}
              lokaleKeys={raum.aktiv ? props.lokaleKeys : LEER}
            />
          ))}
          <Zuordnungsebene topologie={props.topologie} />
          <Oeffnungsebene
            topologie={props.topologie}
            einordnung={props.einordnung}
            aktiverRaum={aktiverRaum}
            auswahl={zustand.auswahl}
            fehlerKeys={props.fehlerKeys}
            lokaleKeys={props.lokaleKeys}
            raumName={props.raumName}
          />
        </g>
        <Beschriftungen raeume={raeume} viewport={viewport} />
        <Geraeteebene geraete={props.geraete ?? []} viewport={viewport} auswahl={zustand.auswahl} offeneGruppe={offeneGruppe} />
        {darfSchreiben && aktiveDarstellung !== undefined && (
          <Eckgriffe raum={aktiveDarstellung} viewport={viewport} auswahl={zustand.auswahl} />
        )}
        {props.zusatz?.zeichnen((x, y) => weltZuBild(viewport, { x, y }))}
        <Vorschau zustand={zustand} zeiger={zeiger} viewport={viewport} />
        {vorschau !== null && <Oeffnungsvorschaubild vorschau={vorschau} topologie={props.topologie} viewport={viewport} />}
        {wandvorschau !== null && <Wandvorschaubild vorschau={wandvorschau} topologie={props.topologie} viewport={viewport} />}
      </svg>
      <p
        className="absolute inset-x-0 bottom-0 m-0 flex justify-between gap-3 border-t border-line bg-page px-2 py-[3px] text-[0.78rem] text-muted"
        aria-live="off"
      >
        <span>{props.geschossLabel}</span>
        <span>
          {zeiger === null
            ? "—"
            : `X ${masse.anzeigen(zeiger.punkt.x)} · Y ${masse.anzeigen(zeiger.punkt.y)}${
                zeiger.ziel === "endpunkt" ? " · Fang: Eckpunkt" : zeiger.ziel === "raster" ? ` · Fang: Raster ${masse.anzeigen(rasterMm)}` : ""
              }`}
        </span>
        <span>Maßstab {Math.round(viewport.massstab * 1000)} px/m</span>
      </p>
    </div>
  );
}

const LEER: ReadonlySet<string> = new Set();

// ------------------------------------------------------------------- Raster

const Raster = memo(function Raster({
  viewport,
  groesse,
  rasterMm,
}: {
  viewport: Viewport;
  groesse: Groesse;
  rasterMm: number;
}) {
  // Das angezeigte Raster wird bei kleinem Maßstab gröber, damit es lesbar
  // bleibt. Der Fang bleibt dabei auf dem eingestellten Raster.
  let schritt = rasterMm;
  while (schritt * viewport.massstab < 8) schritt *= schritt % 250 === 0 ? 2 : 5;
  const g = sichtbareGrenzen(viewport, groesse);
  const teile: string[] = [];
  const haupt: string[] = [];
  for (let x = Math.ceil(g.minX / schritt) * schritt; x <= g.maxX; x += schritt) {
    const b = weltZuBild(viewport, { x, y: 0 }).x;
    (x % (schritt * 10) === 0 ? haupt : teile).push(`M${b.toFixed(1)} 0V${groesse.hoehe}`);
  }
  for (let y = Math.ceil(g.minY / schritt) * schritt; y <= g.maxY; y += schritt) {
    const b = weltZuBild(viewport, { x: 0, y }).y;
    (y % (schritt * 10) === 0 ? haupt : teile).push(`M0 ${b.toFixed(1)}H${groesse.breite}`);
  }
  return (
    <g aria-hidden="true">
      <path d={teile.join("")} className="grundriss__raster" />
      <path d={haupt.join("")} className="grundriss__raster grundriss__raster--haupt" />
    </g>
  );
});

// --------------------------------------------------------------- Raumgrafik

const RaumGrafik = memo(function RaumGrafik({
  raum,
  auswahl,
  fehlerKeys,
  lokaleKeys,
}: {
  raum: Raumdarstellung;
  auswahl: Auswahl;
  fehlerKeys: ReadonlySet<string>;
  lokaleKeys: ReadonlySet<string>;
}) {
  const ausgewaehlt = auswahl !== null && auswahl.raumId === raum.id;
  const punkte = raum.walls.map((w) => `${w.x1_mm},${w.y1_mm}`).join(" ");
  const klassen = ["grundriss__raum"];
  if (raum.aktiv) klassen.push("grundriss__raum--aktiv");
  if (ausgewaehlt) klassen.push("grundriss__raum--ausgewaehlt");
  return (
    <g className={klassen.join(" ")} data-testid={`raum-${raum.id}`}>
      {raum.walls.length >= 3 && (
        <polygon points={punkte} className="grundriss__raumflaeche" data-raum={raum.id} />
      )}
      {raum.walls.map((w) => {
        const wandAusgewaehlt = auswahl?.art === "wand" && auswahl.wandId === w.id;
        const k = ["grundriss__wand"];
        if (wandAusgewaehlt) k.push("grundriss__wand--ausgewaehlt");
        if (fehlerKeys.has(w.id)) k.push("grundriss__wand--fehler");
        else if (lokaleKeys.has(w.id)) k.push("grundriss__wand--warnung");
        return (
          <g key={w.id}>
            <line
              x1={w.x1_mm}
              y1={w.y1_mm}
              x2={w.x2_mm}
              y2={w.y2_mm}
              className={k.join(" ")}
              strokeWidth={w.thickness_mm}
            />
            <line
              x1={w.x1_mm}
              y1={w.y1_mm}
              x2={w.x2_mm}
              y2={w.y2_mm}
              className="grundriss__treffer"
              data-raum={raum.id}
              data-wand={w.id}
              data-testid={`wand-${w.id}`}
            />
          </g>
        );
      })}
    </g>
  );
});

/** Anfangs- und Endpunkt eines Bereichs `[offset, offset + breite]` auf einer Wand. */
function bereichAufWand(wand: EditorWand, offsetMm: number, breiteMm: number): [Punkt, Punkt] {
  const laenge = Math.hypot(wand.ende.x - wand.start.x, wand.ende.y - wand.start.y) || 1;
  const ux = (wand.ende.x - wand.start.x) / laenge;
  const uy = (wand.ende.y - wand.start.y) / laenge;
  const e = offsetMm + breiteMm;
  return [
    { x: wand.start.x + ux * offsetMm, y: wand.start.y + uy * offsetMm },
    { x: wand.start.x + ux * e, y: wand.start.y + uy * e },
  ];
}

/**
 * Wandzuordnung im Grundriss (Phase 6a, ADR 0024): Jeder Abschnitt, auf dem
 * Wände zweier Räume liegen, zeigt seinen Zustand - getrennte Wände mit einer
 * Fuge auf der Achse, offene Zuordnungen fein gestrichelt, mehrdeutige in der
 * Warnfarbe. Gemeinsame Bauwände bleiben ohne Zusatz. Reine Darstellung.
 */
const Zuordnungsebene = memo(function Zuordnungsebene({ topologie }: { topologie: EditorTopologie }) {
  const linien = topologie.abschnitte
    .filter((a) => a.lage === "gemeinsam" && a.zuordnung !== "shared")
    .map((a) => {
      const art = a.mehrdeutig ? "mehrdeutig" : a.zuordnung === "separate" ? "getrennt" : "offen";
      return (
        <line
          key={a.id}
          x1={a.start.x}
          y1={a.start.y}
          x2={a.ende.x}
          y2={a.ende.y}
          className={`grundriss__abschnitt grundriss__abschnitt--${art}`}
          data-testid={`abschnitt-${art}`}
        />
      );
    });
  return <g className="grundriss__zuordnungen" aria-hidden="true">{linien}</g>;
});

/**
 * Alle gespeicherten Öffnungen des Geschosses - in **einer** Ebene über allen
 * Wänden (Phase 4b.2). Jede Öffnung wird genau einmal gezeichnet, an ihrer
 * Eigentümerwand. Liegt sie auf einer gemeinsamen Wand, ist sie damit auch
 * auf der Seite des Nachbarraums sichtbar, ohne zweiten Datensatz und ohne
 * doppelte Linien. Ist der Nachbarraum aktiv, erscheint sie als abgeleitet
 * (gestrichelt); ein Klick wählt immer die eine gespeicherte Öffnung.
 */
const Oeffnungsebene = memo(function Oeffnungsebene({
  topologie,
  einordnung,
  aktiverRaum,
  auswahl,
  fehlerKeys,
  lokaleKeys,
  raumName,
}: {
  topologie: EditorTopologie;
  einordnung: EditorEinordnung;
  aktiverRaum: string | null;
  auswahl: Auswahl;
  fehlerKeys: ReadonlySet<string>;
  lokaleKeys: ReadonlySet<string>;
  raumName: (raumId: string) => string;
}) {
  const elemente: ReactNode[] = [];
  for (const teilung of topologie.teilung.values()) {
    const wand = teilung.wand;
    for (const o of wand.oeffnungen) {
      const e = einordnung.get(o.oeffnungId);
      const [p1, p2] = bereichAufWand(wand, o.offsetMm, o.breiteMm);
      // Die Lücke deckt die stärkste Wand des Abschnitts ab - auch die des Nachbarn.
      const staerke = Math.max(
        wand.staerkeMm,
        ...(e?.abschnitte ?? []).flatMap((a) => a.quellen.map((q) => q.wand.staerkeMm)),
      );
      const abgeleitet = aktiverRaum !== null && e?.nachbarRaumId === aktiverRaum;
      const k = ["grundriss__oeffnung", OEFFNUNG_KLASSE[o.art]];
      if (e?.klasse === "gemeinsam") k.push("grundriss__oeffnung--gemeinsam");
      if (e?.klasse === "konflikt" || (e?.dubletten.length ?? 0) > 0) k.push("grundriss__oeffnung--konflikt");
      if (abgeleitet) k.push("grundriss__oeffnung--abgeleitet");
      if (auswahl?.art === "oeffnung" && auswahl.oeffnungId === o.oeffnungId) k.push("grundriss__oeffnung--ausgewaehlt");
      if (fehlerKeys.has(o.oeffnungId)) k.push("grundriss__oeffnung--fehler");
      else if (lokaleKeys.has(o.oeffnungId)) k.push("grundriss__oeffnung--warnung");
      const titel =
        `${OEFFNUNGSART_LABEL[o.art]} · ${verbindungsText(e, raumName)} · gespeichert an einer Wand von „${raumName(wand.raumId)}“` +
        (abgeleitet ? " · abgeleitete Darstellung: Auswahl führt zur gespeicherten Öffnung" : "");
      elemente.push(
        <g key={o.oeffnungId} className={k.join(" ")}>
          <title>{titel}</title>
          <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="grundriss__oeffnung-luecke" strokeWidth={staerke + 30} />
          <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="grundriss__oeffnung-symbol" />
          <line
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            className="grundriss__treffer grundriss__treffer--oeffnung"
            data-raum={wand.raumId}
            data-wand={wand.id}
            data-oeffnung={o.oeffnungId}
            data-abgeleitet={abgeleitet ? "ja" : undefined}
            data-testid={`oeffnung-${o.oeffnungId}`}
          />
        </g>,
      );
    }
  }
  return <g className="grundriss__oeffnungen">{elemente}</g>;
});

/**
 * Vorschau beim Platzieren oder Verschieben einer Öffnung - im Bildraum,
 * mit der abgeleiteten Raumverbindung oder dem Grund, warum es hier nicht geht.
 */
function Oeffnungsvorschaubild({
  vorschau,
  topologie,
  viewport,
}: {
  vorschau: Oeffnungsvorschau;
  topologie: EditorTopologie;
  viewport: Viewport;
}) {
  const { platzierung } = vorschau;
  const wand = topologie.teilung.get(platzierung.wandId)?.wand;
  if (wand === undefined) return null;
  const offset = platzierung.offsetMm;
  const [a, b] =
    offset === null
      ? [wand.start, wand.ende]
      : bereichAufWand(wand, offset, platzierung.breiteMm);
  const p1 = weltZuBild(viewport, a);
  const p2 = weltZuBild(viewport, b);
  const klasse = platzierung.ok ? "grundriss__oeffnungsvorschau" : "grundriss__oeffnungsvorschau grundriss__oeffnungsvorschau--fehler";
  const breitePx = Math.max(6, wand.staerkeMm * viewport.massstab + 4);
  return (
    <g className={klasse} data-testid="oeffnungsvorschau" aria-hidden="true">
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} strokeWidth={breitePx} className="grundriss__oeffnungsvorschau-flaeche" />
      <text x={(p1.x + p2.x) / 2} y={Math.min(p1.y, p2.y) - breitePx / 2 - 8} textAnchor="middle" className="grundriss__oeffnungsvorschau-text">
        {vorschau.text}
      </text>
    </g>
  );
}


/** Hervorhebung der ganzen Wand der angeklickten Raumseite samt Erklärung. */
function Wandvorschaubild({
  vorschau,
  topologie,
  viewport,
}: {
  vorschau: Wandvorschau;
  topologie: EditorTopologie;
  viewport: Viewport;
}) {
  const wand = vorschau.wandId === null ? undefined : topologie.teilung.get(vorschau.wandId)?.wand;
  const p1 = wand === undefined ? null : weltZuBild(viewport, wand.start);
  const p2 = wand === undefined ? null : weltZuBild(viewport, wand.ende);
  const breitePx = wand === undefined ? 0 : Math.max(6, wand.staerkeMm * viewport.massstab + 4);
  return (
    <g className={vorschau.ok ? "grundriss__oeffnungsvorschau" : "grundriss__oeffnungsvorschau grundriss__oeffnungsvorschau--fehler"} data-testid="wandvorschau" aria-hidden="true">
      {p1 !== null && p2 !== null && (
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} strokeWidth={breitePx} className="grundriss__oeffnungsvorschau-flaeche" />
      )}
      <text x={12} y={22} className="grundriss__oeffnungsvorschau-text">
        {vorschau.text}
      </text>
    </g>
  );
}

// ----------------------------------------------------------------- Eckgriffe

/** Griffe an den Eckpunkten des aktiven Raums - im Bildraum, also immer greifbar groß. */
const Eckgriffe = memo(function Eckgriffe({
  raum,
  viewport,
  auswahl,
}: {
  raum: Raumdarstellung;
  viewport: Viewport;
  auswahl: Auswahl;
}) {
  const masse = useMasse();
  return (
    <g>
      {ecken(raum.walls).map((p) => {
        const b = weltZuBild(viewport, p);
        const gewaehlt =
          auswahl?.art === "ecke" && auswahl.punkt.x === p.x && auswahl.punkt.y === p.y;
        return (
          <rect
            key={`${p.x},${p.y}`}
            x={b.x - 6}
            y={b.y - 6}
            width={12}
            height={12}
            className={gewaehlt ? "grundriss__ecke grundriss__ecke--ausgewaehlt" : "grundriss__ecke"}
            data-raum={raum.id}
            data-ecke={`${p.x},${p.y}`}
            data-testid={`ecke-${p.x},${p.y}`}
          >
            <title>{`Eckpunkt ${masse.punkt(p.x, p.y)}`}</title>
          </rect>
        );
      })}
    </g>
  );
});

// ---------------------------------------------------------- Beschriftungen

/**
 * Maßtexte im **Bildraum**: Sie bleiben bei jedem Zoom gleich groß und scharf
 * und sind nicht Teil der Geometrie. Zu kurze Wände bleiben unbeschriftet,
 * damit sich Texte nicht überlagern.
 */
const Beschriftungen = memo(function Beschriftungen({
  raeume,
  viewport,
}: {
  raeume: readonly Raumdarstellung[];
  viewport: Viewport;
}) {
  const masse = useMasse();
  return (
    <g className="grundriss__beschriftung" aria-hidden="true">
      {raeume.map((raum) => {
        const texte = raum.walls.map((w) => {
          const a = weltZuBild(viewport, start(w));
          const b = weltZuBild(viewport, ende(w));
          const bildlaenge = Math.hypot(b.x - a.x, b.y - a.y);
          if (bildlaenge < 56) return null;
          // Nach außen versetzt: links der Laufrichtung im Bild (Welt-y ist gespiegelt).
          const nx = (b.y - a.y) / bildlaenge;
          const ny = -(b.x - a.x) / bildlaenge;
          const x = (a.x + b.x) / 2 + nx * 14;
          const y = (a.y + b.y) / 2 + ny * 14;
          return (
            <text key={w.id} x={x} y={y} className="grundriss__mass" textAnchor="middle" dominantBaseline="middle">
              {masse.anzeigen(streckenlaenge(start(w), ende(w)))}
            </text>
          );
        });
        const pkt = raum.walls.map((w) => weltZuBild(viewport, start(w)));
        const mitte =
          pkt.length > 0
            ? { x: pkt.reduce((s, p) => s + p.x, 0) / pkt.length, y: pkt.reduce((s, p) => s + p.y, 0) / pkt.length }
            : null;
        return (
          <g key={raum.id}>
            {texte}
            {mitte !== null && (
              <text x={mitte.x} y={mitte.y} className="grundriss__raumname" textAnchor="middle">
                <tspan x={mitte.x} dy="-0.4em">
                  {raum.nummer !== null ? `${raum.nummer} ` : ""}
                  {raum.name}
                </tspan>
                <tspan x={mitte.x} dy="1.3em" className="grundriss__raumflaeche-text">
                  {raum.flaecheText}
                </tspan>
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});

// ------------------------------------------------------------------ Vorschau

function Vorschau({
  zustand,
  zeiger,
  viewport,
}: {
  zustand: EditorZustand;
  zeiger: { punkt: Punkt; ziel: Fangziel } | null;
  viewport: Viewport;
}) {
  const masse = useMasse();
  const bild = (p: Punkt) => weltZuBild(viewport, p);
  const elemente: ReactNode[] = [];
  if (zeiger !== null && zeiger.ziel === "endpunkt") {
    const p = bild(zeiger.punkt);
    elemente.push(<rect key="fang" x={p.x - 6} y={p.y - 6} width={12} height={12} className="grundriss__fangziel" />);
  } else if (zeiger !== null && zeiger.ziel === "raster" && zustand.werkzeug !== "auswahl") {
    const p = bild(zeiger.punkt);
    elemente.push(<circle key="fang" cx={p.x} cy={p.y} r={3} className="grundriss__fangziel" />);
  }

  const erster = zustand.zeichnung[0];
  if (zustand.werkzeug === "rechteck" && erster !== undefined && zeiger !== null) {
    const a = bild(erster);
    const b = bild(zeiger.punkt);
    const breite = Math.abs(zeiger.punkt.x - erster.x);
    const tiefe = Math.abs(zeiger.punkt.y - erster.y);
    elemente.push(
      <g key="rechteck">
        <rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          className="grundriss__vorschau"
        />
        <text x={(a.x + b.x) / 2} y={Math.min(a.y, b.y) - 8} textAnchor="middle" className="grundriss__mass">
          {masse.anzeigen(breite)} × {masse.anzeigen(tiefe)}
        </text>
      </g>,
    );
  }
  if (zustand.werkzeug === "polygon" && erster !== undefined) {
    const punkte = zeiger !== null ? [...zustand.zeichnung, zeiger.punkt] : [...zustand.zeichnung];
    const offen = punkte.slice(0, -1).map((p, i) => ({ key: `v${i}`, start: p, ende: punkte[i + 1] as Punkt }));
    const befunde = entwurfsBefunde(offen.filter((s) => s.start.x !== s.ende.x || s.start.y !== s.ende.y));
    // Unzulässige Überschneidungen sofort zeigen - verbindlich prüft der Server.
    const kaputt = befunde.some((b) => b.code === "walls-intersect" || b.code === "wall-backtracks");
    elemente.push(
      <polyline
        key="polygon"
        points={punkte.map((p) => `${bild(p).x},${bild(p).y}`).join(" ")}
        className={kaputt ? "grundriss__vorschau grundriss__vorschau--fehler" : "grundriss__vorschau"}
      />,
    );
    const s = bild(erster);
    elemente.push(<circle key="start" cx={s.x} cy={s.y} r={6} className="grundriss__startpunkt" />);
    const letzter = zustand.zeichnung[zustand.zeichnung.length - 1];
    if (zeiger !== null && letzter !== undefined) {
      const m = bild({ x: (letzter.x + zeiger.punkt.x) / 2, y: (letzter.y + zeiger.punkt.y) / 2 });
      elemente.push(
        <text key="laenge" x={m.x} y={m.y - 10} textAnchor="middle" className="grundriss__mass">
          {masse.anzeigen(streckenlaenge(letzter, zeiger.punkt))}
        </text>,
      );
    }
  }
  return <g aria-hidden="true">{elemente}</g>;
}


/**
 * Geräte im Grundriss (Phase 5) - im Bildraum: gleich groß in jeder Zoomstufe.
 * Wandgeräte stehen neben der Wand auf ihrer Montageseite (innen bzw. außen),
 * Deckengeräte an ihrer Lage. Würden sich Symbole decken, legt
 * {@link geraetelayout} fest, wo sie lesbar stehen: Ein versetztes Symbol
 * zeigt mit einer Zuordnungslinie auf seinen markierten Montagepunkt; dichte
 * Stellen werden zu einem Gruppensymbol (Klick klappt auf). Nur Darstellung -
 * gespeichert wird nichts davon. Verschoben wird ein Gerät in der Wand- bzw.
 * Deckenansicht; ein Doppelklick öffnet sie.
 */
const Geraeteebene = memo(function Geraeteebene({
  geraete,
  viewport,
  auswahl,
  offeneGruppe,
}: {
  geraete: readonly Geraetedarstellung[];
  viewport: Viewport;
  auswahl: Auswahl;
  offeneGruppe: string | null;
}) {
  const layout = useMemo(() => geraetelayout(geraete, viewport), [geraete, viewport]);
  if (geraete.length === 0) return null;
  const groesse = SYMBOLGROESSE;
  const nachId = new Map(geraete.map((g) => [g.id, g] as const));
  const gewaehlt = auswahl?.art === "geraet" ? auswahl.geraetId : null;
  // Aufgeklappt: die angeklickte Gruppe und immer die Gruppe des gewählten Geräts.
  const offen = layout.gruppen.filter((gr) => gr.schluessel === offeneGruppe || gr.mitglieder.some((m) => m.id === gewaehlt));
  const zu = layout.gruppen.filter((gr) => !offen.includes(gr));
  const sichtbar: Symbollage[] = [...layout.einzeln, ...offen.flatMap((gr) => gr.mitglieder)];
  const klassen = (g: Geraetedarstellung, basis: string) => {
    const k = [basis];
    if (!g.aktiv) k.push(`${basis}--ruhend`);
    if (g.fehler) k.push(`${basis}--fehler`);
    if (gewaehlt === g.id) k.push(`${basis}--ausgewaehlt`);
    return k.join(" ");
  };
  return (
    <g className="grundriss__geraete" data-testid="grundriss-geraete">
      {/* Zuordnung: Montagepunkt und Linie zum versetzten Symbol - unter allen Symbolen. */}
      {sichtbar.map((s) => {
        const g = nachId.get(s.id);
        if (g === undefined || !s.versetzt) return null;
        return (
          <g
            key={`z-${s.id}`}
            className={klassen(g, "grundriss__zuordnung")}
            data-testid={`grundriss-zuordnung-${s.id}`}
            data-montage={`${s.montage.x.toFixed(1)},${s.montage.y.toFixed(1)}`}
            data-symbol={`${s.symbol.x.toFixed(1)},${s.symbol.y.toFixed(1)}`}
          >
            <line x1={s.symbol.x} y1={s.symbol.y} x2={s.montage.x} y2={s.montage.y} className="grundriss__zuordnung-linie" />
            {g.decke ? (
              <circle cx={s.montage.x} cy={s.montage.y} r={3.5} className="grundriss__montagepunkt grundriss__montagepunkt--decke" />
            ) : (
              <rect x={s.montage.x - 3} y={s.montage.y - 3} width={6} height={6} className="grundriss__montagepunkt" />
            )}
          </g>
        );
      })}
      {zu.map((gr) => (
        <g key={`gz-${gr.schluessel}`} className="grundriss__zuordnung grundriss__zuordnung--gruppe" data-testid={`grundriss-gruppenzuordnung-${gr.schluessel}`}>
          {gr.mitglieder.map((m) => (
            <g key={m.id} data-montage={`${m.montage.x.toFixed(1)},${m.montage.y.toFixed(1)}`}>
              <line x1={gr.lage.x} y1={gr.lage.y} x2={m.montage.x} y2={m.montage.y} className="grundriss__zuordnung-linie" />
              {nachId.get(m.id)?.decke === true ? (
                <circle cx={m.montage.x} cy={m.montage.y} r={2.5} className="grundriss__montagepunkt grundriss__montagepunkt--decke" />
              ) : (
                <rect x={m.montage.x - 2} y={m.montage.y - 2} width={4} height={4} className="grundriss__montagepunkt" />
              )}
            </g>
          ))}
        </g>
      ))}
      {zu.map((gr) => {
        const titel = `${gr.mitglieder.length} Geräte an dieser Stelle - Klick: einzeln anzeigen und auswählen`;
        return (
          <g
            key={`g-${gr.schluessel}`}
            className="grundriss__geraetegruppe"
            data-geraetegruppe={gr.schluessel}
            data-testid={`grundriss-geraetegruppe-${gr.schluessel}`}
            role="button"
            aria-expanded={false}
            aria-label={titel}
          >
            <title>{titel}</title>
            <circle cx={gr.lage.x} cy={gr.lage.y} r={groesse / 2 + 4} className="grundriss__geraetegruppe-grund" />
            <text x={gr.lage.x} y={gr.lage.y} className="grundriss__geraetegruppe-anzahl" textAnchor="middle" dominantBaseline="central">
              {gr.mitglieder.length}
            </text>
          </g>
        );
      })}
      {sichtbar.map((s) => {
        const g = nachId.get(s.id);
        if (g === undefined) return null;
        const p = s.symbol;
        const titel = `${g.name}${g.fehler ? " - Lage prüfen" : ""}${s.versetzt ? " (Symbol versetzt, die Linie zeigt die Montagestelle)" : ""} - Doppelklick: in der ${g.decke ? "Deckenansicht" : "Wandansicht"} bearbeiten`;
        return (
          <g
            key={g.id}
            className={klassen(g, "grundriss__geraet")}
            data-raum={g.raumId}
            data-geraet={g.id}
            data-testid={`grundriss-geraet-${g.id}`}
            data-versetzt={s.versetzt ? "ja" : "nein"}
            aria-label={titel}
          >
            <title>{titel}</title>
            {g.decke ? (
              <circle cx={p.x} cy={p.y} r={groesse / 2 + 2} className="grundriss__geraet-grund" />
            ) : (
              <rect x={p.x - groesse / 2 - 2} y={p.y - groesse / 2 - 2} width={groesse + 4} height={groesse + 4} rx={3} className="grundriss__geraet-grund" />
            )}
            <SymbolImPlan typ={g.typ} x={p.x} y={p.y} groesse={groesse} />
            <rect x={p.x - 12} y={p.y - 12} width={24} height={24} className="grundriss__geraet-treffer" />
          </g>
        );
      })}
      {offen.map((gr) => {
        const titel = `Gruppe mit ${gr.mitglieder.length} Geräten zuklappen`;
        return (
          <g
            key={`gk-${gr.schluessel}`}
            className="grundriss__geraetegruppe grundriss__geraetegruppe--offen"
            data-geraetegruppe={gr.schluessel}
            data-testid={`grundriss-geraetegruppe-${gr.schluessel}`}
            role="button"
            aria-expanded={true}
            aria-label={titel}
          >
            <title>{titel}</title>
            <circle cx={gr.lage.x} cy={gr.lage.y} r={7} className="grundriss__geraetegruppe-grund" />
            <text x={gr.lage.x} y={gr.lage.y} className="grundriss__geraetegruppe-anzahl" textAnchor="middle" dominantBaseline="central">
              −
            </text>
          </g>
        );
      })}
    </g>
  );
});
