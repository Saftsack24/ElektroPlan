import { useState } from "react";

import { Auswahl, Feld } from "../../core/ui/Feld";
import { Dialog } from "../../core/ui/Dialog";

export type KundenWerte = {
  kind: "private" | "company";
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  billing_street: string;
  billing_postal_code: string;
  billing_city: string;
};

export const LEERER_KUNDE: KundenWerte = {
  kind: "private",
  name: "",
  contact_person: "",
  email: "",
  phone: "",
  billing_street: "",
  billing_postal_code: "",
  billing_city: "",
};

/** Feldbezogene Fehlermeldungen, Schlüssel ist der Feldname. */
export type Feldfehler = Partial<Record<keyof KundenWerte, string>>;

export type Absendeergebnis = { fehler?: string; felder?: Feldfehler };

/**
 * Kundenformular im Dialog - für Anlage **und** Bearbeitung derselbe Baustein.
 *
 * Bewusst ohne eigenen API-Zugriff: `onSubmit` bekommt die Werte und meldet
 * per Rückgabe, ob etwas schiefging. Dadurch ist die Bedienlogik - öffnen,
 * abbrechen, Fehler anzeigen, Doppelklick verhindern - ohne Netzwerk
 * prüfbar, und die Seite bleibt für die Verdrahtung zuständig.
 */
export function CustomerFormDialog({
  offen,
  titel,
  startwerte = LEERER_KUNDE,
  absendenLabel = "Speichern",
  onSubmit,
  onClose,
}: {
  offen: boolean;
  titel: string;
  startwerte?: KundenWerte;
  absendenLabel?: string;
  /** Liefert `undefined` bei Erfolg, sonst die anzuzeigenden Fehler. */
  onSubmit: (werte: KundenWerte) => Promise<Absendeergebnis | undefined>;
  onClose: () => void;
}) {
  const [werte, setWerte] = useState<KundenWerte>(startwerte);
  const [felder, setFelder] = useState<Feldfehler>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const schliessen = () => {
    setWerte(startwerte);
    setFelder({});
    setFehler(null);
    onClose();
  };

  const absenden = async () => {
    // Doppelte Übermittlung: Solange eine Anfrage läuft, passiert nichts
    // Weiteres - weder per Klick noch per Enter.
    if (laeuft) return;
    if (werte.name.trim().length === 0) {
      setFelder({ name: "Bitte einen Namen angeben." });
      return;
    }
    setLaeuft(true);
    try {
      const ergebnis = await onSubmit(werte);
      if (ergebnis === undefined) {
        setWerte(startwerte);
        setFelder({});
        setFehler(null);
        return;
      }
      // Eingaben bleiben erhalten, damit nichts neu getippt werden muss.
      setFelder(ergebnis.felder ?? {});
      setFehler(ergebnis.fehler ?? null);
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Dialog
      offen={offen}
      titel={titel}
      beschreibung="Die Kundennummer vergibt das System. Bitte nur synthetische Testdaten verwenden."
      onClose={schliessen}
    >
      <form
        className="form-grid"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void absenden();
        }}
      >
        <Feld
          id="kunde-name"
          label="Name"
          value={werte.name}
          required
          fehler={felder.name}
          disabled={laeuft}
          onChange={(name) => setWerte({ ...werte, name })}
        />
        <Auswahl
          id="kunde-kind"
          label="Art"
          value={werte.kind}
          disabled={laeuft}
          fehler={felder.kind}
          onChange={(kind) => setWerte({ ...werte, kind: kind as KundenWerte["kind"] })}
        >
          <option value="private">Privatkunde</option>
          <option value="company">Firmenkunde</option>
        </Auswahl>
        <Feld
          id="kunde-contact"
          label="Ansprechpartner"
          value={werte.contact_person}
          fehler={felder.contact_person}
          disabled={laeuft}
          onChange={(contact_person) => setWerte({ ...werte, contact_person })}
        />
        <Feld
          id="kunde-email"
          label="E-Mail"
          type="email"
          value={werte.email}
          fehler={felder.email}
          disabled={laeuft}
          onChange={(email) => setWerte({ ...werte, email })}
        />
        <Feld
          id="kunde-phone"
          label="Telefon"
          value={werte.phone}
          fehler={felder.phone}
          disabled={laeuft}
          onChange={(phone) => setWerte({ ...werte, phone })}
        />
        <Feld
          id="kunde-street"
          label="Straße"
          value={werte.billing_street}
          fehler={felder.billing_street}
          disabled={laeuft}
          onChange={(billing_street) => setWerte({ ...werte, billing_street })}
        />
        <Feld
          id="kunde-plz"
          label="PLZ"
          value={werte.billing_postal_code}
          fehler={felder.billing_postal_code}
          disabled={laeuft}
          onChange={(billing_postal_code) => setWerte({ ...werte, billing_postal_code })}
        />
        <Feld
          id="kunde-ort"
          label="Ort"
          value={werte.billing_city}
          fehler={felder.billing_city}
          disabled={laeuft}
          onChange={(billing_city) => setWerte({ ...werte, billing_city })}
        />
        <div className="form-grid__actions dialog__aktionen">
          {fehler !== null && (
            <p className="alert alert--error" role="alert">
              {fehler}
            </p>
          )}
          <div className="button-row">
            <button className="button button--primary" type="submit" disabled={laeuft}>
              {laeuft ? "Wird gespeichert ..." : absendenLabel}
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={laeuft}
              onClick={schliessen}
            >
              Abbrechen
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
