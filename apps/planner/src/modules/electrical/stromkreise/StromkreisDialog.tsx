import { useState } from "react";

import { Dialog } from "../../../core/ui/Dialog";
import { Auswahl, Feld, Schalter } from "../../../core/ui/Feld";
import { AKTION } from "../../../core/ui/aktionssymbole";
import { MitSymbol } from "../../../core/ui/Symbol";
import {
  FORMULARRASTER,
  FORMULARRASTER_BLOCK,
  FORMULARRASTER_LEGENDE,
  KNOPFZEILE,
  knopf,
  meldungsflaeche,
} from "../../../core/ui/stil";
import { querschnittLesen } from "./daten";
import { VORSCHLAG_HINWEIS } from "./texte";

export interface Stromkreiswerte {
  designation: string;
  name: string;
  proposed_cable_type: string;
  proposed_conductor_count: string;
  /** Eingabetext, Komma oder Punkt. */
  proposed_cross_section: string;
  protective_device: string;
  rcd_group: string;
  phase_count: string;
  note: string;
  /** Phase 6c (ADR 0027, F1): Kabelvorgabe für neue Leitungen ausdrücklich vor Vorlagen. */
  vorrang: boolean;
}

export const LEERER_STROMKREIS: Stromkreiswerte = {
  designation: "",
  name: "",
  proposed_cable_type: "",
  proposed_conductor_count: "",
  proposed_cross_section: "",
  protective_device: "",
  rcd_group: "",
  phase_count: "",
  note: "",
  vorrang: false,
};

type Feldname = Exclude<keyof Stromkreiswerte, "vorrang">;
export type Stromkreisfehler = Partial<Record<Feldname, string>>;
export type Stromkreisergebnis = { fehler?: string; felder?: Stromkreisfehler } | undefined;

/** Anfragekörper aus den Formularwerten - leere optionale Angaben werden `null`. */
export interface Stromkreisanfrage {
  designation: string;
  name: string;
  proposed_cable_type: string | null;
  proposed_conductor_count: number | null;
  proposed_cross_section_mm2: string | null;
  protective_device: string | null;
  rcd_group: string | null;
  phase_count: 1 | 2 | 3 | null;
  note: string | null;
  proposal_overrides_templates: boolean;
}

function optional(text: string): string | null {
  const wert = text.trim();
  return wert === "" ? null : wert;
}

/** Prüft die Eingaben lokal und baut die Anfrage; Format, keine fachliche Prüfung. */
export function stromkreisAnfrage(
  werte: Stromkreiswerte,
): { ok: true; anfrage: Stromkreisanfrage } | { ok: false; felder: Stromkreisfehler } {
  const felder: Stromkreisfehler = {};
  if (werte.designation.trim() === "") felder.designation = "Bitte eine Bezeichnung angeben, z. B. F3.";
  if (werte.name.trim() === "") felder.name = "Bitte einen Namen angeben.";
  let leiter: number | null = null;
  if (werte.proposed_conductor_count.trim() !== "") {
    const zahl = Number(werte.proposed_conductor_count.trim());
    if (!Number.isInteger(zahl) || zahl < 1 || zahl > 100) felder.proposed_conductor_count = "Bitte eine ganze Zahl von 1 bis 100.";
    else leiter = zahl;
  }
  const querschnitt = querschnittLesen(werte.proposed_cross_section);
  if (!querschnitt.ok) felder.proposed_cross_section = querschnitt.fehler;
  if (Object.keys(felder).length > 0 || !querschnitt.ok) return { ok: false, felder };
  const phasen = werte.phase_count === "1" ? 1 : werte.phase_count === "2" ? 2 : werte.phase_count === "3" ? 3 : null;
  return {
    ok: true,
    anfrage: {
      designation: werte.designation.trim(),
      name: werte.name.trim(),
      proposed_cable_type: optional(werte.proposed_cable_type),
      proposed_conductor_count: leiter,
      proposed_cross_section_mm2: querschnitt.wert,
      protective_device: optional(werte.protective_device),
      rcd_group: optional(werte.rcd_group),
      phase_count: phasen,
      note: optional(werte.note),
      proposal_overrides_templates: werte.vorrang,
    },
  };
}

/**
 * Stromkreis anlegen oder bearbeiten (Phase 6b.1). Sofortige Speicherung über
 * `onSubmit`. Die Kabelangaben sind ausdrücklich **Vorschläge** für neue
 * Leitungen; nichts wird berechnet, ausgewählt oder geprüft.
 */
export function StromkreisDialog({
  titel,
  verteilung,
  startwerte,
  onSubmit,
  onClose,
}: {
  titel: string;
  verteilung: string;
  startwerte: Stromkreiswerte;
  onSubmit: (anfrage: Stromkreisanfrage) => Promise<Stromkreisergebnis>;
  onClose: () => void;
}) {
  const [werte, setWerte] = useState<Stromkreiswerte>(startwerte);
  const [felder, setFelder] = useState<Stromkreisfehler>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const setze = (feld: Feldname) => (wert: string) => setWerte({ ...werte, [feld]: wert });
  const unvollstaendig =
    werte.vorrang &&
    [werte.proposed_cable_type, werte.proposed_conductor_count, werte.proposed_cross_section].some((t) => t.trim() === "");

  const absenden = async () => {
    if (laeuft) return;
    const geprueft = stromkreisAnfrage(werte);
    if (!geprueft.ok) {
      setFelder(geprueft.felder);
      return;
    }
    setLaeuft(true);
    try {
      const ergebnis = await onSubmit(geprueft.anfrage);
      if (ergebnis === undefined) return;
      setFelder(ergebnis.felder ?? {});
      setFehler(ergebnis.fehler ?? null);
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Dialog offen titel={titel} beschreibung={`Verteilung ${verteilung}`} onClose={onClose}>
      <form
        className={FORMULARRASTER}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void absenden();
        }}
      >
        <Feld id="kreis-bezeichnung" label="Bezeichnung" value={werte.designation} required disabled={laeuft} fehler={felder.designation} hinweis="Je Verteilung eindeutig, z. B. F3." onChange={setze("designation")} />
        <Feld id="kreis-name" label="Name" value={werte.name} required disabled={laeuft} fehler={felder.name} hinweis="Z. B. „Küche Steckdosen“." onChange={setze("name")} />
        <fieldset className={FORMULARRASTER_BLOCK}>
          <legend className={FORMULARRASTER_LEGENDE}>Kabelangaben – Vorschlag für neue Leitungen</legend>
          <p className="m-0 mb-2 text-label text-muted">{VORSCHLAG_HINWEIS}</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
            <Feld id="kreis-leitungstyp" label="Leitungstyp (Vorschlag)" value={werte.proposed_cable_type} disabled={laeuft} fehler={felder.proposed_cable_type} hinweis="Z. B. NYM-J." onChange={setze("proposed_cable_type")} />
            <Feld id="kreis-leiter" label="Leiteranzahl (Vorschlag)" inputMode="numeric" value={werte.proposed_conductor_count} disabled={laeuft} fehler={felder.proposed_conductor_count} onChange={setze("proposed_conductor_count")} />
            <Feld id="kreis-querschnitt" label="Querschnitt in mm² (Vorschlag)" inputMode="decimal" value={werte.proposed_cross_section} disabled={laeuft} fehler={felder.proposed_cross_section} hinweis="Z. B. 1,5." onChange={setze("proposed_cross_section")} />
          </div>
          <div className="mt-3">
            <Schalter
              id="kreis-vorrang"
              label="Für neue Leitungen dieses Stromkreises diese Kabelvorgabe verwenden"
              checked={werte.vorrang}
              disabled={laeuft}
              onChange={(an) => setWerte({ ...werte, vorrang: an })}
            />
            <p className="m-0 mt-1 text-label text-muted" data-testid="kreis-vorrang-hinweis">
              {werte.vorrang
                ? "Aktiviert: Neue Leitungen erhalten diese Angaben vor den Kabelvorlagen der Gerätetypen. Bestehende Leitungen ändern sich nicht."
                : "Nicht aktiviert: Die Angaben bleiben ein Hinweis; neue Leitungen erhalten die Kabelvorlage ihres Gerätetyps."}
            </p>
            {unvollstaendig && (
              <p className={`${meldungsflaeche("schlicht")} mt-1`} role="status" data-testid="kreis-vorrang-unvollstaendig">
                Die Kabelvorgabe ist unvollständig. Aktiviert gilt sie als Einheit – fehlende Angaben bleiben bei neuen Leitungen fehlend
                und werden nicht aus einer Vorlage ergänzt.
              </p>
            )}
          </div>
        </fieldset>
        <Feld id="kreis-schutzorgan" label="Schutzorgan (Angabe, optional)" value={werte.protective_device} disabled={laeuft} fehler={felder.protective_device} hinweis="Nur erfasst, nicht geprüft." onChange={setze("protective_device")} />
        <Feld id="kreis-rcd" label="RCD-Gruppe (optional)" value={werte.rcd_group} disabled={laeuft} fehler={felder.rcd_group} onChange={setze("rcd_group")} />
        <Auswahl id="kreis-phasen" label="Phasenzahl (optional)" value={werte.phase_count} disabled={laeuft} onChange={setze("phase_count")}>
          <option value="">nicht angegeben</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </Auswahl>
        <Feld id="kreis-notiz" label="Notiz (optional)" value={werte.note} disabled={laeuft} fehler={felder.note} onChange={setze("note")} />

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
