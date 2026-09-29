import { useMasse } from "../../../core/ui/masseinheit";
import { ANSICHT_ZURUECKSETZEN, ANSICHT_ZURUECKSETZEN_2D } from "../texte";
import type { Oeffnungsart } from "./entwurf";
import { RASTERGROESSEN_MM } from "./fang";
import type { Werkzeug } from "./zustand";

const WERKZEUGE: readonly { wert: Werkzeug; label: string; taste: string; schreibend: boolean }[] = [
  { wert: "auswahl", label: "Auswählen", taste: "V", schreibend: false },
  { wert: "pan", label: "Verschieben", taste: "H", schreibend: false },
  { wert: "rechteck", label: "Rechteckraum", taste: "R", schreibend: true },
  { wert: "polygon", label: "Polygonraum", taste: "P", schreibend: true },
  { wert: "oeffnung", label: "Öffnung", taste: "O", schreibend: true },
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
    <div className="werkzeugleiste" role="toolbar" aria-label="Werkzeuge des Grundrisseditors">
      <div className="werkzeugleiste__gruppe">
        {WERKZEUGE.filter((w) => darfSchreiben || !w.schreibend).map((w) => (
          <button
            key={w.wert}
            type="button"
            className={werkzeug === w.wert ? "button werkzeug werkzeug--aktiv" : "button werkzeug"}
            aria-pressed={werkzeug === w.wert}
            title={`${w.label} (${w.taste})`}
            onClick={() => onWerkzeug(w.wert)}
          >
            {w.label}
          </button>
        ))}
        {darfSchreiben && werkzeug === "oeffnung" && (
          <select
            aria-label="Art der Öffnung"
            className="field__input werkzeugleiste__auswahl"
            value={oeffnungsart}
            onChange={(event) => onOeffnungsart(event.target.value as Oeffnungsart)}
          >
            <option value="door">Tür</option>
            <option value="window">Fenster</option>
            <option value="passage">Durchgang</option>
          </select>
        )}
      </div>

      {darfSchreiben && (
        <div className="werkzeugleiste__gruppe">
          <button
            type="button"
            className="button werkzeug"
            disabled={!kannRueckgaengig}
            title="Rückgängig (Strg+Z)"
            onClick={onRueckgaengig}
          >
            Rückgängig
          </button>
          <button
            type="button"
            className="button werkzeug"
            disabled={!kannWiederholen}
            title="Wiederholen (Strg+Y oder Strg+Umschalt+Z)"
            onClick={onWiederholen}
          >
            Wiederholen
          </button>
        </div>
      )}

      <div className="werkzeugleiste__gruppe">
        <button type="button" className="button werkzeug" title="Vergrößern (+)" aria-label="Vergrößern" onClick={() => onZoom(1.25)}>
          +
        </button>
        <button type="button" className="button werkzeug" title="Verkleinern (−)" aria-label="Verkleinern" onClick={() => onZoom(0.8)}>
          −
        </button>
        <button type="button" className="button werkzeug" title={`${ANSICHT_ZURUECKSETZEN_2D} (F)`} onClick={onEinpassen}>
          {ANSICHT_ZURUECKSETZEN}
        </button>
      </div>

      <div className="werkzeugleiste__gruppe">
        <label className="werkzeugleiste__schalter">
          <input type="checkbox" checked={fangAktiv} onChange={(event) => onFang(event.target.checked)} />
          Fang
        </label>
        <label className="werkzeugleiste__schalter">
          Raster
          <select
            className="field__input werkzeugleiste__auswahl"
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
