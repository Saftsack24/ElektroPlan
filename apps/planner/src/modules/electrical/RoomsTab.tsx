import { ApiError } from "@elektroplan/api-client";
import type { components } from "@elektroplan/api-client";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { alsFormularfehler } from "../../core/api/fehler";
import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { Auswahl } from "../../core/ui/Feld";
import { RaumDetail } from "./RaumDetail";
import { RaumDialog } from "./RaumDialog";
import type { Raumwerte } from "./RaumDialog";
import { KONTURZUSTAND_LABEL, flaecheAnzeigen } from "./texte";

type Schemas = components["schemas"];
type RoomOut = Schemas["RoomOut"];
type FloorOut = Schemas["FloorOut"];

type Geschosswahl = {
  id: string;
  label: string;
  default_ceiling_height_mm: number;
};

/**
 * Projekt-Tab „Räume & Grundriss" (Phase 3).
 *
 * Der Tab wird über den Beitragspunkt `project.tabs` registriert
 * (`src/modules/electrical/index.ts`); die zentrale Projektseite kennt dieses
 * Modul nicht (docs/modules.md, Abschnitt 6). Die Projekt-ID kommt aus der
 * Route, in der der Tab gerendert wird.
 *
 * Bewusst formular- und listenbasiert: Phase 3 erfasst das Raummodell, der
 * 2D-Editor kommt in Phase 4a (ADR 0010). Es gibt hier kein Canvas.
 */
export default function RoomsTab() {
  const { projectId = "" } = useParams();
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const darfSchreibenGrundsaetzlich = usePermission("electrical.plan.write");

  const [geschossId, setGeschossId] = useState<string>("");
  const [raumdialog, setRaumdialog] = useState<{ raum: RoomOut | null } | null>(null);
  const [offenerRaum, setOffenerRaum] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const projekt = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get("/api/v1/projects/{project_id}", { path: { project_id: projectId } }),
  });

  const gebaeude = useQuery({
    queryKey: ["buildings", projectId],
    queryFn: () =>
      api.get("/api/v1/projects/{project_id}/buildings", { path: { project_id: projectId } }),
  });

  // Je Gebäude eine Abfrage, aber ein Ladezustand - wie im Strukturtab.
  const geschosse = useQueries({
    queries: (gebaeude.data ?? []).map((haus) => ({
      queryKey: ["floors", haus.id],
      queryFn: () =>
        api.get("/api/v1/buildings/{building_id}/floors", { path: { building_id: haus.id } }),
    })),
  });

  const auswahl: Geschosswahl[] = (gebaeude.data ?? []).flatMap((haus, index) => {
    const eintraege: FloorOut[] = geschosse[index]?.data ?? [];
    return eintraege.map((geschoss) => ({
      id: geschoss.id,
      label: `${haus.name} · ${geschoss.name}`,
      default_ceiling_height_mm: geschoss.default_ceiling_height_mm,
    }));
  });

  // Ohne ausdrückliche Wahl gilt das erste Geschoss - der Alltagsfall hat nur
  // eines, und eine leere Auswahl wäre eine unnötige Hürde.
  const aktivesGeschoss = auswahl.find((eintrag) => eintrag.id === geschossId) ?? auswahl[0];

  const raeume = useQuery({
    queryKey: ["electrical", "rooms", aktivesGeschoss?.id],
    queryFn: () =>
      api.get("/api/v1/modules/electrical/floors/{floor_id}/rooms", {
        path: { floor_id: aktivesGeschoss?.id ?? "" },
      }),
    enabled: aktivesGeschoss !== undefined,
  });

  const archiviert = projekt.data?.status === "archived";
  const darfSchreiben = darfSchreibenGrundsaetzlich && !archiviert;

  const raeumeNeuLaden = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["electrical", "rooms", aktivesGeschoss?.id],
    });
  };

  const raumSpeichern = async (werte: Raumwerte) => {
    const hoehe = werte.height_mm.trim();
    const koerper = {
      name: werte.name.trim(),
      room_number: werte.room_number.trim() === "" ? null : werte.room_number.trim(),
      height_mm: hoehe === "" ? null : Number.parseInt(hoehe, 10),
    };
    try {
      const bestehend = raumdialog?.raum ?? null;
      if (bestehend === null) {
        await api.post("/api/v1/modules/electrical/floors/{floor_id}/rooms", {
          path: { floor_id: aktivesGeschoss?.id ?? "" },
          body: koerper,
        });
      } else {
        await api.patch("/api/v1/modules/electrical/rooms/{room_id}", {
          path: { room_id: bestehend.id },
          ifMatch: bestehend.version,
          body: koerper,
        });
      }
      setRaumdialog(null);
      await raeumeNeuLaden();
      return undefined;
    } catch (error: unknown) {
      return alsFormularfehler(error, ["name", "room_number", "height_mm"] as const);
    }
  };

  const raumLoeschen = useMutation({
    mutationFn: (raum: RoomOut) =>
      api.delete("/api/v1/modules/electrical/rooms/{room_id}", {
        path: { room_id: raum.id },
        ifMatch: raum.version,
      }),
    onSuccess: async (_daten, raum) => {
      setFehler(null);
      if (offenerRaum === raum.id) setOffenerRaum(null);
      await raeumeNeuLaden();
    },
    onError: (error: unknown) =>
      setFehler(
        error instanceof ApiError ? error.userMessage : "Der Raum konnte nicht entfernt werden.",
      ),
  });

  if (projekt.isPending || gebaeude.isPending) {
    return <p className="muted">Grundriss wird geladen ...</p>;
  }
  if (projekt.isError || gebaeude.isError) {
    return (
      <p className="alert alert--error" role="alert">
        Die Gebäudestruktur dieses Projekts konnte nicht geladen werden.
      </p>
    );
  }

  if (auswahl.length === 0) {
    return (
      <section className="card">
        <h2>Räume &amp; Grundriss</h2>
        <p className="muted">
          Für dieses Projekt ist noch kein Geschoss angelegt. Räume hängen an einem
          Geschoss — bitte zuerst im Tab „Gebäude &amp; Geschosse" eines anlegen.
        </p>
      </section>
    );
  }

  const liste: RoomOut[] = raeume.data ?? [];
  const geoeffnet = liste.find((raum) => raum.id === offenerRaum) ?? null;

  return (
    <div className="stack">
      <section className="card">
        <div className="card__header">
          <h2>Räume &amp; Grundriss</h2>
          {darfSchreiben && (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setRaumdialog({ raum: null })}
            >
              Raum anlegen
            </button>
          )}
        </div>

        {archiviert && (
          <p className="alert">
            Dieses Projekt ist archiviert und damit <strong>schreibgeschützt</strong>.
            Räume, Wände und Öffnungen lassen sich ansehen, aber nicht mehr ändern.
          </p>
        )}

        <Auswahl
          id="electrical-geschoss"
          label="Geschoss"
          value={aktivesGeschoss?.id ?? ""}
          onChange={(id) => {
            setGeschossId(id);
            setOffenerRaum(null);
          }}
        >
          {auswahl.map((eintrag) => (
            <option key={eintrag.id} value={eintrag.id}>
              {eintrag.label}
            </option>
          ))}
        </Auswahl>

        {fehler !== null && (
          <p className="alert alert--error" role="alert">
            {fehler}
          </p>
        )}

        {raeume.isPending ? (
          <p className="muted">Räume werden geladen ...</p>
        ) : raeume.isError ? (
          <p className="alert alert--error" role="alert">
            Die Räume dieses Geschosses konnten nicht geladen werden.
          </p>
        ) : liste.length === 0 ? (
          <p className="muted">
            Auf diesem Geschoss ist noch kein Raum erfasst.
            {darfSchreiben ? " Mit „Raum anlegen“ geht es los." : ""}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Bezeichnung</th>
                <th>Höhe (mm)</th>
                <th>Kontur</th>
                <th>Wände</th>
                <th>Fläche</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((raum) => (
                <tr key={raum.id}>
                  <td>{raum.room_number ?? "—"}</td>
                  <td>{raum.name}</td>
                  <td>{raum.effective_height_mm}</td>
                  <td>{KONTURZUSTAND_LABEL[raum.contour_status]}</td>
                  <td>{raum.wall_count}</td>
                  <td>{flaecheAnzeigen(raum.area_m2)}</td>
                  <td>
                    <div className="button-row">
                      <button
                        className="button button--ghost"
                        type="button"
                        aria-label={`Raum ${raum.name} öffnen`}
                        onClick={() =>
                          setOffenerRaum(offenerRaum === raum.id ? null : raum.id)
                        }
                      >
                        {offenerRaum === raum.id ? "Schließen" : "Öffnen"}
                      </button>
                      {darfSchreiben && (
                        <>
                          <button
                            className="button button--ghost"
                            type="button"
                            aria-label={`Raum ${raum.name} bearbeiten`}
                            onClick={() => setRaumdialog({ raum })}
                          >
                            Bearbeiten
                          </button>
                          <button
                            className="button button--ghost"
                            type="button"
                            aria-label={`Raum ${raum.name} entfernen`}
                            disabled={raumLoeschen.isPending}
                            onClick={() => raumLoeschen.mutate(raum)}
                          >
                            Entfernen
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {geoeffnet !== null && (
        <RaumDetail
          key={geoeffnet.id}
          raum={geoeffnet}
          darfSchreiben={darfSchreiben}
          onRaumGeaendert={raeumeNeuLaden}
        />
      )}

      {raumdialog !== null && (
        <RaumDialog
          key={raumdialog.raum?.id ?? "neu"}
          offen
          titel={raumdialog.raum === null ? "Raum anlegen" : "Raum bearbeiten"}
          standardhoehe_mm={aktivesGeschoss?.default_ceiling_height_mm ?? 2500}
          startwerte={
            raumdialog.raum === null
              ? undefined
              : {
                  name: raumdialog.raum.name,
                  room_number: raumdialog.raum.room_number ?? "",
                  height_mm:
                    raumdialog.raum.height_mm === null
                      ? ""
                      : String(raumdialog.raum.height_mm),
                }
          }
          onSubmit={raumSpeichern}
          onClose={() => setRaumdialog(null)}
        />
      )}
    </div>
  );
}
