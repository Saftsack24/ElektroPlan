import type { ApiClient } from "@elektroplan/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "./AuthProvider";

/**
 * Trennung geschützter Browserdaten nach Benutzer und Betrieb
 * (Sicherheitsauftrag 2026-10-10, Befund 1).
 *
 * Ein simulierter Server antwortet je nach Access Token mit den Daten genau
 * dieses Kontexts. Eine Anzeige rendert Kunden-, Projekt-, Benutzer- und
 * Electrical-Daten und protokolliert **jedes** Bild als Paar
 * (angemeldeter Kontext, Kontext der gezeigten Daten). Geprüft wird:
 *
 * - kein Bild zeigt jemals Daten eines anderen Kontexts,
 * - nach einem Wechsel enthält kein Cache mehr Daten des alten Kontexts,
 * - laufende Anfragen des alten Kontexts werden abgebrochen, ihre verspäteten
 *   Antworten landen nirgends.
 */

interface Kontext {
  user: string;
  org: string;
  member: string;
  email: string;
}

const A1: Kontext = { user: "user-a", org: "org-1", member: "member-a1", email: "anna@example.test" };
const A2: Kontext = { user: "user-a", org: "org-2", member: "member-a2", email: "anna@example.test" };
const B1: Kontext = { user: "user-b", org: "org-1", member: "member-b1", email: "bert@example.test" };

function base64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function token(k: Kontext, nummer = 0): string {
  const kopf = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const last = base64Url(JSON.stringify({ sub: k.user, org: k.org, mid: k.member, n: nummer }));
  return `${kopf}.${last}.signatur`;
}

function kontextVon(t: string | null): Kontext | null {
  if (!t) return null;
  const teil = t.split(".")[1] ?? "";
  const daten = JSON.parse(atob(teil.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, string>;
  return [A1, A2, B1].find((k) => k.user === daten["sub"] && k.org === daten["org"]) ?? null;
}

function name(k: Kontext): string {
  return `${k.user}@${k.org}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Aufgeschoben {
  freigeben: () => void;
  signal: AbortSignal | null;
}

/** Simulierter Server: Cookie-Kontext, Daten je Token, steuerbare Verzögerung. */
class Server {
  cookie: Kontext | null = A1;
  refreshErlaubt = true;
  ausgestellt = 0;
  /** Pfade, deren nächste Antwort erst nach `freigeben()` kommt. */
  verzoegert = new Map<string, Aufgeschoben>();
  /** Pfade, die einmal mit 401 antworten (abgelaufener Access Token). */
  abgelaufen = new Set<string>();
  abgebrochen: string[] = [];

  installieren() {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (eingabe, init) => {
      const url = new URL(eingabe instanceof Request ? eingabe.url : eingabe.toString());
      const pfad = url.pathname;
      const kopf = new Headers(init?.headers).get("Authorization");
      const ich = kontextVon(kopf?.replace("Bearer ", "") ?? null);
      if (pfad === "/api/v1/auth/refresh") {
        if (!this.refreshErlaubt || this.cookie === null) return json({ type: "x/auth" }, 401);
        this.ausgestellt += 1;
        return json({ access_token: token(this.cookie, this.ausgestellt), expires_in: 900 });
      }
      if (pfad === "/api/v1/auth/login") {
        const body = JSON.parse(init?.body as string) as { email: string };
        this.cookie = body.email === B1.email ? B1 : A1;
        return json({ access_token: token(this.cookie), expires_in: 900 });
      }
      if (pfad === "/api/v1/auth/switch-organization") {
        const body = JSON.parse(init?.body as string) as { organization_id: string };
        this.cookie = body.organization_id === "org-2" ? A2 : A1;
        return json({ access_token: token(this.cookie), expires_in: 900 });
      }
      if (pfad === "/api/v1/auth/logout") {
        this.cookie = null;
        return json(null, 204);
      }
      if (ich === null) return json({ type: "x/auth" }, 401);
      if (this.abgelaufen.delete(pfad)) return json({ type: "x/auth" }, 401);
      const warten = this.verzoegert.get(pfad);
      if (warten) {
        this.verzoegert.delete(pfad);
        warten.signal = init?.signal ?? null;
        await new Promise<void>((weiter) => {
          warten.freigeben = weiter;
        });
        if (init?.signal?.aborted) this.abgebrochen.push(pfad);
      }
      if (pfad === "/api/v1/me") {
        return json({
          user_id: ich.user,
          email: ich.email,
          full_name: ich.user,
          organization: { id: ich.org, name: ich.org, slug: ich.org },
          member_id: ich.member,
          roles: [],
          permissions: [],
        });
      }
      if (pfad === "/api/v1/me/modules") return json([]);
      if (pfad === "/api/v1/me/preferences") {
        return json({ stored: false, theme_mode: "system", accent: "blue", length_unit: "cm", version: 0 });
      }
      return json({ kontext: name(ich), pfad });
    });
  }

  verzoegern(pfad: string): Aufgeschoben {
    const eintrag: Aufgeschoben = { freigeben: () => undefined, signal: null };
    this.verzoegert.set(pfad, eintrag);
    return eintrag;
  }
}

/** Geschützte Daten der vier Bereiche - gleiche Schlüssel in jedem Kontext. */
const BEREICHE = [
  { schluessel: ["customers"], pfad: "/api/v1/customers" },
  { schluessel: ["project", "p-1"], pfad: "/api/v1/projects/p-1" },
  { schluessel: ["members"], pfad: "/api/v1/members" },
  { schluessel: ["electrical", "rooms", "f-1"], pfad: "/api/v1/electrical/floors/f-1/rooms" },
] as const;

type Roh = { get: (pfad: string) => Promise<{ kontext: string }> };
const roh = (api: ApiClient) => api as unknown as Roh;

/** Jedes gerenderte Bild: angemeldeter Kontext -> Kontext der gezeigten Daten. */
let bilder: { angemeldet: string; daten: string }[] = [];
let clients: QueryClient[] = [];

function Bereich({ schluessel, pfad }: { schluessel: readonly string[]; pfad: string }) {
  const { api, me } = useAuth();
  const abfrage = useQuery({ queryKey: [...schluessel], queryFn: () => roh(api).get(pfad) });
  const angemeldet = me ? `${me.user_id}@${me.organization.id}` : "-";
  if (abfrage.data) bilder.push({ angemeldet, daten: abfrage.data.kontext });
  return <li>{abfrage.data ? `${pfad}=${abfrage.data.kontext}` : `${pfad} lädt`}</li>;
}

function Speichern() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => roh(api).get("/api/v1/speichern"),
    onMutate: () => {
      // Optimistisch: sofort im Cache des aktuellen Kontexts.
      queryClient.setQueryData(["customers"], { kontext: "optimistisch" });
    },
    onSuccess: (antwort) => queryClient.setQueryData(["customers"], antwort),
  });
  return (
    <button type="button" onClick={() => mutation.mutate()}>
      Speichern
    </button>
  );
}

function ClientMerken() {
  const queryClient = useQueryClient();
  if (!clients.includes(queryClient)) clients.push(queryClient);
  return null;
}

function Anzeige() {
  const { status, me, logout, login, switchOrganization } = useAuth();
  return (
    <>
      <ClientMerken />
      <p>
        status:{status}:{me ? `${me.user_id}@${me.organization.id}` : "-"}
      </p>
      <button type="button" onClick={() => void logout()}>
        Abmelden
      </button>
      <button type="button" onClick={() => void login(B1.email, "geheim-geheim")}>
        Bert anmelden
      </button>
      <button type="button" onClick={() => void switchOrganization("org-2")}>
        Betrieb 2
      </button>
      {status === "authenticated" && (
        <>
          <ul>
            {BEREICHE.map((b) => (
              <Bereich key={b.pfad} schluessel={b.schluessel} pfad={b.pfad} />
            ))}
          </ul>
          <Speichern />
        </>
      )}
    </>
  );
}

let server: Server;

beforeEach(() => {
  bilder = [];
  clients = [];
  server = new Server();
  server.installieren();
});

afterEach(() => vi.restoreAllMocks());

async function startenAls(k: Kontext) {
  server.cookie = k;
  render(
    <AuthProvider>
      <Anzeige />
    </AuthProvider>,
  );
  for (const b of BEREICHE) {
    expect(await screen.findByText(`${b.pfad}=${name(k)}`)).toBeInTheDocument();
  }
}

function keinBildMitFremdenDaten() {
  for (const bild of bilder) expect(bild.daten).toBe(bild.angemeldet);
}

/** Kein Cache außer dem des aktuellen Kontexts enthält noch Daten. */
function alteCachesLeer(aktuell: QueryClient | undefined) {
  for (const client of clients) {
    if (client === aktuell) continue;
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  }
}

function aktuellerClient(): QueryClient | undefined {
  return clients[clients.length - 1];
}

describe("Trennung der Browserdaten nach Benutzer und Betrieb", () => {
  it("Benutzer A -> Abmelden -> Benutzer B im selben Browser sieht nie Daten von A", async () => {
    await startenAls(A1);
    const vonA = aktuellerClient();
    expect(vonA?.getQueryData(["customers"])).toEqual({ kontext: name(A1), pfad: "/api/v1/customers" });

    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    await waitFor(() => expect(screen.getByText("status:anonymous:-")).toBeInTheDocument());
    expect(screen.queryByText(new RegExp(name(A1)))).toBeNull();
    expect(vonA?.getQueryCache().getAll()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Bert anmelden" }));
    for (const b of BEREICHE) {
      expect(await screen.findByText(`${b.pfad}=${name(B1)}`)).toBeInTheDocument();
    }
    expect(screen.queryByText(new RegExp(name(A1)))).toBeNull();
    keinBildMitFremdenDaten();
    alteCachesLeer(aktuellerClient());
    expect(aktuellerClient()).not.toBe(vonA);
  });

  it("Betrieb A -> Betrieb B bei gleichem Benutzer: neuer Cache, kein Bild mit Daten aus A", async () => {
    await startenAls(A1);
    fireEvent.click(screen.getByRole("button", { name: "Betrieb 2" }));
    for (const b of BEREICHE) {
      expect(await screen.findByText(`${b.pfad}=${name(A2)}`)).toBeInTheDocument();
    }
    expect(screen.queryByText(new RegExp(name(A1)))).toBeNull();
    keinBildMitFremdenDaten();
    alteCachesLeer(aktuellerClient());
  });

  it("eine langsame Anfrage aus A wird beim Wechsel abgebrochen und ihre Antwort verworfen", async () => {
    server.cookie = A1;
    const langsam = server.verzoegern("/api/v1/customers");
    render(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    expect(await screen.findByText(`/api/v1/members=${name(A1)}`)).toBeInTheDocument();
    expect(screen.getByText("/api/v1/customers lädt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Betrieb 2" }));
    expect(await screen.findByText(`/api/v1/members=${name(A2)}`)).toBeInTheDocument();
    expect(langsam.signal?.aborted).toBe(true);

    // Die Antwort aus A kommt erst jetzt - sie darf nirgends ankommen.
    await act(async () => {
      langsam.freigeben();
      await Promise.resolve();
    });
    expect(await screen.findByText(`/api/v1/customers=${name(A2)}`)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(name(A1)))).toBeNull();
    expect(aktuellerClient()?.getQueryData(["customers"])).toEqual({
      kontext: name(A2),
      pfad: "/api/v1/customers",
    });
    keinBildMitFremdenDaten();
    alteCachesLeer(aktuellerClient());
  });

  it("die Sitzung endet während einer laufenden Anfrage: abgebrochen, nichts mehr angezeigt", async () => {
    server.cookie = A1;
    const langsam = server.verzoegern("/api/v1/customers");
    render(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    expect(await screen.findByText(`/api/v1/members=${name(A1)}`)).toBeInTheDocument();
    const vonA = aktuellerClient();

    // Access Token abgelaufen, Erneuerung scheitert (Sitzung serverseitig beendet).
    server.refreshErlaubt = false;
    server.abgelaufen.add("/api/v1/members");
    await act(async () => {
      await vonA?.refetchQueries({ queryKey: ["members"] });
    });
    await waitFor(() => expect(screen.getByText("status:anonymous:-")).toBeInTheDocument());
    expect(langsam.signal?.aborted).toBe(true);

    await act(async () => {
      langsam.freigeben();
      await Promise.resolve();
    });
    expect(screen.queryByText(new RegExp(name(A1)))).toBeNull();
    expect(vonA?.getQueryCache().getAll()).toHaveLength(0);
    keinBildMitFremdenDaten();
  });

  it("ein Cookie eines anderen Benutzers aus einem anderen Tab beginnt einen neuen Kontext", async () => {
    await startenAls(A1);
    // In einem anderen Tab hat sich Bert angemeldet; dieser Tab erneuert.
    server.cookie = B1;
    server.abgelaufen.add("/api/v1/members");
    await act(async () => {
      await aktuellerClient()?.refetchQueries({ queryKey: ["members"] });
    });
    for (const b of BEREICHE) {
      expect(await screen.findByText(`${b.pfad}=${name(B1)}`)).toBeInTheDocument();
    }
    expect(screen.getByText(`status:authenticated:${name(B1)}`)).toBeInTheDocument();
    keinBildMitFremdenDaten();
    alteCachesLeer(aktuellerClient());
  });

  it("Mutation und optimistischer Stand aus A erreichen den Kontext B nicht", async () => {
    await startenAls(A1);
    const vonA = aktuellerClient();
    const speichern = server.verzoegern("/api/v1/speichern");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("/api/v1/customers=optimistisch")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Betrieb 2" }));
    expect(await screen.findByText(`/api/v1/customers=${name(A2)}`)).toBeInTheDocument();
    expect(vonA?.getMutationCache().getAll()).toHaveLength(0);
    await act(async () => {
      speichern.freigeben();
      await Promise.resolve();
    });
    expect(speichern.signal?.aborted).toBe(true);
    expect(screen.queryByText(/optimistisch/)).toBeNull();
    expect(aktuellerClient()?.getQueryData(["customers"])).toEqual({
      kontext: name(A2),
      pfad: "/api/v1/customers",
    });
    alteCachesLeer(aktuellerClient());
  });
});
