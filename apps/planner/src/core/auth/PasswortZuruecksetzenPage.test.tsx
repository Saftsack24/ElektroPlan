import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PASSWORT_ZURUECKSETZEN_PFAD, PasswortZuruecksetzenPage } from "./PasswortZuruecksetzenPage";

/**
 * Öffentliche Seite zum Setzen eines neuen Passworts (Phase 4e): Token aus dem
 * Fragment, neutrale Meldung für jeden ungültigen Link, Passwortregeln vom
 * Server, danach zur Anmeldung.
 */
function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function zeigen(pfad = `${PASSWORT_ZURUECKSETZEN_PFAD}#t=token-123`) {
  const router = createMemoryRouter(
    [
      { path: PASSWORT_ZURUECKSETZEN_PFAD, element: <PasswortZuruecksetzenPage /> },
      { path: "/", element: <p>Anmeldung</p> },
    ],
    { initialEntries: [pfad] },
  );
  window.location.hash = pfad.includes("#") ? pfad.slice(pfad.indexOf("#")) : "";
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("Passwort zurücksetzen", () => {
  it("prüft den Link, setzt das Passwort und führt zur Anmeldung", async () => {
    const abrufe: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((eingabe, init) => {
      const url = eingabe instanceof Request ? eingabe.url : eingabe.toString();
      abrufe.push({ url, body: JSON.parse(typeof init?.body === "string" ? init.body : "null") });
      if (url.endsWith("/password-reset/preview")) return Promise.resolve(json({ expires_at: "2026-10-01T15:00:00Z" }));
      if (url.endsWith("/password-reset/complete")) return Promise.resolve(json(null, 204));
      return Promise.resolve(json({}, 404));
    });
    const router = zeigen();
    expect(await screen.findByLabelText(/^Neues Passwort \*/)).toBeInTheDocument();
    // Das Token verschwindet aus der Adresszeile.
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    fireEvent.change(screen.getByLabelText(/^Neues Passwort \*/), { target: { value: "ein-langes-passwort" } });
    fireEvent.change(screen.getByLabelText(/wiederholen/), { target: { value: "ein-langes-passwort" } });
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));
    expect(await screen.findByText("Anmeldung")).toBeInTheDocument();
    expect(abrufe.at(-1)?.url).toContain("/api/v1/password-reset/complete");
    expect(abrufe.at(-1)?.body).toEqual({ token: "token-123", password: "ein-langes-passwort" });
    expect(router.state.location.state).toEqual({ passwortNeu: true });
  });

  it("meldet einen abgelaufenen, verwendeten oder unbekannten Link neutral", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ type: "https://elektroplan.internal/errors/password-reset-invalid", title: "x", status: 404 }, 404),
    );
    zeigen();
    expect(await screen.findByText(/nicht \(mehr\) gültig/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Neues Passwort \*/)).toBeNull();
  });

  it("prüft die Wiederholung im Browser und übernimmt die Passwortregel des Servers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((eingabe) => {
      const url = eingabe instanceof Request ? eingabe.url : eingabe.toString();
      if (url.endsWith("/password-reset/preview")) return Promise.resolve(json({ expires_at: "2026-10-01T15:00:00Z" }));
      return Promise.resolve(json(
        {
          type: "https://elektroplan.internal/errors/validation-failed",
          title: "x",
          status: 422,
          errors: [{ field: "password", code: "password_policy", message: "Das Passwort muss mindestens 12 Zeichen haben." }],
        },
        422,
      ));
    });
    zeigen();
    await screen.findByLabelText(/^Neues Passwort \*/);
    fireEvent.change(screen.getByLabelText(/^Neues Passwort \*/), { target: { value: "kurz" } });
    fireEvent.change(screen.getByLabelText(/wiederholen/), { target: { value: "anders" } });
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));
    expect(screen.getByText("Die Passwörter stimmen nicht überein.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/wiederholen/), { target: { value: "kurz" } });
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));
    expect(await screen.findByText("Das Passwort muss mindestens 12 Zeichen haben.")).toBeInTheDocument();
  });

  it("ohne Token im Link erklärt die Seite das Problem", () => {
    zeigen(PASSWORT_ZURUECKSETZEN_PFAD);
    expect(screen.getByText(/Link ist unvollständig/)).toBeInTheDocument();
  });
});
