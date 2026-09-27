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
export function AdminNavigation() {
  const { permissions } = useAuth();
  return (
    <nav className="unternav" aria-label="Administration">
      {BEREICHE.filter((bereich) => permissions.has(bereich.permission)).map((bereich) => (
        <NavLink key={bereich.to} to={bereich.to} className="unternav__link">
          {bereich.text}
        </NavLink>
      ))}
    </nav>
  );
}
