import { ApiError, createApiClient } from "@elektroplan/api-client";
import type { ApiClient, MeResponse, TokenResponse } from "@elektroplan/api-client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { config } from "../config";
import { einstellungenAnmelden, einstellungenLaden } from "../einstellungen/persoenlich";

interface AuthState {
  status: "loading" | "anonymous" | "authenticated";
  me: MeResponse | null;
  activeModuleIds: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
}

interface AuthContextValue extends AuthState {
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

const ANONYMOUS: AuthState = {
  status: "anonymous",
  me: null,
  activeModuleIds: EMPTY_SET,
  permissions: EMPTY_SET,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  // Der Access Token lebt nur im Speicher. Der Refresh Token steht im
  // HttpOnly-Cookie und ist fuer JavaScript nicht lesbar - er taucht auch
  // nicht mehr im Antwortkoerper auf (docs/security.md, Abschnitt 3).
  const accessToken = useRef<string | null>(null);
  // Single-Flight: Waehrend einer laufenden Erneuerung warten alle weiteren
  // Anfragen auf dasselbe Promise. Sonst wuerden mehrere parallele 401er
  // mehrere Rotationen ausloesen und die Wiederverwendungserkennung treffen.
  const pendingRenewal = useRef<Promise<boolean> | null>(null);
  const [state, setState] = useState<AuthState>({ ...ANONYMOUS, status: "loading" });

  const renewSession = useCallback((): Promise<boolean> => {
    if (pendingRenewal.current !== null) {
      return pendingRenewal.current;
    }

    const run = (async (): Promise<boolean> => {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/v1/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          return false;
        }
        const tokens = (await response.json()) as TokenResponse;
        accessToken.current = tokens.access_token;
        return true;
      } catch {
        return false;
      }
    })();

    pendingRenewal.current = run;
    void run.finally(() => {
      pendingRenewal.current = null;
    });
    return run;
  }, []);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiBaseUrl,
        getAccessToken: () => accessToken.current,
        onUnauthorized: async () => {
          const renewed = await renewSession();
          if (!renewed) {
            accessToken.current = null;
            setState(ANONYMOUS);
          }
          return renewed;
        },
      }),
    [renewSession],
  );

  const loadSession = useCallback(async () => {
    try {
      const me = await api.get("/api/v1/me");
      const modules = await api.get("/api/v1/me/modules");
      setState({
        status: "authenticated",
        me,
        activeModuleIds: new Set(modules.map((module) => module.id)),
        permissions: new Set(me.permissions),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) {
        console.error("Sitzung konnte nicht geladen werden", error.errorType);
      }
      accessToken.current = null;
      setState(ANONYMOUS);
    }
  }, [api]);

  const aktualisieren = useCallback(async () => {
    try {
      const me = await api.get("/api/v1/me");
      const modules = await api.get("/api/v1/me/modules");
      setState({
        status: "authenticated",
        me,
        activeModuleIds: new Set(modules.map((module) => module.id)),
        permissions: new Set(me.permissions),
      });
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
    void (async () => {
      await renewSession();
      await loadSession();
    })();
  }, [renewSession, loadSession]);

  const login = useCallback(
    async (email: string, password: string, organizationId?: string) => {
      const tokens = await api.post("/api/v1/auth/login", {
        body: organizationId
          ? { email, password, organization_id: organizationId }
          : { email, password },
      });
      accessToken.current = tokens.access_token;
      await loadSession();
    },
    [api, loadSession],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/api/v1/auth/logout");
    } finally {
      accessToken.current = null;
      setState(ANONYMOUS);
    }
  }, [api]);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      const tokens = await api.post("/api/v1/auth/switch-organization", {
        body: { organization_id: organizationId },
      });
      accessToken.current = tokens.access_token;
      await loadSession();
    },
    [api, loadSession],
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
    () => ({ ...state, api, login, logout, switchOrganization, aktualisieren }),
    [state, api, login, logout, switchOrganization, aktualisieren],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
