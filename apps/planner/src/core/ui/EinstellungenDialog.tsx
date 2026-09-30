import { useEffect, useState } from "react";

import { EINHEIT_NAME, MASSEINHEITEN, STANDARD_MASSEINHEIT, mmAnzeigen } from "../masse";
import type { Masseinheit } from "../masse";
import {
  AKZENTE,
  DARSTELLUNGSMODI,
  MODUS_NAME,
  STANDARD_DARSTELLUNG,
  darstellungSpeichern,
  darstellungVorschauBeenden,
  darstellungVorschauen,
  darstellungszustand,
} from "../theme/darstellung";
import type { Darstellung } from "../theme/darstellung";
import { Dialog, DialogAktionen } from "./Dialog";
import {
  gespeicherteMasseinheit,
  masseinheitSetzen,
  masseinheitVorschauBeenden,
  masseinheitVorschauen,
} from "./masseinheit";
import { FORMULARRASTER_BLOCK, FORMULARRASTER_LEGENDE, SCHALTERFELD, STAPEL, knopf } from "./stil";

interface Entwurf extends Darstellung {
  readonly einheit: Masseinheit;
}

const STANDARD_ENTWURF: Entwurf = { ...STANDARD_DARSTELLUNG, einheit: STANDARD_MASSEINHEIT };

/**
 * Persönliche Einstellungen: Darstellung, Akzentfarbe, Maßeinheit.
 *
 * **Alle drei verhalten sich gleich:** Eine Wahl wirkt sofort als Vorschau in
 * der ganzen Anwendung, gespeichert wird erst mit „Übernehmen". Abbrechen,
 * Escape und ✕ stellen den gespeicherten Stand vollständig wieder her.
 * „Auf Standard zurücksetzen" setzt nur den Entwurf zurück.
 *
 * Gespeichert wird je Benutzer und nur in diesem Browser (ADR 0019).
 */
export function EinstellungenDialog({ offen, onClose }: { offen: boolean; onClose: () => void }) {
  // Der Inhalt existiert nur, solange der Dialog offen ist: Jedes Öffnen
  // beginnt mit dem gespeicherten Stand.
  return offen ? <Einstellungen onClose={onClose} /> : null;
}

function Einstellungen({ onClose }: { onClose: () => void }) {
  const [entwurf, setEntwurf] = useState<Entwurf>(() => ({
    ...darstellungszustand().gespeichert,
    einheit: gespeicherteMasseinheit(),
  }));

  // Wird der Dialog auf anderem Weg entfernt (Abmelden, Seitenwechsel),
  // endet auch die Vorschau.
  useEffect(
    () => () => {
      darstellungVorschauBeenden();
      masseinheitVorschauBeenden();
    },
    [],
  );

  const aendern = (neu: Entwurf) => {
    setEntwurf(neu);
    darstellungVorschauen({ modus: neu.modus, akzent: neu.akzent });
    masseinheitVorschauen(neu.einheit);
  };

  const abbrechen = () => {
    darstellungVorschauBeenden();
    masseinheitVorschauBeenden();
    onClose();
  };

  const uebernehmen = () => {
    darstellungSpeichern({ modus: entwurf.modus, akzent: entwurf.akzent });
    masseinheitSetzen(entwurf.einheit);
    onClose();
  };

  return (
    <Dialog
      offen
      titel="Einstellungen"
      beschreibung="Änderungen sind sofort als Vorschau sichtbar und werden mit „Übernehmen“ gespeichert – nur für Sie und nur in diesem Browser."
      onClose={abbrechen}
    >
      <div className={STAPEL}>
        <fieldset className={FORMULARRASTER_BLOCK}>
          <legend className={FORMULARRASTER_LEGENDE}>Darstellung</legend>
          {DARSTELLUNGSMODI.map((modus) => (
            <div key={modus} className={SCHALTERFELD}>
              <input
                id={`darstellung-${modus}`}
                type="radio"
                name="darstellung"
                value={modus}
                checked={entwurf.modus === modus}
                data-autofocus={entwurf.modus === modus ? true : undefined}
                onChange={() => aendern({ ...entwurf, modus })}
              />
              <label htmlFor={`darstellung-${modus}`}>
                {MODUS_NAME[modus]}
                {modus === "system" ? " – folgt der Einstellung des Betriebssystems" : ""}
              </label>
            </div>
          ))}
        </fieldset>

        <fieldset className={FORMULARRASTER_BLOCK}>
          <legend className={FORMULARRASTER_LEGENDE}>Akzentfarbe</legend>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2">
            {AKZENTE.map((akzent) => (
              <div key={akzent.id} className={SCHALTERFELD}>
                <input
                  id={`akzent-${akzent.id}`}
                  type="radio"
                  name="akzent"
                  value={akzent.id}
                  checked={entwurf.akzent === akzent.id}
                  onChange={() => aendern({ ...entwurf, akzent: akzent.id })}
                />
                <label htmlFor={`akzent-${akzent.id}`} className="flex items-center gap-2">
                  {/* Farbmuster mit den Werten des Schemas (core/theme/akzente.css);
                      die Aussage trägt der Name. */}
                  <span
                    aria-hidden="true"
                    data-accent={akzent.id}
                    className="inline-block size-4 flex-none rounded-full border border-control bg-accent"
                  />
                  {akzent.name}
                  {akzent.id === STANDARD_DARSTELLUNG.akzent ? " (Standard)" : ""}
                </label>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className={FORMULARRASTER_BLOCK}>
          <legend className={FORMULARRASTER_LEGENDE}>Maßeinheit für Längen</legend>
          {MASSEINHEITEN.map((wert) => (
            <div key={wert} className={SCHALTERFELD}>
              <input
                id={`masseinheit-${wert}`}
                type="radio"
                name="masseinheit"
                value={wert}
                checked={entwurf.einheit === wert}
                onChange={() => aendern({ ...entwurf, einheit: wert })}
              />
              <label htmlFor={`masseinheit-${wert}`}>
                {EINHEIT_NAME[wert]} ({wert}) - z. B. {mmAnzeigen(115, wert)}, {mmAnzeigen(2500, wert)}
              </label>
            </div>
          ))}
          <p className="text-muted">
            Die Maßeinheit ändert ausschließlich Anzeige und Eingabe - die gespeicherten Planmaße
            bleiben unverändert in ganzen Millimetern. Flächen werden weiter in m² angezeigt.
          </p>
        </fieldset>
      </div>

      <DialogAktionen>
        <button type="button" className={knopf("primaer")} onClick={uebernehmen}>
          Übernehmen
        </button>
        <button type="button" className={knopf()} onClick={abbrechen}>
          Abbrechen
        </button>
        <button type="button" className={knopf()} onClick={() => aendern(STANDARD_ENTWURF)}>
          Auf Standard zurücksetzen
        </button>
      </DialogAktionen>
    </Dialog>
  );
}
