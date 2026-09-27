import type { PermissionInfo, SystemRoleOut } from "@elektroplan/api-client";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../core/auth/AuthProvider";
import { AdminNavigation } from "./AdminNavigation";

/**
 * Administration → Rollen und Rechte.
 *
 * Nur lesend: Die festen Systemrollen und die zentrale Liste der
 * Berechtigungen kommen aus dem Programm. Ein freier Rolleneditor ist
 * ausdrücklich nicht Teil dieser Phase.
 */
export default function RollenPage() {
  const { api } = useAuth();
  const rollen = useQuery({ queryKey: ["roles"], queryFn: () => api.get("/api/v1/roles") });

  return (
    <div className="stack">
      <section className="card">
        <p className="bereich">Administration</p>
        <h1>Rollen und Rechte</h1>
        <AdminNavigation />
        <p className="muted">
          Jede Person erhält eine oder mehrere feste Rollen. Die Rollen und ihre Berechtigungen sind
          vorgegeben und hier nicht änderbar.
        </p>
      </section>
      {rollen.isPending && <p className="muted">Rollen werden geladen ...</p>}
      {rollen.isError && (
        <p className="alert alert--error" role="alert">
          Die Rollen konnten nicht geladen werden.
        </p>
      )}
      {rollen.isSuccess && (
        <div className="rollenkarten">
          {rollen.data.map((rolle) => (
            <Rollenkarte key={rolle.key} rolle={rolle} />
          ))}
        </div>
      )}
    </div>
  );
}

function Rollenkarte({ rolle }: { rolle: SystemRoleOut }) {
  const bereiche = new Map<string, PermissionInfo[]>();
  for (const recht of rolle.permissions) {
    bereiche.set(recht.area, [...(bereiche.get(recht.area) ?? []), recht]);
  }
  return (
    <section className="card" aria-labelledby={`rolle-${rolle.key}`}>
      <h2 id={`rolle-${rolle.key}`}>{rolle.name}</h2>
      <p>{rolle.description}</p>
      <details>
        <summary className="details__titel">{rolle.permissions.length} Berechtigungen</summary>
        <div className="rechte">
          {[...bereiche.entries()].map(([bereich, rechte]) => (
            <section key={bereich} className="rechte__bereich" aria-label={bereich}>
              <h3>{bereich}</h3>
              <ul className="rechte__liste">
                {rechte.map((recht) => (
                  <li key={recht.key}>
                    <span>{recht.description || recht.key}</span>
                    <code className="rechte__schluessel">{recht.key}</code>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </details>
    </section>
  );
}
