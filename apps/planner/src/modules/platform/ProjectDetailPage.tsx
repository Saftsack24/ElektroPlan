import { ApiError } from "@elektroplan/api-client";
import type { ProjectOut } from "@elektroplan/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { useProjectTabs } from "../../core/modules/ProjectTabs";
import { ProjectFilesTab } from "./ProjectFilesTab";
import { ProjectMasterDataTab } from "./ProjectMasterDataTab";
import { ProjectStructureTab } from "./ProjectStructureTab";
import { STATUS_LABEL, istSchreibgeschuetzt } from "./status";

/** Zustandswechsel sind eigene Endpunkte (docs/api.md, Abschnitt 5). */
const UEBERGAENGE = [
  { ziel: "activate", label: "In Bearbeitung nehmen", erlaubtAb: "draft" },
  { ziel: "complete", label: "Abschließen", erlaubtAb: "active" },
  { ziel: "archive", label: "Archivieren", erlaubtAb: null },
] as const;

const EIGENE_TABS = [
  { id: "stammdaten", label: "Stammdaten" },
  { id: "struktur", label: "Gebäude & Geschosse" },
  { id: "dateien", label: "Dateien" },
] as const;

export default function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  const { api } = useAuth();
  const darfSchreiben = usePermission("project.record.write");
  const queryClient = useQueryClient();
  // Beitraege der Fachmodule - ab Phase 3 erscheint hier die Elektroplanung.
  const modulTabs = useProjectTabs();

  const [aktiv, setAktiv] = useState<string>(EIGENE_TABS[0].id);
  const [fehler, setFehler] = useState<string | null>(null);

  const projekt = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get("/api/v1/projects/{project_id}", { path: { project_id: projectId } }),
  });

  const wechseln = useMutation({
    mutationFn: ({ ziel, version }: { ziel: string; version: number }) => {
      const pfad = {
        activate: "/api/v1/projects/{project_id}/activate",
        complete: "/api/v1/projects/{project_id}/complete",
        archive: "/api/v1/projects/{project_id}/archive",
      }[ziel] as "/api/v1/projects/{project_id}/activate";
      return api.post(pfad, { path: { project_id: projectId }, ifMatch: version });
    },
    onSuccess: async () => {
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Statuswechsel fehlgeschlagen."),
  });

  if (projekt.isPending) return <p className="muted">Projekt wird geladen ...</p>;
  if (projekt.isError || !projekt.data) {
    return <p className="alert alert--error">Dieses Projekt ist nicht verfügbar.</p>;
  }

  const daten: ProjectOut = projekt.data;
  // ``archived`` ist ein Endzustand **und** ein Schreibschutz; der Server
  // lehnt jede Aenderung mit 409 ab (docs/api.md, Abschnitt "Projektstatus").
  // Die Oberflaeche spiegelt das, verspricht aber nichts darueber hinaus.
  const schreibgeschuetzt = istSchreibgeschuetzt(daten.status);

  return (
    <div className="stack">
      <section className="card">
        <p className="muted">
          <Link to="/projects">← Alle Projekte</Link>
        </p>
        <h1>{daten.name}</h1>
        <p className="muted">
          Projektnummer <code>{daten.project_number}</code> · Status{" "}
          <strong>{STATUS_LABEL[daten.status]}</strong> · Version {daten.version}
        </p>
        {schreibgeschuetzt && (
          <p className="alert">
            Dieses Projekt ist archiviert und damit <strong>schreibgeschützt</strong>.
            Stammdaten, Gebäude, Geschosse und Dateien lassen sich nicht mehr ändern, und
            es sind keine neuen Uploads möglich. Lesen und das Herunterladen bestehender
            Dateien bleiben erlaubt.
          </p>
        )}
        {fehler && <p className="alert alert--error">{fehler}</p>}
        {darfSchreiben && (
          <div className="button-row">
            {UEBERGAENGE.filter(
              (uebergang) =>
                (uebergang.erlaubtAb === null
                  ? daten.status !== "archived"
                  : daten.status === uebergang.erlaubtAb),
            ).map((uebergang) => (
              <button
                key={uebergang.ziel}
                className="button button--ghost"
                type="button"
                disabled={wechseln.isPending}
                onClick={() => wechseln.mutate({ ziel: uebergang.ziel, version: daten.version })}
              >
                {uebergang.label}
              </button>
            ))}
          </div>
        )}
      </section>

      <nav className="tabs">
        {EIGENE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={aktiv === tab.id ? "tabs__tab tabs__tab--active" : "tabs__tab"}
            onClick={() => setAktiv(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        {modulTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={aktiv === tab.id ? "tabs__tab tabs__tab--active" : "tabs__tab"}
            onClick={() => setAktiv(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {aktiv === "stammdaten" && <ProjectMasterDataTab projekt={daten} />}
      {aktiv === "struktur" && (
        <ProjectStructureTab projectId={daten.id} schreibgeschuetzt={schreibgeschuetzt} />
      )}
      {aktiv === "dateien" && (
        <ProjectFilesTab projectId={daten.id} schreibgeschuetzt={schreibgeschuetzt} />
      )}

      {modulTabs
        .filter((tab) => tab.id === aktiv)
        .map((tab) => {
          const Inhalt = tab.element;
          return (
            <Suspense key={tab.id} fallback={<p className="muted">Wird geladen ...</p>}>
              <Inhalt />
            </Suspense>
          );
        })}
    </div>
  );
}
