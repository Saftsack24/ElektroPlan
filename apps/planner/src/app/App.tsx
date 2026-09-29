import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { Route, RouterProvider, Routes, createBrowserRouter } from "react-router-dom";
import type { RouteObject } from "react-router-dom";

import { AuthProvider, useAuth } from "../core/auth/AuthProvider";
import { EINLADUNG_PFAD, EinladungAnnehmenPage } from "../core/auth/EinladungAnnehmenPage";
import { LoginPage } from "../core/auth/LoginPage";
import { ProjectTabsProvider } from "../core/modules/ProjectTabs";
import { Navigationsschutz } from "../core/ui/Navigationsschutz";
import { RueckfrageProvider } from "../core/ui/Rueckfrage";
import { moduleRegistry } from "../modules";
import { Layout } from "./Layout";

function AuthenticatedApp() {
  const { activeModuleIds, permissions } = useAuth();
  const routes = useMemo(
    () => moduleRegistry.routes({ activeModuleIds, permissions }),
    [activeModuleIds, permissions],
  );
  // Die Projekt-Tabs der Fachmodule werden hier aus der Registry gelesen und
  // ueber den Core-Context verteilt. Ein Modul darf die Composition Root nicht
  // selbst importieren (docs/modules.md, Abschnitt 8).
  const projectTabs = useMemo(
    () => moduleRegistry.projectTabs({ activeModuleIds, permissions }),
    [activeModuleIds, permissions],
  );

  return (
    <ProjectTabsProvider tabs={projectTabs}>
      <Routes>
        <Route element={<Layout />}>
          {/* Auch die Startseite ("/") kommt aus der Registry: Sie gehört zur
              Plattform-Oberfläche, nicht zur Anwendungshülle. */}
          {routes.map((route) => {
            const Element = route.element;
            return <Route key={route.path} path={route.path} element={<Element />} />;
          })}
          <Route
            path="*"
            element={
              <p className="muted">
                Diese Seite gibt es nicht, oder Ihnen fehlt die Berechtigung dafür.
              </p>
            }
          />
        </Route>
      </Routes>
    </ProjectTabsProvider>
  );
}

function Gate() {
  const { status } = useAuth();

  if (status === "loading") {
    return <p className="muted centered">Sitzung wird geprüft ...</p>;
  }
  if (status === "anonymous") {
    return <LoginPage />;
  }
  return <AuthenticatedApp />;
}

/**
 * Wurzel unterhalb des Routers: Anmeldung, Navigationsschutz, Anwendung.
 *
 * Die eigentlichen Routen entstehen weiter **dynamisch** aus der Modul-
 * Registry (`AuthenticatedApp`, `<Routes>`), weil sie von Anmeldung, aktiven
 * Modulen und Berechtigungen abhängen. Der Data Router trägt dafür eine
 * einzige Splat-Route - er wird gebraucht, weil nur er Navigation (auch
 * Browser-Zurück und -Vorwärts) blockieren kann.
 */
export function Anwendung() {
  return (
    <AuthProvider>
      <RueckfrageProvider>
      <Navigationsschutz />
      {/* Die Annahme einer Einladung braucht keine Anmeldung - und landet
          auch bei einer bestehenden Sitzung im selben Browser nicht in deren
          Anwendung. Eine eigene Routenebene statt einer Pfadabfrage im Gate:
          So rendert eine Navigation nicht die ganze Anwendung neu. */}
      <Routes>
        <Route path={EINLADUNG_PFAD} element={<EinladungAnnehmenPage />} />
        <Route path="*" element={<Gate />} />
      </Routes>
      </RueckfrageProvider>
    </AuthProvider>
  );
}

export const ANWENDUNGSROUTEN: RouteObject[] = [{ path: "*", element: <Anwendung /> }];

/** Der Data Router der Anwendung - Typ für Browser- und Speicherrouter gleichermaßen. */
export type AnwendungsRouter = ReturnType<typeof createBrowserRouter>;

/**
 * Erzeugt den Browserrouter. **Genau einmal aufrufen** - in `main.tsx`, vor
 * `createRoot(...).render(...)`.
 *
 * `createBrowserRouter` registriert History- und Navigationslistener. Unter
 * `StrictMode` darf React State-Initializer und Renders im Entwicklungsmodus
 * mehrfach ausführen; ein dort erzeugter und wieder verworfener Router könnte
 * Listener zurücklassen. Deshalb entsteht der Router außerhalb jedes
 * Renderzyklus, und beim Import dieser Datei geschieht nichts.
 */
export function erzeugeRouter(): AnwendungsRouter {
  return createBrowserRouter(ANWENDUNGSROUTEN);
}

/**
 * Anwendungshülle. Den Router erhält sie von außen: Sie rendert ihn nur und
 * erzeugt nie einen eigenen - auch nicht bei erneutem Rendern.
 */
export function App({ router }: { router: AnwendungsRouter }) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
