import { ApiError } from "@elektroplan/api-client";
import type { components } from "@elektroplan/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth } from "../../core/auth/AuthProvider";
import { alsFormularfehler } from "../../core/api/fehler";
import { OeffnungDialog } from "./OeffnungDialog";
import type { Oeffnungswerte } from "./OeffnungDialog";
import { WandDialog } from "./WandDialog";
import type { Wandwerte } from "./WandDialog";
import {
  KONTURZUSTAND_ERKLAERUNG,
  KONTURZUSTAND_LABEL,
  OEFFNUNGSART_LABEL,
  flaecheAnzeigen,
} from "./texte";

type Schemas = components["schemas"];
type RoomOut = Schemas["RoomOut"];
type WallOut = Schemas["WallOut"];
type OpeningOut = Schemas["OpeningOut"];

/**
 * Kontur, Wände und Öffnungen eines Raums.
 *
 * Bewusst ohne Zeichenfläche: Phase 3 erfasst das Modell, der 2D-Editor kommt
 * in Phase 4a (ADR 0010). Die Tabelle der Wände **ist** die Konturvorschau -
 * mit Reihenfolge, Koordinaten und Länge.
 *
 * Der Konturzustand kommt vom Server und ist dort **abgeleitet**, nicht
 * gespeichert (ADR 0013). Die Oberfläche zeigt ihn samt der Einzelfehler, die
 * noch fehlen.
 */
export function RaumDetail({
  raum,
  darfSchreiben,
  onRaumGeaendert,
}: {
  raum: RoomOut;
  darfSchreiben: boolean;
  onRaumGeaendert: () => Promise<void>;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [wanddialog, setWanddialog] = useState<{ wand: WallOut | null } | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const waende = useQuery({
    queryKey: ["electrical", "walls", raum.id],
    queryFn: () =>
      api.get("/api/v1/modules/electrical/rooms/{room_id}/walls", {
        path: { room_id: raum.id },
      }),
  });

  const kontur = useQuery({
    queryKey: ["electrical", "contour", raum.id],
    queryFn: () =>
      api.get("/api/v1/modules/electrical/rooms/{room_id}/contour", {
        path: { room_id: raum.id },
      }),
  });

  const aktualisieren = async () => {
    await queryClient.invalidateQueries({ queryKey: ["electrical", "walls", raum.id] });
    await queryClient.invalidateQueries({ queryKey: ["electrical", "contour", raum.id] });
    await onRaumGeaendert();
  };

  const wandSpeichern = async (werte: Wandwerte) => {
    const koerper = {
      x1_mm: Number.parseInt(werte.x1_mm, 10),
      y1_mm: Number.parseInt(werte.y1_mm, 10),
      x2_mm: Number.parseInt(werte.x2_mm, 10),
      y2_mm: Number.parseInt(werte.y2_mm, 10),
      thickness_mm: Number.parseInt(werte.thickness_mm, 10),
    };
    try {
      const bestehend = wanddialog?.wand ?? null;
      if (bestehend === null) {
        await api.post("/api/v1/modules/electrical/rooms/{room_id}/walls", {
          path: { room_id: raum.id },
          body: koerper,
        });
      } else {
        await api.patch("/api/v1/modules/electrical/walls/{wall_id}", {
          path: { wall_id: bestehend.id },
          ifMatch: bestehend.version,
          body: koerper,
        });
      }
      setWanddialog(null);
      await aktualisieren();
      return undefined;
    } catch (error: unknown) {
      return alsFormularfehler(error, [
        "x1_mm",
        "y1_mm",
        "x2_mm",
        "y2_mm",
        "thickness_mm",
      ] as const);
    }
  };

  const wandLoeschen = useMutation({
    mutationFn: (wand: WallOut) =>
      api.delete("/api/v1/modules/electrical/walls/{wall_id}", {
        path: { wall_id: wand.id },
        ifMatch: wand.version,
      }),
    onSuccess: async () => {
      setFehler(null);
      await aktualisieren();
    },
    onError: (error: unknown) =>
      setFehler(
        error instanceof ApiError ? error.userMessage : "Die Wand konnte nicht entfernt werden.",
      ),
  });

  const umordnen = useMutation({
    mutationFn: (reihenfolge: string[]) =>
      api.post("/api/v1/modules/electrical/rooms/{room_id}/walls/reorder", {
        path: { room_id: raum.id },
        ifMatch: raum.version,
        body: { wall_ids: reihenfolge },
      }),
    onSuccess: async () => {
      setFehler(null);
      await aktualisieren();
    },
    onError: (error: unknown) =>
      setFehler(
        error instanceof ApiError
          ? error.userMessage
          : "Die Reihenfolge konnte nicht geändert werden.",
      ),
  });

  const verschieben = (index: number, richtung: -1 | 1) => {
    const liste = [...(waende.data ?? [])];
    const ziel = index + richtung;
    if (ziel < 0 || ziel >= liste.length) return;
    const bewegt = liste[index];
    if (bewegt === undefined) return;
    liste.splice(index, 1);
    liste.splice(ziel, 0, bewegt);
    umordnen.mutate(liste.map((wand) => wand.id));
  };

  if (waende.isPending || kontur.isPending) {
    return <p className="muted">Raum wird geladen ...</p>;
  }
  if (waende.isError || kontur.isError) {
    return (
      <p className="alert alert--error" role="alert">
        Die Wände dieses Raums konnten nicht geladen werden.
      </p>
    );
  }

  const liste: WallOut[] = waende.data;
  const bericht = kontur.data;
  const zustand = bericht.contour_status;

  return (
    <div className="stack">
      <section className="card">
        <h3>Raumkontur</h3>
        <p>
          <strong>{KONTURZUSTAND_LABEL[zustand]}</strong> · {bericht.wall_count} Wände ·
          Fläche {flaecheAnzeigen(bericht.area_m2)} · Umfang{" "}
          {bericht.perimeter_mm === null ? "—" : `${bericht.perimeter_mm} mm`}
        </p>
        <p className="muted">{KONTURZUSTAND_ERKLAERUNG[zustand]}</p>

        {bericht.problems.length > 0 && (
          <div className="alert" role="status">
            <p>Damit die Kontur geschlossen ist, fehlt noch:</p>
            <ul>
              {bericht.problems.map((problem, index) => (
                <li key={`${problem.code}-${index}`}>{problem.message}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card__header">
          <h3>Wände</h3>
          {darfSchreiben && (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setWanddialog({ wand: null })}
            >
              Wand hinzufügen
            </button>
          )}
        </div>

        {fehler !== null && (
          <p className="alert alert--error" role="alert">
            {fehler}
          </p>
        )}

        {liste.length === 0 ? (
          <p className="muted">
            Noch keine Wand erfasst. Eine geschlossene Kontur braucht mindestens drei.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Von (X/Y)</th>
                <th>Nach (X/Y)</th>
                <th>Länge (mm)</th>
                <th>Stärke (mm)</th>
                <th>Öffnungen</th>
                {darfSchreiben && <th>Aktion</th>}
              </tr>
            </thead>
            <tbody>
              {liste.map((wand, index) => (
                <tr key={wand.id}>
                  <td>{index + 1}</td>
                  <td>
                    {wand.x1_mm} / {wand.y1_mm}
                  </td>
                  <td>
                    {wand.x2_mm} / {wand.y2_mm}
                  </td>
                  <td>{wand.length_mm}</td>
                  <td>{wand.thickness_mm}</td>
                  <td>{wand.opening_count}</td>
                  {darfSchreiben && (
                    <td>
                      <div className="button-row">
                        <button
                          className="button button--ghost"
                          type="button"
                          aria-label={`Wand ${index + 1} bearbeiten`}
                          onClick={() => setWanddialog({ wand })}
                        >
                          Bearbeiten
                        </button>
                        <button
                          className="button button--ghost"
                          type="button"
                          aria-label={`Wand ${index + 1} nach oben`}
                          disabled={index === 0 || umordnen.isPending}
                          onClick={() => verschieben(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="button button--ghost"
                          type="button"
                          aria-label={`Wand ${index + 1} nach unten`}
                          disabled={index === liste.length - 1 || umordnen.isPending}
                          onClick={() => verschieben(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          className="button button--ghost"
                          type="button"
                          aria-label={`Wand ${index + 1} entfernen`}
                          disabled={wandLoeschen.isPending}
                          onClick={() => wandLoeschen.mutate(wand)}
                        >
                          Entfernen
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {liste.map((wand, index) => (
        <Oeffnungen
          key={wand.id}
          wand={wand}
          nummer={index + 1}
          darfSchreiben={darfSchreiben}
          onGeaendert={aktualisieren}
        />
      ))}

      {wanddialog !== null && (
        <WandDialog
          key={wanddialog.wand?.id ?? "neu"}
          offen
          titel={wanddialog.wand === null ? "Wand hinzufügen" : "Wand bearbeiten"}
          startwerte={
            wanddialog.wand === null
              ? undefined
              : {
                  x1_mm: String(wanddialog.wand.x1_mm),
                  y1_mm: String(wanddialog.wand.y1_mm),
                  x2_mm: String(wanddialog.wand.x2_mm),
                  y2_mm: String(wanddialog.wand.y2_mm),
                  thickness_mm: String(wanddialog.wand.thickness_mm),
                }
          }
          onSubmit={wandSpeichern}
          onClose={() => setWanddialog(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Öffnungen

function Oeffnungen({
  wand,
  nummer,
  darfSchreiben,
  onGeaendert,
}: {
  wand: WallOut;
  nummer: number;
  darfSchreiben: boolean;
  onGeaendert: () => Promise<void>;
}) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ oeffnung: OpeningOut | null } | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const oeffnungen = useQuery({
    queryKey: ["electrical", "openings", wand.id],
    queryFn: () =>
      api.get("/api/v1/modules/electrical/walls/{wall_id}/openings", {
        path: { wall_id: wand.id },
      }),
  });

  const aktualisieren = async () => {
    await queryClient.invalidateQueries({ queryKey: ["electrical", "openings", wand.id] });
    await onGeaendert();
  };

  const speichern = async (werte: Oeffnungswerte) => {
    const koerper = {
      kind: werte.kind,
      offset_mm: Number.parseInt(werte.offset_mm, 10),
      width_mm: Number.parseInt(werte.width_mm, 10),
      height_mm: Number.parseInt(werte.height_mm, 10),
      sill_height_mm: Number.parseInt(werte.sill_height_mm, 10),
    };
    try {
      const bestehend = dialog?.oeffnung ?? null;
      if (bestehend === null) {
        await api.post("/api/v1/modules/electrical/walls/{wall_id}/openings", {
          path: { wall_id: wand.id },
          body: koerper,
        });
      } else {
        await api.patch("/api/v1/modules/electrical/openings/{opening_id}", {
          path: { opening_id: bestehend.id },
          ifMatch: bestehend.version,
          body: koerper,
        });
      }
      setDialog(null);
      await aktualisieren();
      return undefined;
    } catch (error: unknown) {
      return alsFormularfehler(error, [
        "kind",
        "offset_mm",
        "width_mm",
        "height_mm",
        "sill_height_mm",
      ] as const);
    }
  };

  const loeschen = useMutation({
    mutationFn: (oeffnung: OpeningOut) =>
      api.delete("/api/v1/modules/electrical/openings/{opening_id}", {
        path: { opening_id: oeffnung.id },
        ifMatch: oeffnung.version,
      }),
    onSuccess: async () => {
      setFehler(null);
      await aktualisieren();
    },
    onError: (error: unknown) =>
      setFehler(
        error instanceof ApiError
          ? error.userMessage
          : "Die Öffnung konnte nicht entfernt werden.",
      ),
  });

  const liste: OpeningOut[] = oeffnungen.data ?? [];

  return (
    <section className="card card--eingerueckt">
      <div className="card__header">
        <h4>
          Öffnungen in Wand {nummer} ({wand.length_mm} mm)
        </h4>
        {darfSchreiben && (
          <button
            className="button button--ghost"
            type="button"
            onClick={() => setDialog({ oeffnung: null })}
          >
            Öffnung hinzufügen
          </button>
        )}
      </div>

      {fehler !== null && (
        <p className="alert alert--error" role="alert">
          {fehler}
        </p>
      )}

      {oeffnungen.isPending ? (
        <p className="muted">Öffnungen werden geladen ...</p>
      ) : oeffnungen.isError ? (
        <p className="alert alert--error" role="alert">
          Die Öffnungen konnten nicht geladen werden.
        </p>
      ) : liste.length === 0 ? (
        <p className="muted">Keine Öffnung in dieser Wand.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Art</th>
              <th>Abstand (mm)</th>
              <th>Breite (mm)</th>
              <th>Höhe (mm)</th>
              <th>Brüstung (mm)</th>
              {darfSchreiben && <th>Aktion</th>}
            </tr>
          </thead>
          <tbody>
            {liste.map((oeffnung) => (
              <tr key={oeffnung.id}>
                <td>{OEFFNUNGSART_LABEL[oeffnung.kind]}</td>
                <td>{oeffnung.offset_mm}</td>
                <td>{oeffnung.width_mm}</td>
                <td>{oeffnung.height_mm}</td>
                <td>{oeffnung.sill_height_mm}</td>
                {darfSchreiben && (
                  <td>
                    <div className="button-row">
                      <button
                        className="button button--ghost"
                        type="button"
                        onClick={() => setDialog({ oeffnung })}
                      >
                        Bearbeiten
                      </button>
                      <button
                        className="button button--ghost"
                        type="button"
                        disabled={loeschen.isPending}
                        onClick={() => loeschen.mutate(oeffnung)}
                      >
                        Entfernen
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialog !== null && (
        <OeffnungDialog
          key={dialog.oeffnung?.id ?? "neu"}
          offen
          titel={dialog.oeffnung === null ? "Öffnung hinzufügen" : "Öffnung bearbeiten"}
          wandlaenge_mm={wand.length_mm}
          startwerte={
            dialog.oeffnung === null
              ? undefined
              : {
                  kind: dialog.oeffnung.kind,
                  offset_mm: String(dialog.oeffnung.offset_mm),
                  width_mm: String(dialog.oeffnung.width_mm),
                  height_mm: String(dialog.oeffnung.height_mm),
                  sill_height_mm: String(dialog.oeffnung.sill_height_mm),
                }
          }
          onSubmit={speichern}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
