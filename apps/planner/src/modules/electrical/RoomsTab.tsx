import { ApiError } from "@elektroplan/api-client";
import type { components } from "@elektroplan/api-client";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { alsFormularfehler } from "../../core/api/fehler";
import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { Auswahl } from "../../core/ui/Feld";
import { useMasse } from "../../core/ui/masseinheit";
import { useRueckfrage, verwerfenOptionen } from "../../core/ui/Rueckfrage";
import { KARTENKOPF, KARTENTITEL, KNOPFZEILE, STAPEL, TABELLE, karte, knopf, meldungsflaeche, reiter } from "../../core/ui/stil";
import { Ansicht3dLaden } from "./ansicht3d/Ansicht3dLaden";
import { GrundrissEditor } from "./editor/GrundrissEditor";
import { planSchluessel } from "./plan";
import { RaumDetail } from "./RaumDetail";
import { RaumDialog } from "./RaumDialog";
import type { Raumwerte } from "./RaumDialog";
import { KONTURZUSTAND_LABEL, flaecheAnzeigen } from "./texte";
import { AKTION } from "../../core/ui/aktionssymbole";
import { MitSymbol } from "../../core/ui/Symbol";

type Schemas = components["schemas"];
type RoomOut = Schemas["RoomOut"];
type FloorOut = Schemas["FloorOut"];

type Geschosswahl = {
  id: string;
  label: string;
  default_ceiling_height_mm: number;
};

type Ansicht = "editor" | "3d" | "tabelle";

const ANSICHTEN: readonly { wert: Ansicht; label: string }[] = [
  { wert: "editor", label: "2D-Editor" },
  { wert: "3d", label: "3D-Ansicht" },
  { wert: "tabelle", label: "Tabellen & Details" },
];

/** Zuletzt gewählte Ansicht - eine reine Bequemlichkeit je Browser. */
const ANSICHT_SCHLUESSEL = "elektroplan.electrical.ansicht";

/** Unbekannte oder alte Werte fallen sicher auf den 2D-Editor. */
function gemerkteAnsicht(): Ansicht {
  try {
    const wert = window.localStorage.getItem(ANSICHT_SCHLUESSEL);
    return ANSICHTEN.find((a) => a.wert === wert)?.wert ?? "editor";
  } catch {
    return "editor";
  }
}

function ansichtMerken(ansicht: Ansicht) {
  try {
    window.localStorage.setItem(ANSICHT_SCHLUESSEL, ansicht);
  } catch {
    // Ohne Speicher gilt beim nächsten Mal wieder der Editor - kein Fehler.
  }
}

const EDITOR_MELDUNG =
  "Im Grundrisseditor gibt es ungespeicherte Änderungen. Wenn Sie fortfahren, gehen sie verloren.";

/**
 * Projekt-Tab „Räume & Grundriss" (Phase 3).
 *
 * Der Tab wird über den Beitragspunkt `project.tabs` registriert
 * (`src/modules/electrical/index.ts`); die zentrale Projektseite kennt dieses
 * Modul nicht (docs/modules.md, Abschnitt 6). Die Projekt-ID kommt aus der
 * Route, in der der Tab gerendert wird.
 *
 * Drei Ansichten auf **denselben** Serverstand:
 *
 * * „2D-Editor" (Phase 4a) - die einzige grafische Autorenfläche.
 * * „3D-Ansicht" (Phase 4b, ADR 0016) - abgeleitet und schreibgeschützt;
 *   liest denselben Plan-Eintrag wie der Editor und wird lazy geladen.
 * * „Tabellen & Details" - die formularbasierte Erfassung aus Phase 3. Sie
 *   bleibt präzise Alternative, barriereärmerer Weg und Diagnosehilfe.
 *
 * Alle lesen über React Query vom Server; nach jedem Schreibvorgang werden
 * die anderen Ansichten neu geladen. Einen zweiten, unabhängigen Datenstand
 * gibt es nicht.
 */
export default function RoomsTab() {
  const { projectId = "" } = useParams();
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const darfSchreibenGrundsaetzlich = usePermission("electrical.plan.write");
  const masse = useMasse();
  const fragen = useRueckfrage();

  const [geschossId, setGeschossId] = useState<string>("");
  const [raumdialog, setRaumdialog] = useState<{ raum: RoomOut | null } | null>(null);
  const [offenerRaum, setOffenerRaum] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<Ansicht>(gemerkteAnsicht);
  // Ungespeicherte Änderungen im Editor - für Geschoss- und Ansichtswechsel.
  const editorOffen = useRef(false);
  const ungespeichertMelden = useCallback((offen: boolean) => {
    editorOffen.current = offen;
  }, []);

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
    // Die grafische Ansicht liest denselben Stand über den Plan-Endpunkt.
    await queryClient.invalidateQueries({ queryKey: planSchluessel(aktivesGeschoss?.id ?? "") });
  };

  /** Nach dem Speichern im Editor: Tabellen und Details ziehen nach. */
  const nachEditorSpeichern = useCallback(
    async (roomId: string | null) => {
      await queryClient.invalidateQueries({ queryKey: ["electrical", "rooms", aktivesGeschoss?.id] });
      if (roomId !== null) {
        await queryClient.invalidateQueries({ queryKey: ["electrical", "walls", roomId] });
        await queryClient.invalidateQueries({ queryKey: ["electrical", "contour", roomId] });
      }
      await queryClient.invalidateQueries({ queryKey: ["electrical", "openings"] });
    },
    [queryClient, aktivesGeschoss?.id],
  );

  /**
   * Vor dem Entladen des Editors: ungespeicherte Änderungen nie still
   * verwerfen, sondern über die eigene Rückfrage (`Rueckfrage.tsx`).
   */
  const editorVerlassen = async (titel: string, situation: string): Promise<boolean> => {
    if (!editorOffen.current) return true;
    const antwort = await fragen(verwerfenOptionen(titel, situation, EDITOR_MELDUNG));
    if (antwort !== "bestaetigt") return false;
    editorOffen.current = false;
    return true;
  };

  const ansichtWechseln = async (neu: Ansicht) => {
    if (neu === ansicht) return;
    const ziel = ANSICHTEN.find((a) => a.wert === neu)?.label ?? neu;
    if (ansicht === "editor" && !(await editorVerlassen("Ansicht wechseln?", `Sie wollen zur Ansicht „${ziel}“ wechseln.`))) {
      return;
    }
    ansichtMerken(neu);
    setAnsicht(neu);
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
    return <p className="text-muted">Grundriss wird geladen ...</p>;
  }
  if (projekt.isError || gebaeude.isError) {
    return (
      <p className={meldungsflaeche()} role="alert">
        Die Gebäudestruktur dieses Projekts konnte nicht geladen werden.
      </p>
    );
  }

  if (auswahl.length === 0) {
    return (
      <section className={karte()}>
        <h2>Räume &amp; Grundriss</h2>
        <p className="text-muted">
          Für dieses Projekt ist noch kein Geschoss angelegt. Räume hängen an einem
          Geschoss — bitte zuerst im Tab „Gebäude &amp; Geschosse" eines anlegen.
        </p>
      </section>
    );
  }

  const liste: RoomOut[] = raeume.data ?? [];
  const geoeffnet = liste.find((raum) => raum.id === offenerRaum) ?? null;

  return (
    <div className={STAPEL}>
      <section className={karte()}>
        <div className={KARTENKOPF}>
          <h2 className={KARTENTITEL}>Räume &amp; Grundriss</h2>
          {darfSchreiben && ansicht === "tabelle" && (
            <button
              className={knopf("primaer")}
              type="button"
              onClick={() => setRaumdialog({ raum: null })}
            >
              Raum anlegen
            </button>
          )}
        </div>

        {archiviert && (
          <p className={meldungsflaeche("schlicht")}>
            Dieses Projekt ist archiviert und damit <strong>schreibgeschützt</strong>.
            Räume, Wände und Öffnungen lassen sich ansehen, aber nicht mehr ändern.
          </p>
        )}

        <Auswahl
          id="electrical-geschoss"
          label="Geschoss"
          value={aktivesGeschoss?.id ?? ""}
          onChange={(id) => {
            const ziel = auswahl.find((eintrag) => eintrag.id === id)?.label ?? "";
            void editorVerlassen("Geschoss wechseln?", `Sie wollen zum Geschoss „${ziel}“ wechseln.`).then((weiter) => {
              if (!weiter) return;
              setGeschossId(id);
              setOffenerRaum(null);
            });
          }}
        >
          {auswahl.map((eintrag) => (
            <option key={eintrag.id} value={eintrag.id}>
              {eintrag.label}
            </option>
          ))}
        </Auswahl>

        <div className="my-2 flex gap-1 border-b border-line" role="group" aria-label="Ansicht">
          {ANSICHTEN.map(({ wert, label }) => (
            <button
              key={wert}
              type="button"
              className={reiter(ansicht === wert)}
              aria-pressed={ansicht === wert}
              onClick={() => void ansichtWechseln(wert)}
            >
              {label}
            </button>
          ))}
        </div>

        {fehler !== null && (
          <p className={meldungsflaeche()} role="alert">
            {fehler}
          </p>
        )}

        {ansicht !== "tabelle" ? null : raeume.isPending ? (
          <p className="text-muted">Räume werden geladen ...</p>
        ) : raeume.isError ? (
          <p className={meldungsflaeche()} role="alert">
            Die Räume dieses Geschosses konnten nicht geladen werden.
          </p>
        ) : liste.length === 0 ? (
          <p className="text-muted">
            Auf diesem Geschoss ist noch kein Raum erfasst.
            {darfSchreiben ? " Mit „Raum anlegen“ geht es los." : ""}
          </p>
        ) : (
          <table className={TABELLE}>
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Bezeichnung</th>
                <th>Höhe</th>
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
                  <td>{masse.anzeigen(raum.effective_height_mm)}</td>
                  <td>{KONTURZUSTAND_LABEL[raum.contour_status]}</td>
                  <td>{raum.wall_count}</td>
                  <td>{flaecheAnzeigen(raum.area_m2)}</td>
                  <td>
                    <div className={KNOPFZEILE}>
                      <button
                        className={knopf()}
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
                            className={knopf()}
                            type="button"
                            aria-label={`Raum ${raum.name} bearbeiten`}
                            onClick={() => setRaumdialog({ raum })}
                          >
                            <MitSymbol icon={AKTION.bearbeiten}>Bearbeiten</MitSymbol>
                          </button>
                          <button
                            className={knopf()}
                            type="button"
                            aria-label={`Raum ${raum.name} entfernen`}
                            disabled={raumLoeschen.isPending}
                            onClick={() => raumLoeschen.mutate(raum)}
                          >
                            <MitSymbol icon={AKTION.loeschen}>Entfernen</MitSymbol>
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

      {ansicht === "editor" && aktivesGeschoss !== undefined && (
        <section className={karte("kompakt")}>
          <GrundrissEditor
            key={aktivesGeschoss.id}
            floorId={aktivesGeschoss.id}
            geschossLabel={aktivesGeschoss.label}
            standardhoehe_mm={aktivesGeschoss.default_ceiling_height_mm}
            darfSchreiben={darfSchreiben}
            onUngespeichert={ungespeichertMelden}
            onGespeichert={nachEditorSpeichern}
          />
        </section>
      )}

      {ansicht === "3d" && aktivesGeschoss !== undefined && (
        <section className={karte("kompakt")}>
          <Ansicht3dLaden
            floorId={aktivesGeschoss.id}
            geschossLabel={aktivesGeschoss.label}
            onAnsicht={(ziel) => void ansichtWechseln(ziel)}
          />
        </section>
      )}

      {ansicht === "tabelle" && geoeffnet !== null && (
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
