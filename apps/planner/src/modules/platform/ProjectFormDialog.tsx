import type { CustomerOut } from "@elektroplan/api-client";
import { useState } from "react";

import { Feld, Schalter } from "../../core/ui/Feld";
import { Dialog } from "../../core/ui/Dialog";
import { KundenAuswahl } from "./KundenAuswahl";
import type { Suchergebnis } from "./KundenAuswahl";

export type ProjektWerte = {
  customer_id: string;
  name: string;
  site_street: string;
  site_postal_code: string;
  site_city: string;
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
  startstruktur: true,
  gebaeudename: "Hauptgebäude",
  geschossname: "Erdgeschoss",
};

export type Projektfeldfehler = Partial<Record<keyof ProjektWerte, string>>;

export type Projektabsendeergebnis = { fehler?: string; felder?: Projektfeldfehler };

/**
 * Projektformular im Dialog, samt optionaler Startstruktur.
 *
 * Das Datenmodell `Kunde → Projekt → Gebäude → Geschoss` bleibt unverändert.
 * Der Dialog nimmt dem Alltagsfall nur die Handarbeit ab: Er legt auf Wunsch
 * gleich ein Gebäude und ein Erdgeschoss mit an. Die Namen sind änderbar, und
 * wer die Struktur nicht braucht - etwa bei einem Serviceauftrag - schaltet
 * sie ab.
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
  const [werte, setWerte] = useState<ProjektWerte>(LEERES_PROJEKT);
  const [kunde, setKunde] = useState<CustomerOut | null>(null);
  const [felder, setFelder] = useState<Projektfeldfehler>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const schliessen = () => {
    setWerte(LEERES_PROJEKT);
    setKunde(null);
    setFelder({});
    setFehler(null);
    onClose();
  };

  const absenden = async () => {
    if (laeuft) return;
    const pflicht: Projektfeldfehler = {};
    if (werte.customer_id === "") pflicht.customer_id = "Bitte einen Kunden auswählen.";
    if (werte.name.trim().length === 0) pflicht.name = "Bitte eine Bezeichnung angeben.";
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
      const ergebnis = await onSubmit(werte);
      if (ergebnis === undefined) {
        setWerte(LEERES_PROJEKT);
        setKunde(null);
        setFelder({});
        setFehler(null);
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
          gewaehlt={kunde}
          disabled={laeuft}
          fehler={felder.customer_id}
          suchen={suchen}
          onChange={(gewaehlt) => {
            setKunde(gewaehlt);
            setWerte({ ...werte, customer_id: gewaehlt?.id ?? "" });
          }}
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
        <Feld
          id="projekt-street"
          label="Baustelle: Straße"
          value={werte.site_street}
          disabled={laeuft}
          fehler={felder.site_street}
          onChange={(site_street) => setWerte({ ...werte, site_street })}
        />
        <Feld
          id="projekt-plz"
          label="Baustelle: PLZ"
          value={werte.site_postal_code}
          disabled={laeuft}
          fehler={felder.site_postal_code}
          onChange={(site_postal_code) => setWerte({ ...werte, site_postal_code })}
        />
        <Feld
          id="projekt-ort"
          label="Baustelle: Ort"
          value={werte.site_city}
          disabled={laeuft}
          fehler={felder.site_city}
          onChange={(site_city) => setWerte({ ...werte, site_city })}
        />

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
            <div className="inline-form">
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
                hinweis="Ebene 0, Standardhöhe 2500 mm"
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
