import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../core/auth/AuthProvider";

export default function AuditListPage() {
  const { api } = useAuth();
  // Rueckgabetyp stammt aus dem generierten OpenAPI-Schema - keine
  // handgeschriebene Struktur mehr (ADR 0009).
  const { data, isPending, isError } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api.get("/api/v1/audit", { query: { limit: 50 } }),
  });

  if (isPending) return <p className="muted">Protokoll wird geladen ...</p>;
  if (isError) {
    return <p className="alert alert--error">Das Protokoll konnte nicht geladen werden.</p>;
  }

  return (
    <section className="card">
      <h1>Protokoll</h1>
      <p className="muted">Kritische Aktionen dieses Betriebs. Einträge sind unveränderlich.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Zeitpunkt</th>
            <th>Aktion</th>
            <th>Objekt</th>
            <th>Beschreibung</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((entry) => (
            <tr key={entry.id}>
              <td>{new Date(entry.created_at).toLocaleString("de-DE")}</td>
              <td>
                <code>{entry.action}</code>
              </td>
              <td>{entry.entity_type}</td>
              <td>{entry.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.items.length === 0 && <p className="muted">Noch keine Einträge.</p>}
    </section>
  );
}
