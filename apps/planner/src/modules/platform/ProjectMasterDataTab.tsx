import { ApiError } from "@elektroplan/api-client";
import type { ProjectOut } from "@elektroplan/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { Feld } from "../../core/ui/Feld";

type Bearbeitbar = {
  name: string;
  site_street: string;
  site_postal_code: string;
  site_city: string;
};

function ausProjekt(projekt: ProjectOut): Bearbeitbar {
  return {
    name: projekt.name,
    site_street: projekt.site_street ?? "",
    site_postal_code: projekt.site_postal_code ?? "",
    site_city: projekt.site_city ?? "",
  };
}

export function ProjectMasterDataTab({ projekt }: { projekt: ProjectOut }) {
  const { api } = useAuth();
  const darfSchreiben = usePermission("project.record.write");
  const queryClient = useQueryClient();

  const [entwurf, setEntwurf] = useState<Bearbeitbar | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  // Ein archiviertes Projekt ist schreibgeschützt; der Server lehnt ab (409).
  const gesperrt = !darfSchreiben || projekt.status === "archived";

  const speichern = useMutation({
    mutationFn: (werte: Bearbeitbar) =>
      api.patch("/api/v1/projects/{project_id}", {
        path: { project_id: projekt.id },
        body: {
          name: werte.name.trim(),
          site_street: werte.site_street.trim() || null,
          site_postal_code: werte.site_postal_code.trim() || null,
          site_city: werte.site_city.trim() || null,
        },
        ifMatch: projekt.version,
      }),
    onSuccess: async () => {
      setEntwurf(null);
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["project", projekt.id] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Speichern fehlgeschlagen."),
  });

  const werte = entwurf ?? ausProjekt(projekt);

  return (
    <section className="card">
      <h2>Stammdaten</h2>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          speichern.mutate(werte);
        }}
      >
        <Feld
          id="projekt-detail-name"
          label="Bezeichnung"
          value={werte.name}
          required
          onChange={(name) => setEntwurf({ ...werte, name })}
        />
        <Feld
          id="projekt-detail-street"
          label="Baustelle: Straße"
          value={werte.site_street}
          onChange={(site_street) => setEntwurf({ ...werte, site_street })}
        />
        <Feld
          id="projekt-detail-plz"
          label="Baustelle: PLZ"
          value={werte.site_postal_code}
          onChange={(site_postal_code) => setEntwurf({ ...werte, site_postal_code })}
        />
        <Feld
          id="projekt-detail-ort"
          label="Baustelle: Ort"
          value={werte.site_city}
          onChange={(site_city) => setEntwurf({ ...werte, site_city })}
        />
        <div className="form-grid__actions">
          {fehler && <p className="alert alert--error">{fehler}</p>}
          <button
            className="button button--primary"
            type="submit"
            disabled={gesperrt || speichern.isPending || entwurf === null}
          >
            {speichern.isPending ? "Wird gespeichert ..." : "Speichern"}
          </button>
        </div>
      </form>
    </section>
  );
}
