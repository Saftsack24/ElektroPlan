import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { masseinheitSchluessel, useMasseinheit } from "../ui/masseinheit";
import { AuthProvider, useAuth } from "./AuthProvider";

/**
 * Die persönliche Maßeinheit folgt dem angemeldeten Benutzer (Phase 4b.2):
 * Laden → Standard, angemeldet → eigene Wahl, abgemeldet → Standard.
 */
const ANNA = "11111111-1111-4111-8111-111111111111";

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Anzeige() {
  const { status, logout } = useAuth();
  const einheit = useMasseinheit();
  return (
    <>
      <p>
        {status}:{einheit}
      </p>
      <button type="button" onClick={() => void logout()}>
        Abmelden
      </button>
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("AuthProvider und persönliche Maßeinheit", () => {
  it("zeigt beim Laden den Standard, danach die Wahl des Benutzers und nach dem Abmelden wieder den Standard", async () => {
    window.localStorage.setItem(masseinheitSchluessel(ANNA), "mm");
    let freigeben: () => void = () => undefined;
    const warten = new Promise<void>((r) => (freigeben = r));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (eingabe) => {
      const url = eingabe instanceof Request ? eingabe.url : eingabe.toString();
      if (url.endsWith("/api/v1/auth/refresh")) {
        await warten;
        return json({ access_token: "token", token_type: "bearer", expires_in: 900 });
      }
      if (url.endsWith("/api/v1/me/modules")) return json([]);
      if (url.endsWith("/api/v1/me")) {
        return json({
          user_id: ANNA,
          email: "anna@example.test",
          full_name: "Anna Test",
          organization: { id: "o1", name: "Betrieb", slug: "betrieb" },
          member_id: "m1",
          roles: [],
          permissions: [],
        });
      }
      if (url.endsWith("/api/v1/auth/logout")) return json(null, 204);
      return json({}, 404);
    });

    render(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    expect(screen.getByText("loading:cm")).toBeInTheDocument();
    await act(async () => {
      freigeben();
      await warten;
    });
    expect(await screen.findByText("authenticated:mm")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    await waitFor(() => expect(screen.getByText("anonymous:cm")).toBeInTheDocument());
    // Die Wahl bleibt für Anna gespeichert - sie wird nur nicht mehr gezeigt.
    expect(window.localStorage.getItem(masseinheitSchluessel(ANNA))).toBe("mm");
  });
});
