import { useState } from "react";

import { Dialog } from "../../core/ui/Dialog";
import { EINGABEHINWEIS, eingabenAusMm, eingabenLesen, eingabenUmrechnen } from "../../core/masse";
import { Auswahl, Feld } from "../../core/ui/Feld";
import { useEinheitenwechsel, useMasse } from "../../core/ui/masseinheit";
import { FORMULARRASTER, KNOPFZEILE, knopf, meldungsflaeche } from "../../core/ui/stil";
import { OEFFNUNGSARTEN } from "./texte";
import type { Oeffnungsart } from "./texte";

/** Maße als ganze Millimeter in Textform - in beide Richtungen. */
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

const MASSFELDER = ["offset_mm", "width_mm", "height_mm", "sill_height_mm"] as const;

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
  const masse = useMasse();
  // Die Felder halten Text in der Anzeigeeinheit; gesendet werden Millimeter.
  const [werte, setWerte] = useState<Oeffnungswerte>(() =>
    eingabenAusMm(startwerte ?? LEERE_OEFFNUNG, MASSFELDER, masse.einheit),
  );
  useEinheitenwechsel((von, nach) => setWerte((alt) => eingabenUmrechnen(alt, MASSFELDER, von, nach)));
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
    const gelesen = eingabenLesen(werte, MASSFELDER, masse.einheit);
    const pflicht: Oeffnungsfeldfehler = { ...gelesen.fehler };
    for (const feld of MASSFELDER) {
      const wert = gelesen.mm[feld];
      if (wert !== undefined && wert < 0) pflicht[feld] = "Der Wert darf nicht negativ sein.";
    }
    const { offset_mm: abstand = 0, width_mm: breite = 0 } = gelesen.mm;
    if (Object.keys(pflicht).length === 0) {
      if (breite <= 0) {
        pflicht.width_mm = "Die Breite muss größer als 0 sein.";
      } else if (abstand + breite > wandlaenge_mm) {
        pflicht.width_mm = `Die Öffnung muss in die ${masse.anzeigen(wandlaenge_mm)} lange Wand passen.`;
      }
    }
    if (Object.keys(pflicht).length > 0) {
      setFelder(pflicht);
      return;
    }

    setLaeuft(true);
    try {
      const ergebnis = await onSubmit({
        kind: werte.kind,
        offset_mm: String(gelesen.mm.offset_mm),
        width_mm: String(gelesen.mm.width_mm),
        height_mm: String(gelesen.mm.height_mm),
        sill_height_mm: String(gelesen.mm.sill_height_mm),
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
      beschreibung={`Die Wand ist ${masse.anzeigen(wandlaenge_mm)} lang. ${EINGABEHINWEIS[masse.einheit]}`}
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
          label={masse.label("Abstand vom Wandanfang")}
          inputMode="decimal"
          value={werte.offset_mm}
          required
          disabled={laeuft}
          fehler={felder.offset_mm}
          onChange={(offset_mm) => setWerte({ ...werte, offset_mm })}
        />
        <Feld
          id="oeffnung-breite"
          label={masse.label("Breite")}
          inputMode="decimal"
          value={werte.width_mm}
          required
          disabled={laeuft}
          fehler={felder.width_mm}
          onChange={(width_mm) => setWerte({ ...werte, width_mm })}
        />
        <Feld
          id="oeffnung-hoehe"
          label={masse.label("Höhe")}
          inputMode="decimal"
          value={werte.height_mm}
          required
          disabled={laeuft}
          fehler={felder.height_mm}
          onChange={(height_mm) => setWerte({ ...werte, height_mm })}
        />
        {werte.kind === "window" && (
          <Feld
            id="oeffnung-bruestung"
            label={masse.label("Brüstungshöhe")}
            inputMode="decimal"
            value={werte.sill_height_mm}
            required
            disabled={laeuft}
            fehler={felder.sill_height_mm}
            hinweis="Unterkante über Fertigfußboden."
            onChange={(sill_height_mm) => setWerte({ ...werte, sill_height_mm })}
          />
        )}

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
