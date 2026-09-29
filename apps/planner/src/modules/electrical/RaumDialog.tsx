import { useState } from "react";

import { Dialog } from "../../core/ui/Dialog";
import { Feld } from "../../core/ui/Feld";
import { EINGABEHINWEIS, eingabeUmrechnen, mmAlsEingabeOptional } from "../../core/masse";
import { useEinheitenwechsel, useMasse } from "../../core/ui/masseinheit";
import { FORMULARRASTER, KNOPFZEILE, knopf, meldungsflaeche } from "../../core/ui/stil";

export type Raumwerte = {
  name: string;
  room_number: string;
  /**
   * Ganze Millimeter als Text; leer bedeutet: Standardhöhe des Geschosses
   * gilt. Der Dialog nimmt die Höhe in der Anzeigeeinheit entgegen und
   * liefert hier immer Millimeter (`core/masse.ts`).
   */
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
  const masse = useMasse();
  // Das Höhenfeld hält Text in der Anzeigeeinheit, nicht Millimeter.
  const [werte, setWerte] = useState<Raumwerte>(() => {
    const start = startwerte ?? LEERER_RAUM;
    const mm = start.height_mm.trim() === "" ? null : Number(start.height_mm);
    return { ...start, height_mm: mmAlsEingabeOptional(mm, masse.einheit) };
  });
  useEinheitenwechsel((von, nach) =>
    setWerte((alt) => ({ ...alt, height_mm: eingabeUmrechnen(alt.height_mm, von, nach) })),
  );
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
    const hoehe = masse.lesenOptional(werte.height_mm);
    if (!hoehe.ok) pflicht.height_mm = hoehe.fehler;
    else if (hoehe.mm !== null && hoehe.mm <= 0) pflicht.height_mm = "Die Raumhöhe muss größer als 0 sein.";
    if (Object.keys(pflicht).length > 0) {
      setFelder(pflicht);
      return;
    }

    setLaeuft(true);
    try {
      const ergebnis = await onSubmit({
        ...werte,
        height_mm: hoehe.ok && hoehe.mm !== null ? String(hoehe.mm) : "",
      });
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
      beschreibung={EINGABEHINWEIS[masse.einheit]}
      onClose={schliessen}
    >
      <form
        className={FORMULARRASTER}
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
          label={`Raumhöhe (${masse.einheit}, optional)`}
          inputMode="decimal"
          value={werte.height_mm}
          disabled={laeuft}
          fehler={felder.height_mm}
          hinweis={`Leer lassen: Standardhöhe des Geschosses (${masse.anzeigen(standardhoehe_mm)}).`}
          onChange={(height_mm) => setWerte({ ...werte, height_mm })}
        />

        {fehler !== null && (
          <p className={meldungsflaeche()} role="alert">
            {fehler}
          </p>
        )}

        <div className={KNOPFZEILE}>
          <button className={knopf("primaer")} type="submit" disabled={laeuft}>
            {laeuft ? "Wird gespeichert ..." : "Speichern"}
          </button>
          <button
            className={knopf()}
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
