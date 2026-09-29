import { Suspense, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../core/auth/AuthProvider";
import { EinstellungenDialog } from "../core/ui/EinstellungenDialog";
import { useVerlassenBestaetigen } from "../core/ui/Rueckfrage";
import { moduleRegistry } from "../modules";

export function Layout() {
  const { me, logout, activeModuleIds, permissions } = useAuth();
  const navigation = moduleRegistry.navigation({ activeModuleIds, permissions });
  const verlassen = useVerlassenBestaetigen();
  const [einstellungen, setEinstellungen] = useState(false);

  return (
    <div className="shell">
      <header className="shell__header">
        <span className="shell__brand">ElektroPlan</span>
        <nav className="shell__nav">
          <NavLink to="/" end className="shell__link">
            Übersicht
          </NavLink>
          {navigation.map((item) => (
            <NavLink key={item.id} to={item.to} className="shell__link">
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="shell__user">
          <span className="shell__org">{me?.organization.name}</span>
          <span className="shell__email">{me?.email}</span>
          <button className="button button--ghost" type="button" onClick={() => setEinstellungen(true)}>
            Einstellungen
          </button>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => {
              void verlassen("Abmelden?", "Sie wollen sich abmelden.", () => void logout());
            }}
          >
            Abmelden
          </button>
        </div>
      </header>

      <main className="shell__main">
        <Suspense fallback={<p className="muted">Wird geladen ...</p>}>
          <Outlet />
        </Suspense>
      </main>

      <EinstellungenDialog offen={einstellungen} onClose={() => setEinstellungen(false)} />
    </div>
  );
}
