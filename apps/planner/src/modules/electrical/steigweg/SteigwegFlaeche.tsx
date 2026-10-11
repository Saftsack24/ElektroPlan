import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import type { Rahmen } from "./flaeche";
import { geschossansicht, sichtrahmen, zeigerZuWelt } from "./flaeche";
import type { Abschnittstatus, Steigwegauswertung } from "./verlauf";

export interface Wandlinie {
  id: string;
  x1_mm: number;
  y1_mm: number;
  x2_mm: number;
  y2_mm: number;
}

export interface Steigwegdarstellung {
  schluessel: string;
  name: string;
  aktiv: boolean;
  auswertung: Steigwegauswertung;
}

function linienklasse(status: Abschnittstatus, passiv: boolean): string {
  const art =
    status === "elevation-unconfirmed"
      ? " steigweg__linie--vorlaeufig"
      : status === "elevation-inconsistent"
        ? " steigweg__linie--konflikt"
        : "";
  return `steigweg__linie${art}${passiv ? " steigweg__linie--passiv" : ""}`;
}

function pfeilklasse(status: Abschnittstatus): string {
  return status === "elevation-unconfirmed"
    ? "steigweg__pfeil steigweg__pfeil--vorlaeufig"
    : status === "elevation-inconsistent"
      ? "steigweg__pfeil steigweg__pfeil--konflikt"
      : "steigweg__pfeil";
}

/**
 * Grundriss eines Geschosses für die Steigwegverwaltung (Phase 6a.5).
 *
 * Räume erscheinen nur als Orientierung (Wandlinien, schreibgeschützt).
 * Steigwege sind **nicht** an Räume gebunden: Auch ein Geschoss ohne Räume
 * hat eine bedienbare Koordinatenfläche (Standard 10 m × 7,5 m ab Ursprung).
 *
 * Bedienung, nur mit Schreibrecht und gewähltem Steigweg: Klick setzt oder
 * versetzt den Übergabepunkt dieses Geschosses (Raster 10 mm), Ziehen des
 * eigenen Symbols verschiebt ihn. Genaue Werte über die Maßfelder. Gespeichert
 * wird nichts - alles bleibt Entwurf, bis „Speichern“ gedrückt wird.
 */
export function SteigwegFlaeche({
  geschossName,
  floorId,
  waende,
  steigwege,
  setzbar,
  onSetzen,
}: {
  geschossName: string;
  floorId: string;
  waende: readonly Wandlinie[];
  steigwege: readonly Steigwegdarstellung[];
  setzbar: boolean;
  onSetzen: (x_mm: number, y_mm: number) => void;
}) {
  const svg = useRef<SVGSVGElement | null>(null);
  // Während des Ziehens bleibt der Rahmen stehen - sonst liefe die Fläche unter dem Zeiger weg.
  const [ziehRahmen, setZiehRahmen] = useState<Rahmen | null>(null);

  const ansichten = steigwege.map((s) => ({ ...s, ansicht: geschossansicht(s.auswertung, floorId) }));
  const punkte = [
    ...waende.flatMap((w) => [
      { x_mm: w.x1_mm, y_mm: w.y1_mm },
      { x_mm: w.x2_mm, y_mm: w.y2_mm },
    ]),
    ...ansichten.flatMap(({ ansicht }) => [
      ...(ansicht.halt === null ? [] : [ansicht.halt]),
      ...ansicht.versatz.flatMap((v) => v.punkte),
      ...ansicht.durchquert,
    ]),
  ];
  const rahmen = ziehRahmen ?? sichtrahmen(punkte);
  const breite = rahmen.maxX - rahmen.minX;
  const hoehe = rahmen.maxY - rahmen.minY;
  const r = breite / 90;
  const schrift = breite / 55;

  const welt = (event: ReactMouseEvent) => {
    const element = svg.current;
    if (element === null) return null;
    return zeigerZuWelt(element.getBoundingClientRect(), rahmen, event.clientX, event.clientY);
  };

  const raster: number[] = [];
  const schritt = breite > 40_000 ? 5_000 : 1_000;
  for (let x = Math.ceil(rahmen.minX / schritt) * schritt; x <= rahmen.maxX; x += schritt) raster.push(x);
  const rasterY: number[] = [];
  for (let y = Math.ceil(rahmen.minY / schritt) * schritt; y <= rahmen.maxY; y += schritt) rasterY.push(y);

  const aktiv = ansichten.find((s) => s.aktiv);
  const beschreibung = aktiv?.ansicht.halt
    ? `Übergabepunkt von ${aktiv.name} auf ${geschossName} gesetzt.`
    : aktiv !== undefined
      ? `Auf ${geschossName} ist für ${aktiv.name} noch kein Übergabepunkt gesetzt.`
      : `Steigwege auf ${geschossName}.`;

  return (
    <svg
      ref={svg}
      className="steigweg__svg steigweg__flaeche"
      viewBox={`${rahmen.minX} ${-rahmen.maxY} ${breite} ${hoehe}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Grundriss ${geschossName} mit Steigwegen. ${beschreibung}`}
      onPointerMove={(event) => {
        if (ziehRahmen === null) return;
        const p = welt(event);
        if (p !== null) onSetzen(p.x_mm, p.y_mm);
      }}
      onPointerUp={() => setZiehRahmen(null)}
      onPointerCancel={() => setZiehRahmen(null)}
    >
      <rect
        data-testid="steigweg-flaeche"
        className={`steigweg__hintergrund${setzbar ? " steigweg__hintergrund--setzbar" : ""}`}
        x={rahmen.minX}
        y={-rahmen.maxY}
        width={breite}
        height={hoehe}
        onClick={(event) => {
          if (!setzbar) return;
          const p = welt(event);
          if (p !== null) onSetzen(p.x_mm, p.y_mm);
        }}
      />
      <g aria-hidden="true" pointerEvents="none">
        {raster.map((x) => (
          <line key={`x${x}`} className="steigweg__raster" x1={x} y1={-rahmen.maxY} x2={x} y2={-rahmen.minY} />
        ))}
        {rasterY.map((y) => (
          <line key={`y${y}`} className="steigweg__raster" x1={rahmen.minX} y1={-y} x2={rahmen.maxX} y2={-y} />
        ))}
        {waende.map((w) => (
          <line key={w.id} className="steigweg__wand" x1={w.x1_mm} y1={-w.y1_mm} x2={w.x2_mm} y2={-w.y2_mm} />
        ))}
      </g>
      {ansichten.map(({ schluessel, name, aktiv: istAktiv, ansicht }) => {
        const beschriftung = ansicht.halt ?? ansicht.durchquert[0] ?? null;
        return (
        <g key={schluessel} data-testid={`steigweg-${schluessel}`} pointerEvents={istAktiv ? undefined : "none"}>
          {ansicht.versatz.map((v, i) => {
            const start = v.punkte[0];
            return (
              <g key={`v${i}`} data-testid="steigweg-versatz" data-status={v.status}>
                <polyline
                  className={linienklasse(v.status, !istAktiv)}
                  points={v.punkte.map((p) => `${p.x_mm},${-p.y_mm}`).join(" ")}
                />
                {start !== undefined && (
                  <path
                    className={pfeilklasse(v.status)}
                    opacity={istAktiv ? 1 : 0.45}
                    d={`M ${start.x_mm - r} ${-start.y_mm + r * 0.6} L ${start.x_mm + r} ${-start.y_mm + r * 0.6} L ${start.x_mm} ${-start.y_mm - r} Z`}
                  >
                    <title>Steigweg kommt von unten</title>
                  </path>
                )}
              </g>
            );
          })}
          {ansicht.durchquert.map((d, i) => (
            <circle
              key={`d${i}`}
              data-testid="steigweg-durchquert"
              className="steigweg__durchquert"
              cx={d.x_mm}
              cy={-d.y_mm}
              r={r * 1.2}
            >
              <title>{`${name}: durchquert dieses Geschoss ohne Anschluss`}</title>
            </circle>
          ))}
          {ansicht.halt !== null && (
            <g
              data-testid="steigweg-halt"
              className={`${istAktiv ? "steigweg__halt--aktiv" : "steigweg__halt--passiv"}${istAktiv && setzbar ? " steigweg__halt--ziehbar" : ""}`}
              onPointerDown={(event) => {
                if (!istAktiv || !setzbar) return;
                event.stopPropagation();
                svg.current?.setPointerCapture?.(event.pointerId);
                setZiehRahmen(rahmen);
              }}
            >
              <circle className="steigweg__halt" cx={ansicht.halt.x_mm} cy={-ansicht.halt.y_mm} r={r} />
              <path
                className="steigweg__halt-kreuz"
                d={`M ${ansicht.halt.x_mm - r * 0.7} ${-ansicht.halt.y_mm - r * 0.7} L ${ansicht.halt.x_mm + r * 0.7} ${-ansicht.halt.y_mm + r * 0.7} M ${ansicht.halt.x_mm - r * 0.7} ${-ansicht.halt.y_mm + r * 0.7} L ${ansicht.halt.x_mm + r * 0.7} ${-ansicht.halt.y_mm - r * 0.7}`}
              />
              {ansicht.nachOben !== null && (
                <path
                  className={pfeilklasse(ansicht.nachOben)}
                  d={`M ${ansicht.halt.x_mm + r * 1.4} ${-ansicht.halt.y_mm - r * 0.2} L ${ansicht.halt.x_mm + r * 2.6} ${-ansicht.halt.y_mm - r * 0.2} L ${ansicht.halt.x_mm + r * 2} ${-ansicht.halt.y_mm - r * 1.4} Z`}
                >
                  <title>Steigweg führt nach oben weiter</title>
                </path>
              )}
              <title>{`Übergabepunkt ${name}`}</title>
            </g>
          )}
          {beschriftung !== null && (
            <text
              className={`steigweg__text${istAktiv ? "" : " steigweg__text--leise"}`}
              x={beschriftung.x_mm + r * 1.6}
              y={-beschriftung.y_mm + r * 2.4}
              fontSize={schrift}
            >
              {name}
            </text>
          )}
        </g>
        );
      })}
    </svg>
  );
}
