import { ApiError } from "@elektroplan/api-client";
import type { ProblemDetail } from "@elektroplan/api-client";
import { useState } from "react";
import type { FormEvent } from "react";

import { useAuth } from "./AuthProvider";

type OrganizationChoice = NonNullable<ProblemDetail["organizations"]>[number];

export function LoginPage() {
  const { login } = useAuth();
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
    <main className="login">
      <form className="card login__form" onSubmit={handleSubmit}>
        <h1 className="login__title">ElektroPlan</h1>
        <p className="login__subtitle">Anmeldung</p>

        <label className="field">
          <span className="field__label">E-Mail</span>
          <input
            className="field__input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Passwort</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error !== null && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}

        {choices.length > 0 && (
          <div className="stack">
            <span className="field__label">Betrieb wählen</span>
            {choices.map((choice) => (
              <button
                key={choice.id}
                className="button button--ghost"
                type="button"
                disabled={busy}
                onClick={() => void anmelden(choice.id)}
              >
                {choice.name}
              </button>
            ))}
          </div>
        )}

        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? "Anmeldung läuft ..." : "Anmelden"}
        </button>
      </form>
    </main>
  );
}
