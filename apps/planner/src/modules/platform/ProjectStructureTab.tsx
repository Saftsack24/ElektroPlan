import { ApiError } from "@elektroplan/api-client";
import type { BuildingOut, FloorOut } from "@elektroplan/api-client";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { Feld } from "../../core/ui/Feld";

/**
 * Gebäude und Geschosse eines Projekts.
 *
 * Der Alltagsfall - ein Gebäude, ein paar Geschosse - steht als Übersicht im
 * Vordergrund. Das Anlegen, Umbenennen und Löschen liegt darunter in einem
 * ausklappbaren Bereich „Gebäudestruktur verwalten", damit die Seite beim
 * Nachschlagen ruhig bleibt.
 *
 * Alle Höhenangaben sind ganzzahlige Millimeter (ADR 0007). Die Oberfläche
 * rechnet nicht um - sie zeigt Millimeter und nimmt Millimeter entgegen.
 */
export function ProjectStructureTab({
  projectId,
  schreibgeschuetzt,
}: {
  projectId: string;
  schreibgeschuetzt: boolean;
}) {
  const { api } = useAuth();
  const darfSchreiben = usePermission("project.record.write") && !schreibgeschuetzt;

  const gebaeude = useQuery({
    queryKey: ["buildings", projectId],
    queryFn: () =>
      api.get("/api/v1/projects/{project_id}/buildings", { path: { project_id: projectId } }),
  });

  // Alle Geschosse parallel - je Gebäude eine Abfrage, aber ein Ladezustand.
  const geschosse = useQueries({
    queries: (gebaeude.data ?? []).map((haus) => ({
      queryKey: ["floors", haus.id],
      queryFn: () =>
        api.get("/api/v1/buildings/{building_id}/floors", { path: { building_id: haus.id } }),
    })),
  });

  if (gebaeude.isPending) return <p className="muted">Struktur wird geladen ...</p>;
  if (gebaeude.isError) {
    return (
      <p className="alert alert--error" role="alert">
        Die Gebäude konnten nicht geladen werden.
      </p>
    );
  }

  const haeuser = gebaeude.data;

  return (
    <div className="stack">
      <section className="card">
        <h2>Gebäude und Geschosse</h2>
        {schreibgeschuetzt && (
          <p className="muted">
            Das Projekt ist archiviert — die Struktur ist schreibgeschützt.
          </p>
        )}
        {haeuser.length === 0 ? (
          <p className="muted">
            Noch kein Gebäude erfasst. Beim Anlegen eines Projekts wird auf Wunsch
            gleich eines mit angelegt; hier lässt es sich jederzeit nachtragen.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Gebäude</th>
                <th>Ebene</th>
                <th>Geschoss</th>
                <th>FFB-Höhe (mm)</th>
                <th>Standardhöhe (mm)</th>
              </tr>
            </thead>
            <tbody>
              {haeuser.flatMap((haus, index) => {
                const eintraege: FloorOut[] = geschosse[index]?.data ?? [];
                if (eintraege.length === 0) {
                  return [
                    <tr key={haus.id}>
                      <td>{haus.name}</td>
                      <td colSpan={4} className="muted">
                        noch kein Geschoss
                      </td>
                    </tr>,
                  ];
                }
                return eintraege.map((geschoss, zeile) => (
                  <tr key={geschoss.id}>
                    <td>{zeile === 0 ? haus.name : ""}</td>
                    <td>{geschoss.level}</td>
                    <td>{geschoss.name}</td>
                    <td>{geschoss.elevation_mm}</td>
                    <td>{geschoss.default_ceiling_height_mm}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        )}
      </section>

      {darfSchreiben && (
        <details className="card">
          <summary className="details__titel">Gebäudestruktur verwalten</summary>
          <p className="muted">
            Gebäude und Geschosse anlegen, umbenennen oder entfernen. Für den
            Regelfall ist das nicht nötig.
          </p>
          <Verwaltung projectId={projectId} gebaeude={haeuser} />
        </details>
      )}
    </div>
  );
}

// --------------------------------------------------------------- Verwaltung

function Verwaltung({
  projectId,
  gebaeude,
}: {
  projectId: string;
  gebaeude: readonly BuildingOut[];
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [neuesGebaeude, setNeuesGebaeude] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);

  const melden = (error: unknown, standard: string) =>
    setFehler(error instanceof ApiError ? error.userMessage : standard);

  const anlegen = useMutation({
    mutationFn: (name: string) =>
      api.post("/api/v1/projects/{project_id}/buildings", {
        path: { project_id: projectId },
        body: { name: name.trim(), sort_order: gebaeude.length },
      }),
    onSuccess: async () => {
      setNeuesGebaeude("");
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["buildings", projectId] });
    },
    onError: (error: unknown) => melden(error, "Anlegen fehlgeschlagen."),
  });

  const loeschen = useMutation({
    mutationFn: (item: BuildingOut) =>
      api.delete("/api/v1/buildings/{building_id}", {
        path: { building_id: item.id },
        ifMatch: item.version,
      }),
    onSuccess: async () => {
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["buildings", projectId] });
    },
    onError: (error: unknown) => melden(error, "Löschen fehlgeschlagen."),
  });

  return (
    <div className="stack">
      {fehler !== null && (
        <p className="alert alert--error" role="alert">
          {fehler}
        </p>
      )}

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!anlegen.isPending) anlegen.mutate(neuesGebaeude);
        }}
      >
        <Feld
          id="neues-gebaeude"
          label="Neues Gebäude"
          value={neuesGebaeude}
          disabled={anlegen.isPending}
          onChange={setNeuesGebaeude}
        />
        <button
          className="button button--primary"
          type="submit"
          disabled={anlegen.isPending || neuesGebaeude.trim().length === 0}
        >
          {anlegen.isPending ? "Wird angelegt ..." : "Hinzufügen"}
        </button>
      </form>

      {gebaeude.map((haus) => (
        <GebaeudeKarte key={haus.id} gebaeude={haus} onLoeschen={() => loeschen.mutate(haus)} />
      ))}
    </div>
  );
}

const LEERES_GESCHOSS = {
  name: "",
  level: "0",
  elevation_mm: "0",
  default_ceiling_height_mm: "2500",
};

function GebaeudeKarte({
  gebaeude,
  onLoeschen,
}: {
  gebaeude: BuildingOut;
  onLoeschen: () => void;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [formular, setFormular] = useState(LEERES_GESCHOSS);
  const [fehler, setFehler] = useState<string | null>(null);

  const melden = (error: unknown, standard: string) =>
    setFehler(error instanceof ApiError ? error.userMessage : standard);

  const geschosse = useQuery({
    queryKey: ["floors", gebaeude.id],
    queryFn: () =>
      api.get("/api/v1/buildings/{building_id}/floors", { path: { building_id: gebaeude.id } }),
  });

  const anlegen = useMutation({
    mutationFn: (eingabe: typeof LEERES_GESCHOSS) =>
      api.post("/api/v1/buildings/{building_id}/floors", {
        path: { building_id: gebaeude.id },
        body: {
          name: eingabe.name.trim(),
          level: Number.parseInt(eingabe.level, 10),
          elevation_mm: Number.parseInt(eingabe.elevation_mm, 10),
          default_ceiling_height_mm: Number.parseInt(eingabe.default_ceiling_height_mm, 10),
        },
      }),
    onSuccess: async () => {
      setFormular(LEERES_GESCHOSS);
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["floors", gebaeude.id] });
    },
    onError: (error: unknown) => melden(error, "Anlegen fehlgeschlagen."),
  });

  const loeschenGeschoss = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.delete("/api/v1/floors/{floor_id}", { path: { floor_id: id }, ifMatch: version }),
    onSuccess: async () => {
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["floors", gebaeude.id] });
    },
    onError: (error: unknown) => melden(error, "Löschen fehlgeschlagen."),
  });

  return (
    <section className="card card--eingerueckt">
      <div className="card__header">
        <h3>{gebaeude.name}</h3>
        <button className="button button--ghost" type="button" onClick={onLoeschen}>
          Gebäude löschen
        </button>
      </div>

      {fehler !== null && (
        <p className="alert alert--error" role="alert">
          {fehler}
        </p>
      )}

      {geschosse.data && geschosse.data.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Ebene</th>
              <th>Bezeichnung</th>
              <th>FFB-Höhe (mm)</th>
              <th>Standardhöhe (mm)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {geschosse.data.map((geschoss) => (
              <tr key={geschoss.id}>
                <td>{geschoss.level}</td>
                <td>{geschoss.name}</td>
                <td>{geschoss.elevation_mm}</td>
                <td>{geschoss.default_ceiling_height_mm}</td>
                <td>
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={() =>
                      loeschenGeschoss.mutate({ id: geschoss.id, version: geschoss.version })
                    }
                  >
                    Entfernen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Noch kein Geschoss erfasst.</p>
      )}

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!anlegen.isPending) anlegen.mutate(formular);
        }}
      >
        <Feld
          id={`level-${gebaeude.id}`}
          label="Ebene"
          type="number"
          value={formular.level}
          disabled={anlegen.isPending}
          onChange={(level) => setFormular({ ...formular, level })}
        />
        <Feld
          id={`name-${gebaeude.id}`}
          label="Bezeichnung"
          value={formular.name}
          disabled={anlegen.isPending}
          onChange={(name) => setFormular({ ...formular, name })}
        />
        <Feld
          id={`elevation-${gebaeude.id}`}
          label="FFB-Höhe (mm)"
          type="number"
          value={formular.elevation_mm}
          disabled={anlegen.isPending}
          onChange={(elevation_mm) => setFormular({ ...formular, elevation_mm })}
        />
        <Feld
          id={`height-${gebaeude.id}`}
          label="Standardhöhe (mm)"
          type="number"
          value={formular.default_ceiling_height_mm}
          disabled={anlegen.isPending}
          onChange={(default_ceiling_height_mm) =>
            setFormular({ ...formular, default_ceiling_height_mm })
          }
        />
        <button
          className="button button--primary"
          type="submit"
          disabled={anlegen.isPending || formular.name.trim().length === 0}
        >
          Geschoss hinzufügen
        </button>
      </form>
    </section>
  );
}
