import { useState } from "react";

import { Dialog } from "../../core/ui/Dialog";
import { Auswahl, Feld } from "../../core/ui/Feld";
import { OEFFNUNGSARTEN } from "./texte";
import type { Oeffnungsart } from "./texte";

export type Oeffnungswerte = {
  kind: Oeffnungsart;
  offset_mm: string;
  width_mm: string;
  height_mm: string;
  sill_height_mm: string;
};

export const LEERE_OEFFNUNG: Oeffnungswerte = {
  kind: "door",
  offset_mm: "0",
  width_mm: "1010",
  height_mm: "2010",
  sill_height_mm: "0",
};

export type Oeffnungsfeldfehler = Partial<Record<keyof Oeffnungswerte, string>>;

export type Oeffnungsergebnis = { fehler?: string; felder?: Oeffnungsfeldfehler };

const NICHT_NEGATIV = /^\d+$/;

/**
 * Tür, Fenster oder Durchgang in einer Wand.
 *
 * Die Brüstungshöhe erscheint nur beim Fenster: Bei Tür und Durchgang ist sie
 * immer Null, und ein Feld, das nur den Wert Null annehmen darf, ist kein
 * Eingabefeld, sondern eine Fehlerquelle.
 */
export function OeffnungDialog({
  offen,
  titel,
  wandlaenge_mm,
  startwerte,
  onSubmit,
  onClose,
}: {
  offen: boolean;
  titel: string;
  /** Länge der Wand - die Öffnung muss hineinpassen. */
  wandlaenge_mm: number;
  startwerte?: Oeffnungswerte | undefined;
  onSubmit: (werte: Oeffnungswerte) => Promise<Oeffnungsergebnis | undefined>;
  onClose: () => void;
}) {
  // Kein Effekt fuer die Startwerte: Die aufrufende Seite gibt dem Dialog
  // einen ``key`` je bearbeitetem Datensatz. React montiert ihn damit neu,
  // und der Anfangszustand ist genau der uebergebene. Ein Effekt, der den
  // Zustand nachtraeglich ueberschreibt, waere eine zweite Wahrheit.
  const [werte, setWerte] = useState<Oeffnungswerte>(startwerte ?? LEERE_OEFFNUNG);
  const [felder, setFelder] = useState<Oeffnungsfeldfehler>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const schliessen = () => {
    setFelder({});
    setFehler(null);
    onClose();
  };

  const absenden = async () => {
    if (laeuft) return;
    const pflicht: Oeffnungsfeldfehler = {};
    for (const feld of ["offset_mm", "width_mm", "height_mm", "sill_height_mm"] as const) {
      if (!NICHT_NEGATIV.test(werte[feld].trim())) {
        pflicht[feld] = "Bitte eine ganze Zahl ab 0 angeben.";
      }
    }
    if (Object.keys(pflicht).length === 0) {
      const abstand = Number.parseInt(werte.offset_mm, 10);
      const breite = Number.parseInt(werte.width_mm, 10);
      if (breite <= 0) {
        pflicht.width_mm = "Die Breite muss größer als 0 sein.";
      } else if (abstand + breite > wandlaenge_mm) {
        pflicht.width_mm = `Die Öffnung muss in die ${wandlaenge_mm} mm lange Wand passen.`;
      }
    }
    if (Object.keys(pflicht).length > 0) {
      setFelder(pflicht);
      return;
    }

    setLaeuft(true);
    try {
      const ergebnis = await onSubmit(werte);
      if (ergebnis === undefined) {
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
      titel={titel}
      beschreibung={`Abstand vom Wandanfang. Die Wand ist ${wandlaenge_mm} mm lang.`}
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
        <Auswahl
          id="oeffnung-art"
          label="Art"
          value={werte.kind}
          required
          disabled={laeuft}
          fehler={felder.kind}
          onChange={(wert) =>
            setWerte({
              ...werte,
              kind: wert as Oeffnungsart,
              // Brüstung gibt es nur beim Fenster - beim Wechsel zurücksetzen.
              sill_height_mm: wert === "window" ? werte.sill_height_mm : "0",
            })
          }
        >
          {OEFFNUNGSARTEN.map((art) => (
            <option key={art.wert} value={art.wert}>
              {art.label}
            </option>
          ))}
        </Auswahl>
        <Feld
          id="oeffnung-abstand"
          label="Abstand vom Wandanfang (mm)"
          type="number"
          value={werte.offset_mm}
          required
          disabled={laeuft}
          fehler={felder.offset_mm}
          onChange={(offset_mm) => setWerte({ ...werte, offset_mm })}
        />
        <Feld
          id="oeffnung-breite"
          label="Breite (mm)"
          type="number"
          value={werte.width_mm}
          required
          disabled={laeuft}
          fehler={felder.width_mm}
          onChange={(width_mm) => setWerte({ ...werte, width_mm })}
        />
        <Feld
          id="oeffnung-hoehe"
          label="Höhe (mm)"
          type="number"
          value={werte.height_mm}
          required
          disabled={laeuft}
          fehler={felder.height_mm}
          onChange={(height_mm) => setWerte({ ...werte, height_mm })}
        />
        {werte.kind === "window" && (
          <Feld
            id="oeffnung-bruestung"
            label="Brüstungshöhe (mm)"
            type="number"
            value={werte.sill_height_mm}
            required
            disabled={laeuft}
            fehler={felder.sill_height_mm}
            hinweis="Unterkante über Fertigfußboden."
            onChange={(sill_height_mm) => setWerte({ ...werte, sill_height_mm })}
          />
        )}

        {fehler !== null && (
          <p className="alert alert--error" role="alert">
            {fehler}
          </p>
        )}

        <div className="button-row">
          <button className="button button--primary" type="submit" disabled={laeuft}>
            {laeuft ? "Wird gespeichert ..." : "Speichern"}
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
      </form>
    </Dialog>
  );
}
