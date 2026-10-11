import { ApiError } from "@elektroplan/api-client";
import type { BuildingOut, FloorOut } from "@elektroplan/api-client";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { eingabenAusMm, eingabenLesen, eingabenUmrechnen } from "../../core/masse";
import { Feld, Schalter } from "../../core/ui/Feld";
import { Marke } from "../../core/ui/Marke";
import type { Masse } from "../../core/ui/masseinheit";
import { useEinheitenwechsel, useMasse } from "../../core/ui/masseinheit";
import { FELDREIHE, KARTENKOPF, STAPEL, TABELLE, karte, knopf, meldungsflaeche } from "../../core/ui/stil";
import { AKTION } from "../../core/ui/aktionssymbole";
import { MitSymbol } from "../../core/ui/Symbol";

/**
 * Gebäude und Geschosse eines Projekts.
 *
 * Der Alltagsfall - ein Gebäude, ein paar Geschosse - steht als Übersicht im
 * Vordergrund. Das Anlegen, Umbenennen und Löschen liegt darunter in einem
 * ausklappbaren Bereich „Gebäudestruktur verwalten", damit die Seite beim
 * Nachschlagen ruhig bleibt.
 *
 * Alle Höhenangaben sind ganzzahlige Millimeter (ADR 0007). Angezeigt und
 * eingegeben wird in der persönlichen Anzeigeeinheit; umgerechnet wird nur
 * an der Oberflächengrenze (`core/masse.ts`), gesendet werden Millimeter.
 *
 * **Bestätigte Höhenlage (Phase 6a, ADR 0025):** Neben jeder Höhenlage steht,
 * ob sie ausdrücklich bestätigt ist. Nichts wird automatisch bestätigt - auch
 * nicht das Erdgeschoss mit 0. Wer den Wert ändert, muss ihn im selben
 * Speichervorgang erneut bestätigen; sonst gilt er als nicht bestätigt.
 */
export function ProjectStructureTab({
  projectId,
  schreibgeschuetzt,
}: {
  projectId: string;
  schreibgeschuetzt: boolean;
}) {
  const { api } = useAuth();
  const masse = useMasse();
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

  if (gebaeude.isPending) return <p className="text-muted">Struktur wird geladen ...</p>;
  if (gebaeude.isError) {
    return (
      <p className={meldungsflaeche()} role="alert">
        Die Gebäude konnten nicht geladen werden.
      </p>
    );
  }

  const haeuser = gebaeude.data;

  return (
    <div className={STAPEL}>
      <section className={karte()}>
        <h2>Gebäude und Geschosse</h2>
        {schreibgeschuetzt && (
          <p className="text-muted">
            Das Projekt ist abgeschlossen oder archiviert — die Struktur ist schreibgeschützt.
          </p>
        )}
        {haeuser.length === 0 ? (
          <p className="text-muted">
            Noch kein Gebäude erfasst. Beim Anlegen eines Projekts wird auf Wunsch
            gleich eines mit angelegt; hier lässt es sich jederzeit nachtragen.
          </p>
        ) : (
          <table className={TABELLE}>
            <thead>
              <tr>
                <th>Gebäude</th>
                <th>Ebene</th>
                <th>Geschoss</th>
                <th>Höhenlage (FFB)</th>
                <th>Standardhöhe</th>
              </tr>
            </thead>
            <tbody>
              {haeuser.flatMap((haus, index) => {
                const eintraege: FloorOut[] = geschosse[index]?.data ?? [];
                if (eintraege.length === 0) {
                  return [
                    <tr key={haus.id}>
                      <td>{haus.name}</td>
                      <td colSpan={4} className="text-muted">
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
                    <td>
                      <Hoehenlage geschoss={geschoss} masse={masse} />
                    </td>
                    <td>{masse.anzeigen(geschoss.default_ceiling_height_mm)}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        )}
        {geschosse.some((abfrage) => (abfrage.data ?? []).some((g) => !g.elevation_confirmed)) && (
          <p className="text-label text-muted" data-testid="hoehenlage-hinweis">
            Nicht bestätigte Höhenlagen gelten nicht als verlässlich: Leitungslängen zwischen
            Geschossen werden daraus nicht berechnet. Bestätigen lässt sich eine Höhenlage unter
            „Gebäudestruktur verwalten“.
          </p>
        )}
      </section>

      {darfSchreiben && (
        <details className={karte()}>
          <summary className="cursor-pointer font-semibold">Gebäudestruktur verwalten</summary>
          <p className="text-muted">
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
      await queryClient.invalidateQueries({ queryKey: ["project", projectId], exact: true });
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
      await queryClient.invalidateQueries({ queryKey: ["project", projectId], exact: true });
    },
    onError: (error: unknown) => melden(error, "Löschen fehlgeschlagen."),
  });

  return (
    <div className={STAPEL}>
      {fehler !== null && (
        <p className={meldungsflaeche()} role="alert">
          {fehler}
        </p>
      )}

      <form
        className={FELDREIHE}
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
          className={knopf("primaer")}
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

/** Höhenlage mit ihrem Bestätigungsstand - nie ohne ihn. */
function Hoehenlage({ geschoss, masse }: { geschoss: FloorOut; masse: Masse }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>{masse.anzeigen(geschoss.elevation_mm)}</span>
      <span data-testid={`hoehenlage-status-${geschoss.id}`}>
        {geschoss.elevation_confirmed ? (
          <Marke art="erfolg">Höhenlage bestätigt</Marke>
        ) : (
          <Marke art="warnung">nicht bestätigt</Marke>
        )}
      </span>
    </span>
  );
}

/** Formularwerte; die beiden Höhen stehen in Millimetern (Startwerte). */
const LEERES_GESCHOSS = {
  name: "",
  level: "0",
  elevation_mm: "0",
  default_ceiling_height_mm: "2500",
};
const HOEHENFELDER = ["elevation_mm", "default_ceiling_height_mm"] as const;

type Geschossanlage = {
  name: string;
  level: number;
  elevation_mm: number;
  elevation_confirmed: boolean;
  default_ceiling_height_mm: number;
};

function GebaeudeKarte({
  gebaeude,
  onLoeschen,
}: {
  gebaeude: BuildingOut;
  onLoeschen: () => void;
}) {
  const { api } = useAuth();
  const masse = useMasse();
  const queryClient = useQueryClient();
  const leer = () => eingabenAusMm(LEERES_GESCHOSS, HOEHENFELDER, masse.einheit);
  // Die Höhenfelder halten Text in der Anzeigeeinheit.
  const [formular, setFormular] = useState(leer);
  useEinheitenwechsel((von, nach) => setFormular((alt) => eingabenUmrechnen(alt, HOEHENFELDER, von, nach)));
  const [fehler, setFehler] = useState<string | null>(null);
  const [bestaetigt, setBestaetigt] = useState(false);
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);

  const melden = (error: unknown, standard: string) =>
    setFehler(error instanceof ApiError ? error.userMessage : standard);

  const geschosse = useQuery({
    queryKey: ["floors", gebaeude.id],
    queryFn: () =>
      api.get("/api/v1/buildings/{building_id}/floors", { path: { building_id: gebaeude.id } }),
  });

  const anlegen = useMutation({
    mutationFn: (body: Geschossanlage) =>
      api.post("/api/v1/buildings/{building_id}/floors", {
        path: { building_id: gebaeude.id },
        body,
      }),
    onSuccess: async () => {
      setFormular(leer());
      setBestaetigt(false);
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["floors", gebaeude.id] });
      await queryClient.invalidateQueries({ queryKey: ["project", gebaeude.project_id], exact: true });
    },
    onError: (error: unknown) => melden(error, "Anlegen fehlgeschlagen."),
  });

  const loeschenGeschoss = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.delete("/api/v1/floors/{floor_id}", { path: { floor_id: id }, ifMatch: version }),
    onSuccess: async () => {
      setFehler(null);
      await queryClient.invalidateQueries({ queryKey: ["floors", gebaeude.id] });
      await queryClient.invalidateQueries({ queryKey: ["project", gebaeude.project_id], exact: true });
    },
    onError: (error: unknown) => melden(error, "Löschen fehlgeschlagen."),
  });

  return (
    <section className={karte("eingerueckt")}>
      <div className={KARTENKOPF}>
        <h3 className="m-0">{gebaeude.name}</h3>
        <button className={knopf()} type="button" onClick={onLoeschen}>
          Gebäude löschen
        </button>
      </div>

      {fehler !== null && (
        <p className={meldungsflaeche()} role="alert">
          {fehler}
        </p>
      )}

      {geschosse.data && geschosse.data.length > 0 ? (
        <table className={TABELLE}>
          <thead>
            <tr>
              <th>Ebene</th>
              <th>Bezeichnung</th>
              <th>Höhenlage (FFB)</th>
              <th>Standardhöhe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {geschosse.data.map((geschoss) => (
              <tr key={geschoss.id}>
                <td>{geschoss.level}</td>
                <td>{geschoss.name}</td>
                <td>
                  {bearbeitet === geschoss.id ? (
                    <HoehenlageBearbeiten
                      geschoss={geschoss}
                      onFertig={() => setBearbeitet(null)}
                    />
                  ) : (
                    <Hoehenlage geschoss={geschoss} masse={masse} />
                  )}
                </td>
                <td>{masse.anzeigen(geschoss.default_ceiling_height_mm)}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    {bearbeitet !== geschoss.id && (
                      <button
                        className={knopf()}
                        type="button"
                        aria-label={`Höhenlage von ${geschoss.name} bearbeiten`}
                        onClick={() => setBearbeitet(geschoss.id)}
                      >
                        <MitSymbol icon={AKTION.bearbeiten}>Höhenlage</MitSymbol>
                      </button>
                    )}
                    <button
                      className={knopf()}
                      type="button"
                      onClick={() =>
                        loeschenGeschoss.mutate({ id: geschoss.id, version: geschoss.version })
                      }
                    >
                      <MitSymbol icon={AKTION.loeschen}>Entfernen</MitSymbol>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted">Noch kein Geschoss erfasst.</p>
      )}

      <form
        className={FELDREIHE}
        onSubmit={(event) => {
          event.preventDefault();
          if (anlegen.isPending) return;
          const hoehen = eingabenLesen(formular, HOEHENFELDER, masse.einheit);
          const erster = HOEHENFELDER.find((feld) => hoehen.fehler[feld] !== undefined);
          if (erster !== undefined) {
            const name = erster === "elevation_mm" ? "Höhenlage" : "Standardhöhe";
            setFehler(`${name}: ${hoehen.fehler[erster] ?? ""}`);
            return;
          }
          anlegen.mutate({
            name: formular.name.trim(),
            level: Number.parseInt(formular.level, 10),
            elevation_mm: hoehen.mm.elevation_mm ?? 0,
            elevation_confirmed: bestaetigt,
            default_ceiling_height_mm: hoehen.mm.default_ceiling_height_mm ?? 0,
          });
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
          label={masse.label("Höhenlage (FFB)")}
          inputMode="decimal"
          value={formular.elevation_mm}
          disabled={anlegen.isPending}
          onChange={(elevation_mm) => setFormular({ ...formular, elevation_mm })}
        />
        <Schalter
          id={`elevation-confirmed-${gebaeude.id}`}
          label="Höhenlage bestätigt"
          checked={bestaetigt}
          disabled={anlegen.isPending}
          onChange={setBestaetigt}
        />
        <Feld
          id={`height-${gebaeude.id}`}
          label={masse.label("Standardhöhe")}
          inputMode="decimal"
          value={formular.default_ceiling_height_mm}
          disabled={anlegen.isPending}
          onChange={(default_ceiling_height_mm) =>
            setFormular({ ...formular, default_ceiling_height_mm })
          }
        />
        <button
          className={knopf("primaer")}
          type="submit"
          disabled={anlegen.isPending || formular.name.trim().length === 0}
        >
          Geschoss hinzufügen
        </button>
      </form>
    </section>
  );
}

/**
 * Höhenlage eines Geschosses ändern oder ihre Bestätigung setzen bzw. zurücknehmen.
 *
 * Ändert sich der Wert, wird das Häkchen zurückgesetzt: Eine neue Höhenlage ist
 * nur bestätigt, wenn sie ausdrücklich neu bestätigt wird. Gesendet wird nur, was
 * sich geändert hat - mit ``If-Match`` der Geschossversion.
 */
function HoehenlageBearbeiten({ geschoss, onFertig }: { geschoss: FloorOut; onFertig: () => void }) {
  const { api } = useAuth();
  const masse = useMasse();
  const queryClient = useQueryClient();
  const [text, setText] = useState(() => masse.alsEingabe(geschoss.elevation_mm));
  useEinheitenwechsel((von, nach) =>
    setText((alt) => eingabenUmrechnen({ wert: alt }, ["wert"] as const, von, nach).wert),
  );
  const [bestaetigt, setBestaetigt] = useState(geschoss.elevation_confirmed);
  const [fehler, setFehler] = useState<string | null>(null);
  const gelesen = masse.lesen(text);
  const wertGeaendert = gelesen.ok && gelesen.mm !== geschoss.elevation_mm;

  const speichern = useMutation({
    mutationFn: (body: { elevation_mm?: number; elevation_confirmed: boolean }) =>
      api.patch("/api/v1/floors/{floor_id}", {
        path: { floor_id: geschoss.id },
        ifMatch: geschoss.version,
        body,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["floors", geschoss.building_id] });
      onFertig();
    },
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Speichern fehlgeschlagen."),
  });

  return (
    <form
      className="flex flex-col gap-2"
      aria-label={`Höhenlage von ${geschoss.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (speichern.isPending) return;
        if (!gelesen.ok) {
          setFehler(`Höhenlage: ${gelesen.fehler}`);
          return;
        }
        if (!wertGeaendert && bestaetigt === geschoss.elevation_confirmed) {
          onFertig();
          return;
        }
        speichern.mutate(
          wertGeaendert
            ? { elevation_mm: gelesen.mm, elevation_confirmed: bestaetigt }
            : { elevation_confirmed: bestaetigt },
        );
      }}
    >
      <Feld
        id={`elevation-edit-${geschoss.id}`}
        label={masse.label("Höhenlage (FFB)")}
        inputMode="decimal"
        value={text}
        disabled={speichern.isPending}
        onChange={(neu) => {
          setText(neu);
          const wert = masse.lesen(neu);
          // Ein neuer Wert ist erst bestätigt, wenn er ausdrücklich bestätigt wird.
          if (wert.ok && wert.mm !== geschoss.elevation_mm) setBestaetigt(false);
        }}
      />
      <Schalter
        id={`elevation-edit-confirmed-${geschoss.id}`}
        label={wertGeaendert ? "Neue Höhenlage bestätigen" : "Höhenlage bestätigt"}
        checked={bestaetigt}
        disabled={speichern.isPending}
        onChange={setBestaetigt}
      />
      {fehler !== null && (
        <p className={meldungsflaeche()} role="alert">
          {fehler}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={knopf("primaer")} type="submit" disabled={speichern.isPending}>
          Übernehmen
        </button>
        <button className={knopf()} type="button" disabled={speichern.isPending} onClick={onFertig}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
