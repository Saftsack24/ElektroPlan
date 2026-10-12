import { createApiClient } from "@elektroplan/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ANONYMER_SCHLUESSEL, kontextAusToken, kontextSchluessel, sitzungsraumErzeugen } from "./sitzungsraum";

function token(nutzlast: Record<string, unknown>): string {
  const teil = btoa(JSON.stringify(nutzlast)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `kopf.${teil}.signatur`;
}

afterEach(() => vi.restoreAllMocks());

describe("Sitzungskontext aus dem Access Token", () => {
  it("liest Benutzer, Betrieb und Mitgliedschaft", () => {
    expect(kontextAusToken(token({ sub: "u", org: "o", mid: "m" }))).toEqual({
      benutzerId: "u",
      betriebId: "o",
      mitgliedId: "m",
    });
  });

  it("unlesbare Tokens haben keinen Kontext, aber je Token einen eigenen Schlüssel", () => {
    expect(kontextAusToken("kein-jwt")).toBeNull();
    expect(kontextAusToken(token({ sub: "u" }))).toBeNull();
    const a = kontextSchluessel("kein-jwt-a").schluessel;
    const b = kontextSchluessel("kein-jwt-b").schluessel;
    expect(a).not.toBe(b);
    expect(a).not.toContain("kein-jwt");
  });

  it("gleicher Benutzer, anderer Betrieb ist ein anderer Kontext; ohne Token anonym", () => {
    const eins = kontextSchluessel(token({ sub: "u", org: "o1", mid: "m1" })).schluessel;
    const zwei = kontextSchluessel(token({ sub: "u", org: "o2", mid: "m2" })).schluessel;
    const erneuert = kontextSchluessel(token({ sub: "u", org: "o1", mid: "m1", jti: "neu" })).schluessel;
    expect(eins).not.toBe(zwei);
    expect(eins).toBe(erneuert);
    expect(kontextSchluessel(null).schluessel).toBe(ANONYMER_SCHLUESSEL);
  });
});

describe("Sitzungsraum", () => {
  it("beenden bricht ab und löscht Abfragen und Mutationen", () => {
    const raum = sitzungsraumErzeugen("u:o:m", null);
    raum.queryClient.setQueryData(["customers"], ["geheim"]);
    raum.beenden();
    expect(raum.aktiv).toBe(false);
    expect(raum.signal.aborted).toBe(true);
    expect(raum.queryClient.getQueryCache().getAll()).toHaveLength(0);
    raum.beenden();
  });

  it("jeder Raum hat einen eigenen Cache", () => {
    const a = sitzungsraumErzeugen("a", null);
    const b = sitzungsraumErzeugen("a", null);
    a.queryClient.setQueryData(["x"], 1);
    expect(b.queryClient.getQueryData(["x"])).toBeUndefined();
    expect(a.id).not.toBe(b.id);
  });
});

describe("API-Client mit Sitzungssignal", () => {
  it("eine nach dem Ende der Sitzung eintreffende Antwort wird verworfen", async () => {
    let freigeben: () => void = () => undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise<void>((weiter) => (freigeben = weiter));
      return new Response(JSON.stringify({ geheim: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const sitzung = new AbortController();
    const api = createApiClient({
      baseUrl: "http://localhost",
      getAccessToken: () => "t",
      signal: sitzung.signal,
    });
    const anfrage = api.get("/api/v1/me");
    await Promise.resolve();
    sitzung.abort();
    freigeben();
    await expect(anfrage).rejects.toMatchObject({ name: "AbortError" });
  });

  it("das Anfragesignal bleibt wirksam; nach dem Ende startet keine Anfrage mehr", async () => {
    let freigeben: () => void = () => undefined;
    const abruf = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise<void>((weiter) => (freigeben = weiter));
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const sitzung = new AbortController();
    const api = createApiClient({ baseUrl: "http://localhost", getAccessToken: () => null, signal: sitzung.signal });
    const eigenes = new AbortController();
    const anfrage = api.get("/api/v1/me", { signal: eigenes.signal });
    await Promise.resolve();
    const init = abruf.mock.calls[0]?.[1];
    expect(init?.signal?.aborted).toBe(false);
    eigenes.abort();
    expect(init?.signal?.aborted).toBe(true);
    freigeben();
    await anfrage;
    sitzung.abort();
    await expect(api.get("/api/v1/me")).rejects.toMatchObject({ name: "AbortError" });
    expect(abruf).toHaveBeenCalledTimes(1);
  });
});

describe("Projektabfrage nach Benutzer- oder Betriebswechsel", () => {
  it("eine verspätete Projektantwort kommt nach dem Ende der Sitzung nicht in den Cache", async () => {
    let freigeben: () => void = () => undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise<void>((weiter) => (freigeben = weiter));
      return new Response(JSON.stringify({ id: "p", updated_by: "Benutzer A" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const raum = sitzungsraumErzeugen("a:o:m", null);
    const api = createApiClient({ baseUrl: "http://localhost", getAccessToken: () => "t", signal: raum.signal });
    // Wie nach einem Schreibvorgang: gezielt nur die Projektabfrage neu laden.
    const laden = raum.queryClient.fetchQuery({
      queryKey: ["project", "p"],
      queryFn: ({ signal }) => api.get("/api/v1/projects/{project_id}", { path: { project_id: "p" }, signal }),
    });
    await Promise.resolve();
    raum.beenden();
    freigeben();
    // Das Sitzungsende bricht die Abfrage ab (CancelledError bzw. AbortError) - keine Daten.
    await expect(laden).rejects.toBeInstanceOf(Error);
    await Promise.resolve();
    expect(raum.queryClient.getQueryData(["project", "p"])).toBeUndefined();
    expect(raum.queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});