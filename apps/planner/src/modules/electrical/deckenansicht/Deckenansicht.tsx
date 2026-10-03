import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { Dialog } from "../../../core/ui/Dialog";
import { useMasse } from "../../../core/ui/masseinheit";
import { KNOPF_GRUND, eingabefeld, meldungsflaeche } from "../../../core/ui/stil";
import "../darstellung.css";
import "../wandansicht/wandansicht.css";
import type { EntwurfWand } from "../editor/entwurf";
import { RASTERGROESSEN_MM } from "../editor/fang";
import type { Bildpunkt, Groesse, Viewport } from "../editor/viewport";
import { bildZuWelt, einpassen, grenzenVon, groesseAendern, sichtbareGrenzen, verschieben, weltZuBild, zoomen } from "../editor/viewport";
import { ANSICHT_ZURUECKSETZEN } from "../texte";
import { flaecheText } from "../editor/Eigenschaften";
import { deckenmodell, imRaum, naechsteWand } from "./deckenmodell";

const WERKZEUG = `${KNOPF_GRUND} border-control bg-surface px-2.5 py-[5px] text-fg`;
const RUECKFALL: Groesse = { breite: 900, hoehe: 520 };

/**
 * Deckenansicht eines Raums (Phase 4f, ADR 0022) - Bediengrundlage für die
 * Geräteplatzierung in Phase 5. Zeigt die reale Raumkontur in der
 * Ausrichtung des Grundrisses (nicht gespiegelt), Wandnummern und -längen,
 * Fläche und Deckenhöhe, Raster, Zoom und Verschieben. Speichert nichts.
 */
export function Deckenansicht({
  raumName,
  walls,
  deckenhoeheMm,
  eigeneHoehe,
  rasterMm,
  onRaster,
  onSchliessen,
}: {
  raumName: string;
  walls: readonly EntwurfWand[];
  deckenhoeheMm: number;
  /** `true`: eigene Raumhöhe, `false`: geerbt vom Geschoss. */
  eigeneHoehe: boolean;
  rasterMm: number;
  onRaster: (mm: number) => void;
  onSchliessen: () => void;
}) {
  const masse = useMasse();
  const huelle = useRef<HTMLDivElement>(null);
  const flaeche = useRef<SVGSVGElement>(null);
  const [groesse, setGroesse] = useState<Groesse>(RUECKFALL);
  const groesseRef = useRef(groesse);
  const grenzen = useMemo(() => grenzenVon(walls.flatMap((w) => [{ x: w.x1_mm, y: w.y1_mm }, { x: w.x2_mm, y: w.y2_mm }])), [walls]);
  const [viewport, setViewport] = useState<Viewport>(() => einpassen(grenzen, RUECKFALL, 56));
  const [zeiger, setZeiger] = useState<string>("Zeiger über die Decke bewegen.");
  const ziehen = useRef<{ start: Bildpunkt; v: Viewport; pointerId: number; element: Element } | null>(null);
  // Beschriftung 14 px ins Rauminnere - in Millimetern des aktuellen Maßstabs.
  const modell = useMemo(() => deckenmodell(walls, 16 / viewport.massstab), [walls, viewport.massstab]);

  const zuruecksetzen = () => setViewport(einpassen(grenzen, groesseRef.current, 56));

  useEffect(() => {
    const element = huelle.current;
    if (element === null) return undefined;
    let erstesMal = true;
    const messen = () => {
      const r = element.getBoundingClientRect();
      const neu = r.width > 0 && r.height > 0 ? { breite: r.width, hoehe: r.height } : RUECKFALL;
      const alt = groesseRef.current;
      if (!erstesMal && alt.breite === neu.breite && alt.hoehe === neu.hoehe) return;
      groesseRef.current = neu;
      setGroesse(neu);
      setViewport((v) => (erstesMal ? einpassen(grenzen, neu, 56) : groesseAendern(v, alt, neu)));
      erstesMal = false;
    };
    messen();
    if (typeof ResizeObserver === "undefined") return undefined;
    const b = new ResizeObserver(messen);
    b.observe(element);
    return () => b.disconnect();
  }, [grenzen]);

  useEffect(() => {
    const svg = flaeche.current;
    if (svg === null) return undefined;
    const rad = (event: WheelEvent) => {
      event.preventDefault();
      const r = svg.getBoundingClientRect();
      setViewport((v) => zoomen(v, Math.exp(-event.deltaY * 0.0015), { x: event.clientX - r.left, y: event.clientY - r.top }));
    };
    svg.addEventListener("wheel", rad, { passive: false });
    return () => svg.removeEventListener("wheel", rad);
  }, []);

  const zoom = (f: number) => setViewport((v) => zoomen(v, f, { x: groesseRef.current.breite / 2, y: groesseRef.current.hoehe / 2 }));
  const bild = (event: ReactPointerEvent) => {
    const r = flaeche.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
  };

  const druecken = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    // Einfangen ist eine Hilfe gegen verlorene Zeiger, keine Voraussetzung: Kennt der
    // Browser den Zeiger nicht (mehr), wirft er - die Bewegung läuft trotzdem.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // ohne Einfangen weiter
    }
    ziehen.current = { start: bild(event), v: viewport, pointerId: event.pointerId, element: event.currentTarget };
  };
  const freigeben = () => {
    const z = ziehen.current;
    ziehen.current = null;
    if (z !== null && z.element.hasPointerCapture?.(z.pointerId)) z.element.releasePointerCapture?.(z.pointerId);
  };
  const bewegen = (event: ReactPointerEvent<SVGSVGElement>) => {
    const p = bild(event);
    const z = ziehen.current;
    if (z !== null) {
      setViewport(verschieben(z.v, p.x - z.start.x, p.y - z.start.y));
      return;
    }
    const welt = bildZuWelt(viewport, p);
    if (!modell.geschlossen || !imRaum(modell.waende, welt)) {
      setZeiger("Zeiger außerhalb des Raums");
      return;
    }
    const w = naechsteWand(modell.waende, welt);
    setZeiger(w === null ? "—" : `Nächste Wand: Wand ${w.nummer}, senkrechter Abstand ${masse.anzeigen(w.abstandMm)}`);
  };

  const taste = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest?.("select, input") != null) return;
    if (event.key === "+") zoom(1.25);
    else if (event.key === "-") zoom(0.8);
    else if (event.key.toLowerCase() === "f") zuruecksetzen();
  };

  // Raster über die sichtbare Fläche - wie im Grundriss vergröbert, damit es lesbar bleibt.
  let schritt = rasterMm;
  while (schritt * viewport.massstab < 8) schritt *= schritt % 250 === 0 ? 2 : 5;
  const g = sichtbareGrenzen(viewport, groesse);
  const raster: string[] = [];
  for (let x = Math.ceil(g.minX / schritt) * schritt; x <= g.maxX; x += schritt) raster.push(`M${weltZuBild(viewport, { x, y: 0 }).x.toFixed(1)} 0V${groesse.hoehe}`);
  for (let y = Math.ceil(g.minY / schritt) * schritt; y <= g.maxY; y += schritt) raster.push(`M0 ${weltZuBild(viewport, { x: 0, y }).y.toFixed(1)}H${groesse.breite}`);
  const punkte = modell.waende.map((w) => weltZuBild(viewport, w.start)).map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <Dialog offen titel={`Deckenansicht · ${raumName}`} groesse="gross" onClose={onSchliessen}>
      <div className="flex flex-col gap-2 split:h-full split:min-h-0" onKeyDown={taste}>
        <div className="flex flex-wrap items-center gap-3" role="toolbar" aria-label="Werkzeuge der Deckenansicht">
          <span>
            <strong>Deckenansicht „{raumName}“</strong> · Deckenhöhe {masse.anzeigen(deckenhoeheMm)}
            {eigeneHoehe ? "" : " (Standard des Geschosses)"}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <button type="button" className={WERKZEUG} aria-label="Vergrößern" title="Vergrößern (+)" onClick={() => zoom(1.25)}>
              +
            </button>
            <button type="button" className={WERKZEUG} aria-label="Verkleinern" title="Verkleinern (−)" onClick={() => zoom(0.8)}>
              −
            </button>
            <button type="button" className={WERKZEUG} title="Ganzen Raum zeigen (F)" onClick={zuruecksetzen}>
              {ANSICHT_ZURUECKSETZEN}
            </button>
          </span>
          <label className="flex items-center gap-1.5 text-small">
            Raster
            <select className={eingabefeld({ kompakt: true })} value={rasterMm} onChange={(event) => onRaster(Number(event.target.value))}>
              {RASTERGROESSEN_MM.map((mm) => (
                <option key={mm} value={mm}>
                  {masse.anzeigen(mm)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!modell.geschlossen ? (
          <p className={meldungsflaeche()} role="alert">
            Die Raumkontur ist nicht geschlossen - eine Deckenansicht braucht eine geschlossene Kontur.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 split:min-h-0 split:flex-auto split:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-w-0 flex-col gap-1 split:min-h-0">
              <div ref={huelle} className="relative h-[55dvh] min-h-[300px] touch-none overflow-hidden rounded-ep border border-line bg-canvas split:h-auto split:min-h-0 split:flex-auto">
                <svg
                  ref={flaeche}
                  className="ansicht__svg"
                  role="application"
                  aria-label={`Deckenansicht ${raumName}, Ausrichtung wie im Grundriss`}
                  tabIndex={0}
                  width={groesse.breite}
                  height={groesse.hoehe}
                  style={{ cursor: "grab" }}
                  onPointerDown={druecken}
                  onPointerMove={bewegen}
                  onPointerUp={freigeben}
                  onPointerCancel={freigeben}
                >
                  <path d={raster.join("")} className="ansicht__raster" aria-hidden="true" />
                  <polygon points={punkte} className="ansicht__decke-flaeche" data-testid="deckenkontur" />
                  {modell.waende.map((w) => {
                    const p = weltZuBild(viewport, w.beschriftung);
                    return (
                      <text key={w.id} x={p.x} y={p.y + 4} textAnchor="middle" className="ansicht__masstext" data-testid={`decke-wand-${w.nummer}`}>
                        {`W${w.nummer} · ${masse.anzeigen(w.laengeMm)}`}
                      </text>
                    );
                  })}
                  <text x={groesse.breite - 10} y={20} textAnchor="end" className="ansicht__text ansicht__text--klein">
                    ↑ oben wie im Grundriss
                  </text>
                </svg>
              </div>
              <p className="m-0 h-6 overflow-hidden text-[0.82rem] text-muted" aria-live="polite" data-testid="decke-zeiger">
                {zeiger}
              </p>
            </div>
            <aside className="min-w-0 text-small split:min-h-0 split:overflow-y-auto" aria-label="Raumangaben">
              <p className="m-0">
                Fläche {flaecheText(modell.flaecheMm2)} · Umfang {masse.anzeigenOptional(modell.umfangMm)}
              </p>
              {modell.rechteck !== null ? (
                <p className="m-0">
                  Raummaß {masse.anzeigen(modell.rechteck.breiteMm)} × {masse.anzeigen(modell.rechteck.tiefeMm)}
                </p>
              ) : (
                <p className="m-0 text-muted">Kein Rechteck - Maße stehen an den einzelnen Wänden.</p>
              )}
              <ul className="my-1 pl-[18px]" aria-label="Wände">
                {modell.waende.map((w) => (
                  <li key={w.id}>
                    Wand {w.nummer}: {masse.anzeigen(w.laengeMm)}
                  </li>
                ))}
              </ul>
              <p className="text-muted">
                Ausrichtung wie im Grundriss (Deckenspiegel): die Decke so, wie sie sich in einem Spiegel auf dem Fußboden zeigt –
                nicht seitenverkehrt. Was hier links oben liegt, liegt auch im Grundriss links oben. Ziehen verschiebt die Ansicht, das Mausrad zoomt. Geräte folgen in Phase 5.
              </p>
            </aside>
          </div>
        )}
      </div>
    </Dialog>
  );
}
