import { useState } from "react";

import { Dialog } from "../../core/ui/Dialog";
import { Feld } from "../../core/ui/Feld";

export type Wandwerte = {
  x1_mm: string;
  y1_mm: string;
  x2_mm: string;
  y2_mm: string;
  thickness_mm: string;
};

export const LEERE_WAND: Wandwerte = {
  x1_mm: "0",
  y1_mm: "0",
  x2_mm: "0",
  y2_mm: "0",
  thickness_mm: "115",
};

export type Wandfeldfehler = Partial<Record<keyof Wandwerte, string>>;

export type Wandergebnis = { fehler?: string; felder?: Wandfeldfehler };

const GANZZAHL = /^-?\d+$/;

/**
 * Wand erfassen oder ändern.
 *
 * Die Wand ist ein **gerichtetes** Segment: Der Abstand einer Öffnung zählt
 * vom Startpunkt. Der Dialog benennt das, damit die Richtung keine
 * Überraschung ist.
 *
 * Die Prüfung hier ist nur eine schnelle Rückmeldung auf Tippfehler. Die
 * verbindliche Geometrieprüfung - Überschneidung, Dublette, Konturschluss -
 * findet serverseitig statt; ihre Meldungen erscheinen als `fehler`.
 */
export function WandDialog({
  offen,
  titel,
  startwerte,
  onSubmit,
  onClose,
}: {
  offen: boolean;
  titel: string;
  startwerte?: Wandwerte | undefined;
  onSubmit: (werte: Wandwerte) => Promise<Wandergebnis | undefined>;
  onClose: () => void;
}) {
  // Kein Effekt fuer die Startwerte: Die aufrufende Seite gibt dem Dialog
  // einen ``key`` je bearbeitetem Datensatz. React montiert ihn damit neu,
  // und der Anfangszustand ist genau der uebergebene. Ein Effekt, der den
  // Zustand nachtraeglich ueberschreibt, waere eine zweite Wahrheit.
  const [werte, setWerte] = useState<Wandwerte>(startwerte ?? LEERE_WAND);
  const [felder, setFelder] = useState<Wandfeldfehler>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const schliessen = () => {
    setFelder({});
    setFehler(null);
    onClose();
  };

  const absenden = async () => {
    if (laeuft) return;
    const pflicht: Wandfeldfehler = {};
    for (const feld of ["x1_mm", "y1_mm", "x2_mm", "y2_mm", "thickness_mm"] as const) {
      if (!GANZZAHL.test(werte[feld].trim())) {
        pflicht[feld] = "Bitte eine ganze Zahl in Millimetern angeben.";
      }
    }
    if (
      Object.keys(pflicht).length === 0 &&
      werte.x1_mm.trim() === werte.x2_mm.trim() &&
      werte.y1_mm.trim() === werte.y2_mm.trim()
    ) {
      pflicht.x2_mm = "Start- und Endpunkt müssen sich unterscheiden.";
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
      beschreibung={
        "Die Wand verläuft vom Start- zum Endpunkt. Diese Richtung bestimmt, " +
        "wovon der Abstand einer Öffnung gezählt wird. Alle Maße in Millimetern."
      }
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
          id="wand-x1"
          label="Startpunkt X (mm)"
          type="number"
          value={werte.x1_mm}
          required
          disabled={laeuft}
          fehler={felder.x1_mm}
          onChange={(x1_mm) => setWerte({ ...werte, x1_mm })}
        />
        <Feld
          id="wand-y1"
          label="Startpunkt Y (mm)"
          type="number"
          value={werte.y1_mm}
          required
          disabled={laeuft}
          fehler={felder.y1_mm}
          onChange={(y1_mm) => setWerte({ ...werte, y1_mm })}
        />
        <Feld
          id="wand-x2"
          label="Endpunkt X (mm)"
          type="number"
          value={werte.x2_mm}
          required
          disabled={laeuft}
          fehler={felder.x2_mm}
          onChange={(x2_mm) => setWerte({ ...werte, x2_mm })}
        />
        <Feld
          id="wand-y2"
          label="Endpunkt Y (mm)"
          type="number"
          value={werte.y2_mm}
          required
          disabled={laeuft}
          fehler={felder.y2_mm}
          onChange={(y2_mm) => setWerte({ ...werte, y2_mm })}
        />
        <Feld
          id="wand-staerke"
          label="Wandstärke (mm)"
          type="number"
          value={werte.thickness_mm}
          required
          disabled={laeuft}
          fehler={felder.thickness_mm}
          hinweis="Üblich: 115 mm innen, 365 mm außen."
          onChange={(thickness_mm) => setWerte({ ...werte, thickness_mm })}
        />

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
