import { Suspense, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../core/auth/AuthProvider";
import { EinstellungenDialog } from "../core/ui/EinstellungenDialog";
import { useVerlassenBestaetigen } from "../core/ui/Rueckfrage";
import { knopf } from "../core/ui/stil";
import { moduleRegistry } from "../modules";
import { AKTION } from "../core/ui/aktionssymbole";
import { MitSymbol } from "../core/ui/Symbol";

/** Eintrag der Hauptnavigation; der aktive ist hervorgehoben. */
function navigationslink({ isActive }: { isActive: boolean }): string {
  return `rounded-ep px-2.5 py-1.5 no-underline hover:bg-page ${
    isActive ? "font-semibold text-accent" : "text-muted hover:text-fg"
  }`;
}

export function Layout() {
  const { me, logout, activeModuleIds, permissions } = useAuth();
  const navigation = moduleRegistry.navigation({ activeModuleIds, permissions });
  const verlassen = useVerlassenBestaetigen();
  const [einstellungen, setEinstellungen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-6 border-b border-line bg-nav px-5 py-3 max-sm:gap-3">
        <span className="text-[1.05rem] font-semibold">ElektroPlan</span>
        <nav className="flex flex-1 flex-wrap gap-3">
          <NavLink to="/" end className={navigationslink}>
            Übersicht
          </NavLink>
          {navigation.map((item) => (
            <NavLink key={item.id} to={item.to} className={navigationslink}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        {/* Bricht auf schmalen Flächen um, statt die Seite zu verbreitern. */}
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 font-semibold wrap-anywhere">{me?.organization.name}</span>
          <span className="min-w-0 text-label text-muted wrap-anywhere">{me?.email}</span>
          <button className={knopf()} type="button" onClick={() => setEinstellungen(true)}>
            <MitSymbol icon={AKTION.einstellungen}>Einstellungen</MitSymbol>
          </button>
          <button
            className={knopf()}
            type="button"
            onClick={() => {
              void verlassen("Abmelden?", "Sie wollen sich abmelden.", () => void logout());
            }}
          >
            Abmelden
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] min-w-0 px-5 py-6">
        <Suspense fallback={<p className="text-muted">Wird geladen ...</p>}>
          <Outlet />
        </Suspense>
      </main>

      <EinstellungenDialog offen={einstellungen} onClose={() => setEinstellungen(false)} />
    </div>
  );
}
