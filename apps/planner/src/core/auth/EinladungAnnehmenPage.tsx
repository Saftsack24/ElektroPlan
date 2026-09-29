import { ApiError, createApiClient } from "@elektroplan/api-client";
import type { InvitationPreview } from "@elektroplan/api-client";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { config } from "../config";
import { Feld } from "../ui/Feld";
import { KENNWERTE, STAPEL, karte, knopf, meldungsflaeche } from "../ui/stil";

/** Pfad der Annahmeseite - derselbe, den das Backend in den Link schreibt. */
export const EINLADUNG_PFAD = "/einladung";

/**
 * Liest das Token aus dem Fragment (`#t=...`).
 *
 * Das Token steht bewusst im Fragment: Browser senden es weder an einen
 * Server noch im `Referer`. Die Seite entfernt es sofort aus der Adresszeile,
 * damit es nicht im Verlauf stehen bleibt.
 */
export function tokenAusFragment(hash: string): string | null {
  const parameter = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const token = parameter.get("t");
  return token !== null && token.length > 0 ? token : null;
}

type Zustand =
  | { art: "laedt" }
  | { art: "ohne-token" }
  | { art: "ungueltig" }
  | { art: "gesperrt" }
  | { art: "fehler" }
  | { art: "bereit"; vorschau: InvitationPreview }
  | { art: "angenommen"; betrieb: string; email: string };

/**
 * Öffentliche Seite zur Annahme einer Einladung (ADR 0015).
 *
 * Sie braucht keine Anmeldung und benutzt deshalb einen eigenen Client ohne
 * Access Token und ohne Sitzungserneuerung: Ein falsches Passwort (401) darf
 * keinen Erneuerungsversuch einer womöglich parallel bestehenden Sitzung
 * auslösen.
 *
 * Zwei Wege, vom Server vorgegeben:
 *
 * * **Neues Konto** - Name und Passwort festlegen.
 * * **Bestehendes Konto** - mit dem vorhandenen Passwort bestätigen. Das
 *   Passwort wird nicht geändert.
 */
export function EinladungAnnehmenPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [token, setToken] = useState(() => tokenAusFragment(window.location.hash));
  const [zustand, setZustand] = useState<Zustand>(
    token === null ? { art: "ohne-token" } : { art: "laedt" },
  );
  const api = useMemo(
    () => createApiClient({ baseUrl: config.apiBaseUrl, getAccessToken: () => null }),
    [],
  );

  // Ein neuer Link, während die Seite schon offen ist (nur das Fragment
  // ändert sich): neu beginnen, statt den alten Stand stehen zu lassen.
  const neuesToken = tokenAusFragment(hash);
  if (neuesToken !== null && neuesToken !== token) {
    setToken(neuesToken);
    setZustand({ art: "laedt" });
  }

  useEffect(() => {
    // Token aus der Adresszeile entfernen - es bleibt nur im Speicher.
    if (hash) {
      void navigate(EINLADUNG_PFAD, { replace: true });
    }
  }, [hash, navigate]);

  useEffect(() => {
    if (token === null) return;
    let aktiv = true;
    api
      .post("/api/v1/invitation-acceptance/preview", { body: { token } })
      .then((vorschau) => {
        if (aktiv) setZustand({ art: "bereit", vorschau });
      })
      .catch((error: unknown) => {
        if (!aktiv) return;
        if (error instanceof ApiError && error.status === 404) setZustand({ art: "ungueltig" });
        else if (error instanceof ApiError && error.status === 429) setZustand({ art: "gesperrt" });
        else setZustand({ art: "fehler" });
      });
    return () => {
      aktiv = false;
    };
  }, [api, token]);

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <section
        className={`${karte()} flex w-[min(460px,100%)] flex-col gap-3.5`}
        aria-labelledby="einladung-titel"
      >
        <h1 id="einladung-titel" className="m-0 text-[1.4rem]">
          Einladung annehmen
        </h1>
        {zustand.art === "laedt" && <p className="text-muted">Einladung wird geprüft ...</p>}
        {zustand.art === "ohne-token" && (
          <p className={meldungsflaeche()} role="alert">
            Der Einladungslink ist unvollständig. Bitte den Link vollständig aus der Einladung
            öffnen.
          </p>
        )}
        {zustand.art === "ungueltig" && (
          <p className={meldungsflaeche()} role="alert">
            Diese Einladung ist nicht (mehr) gültig - sie ist abgelaufen, wurde widerrufen oder
            bereits verwendet. Bitte beim Betrieb eine neue Einladung anfordern.
          </p>
        )}
        {zustand.art === "gesperrt" && (
          <p className={meldungsflaeche()} role="alert">
            Zu viele Versuche. Bitte später erneut versuchen.
          </p>
        )}
        {zustand.art === "fehler" && (
          <p className={meldungsflaeche()} role="alert">
            Die Einladung konnte nicht geprüft werden. Bitte später erneut versuchen.
          </p>
        )}
        {zustand.art === "bereit" && token !== null && (
          <Annahme
            vorschau={zustand.vorschau}
            senden={async (weg, koerper) => {
              const ergebnis =
                weg === "neu"
                  ? await api.post("/api/v1/invitation-acceptance/new-account", {
                      body: { token, full_name: koerper.name, password: koerper.passwort },
                    })
                  : await api.post("/api/v1/invitation-acceptance/existing-account", {
                      body: { token, password: koerper.passwort },
                    });
              setZustand({
                art: "angenommen",
                betrieb: ergebnis.organization_name,
                email: ergebnis.email,
              });
            }}
          />
        )}
        {zustand.art === "angenommen" && (
          <div className={STAPEL}>
            <p className={meldungsflaeche("erfolg")} role="status">
              Willkommen! Sie gehören jetzt zu <strong>{zustand.betrieb}</strong>.
            </p>
            <p>
              Melden Sie sich mit <strong>{zustand.email}</strong> an. Gehören Sie mehreren
              Betrieben an, wählen Sie bei der Anmeldung den gewünschten aus.
            </p>
            <button
              type="button"
              className={knopf("primaer")}
              onClick={() => void navigate("/")}
            >
              Zur Anmeldung
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

type Weg = "neu" | "bestehend";

function Annahme({
  vorschau,
  senden,
}: {
  vorschau: InvitationPreview;
  senden: (weg: Weg, koerper: { name: string; passwort: string }) => Promise<void>;
}) {
  const [weg, setWeg] = useState<Weg>(vorschau.account_exists ? "bestehend" : "neu");
  const [name, setName] = useState(vorschau.full_name ?? "");
  const [passwort, setPasswort] = useState("");
  const [wiederholung, setWiederholung] = useState("");
  const [felder, setFelder] = useState<{ name?: string; passwort?: string; wiederholung?: string }>(
    {},
  );
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const absenden = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (laeuft) return;
    const neueFelder: typeof felder = {};
    if (weg === "neu" && name.trim().length === 0) neueFelder.name = "Bitte einen Namen angeben.";
    if (passwort.length === 0) neueFelder.passwort = "Bitte ein Passwort angeben.";
    if (weg === "neu" && passwort !== wiederholung) {
      neueFelder.wiederholung = "Die Passwörter stimmen nicht überein.";
    }
    setFelder(neueFelder);
    if (Object.keys(neueFelder).length > 0) {
      setFehler("Bitte die markierten Felder prüfen.");
      return;
    }
    setFehler(null);
    setLaeuft(true);
    try {
      await senden(weg, { name: name.trim(), passwort });
    } catch (error) {
      setPasswort("");
      setWiederholung("");
      if (error instanceof ApiError && error.errorType === "invitation-requires-login") {
        setWeg("bestehend");
        setFehler(
          "Zu dieser E-Mail-Adresse gibt es bereits ein Konto. Bitte mit dessen Passwort bestätigen.",
        );
      } else if (error instanceof ApiError && error.errorType === "invitation-invalid") {
        setFehler("Diese Einladung ist nicht mehr gültig. Bitte eine neue anfordern.");
      } else if (error instanceof ApiError && error.status === 422) {
        const passwortFehler = error.problem?.errors?.find((e) => e.field === "password");
        setFelder({ passwort: passwortFehler?.message ?? "Das Passwort erfüllt die Regeln nicht." });
        setFehler("Bitte die markierten Felder prüfen.");
      } else if (error instanceof ApiError) {
        setFehler(error.userMessage);
      } else {
        setFehler("Die Anfrage konnte nicht gesendet werden. Bitte erneut versuchen.");
      }
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <form className={STAPEL} noValidate onSubmit={(event) => void absenden(event)}>
      <p>
        <strong>{vorschau.organization_name}</strong> lädt Sie zu ElektroPlan ein.
      </p>
      <dl className={KENNWERTE}>
        <dt>E-Mail</dt>
        <dd>{vorschau.email}</dd>
        <dt>Gültig bis</dt>
        <dd>{new Date(vorschau.expires_at).toLocaleString("de-DE")}</dd>
      </dl>
      {weg === "neu" ? (
        <>
          <p className="text-muted">Legen Sie Ihr Konto an. Das Passwort braucht mindestens 12 Zeichen.</p>
          <Feld
            id="einladung-name"
            label="Ihr Name"
            value={name}
            required
            disabled={laeuft}
            fehler={felder.name}
            onChange={setName}
          />
          <Feld
            id="einladung-passwort"
            label="Passwort"
            type="password"
            autoComplete="new-password"
            value={passwort}
            required
            disabled={laeuft}
            fehler={felder.passwort}
            onChange={setPasswort}
          />
          <Feld
            id="einladung-wiederholung"
            label="Passwort wiederholen"
            type="password"
            autoComplete="new-password"
            value={wiederholung}
            required
            disabled={laeuft}
            fehler={felder.wiederholung}
            onChange={setWiederholung}
          />
        </>
      ) : (
        <>
          <p className="text-muted">
            Für diese E-Mail-Adresse gibt es bereits ein Konto. Bestätigen Sie die Einladung mit
            Ihrem bisherigen Passwort - es wird dabei nicht geändert.
          </p>
          <Feld
            id="einladung-passwort"
            label="Bisheriges Passwort"
            type="password"
            autoComplete="current-password"
            value={passwort}
            required
            disabled={laeuft}
            fehler={felder.passwort}
            onChange={setPasswort}
          />
        </>
      )}
      {fehler !== null && (
        <p className={meldungsflaeche()} role="alert">
          {fehler}
        </p>
      )}
      <button className={knopf("primaer")} type="submit" disabled={laeuft}>
        {laeuft ? "Wird gesendet ..." : "Einladung annehmen"}
      </button>
    </form>
  );
}
