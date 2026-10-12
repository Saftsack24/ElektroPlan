import type { components } from "@elektroplan/api-client";

import type { Geraetetypen } from "../geraete/katalog";
import { SymbolImPlan } from "../geraete/symbole";
import { sichtrahmen } from "../steigweg/flaeche";
import type { Planergeraet } from "./daten";

type RoomPlanOut = components["schemas"]["RoomPlanOut"];

export type Geraetezustand = "dieser" | "anderer" | "frei" | "nicht-zuordenbar";

/**
 * Grafische Auswahl im Grundriss eines Geschosses (Phase 6b.1).
 *
 * Räume nur als Orientierung, Geräte als Planungssymbole an ihrer gespeicherten
 * Lage. Ein Klick auf ein zuordenbares, freies oder bereits gewähltes Gerät
 * schaltet es im Zuordnungsentwurf um. Geräte eines anderen Stromkreises
 * bleiben unverändert (nie still umgehängt); nicht zuordenbare Geräte
 * (Datendose, Verteilung) sind blass und nicht wählbar. Die Liste daneben ist
 * der gleichwertige, tastaturbedienbare Weg.
 */
export function ZuordnungsFlaeche({
  geschoss,
  raeume,
  geraete,
  typen,
  zustand,
  beschriftung,
  bedienbar,
  onUmschalten,
}: {
  geschoss: string;
  raeume: readonly RoomPlanOut[];
  geraete: readonly Planergeraet[];
  typen: Geraetetypen;
  zustand: (id: string) => Geraetezustand;
  beschriftung: (id: string) => string;
  bedienbar: boolean;
  onUmschalten: (id: string) => void;
}) {
  const waende = raeume.flatMap((r) => r.walls);
  const rahmen = sichtrahmen([
    ...waende.flatMap((w) => [
      { x_mm: w.x1_mm, y_mm: w.y1_mm },
      { x_mm: w.x2_mm, y_mm: w.y2_mm },
    ]),
    ...geraete,
  ]);
  const breite = rahmen.maxX - rahmen.minX;
  const hoehe = rahmen.maxY - rahmen.minY;
  const groesse = breite / 32;

  return (
    <svg
      className="zuordnung__svg"
      viewBox={`${rahmen.minX} ${-rahmen.maxY} ${breite} ${hoehe}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={`Grundriss ${geschoss} – Geräte zum Zuordnen`}
    >
      <g aria-hidden="true">
        {waende.map((w) => (
          <line key={w.id} className="zuordnung__wand" x1={w.x1_mm} y1={-w.y1_mm} x2={w.x2_mm} y2={-w.y2_mm} />
        ))}
      </g>
      {geraete.map((g) => {
        const art = zustand(g.id);
        const waehlbar = bedienbar && (art === "dieser" || art === "frei");
        const text = beschriftung(g.id);
        return (
          <g
            key={g.id}
            data-testid={`zuordnung-geraet-${g.id}`}
            data-zustand={art}
            className={`zuordnung__geraet zuordnung__geraet--${art}${waehlbar ? " zuordnung__geraet--waehlbar" : ""}`}
            role={waehlbar ? "button" : undefined}
            tabIndex={waehlbar ? 0 : undefined}
            aria-pressed={waehlbar ? art === "dieser" : undefined}
            aria-label={text}
            onClick={() => {
              if (waehlbar) onUmschalten(g.id);
            }}
            onKeyDown={(event) => {
              if (waehlbar && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onUmschalten(g.id);
              }
            }}
          >
            <title>{text}</title>
            <circle className="zuordnung__ring" cx={g.x_mm} cy={-g.y_mm} r={groesse * 0.75} />
            <SymbolImPlan typ={typen.get(g.typKey)} x={g.x_mm} y={-g.y_mm} groesse={groesse} />
          </g>
        );
      })}
    </svg>
  );
}
