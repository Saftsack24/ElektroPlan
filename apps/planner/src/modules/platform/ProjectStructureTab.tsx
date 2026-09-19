import { ApiError } from "@elektroplan/api-client";
import type { BuildingOut } from "@elektroplan/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";

/**
 * Gebaeude und Geschosse eines Projekts.
 *
 * Alle Hoehenangaben sind ganzzahlige Millimeter (ADR 0007). Die Oberflaeche
 * rechnet nicht um - sie zeigt Millimeter und nimmt Millimeter entgegen.
 */
export function ProjectStructureTab({ projectId }: { projectId: string }) {
  const { api } = useAuth();
  const darfSchreiben = usePermission("project.record.write");
  const queryClient = useQueryClient();

  const [neuesGebaeude, setNeuesGebaeude] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);

  const gebaeude = useQuery({
    queryKey: ["buildings", projectId],
    queryFn: () =>
      api.get("/api/v1/projects/{project_id}/buildings", { path: { project_id: projectId } }),
  });

  const anlegen = useMutation({
    mutationFn: (name: string) =>
      api.post("/api/v1/projects/{project_id}/buildings", {
        path: { project_id: projectId },
        body: { name: name.trim(), sort_order: gebaeude.data?.length ?? 0 },
      }),
    onSuccess: async () => {
      setNeuesGebaeude("");
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["buildings", projectId] });
    },
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Anlegen fehlgeschlagen."),
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
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Löschen fehlgeschlagen."),
  });

  return (
    <div className="stack">
      <section className="card">
        <h2>Gebäude</h2>
        {gebaeude.isPending && <p className="muted">Wird geladen ...</p>}
        {gebaeude.isError && (
          <p className="alert alert--error">Die Gebäude konnten nicht geladen werden.</p>
        )}
        {fehler && <p className="alert alert--error">{fehler}</p>}
        {gebaeude.data?.length === 0 && <p className="muted">Noch kein Gebäude erfasst.</p>}

        {darfSchreiben && (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              anlegen.mutate(neuesGebaeude);
            }}
          >
            <div className="field">
              <label className="field__label" htmlFor="neues-gebaeude">
                Neues Gebäude
              </label>
              <input
                id="neues-gebaeude"
                className="field__input"
                value={neuesGebaeude}
                placeholder="z. B. Haupthaus"
                onChange={(event) => setNeuesGebaeude(event.target.value)}
              />
            </div>
            <button
              className="button button--primary"
              type="submit"
              disabled={anlegen.isPending || neuesGebaeude.trim().length === 0}
            >
              Hinzufügen
            </button>
          </form>
        )}
      </section>

      {(gebaeude.data ?? []).map((item) => (
        <GebaeudeKarte
          key={item.id}
          gebaeude={item}
          darfSchreiben={darfSchreiben}
          onLoeschen={() => loeschen.mutate(item)}
        />
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
  darfSchreiben,
  onLoeschen,
}: {
  gebaeude: BuildingOut;
  darfSchreiben: boolean;
  onLoeschen: () => void;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [formular, setFormular] = useState(LEERES_GESCHOSS);
  const [fehler, setFehler] = useState<string | null>(null);

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
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Anlegen fehlgeschlagen."),
  });

  const loeschenGeschoss = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.delete("/api/v1/floors/{floor_id}", { path: { floor_id: id }, ifMatch: version }),
    onSuccess: async () => {
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["floors", gebaeude.id] });
    },
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Löschen fehlgeschlagen."),
  });

  return (
    <section className="card">
      <div className="card__header">
        <h3>{gebaeude.name}</h3>
        {darfSchreiben && (
          <button className="button button--ghost" type="button" onClick={onLoeschen}>
            Gebäude löschen
          </button>
        )}
      </div>

      {fehler && <p className="alert alert--error">{fehler}</p>}

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
                  {darfSchreiben && (
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() =>
                        loeschenGeschoss.mutate({
                          id: geschoss.id,
                          version: geschoss.version,
                        })
                      }
                    >
                      Entfernen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Noch kein Geschoss erfasst.</p>
      )}

      {darfSchreiben && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            anlegen.mutate(formular);
          }}
        >
          <ZahlFeld
            id={`level-${gebaeude.id}`}
            label="Ebene"
            value={formular.level}
            onChange={(level) => setFormular({ ...formular, level })}
          />
          <div className="field">
            <label className="field__label" htmlFor={`name-${gebaeude.id}`}>
              Bezeichnung
            </label>
            <input
              id={`name-${gebaeude.id}`}
              className="field__input"
              value={formular.name}
              placeholder="z. B. Erdgeschoss"
              onChange={(event) => setFormular({ ...formular, name: event.target.value })}
            />
          </div>
          <ZahlFeld
            id={`elevation-${gebaeude.id}`}
            label="FFB-Höhe (mm)"
            value={formular.elevation_mm}
            onChange={(elevation_mm) => setFormular({ ...formular, elevation_mm })}
          />
          <ZahlFeld
            id={`height-${gebaeude.id}`}
            label="Standardhöhe (mm)"
            value={formular.default_ceiling_height_mm}
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
      )}
    </section>
  );
}

function ZahlFeld({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field field--narrow">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input"
        type="number"
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
