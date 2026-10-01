import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cacheSchluessel } from "../einstellungen/persoenlich";
import { useDarstellung } from "../theme/darstellung";
import { useMasseinheit } from "../ui/masseinheit";
import { AuthProvider, useAuth } from "./AuthProvider";

/**
 * Persönliche Einstellungen folgen dem angemeldeten Benutzer - der Server ist
 * die Wahrheit (Phase 4e, ADR 0021): Laden → Standard, angemeldet → eigener
 * Serverstand, abgemeldet → Standard; ein anderer Benutzer desselben Browsers
 * sieht nie eine fremde Wahl.
 */
const ANNA = { user: "11111111-1111-4111-8111-111111111111", member: "aaaaaaaa-1111-4111-8111-111111111111" };
const BERT = { user: "22222222-2222-4222-8222-222222222222", member: "bbbbbbbb-2222-4222-8222-222222222222" };

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Anzeige() {
  const { status, logout, login } = useAuth();
  const einheit = useMasseinheit();
  const { darstellung } = useDarstellung();
  return (
    <>
      <p>
        {status}:{einheit}:{darstellung.akzent}
      </p>
      <button type="button" onClick={() => void logout()}>
        Abmelden
      </button>
      <button type="button" onClick={() => void login("bert@example.test", "geheim-geheim")}>
        Bert anmelden
      </button>
    </>
  );
}

/** Server mit je einem Präferenzstand; `angemeldet` wechselt mit dem Login. */
function serverAufsetzen(freigabe: Promise<void>) {
  let angemeldet = ANNA;
  const staende: Record<string, unknown> = {
    [ANNA.member]: { stored: true, theme_mode: "dark", accent: "teal", length_unit: "m", version: 2 },
    [BERT.member]: { stored: false, theme_mode: "system", accent: "blue", length_unit: "cm", version: 0 },
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (eingabe) => {
    const url = eingabe instanceof Request ? eingabe.url : eingabe.toString();
    if (url.endsWith("/api/v1/auth/refresh")) {
      await freigabe;
      return json({ access_token: "token", token_type: "bearer", expires_in: 900, organization_id: "o1" });
    }
    if (url.endsWith("/api/v1/auth/login")) {
      angemeldet = BERT;
      return json({ access_token: "token-b", token_type: "bearer", expires_in: 900, organization_id: "o1" });
    }
    if (url.endsWith("/api/v1/me/modules")) return json([]);
    if (url.endsWith("/api/v1/me/preferences")) return json(staende[angemeldet.member]);
    if (url.endsWith("/api/v1/me")) {
      return json({
        user_id: angemeldet.user,
        email: "person@example.test",
        full_name: "Person Test",
        organization: { id: "o1", name: "Betrieb", slug: "betrieb" },
        member_id: angemeldet.member,
        roles: [],
        permissions: [],
      });
    }
    if (url.endsWith("/api/v1/auth/logout")) return json(null, 204);
    return json({}, 404);
  });
}

afterEach(() => vi.restoreAllMocks());

describe("AuthProvider und persönliche Einstellungen", () => {
  it("Standard beim Laden, Serverstand nach der Anmeldung, Standard nach dem Abmelden", async () => {
    let freigeben: () => void = () => undefined;
    const warten = new Promise<void>((r) => (freigeben = r));
    serverAufsetzen(warten);

    render(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    expect(screen.getByText("loading:cm:blue")).toBeInTheDocument();
    await act(async () => {
      freigeben();
      await warten;
    });
    expect(await screen.findByText("authenticated:m:teal")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    await waitFor(() => expect(screen.getByText("anonymous:cm:blue")).toBeInTheDocument());
    // Der Cache bleibt für Anna - er wird nur nicht mehr gezeigt.
    expect(window.localStorage.getItem(cacheSchluessel(ANNA.member))).toContain('"einheit":"m"');
  });

  it("ein zweiter Benutzer im selben Browser erhält seine eigenen Werte, nie Annas", async () => {
    serverAufsetzen(Promise.resolve());
    render(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    expect(await screen.findByText("authenticated:m:teal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    await waitFor(() => expect(screen.getByText("anonymous:cm:blue")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Bert anmelden" }));
    expect(await screen.findByText("authenticated:cm:blue")).toBeInTheDocument();
    expect(window.localStorage.getItem(cacheSchluessel(BERT.member))).toBeNull();
  });
});
