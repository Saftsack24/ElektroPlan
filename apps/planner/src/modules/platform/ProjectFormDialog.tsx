import type { CustomerOut } from "@elektroplan/api-client";
import { useState } from "react";

import { Dialog } from "../../core/ui/Dialog";
import { Feld, Schalter } from "../../core/ui/Feld";
import { useMasse } from "../../core/ui/masseinheit";
import {
  ANFANGSHERKUNFT,
  STANDARD_LAENDERCODE,
  hatAdresse,
  manuellGeaendert,
  vorschlagAnwenden,
} from "./adressvorschlag";
import type { Adressfeld, Feldherkunft } from "./adressvorschlag";
import { KundenAuswahl } from "./KundenAuswahl";
import type { Suchergebnis } from "./KundenAuswahl";
import { START_EBENE, START_HOEHE_MM } from "./startstruktur";

export type ProjektWerte = {
  customer_id: string;
  name: string;
  site_street: string;
  site_postal_code: string;
  site_city: string;
  site_country_code: string;
  /** Startstruktur anlegen? Voreingestellt ja - siehe Dialogtext. */
  startstruktur: boolean;
  gebaeudename: string;
  geschossname: string;
};

export const LEERES_PROJEKT: ProjektWerte = {
  customer_id: "",
  name: "",
  site_street: "",
  site_postal_code: "",
  site_city: "",
  site_country_code: STANDARD_LAENDERCODE,
  startstruktur: true,
  gebaeudename: "Hauptgebäude",
  geschossname: "Erdgeschoss",
};

export type Projektfeldfehler = Partial<Record<keyof ProjektWerte, string>>;

export type Projektabsendeergebnis = { fehler?: string; felder?: Projektfeldfehler };

const VOM_KUNDEN = "Vom Kunden übernommen";

/**
 * Projektformular im Dialog, samt optionaler Startstruktur.
 *
 * Das Datenmodell `Kunde → Projekt → Gebäude → Geschoss` bleibt unverändert.
 * Der Dialog nimmt dem Alltagsfall nur die Handarbeit ab: Er legt auf Wunsch
 * gleich ein Gebäude und ein Erdgeschoss mit an, und er schlägt die
 * Rechnungsadresse des gewählten Kunden als Baustellenadresse vor
 * (`adressvorschlag.ts`). Übernommene Felder sind gekennzeichnet; eigene
 * Eingaben werden nie still überschrieben. Gesendet wird genau, was sichtbar
 * in den Feldern steht - auch der Ländercode.
 *
 * Wie bei :file:`CustomerFormDialog.tsx` kennt die Komponente keine API.
 */
export function ProjectFormDialog({
  offen,
  suchen,
  onSubmit,
  onClose,
}: {
  offen: boolean;
  /** Serverseitige Kundensuche - siehe :file:`KundenAuswahl.tsx`. */
  suchen: (begriff: string) => Promise<Suchergebnis>;
  onSubmit: (werte: ProjektWerte) => Promise<Projektabsendeergebnis | undefined>;
  onClose: () => void;
}) {
  const masse = useMasse();
  const [werte, setWerte] = useState<ProjektWerte>(LEERES_PROJEKT);
  const [herkunft, setHerkunft] = useState<Feldherkunft>(ANFANGSHERKUNFT);
  const [kunde, setKunde] = useState<CustomerOut | null>(null);
  const [felder, setFelder] = useState<Projektfeldfehler>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const zuruecksetzen = () => {
    setWerte(LEERES_PROJEKT);
    setHerkunft(ANFANGSHERKUNFT);
    setKunde(null);
    setFelder({});
    setFehler(null);
  };

  const schliessen = () => {
    zuruecksetzen();
    onClose();
  };

  const kundeWaehlen = (gewaehlt: CustomerOut | null) => {
    setKunde(gewaehlt);
    if (gewaehlt === null) {
      // Adressdaten bleiben stehen - nichts verschwindet unbemerkt.
      setWerte({ ...werte, customer_id: "" });
      return;
    }
    const vorschlag = vorschlagAnwenden(werte, herkunft, gewaehlt);
    setWerte({ ...werte, ...vorschlag.werte, customer_id: gewaehlt.id });
    setHerkunft(vorschlag.herkunft);
  };

  const adresseUebernehmen = () => {
    if (kunde === null) return;
    const vorschlag = vorschlagAnwenden(werte, herkunft, kunde, { erzwingen: true });
    setWerte({ ...werte, ...vorschlag.werte });
    setHerkunft(vorschlag.herkunft);
  };

  const adresseAendern = (feld: Adressfeld, wert: string) => {
    setWerte({ ...werte, [feld]: wert });
    setHerkunft(manuellGeaendert(herkunft, feld));
  };

  const herkunftHinweis = (feld: Adressfeld) => (herkunft[feld] === "kunde" ? VOM_KUNDEN : undefined);

  const absenden = async () => {
    if (laeuft) return;
    const pflicht: Projektfeldfehler = {};
    if (werte.customer_id === "") pflicht.customer_id = "Bitte einen Kunden auswählen.";
    if (werte.name.trim().length === 0) pflicht.name = "Bitte eine Bezeichnung angeben.";
    if (!/^[A-Za-z]{2}$/.test(werte.site_country_code.trim())) {
      pflicht.site_country_code = "Bitte einen zweistelligen Ländercode angeben, z. B. DE.";
    }
    if (werte.startstruktur && werte.gebaeudename.trim().length === 0) {
      pflicht.gebaeudename = "Bitte einen Gebäudenamen angeben.";
    }
    if (werte.startstruktur && werte.geschossname.trim().length === 0) {
      pflicht.geschossname = "Bitte einen Geschossnamen angeben.";
    }
    if (Object.keys(pflicht).length > 0) {
      setFelder(pflicht);
      return;
    }

    setLaeuft(true);
    try {
      const ergebnis = await onSubmit({
        ...werte,
        site_country_code: werte.site_country_code.trim().toUpperCase(),
      });
      if (ergebnis === undefined) {
        zuruecksetzen();
        return;
      }
      setFelder(ergebnis.felder ?? {});
      setFehler(ergebnis.fehler ?? null);
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Dialog
      offen={offen}
      titel="Neues Projekt"
      beschreibung="Die Projektnummer vergibt das System."
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
        <KundenAuswahl
          id="projekt-kunde"
          zweck="zuordnung"
          required
          gewaehlt={kunde}
          disabled={laeuft}
          fehler={felder.customer_id}
          suchen={suchen}
          onChange={kundeWaehlen}
        />
        <Feld
          id="projekt-name"
          label="Bezeichnung"
          value={werte.name}
          required
          disabled={laeuft}
          fehler={felder.name}
          onChange={(name) => setWerte({ ...werte, name })}
        />

        <fieldset className="form-grid__block">
          <legend>Baustellenadresse</legend>
          <p className="muted">
            {kunde === null
              ? "Nach der Kundenwahl wird die Rechnungsadresse des Kunden vorgeschlagen. Die Projektadresse bleibt davon unabhängig."
              : "Vorschlag aus der Rechnungsadresse des Kunden. Die Projektadresse ist eine eigene Angabe - spätere Änderungen am Kunden ändern sie nicht."}
          </p>
          {kunde !== null && hatAdresse(kunde) && (
            <button
              type="button"
              className="button button--ghost"
              disabled={laeuft}
              onClick={adresseUebernehmen}
            >
              Kundenadresse übernehmen
            </button>
          )}
          <div className="feldzeile">
            <Feld
              id="projekt-street"
              label="Straße"
              value={werte.site_street}
              disabled={laeuft}
              fehler={felder.site_street}
              hinweis={herkunftHinweis("site_street")}
              onChange={(wert) => adresseAendern("site_street", wert)}
            />
            <Feld
              id="projekt-plz"
              label="PLZ"
              value={werte.site_postal_code}
              disabled={laeuft}
              fehler={felder.site_postal_code}
              hinweis={herkunftHinweis("site_postal_code")}
              onChange={(wert) => adresseAendern("site_postal_code", wert)}
            />
            <Feld
              id="projekt-ort"
              label="Ort"
              value={werte.site_city}
              disabled={laeuft}
              fehler={felder.site_city}
              hinweis={herkunftHinweis("site_city")}
              onChange={(wert) => adresseAendern("site_city", wert)}
            />
            <Feld
              id="projekt-land"
              label="Ländercode"
              value={werte.site_country_code}
              disabled={laeuft}
              fehler={felder.site_country_code}
              hinweis={herkunftHinweis("site_country_code") ?? "Zwei Buchstaben, z. B. DE, AT, CH"}
              onChange={(wert) => adresseAendern("site_country_code", wert.toUpperCase())}
            />
          </div>
        </fieldset>

        <fieldset className="form-grid__block">
          <legend>Startstruktur</legend>
          <Schalter
            id="projekt-startstruktur"
            label="Gebäude und Geschoss gleich mit anlegen"
            checked={werte.startstruktur}
            disabled={laeuft}
            onChange={(startstruktur) => setWerte({ ...werte, startstruktur })}
          />
          <p className="muted">
            Für den Regelfall. Bei einem Serviceauftrag ohne Raumplanung einfach
            abwählen — Gebäude und Geschosse lassen sich später jederzeit ergänzen.
          </p>
          {werte.startstruktur && (
            <div className="feldzeile">
              <Feld
                id="projekt-gebaeude"
                label="Gebäude"
                value={werte.gebaeudename}
                disabled={laeuft}
                fehler={felder.gebaeudename}
                onChange={(gebaeudename) => setWerte({ ...werte, gebaeudename })}
              />
              <Feld
                id="projekt-geschoss"
                label="Geschoss"
                value={werte.geschossname}
                disabled={laeuft}
                fehler={felder.geschossname}
                hinweis={`Ebene ${START_EBENE}, Standardhöhe ${masse.anzeigen(START_HOEHE_MM)}`}
                onChange={(geschossname) => setWerte({ ...werte, geschossname })}
              />
            </div>
          )}
        </fieldset>

        <div className="form-grid__actions dialog__aktionen">
          {fehler !== null && (
            <p className="alert alert--error" role="alert">
              {fehler}
            </p>
          )}
          <div className="button-row">
            <button className="button button--primary" type="submit" disabled={laeuft}>
              {laeuft ? "Wird angelegt ..." : "Projekt anlegen"}
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
