import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EINLADUNG_PFAD, EinladungAnnehmenPage, tokenAusFragment } from "./EinladungAnnehmenPage";

/**
 * Öffentliche Annahme einer Einladung. Der Client ist echt, nur `fetch`
 * ist ersetzt: So wird auch geprüft, dass kein Token im Pfad landet und
 * kein Access Token mitgeschickt wird.
 */
type Aufruf = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
const aufrufe: Aufruf[] = [];

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function problem(status: number, typ: string) {
  return antwort(status, {
    type: `https://elektroplan.internal/errors/${typ}`,
    title: "x",
    status,
    detail: "Servermeldung",
  });
}

const VORSCHAU = {
  organization_name: "Elektro Test GmbH",
  email: "neu@test.example",
  full_name: "Nina Neu",
  expires_at: "2026-10-01T10:00:00Z",
  account_exists: false,
};

let antworten: (url: string) => Response;

function zeigen(hash = "#t=token-123") {
  window.history.replaceState(null, "", `${EINLADUNG_PFAD}${hash}`);
  const router = createMemoryRouter(
    [
      { path: EINLADUNG_PFAD, element: <EinladungAnnehmenPage /> },
      { path: "/", element: <p>Anmeldung</p> },
    ],
    { initialEntries: [`${EINLADUNG_PFAD}${hash}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  aufrufe.length = 0;
  antworten = () => antwort(200, VORSCHAU);
  vi.spyOn(globalThis, "fetch").mockImplementation((eingabe, init) => {
    const url = typeof eingabe === "string" ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url;
    const koerper = typeof init?.body === "string" ? init.body : "{}";
    aufrufe.push({
      url,
      body: JSON.parse(koerper) as Record<string, unknown>,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve(antworten(url));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Einladung annehmen", () => {
  it("liest das Token aus dem Fragment", () => {
    expect(tokenAusFragment("#t=abc")).toBe("abc");
    expect(tokenAusFragment("#x=1")).toBeNull();
    expect(tokenAusFragment("")).toBeNull();
  });

  it("entfernt das Token aus der Adresse und schickt es nur im Körper", async () => {
    const router = zeigen();
    expect(await screen.findByText("Elektro Test GmbH")).toBeInTheDocument();
    expect(router.state.location.hash).toBe("");
    expect(aufrufe[0]?.url).toBe("http://localhost:8000/api/v1/invitation-acceptance/preview");
    expect(aufrufe[0]?.body).toEqual({ token: "token-123" });
    expect(aufrufe[0]?.headers["Authorization"]).toBeUndefined();
  });

  it("legt ein neues Konto an und prüft die Wiederholung vorab", async () => {
    antworten = (url) =>
      url.endsWith("/preview")
        ? antwort(200, VORSCHAU)
        : antwort(201, { organization_name: "Elektro Test GmbH", email: "neu@test.example" });
    const router = zeigen();
    expect(await screen.findByLabelText(/^Ihr Name/)).toHaveValue("Nina Neu");
    fireEvent.change(screen.getByLabelText(/^Passwort \*/), { target: { value: "sicheres-passwort-1" } });
    fireEvent.change(screen.getByLabelText(/^Passwort wiederholen/), { target: { value: "anders" } });
    fireEvent.click(screen.getByRole("button", { name: "Einladung annehmen" }));
    expect(screen.getByText("Die Passwörter stimmen nicht überein.")).toBeInTheDocument();
    expect(aufrufe).toHaveLength(1);

    fireEvent.change(screen.getByLabelText(/^Passwort wiederholen/), {
      target: { value: "sicheres-passwort-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einladung annehmen" }));
    expect(await screen.findByText(/Sie gehören jetzt zu/)).toBeInTheDocument();
    expect(aufrufe[1]?.url).toMatch(/\/invitation-acceptance\/new-account$/);
    expect(aufrufe[1]?.body).toEqual({
      token: "token-123",
      full_name: "Nina Neu",
      password: "sicheres-passwort-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Zur Anmeldung" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("verlangt bei bestehendem Konto nur das bisherige Passwort", async () => {
    antworten = (url) =>
      url.endsWith("/preview")
        ? antwort(200, { ...VORSCHAU, account_exists: true })
        : antwort(201, { organization_name: "Elektro Test GmbH", email: "neu@test.example" });
    zeigen();
    const feld = await screen.findByLabelText(/^Bisheriges Passwort/);
    expect(feld).toHaveAttribute("autocomplete", "current-password");
    expect(screen.queryByLabelText(/^Ihr Name/)).toBeNull();
    expect(screen.getByText(/es wird dabei nicht geändert/)).toBeInTheDocument();
    fireEvent.change(feld, { target: { value: "bisheriges-passwort" } });
    fireEvent.click(screen.getByRole("button", { name: "Einladung annehmen" }));
    expect(await screen.findByText(/Sie gehören jetzt zu/)).toBeInTheDocument();
    expect(aufrufe[1]?.url).toMatch(/\/invitation-acceptance\/existing-account$/);
    expect(aufrufe[1]?.body).toEqual({ token: "token-123", password: "bisheriges-passwort" });
  });

  it("wechselt auf die Anmeldung, wenn das Konto inzwischen existiert", async () => {
    antworten = (url) =>
      url.endsWith("/preview") ? antwort(200, VORSCHAU) : problem(409, "invitation-requires-login");
    zeigen();
    await screen.findByLabelText(/^Ihr Name/);
    fireEvent.change(screen.getByLabelText(/^Passwort \*/), { target: { value: "sicheres-passwort-1" } });
    fireEvent.change(screen.getByLabelText(/^Passwort wiederholen/), {
      target: { value: "sicheres-passwort-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einladung annehmen" }));
    expect(await screen.findByLabelText(/^Bisheriges Passwort/)).toHaveValue("");
    expect(screen.getByText(/gibt es bereits ein Konto/, { selector: ".alert" })).toBeInTheDocument();
  });

  it("meldet ungültige, abgelaufene oder verbrauchte Einladungen einheitlich", async () => {
    antworten = () => problem(404, "invitation-invalid");
    zeigen();
    expect(await screen.findByText(/nicht \(mehr\) gültig/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Einladung annehmen" })).toBeNull();
  });

  it("erklärt einen unvollständigen Link, ohne den Server zu fragen", () => {
    zeigen("");
    expect(screen.getByText(/Einladungslink ist unvollständig/)).toBeInTheDocument();
    expect(aufrufe).toHaveLength(0);
  });

  it("beginnt neu, wenn bei offener Seite ein neuer Link geöffnet wird", async () => {
    antworten = (url) =>
      url.endsWith("/preview") && aufrufe.length === 1
        ? problem(404, "invitation-invalid")
        : antwort(200, VORSCHAU);
    const router = zeigen("#t=verbraucht");
    expect(await screen.findByText(/nicht \(mehr\) gültig/)).toBeInTheDocument();
    await router.navigate(`${EINLADUNG_PFAD}#t=frisch`);
    expect(await screen.findByText("Elektro Test GmbH")).toBeInTheDocument();
    expect(aufrufe.at(-1)?.body).toEqual({ token: "frisch" });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
  });
});
