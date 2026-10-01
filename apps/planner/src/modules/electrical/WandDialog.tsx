import { useState } from "react";

import { Dialog } from "../../core/ui/Dialog";
import { EINGABEHINWEIS, eingabenAusMm, eingabenLesen, eingabenUmrechnen } from "../../core/masse";
import { Feld } from "../../core/ui/Feld";
import { useEinheitenwechsel, useMasse } from "../../core/ui/masseinheit";
import { FORMULARRASTER, KNOPFZEILE, knopf, meldungsflaeche } from "../../core/ui/stil";
import { AKTION } from "../../core/ui/aktionssymbole";
import { MitSymbol } from "../../core/ui/Symbol";

/** Ganze Millimeter als Text - in beide Richtungen. Die Anzeigeeinheit gilt nur im Dialog. */
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

const MASSFELDER = ["x1_mm", "y1_mm", "x2_mm", "y2_mm", "thickness_mm"] as const;

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
  const masse = useMasse();
  // Die Felder halten Text in der Anzeigeeinheit; gesendet werden Millimeter.
  const [werte, setWerte] = useState<Wandwerte>(() =>
    eingabenAusMm(startwerte ?? LEERE_WAND, MASSFELDER, masse.einheit),
  );
  useEinheitenwechsel((von, nach) => setWerte((alt) => eingabenUmrechnen(alt, MASSFELDER, von, nach)));
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
    const gelesen = eingabenLesen(werte, MASSFELDER, masse.einheit);
    const pflicht: Wandfeldfehler = { ...gelesen.fehler };
    const { x1_mm, y1_mm, x2_mm, y2_mm, thickness_mm } = gelesen.mm;
    if (Object.keys(pflicht).length === 0 && x1_mm === x2_mm && y1_mm === y2_mm) {
      pflicht.x2_mm = "Start- und Endpunkt müssen sich unterscheiden.";
    }
    if (thickness_mm !== undefined && thickness_mm <= 0) {
      pflicht.thickness_mm = "Die Wandstärke muss größer als 0 sein.";
    }
    if (Object.keys(pflicht).length > 0) {
      setFelder(pflicht);
      return;
    }

    setLaeuft(true);
    try {
      const ergebnis = await onSubmit({
        x1_mm: String(x1_mm),
        y1_mm: String(y1_mm),
        x2_mm: String(x2_mm),
        y2_mm: String(y2_mm),
        thickness_mm: String(thickness_mm),
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
      beschreibung={
        "Die Wand verläuft vom Start- zum Endpunkt. Diese Richtung bestimmt, " +
        `wovon der Abstand einer Öffnung gezählt wird. ${EINGABEHINWEIS[masse.einheit]}`
      }
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
          id="wand-x1"
          label={masse.label("Startpunkt X")}
          inputMode="decimal"
          value={werte.x1_mm}
          required
          disabled={laeuft}
          fehler={felder.x1_mm}
          onChange={(x1_mm) => setWerte({ ...werte, x1_mm })}
        />
        <Feld
          id="wand-y1"
          label={masse.label("Startpunkt Y")}
          inputMode="decimal"
          value={werte.y1_mm}
          required
          disabled={laeuft}
          fehler={felder.y1_mm}
          onChange={(y1_mm) => setWerte({ ...werte, y1_mm })}
        />
        <Feld
          id="wand-x2"
          label={masse.label("Endpunkt X")}
          inputMode="decimal"
          value={werte.x2_mm}
          required
          disabled={laeuft}
          fehler={felder.x2_mm}
          onChange={(x2_mm) => setWerte({ ...werte, x2_mm })}
        />
        <Feld
          id="wand-y2"
          label={masse.label("Endpunkt Y")}
          inputMode="decimal"
          value={werte.y2_mm}
          required
          disabled={laeuft}
          fehler={felder.y2_mm}
          onChange={(y2_mm) => setWerte({ ...werte, y2_mm })}
        />
        <Feld
          id="wand-staerke"
          label={masse.label("Wandstärke")}
          inputMode="decimal"
          value={werte.thickness_mm}
          required
          disabled={laeuft}
          fehler={felder.thickness_mm}
          hinweis={`Üblich: ${masse.anzeigen(115)} innen, ${masse.anzeigen(365)} außen.`}
          onChange={(thickness_mm) => setWerte({ ...werte, thickness_mm })}
        />

        {fehler !== null && (
          <p className={meldungsflaeche()} role="alert">
            {fehler}
          </p>
        )}

        <div className={KNOPFZEILE}>
          <button className={knopf("primaer")} type="submit" disabled={laeuft}>
            <MitSymbol icon={AKTION.speichern}>{laeuft ? "Wird gespeichert ..." : "Speichern"}</MitSymbol>
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
