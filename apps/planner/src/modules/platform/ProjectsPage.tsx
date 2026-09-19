import { ApiError } from "@elektroplan/api-client";
import type { ProjectSummary } from "@elektroplan/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { Feld } from "./CustomersPage";

type Status = "draft" | "active" | "completed" | "archived";

export const STATUS_LABEL: Record<Status, string> = {
  draft: "Entwurf",
  active: "In Bearbeitung",
  completed: "Abgeschlossen",
  archived: "Archiviert",
};

const LEERES_FORMULAR = {
  customer_id: "",
  name: "",
  site_street: "",
  site_postal_code: "",
  site_city: "",
};

export default function ProjectsPage() {
  const { api } = useAuth();
  const darfSchreiben = usePermission("project.record.write");
  const darfKundenLesen = usePermission("customer.record.read");
  const queryClient = useQueryClient();

  const [suche, setSuche] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const [formular, setFormular] = useState(LEERES_FORMULAR);
  const [fehler, setFehler] = useState<string | null>(null);

  const liste = useQuery({
    queryKey: ["projects", suche, status],
    queryFn: () =>
      api.get("/api/v1/projects", {
        query: {
          limit: 50,
          ...(suche ? { q: suche } : {}),
          ...(status ? { status } : {}),
        },
      }),
  });

  const kunden = useQuery({
    queryKey: ["customers", "auswahl"],
    queryFn: () => api.get("/api/v1/customers", { query: { sort: "name", limit: 200 } }),
    enabled: darfSchreiben && darfKundenLesen,
  });

  const anlegen = useMutation({
    mutationFn: (eingabe: typeof LEERES_FORMULAR) => {
      const { customer_id, name, site_street, site_postal_code, site_city } = eingabe;
      return api.post("/api/v1/projects", {
        body: {
          customer_id,
          name: name.trim(),
          // Standardwert des Servers, im erzeugten Schema aber Pflichtfeld.
          site_country_code: "DE",
          ...(site_street.trim() ? { site_street: site_street.trim() } : {}),
          ...(site_postal_code.trim() ? { site_postal_code: site_postal_code.trim() } : {}),
          ...(site_city.trim() ? { site_city: site_city.trim() } : {}),
        },
      });
    },
    onSuccess: async () => {
      setFormular(LEERES_FORMULAR);
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Anlegen fehlgeschlagen."),
  });

  return (
    <div className="stack">
      <section className="card">
        <h1>Projekte</h1>
        <div className="filter-row">
          <div className="field">
            <label className="field__label" htmlFor="projektsuche">
              Suche (Name, Nummer, Ort, Kunde)
            </label>
            <input
              id="projektsuche"
              className="field__input"
              value={suche}
              onChange={(event) => setSuche(event.target.value)}
              placeholder="z. B. Neubau"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="projektstatus">
              Status
            </label>
            <select
              id="projektstatus"
              className="field__input"
              value={status}
              onChange={(event) => setStatus(event.target.value as Status | "")}
            >
              <option value="">Alle</option>
              {Object.entries(STATUS_LABEL).map(([wert, label]) => (
                <option key={wert} value={wert}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {liste.isPending && <p className="muted">Projekte werden geladen ...</p>}
        {liste.isError && (
          <p className="alert alert--error">Die Projektliste konnte nicht geladen werden.</p>
        )}
        {liste.data && <Projekttabelle projekte={liste.data.items} />}
        {liste.data?.has_more && (
          <p className="muted">
            Es gibt weitere Projekte. Bitte die Suche eingrenzen — die vollständige
            Blätterfunktion folgt mit der Listenansicht in einer späteren Phase.
          </p>
        )}
      </section>

      {darfSchreiben && (
        <section className="card">
          <h2>Neues Projekt anlegen</h2>
          <p className="muted">Die Projektnummer vergibt das System.</p>
          {kunden.data?.items.length === 0 && (
            <p className="alert alert--error">
              Es gibt noch keinen Kunden. Ein Projekt braucht einen Auftraggeber — bitte
              zuerst unter <Link to="/customers">Kunden</Link> einen anlegen.
            </p>
          )}
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              anlegen.mutate(formular);
            }}
          >
            <div className="field">
              <label className="field__label" htmlFor="projekt-kunde">
                Kunde *
              </label>
              <select
                id="projekt-kunde"
                className="field__input"
                value={formular.customer_id}
                required
                onChange={(event) =>
                  setFormular({ ...formular, customer_id: event.target.value })
                }
              >
                <option value="">Bitte wählen</option>
                {(kunden.data?.items ?? []).map((kunde) => (
                  <option key={kunde.id} value={kunde.id}>
                    {kunde.customer_number} — {kunde.name}
                  </option>
                ))}
              </select>
            </div>
            <Feld
              id="projekt-name"
              label="Bezeichnung"
              value={formular.name}
              required
              onChange={(name) => setFormular({ ...formular, name })}
            />
            <Feld
              id="projekt-street"
              label="Baustelle: Straße"
              value={formular.site_street}
              onChange={(site_street) => setFormular({ ...formular, site_street })}
            />
            <Feld
              id="projekt-plz"
              label="Baustelle: PLZ"
              value={formular.site_postal_code}
              onChange={(site_postal_code) => setFormular({ ...formular, site_postal_code })}
            />
            <Feld
              id="projekt-ort"
              label="Baustelle: Ort"
              value={formular.site_city}
              onChange={(site_city) => setFormular({ ...formular, site_city })}
            />
            <div className="form-grid__actions">
              {fehler && <p className="alert alert--error">{fehler}</p>}
              <button
                className="button button--primary"
                type="submit"
                disabled={
                  anlegen.isPending ||
                  formular.customer_id === "" ||
                  formular.name.trim().length === 0
                }
              >
                {anlegen.isPending ? "Wird angelegt ..." : "Projekt anlegen"}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

function Projekttabelle({ projekte }: { projekte: ProjectSummary[] }) {
  if (projekte.length === 0) {
    return <p className="muted">Keine Projekte gefunden.</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Nummer</th>
          <th>Bezeichnung</th>
          <th>Kunde</th>
          <th>Ort</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {projekte.map((projekt) => (
          <tr key={projekt.id}>
            <td>
              <code>{projekt.project_number}</code>
            </td>
            <td>
              <Link to={`/projects/${projekt.id}`}>{projekt.name}</Link>
            </td>
            <td>{projekt.customer_name}</td>
            <td>{projekt.site_city ?? "—"}</td>
            <td>{STATUS_LABEL[projekt.status]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
