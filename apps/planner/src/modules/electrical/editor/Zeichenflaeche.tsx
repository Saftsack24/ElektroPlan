import { memo, useEffect, useMemo, useRef, useState } from "react";
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction,
} from "react";

import { useMasse } from "../../../core/ui/masseinheit";
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
  standardbreite,
  verbindungsText,
  wandUnterZeiger,
} from "./platzierung";
import type { Aktion, Auswahl, EditorZustand } from "./zustand";

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
  darfSchreiben: boolean;
  rasterMm: number;
  fangAktiv: boolean;
  fehlerKeys: ReadonlySet<string>;
  lokaleKeys: ReadonlySet<string>;
  onWaehlen: (auswahl: Auswahl) => void;
  onPolygonFertig: (punkte: readonly Punkt[]) => void;
  onRechteckFertig: (a: Punkt, b: Punkt) => void;
  /** Setzt eine neue Öffnung an einem bereits berechneten, gültigen Abstand. */
  onOeffnungSetzen: (raumId: string, wandId: string, offsetMm: number) => void;
  /** Kurzer Hinweis über der Zeichenfläche; `null` räumt ihn. */
  onHinweis: (text: string | null) => void;
  oeffnungsart: Oeffnungsart;
  geschossLabel: string;
  /** Gemeinsame Wandtopologie und abgeleitete Raumverbindungen (Phase 4b.2). */
  topologie: EditorTopologie;
  einordnung: EditorEinordnung;
  raumName: (raumId: string) => string;
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
  | null;

/** Vorschau einer Öffnung beim Platzieren oder Verschieben - reine Anzeige. */
interface Oeffnungsvorschau {
  readonly platzierung: Platzierung;
  readonly art: Oeffnungsart;
  readonly text: string;
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
  const [groesse, setGroesse] = useState<Groesse>(RUECKFALL_GROESSE);
  const [zeiger, setZeiger] = useState<{ punkt: Punkt; ziel: Fangziel } | null>(null);
  const [vorschau, setVorschau] = useState<Oeffnungsvorschau | null>(null);
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
    if (zustand.ziehenAb !== null || laufend === null || laufend.art === "pan") return;
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

  /** Platzierung einer neuen Öffnung an der Zeigerposition - oder `null` ohne Wand. */
  const neuePlatzierung = (welt: Punkt, altKey: boolean): Platzierung | null => {
    const treffer = wandUnterZeiger(props.topologie, welt, WANDRADIUS_PX / viewport.massstab, aktiverRaum);
    const teilung = treffer === null ? undefined : props.topologie.teilung.get(treffer.wandId);
    if (teilung === undefined) return null;
    return platzierungBerechnen(teilung, welt, {
      breiteMm: standardbreite(props.oeffnungsart),
      fangMm: fangMm(altKey),
      laengeText: masse.anzeigen,
      raumName: props.raumName,
    });
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
    const daten = datensatz(event.target);
    const raumId = daten?.raum;

    // Eine vorhandene Öffnung greifen - im Auswahl- und im Öffnungswerkzeug.
    // Die (auch abgeleitete) Darstellung trägt immer die Eigentümerwand: Ein
    // Klick wählt also stets die eine gespeicherte Öffnung.
    if (
      (zustand.werkzeug === "auswahl" || zustand.werkzeug === "oeffnung") &&
      raumId !== undefined &&
      daten?.oeffnung !== undefined &&
      daten.wand !== undefined
    ) {
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
        // Dieselbe Rechnung wie die Vorschau: Was angezeigt wird, wird gesetzt.
        const platzierung = neuePlatzierung(welt, event.altKey);
        if (platzierung === null) {
          props.onHinweis("Zum Setzen einer Öffnung auf eine Wand klicken.");
          return;
        }
        if (!platzierung.ok) {
          props.onHinweis(platzierung.grund);
          return;
        }
        props.onHinweis(null);
        props.onOeffnungSetzen(platzierung.raumId, platzierung.wandId, platzierung.offsetMm);
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
    if (zustand.werkzeug === "oeffnung" && darfSchreiben) {
      const platzierung = neuePlatzierung(welt, event.altKey);
      setVorschau(
        platzierung === null
          ? null
          : {
              platzierung,
              art: props.oeffnungsart,
              text: platzierungsText(platzierung, props.oeffnungsart, props.raumName, masse.anzeigen),
            },
      );
    }
    setZeiger(gefangen(welt, event.altKey));
  };

  const loslassen = () => {
    const laufend = ziehen.current;
    ziehen.current = null;
    freigeben();
    if (laufend === null || laufend.art === "pan") return;
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
    if (laufend.art !== "pan") dispatch({ typ: "ziehen-abbrechen" });
  };

  const doppelklick = () => {
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
    <div className="grundriss__flaeche" ref={huelle}>
      <svg
        ref={flaeche}
        className="grundriss__svg"
        role="application"
        aria-label={`Grundriss ${props.geschossLabel}`}
        width={groesse.breite}
        height={groesse.hoehe}
        style={{ cursor }}
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
        {darfSchreiben && aktiveDarstellung !== undefined && (
          <Eckgriffe raum={aktiveDarstellung} viewport={viewport} auswahl={zustand.auswahl} />
        )}
        <Vorschau zustand={zustand} zeiger={zeiger} viewport={viewport} />
        {vorschau !== null && <Oeffnungsvorschaubild vorschau={vorschau} topologie={props.topologie} viewport={viewport} />}
      </svg>
      <p className="grundriss__statuszeile" aria-live="off">
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
      const k = ["grundriss__oeffnung", `grundriss__oeffnung--${o.art}`];
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

