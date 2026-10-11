import { ApiError, createApiClient } from "@elektroplan/api-client";
import type { ApiClient, MeResponse, TokenResponse } from "@elektroplan/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { config } from "../config";
import { einstellungenAnmelden, einstellungenLaden } from "../einstellungen/persoenlich";
import { ANONYMER_SCHLUESSEL, kontextSchluessel, sitzungsraumErzeugen } from "../sitzung/sitzungsraum";
import type { Sitzungsraum } from "../sitzung/sitzungsraum";

interface AuthState {
  status: "loading" | "anonymous" | "authenticated";
  me: MeResponse | null;
  activeModuleIds: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  /** Sitzungsraum des aktuellen Kontexts (Benutzer + Betrieb). */
  raum: Sitzungsraum;
}

interface AuthContextValue extends Omit<AuthState, "raum"> {
  /**
   * API-Client des **aktuellen** Sitzungskontexts. Nach einem Wechsel von
   * Benutzer oder Betrieb gibt es einen neuen Client; Anfragen des alten
   * werden abgebrochen, ihre Antworten verworfen.
   */
  api: ApiClient;
  login: (email: string, password: string, organizationId?: string) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  /**
   * Lädt Benutzer, Rollen und Rechte neu. Rechte gelten serverseitig ab der
   * nächsten Anfrage; die Oberfläche zieht damit nach - etwa nach einer
   * eigenen Rollenänderung oder wenn das Fenster wieder in den Vordergrund
   * kommt.
   */
  aktualisieren: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EMPTY_SET: ReadonlySet<string> = new Set();

type Inhalt = Omit<AuthState, "raum">;

const ANONYMOUS: Inhalt = {
  status: "anonymous",
  me: null,
  activeModuleIds: EMPTY_SET,
  permissions: EMPTY_SET,
};

const LOADING: Inhalt = { ...ANONYMOUS, status: "loading" };

/**
 * Anmeldung, Sitzung und Sitzungskontext.
 *
 * **Trennung der Browserdaten (Sicherheitsauftrag 2026-10-10, Befund 1):**
 * Jeder Kontext aus Benutzer und Betrieb - gelesen aus dem Access Token -
 * hat einen eigenen {@link Sitzungsraum} mit eigenem `QueryClient` und eigenem
 * Abbruchsignal. Ändert sich der Kontext (Abmelden, anderer Benutzer, anderer
 * Betrieb, Verlust der Sitzung, auch durch ein Cookie aus einem anderen Tab),
 * wird der alte Raum sofort beendet und der Teilbaum unter diesem Provider
 * neu aufgebaut. So rendert nichts mehr mit Daten des alten Kontexts, laufende
 * Anfragen brechen ab, und eine verspätete Antwort erreicht weder Cache noch
 * Oberfläche des neuen Kontexts. Module brauchen dafür nichts zu tun: Sie
 * verwenden `useAuth().api` und `useQueryClient()` wie bisher.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // Der Access Token lebt nur im Speicher. Der Refresh Token steht im
  // HttpOnly-Cookie und ist fuer JavaScript nicht lesbar - er taucht auch
  // nicht mehr im Antwortkoerper auf (docs/security.md, Abschnitt 3).
  const accessToken = useRef<string | null>(null);
  // Single-Flight: Waehrend einer laufenden Erneuerung warten alle weiteren
  // Anfragen auf dasselbe Promise. Sonst wuerden mehrere parallele 401er
  // mehrere Rotationen ausloesen und die Wiederverwendungserkennung treffen.
  const pendingRenewal = useRef<Promise<boolean> | null>(null);
  // Zählt jede bewusste Sitzungsänderung (Anmelden, Abmelden, Betriebswechsel).
  // Eine Antwort, die zu einer älteren Epoche gehört, wird verworfen.
  const epoche = useRef(0);
  const [state, setState] = useState<AuthState>(() => ({
    ...LOADING,
    raum: sitzungsraumErzeugen(ANONYMER_SCHLUESSEL, null),
  }));
  const raumRef = useRef<Sitzungsraum>(state.raum);

  /**
   * Setzt den Access Token und prüft dabei den Sitzungskontext. Gehört der
   * Token zu einem anderen Kontext als der aktuelle Raum, endet dieser sofort,
   * und ein neuer, noch leerer Raum beginnt. Liefert den danach gültigen Raum.
   */
  const tokenSetzen = useCallback((token: string | null): Sitzungsraum => {
    accessToken.current = token;
    const { schluessel, kontext } = kontextSchluessel(token);
    const bisher = raumRef.current;
    if (bisher.aktiv && bisher.schluessel === schluessel) return bisher;
    bisher.beenden();
    const neu = sitzungsraumErzeugen(schluessel, kontext);
    raumRef.current = neu;
    setState({ ...(token === null ? ANONYMOUS : LOADING), raum: neu });
    return neu;
  }, []);

  const neueEpoche = useCallback((): number => {
    epoche.current += 1;
    // Eine laufende Erneuerung gehört zur alten Epoche; neue Aufrufer warten
    // nicht auf sie.
    pendingRenewal.current = null;
    return epoche.current;
  }, []);

  const renewSession = useCallback((): Promise<boolean> => {
    if (pendingRenewal.current !== null) {
      return pendingRenewal.current;
    }
    const meineEpoche = epoche.current;

    const run = (async (): Promise<boolean> => {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/v1/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (meineEpoche !== epoche.current) return false;
        if (!response.ok) {
          return false;
        }
        const tokens = (await response.json()) as TokenResponse;
        if (meineEpoche !== epoche.current) return false;
        // Gehört das erneuerte Cookie inzwischen einem anderen Benutzer oder
        // Betrieb (etwa nach einer Anmeldung in einem anderen Tab), beginnt
        // hier ein neuer Kontext.
        tokenSetzen(tokens.access_token);
        return true;
      } catch {
        return false;
      }
    })();

    pendingRenewal.current = run;
    void run.finally(() => {
      if (pendingRenewal.current === run) pendingRenewal.current = null;
    });
    return run;
  }, [tokenSetzen]);

  const raum = state.raum;
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiBaseUrl,
        signal: raum.signal,
        // Ein Token wird nur mitgesendet, solange er zu diesem Raum gehört.
        getAccessToken: () => (raum.aktiv ? accessToken.current : null),
        onUnauthorized: async () => {
          if (!raum.aktiv) return false;
          const renewed = await renewSession();
          if (!renewed) {
            // Sitzung verloren: Nur der eigene, noch aktive Raum endet.
            if (raum.aktiv) tokenSetzen(null);
            return false;
          }
          // Nur wiederholen, wenn der Kontext derselbe geblieben ist.
          return raum.aktiv;
        },
      }),
    [raum, renewSession, tokenSetzen],
  );

  /** Client ohne Token und ohne Raum - nur für das Abmelden. */
  const sitzungsfreieApi = useMemo(
    () => createApiClient({ baseUrl: config.apiBaseUrl, getAccessToken: () => null }),
    [],
  );

  const sitzungLaden = useCallback(
    async (ziel: Sitzungsraum, zielApi: ApiClient): Promise<void> => {
      try {
        const me = await zielApi.get("/api/v1/me");
        const modules = await zielApi.get("/api/v1/me/modules");
        if (raumRef.current !== ziel || !ziel.aktiv) return;
        const kontext = ziel.kontext;
        if (
          kontext !== null &&
          (me.user_id !== kontext.benutzerId ||
            me.member_id !== kontext.mitgliedId ||
            me.organization.id !== kontext.betriebId)
        ) {
          // Der Server meldet einen anderen Kontext als der Token: lieber neu
          // anmelden als Daten zweier Sitzungen mischen.
          tokenSetzen(null);
          return;
        }
        setState({
          status: "authenticated",
          me,
          activeModuleIds: new Set(modules.map((module) => module.id)),
          permissions: new Set(me.permissions),
          raum: ziel,
        });
      } catch (error) {
        if (raumRef.current !== ziel || !ziel.aktiv) return;
        if (error instanceof ApiError && error.status !== 401) {
          console.error("Sitzung konnte nicht geladen werden", error.errorType);
        }
        tokenSetzen(null);
      }
    },
    [tokenSetzen],
  );

  // Ein neuer Raum mit Token, aber noch ohne Benutzerdaten: laden. Gilt für
  // Anmeldung, Betriebswechsel und einen Kontextwechsel beim Erneuern.
  const zuLaden = state.status === "loading" && raum.schluessel !== ANONYMER_SCHLUESSEL ? raum : null;
  useEffect(() => {
    if (zuLaden !== null) void sitzungLaden(zuLaden, api);
  }, [zuLaden, api, sitzungLaden]);

  const aktualisieren = useCallback(async () => {
    const ziel = raumRef.current;
    try {
      const me = await api.get("/api/v1/me");
      const modules = await api.get("/api/v1/me/modules");
      if (raumRef.current !== ziel || !ziel.aktiv) return;
      setState((bisher) =>
        bisher.raum !== ziel
          ? bisher
          : {
              status: "authenticated",
              me,
              activeModuleIds: new Set(modules.map((module) => module.id)),
              permissions: new Set(me.permissions),
              raum: ziel,
            },
      );
    } catch {
      // Ein 401 hat der Client bereits behandelt (Erneuerung oder Abmeldung).
      // Andere Fehler - etwa ein kurzer Netzausfall - melden niemanden ab.
    }
  }, [api]);

  // Kommt das Fenster zurück, werden Rollen und Rechte neu gelesen. Eine
  // Sperre oder Rollenänderung durch einen Administrator wird so auch in der
  // Oberfläche sichtbar - serverseitig gilt sie ohnehin sofort.
  const angemeldet = state.status === "authenticated";
  useEffect(() => {
    if (!angemeldet) return;
    const beiRueckkehr = () => {
      if (document.visibilityState === "visible") void aktualisieren();
    };
    document.addEventListener("visibilitychange", beiRueckkehr);
    window.addEventListener("focus", beiRueckkehr);
    return () => {
      document.removeEventListener("visibilitychange", beiRueckkehr);
      window.removeEventListener("focus", beiRueckkehr);
    };
  }, [angemeldet, aktualisieren]);

  useEffect(() => {
    // Beim Start einmal versuchen, aus dem Cookie eine Sitzung herzustellen.
    const meineEpoche = epoche.current;
    void (async () => {
      const erneuert = await renewSession();
      if (!erneuert && meineEpoche === epoche.current && accessToken.current === null) {
        setState((bisher) => (bisher.status === "loading" ? { ...ANONYMOUS, raum: bisher.raum } : bisher));
      }
    })();
  }, [renewSession]);

  const login = useCallback(
    async (email: string, password: string, organizationId?: string) => {
      const meineEpoche = neueEpoche();
      const tokens = await sitzungsfreieApi.post("/api/v1/auth/login", {
        body: organizationId
          ? { email, password, organization_id: organizationId }
          : { email, password },
      });
      if (meineEpoche !== epoche.current) return;
      // Neuer Kontext -> neuer, leerer Raum; geladen wird im Effekt oben.
      tokenSetzen(tokens.access_token);
    },
    [neueEpoche, sitzungsfreieApi, tokenSetzen],
  );

  const logout = useCallback(async () => {
    neueEpoche();
    // Sofort lokal beenden: Anfragen abbrechen, Daten löschen, nichts mehr
    // aus dieser Sitzung anzeigen - dann serverseitig die Familie widerrufen.
    tokenSetzen(null);
    await sitzungsfreieApi.post("/api/v1/auth/logout");
  }, [neueEpoche, sitzungsfreieApi, tokenSetzen]);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      const meineEpoche = neueEpoche();
      const tokens = await api.post("/api/v1/auth/switch-organization", {
        body: { organization_id: organizationId },
      });
      if (meineEpoche !== epoche.current) return;
      // Anderer Betrieb -> anderer Kontext: alter Raum endet, neuer lädt.
      tokenSetzen(tokens.access_token);
    },
    [api, neueEpoche, tokenSetzen],
  );

  // Persönliche Einstellungen gehören dem angemeldeten Benutzer in diesem
  // Betrieb - der Server ist die Wahrheit (ADR 0021). Vor dem ersten Bild
  // gilt der Cache genau dieser Mitgliedschaft (oder der Standard), damit nie
  // die Wahl eines anderen Benutzers aufblitzt; danach der Serverstand. Beim
  // Laden und nach dem Abmelden gilt der Standard.
  const benutzerId = state.status === "authenticated" ? (state.me?.user_id ?? null) : null;
  const mitgliedId = state.status === "authenticated" ? (state.me?.member_id ?? null) : null;
  useLayoutEffect(() => {
    einstellungenAnmelden(
      benutzerId !== null && mitgliedId !== null ? { benutzerId, mitgliedId } : null,
    );
  }, [benutzerId, mitgliedId]);
  useEffect(() => {
    if (mitgliedId !== null) void einstellungenLaden(api);
  }, [mitgliedId, api]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      me: state.me,
      activeModuleIds: state.activeModuleIds,
      permissions: state.permissions,
      api,
      login,
      logout,
      switchOrganization,
      aktualisieren,
    }),
    [state, api, login, logout, switchOrganization, aktualisieren],
  );

  return (
    <AuthContext.Provider value={value}>
      <QueryClientProvider client={raum.queryClient}>
        {/* Neuer Raum -> neuer Teilbaum: Kein Zustand einer Komponente überlebt
            einen Wechsel von Benutzer oder Betrieb. */}
        <Fragment key={raum.id}>{children}</Fragment>
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth muss innerhalb von AuthProvider verwendet werden.");
  }
  return context;
}

/** Bequemer Zugriff auf eine Berechtigungspruefung in der Oberflaeche. */
export function usePermission(permission: string): boolean {
  return useAuth().permissions.has(permission);
}
