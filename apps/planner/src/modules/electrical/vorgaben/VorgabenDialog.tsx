import { ApiError } from "@elektroplan/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useAuth } from "../../../core/auth/AuthProvider";
import { Dialog, DialogAktionen } from "../../../core/ui/Dialog";
import { useMasse } from "../../../core/ui/masseinheit";
import { knopf, meldungsflaeche } from "../../../core/ui/stil";
import { katalogAbfrage } from "../geraete/katalog";
import { ZUORDENBAR } from "../stromkreise/daten";
import type { Betriebsstandard, Projektvorgabe } from "./daten";
import {
  betriebsstandardAbfrage,
  betriebsstandardSchluessel,
  projektvorgabeAbfrage,
  projektvorgabeSchluessel,
  vorlagenAbfrage,
  vorlagenSchluessel,
  wirksamAbfrage,
  wirksamSchluessel,
} from "./daten";
import { apiFehlerText } from "./fehler";
import type { Formularfehler, Vorgabenformular } from "./formular";
import { anfrageAus, formularAus, serverFeld } from "./formular";
import type { Vorgabenmodus } from "./VorgabenFelder";
import { VorgabenFelder } from "./VorgabenFelder";

/**
 * Betriebsstandard bzw. Projektvorgabe bearbeiten (Phase 6c, Entwurf §8, L3) – im Dialog.
 *
 * Gespeichert wird ausdrücklich mit der gelesenen Version. Bei einem Konflikt bleiben die
 * Eingaben stehen; der Serverstand wird nur auf ausdrücklichen Wunsch geladen. Eine
 * Vorgabenänderung ändert keine bestehende Leitung.
 */
export function VorgabenDialog({
  modus,
  projektId,
  darfSchreiben,
  sperrgrund,
  onClose,
}: {
  modus: Vorgabenmodus;
  /** Pflicht für die Projektvorgabe. */
  projektId?: string | undefined;
  darfSchreiben: boolean;
  /** Warum nicht geschrieben werden darf (Recht, Schreibschutz) – `null`: darf. */
  sperrgrund: string | null;
  onClose: () => void;
}) {
  const { api } = useAuth();
  const masse = useMasse();
  const queryClient = useQueryClient();
  const projekt = modus === "projekt" ? (projektId ?? "") : "";
  const vorlagen = useQuery(vorlagenAbfrage(api));
  const betrieb = useQuery(betriebsstandardAbfrage(api));
  const vorgabe = useQuery({ ...projektvorgabeAbfrage(api, projekt), enabled: modus === "projekt" });
  const wirksam = useQuery({ ...wirksamAbfrage(api, projekt, null), enabled: modus === "projekt" });
  const katalog = useQuery(katalogAbfrage(api));
  const typen = useMemo(
    () => (Array.isArray(katalog.data) ? katalog.data : []).filter((t) => t.is_active && ZUORDENBAR.has(t.category)).sort((a, b) => a.sort_order - b.sort_order),
    [katalog.data],
  );

  const stand: Betriebsstandard | Projektvorgabe | undefined = modus === "projekt" ? vorgabe.data : betrieb.data;
  const [form, setForm] = useState<{ version: number; werte: Vorgabenformular } | null>(null);
  if (form === null && stand !== undefined) setForm({ version: stand.version, werte: formularAus(stand, masse) });
  const [fehler, setFehler] = useState<Formularfehler>({});
  const [meldung, setMeldung] = useState<string | null>(null);
  const [konflikt, setKonflikt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const gesperrt = !darfSchreiben || laeuft;

  const speichern = async () => {
    if (form === null || gesperrt) return;
    const geprueft = anfrageAus(form.werte, form.version, masse);
    if (!geprueft.ok) {
      setFehler(geprueft.fehler);
      setMeldung("Bitte die markierten Angaben prüfen.");
      return;
    }
    setLaeuft(true);
    setMeldung(null);
    setFehler({});
    try {
      if (modus === "projekt") {
        await api.put("/api/v1/modules/electrical/projects/{project_id}/planning-defaults", { path: { project_id: projekt }, body: geprueft.anfrage });
        await queryClient.invalidateQueries({ queryKey: projektvorgabeSchluessel(projekt) });
        await queryClient.invalidateQueries({ queryKey: wirksamSchluessel(projekt) });
      } else {
        await api.put("/api/v1/modules/electrical/planning-defaults", { body: geprueft.anfrage });
        await queryClient.invalidateQueries({ queryKey: betriebsstandardSchluessel() });
        await queryClient.invalidateQueries({ queryKey: ["electrical", "effective-defaults"] });
      }
      await queryClient.invalidateQueries({ queryKey: vorlagenSchluessel() });
      onClose();
    } catch (error: unknown) {
      const versionskonflikt = error instanceof ApiError && error.errorType === "version-conflict";
      setKonflikt(versionskonflikt);
      const f: Formularfehler = {};
      if (error instanceof ApiError) {
        for (const e of error.problem?.errors ?? []) {
          const feld = serverFeld(e.field);
          if (feld !== null) f[feld] = apiFehlerText(error, e.message);
        }
      }
      setFehler(f);
      setMeldung(apiFehlerText(error, "Die Vorgaben konnten nicht gespeichert werden."));
    } finally {
      setLaeuft(false);
    }
  };

  const serverstandLaden = async () => {
    const frisch =
      modus === "projekt"
        ? await queryClient.fetchQuery({ ...projektvorgabeAbfrage(api, projekt), staleTime: 0 })
        : await queryClient.fetchQuery({ ...betriebsstandardAbfrage(api), staleTime: 0 });
    await queryClient.invalidateQueries({ queryKey: vorlagenSchluessel() });
    setForm({ version: frisch.version, werte: formularAus(frisch, masse) });
    setKonflikt(false);
    setMeldung("Serverstand geladen – Ihre bisherigen Eingaben wurden verworfen.");
    setFehler({});
  };

  const titel = modus === "projekt" ? "Planungsvorgaben des Projekts" : "Betriebsstandard für neue Leitungen";
  const ladefehler = vorlagen.isError || betrieb.isError || (modus === "projekt" && (vorgabe.isError || wirksam.isError));
  return (
    <Dialog offen titel={titel} onClose={onClose}>
      <p className="m-0 mb-3 text-small text-muted">
        {modus === "projekt"
          ? "Gilt für neue Leitungen dieses Projekts. Je Angabe: Betriebsstandard übernehmen oder ausdrücklich abweichen."
          : "Gilt für neue Leitungen aller Projekte, soweit ein Projekt nichts anderes vorgibt. Planungsangaben des Betriebs – keine Bemessung."}
      </p>
      {sperrgrund !== null && (
        <p className={`${meldungsflaeche("schlicht")} m-0 mb-3`} role="status" data-testid="vorgaben-nur-lesen">
          {sperrgrund}
        </p>
      )}
      {ladefehler ? (
        <p className={meldungsflaeche()} role="alert">
          Die Vorgaben konnten nicht geladen werden.
        </p>
      ) : form === null || vorlagen.data === undefined || (modus === "projekt" && betrieb.data === undefined) ? (
        <p className="text-muted">Vorgaben werden geladen …</p>
      ) : (
        <form
          id="vorgaben-formular"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void speichern();
          }}
        >
          <VorgabenFelder
            modus={modus}
            form={form.werte}
            onForm={(werte) => setForm({ ...form, werte })}
            fehler={fehler}
            gesperrt={gesperrt}
            vorlagen={vorlagen.data.templates}
            typen={typen}
            betrieb={betrieb.data}
            wirksam={modus === "projekt" ? wirksam.data : undefined}
          />
        </form>
      )}
      {meldung !== null && (
        <div className={`${meldungsflaeche(konflikt || Object.keys(fehler).length > 0 ? "fehler" : "schlicht")} mt-3`} role="alert" data-testid="vorgaben-meldung">
          <p className="m-0">{meldung}</p>
          {konflikt && (
            <button type="button" className={`${knopf("neutral", { klein: true })} mt-2`} onClick={() => void serverstandLaden()}>
              Serverstand laden (Eingaben verwerfen)
            </button>
          )}
        </div>
      )}
      <DialogAktionen>
        {darfSchreiben && (
          <button type="submit" form="vorgaben-formular" className={knopf("primaer")} disabled={laeuft || form === null}>
            {laeuft ? "Wird gespeichert …" : "Vorgaben speichern"}
          </button>
        )}
        <button type="button" className={knopf()} disabled={laeuft} onClick={onClose}>
          {darfSchreiben ? "Abbrechen" : "Schließen"}
        </button>
      </DialogAktionen>
    </Dialog>
  );
}
