import { ApiError } from "@elektroplan/api-client";
import type { ApiClient, PreferencesOut } from "@elektroplan/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { darstellungszustand } from "../theme/darstellung";
import { masseinheit } from "../ui/masseinheit";
import {
  STANDARD_EINSTELLUNGEN,
  altbestandLesen,
  cacheSchluessel,
  einstellungenAnmelden,
  einstellungenLaden,
  einstellungenSpeichern,
  einstellungsabgleich,
  gueltigeEinstellungen,
  EinstellungsKonflikt,
} from "./persoenlich";

/**
 * Server ist die Wahrheit, Cache je Mitgliedschaft, einmalige Übernahme des
 * lokalen Altbestands (Phase 4e, ADR 0021).
 */
const ANNA = { benutzerId: "11111111-1111-4111-8111-111111111111", mitgliedId: "aaaaaaaa-1111-4111-8111-111111111111" };
const BERT = { benutzerId: "22222222-2222-4222-8222-222222222222", mitgliedId: "bbbbbbbb-2222-4222-8222-222222222222" };

type Stand = { theme_mode: string; accent: string; length_unit: string; version: number };

function problem(status: number, typ: string): ApiError {
  return new ApiError(status, { type: `https://elektroplan.internal/errors/${typ}`, title: "x", status }, null);
}

/** Ein simulierter Server mit genau einem Datensatz je Mitgliedschaft. */
function server(start: Record<string, Stand | null> = {}) {
  const staende: Record<string, Stand | null> = { ...start };
  let wer = ANNA.mitgliedId;
  const antwort = (): PreferencesOut => {
    const stand = staende[wer] ?? null;
    return stand === null
      ? { stored: false, theme_mode: "system", accent: "blue", length_unit: "cm", version: 0 }
      : ({ stored: true, ...stand } as PreferencesOut);
  };
  const api = {
    get: vi.fn(() => Promise.resolve(antwort())),
    post: vi.fn((_p: string, o: { body: Record<string, string> }) => {
      if ((staende[wer] ?? null) !== null) return Promise.reject(problem(409, "preferences-exist"));
      staende[wer] = { theme_mode: o.body["theme_mode"] ?? "", accent: o.body["accent"] ?? "", length_unit: o.body["length_unit"] ?? "", version: 1 };
      return Promise.resolve(antwort());
    }),
    put: vi.fn((_p: string, o: { ifMatch: number; body: Record<string, string> }) => {
      const stand = staende[wer] ?? null;
      if (stand === null) return Promise.reject(problem(404, "not-found"));
      if (o.ifMatch !== stand.version) return Promise.reject(problem(409, "version-conflict"));
      staende[wer] = { theme_mode: o.body["theme_mode"] ?? "", accent: o.body["accent"] ?? "", length_unit: o.body["length_unit"] ?? "", version: stand.version + 1 };
      return Promise.resolve(antwort());
    }),
  };
  return {
    api: api as unknown as ApiClient,
    /** Dieselben Funktionen, ungebunden prüfbar. */
    aufrufe: api,
    staende,
    als(mitgliedId: string) {
      wer = mitgliedId;
    },
  };
}

function cacheSetzen(mitgliedId: string, wert: unknown) {
  window.localStorage.setItem(cacheSchluessel(mitgliedId), typeof wert === "string" ? wert : JSON.stringify(wert));
}

const wurzel = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
});

describe("Server ist die Wahrheit", () => {
  it("wendet den Serverstand an und schreibt den Cache dieser Mitgliedschaft", async () => {
    const s = server({ [ANNA.mitgliedId]: { theme_mode: "dark", accent: "teal", length_unit: "m", version: 4 } });
    einstellungenAnmelden(ANNA);
    await einstellungenLaden(s.api);
    expect(gueltigeEinstellungen()).toEqual({ modus: "dark", akzent: "teal", einheit: "m" });
    expect(wurzel().dataset["theme"]).toBe("dark");
    expect(masseinheit()).toBe("m");
    expect(einstellungsabgleich()).toEqual({ serverVersion: 4, geladen: true, fehler: false });
    expect(JSON.parse(window.localStorage.getItem(cacheSchluessel(ANNA.mitgliedId)) ?? "")).toEqual({
      version: 2,
      modus: "dark",
      akzent: "teal",
      einheit: "m",
      server_version: 4,
    });
  });

  it("zeigt den Cache sofort - noch vor der Serverantwort - und ersetzt ihn dann durch den Server", async () => {
    cacheSetzen(ANNA.mitgliedId, { version: 2, modus: "light", akzent: "green", einheit: "mm", server_version: 2 });
    const s = server({ [ANNA.mitgliedId]: { theme_mode: "dark", accent: "violet", length_unit: "cm", version: 3 } });
    einstellungenAnmelden(ANNA);
    expect(gueltigeEinstellungen()).toEqual({ modus: "light", akzent: "green", einheit: "mm" });
    expect(s.aufrufe.get).not.toHaveBeenCalled();
    await einstellungenLaden(s.api);
    expect(gueltigeEinstellungen()).toEqual({ modus: "dark", akzent: "violet", einheit: "cm" });
  });

  it("ein vorhandener Serverstand gewinnt immer gegen den lokalen Altbestand", async () => {
    window.localStorage.setItem(`elektroplan.darstellung.${ANNA.benutzerId}`, '{"version":1,"modus":"light","akzent":"orange"}');
    window.localStorage.setItem(`elektroplan.masseinheit.${ANNA.benutzerId}`, "mm");
    const s = server({ [ANNA.mitgliedId]: { theme_mode: "dark", accent: "teal", length_unit: "m", version: 1 } });
    einstellungenAnmelden(ANNA);
    await einstellungenLaden(s.api);
    expect(s.aufrufe.post).not.toHaveBeenCalled();
    expect(gueltigeEinstellungen()).toEqual({ modus: "dark", akzent: "teal", einheit: "m" });
    // Der Altbestand ist danach weg und kann nie mehr gewinnen.
    expect(window.localStorage.getItem(`elektroplan.darstellung.${ANNA.benutzerId}`)).toBeNull();
    expect(window.localStorage.getItem(`elektroplan.masseinheit.${ANNA.benutzerId}`)).toBeNull();
  });

  it("verwirft einen beschädigten oder unbekannten Cache - es gilt der Standard bis zum Server", () => {
    for (const kaputt of ["{nein", '"dark"', JSON.stringify({ version: 2, modus: "sepia", akzent: "teal", einheit: "m", server_version: 1 }), JSON.stringify({ version: 1, modus: "dark", akzent: "teal", einheit: "m", server_version: 1 }), JSON.stringify({ version: 2, modus: "dark", akzent: "teal", einheit: "zoll", server_version: 1 })]) {
      einstellungenAnmelden(null);
      cacheSetzen(ANNA.mitgliedId, kaputt);
      einstellungenAnmelden(ANNA);
      expect(gueltigeEinstellungen()).toEqual(STANDARD_EINSTELLUNGEN);
      expect(einstellungsabgleich().serverVersion).toBeNull();
    }
  });
});

describe("Einmalige Übernahme des lokalen Altbestands", () => {
  it("überträgt gültige alte Werte einmal an den Server und entfernt sie dann", async () => {
    window.localStorage.setItem(`elektroplan.darstellung.${ANNA.benutzerId}`, '{"version":1,"modus":"dark","akzent":"violet"}');
    window.localStorage.setItem(`elektroplan.masseinheit.${ANNA.benutzerId}`, "mm");
    const s = server();
    einstellungenAnmelden(ANNA);
    await einstellungenLaden(s.api);
    expect(s.aufrufe.post).toHaveBeenCalledTimes(1);
    expect(s.aufrufe.post).toHaveBeenCalledWith("/api/v1/me/preferences", {
      body: { theme_mode: "dark", accent: "violet", length_unit: "mm" },
    });
    expect(s.staende[ANNA.mitgliedId]?.version).toBe(1);
    expect(gueltigeEinstellungen()).toEqual({ modus: "dark", akzent: "violet", einheit: "mm" });
    expect(altbestandLesen(ANNA.benutzerId)).toBeNull();

    // Erneutes Anmelden: Server vorhanden, keine zweite Übernahme.
    einstellungenAnmelden(null);
    einstellungenAnmelden(ANNA);
    await einstellungenLaden(s.api);
    expect(s.aufrufe.post).toHaveBeenCalledTimes(1);
  });

  it("übernimmt auch nur eine alte Maßeinheit (auch den browserweiten Schlüssel aus 4b.1)", async () => {
    window.localStorage.setItem("elektroplan.masseinheit", "mm");
    const s = server();
    einstellungenAnmelden(ANNA);
    await einstellungenLaden(s.api);
    expect(s.aufrufe.post).toHaveBeenCalledWith("/api/v1/me/preferences", {
      body: { theme_mode: "system", accent: "blue", length_unit: "mm" },
    });
    expect(window.localStorage.getItem("elektroplan.masseinheit")).toBeNull();
  });

  it("ohne gültigen Altbestand gilt der Standard, angelegt wird erst beim ersten Speichern", async () => {
    window.localStorage.setItem(`elektroplan.darstellung.${ANNA.benutzerId}`, "{kaputt");
    window.localStorage.setItem(`elektroplan.masseinheit.${ANNA.benutzerId}`, "zoll");
    const s = server();
    einstellungenAnmelden(ANNA);
    await einstellungenLaden(s.api);
    expect(s.aufrufe.post).not.toHaveBeenCalled();
    expect(gueltigeEinstellungen()).toEqual(STANDARD_EINSTELLUNGEN);
    expect(einstellungsabgleich()).toEqual({ serverVersion: null, geladen: true, fehler: false });
  });

  it("legt ein anderes Gerät gleichzeitig an, gewinnt dessen Serverstand", async () => {
    window.localStorage.setItem(`elektroplan.masseinheit.${ANNA.benutzerId}`, "mm");
    const s = server();
    // Zwischen GET und POST legt ein zweites Gerät an.
    s.aufrufe.get.mockImplementationOnce(() => {
      const antwort: PreferencesOut = { stored: false, theme_mode: "system", accent: "blue", length_unit: "cm", version: 0 };
      s.staende[ANNA.mitgliedId] = { theme_mode: "light", accent: "teal", length_unit: "m", version: 1 };
      return Promise.resolve(antwort);
    });
    einstellungenAnmelden(ANNA);
    await einstellungenLaden(s.api);
    expect(s.aufrufe.post).toHaveBeenCalledTimes(1);
    expect(gueltigeEinstellungen()).toEqual({ modus: "light", akzent: "teal", einheit: "m" });
    expect(einstellungsabgleich().serverVersion).toBe(1);
  });
});

describe("Getrennte Benutzer, Geräte und Tabs", () => {
  it("übernimmt nie den Cache oder Altbestand eines anderen Benutzers", async () => {
    cacheSetzen(ANNA.mitgliedId, { version: 2, modus: "dark", akzent: "orange", einheit: "m", server_version: 7 });
    window.localStorage.setItem(`elektroplan.masseinheit.${ANNA.benutzerId}`, "mm");
    const s = server({ [BERT.mitgliedId]: null });
    s.als(BERT.mitgliedId);
    einstellungenAnmelden(BERT);
    expect(gueltigeEinstellungen()).toEqual(STANDARD_EINSTELLUNGEN);
    await einstellungenLaden(s.api);
    expect(s.aufrufe.post).not.toHaveBeenCalled();
    expect(gueltigeEinstellungen()).toEqual(STANDARD_EINSTELLUNGEN);
    // Annas Einträge bleiben unangetastet.
    expect(window.localStorage.getItem(`elektroplan.masseinheit.${ANNA.benutzerId}`)).toBe("mm");
  });

  it("ein zweites Browserprofil ohne Cache erhält denselben Serverstand", async () => {
    const s = server({ [ANNA.mitgliedId]: { theme_mode: "dark", accent: "green", length_unit: "m", version: 9 } });
    einstellungenAnmelden(ANNA);
    expect(gueltigeEinstellungen()).toEqual(STANDARD_EINSTELLUNGEN);
    await einstellungenLaden(s.api);
    expect(gueltigeEinstellungen()).toEqual({ modus: "dark", akzent: "green", einheit: "m" });
  });

  it("nach dem Abmelden gilt der Standard; eine späte Antwort ändert nichts mehr", async () => {
    const s = server({ [ANNA.mitgliedId]: { theme_mode: "dark", accent: "green", length_unit: "m", version: 1 } });
    let freigeben: (() => void) | undefined;
    s.aufrufe.get.mockImplementationOnce(
      () =>
        new Promise<PreferencesOut>((resolve) => {
          freigeben = () => resolve({ stored: true, theme_mode: "dark", accent: "green", length_unit: "m", version: 1 });
        }),
    );
    einstellungenAnmelden(ANNA);
    const laden = einstellungenLaden(s.api);
    einstellungenAnmelden(null);
    freigeben?.();
    await laden;
    expect(gueltigeEinstellungen()).toEqual(STANDARD_EINSTELLUNGEN);
    expect(darstellungszustand().darstellung).toEqual({ modus: "system", akzent: "blue" });
  });

  it("ein anderer Tab desselben Benutzers zieht nach - fremde Schlüssel nicht", async () => {
    const s = server({ [ANNA.mitgliedId]: { theme_mode: "light", accent: "blue", length_unit: "cm", version: 1 } });
    einstellungenAnmelden(ANNA);
    await einstellungenLaden(s.api);
    cacheSetzen(BERT.mitgliedId, { version: 2, modus: "dark", akzent: "orange", einheit: "m", server_version: 3 });
    window.dispatchEvent(new StorageEvent("storage", { key: cacheSchluessel(BERT.mitgliedId) }));
    expect(gueltigeEinstellungen().akzent).toBe("blue");
    cacheSetzen(ANNA.mitgliedId, { version: 2, modus: "dark", akzent: "teal", einheit: "m", server_version: 2 });
    window.dispatchEvent(new StorageEvent("storage", { key: cacheSchluessel(ANNA.mitgliedId) }));
    expect(gueltigeEinstellungen()).toEqual({ modus: "dark", akzent: "teal", einheit: "m" });
    expect(einstellungsabgleich().serverVersion).toBe(2);
  });

  it("ohne Netz bleibt der Cache stehen und der Fehler wird vermerkt", async () => {
    cacheSetzen(ANNA.mitgliedId, { version: 2, modus: "dark", akzent: "teal", einheit: "mm", server_version: 2 });
    const s = server();
    s.aufrufe.get.mockRejectedValueOnce(new TypeError("Netz"));
    einstellungenAnmelden(ANNA);
    await einstellungenLaden(s.api);
    expect(gueltigeEinstellungen()).toEqual({ modus: "dark", akzent: "teal", einheit: "mm" });
    expect(einstellungsabgleich().fehler).toBe(true);
  });
});

describe("Speichern", () => {
  it("ändert mit der Version des Serverstands und meldet einen Konflikt verständlich", async () => {
    const s = server({ [ANNA.mitgliedId]: { theme_mode: "light", accent: "blue", length_unit: "cm", version: 1 } });
    einstellungenAnmelden(ANNA);
    await einstellungenLaden(s.api);
    await einstellungenSpeichern(s.api, { modus: "dark", akzent: "blue", einheit: "m" });
    expect(s.aufrufe.put).toHaveBeenLastCalledWith("/api/v1/me/preferences", {
      ifMatch: 1,
      body: { theme_mode: "dark", accent: "blue", length_unit: "m" },
    });
    expect(einstellungsabgleich().serverVersion).toBe(2);

    // Zweites Gerät speichert dazwischen.
    s.staende[ANNA.mitgliedId] = { theme_mode: "system", accent: "orange", length_unit: "mm", version: 3 };
    await expect(einstellungenSpeichern(s.api, { modus: "light", akzent: "teal", einheit: "cm" })).rejects.toBeInstanceOf(
      EinstellungsKonflikt,
    );
    expect(gueltigeEinstellungen()).toEqual({ modus: "system", akzent: "orange", einheit: "mm" });
    expect(s.staende[ANNA.mitgliedId]?.version).toBe(3);
  });
});
