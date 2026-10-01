import { ApiError, createApiClient } from "@elektroplan/api-client";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { config } from "../config";
import { Feld } from "../ui/Feld";
import { KENNWERTE, STAPEL, karte, knopf, meldungsflaeche } from "../ui/stil";
import { tokenAusFragment } from "./EinladungAnnehmenPage";

/** Pfad der Seite - derselbe, den das Backend in den Reset-Link schreibt. */
export const PASSWORT_ZURUECKSETZEN_PFAD = "/passwort-zuruecksetzen";

/** Zustand der Anmeldeseite nach einem erfolgreich gesetzten Passwort. */
export interface AnmeldehinweisZustand {
  passwortNeu?: boolean;
}

type Zustand =
  | { art: "laedt" }
  | { art: "ohne-token" }
  | { art: "ungueltig" }
  | { art: "gesperrt" }
  | { art: "fehler" }
  | { art: "bereit"; gueltigBis: string };

/**
 * Öffentliche Seite zum Setzen eines neuen Passworts über einen Einmal-Link
 * (Phase 4e, ADR 0021).
 *
 * Wie die Annahme einer Einladung: eigener Client ohne Access Token und ohne
 * Sitzungserneuerung, das Token steht im Fragment und wird sofort aus der
 * Adresszeile entfernt. Abgelaufen, verwendet, ersetzt oder unbekannt ergibt
 * **eine** neutrale Meldung. Nach dem Erfolg geht es zur Anmeldung - alle
 * bisherigen Sitzungen der Person sind dann beendet.
 */
export function PasswortZuruecksetzenPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [token, setToken] = useState(() => tokenAusFragment(window.location.hash));
  const [zustand, setZustand] = useState<Zustand>(token === null ? { art: "ohne-token" } : { art: "laedt" });
  const api = useMemo(() => createApiClient({ baseUrl: config.apiBaseUrl, getAccessToken: () => null }), []);

  const neuesToken = tokenAusFragment(hash);
  if (neuesToken !== null && neuesToken !== token) {
    setToken(neuesToken);
    setZustand({ art: "laedt" });
  }

  useEffect(() => {
    // Token aus der Adresszeile entfernen - es bleibt nur im Speicher.
    if (hash) void navigate(PASSWORT_ZURUECKSETZEN_PFAD, { replace: true });
  }, [hash, navigate]);

  useEffect(() => {
    if (token === null) return;
    let aktiv = true;
    api
      .post("/api/v1/password-reset/preview", { body: { token } })
      .then((vorschau) => {
        if (aktiv) setZustand({ art: "bereit", gueltigBis: vorschau.expires_at });
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
      <section className={`${karte()} flex w-[min(460px,100%)] flex-col gap-3.5`} aria-labelledby="reset-titel">
        <h1 id="reset-titel" className="m-0 text-[1.4rem]">
          Neues Passwort festlegen
        </h1>
        {zustand.art === "laedt" && <p className="text-muted">Link wird geprüft ...</p>}
        {zustand.art === "ohne-token" && (
          <p className={meldungsflaeche()} role="alert">
            Der Link ist unvollständig. Bitte den Link vollständig öffnen, so wie Sie ihn erhalten
            haben.
          </p>
        )}
        {zustand.art === "ungueltig" && <Ungueltig />}
        {zustand.art === "gesperrt" && (
          <p className={meldungsflaeche()} role="alert">
            Zu viele Versuche. Bitte später erneut versuchen.
          </p>
        )}
        {zustand.art === "fehler" && (
          <p className={meldungsflaeche()} role="alert">
            Der Link konnte nicht geprüft werden. Bitte später erneut versuchen.
          </p>
        )}
        {zustand.art === "bereit" && token !== null && (
          <Formular
            gueltigBis={zustand.gueltigBis}
            senden={async (passwort) => {
              await api.post("/api/v1/password-reset/complete", { body: { token, password: passwort } });
              const hinweis: AnmeldehinweisZustand = { passwortNeu: true };
              void navigate("/", { replace: true, state: hinweis });
            }}
            onUngueltig={() => setZustand({ art: "ungueltig" })}
          />
        )}
      </section>
    </main>
  );
}

function Ungueltig() {
  return (
    <p className={meldungsflaeche()} role="alert">
      Dieser Link ist nicht (mehr) gültig - er ist abgelaufen, wurde bereits verwendet oder durch
      einen neueren ersetzt. Bitte beim Administrator Ihres Betriebs einen neuen Link anfordern.
    </p>
  );
}

function Formular({
  gueltigBis,
  senden,
  onUngueltig,
}: {
  gueltigBis: string;
  senden: (passwort: string) => Promise<void>;
  onUngueltig: () => void;
}) {
  const [passwort, setPasswort] = useState("");
  const [wiederholung, setWiederholung] = useState("");
  const [felder, setFelder] = useState<{ passwort?: string; wiederholung?: string }>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const absenden = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (laeuft) return;
    const neu: typeof felder = {};
    if (passwort.length === 0) neu.passwort = "Bitte ein Passwort angeben.";
    if (passwort !== wiederholung) neu.wiederholung = "Die Passwörter stimmen nicht überein.";
    setFelder(neu);
    if (Object.keys(neu).length > 0) {
      setFehler("Bitte die markierten Felder prüfen.");
      return;
    }
    setFehler(null);
    setLaeuft(true);
    try {
      await senden(passwort);
    } catch (error) {
      setPasswort("");
      setWiederholung("");
      if (error instanceof ApiError && error.errorType === "password-reset-invalid") {
        onUngueltig();
      } else if (error instanceof ApiError && error.status === 422) {
        const regel = error.problem?.errors?.find((e) => e.field === "password");
        setFelder({ passwort: regel?.message ?? "Das Passwort erfüllt die Regeln nicht." });
        setFehler("Bitte die markierten Felder prüfen.");
      } else if (error instanceof ApiError && error.status === 429) {
        setFehler("Zu viele Versuche. Bitte später erneut versuchen.");
      } else {
        setFehler("Die Anfrage konnte nicht gesendet werden. Bitte erneut versuchen.");
      }
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <form className={STAPEL} noValidate onSubmit={(event) => void absenden(event)}>
      <p className="text-muted">
        Wählen Sie ein neues Passwort mit mindestens 12 Zeichen. Danach melden Sie sich neu an;
        alle bisherigen Sitzungen sind beendet.
      </p>
      <dl className={KENNWERTE}>
        <dt>Link gültig bis</dt>
        <dd>{new Date(gueltigBis).toLocaleString("de-DE")}</dd>
      </dl>
      <Feld
        id="reset-passwort"
        label="Neues Passwort"
        type="password"
        autoComplete="new-password"
        value={passwort}
        required
        disabled={laeuft}
        fehler={felder.passwort}
        onChange={setPasswort}
      />
      <Feld
        id="reset-wiederholung"
        label="Neues Passwort wiederholen"
        type="password"
        autoComplete="new-password"
        value={wiederholung}
        required
        disabled={laeuft}
        fehler={felder.wiederholung}
        onChange={setWiederholung}
      />
      {fehler !== null && (
        <p className={meldungsflaeche()} role="alert">
          {fehler}
        </p>
      )}
      <button className={knopf("primaer")} type="submit" disabled={laeuft}>
        {laeuft ? "Wird gespeichert ..." : "Passwort speichern"}
      </button>
    </form>
  );
}
