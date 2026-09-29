import { EINHEIT_NAME, MASSEINHEITEN, mmAnzeigen } from "../masse";
import { Dialog } from "./Dialog";
import { masseinheitSetzen, useMasseinheit } from "./masseinheit";

/**
 * Persönliche Anzeigeeinstellungen. Derzeit nur die Maßeinheit.
 *
 * Die Wahl wirkt sofort und wird in diesem Browser gespeichert. Sie ändert
 * nur Anzeige und Eingabe - gespeichert und übertragen wird weiter in ganzen
 * Millimetern.
 */
export function EinstellungenDialog({ offen, onClose }: { offen: boolean; onClose: () => void }) {
  const einheit = useMasseinheit();
  return (
    <Dialog offen={offen} titel="Einstellungen" onClose={onClose}>
      <fieldset className="form-grid__block einstellungen__gruppe">
        <legend>Maßeinheit für Längen</legend>
        {MASSEINHEITEN.map((wert) => (
          <div key={wert} className="field field--schalter">
            <input
              id={`masseinheit-${wert}`}
              type="radio"
              name="masseinheit"
              value={wert}
              checked={einheit === wert}
              data-autofocus={einheit === wert ? true : undefined}
              onChange={() => masseinheitSetzen(wert)}
            />
            <label htmlFor={`masseinheit-${wert}`}>
              {EINHEIT_NAME[wert]} ({wert}) - z. B. {mmAnzeigen(115, wert)}, {mmAnzeigen(2500, wert)}
            </label>
          </div>
        ))}
        <p className="muted">
          Die Einstellung gilt nur für Sie und nur in diesem Browser. Sie ändert ausschließlich
          Anzeige und Eingabe - die gespeicherten Planmaße bleiben unverändert in ganzen
          Millimetern. Flächen werden weiter in m² angezeigt.
        </p>
      </fieldset>
      <div className="button-row dialog__aktionen">
        <button type="button" className="button button--primary" onClick={onClose}>
          Schließen
        </button>
      </div>
    </Dialog>
  );
}
