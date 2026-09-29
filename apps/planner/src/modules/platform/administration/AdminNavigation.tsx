import { NavLink } from "react-router-dom";

import { useAuth } from "../../../core/auth/AuthProvider";

const BEREICHE = [
  { to: "/administration/users", text: "Benutzer", permission: "user.account.read" },
  { to: "/administration/roles", text: "Rollen und Rechte", permission: "role.assignment.read" },
  { to: "/administration/system", text: "Systeminformationen", permission: "user.account.read" },
] as const;

/**
 * Unternavigation der Administration.
 *
 * Zeigt nur Bereiche, deren Leserecht vorhanden ist. Das ist Bedienkomfort:
 * Die Routen sind in der Registry selbst an die Berechtigung gebunden, und
 * der Server prüft jede Anfrage.
 */
/** Eintrag der Unternavigation; der aktive ist unterstrichen. */
function unternavigationslink({ isActive }: { isActive: boolean }): string {
  return `-mb-px border-b-2 px-3 py-1.5 no-underline ${
    isActive ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-fg"
  }`;
}

export function AdminNavigation() {
  const { permissions } = useAuth();
  return (
    <nav className="my-3 flex flex-wrap gap-1 border-b border-line" aria-label="Administration">
      {BEREICHE.filter((bereich) => permissions.has(bereich.permission)).map((bereich) => (
        <NavLink key={bereich.to} to={bereich.to} className={unternavigationslink}>
          {bereich.text}
        </NavLink>
      ))}
    </nav>
  );
}
