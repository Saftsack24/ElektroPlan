import { useState } from "react";

import { knopf } from "../../../core/ui/stil";
import type { Steigwegauswertung, Verlaufspunkt } from "./verlauf";

export interface Vorschaugeschoss {
  id: string;
  name: string;
  elevation_mm: number;
  elevation_confirmed: boolean;
}

export interface Vorschausteigweg {
  schluessel: string;
  name: string;
  aktiv: boolean;
  auswertung: Steigwegauswertung;
}

/** Schräge Parallelprojektion: Drehung um die Hochachse, Tiefe halb, z unverzerrt. */
export function projizieren(p: Verlaufspunkt, drehung: number): { x: number; y: number } {
  const winkel = ((45 + 90 * drehung) * Math.PI) / 180;
  const u = p.x_mm * Math.cos(winkel) - p.y_mm * Math.sin(winkel);
  const v = p.x_mm * Math.sin(winkel) + p.y_mm * Math.cos(winkel);
  return { x: u, y: -(p.z_mm + v * 0.5) };
}

const RICHTUNGEN = ["Südwest", "Südost", "Nordost", "Nordwest"] as const;

/**
 * Kleine 3D-Vorschau der Steigwege eines Gebäudes (Phase 6a.5).
 *
 * Bewusst **keine** Gebäudeansicht und kein Umbau der geschossbezogenen
 * 3D-Ansicht (ADR 0016): eine schräge Parallelprojektion der Verlaufs-Polylinien
 * (`verlauf.ts`) mit den Geschossebenen als Umriss, drehbar in vier
 * Blickrichtungen. Räume und Wände fehlen absichtlich.
 *
 * Höhen kommen ausschließlich aus den gespeicherten Höhenlagen. Unbestätigte
 * Ebenen und vorläufige Abschnitte sind gestrichelt in Warnfarbe,
 * widersprüchliche strichpunktiert in Fehlerfarbe - sie sehen nie wie ein
 * bestätigter Verlauf aus.
 */
export function Vorschau3d({
  geschosse,
  steigwege,
}: {
  geschosse: readonly Vorschaugeschoss[];
  steigwege: readonly Vorschausteigweg[];
}) {
  const [drehung, setDrehung] = useState(0);

  const punkte = steigwege.flatMap((s) => [
    ...s.auswertung.abschnitte.flatMap((a) => a.verlauf),
    ...s.auswertung.halte.map((h) => ({ x_mm: h.x_mm, y_mm: h.y_mm, z_mm: 0 })),
  ]);
  if (punkte.length === 0) {
    return <p className="text-muted">Für die 3D-Vorschau fehlt noch ein gesetzter Übergabepunkt.</p>;
  }
  const xs = punkte.map((p) => p.x_mm);
  const ys = punkte.map((p) => p.y_mm);
  const rand = 1_000;
  const ebene = { minX: Math.min(...xs) - rand, maxX: Math.max(...xs) + rand, minY: Math.min(...ys) - rand, maxY: Math.max(...ys) + rand };
  const hoeheVon = new Map(geschosse.map((g) => [g.id, g.elevation_mm]));

  const ebenen = geschosse.map((g) => {
    const ecken = [
      { x_mm: ebene.minX, y_mm: ebene.minY, z_mm: g.elevation_mm },
      { x_mm: ebene.maxX, y_mm: ebene.minY, z_mm: g.elevation_mm },
      { x_mm: ebene.maxX, y_mm: ebene.maxY, z_mm: g.elevation_mm },
      { x_mm: ebene.minX, y_mm: ebene.maxY, z_mm: g.elevation_mm },
    ].map((p) => projizieren(p, drehung));
    return { geschoss: g, ecken };
  });
  const linien = steigwege.flatMap((s) =>
    s.auswertung.abschnitte.map((a, i) => ({
      schluessel: `${s.schluessel}-${i}`,
      aktiv: s.aktiv,
      status: a.status,
      punkte: a.verlauf.map((p) => projizieren(p, drehung)),
    })),
  );
  const halte = steigwege.flatMap((s) =>
    s.auswertung.halte.map((h) => ({
      schluessel: `${s.schluessel}-${h.schluessel}`,
      name: s.name,
      aktiv: s.aktiv,
      p: projizieren({ x_mm: h.x_mm, y_mm: h.y_mm, z_mm: hoeheVon.get(h.floor_id) ?? 0 }, drehung),
    })),
  );

  const alle = [...ebenen.flatMap((e) => e.ecken), ...linien.flatMap((l) => l.punkte), ...halte.map((h) => h.p)];
  const minX = Math.min(...alle.map((p) => p.x));
  const maxX = Math.max(...alle.map((p) => p.x));
  const minY = Math.min(...alle.map((p) => p.y));
  const maxY = Math.max(...alle.map((p) => p.y));
  const breite = Math.max(maxX - minX, 1) * 1.25;
  const hoehe = Math.max(maxY - minY, 1) * 1.15;
  const x0 = minX - breite * 0.04;
  const y0 = minY - hoehe * 0.06;
  const r = breite / 110;
  const schrift = breite / 50;
  const unbestaetigt = geschosse.some((g) => !g.elevation_confirmed);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-label text-muted">Blick von {RICHTUNGEN[drehung]}</span>
        <button type="button" className={knopf("neutral", { klein: true })} onClick={() => setDrehung((d) => (d + 3) % 4)}>
          Nach links drehen
        </button>
        <button type="button" className={knopf("neutral", { klein: true })} onClick={() => setDrehung((d) => (d + 1) % 4)}>
          Nach rechts drehen
        </button>
      </div>
      <svg
        className="steigweg__svg steigweg__vorschau"
        viewBox={`${x0} ${y0} ${breite} ${hoehe}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`3D-Vorschau der Steigwege (vereinfacht), Blick von ${RICHTUNGEN[drehung]}`}
      >
        {ebenen.map(({ geschoss, ecken }) => (
          <g key={geschoss.id} data-testid="vorschau-ebene" data-bestaetigt={geschoss.elevation_confirmed}>
            <polygon
              className={`steigweg__ebene${geschoss.elevation_confirmed ? "" : " steigweg__ebene--unbestaetigt"}`}
              points={ecken.map((p) => `${p.x},${p.y}`).join(" ")}
            />
            {ecken[0] !== undefined && (
              <text className="steigweg__text steigweg__text--leise" x={ecken[0].x - r * 2} y={ecken[0].y + schrift} fontSize={schrift} textAnchor="end">
                {geschoss.name}
                {geschoss.elevation_confirmed ? "" : " (Höhenlage nicht bestätigt)"}
              </text>
            )}
          </g>
        ))}
        {linien.map((l) => (
          <polyline
            key={l.schluessel}
            data-testid="vorschau-abschnitt"
            data-status={l.status}
            className={`steigweg__linie${l.status === "elevation-unconfirmed" ? " steigweg__linie--vorlaeufig" : l.status === "elevation-inconsistent" ? " steigweg__linie--konflikt" : ""}${l.aktiv ? "" : " steigweg__linie--passiv"}`}
            points={l.punkte.map((p) => `${p.x},${p.y}`).join(" ")}
          />
        ))}
        {halte.map((h) => (
          <circle key={h.schluessel} className={`steigweg__halt${h.aktiv ? "" : " steigweg__halt--passiv"}`} cx={h.p.x} cy={h.p.y} r={r} />
        ))}
      </svg>
      {unbestaetigt && (
        <p className="mt-1 text-label text-warning">
          Mindestens eine Höhenlage ist nicht bestätigt. Ihre Ebene und die angrenzenden Abschnitte sind nur vorläufig
          (gespeicherter, unbestätigter Wert) und gestrichelt dargestellt.
        </p>
      )}
    </div>
  );
}
