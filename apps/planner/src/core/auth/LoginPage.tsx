import { ApiError } from "@elektroplan/api-client";
import type { ProblemDetail } from "@elektroplan/api-client";
import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation } from "react-router-dom";

import { FELD, FELD_BESCHRIFTUNG, STAPEL, eingabefeld, karte, knopf, meldungsflaeche } from "../ui/stil";
import { useAuth } from "./AuthProvider";
import type { AnmeldehinweisZustand } from "./PasswortZuruecksetzenPage";

type OrganizationChoice = NonNullable<ProblemDetail["organizations"]>[number];

export function LoginPage() {
  const { login } = useAuth();
  // Nach dem Setzen eines neuen Passworts über einen Einmal-Link (Phase 4e).
  const passwortNeu = (useLocation().state as AnmeldehinweisZustand | null)?.passwortNeu === true;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Gehoert das Konto mehreren Betrieben an, liefert der Server einen
  // Konflikt samt Auswahlliste (Punkt 9 der Phase-1.1-Abnahme).
  const [choices, setChoices] = useState<OrganizationChoice[]>([]);

  async function anmelden(organizationId?: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await login(email, password, organizationId);
    } catch (caught) {
      if (caught instanceof ApiError && caught.errorType === "organization-selection-required") {
        setChoices(caught.problem?.organizations ?? []);
        setError(caught.userMessage);
      } else {
        setError(
          caught instanceof ApiError ? caught.userMessage : "Die Anmeldung ist fehlgeschlagen.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void anmelden();
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <form className={`${karte()} flex w-[min(380px,100%)] flex-col gap-3.5`} onSubmit={handleSubmit}>
        <h1 className="m-0 text-[1.4rem]">ElektroPlan</h1>
        <p className="m-0 text-muted">Anmeldung</p>
        {passwortNeu && (
          <p className={meldungsflaeche("erfolg")} role="status">
            Ihr neues Passwort ist gespeichert. Bitte melden Sie sich damit an.
          </p>
        )}

        <label className={FELD}>
          <span className={FELD_BESCHRIFTUNG}>E-Mail</span>
          <input
            className={eingabefeld()}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className={FELD}>
          <span className={FELD_BESCHRIFTUNG}>Passwort</span>
          <input
            className={eingabefeld()}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error !== null && (
          <p className={meldungsflaeche()} role="alert">
            {error}
          </p>
        )}

        {choices.length > 0 && (
          <div className={STAPEL}>
            <span className={FELD_BESCHRIFTUNG}>Betrieb wählen</span>
            {choices.map((choice) => (
              <button
                key={choice.id}
                className={knopf()}
                type="button"
                disabled={busy}
                onClick={() => void anmelden(choice.id)}
              >
                {choice.name}
              </button>
            ))}
          </div>
        )}

        <button className={knopf("primaer")} type="submit" disabled={busy}>
          {busy ? "Anmeldung läuft ..." : "Anmelden"}
        </button>
      </form>
    </main>
  );
}
