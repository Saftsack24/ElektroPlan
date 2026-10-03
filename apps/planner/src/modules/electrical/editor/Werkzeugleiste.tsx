import { useMasse } from "../../../core/ui/masseinheit";
import { KNOPF_GRUND, eingabefeld } from "../../../core/ui/stil";
import { ANSICHT_ZURUECKSETZEN, ANSICHT_ZURUECKSETZEN_2D } from "../texte";
import type { Oeffnungsart } from "./entwurf";
import { RASTERGROESSEN_MM } from "./fang";
import type { Werkzeug } from "./zustand";

const GRUPPE = "flex flex-wrap items-center gap-1";
/** Werkzeugknopf: kleiner als ein Formularknopf, gesperrt deutlich blasser. */
const WERKZEUG = `${KNOPF_GRUND} border-control bg-surface px-2.5 py-[5px] text-fg disabled:cursor-not-allowed disabled:opacity-45`;
const WERKZEUG_AKTIV = `${KNOPF_GRUND} border-accent bg-accent px-2.5 py-[5px] text-on-accent disabled:cursor-not-allowed disabled:opacity-45`;

const WERKZEUGE: readonly { wert: Werkzeug; label: string; taste: string; schreibend: boolean }[] = [
  { wert: "auswahl", label: "Auswählen", taste: "V", schreibend: false },
  { wert: "pan", label: "Verschieben", taste: "H", schreibend: false },
  { wert: "rechteck", label: "Rechteckraum", taste: "R", schreibend: true },
  { wert: "polygon", label: "Polygonraum", taste: "P", schreibend: true },
];

/**
 * Tür, Fenster, Durchgang (Phase 4f): Ein Klick auf eine Wand öffnet deren
 * Wandansicht mit diesem Werkzeug - gesetzt wird dort, nicht von oben.
 */
const OEFFNUNGSWERKZEUGE: readonly { art: Oeffnungsart; label: string; taste: string }[] = [
  { art: "door", label: "Tür", taste: "T" },
  { art: "window", label: "Fenster", taste: "N" },
  { art: "passage", label: "Durchgang", taste: "D" },
];

/**
 * Kompakte Werkzeugleiste. Jedes Werkzeug hat ein Tastenkürzel; die Kürzel
 * stehen im Tooltip und in der Hilfe unter der Zeichenfläche.
 */
export function Werkzeugleiste({
  werkzeug,
  onWerkzeug,
  oeffnungsart,
  onOeffnungsart,
  rasterMm,
  onRaster,
  fangAktiv,
  onFang,
  kannRueckgaengig,
  kannWiederholen,
  onRueckgaengig,
  onWiederholen,
  onZoom,
  onEinpassen,
  darfSchreiben,
}: {
  werkzeug: Werkzeug;
  onWerkzeug: (w: Werkzeug) => void;
  oeffnungsart: Oeffnungsart;
  onOeffnungsart: (art: Oeffnungsart) => void;
  rasterMm: number;
  onRaster: (mm: number) => void;
  fangAktiv: boolean;
  onFang: (aktiv: boolean) => void;
  kannRueckgaengig: boolean;
  kannWiederholen: boolean;
  onRueckgaengig: () => void;
  onWiederholen: () => void;
  onZoom: (faktor: number) => void;
  onEinpassen: () => void;
  darfSchreiben: boolean;
}) {
  const masse = useMasse();
  return (
    <div className="flex flex-wrap items-center gap-3.5" role="toolbar" aria-label="Werkzeuge des Grundrisseditors">
      <div className={GRUPPE}>
        {WERKZEUGE.filter((w) => darfSchreiben || !w.schreibend).map((w) => (
          <button
            key={w.wert}
            type="button"
            className={werkzeug === w.wert ? WERKZEUG_AKTIV : WERKZEUG}
            aria-pressed={werkzeug === w.wert}
            title={`${w.label} (${w.taste})`}
            onClick={() => onWerkzeug(w.wert)}
          >
            {w.label}
          </button>
        ))}
        {darfSchreiben &&
          OEFFNUNGSWERKZEUGE.map((o) => {
            const aktiv = werkzeug === "oeffnung" && oeffnungsart === o.art;
            return (
              <button
                key={o.art}
                type="button"
                className={aktiv ? WERKZEUG_AKTIV : WERKZEUG}
                aria-pressed={aktiv}
                title={`${o.label} (${o.taste}): Wand anklicken – die Wandansicht öffnet sich zum Setzen`}
                onClick={() => {
                  onOeffnungsart(o.art);
                  onWerkzeug("oeffnung");
                }}
              >
                {o.label}
              </button>
            );
          })}
      </div>

      {darfSchreiben && (
        <div className={GRUPPE}>
          <button
            type="button"
            className={WERKZEUG}
            disabled={!kannRueckgaengig}
            title="Rückgängig (Strg+Z)"
            onClick={onRueckgaengig}
          >
            Rückgängig
          </button>
          <button
            type="button"
            className={WERKZEUG}
            disabled={!kannWiederholen}
            title="Wiederholen (Strg+Y oder Strg+Umschalt+Z)"
            onClick={onWiederholen}
          >
            Wiederholen
          </button>
        </div>
      )}

      <div className={GRUPPE}>
        <button type="button" className={WERKZEUG} title="Vergrößern (+)" aria-label="Vergrößern" onClick={() => onZoom(1.25)}>
          +
        </button>
        <button type="button" className={WERKZEUG} title="Verkleinern (−)" aria-label="Verkleinern" onClick={() => onZoom(0.8)}>
          −
        </button>
        <button type="button" className={WERKZEUG} title={`${ANSICHT_ZURUECKSETZEN_2D} (F)`} onClick={onEinpassen}>
          {ANSICHT_ZURUECKSETZEN}
        </button>
      </div>

      <div className={GRUPPE}>
        <label className="flex items-center gap-1.5 text-small">
          <input type="checkbox" checked={fangAktiv} onChange={(event) => onFang(event.target.checked)} />
          Fang
        </label>
        <label className="flex items-center gap-1.5 text-small">
          Raster
          <select
            className={eingabefeld({ kompakt: true })}
            value={rasterMm}
            onChange={(event) => onRaster(Number(event.target.value))}
          >
            {RASTERGROESSEN_MM.map((mm) => (
              <option key={mm} value={mm}>
                {masse.anzeigen(mm)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
