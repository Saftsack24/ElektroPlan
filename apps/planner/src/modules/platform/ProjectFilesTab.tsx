import { ApiError } from "@elektroplan/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";

const KB = 1024;

function groesse(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < KB * KB) return `${Math.round(bytes / KB)} KB`;
  return `${(bytes / (KB * KB)).toFixed(1)} MB`;
}

/**
 * Plaene und Dokumente eines Projekts.
 *
 * Der Download laeuft in zwei Schritten: Erst holt die Oberflaeche die
 * signierte Adresse ueber die API (mit `Authorization`-Header), dann navigiert
 * der Browser dorthin. Ein einfacher Link auf den API-Endpunkt wuerde nicht
 * funktionieren - er kann den Header nicht setzen, und der Token gehoert nicht
 * in eine URL (docs/security.md, Abschnitt 7).
 */
export function ProjectFilesTab({
  projectId,
  schreibgeschuetzt,
}: {
  projectId: string;
  schreibgeschuetzt: boolean;
}) {
  const { api } = useAuth();
  // Herunterladen bleibt erlaubt - nur neue Uploads sind gesperrt.
  const darfHochladen = usePermission("file.object.write") && !schreibgeschuetzt;
  const queryClient = useQueryClient();
  const eingabe = useRef<HTMLInputElement>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const dateien = useQuery({
    queryKey: ["project-files", projectId],
    queryFn: () =>
      api.get("/api/v1/projects/{project_id}/files", { path: { project_id: projectId } }),
  });

  const hochladen = useMutation({
    mutationFn: (datei: File) => {
      const form = new FormData();
      form.append("upload", datei);
      form.append("project_id", projectId);
      return api.upload("/api/v1/files", form);
    },
    onSuccess: async () => {
      setFehler(null);
      if (eingabe.current) eingabe.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["project-files", projectId] });
    },
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Upload fehlgeschlagen."),
  });

  const herunterladen = useMutation({
    mutationFn: (fileId: string) =>
      api.get("/api/v1/files/{file_id}/download-url", { path: { file_id: fileId } }),
    onSuccess: (antwort) => {
      setFehler(null);
      window.location.assign(antwort.url);
    },
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Download fehlgeschlagen."),
  });

  return (
    <section className="card">
      <h2>Dateien</h2>
      <p className="muted">
        Erlaubt sind PDF, PNG, JPEG, WebP, CSV und Text. Der Inhalt wird geprüft, nicht nur
        die Dateiendung.
      </p>

      {fehler && <p className="alert alert--error">{fehler}</p>}
      {schreibgeschuetzt && (
        <p className="muted">
          Das Projekt ist archiviert — neue Uploads sind nicht möglich. Bestehende
          Dateien lassen sich weiterhin herunterladen.
        </p>
      )}

      {darfHochladen && (
        <div className="inline-form">
          <div className="field">
            <label className="field__label" htmlFor="datei-upload">
              Datei hochladen
            </label>
            <input
              id="datei-upload"
              ref={eingabe}
              className="field__input"
              type="file"
              disabled={hochladen.isPending}
              onChange={(event) => {
                const datei = event.target.files?.[0];
                if (datei) hochladen.mutate(datei);
              }}
            />
          </div>
          {hochladen.isPending && <p className="muted">Wird hochgeladen ...</p>}
        </div>
      )}

      {dateien.isPending && <p className="muted">Dateien werden geladen ...</p>}
      {dateien.isError && (
        <p className="alert alert--error">Die Dateiliste konnte nicht geladen werden.</p>
      )}
      {dateien.data?.length === 0 && <p className="muted">Noch keine Datei hinterlegt.</p>}

      {dateien.data && dateien.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Dateiname</th>
              <th>Typ</th>
              <th>Größe</th>
              <th>Hochgeladen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {dateien.data.map((datei) => (
              <tr key={datei.id}>
                <td>{datei.filename}</td>
                <td>
                  <code>{datei.content_type}</code>
                </td>
                <td>{groesse(datei.size_bytes)}</td>
                <td>{new Date(datei.created_at).toLocaleString("de-DE")}</td>
                <td>
                  <button
                    className="button button--ghost"
                    type="button"
                    disabled={herunterladen.isPending}
                    onClick={() => herunterladen.mutate(datei.id)}
                  >
                    Herunterladen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
