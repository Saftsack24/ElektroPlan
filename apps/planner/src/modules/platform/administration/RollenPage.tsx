import type { PermissionInfo, SystemRoleOut } from "@elektroplan/api-client";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../core/auth/AuthProvider";
import { STAPEL, karte, meldungsflaeche } from "../../../core/ui/stil";
import { AdminNavigation } from "./AdminNavigation";
import { RECHTE_BEREICH_TITEL, RECHTE_LISTE, RECHTE_RASTER, RECHTE_SCHLUESSEL } from "./rechtedarstellung";

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
    <div className={STAPEL}>
      <section className={karte()}>
        <p className="m-0 text-[0.8rem] tracking-[0.04em] text-muted uppercase">Administration</p>
        <h1>Rollen und Rechte</h1>
        <AdminNavigation />
        <p className="text-muted">
          Jede Person erhält eine oder mehrere feste Rollen. Die Rollen und ihre Berechtigungen sind
          vorgegeben und hier nicht änderbar.
        </p>
      </section>
      {rollen.isPending && <p className="text-muted">Rollen werden geladen ...</p>}
      {rollen.isError && (
        <p className={meldungsflaeche()} role="alert">
          Die Rollen konnten nicht geladen werden.
        </p>
      )}
      {rollen.isSuccess && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
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
    <section className={karte()} aria-labelledby={`rolle-${rolle.key}`}>
      <h2 id={`rolle-${rolle.key}`} className="mt-0">
        {rolle.name}
      </h2>
      <p>{rolle.description}</p>
      <details>
        <summary className="cursor-pointer font-semibold">{rolle.permissions.length} Berechtigungen</summary>
        <div className={RECHTE_RASTER}>
          {[...bereiche.entries()].map(([bereich, rechte]) => (
            <section key={bereich} aria-label={bereich}>
              <h3 className={RECHTE_BEREICH_TITEL}>{bereich}</h3>
              <ul className={RECHTE_LISTE}>
                {rechte.map((recht) => (
                  <li key={recht.key}>
                    <span>{recht.description || recht.key}</span>
                    <code className={RECHTE_SCHLUESSEL}>{recht.key}</code>
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
