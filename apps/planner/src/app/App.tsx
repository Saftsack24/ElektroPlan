import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider, useAuth } from "../core/auth/AuthProvider";
import { LoginPage } from "../core/auth/LoginPage";
import { moduleRegistry } from "../modules";
import { DashboardPage } from "./DashboardPage";
import { Layout } from "./Layout";

function AuthenticatedApp() {
  const { activeModuleIds, permissions } = useAuth();
  const routes = useMemo(
    () => moduleRegistry.routes({ activeModuleIds, permissions }),
    [activeModuleIds, permissions],
  );

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        {routes.map((route) => {
          const Element = route.element;
          return <Route key={route.path} path={route.path} element={<Element />} />;
        })}
        <Route path="*" element={<p className="muted">Diese Seite gibt es nicht.</p>} />
      </Route>
    </Routes>
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

export function App() {
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
      <BrowserRouter>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
