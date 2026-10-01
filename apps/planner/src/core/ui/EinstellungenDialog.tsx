import { useEffect, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import {
  EinstellungsKonflikt,
  STANDARD_EINSTELLUNGEN,
  einstellungenAktualisieren,
  einstellungenSpeichern,
  gleicheEinstellungen,
  gueltigeEinstellungen,
} from "../einstellungen/persoenlich";
import type { PersoenlicheEinstellungen } from "../einstellungen/persoenlich";
import { EINHEIT_NAME, MASSEINHEITEN, mmAnzeigen } from "../masse";
import {
  AKZENTE,
  DARSTELLUNGSMODI,
  MODUS_NAME,
  STANDARD_DARSTELLUNG,
  darstellungVorschauBeenden,
  darstellungVorschauen,
} from "../theme/darstellung";
import { Dialog, DialogAktionen } from "./Dialog";
import { masseinheitVorschauBeenden, masseinheitVorschauen } from "./masseinheit";
import { FORMULARRASTER_BLOCK, FORMULARRASTER_LEGENDE, SCHALTERFELD, STAPEL, knopf, meldungsflaeche } from "./stil";

/**
 * Persönliche Einstellungen: Darstellung, Akzentfarbe, Maßeinheit - die
 * einzige Stelle dafür in der Oberfläche.
 *
 * **Alle drei verhalten sich gleich:** Eine Wahl wirkt sofort als Vorschau in
 * der ganzen Anwendung, gespeichert wird erst mit „Übernehmen" - auf dem
 * Server, für diesen Benutzer in diesem Betrieb, auf allen Geräten (ADR 0021).
 * Abbrechen, Escape und ✕ stellen den gespeicherten Stand vollständig wieder
 * her. „Auf Standard zurücksetzen" setzt nur den Entwurf zurück.
 *
 * Beim Öffnen wird der Serverstand neu gelesen. Hat ein anderes Gerät
 * inzwischen gespeichert, gilt dessen Stand; ein Speichern mit veraltetem
 * Stand wird abgelehnt und erklärt, nie still überschrieben.
 */
export function EinstellungenDialog({ offen, onClose }: { offen: boolean; onClose: () => void }) {
  // Der Inhalt existiert nur, solange der Dialog offen ist: Jedes Öffnen
  // beginnt mit dem gespeicherten Stand.
  return offen ? <Einstellungen onClose={onClose} /> : null;
}

type Meldung = { art: "konflikt" | "fehler"; text: string } | null;

function Einstellungen({ onClose }: { onClose: () => void }) {
  const { api } = useAuth();
  const [entwurf, setEntwurf] = useState<PersoenlicheEinstellungen>(gueltigeEinstellungen);
  const [laedt, setLaedt] = useState(true);
  const [speichert, setSpeichert] = useState(false);
  const [meldung, setMeldung] = useState<Meldung>(null);
  // Hat der Benutzer schon gewählt, überschreibt der nachgeladene Serverstand
  // seinen Entwurf nicht.
  const veraendert = useRef(false);

  // Wird der Dialog auf anderem Weg entfernt (Abmelden, Seitenwechsel),
  // endet auch die Vorschau.
  useEffect(
    () => () => {
      darstellungVorschauBeenden();
      masseinheitVorschauBeenden();
    },
    [],
  );

  useEffect(() => {
    let aktiv = true;
    void einstellungenAktualisieren(api).finally(() => {
      if (!aktiv) return;
      setLaedt(false);
      if (!veraendert.current) setEntwurf(gueltigeEinstellungen());
    });
    return () => {
      aktiv = false;
    };
  }, [api]);

  const aendern = (neu: PersoenlicheEinstellungen) => {
    veraendert.current = true;
    setMeldung(null);
    setEntwurf(neu);
    darstellungVorschauen({ modus: neu.modus, akzent: neu.akzent });
    masseinheitVorschauen(neu.einheit);
  };

  const abbrechen = () => {
    if (speichert) return;
    darstellungVorschauBeenden();
    masseinheitVorschauBeenden();
    onClose();
  };

  const uebernehmen = async () => {
    if (speichert) return;
    if (gleicheEinstellungen(entwurf, gueltigeEinstellungen())) {
      darstellungVorschauBeenden();
      masseinheitVorschauBeenden();
      onClose();
      return;
    }
    setSpeichert(true);
    setMeldung(null);
    try {
      await einstellungenSpeichern(api, entwurf);
      onClose();
    } catch (error) {
      if (error instanceof EinstellungsKonflikt) {
        // Der Stand des anderen Geräts ist bereits angewendet; die Vorschau
        // ist damit beendet. Der Entwurf zeigt jetzt diesen Stand.
        veraendert.current = false;
        setEntwurf(gueltigeEinstellungen());
        setMeldung({
          art: "konflikt",
          text: "Ihre Einstellungen wurden inzwischen auf einem anderen Gerät geändert. Der dort gespeicherte Stand ist jetzt geladen - bitte Ihre Wahl prüfen und erneut übernehmen.",
        });
      } else {
        setMeldung({
          art: "fehler",
          text: "Die Einstellungen konnten nicht gespeichert werden. Bitte erneut versuchen - die Vorschau bleibt bis dahin sichtbar.",
        });
      }
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <Dialog
      offen
      titel="Einstellungen"
      beschreibung="Änderungen sind sofort als Vorschau sichtbar und werden mit „Übernehmen“ gespeichert – nur für Sie, in diesem Betrieb und auf allen Ihren Geräten."
      onClose={abbrechen}
    >
      <div className={STAPEL} aria-busy={laedt || speichert}>
        {laedt && (
          <p className="text-muted" role="status">
            Aktueller Stand wird geladen ...
          </p>
        )}
        {meldung !== null && (
          <p className={meldungsflaeche(meldung.art === "konflikt" ? "erfolg" : "fehler")} role="alert">
            {meldung.text}
          </p>
        )}
        <fieldset className={FORMULARRASTER_BLOCK} disabled={speichert}>
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

        <fieldset className={FORMULARRASTER_BLOCK} disabled={speichert}>
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

        <fieldset className={FORMULARRASTER_BLOCK} disabled={speichert}>
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
            bleiben unverändert in ganzen Millimetern. Eingaben dürfen Komma oder Punkt und eine
            Einheit wie „cm“ oder „m“ enthalten. Flächen werden weiter in m² angezeigt.
          </p>
        </fieldset>
      </div>

      <DialogAktionen>
        <button
          type="button"
          className={knopf("primaer")}
          disabled={speichert}
          onClick={() => void uebernehmen()}
        >
          {speichert ? "Wird gespeichert ..." : "Übernehmen"}
        </button>
        <button type="button" className={knopf()} disabled={speichert} onClick={abbrechen}>
          Abbrechen
        </button>
        <button
          type="button"
          className={knopf()}
          disabled={speichert}
          onClick={() => aendern(STANDARD_EINSTELLUNGEN)}
        >
          Auf Standard zurücksetzen
        </button>
      </DialogAktionen>
    </Dialog>
  );
}
