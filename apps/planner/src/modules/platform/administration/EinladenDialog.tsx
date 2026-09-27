import type { InvitationPolicy, SystemRoleOut } from "@elektroplan/api-client";
import { useState } from "react";

import { Dialog } from "../../../core/ui/Dialog";
import { Feld } from "../../../core/ui/Feld";

export type EinladungsWerte = { email: string; name: string; rollen: string[] };

export type Einladungsfehler = Partial<Record<"email" | "full_name" | "role_keys", string>>;

export type Einladungsergebnis = { fehler?: string; felder?: Einladungsfehler };

const LEER: EinladungsWerte = { email: "", name: "", rollen: [] };

/** Bewusst einfach: Die verbindliche Prüfung macht der Server. */
const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * „Benutzer einladen" als modaler Dialog.
 *
 * Nur feste Systemrollen sind wählbar - einzelne Berechtigungen gibt es hier
 * bewusst nicht. Schließen ändert nichts. Während der Übermittlung ist alles
 * gesperrt, ein zweites Absenden ist ausgeschlossen. Bei einem Fehler bleiben
 * die Eingaben erhalten.
 */
export function EinladenDialog({
  offen,
  rollen,
  richtlinie,
  onSubmit,
  onClose,
}: {
  offen: boolean;
  rollen: SystemRoleOut[] | undefined;
  richtlinie: InvitationPolicy | undefined;
  onSubmit: (werte: EinladungsWerte) => Promise<Einladungsergebnis | undefined>;
  onClose: () => void;
}) {
  const [werte, setWerte] = useState<EinladungsWerte>(LEER);
  const [felder, setFelder] = useState<Einladungsfehler>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const ohneZustellung = richtlinie?.delivery === "none";

  const schliessen = () => {
    if (laeuft) return;
    setWerte(LEER);
    setFelder({});
    setFehler(null);
    onClose();
  };

  const rolleUmschalten = (key: string, an: boolean) => {
    setWerte({
      ...werte,
      rollen: an ? [...werte.rollen, key] : werte.rollen.filter((rolle) => rolle !== key),
    });
  };

  const absenden = async () => {
    if (laeuft || ohneZustellung) return;
    const neu: Einladungsfehler = {};
    if (!EMAIL_MUSTER.test(werte.email.trim())) neu.email = "Bitte eine gültige E-Mail-Adresse angeben.";
    if (werte.rollen.length === 0) neu.role_keys = "Bitte mindestens eine Rolle wählen.";
    setFelder(neu);
    if (Object.keys(neu).length > 0) {
      setFehler("Bitte die markierten Felder prüfen.");
      return;
    }
    setFehler(null);
    setLaeuft(true);
    try {
      const ergebnis = await onSubmit({ ...werte, email: werte.email.trim(), name: werte.name.trim() });
      if (ergebnis === undefined) {
        setWerte(LEER);
        setFelder({});
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
      titel="Benutzer einladen"
      beschreibung="Die Person erhält einen Einladungslink und legt damit ihr Konto an - oder bestätigt mit ihrem bestehenden Konto."
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
          id="einladung-email"
          label="E-Mail"
          type="email"
          value={werte.email}
          required
          disabled={laeuft}
          fehler={felder.email}
          onChange={(email) => setWerte({ ...werte, email })}
        />
        <Feld
          id="einladung-name"
          label="Name (optional)"
          value={werte.name}
          disabled={laeuft}
          fehler={felder.full_name}
          hinweis="Nur ein Vorschlag - ein bestehendes Konto behält seinen Namen."
          onChange={(name) => setWerte({ ...werte, name })}
        />
        <fieldset
          className="form-grid__block rollenwahl"
          aria-describedby={felder.role_keys ? "einladung-rollen-fehler" : undefined}
          aria-invalid={felder.role_keys ? true : undefined}
        >
          <legend>Rollen *</legend>
          {rollen === undefined && <p className="muted">Rollen werden geladen ...</p>}
          {rollen?.map((rolle) => {
            const id = `einladung-rolle-${rolle.key}`;
            return (
              <div key={rolle.key} className="rollenwahl__eintrag">
                <input
                  id={id}
                  type="checkbox"
                  checked={werte.rollen.includes(rolle.key)}
                  disabled={laeuft}
                  aria-labelledby={`${id}-name`}
                  aria-describedby={`${id}-zweck`}
                  onChange={(event) => rolleUmschalten(rolle.key, event.target.checked)}
                />
                <label htmlFor={id}>
                  <strong id={`${id}-name`}>{rolle.name}</strong>
                  <span id={`${id}-zweck`} className="muted rollenwahl__zweck">
                    {rolle.description}
                  </span>
                </label>
              </div>
            );
          })}
          {felder.role_keys !== undefined && (
            <span id="einladung-rollen-fehler" className="field__fehler" role="alert">
              {felder.role_keys}
            </span>
          )}
        </fieldset>
        <div className="form-grid__actions dialog__aktionen">
          {richtlinie !== undefined && !ohneZustellung && (
            <p className="muted">
              Die Einladung ist {richtlinie.valid_hours} Stunden gültig und nur einmal verwendbar.
              {richtlinie.delivery === "development_link" &&
                " Entwicklungsumgebung: Es wird keine E-Mail verschickt; der Link erscheint einmalig nach dem Anlegen."}
            </p>
          )}
          {ohneZustellung && (
            <p className="alert alert--error" role="alert">
              Für Einladungen ist noch kein Zustellweg eingerichtet. Einladungen können derzeit
              nicht verschickt werden.
            </p>
          )}
          {fehler !== null && (
            <p className="alert alert--error" role="alert">
              {fehler}
            </p>
          )}
          <div className="button-row">
            <button
              className="button button--primary"
              type="submit"
              disabled={laeuft || ohneZustellung}
            >
              {laeuft ? "Einladung wird erstellt ..." : "Einladung erstellen"}
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
