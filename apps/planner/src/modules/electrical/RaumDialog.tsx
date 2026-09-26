import { useState } from "react";

import { Dialog } from "../../core/ui/Dialog";
import { Feld } from "../../core/ui/Feld";

export type Raumwerte = {
  name: string;
  room_number: string;
  /** Leer bedeutet: Standardhöhe des Geschosses gilt. */
  height_mm: string;
};

export const LEERER_RAUM: Raumwerte = { name: "", room_number: "", height_mm: "" };

export type Raumfeldfehler = Partial<Record<keyof Raumwerte, string>>;

export type Raumergebnis = { fehler?: string; felder?: Raumfeldfehler };

/**
 * Raum anlegen oder bearbeiten.
 *
 * Wie die Dialoge aus Phase 2 kennt die Komponente **keine** API: Sie sammelt
 * Eingaben und meldet sie über `onSubmit`. Die Seite entscheidet, was damit
 * passiert. Das hält die Komponente testbar und die Zuständigkeit eindeutig.
 *
 * Eingaben bleiben bei jedem Fehler erhalten, und ein laufender Absendevorgang
 * sperrt den Knopf - eine doppelte Übermittlung ist ausgeschlossen.
 */
export function RaumDialog({
  offen,
  titel,
  startwerte,
  standardhoehe_mm,
  onSubmit,
  onClose,
}: {
  offen: boolean;
  titel: string;
  startwerte?: Raumwerte | undefined;
  /** Standardhöhe des Geschosses - als Hinweis am Feld. */
  standardhoehe_mm: number;
  onSubmit: (werte: Raumwerte) => Promise<Raumergebnis | undefined>;
  onClose: () => void;
}) {
  // Kein Effekt fuer die Startwerte: Die aufrufende Seite gibt dem Dialog
  // einen ``key`` je bearbeitetem Datensatz. React montiert ihn damit neu,
  // und der Anfangszustand ist genau der uebergebene. Ein Effekt, der den
  // Zustand nachtraeglich ueberschreibt, waere eine zweite Wahrheit.
  const [werte, setWerte] = useState<Raumwerte>(startwerte ?? LEERER_RAUM);
  const [felder, setFelder] = useState<Raumfeldfehler>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const schliessen = () => {
    setFelder({});
    setFehler(null);
    onClose();
  };

  const absenden = async () => {
    if (laeuft) return;
    const pflicht: Raumfeldfehler = {};
    if (werte.name.trim().length === 0) pflicht.name = "Bitte eine Bezeichnung angeben.";
    if (werte.height_mm.trim() !== "" && !/^\d+$/.test(werte.height_mm.trim())) {
      pflicht.height_mm = "Bitte eine ganze Zahl in Millimetern angeben.";
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
      beschreibung="Maße in Millimetern (ganze Zahlen)."
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
          id="raum-name"
          label="Bezeichnung"
          value={werte.name}
          required
          disabled={laeuft}
          fehler={felder.name}
          onChange={(name) => setWerte({ ...werte, name })}
        />
        <Feld
          id="raum-nummer"
          label="Raumnummer (optional)"
          value={werte.room_number}
          disabled={laeuft}
          fehler={felder.room_number}
          hinweis="Je Geschoss nur einmal vergebbar."
          onChange={(room_number) => setWerte({ ...werte, room_number })}
        />
        <Feld
          id="raum-hoehe"
          label="Raumhöhe (mm, optional)"
          type="number"
          value={werte.height_mm}
          disabled={laeuft}
          fehler={felder.height_mm}
          hinweis={`Leer lassen: Standardhöhe des Geschosses (${standardhoehe_mm} mm).`}
          onChange={(height_mm) => setWerte({ ...werte, height_mm })}
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
