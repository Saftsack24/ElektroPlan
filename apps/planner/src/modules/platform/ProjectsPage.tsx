import type { ProjectSummary } from "@elektroplan/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useCursorListe } from "../../core/api/useCursorListe";
import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { WeitereLaden } from "../../core/ui/WeitereLaden";
import { zuordenbareKunden } from "./auswahl";
import { alsFormularfehler } from "./fehler";
import type { Suchergebnis } from "./KundenAuswahl";
import { ProjectFormDialog } from "./ProjectFormDialog";
import type { ProjektWerte } from "./ProjectFormDialog";
import { START_EBENE, START_HOEHE_MM, startstrukturAnlegen } from "./startstruktur";
import { STATUS_LABEL } from "./status";
import type { ProjectStatus } from "./status";

const SEITENGROESSE = 25;
/** Treffer je Suchanfrage im Anlagedialog - bewusst klein und sichtbar. */
const TREFFER_PRO_SEITE = 20;

const PROJEKTFELDER = [
  "customer_id",
  "name",
  "site_street",
  "site_postal_code",
  "site_city",
] as const;

export default function ProjectsPage() {
  const { api } = useAuth();
  const darfSchreiben = usePermission("project.record.write");
  const darfKundenLesen = usePermission("customer.record.read");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [suche, setSuche] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "">("");
  const [dialogOffen, setDialogOffen] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [hinweisVollstaendig, setHinweisVollstaendig] = useState(true);

  // Suchbegriff und Status stehen im Query-Key: Jede Aenderung erzeugt eine
  // neue Abfrage, der Cursor beginnt damit von vorn.
  const liste = useCursorListe({
    schluessel: ["projects", "liste", suche, status],
    laden: (cursor) =>
      api.get("/api/v1/projects", {
        query: {
          limit: SEITENGROESSE,
          ...(suche ? { q: suche } : {}),
          ...(status ? { status } : {}),
          ...(cursor ? { cursor } : {}),
        },
      }),
  });

  const projekte = liste.eintraege;

  /**
   * Serverseitige Kundensuche fuer den Anlagedialog.
   *
   * Vorher lud die Seite pauschal die ersten 200 Kunden. Ab dem 201. waere
   * der gesuchte nicht dabei gewesen, ohne Hinweis. Jetzt sucht der Server,
   * es werden nur die Treffer geladen, und ``weitere`` sagt der Oberflaeche,
   * wann sie zum Eingrenzen auffordern muss.
   *
   * Anonymisierte Kunden bleiben sichtbar, sind aber fuer neue Zuordnungen
   * gesperrt (``404``) - sie werden hier herausgefiltert.
   */
  const kundenSuchen = async (begriff: string): Promise<Suchergebnis> => {
    const seite = await api.get("/api/v1/customers", {
      query: {
        sort: "name",
        limit: TREFFER_PRO_SEITE,
        ...(begriff.trim() ? { q: begriff.trim() } : {}),
      },
    });
    return { treffer: zuordenbareKunden(seite.items), weitere: seite.has_more };
  };

  /**
   * Projekt anlegen und - falls gewuenscht - die Startstruktur nachziehen.
   *
   * Bewusst als **Folgeablauf** und nicht atomar: Eine atomare Anlage haette
   * einen neuen, geschachtelten Endpunkt gebraucht. Das waere eine
   * API-Aenderung fuer eine reine Bedienerleichterung - siehe docs/api.md,
   * Abschnitt "Startstruktur bei der Projektanlage".
   *
   * Ein Teilfehler bleibt nicht unbemerkt: Das Projekt ist dann angelegt, die
   * Meldung benennt genau, was fehlt, und die Oberflaeche **bleibt auf der
   * Liste** stehen. Wuerde sie ins Projekt springen, verschwaende die Warnung
   * mit dem Seitenwechsel.
   */
  const anlegen = async (werte: ProjektWerte) => {
    let projektId: string;
    let projektnummer: string;
    try {
      const projekt = await api.post("/api/v1/projects", {
        body: {
          customer_id: werte.customer_id,
          name: werte.name.trim(),
          site_country_code: "DE",
          ...(werte.site_street.trim() ? { site_street: werte.site_street.trim() } : {}),
          ...(werte.site_postal_code.trim()
            ? { site_postal_code: werte.site_postal_code.trim() }
            : {}),
          ...(werte.site_city.trim() ? { site_city: werte.site_city.trim() } : {}),
        },
      });
      projektId = projekt.id;
      projektnummer = projekt.project_number;
    } catch (error) {
      return alsFormularfehler(error, PROJEKTFELDER);
    }

    let meldung = `Projekt ${projektnummer} wurde angelegt.`;
    let vollstaendig = true;
    if (werte.startstruktur) {
      const struktur = await startstrukturAnlegen({
        gebaeudename: werte.gebaeudename.trim(),
        geschossname: werte.geschossname.trim(),
        gebaeudeAnlegen: () =>
          api.post("/api/v1/projects/{project_id}/buildings", {
            path: { project_id: projektId },
            body: { name: werte.gebaeudename.trim(), sort_order: 0 },
          }),
        geschossAnlegen: (gebaeudeId) =>
          api.post("/api/v1/buildings/{building_id}/floors", {
            path: { building_id: gebaeudeId },
            body: {
              name: werte.geschossname.trim(),
              level: START_EBENE,
              elevation_mm: 0,
              default_ceiling_height_mm: START_HOEHE_MM,
            },
          }),
      });
      meldung += ` ${struktur.meldung}`;
      vollstaendig = struktur.vollstaendig;
    }

    setDialogOffen(false);
    setHinweis(meldung);
    setHinweisVollstaendig(vollstaendig);
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    // Nur bei vollstaendigem Erfolg ins Projekt springen. Blieb etwas offen,
    // wuerde die Warnung beim Seitenwechsel verschwinden - der Teilfehler
    // waere damit unbemerkt, genau das soll er nicht sein.
    if (vollstaendig) {
      void navigate(`/projects/${projektId}`);
    }
    return undefined;
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card__header">
          <h1>Projekte</h1>
          {darfSchreiben && darfKundenLesen && (
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                setHinweis(null);
                setDialogOffen(true);
              }}
            >
              Neues Projekt
            </button>
          )}
        </div>

        {hinweis !== null && (
          <p className={hinweisVollstaendig ? "alert alert--erfolg" : "alert alert--error"} role="status">
            {hinweis}
          </p>
        )}

        <div className="filter-row">
          <div className="field">
            <label className="field__label" htmlFor="projektsuche">
              Suche (Name, Nummer, Ort, Kunde)
            </label>
            <input
              id="projektsuche"
              className="field__input"
              value={suche}
              placeholder="z. B. Neubau"
              onChange={(event) => {
                setSuche(event.target.value);
                setHinweis(null);
              }}
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
              onChange={(event) => {
                setStatus(event.target.value as ProjectStatus | "");
                setHinweis(null);
              }}
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

        {liste.laedt && <p className="muted">Projekte werden geladen ...</p>}
        {liste.fehlgeschlagen && (
          <p className="alert alert--error" role="alert">
            Die Projektliste konnte nicht geladen werden.{" "}
            <button
              className="button button--ghost"
              type="button"
              onClick={liste.erneutVersuchen}
            >
              Erneut versuchen
            </button>
          </p>
        )}
        {liste.geladen && <Projekttabelle projekte={projekte} />}
        {liste.geladen && (
          <WeitereLaden
            sichtbar={liste.hatWeitere}
            laedt={liste.laedtWeitere}
            anzahl={projekte.length}
            onLaden={liste.weitereLaden}
          />
        )}
      </section>

      {darfSchreiben && (
        <ProjectFormDialog
          offen={dialogOffen}
          suchen={kundenSuchen}
          onSubmit={anlegen}
          onClose={() => setDialogOffen(false)}
        />
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
