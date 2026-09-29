import { EINHEIT_NAME, MASSEINHEITEN, mmAnzeigen } from "../masse";
import { Dialog, DialogAktionen } from "./Dialog";
import { masseinheitSetzen, useMasseinheit } from "./masseinheit";
import { FORMULARRASTER_BLOCK, FORMULARRASTER_LEGENDE, SCHALTERFELD, knopf } from "./stil";

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
      <fieldset className={FORMULARRASTER_BLOCK}>
        <legend className={FORMULARRASTER_LEGENDE}>Maßeinheit für Längen</legend>
        {MASSEINHEITEN.map((wert) => (
          <div key={wert} className={SCHALTERFELD}>
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
        <p className="text-muted">
          Die Einstellung gilt nur für Sie und nur in diesem Browser. Sie ändert ausschließlich
          Anzeige und Eingabe - die gespeicherten Planmaße bleiben unverändert in ganzen
          Millimetern. Flächen werden weiter in m² angezeigt.
        </p>
      </fieldset>
      <DialogAktionen>
        <button type="button" className={knopf("primaer")} onClick={onClose}>
          Schließen
        </button>
      </DialogAktionen>
    </Dialog>
  );
}
