import { useState } from "react";

import { Dialog } from "../../../core/ui/Dialog";
import { Auswahl, Feld } from "../../../core/ui/Feld";
import { AKTION } from "../../../core/ui/aktionssymbole";
import { MitSymbol } from "../../../core/ui/Symbol";
import { FORMULARRASTER, KNOPFZEILE, knopf, meldungsflaeche } from "../../../core/ui/stil";
import type { Planergeraet } from "./daten";

export interface Verteilungswerte {
  code: string;
  name: string;
  note: string;
  /** Gerät „Verteilung“ als Lage oder leer = noch nicht im Plan platziert. */
  placement_device_id: string;
}

export type Verteilungsfehler = Partial<Record<"code" | "name" | "note" | "placement_device_id", string>>;
export type Verteilungsergebnis = { fehler?: string; felder?: Verteilungsfehler } | undefined;

/**
 * Verteilung anlegen oder bearbeiten (Phase 6b.1). Kennt keine API: Die Seite
 * speichert über `onSubmit` sofort (Stammdaten werden nicht als Entwurf
 * geführt, Entwurf §9.3). Eingaben bleiben bei Fehlern erhalten.
 *
 * Als Lage werden nur Geräte „Verteilung“ dieses Gebäudes angeboten, die noch
 * keine andere Verteilung platzieren.
 */
export function VerteilungDialog({
  titel,
  gebaeude,
  startwerte,
  lagegeraete,
  onSubmit,
  onClose,
}: {
  titel: string;
  gebaeude: string;
  startwerte: Verteilungswerte;
  lagegeraete: readonly Planergeraet[];
  onSubmit: (werte: Verteilungswerte) => Promise<Verteilungsergebnis>;
  onClose: () => void;
}) {
  const [werte, setWerte] = useState<Verteilungswerte>(startwerte);
  const [felder, setFelder] = useState<Verteilungsfehler>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const absenden = async () => {
    if (laeuft) return;
    const pflicht: Verteilungsfehler = {};
    if (werte.code.trim() === "") pflicht.code = "Bitte einen Code angeben, z. B. UV1.";
    if (werte.name.trim() === "") pflicht.name = "Bitte eine Bezeichnung angeben.";
    if (Object.keys(pflicht).length > 0) {
      setFelder(pflicht);
      return;
    }
    setLaeuft(true);
    try {
      const ergebnis = await onSubmit(werte);
      if (ergebnis === undefined) return;
      setFelder(ergebnis.felder ?? {});
      setFehler(ergebnis.fehler ?? null);
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Dialog offen titel={titel} beschreibung={`Gebäude „${gebaeude}“`} onClose={onClose}>
      <form
        className={FORMULARRASTER}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void absenden();
        }}
      >
        <Feld
          id="verteilung-code"
          label="Code"
          value={werte.code}
          required
          disabled={laeuft}
          fehler={felder.code}
          hinweis="Kurz und je Gebäude eindeutig, z. B. HV oder UV1."
          onChange={(code) => setWerte({ ...werte, code })}
        />
        <Feld
          id="verteilung-name"
          label="Bezeichnung"
          value={werte.name}
          required
          disabled={laeuft}
          fehler={felder.name}
          onChange={(name) => setWerte({ ...werte, name })}
        />
        <Feld
          id="verteilung-notiz"
          label="Notiz (optional)"
          value={werte.note}
          disabled={laeuft}
          fehler={felder.note}
          onChange={(note) => setWerte({ ...werte, note })}
        />
        <Auswahl
          id="verteilung-lage"
          label="Lage im Plan (optional)"
          value={werte.placement_device_id}
          disabled={laeuft}
          fehler={felder.placement_device_id}
          onChange={(placement_device_id) => setWerte({ ...werte, placement_device_id })}
        >
          <option value="">Noch nicht im Plan platziert</option>
          {lagegeraete.map((g) => (
            <option key={g.id} value={g.id}>
              {g.geschoss} · {g.raum} · {g.name}
            </option>
          ))}
        </Auswahl>
        <p className="col-span-full m-0 text-label text-muted">
          Die Lage ist ein Gerät „Verteilung“, das Sie wie jedes Gerät in der Wandansicht setzen. Hier erscheinen nur
          Geräte dieses Gebäudes, die noch keine andere Verteilung platzieren.
        </p>

        {fehler !== null && (
          <p className={meldungsflaeche()} role="alert">
            {fehler}
          </p>
        )}
        <div className={KNOPFZEILE}>
          <button className={knopf("primaer")} type="submit" disabled={laeuft}>
            <MitSymbol icon={AKTION.speichern}>{laeuft ? "Wird gespeichert ..." : "Speichern"}</MitSymbol>
          </button>
          <button className={knopf()} type="button" disabled={laeuft} onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </form>
    </Dialog>
  );
}
