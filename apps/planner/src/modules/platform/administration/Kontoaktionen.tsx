import { ApiError } from "@elektroplan/api-client";
import type { MemberOut, PasswordResetIssued } from "@elektroplan/api-client";
import { useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { alsFormularfehler } from "../../../core/api/fehler";
import { useAuth } from "../../../core/auth/AuthProvider";
import { AKTION } from "../../../core/ui/aktionssymbole";
import { Bestaetigung } from "../../../core/ui/Bestaetigung";
import { Dialog, DialogAktionen } from "../../../core/ui/Dialog";
import { Feld } from "../../../core/ui/Feld";
import { MitSymbol } from "../../../core/ui/Symbol";
import {
  FELD,
  FELD_BESCHRIFTUNG,
  FELD_HINWEIS,
  KNOPFZEILE,
  STAPEL,
  eingabefeld,
  karte,
  knopf,
  meldungsflaeche,
} from "../../../core/ui/stil";
import { datum, verwaltungsfehler } from "./texte";

/** Höchstlänge des optionalen Sperrgrunds - wie auf dem Server. */
export const SPERRGRUND_MAX = 200;

type Aktion = "bearbeiten" | "sperren" | "entsperren" | "zuruecksetzen" | "entfernen";

/**
 * Konto und Zugang eines Mitglieds: bearbeiten, sperren, entsperren,
 * Passwort zurücksetzen, entfernen (Phase 4e, ADR 0021).
 *
 * Jede Aktion erscheint nur mit der passenden Berechtigung. Ist sie für dieses
 * Konto ausgeschlossen - eigenes Konto, letzter aktiver Administrator, Konto
 * eines weiteren Betriebs -, bleibt der Knopf sichtbar, aber gesperrt, mit
 * einer Erklärung daneben. Verbindlich prüft ohnehin der Server.
 */
export function Kontoaktionen({
  mitglied,
  betrieb,
  onGeaendert,
}: {
  mitglied: MemberOut;
  betrieb: string;
  onGeaendert: () => Promise<void>;
}) {
  const { permissions } = useAuth();
  const [aktion, setAktion] = useState<Aktion | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<PasswordResetIssued | null>(null);
  const erklaerungId = useId();

  const darfBearbeiten = permissions.has("user.profile.write");
  const darfSperren = permissions.has("user.account.lock");
  const darfZuruecksetzen = permissions.has("user.password.reset");
  const darfEntfernen = permissions.has("user.account.remove");
  const irgendeine = darfBearbeiten || darfSperren || darfZuruecksetzen || darfEntfernen;

  if (mitglied.status === "removed") {
    return (
      <section className={karte()} aria-labelledby="konto-titel">
        <h2 id="konto-titel">Konto</h2>
        <p className={meldungsflaeche("erfolg")}>
          Dieses Konto wurde am {datum(mitglied.updated_at)} entfernt. Name und E-Mail-Adresse
          sind nicht mehr gespeichert; frühere Einträge zeigen „Entfernter Benutzer“. Ein
          entferntes Konto lässt sich nicht bearbeiten, entsperren oder wiederherstellen - die
          Person kann nur neu eingeladen werden.
        </p>
      </section>
    );
  }

  const aktiv = mitglied.status === "active";
  // Warum Sperren und Entfernen hier nicht gehen - in der Reihenfolge der Serverprüfung.
  const zugangsgrenze = mitglied.is_self
    ? "Das eigene Konto kann niemand selbst sperren oder entfernen."
    : mitglied.is_last_active_administrator
      ? "Einziger aktiver Administrator: Bitte zuerst einem anderen Mitglied die Administratorrolle geben."
      : null;
  const kontogrenze = mitglied.account_shared
    ? "Dieses Konto wird auch in einem anderen Betrieb verwendet. Name, E-Mail-Adresse und Passwort ändert deshalb nur die Person selbst."
    : null;

  const fertig = async (text: string) => {
    setAktion(null);
    setMeldung(text);
    await onGeaendert();
  };

  const name = mitglied.full_name ?? "Diese Person";

  return (
    <section className={karte()} aria-labelledby="konto-titel">
      <h2 id="konto-titel">Konto und Zugang zu {betrieb}</h2>
      {meldung !== null && (
        <p className={meldungsflaeche("erfolg")} role="status">
          {meldung}
        </p>
      )}
      <p className="text-muted">
        {aktiv
          ? "Eine Sperre gilt sofort: Alle Sitzungen in diesem Betrieb enden, Rollen und Einstellungen bleiben erhalten."
          : "Der Zugang ist gesperrt. Nach dem Entsperren meldet sich die Person neu an - alte Sitzungen bleiben ungültig."}
      </p>
      {!aktiv && mitglied.lock_reason && (
        <p>
          <span className="text-muted">Sperrgrund: </span>
          {mitglied.lock_reason}
        </p>
      )}
      {!irgendeine && <p className="text-muted">Für Änderungen an Konten fehlt Ihnen die Berechtigung.</p>}
      {irgendeine && (
        <div className={KNOPFZEILE}>
          {darfBearbeiten && (
            <button
              type="button"
              className={knopf()}
              disabled={kontogrenze !== null}
              aria-describedby={kontogrenze !== null ? `${erklaerungId}-konto` : undefined}
              onClick={() => {
                setMeldung(null);
                setAktion("bearbeiten");
              }}
            >
              <MitSymbol icon={AKTION.bearbeiten}>Name und E-Mail bearbeiten</MitSymbol>
            </button>
          )}
          {darfSperren && (
            <button
              type="button"
              className={knopf(aktiv ? "gefahr" : "primaer")}
              disabled={aktiv && zugangsgrenze !== null}
              aria-describedby={aktiv && zugangsgrenze !== null ? `${erklaerungId}-zugang` : undefined}
              onClick={() => {
                setMeldung(null);
                setAktion(aktiv ? "sperren" : "entsperren");
              }}
            >
              <MitSymbol icon={aktiv ? AKTION.sperren : AKTION.entsperren}>
                {aktiv ? "Sperren" : "Entsperren"}
              </MitSymbol>
            </button>
          )}
          {darfZuruecksetzen && (
            <button
              type="button"
              className={knopf()}
              disabled={kontogrenze !== null}
              aria-describedby={kontogrenze !== null ? `${erklaerungId}-konto` : undefined}
              onClick={() => {
                setMeldung(null);
                setAktion("zuruecksetzen");
              }}
            >
              <MitSymbol icon={AKTION.passwortZuruecksetzen}>Passwort zurücksetzen</MitSymbol>
            </button>
          )}
          {darfEntfernen && (
            <button
              type="button"
              className={knopf("gefahr")}
              disabled={zugangsgrenze !== null}
              aria-describedby={zugangsgrenze !== null ? `${erklaerungId}-zugang` : undefined}
              onClick={() => {
                setMeldung(null);
                setAktion("entfernen");
              }}
            >
              <MitSymbol icon={AKTION.entfernen}>Benutzer entfernen</MitSymbol>
            </button>
          )}
        </div>
      )}
      {irgendeine && zugangsgrenze !== null && (darfSperren || darfEntfernen) && (
        <p id={`${erklaerungId}-zugang`} className={`${FELD_HINWEIS} mt-2`}>
          {zugangsgrenze}
        </p>
      )}
      {irgendeine && kontogrenze !== null && (darfBearbeiten || darfZuruecksetzen) && (
        <p id={`${erklaerungId}-konto`} className={`${FELD_HINWEIS} mt-2`}>
          {kontogrenze}
        </p>
      )}

      {aktion === "bearbeiten" && (
        <ProfilDialog
          mitglied={mitglied}
          onAbbrechen={() => setAktion(null)}
          onGespeichert={(emailGeaendert) =>
            void fertig(
              emailGeaendert
                ? "Gespeichert. Angemeldet wird ab jetzt nur noch mit der neuen E-Mail-Adresse; alle bisherigen Sitzungen sind beendet."
                : "Gespeichert.",
            )
          }
          onKonflikt={onGeaendert}
        />
      )}
      {aktion === "sperren" && (
        <SperrDialog
          mitglied={mitglied}
          betrieb={betrieb}
          onAbbrechen={() => setAktion(null)}
          onFertig={() => void fertig(`${name} ist gesperrt. Alle Sitzungen in ${betrieb} sind beendet.`)}
          onKonflikt={onGeaendert}
        />
      )}
      {aktion === "entsperren" && (
        <EntsperrDialog
          mitglied={mitglied}
          betrieb={betrieb}
          onAbbrechen={() => setAktion(null)}
          onFertig={() => void fertig(`${name} ist entsperrt und kann sich neu anmelden.`)}
          onKonflikt={onGeaendert}
        />
      )}
      {aktion === "zuruecksetzen" && (
        <ResetDialog
          mitglied={mitglied}
          onAbbrechen={() => setAktion(null)}
          onErzeugt={(ergebnis) => {
            setAktion(null);
            setResetLink(ergebnis);
          }}
        />
      )}
      {aktion === "entfernen" && (
        <EntfernenDialog
          mitglied={mitglied}
          onAbbrechen={() => setAktion(null)}
          onFertig={() => void fertig("Der Benutzer wurde entfernt.")}
          onKonflikt={onGeaendert}
        />
      )}
      {/* Der Link lebt nur in diesem Zustand: Schließen verwirft ihn endgültig. */}
      <ResetLinkDialog ergebnis={resetLink} name={name} onSchliessen={() => setResetLink(null)} />
    </section>
  );
}

// --------------------------------------------------------------- Bearbeiten

function ProfilDialog({
  mitglied,
  onAbbrechen,
  onGespeichert,
  onKonflikt,
}: {
  mitglied: MemberOut;
  onAbbrechen: () => void;
  onGespeichert: (emailGeaendert: boolean) => void;
  onKonflikt: () => Promise<void>;
}) {
  const { api } = useAuth();
  const [name, setName] = useState(mitglied.full_name ?? "");
  const [email, setEmail] = useState(mitglied.email ?? "");
  const [felder, setFelder] = useState<{ full_name?: string; email?: string }>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const nameNeu = name.trim();
  const emailNeu = email.trim().toLowerCase();
  const nameGeaendert = nameNeu !== (mitglied.full_name ?? "");
  const emailGeaendert = emailNeu !== (mitglied.email ?? "").toLowerCase();

  const absenden = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (laeuft) return;
    const neu: typeof felder = {};
    if (nameNeu === "") neu.full_name = "Bitte einen Namen angeben.";
    if (emailNeu === "" || !emailNeu.includes("@")) neu.email = "Bitte eine gültige E-Mail-Adresse angeben.";
    setFelder(neu);
    if (Object.keys(neu).length > 0) {
      setFehler("Bitte die markierten Felder prüfen.");
      return;
    }
    if (!nameGeaendert && !emailGeaendert) {
      onAbbrechen();
      return;
    }
    setLaeuft(true);
    setFehler(null);
    try {
      await api.patch("/api/v1/members/{member_id}", {
        path: { member_id: mitglied.id },
        ifMatch: mitglied.version,
        body: {
          ...(nameGeaendert ? { full_name: nameNeu } : {}),
          ...(emailGeaendert ? { email: emailNeu } : {}),
        },
      });
      onGespeichert(emailGeaendert);
    } catch (error) {
      if (error instanceof ApiError && error.errorType === "email-unavailable") {
        setFelder({ email: "Diese Adresse ist bereits vergeben oder einer offenen Einladung zugeordnet." });
        setFehler(verwaltungsfehler(error));
      } else if (error instanceof ApiError && error.status === 422) {
        const formular = alsFormularfehler(error, ["full_name", "email"] as const);
        setFelder(formular.felder ?? {});
        setFehler(formular.fehler ?? verwaltungsfehler(error));
      } else {
        setFehler(verwaltungsfehler(error));
        if (error instanceof ApiError && error.status === 409) await onKonflikt();
      }
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Dialog offen titel="Name und E-Mail bearbeiten" onClose={() => (laeuft ? undefined : onAbbrechen())}>
      <form className={STAPEL} noValidate onSubmit={(event) => void absenden(event)}>
        <Feld
          id="profil-name"
          label="Name"
          value={name}
          required
          disabled={laeuft}
          autoComplete="off"
          fehler={felder.full_name}
          onChange={setName}
        />
        <Feld
          id="profil-email"
          label="E-Mail-Adresse"
          type="email"
          value={email}
          required
          disabled={laeuft}
          autoComplete="off"
          fehler={felder.email}
          hinweis="Mit dieser Adresse meldet sich die Person an. Groß- und Kleinschreibung spielt keine Rolle."
          onChange={setEmail}
        />
        {emailGeaendert && (
          <p className={meldungsflaeche("erfolg")} role="note">
            {mitglied.is_self
              ? "Das ist Ihr eigenes Konto: Nach dem Speichern werden Sie überall abgemeldet und melden sich mit der neuen Adresse wieder an."
              : "Nach dem Speichern enden alle Sitzungen dieser Person. Anmelden kann sie sich danach nur noch mit der neuen Adresse."}
          </p>
        )}
        {fehler !== null && (
          <p className={meldungsflaeche()} role="alert">
            {fehler}
          </p>
        )}
        <DialogAktionen>
          <button type="submit" className={knopf("primaer")} disabled={laeuft}>
            {laeuft ? "Wird gespeichert ..." : <MitSymbol icon={AKTION.speichern}>Speichern</MitSymbol>}
          </button>
          <button type="button" className={knopf()} disabled={laeuft} onClick={onAbbrechen}>
            Abbrechen
          </button>
        </DialogAktionen>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------- Sperren, Entsperren

function SperrDialog({
  mitglied,
  betrieb,
  onAbbrechen,
  onFertig,
  onKonflikt,
}: {
  mitglied: MemberOut;
  betrieb: string;
  onAbbrechen: () => void;
  onFertig: () => void;
  onKonflikt: () => Promise<void>;
}) {
  const { api } = useAuth();
  const [grund, setGrund] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const ausfuehren = async () => {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const text = grund.trim();
      await api.post("/api/v1/members/{member_id}/suspend", {
        path: { member_id: mitglied.id },
        ifMatch: mitglied.version,
        body: { reason: text === "" ? null : text },
      });
      onFertig();
    } catch (error) {
      setFehler(verwaltungsfehler(error));
      if (error instanceof ApiError && error.status === 409) await onKonflikt();
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Bestaetigung
      offen
      titel="Benutzer sperren?"
      bestaetigenLabel="Sperren"
      bestaetigenSymbol={AKTION.sperren}
      gefaehrlich
      laeuft={laeuft}
      fehler={fehler}
      onBestaetigen={() => void ausfuehren()}
      onAbbrechen={onAbbrechen}
    >
      <p>
        <strong>{mitglied.full_name}</strong> kann danach nicht mehr in {betrieb} arbeiten und sich
        nicht neu anmelden. Alle Sitzungen enden sofort - auch in bereits geöffneten Fenstern
        beim nächsten Zugriff.
      </p>
      <p className="text-muted">
        Offene Links zum Zurücksetzen des Passworts werden ungültig und leben auch nach dem
        Entsperren nicht wieder auf. Rollen, Einstellungen und frühere Einträge bleiben erhalten.
        Die Sperre lässt sich jederzeit aufheben.
      </p>
      <div className={FELD}>
        <label className={FELD_BESCHRIFTUNG} htmlFor="sperrgrund">
          Sperrgrund (optional)
        </label>
        <textarea
          id="sperrgrund"
          className={`${eingabefeld()} min-h-[4.5rem] resize-y`}
          maxLength={SPERRGRUND_MAX}
          value={grund}
          disabled={laeuft}
          aria-describedby="sperrgrund-hinweis"
          onChange={(event) => setGrund(event.target.value)}
        />
        <span id="sperrgrund-hinweis" className={FELD_HINWEIS}>
          Kurz und sachlich, ohne Gesundheits- oder andere sensible Angaben - höchstens{" "}
          {SPERRGRUND_MAX} Zeichen ({grund.length}/{SPERRGRUND_MAX}).
        </span>
      </div>
    </Bestaetigung>
  );
}

function EntsperrDialog({
  mitglied,
  betrieb,
  onAbbrechen,
  onFertig,
  onKonflikt,
}: {
  mitglied: MemberOut;
  betrieb: string;
  onAbbrechen: () => void;
  onFertig: () => void;
  onKonflikt: () => Promise<void>;
}) {
  const { api } = useAuth();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const ausfuehren = async () => {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    try {
      await api.post("/api/v1/members/{member_id}/reactivate", {
        path: { member_id: mitglied.id },
        ifMatch: mitglied.version,
      });
      onFertig();
    } catch (error) {
      setFehler(verwaltungsfehler(error));
      if (error instanceof ApiError && error.status === 409) await onKonflikt();
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Bestaetigung
      offen
      titel="Benutzer entsperren?"
      bestaetigenLabel="Entsperren"
      bestaetigenSymbol={AKTION.entsperren}
      laeuft={laeuft}
      fehler={fehler}
      onBestaetigen={() => void ausfuehren()}
      onAbbrechen={onAbbrechen}
    >
      <p>
        <strong>{mitglied.full_name}</strong> kann sich danach wieder in {betrieb} anmelden - mit
        den bisherigen Rollen. Frühere Sitzungen bleiben ungültig.
      </p>
    </Bestaetigung>
  );
}

// ------------------------------------------------------- Passwort zurücksetzen

function ResetDialog({
  mitglied,
  onAbbrechen,
  onErzeugt,
}: {
  mitglied: MemberOut;
  onAbbrechen: () => void;
  onErzeugt: (ergebnis: PasswordResetIssued) => void;
}) {
  const { api } = useAuth();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const ausfuehren = async () => {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const ergebnis = await api.post("/api/v1/members/{member_id}/password-reset", {
        path: { member_id: mitglied.id },
      });
      onErzeugt(ergebnis);
    } catch (error) {
      setFehler(verwaltungsfehler(error));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Bestaetigung
      offen
      titel="Passwort zurücksetzen?"
      bestaetigenLabel="Link erzeugen"
      bestaetigenSymbol={AKTION.passwortZuruecksetzen}
      laeuft={laeuft}
      fehler={fehler}
      onBestaetigen={() => void ausfuehren()}
      onAbbrechen={onAbbrechen}
    >
      <p>
        Für <strong>{mitglied.full_name}</strong> wird ein einmal verwendbarer Link erzeugt. Damit
        legt die Person selbst ein neues Passwort fest - Sie sehen und setzen es nicht.
      </p>
      <p className="text-muted">
        Ein früher erzeugter, noch nicht verwendeter Link wird dabei ungültig. Das bisherige
        Passwort gilt, bis der neue Link verwendet wurde.
      </p>
    </Bestaetigung>
  );
}

/**
 * Zeigt den Reset-Link **genau einmal**. Er steht nur in diesem Zustand; nach
 * dem Schließen ist er auch über die API nicht mehr abrufbar.
 */
export function ResetLinkDialog({
  ergebnis,
  name,
  onSchliessen,
}: {
  ergebnis: PasswordResetIssued | null;
  name: string;
  onSchliessen: () => void;
}) {
  const [kopie, setKopie] = useState<"offen" | "kopiert" | "manuell">("offen");
  const feld = useRef<HTMLInputElement>(null);

  if (ergebnis === null) return null;

  const kopieren = async () => {
    try {
      if (navigator.clipboard === undefined) throw new Error("keine Zwischenablage");
      await navigator.clipboard.writeText(ergebnis.reset_url);
      setKopie("kopiert");
    } catch {
      // Ohne Zwischenablage (Rechte, unsichere Verbindung): markieren und
      // die Tastenkombination nennen.
      feld.current?.focus();
      feld.current?.select();
      setKopie("manuell");
    }
  };

  const schliessen = () => {
    setKopie("offen");
    onSchliessen();
  };

  return (
    <Dialog offen titel="Link zum Zurücksetzen" onClose={schliessen}>
      <div className={STAPEL}>
        <p>
          Geben Sie diesen Link persönlich an <strong>{name}</strong> weiter. Es gibt noch keinen
          E-Mail-Versand.
        </p>
        <Hinweisliste>
          <li>
            Gültig bis <strong>{datum(ergebnis.expires_at)}</strong> und nur{" "}
            <strong>einmal</strong> verwendbar.
          </li>
          <li>Er wird nur jetzt angezeigt und lässt sich später nicht erneut abrufen.</li>
          <li>Ein neuer Link macht diesen ungültig.</li>
        </Hinweisliste>
        <div className={FELD}>
          <label className={FELD_BESCHRIFTUNG} htmlFor="reset-link">
            Einmal-Link
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="reset-link"
              ref={feld}
              className={`${eingabefeld()} min-w-0 flex-1`}
              readOnly
              value={ergebnis.reset_url}
              onFocus={(event) => event.target.select()}
            />
            <button type="button" className={knopf()} data-autofocus onClick={() => void kopieren()}>
              <MitSymbol icon={AKTION.kopieren}>{kopie === "kopiert" ? "Kopiert" : "Link kopieren"}</MitSymbol>
            </button>
          </div>
          <span className={FELD_HINWEIS} role="status">
            {kopie === "kopiert"
              ? "Der Link ist in der Zwischenablage."
              : kopie === "manuell"
                ? "Kopieren ist hier nicht möglich. Der Link ist markiert - bitte mit Strg+C (Mac: ⌘+C) kopieren."
                : ""}
          </span>
        </div>
        <DialogAktionen>
          <button type="button" className={knopf("primaer")} onClick={schliessen}>
            Fertig
          </button>
        </DialogAktionen>
      </div>
    </Dialog>
  );
}

function Hinweisliste({ children }: { children: ReactNode }) {
  return <ul className="m-0 list-disc pl-5 text-muted">{children}</ul>;
}

// ------------------------------------------------------------------ Entfernen

function EntfernenDialog({
  mitglied,
  onAbbrechen,
  onFertig,
  onKonflikt,
}: {
  mitglied: MemberOut;
  onAbbrechen: () => void;
  onFertig: () => void;
  onKonflikt: () => Promise<void>;
}) {
  const { api } = useAuth();
  const [bestaetigung, setBestaetigung] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const passt = bestaetigung.trim().toLowerCase() === (mitglied.email ?? "").toLowerCase();

  const ausfuehren = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (laeuft || !passt) return;
    setLaeuft(true);
    setFehler(null);
    try {
      await api.post("/api/v1/members/{member_id}/remove", {
        path: { member_id: mitglied.id },
        ifMatch: mitglied.version,
        body: { confirm_email: bestaetigung.trim() },
      });
      onFertig();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setFehler("Die eingegebene Adresse stimmt nicht mit der E-Mail-Adresse des Kontos überein.");
      } else {
        setFehler(verwaltungsfehler(error));
        if (error instanceof ApiError && error.status === 409) await onKonflikt();
      }
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Dialog offen titel="Benutzer endgültig entfernen?" onClose={() => (laeuft ? undefined : onAbbrechen())}>
      <form className={STAPEL} noValidate onSubmit={(event) => void ausfuehren(event)}>
        <div className={meldungsflaeche()} role="note">
          <p className="m-0 font-semibold">Das lässt sich nicht rückgängig machen.</p>
          <p className="mt-1 mb-0">
            <strong>{mitglied.full_name}</strong> verliert sofort jeden Zugang. Rollen, persönliche
            Einstellungen und offene Links zum Zurücksetzen werden gelöscht. Frühere Einträge
            zeigen danach „Entfernter Benutzer“.
          </p>
        </div>
        <p className="text-muted">
          {mitglied.account_shared
            ? "Das Konto wird auch in einem anderen Betrieb verwendet und bleibt dort bestehen. In diesem Betrieb erscheint es nur noch neutral unter „Entfernt“."
            : "Name und E-Mail-Adresse werden aus dem Konto gelöscht. Die Adresse kann danach für eine neue Einladung verwendet werden. Eine Wiederherstellung gibt es nicht."}
        </p>
        <Feld
          id="entfernen-bestaetigung"
          label={`Zur Bestätigung die E-Mail-Adresse eingeben: ${mitglied.email ?? ""}`}
          value={bestaetigung}
          disabled={laeuft}
          autoComplete="off"
          onChange={setBestaetigung}
        />
        {fehler !== null && (
          <p className={meldungsflaeche()} role="alert">
            {fehler}
          </p>
        )}
        <DialogAktionen>
          <button type="submit" className={knopf("gefahr")} disabled={laeuft || !passt}>
            {laeuft ? "Wird entfernt ..." : <MitSymbol icon={AKTION.entfernen}>Endgültig entfernen</MitSymbol>}
          </button>
          <button type="button" className={knopf()} data-autofocus disabled={laeuft} onClick={onAbbrechen}>
            Abbrechen
          </button>
        </DialogAktionen>
      </form>
    </Dialog>
  );
}
