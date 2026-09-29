import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../core/auth/AuthProvider";
import { STAPEL, TABELLE, TABELLENRAHMEN, karte, meldungsflaeche } from "../../../core/ui/stil";
import { AdminNavigation } from "./AdminNavigation";

const ART: Record<string, string> = {
  core: "Plattform",
  shared: "Gemeinsames Modul",
  domain: "Fachmodul",
};

/**
 * Administration → Systeminformationen.
 *
 * Geladene Module und ihre Versionen - für Support und Wartung. Früher
 * standen sie auf der Startseite; dort haben sie für die tägliche Arbeit
 * keine Bedeutung.
 */
export default function SystemPage() {
  const { api } = useAuth();
  const module = useQuery({ queryKey: ["modules"], queryFn: () => api.get("/api/v1/modules") });

  return (
    <div className={STAPEL}>
      <section className={karte()}>
        <p className="m-0 text-[0.8rem] tracking-[0.04em] text-muted uppercase">Administration</p>
        <h1>Systeminformationen</h1>
        <AdminNavigation />
        <p className="text-muted">Technische Angaben für Support und Wartung.</p>
        {module.isPending && <p className="text-muted">Wird geladen ...</p>}
        {module.isError && (
          <p className={meldungsflaeche()} role="alert">
            Die Systeminformationen konnten nicht geladen werden.
          </p>
        )}
        {module.isSuccess && (
          <div className={TABELLENRAHMEN}>
            <table className={TABELLE}>
              <caption className="sr-only">Geladene Module</caption>
              <thead>
                <tr>
                  <th scope="col">Modul</th>
                  <th scope="col">Kennung</th>
                  <th scope="col">Art</th>
                  <th scope="col">Version</th>
                </tr>
              </thead>
              <tbody>
                {module.data.map((modul) => (
                  <tr key={modul.id}>
                    <td>{modul.name}</td>
                    <td>
                      <code>{modul.id}</code>
                    </td>
                    <td>{ART[modul.kind] ?? modul.kind}</td>
                    <td>{modul.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
