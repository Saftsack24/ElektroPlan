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
import { KARTENKOPF, KARTENTITEL, KNOPFZEILE, STAPEL, TABELLE, eingabefeld, karte, knopf, meldungsflaeche, reiter } from "../../core/ui/stil";
import { Ansicht3dLaden } from "./ansicht3d/Ansicht3dLaden";
import { GrundrissEditor } from "./editor/GrundrissEditor";
import type { Rueckkehr3d } from "./ansicht3d/Ansicht3d";
import type { Wandziel } from "./wandansicht/Wandansicht";
import type { Deckenziel } from "./editor/GrundrissEditor";
import { planAbfrage, planSchluessel } from "./plan";
import { RaumDetail } from "./RaumDetail";
import { RaumDialog } from "./RaumDialog";
import { Steigwege } from "./steigweg/Steigwege";
import { STEIGWEG_MELDUNG } from "./steigweg/texte";
import { Stromkreise } from "./stromkreise/Stromkreise";
import {
  kreisBezeichnung,
  stromkreiseAbfrage,
  stromkreiseSchluessel,
  verteilungenAbfrage,
  zuordnungNachGeraet,
} from "./stromkreise/daten";
import { geraetName, katalogAbfrage, typenNachSchluessel } from "./geraete/katalog";
import { ZUORDNUNG_MELDUNG } from "./stromkreise/texte";
import type { Verteilungsplatzierung } from "./stromkreise/platzierung";
import { BestaetigungAbgelehnt, bestaetigungsfeld, useLeitungsbestaetigung } from "./leitung/bestaetigung";
import { leitungenSchluessel } from "./leitung/daten";
import { LEITUNG_MELDUNG, LeitungsplanungProvider } from "./leitung/LeitungsplanungProvider";
import { Mengenuebersicht } from "./mengen/Mengenuebersicht";
import { VorgabenDialog } from "./vorgaben/VorgabenDialog";
import type { Leitungsplanung } from "./leitung/useLeitungsplanung";
import type { Raumwerte } from "./RaumDialog";
import { KONTURZUSTAND_LABEL, RAUMTYP_LABEL, flaecheAnzeigen, raumtypAusWert } from "./texte";
import { AKTION } from "../../core/ui/aktionssymbole";
import { MitSymbol } from "../../core/ui/Symbol";
import { useKompakt } from "./arbeitsflaeche/kompakt";
import { useArbeitsflaeche } from "./arbeitsflaeche/Planungsarbeitsflaeche";
import { useArbeitsbereich } from "../../core/ui/arbeitsbereich";

type Schemas = components["schemas"];
type RoomOut = Schemas["RoomOut"];
type FloorOut = Schemas["FloorOut"];

type Geschosswahl = {
  id: string;
  label: string;
  name: string;
  building_id: string;
  building_name: string;
  default_ceiling_height_mm: number;
};

type Ansicht = "editor" | "3d" | "tabelle" | "steigwege" | "stromkreise" | "mengen";

const ANSICHTEN: readonly { wert: Ansicht; label: string }[] = [
  { wert: "editor", label: "2D-Editor" },
  { wert: "3d", label: "3D-Ansicht" },
  { wert: "tabelle", label: "Tabellen & Details" },
  { wert: "steigwege", label: "Steigwege" },
  { wert: "stromkreise", label: "Stromkreise" },
  { wert: "mengen", label: "Mengen" },
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

/** Ansichten mit eigenem, ungespeichertem Entwurf (2D-Editor, Steigwege, Gerätezuordnung). */
function hatEntwurf(ansicht: Ansicht): boolean {
  return ansicht === "editor" || ansicht === "steigwege" || ansicht === "stromkreise";
}

/** Gebäudebezogene Ansichten: Ein Geschosswechsel im selben Gebäude behält ihren Entwurf. */
function gebaeudebezogen(ansicht: Ansicht): boolean {
  return ansicht === "steigwege" || ansicht === "stromkreise" || ansicht === "mengen";
}

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
 * * „Steigwege" (Phase 6a.5, ADR 0025) - Steigwege des Gebäudes, zu dem das
 *   gewählte Geschoss gehört. Eigener Entwurf, getrennt vom Raumentwurf.
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
  // Verteilungen, Stromkreise und Zuordnung (Phase 6b.1) - eigenes Recht.
  const darfStromkreiseGrundsaetzlich = usePermission("electrical.circuit.write");
  // Leitungen, Wegpunkte, Kabelangaben und Durchführungen (Phase 6b.4) - eigenes Recht.
  const darfLeitungenGrundsaetzlich = usePermission("electrical.route.write");
  const mitBestaetigung = useLeitungsbestaetigung();
  const masse = useMasse();
  const fragen = useRueckfrage();

  const [geschossId, setGeschossId] = useState<string>("");
  const [raumdialog, setRaumdialog] = useState<{ raum: RoomOut | null } | null>(null);
  const [offenerRaum, setOffenerRaum] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<Ansicht>(gemerkteAnsicht);
  // Panel und Maximierung des Grundrisses (6c.0) - übersteht Geschoss- und Ansichtswechsel.
  const grundrissArbeitsflaeche = useArbeitsflaeche();
  // Grafische Planung (2D-Editor, 3D): die ganze Projektseite in der breiten Flucht (6c, L1).
  const planungsansicht = ansicht === "editor" || ansicht === "3d";
  const kompakt = useKompakt();
  useArbeitsbereich(planungsansicht);
  // Aus der 3D-Auswahl angeforderte Wandansicht (Phase 4f) - der 2D-Editor öffnet sie nach dem
  // Laden. Kamera und Auswahl der 3D-Ansicht werden für die Rückkehr gemerkt (reine Ansicht).
  const [startWandansicht, setStartWandansicht] = useState<Wandziel | null>(null);
  const [startDeckenansicht, setStartDeckenansicht] = useState<Deckenziel | null>(null);
  const [rueckkehr3d, setRueckkehr3d] = useState<Rueckkehr3d | null>(null);
  // Aus 3D eine Leitung im Grundriss bearbeiten (6b.5): Rückweg mit Kamera anbieten.
  const [leitungAus3d, setLeitungAus3d] = useState(false);
  // Mengenübersicht (6b.6): aufgeklappte Gruppen und Rückweg aus der Bearbeitung.
  const [mengenOffen, setMengenOffen] = useState<readonly string[]>([]);
  // Phase 6c (L3): Planungsvorgaben des Projekts im Dialog.
  const [projektvorgaben, setProjektvorgaben] = useState(false);
  const [leitungAusMengen, setLeitungAusMengen] = useState(false);
  // Phase 6c (VP): laufende Platzierung einer Verteilung und Rückmeldung danach in „Stromkreise“.
  const [verteilungPlatzierung, setVerteilungPlatzierung] = useState<Verteilungsplatzierung | null>(null);
  const [platzierungsmeldung, setPlatzierungsmeldung] = useState<string | null>(null);
  // Woher die Steigwegverwaltung geöffnet wurde - für „Zurück zu …".
  const [vorherigeAnsicht, setVorherigeAnsicht] = useState<Ansicht | null>(null);
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
      name: geschoss.name,
      building_id: haus.id,
      building_name: haus.name,
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

  // Archivierte und - seit Phase 4f - abgeschlossene Projekte sind serverseitig
  // schreibgeschützt (ADR 0020, Erweiterung 4f). Die Regel steht im Core; die
  // Oberfläche spiegelt sie nur (``409 project-archived`` / ``project-completed``).
  const projektstatus = projekt.data?.status;
  const archiviert = projektstatus === "archived" || projektstatus === "completed";
  const darfSchreiben = darfSchreibenGrundsaetzlich && !archiviert;

  /**
   * Nach Schreibvorgängen in Steigwegen und Stromkreisen vermerkt der Server Bearbeiter und
   * Zeitpunkt am Projekt - gezielt nur diese Projektabfrage im Sitzungs-Cache nachladen.
   */
  const projektAktualisieren = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["project", projectId], exact: true });
  }, [queryClient, projectId]);

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
    const meldung =
      ansicht === "steigwege" ? STEIGWEG_MELDUNG : ansicht === "stromkreise" ? ZUORDNUNG_MELDUNG : EDITOR_MELDUNG;
    const antwort = await fragen(verwerfenOptionen(titel, situation, meldung));
    if (antwort !== "bestaetigt") return false;
    editorOffen.current = false;
    return true;
  };

  /**
   * Leitungsentwurf (6b.5): Er gehört zum Gebäude und übersteht Geschoss-, Grundriss- und
   * 3D-Wechsel. Verlassen wird er nur mit einem anderen Gebäude oder mit Ansichten, die einen
   * eigenen Entwurf führen (Steigwege, Stromkreise) - dann ausdrücklich, nie still.
   */
  const leitungOffen = useRef(false);
  const planungRef = useRef<Leitungsplanung | null>(null);
  const leitungUngespeichertMelden = useCallback((offen: boolean) => {
    leitungOffen.current = offen;
  }, []);
  const planungMerken = useCallback((p: Leitungsplanung) => {
    planungRef.current = p;
  }, []);
  const leitungVerlassen = async (titel: string, situation: string): Promise<boolean> => {
    if (leitungOffen.current) {
      const antwort = await fragen(verwerfenOptionen(titel, situation, LEITUNG_MELDUNG));
      if (antwort !== "bestaetigt") return false;
      leitungOffen.current = false;
    }
    planungRef.current?.schliessen();
    return true;
  };

  /** `true`, wenn die Ansicht gewechselt wurde (sonst blieb sie nach einer Rückfrage). */
  const ansichtWechseln = async (neu: Ansicht, optionen: { rueckkehr?: boolean } = {}): Promise<boolean> => {
    if (neu === ansicht) return true;
    const ziel = ANSICHTEN.find((a) => a.wert === neu)?.label ?? neu;
    if (hatEntwurf(ansicht) && !(await editorVerlassen("Ansicht wechseln?", `Sie wollen zur Ansicht „${ziel}“ wechseln.`))) {
      return false;
    }
    // Höchstens ein aktiver Entwurf: Steigwege und Stromkreise führen ihren eigenen.
    if ((neu === "steigwege" || neu === "stromkreise") && !(await leitungVerlassen("Ansicht wechseln?", `Sie wollen zur Ansicht „${ziel}“ wechseln.`))) {
      return false;
    }
    // Eine Platzierung der Verteilung (6c, VP) gilt nur im Editor; sonst ist sie beendet, nichts gespeichert.
    if (neu !== "editor") setVerteilungPlatzierung(null);
    if (neu !== "stromkreise") setPlatzierungsmeldung(null);
    if (neu === "steigwege") setVorherigeAnsicht(ansicht);
    // Ein gewöhnlicher Ansichtswechsel vergisst den gemerkten 3D-Stand; nur der
    // Weg Wandansicht hin und zurück stellt ihn wieder her.
    if (optionen.rueckkehr !== true) setRueckkehr3d(null);
    if (neu !== "editor") {
      setLeitungAus3d(false);
      setLeitungAusMengen(false);
    }
    ansichtMerken(neu);
    setAnsicht(neu);
    return true;
  };

  /** „Im Plan platzieren“ / „Position ändern“ (6c, VP): Grundriss des Geschosses mit Wandwahl. */
  const verteilungPlatzieren = async (p: Verteilungsplatzierung) => {
    setPlatzierungsmeldung(null);
    if (!(await ansichtWechseln("editor"))) return;
    setGeschossId(p.floorId);
    setVerteilungPlatzierung(p);
  };

  /** „Im Plan zeigen“: Wandansicht mit gewähltem Lagegerät; Schließen führt zurück zu „Stromkreise“. */
  const imPlanZeigen = async (ziel: { floorId: string; raumId: string; wandId: string; geraetId: string }) => {
    if (!(await ansichtWechseln("editor"))) return;
    setGeschossId(ziel.floorId);
    setStartWandansicht({ raumId: ziel.raumId, wandId: ziel.wandId, geraetId: ziel.geraetId, seite: "innen", herkunft: "stromkreise" });
  };

  /**
   * Geschosswechsel: Raumentwurf und Zuordnung gehören zum Geschoss (Rückfrage), ein
   * Leitungsentwurf zum Gebäude - er bleibt im selben Gebäude erhalten (6b.5).
   */
  const geschossWechseln = async (id: string, gleichesGebaeude: boolean, ziel: string): Promise<boolean> => {
    if (!(await editorVerlassen("Geschoss wechseln?", `Sie wollen zum Geschoss „${ziel}“ wechseln.`))) return false;
    if (!gleichesGebaeude && !(await leitungVerlassen("Gebäude wechseln?", `Sie wollen zum Geschoss „${ziel}“ eines anderen Gebäudes wechseln.`))) {
      return false;
    }
    setGeschossId(id);
    setOffenerRaum(null);
    return true;
  };

  const raumSpeichern = async (werte: Raumwerte) => {
    const hoehe = werte.height_mm.trim();
    const koerper = {
      name: werte.name.trim(),
      room_number: werte.room_number.trim() === "" ? null : werte.room_number.trim(),
      height_mm: hoehe === "" ? null : Number.parseInt(hoehe, 10),
      room_type: raumtypAusWert(werte.room_type),
    };
    try {
      const bestehend = raumdialog?.raum ?? null;
      if (bestehend === null) {
        await api.post("/api/v1/modules/electrical/floors/{floor_id}/rooms", {
          path: { floor_id: aktivesGeschoss?.id ?? "" },
          body: koerper,
        });
      } else {
        // Eine neue Raumhöhe kann Leitungen unterbrechen: genau diese bestätigen (6b.4).
        await mitBestaetigung((bestaetigt) =>
          api.patch("/api/v1/modules/electrical/rooms/{room_id}", {
            path: { room_id: bestehend.id },
            ifMatch: bestehend.version,
            body: { ...koerper, ...bestaetigungsfeld(bestaetigt) },
          }),
        );
      }
      setRaumdialog(null);
      await raeumeNeuLaden();
      if (aktivesGeschoss !== undefined) await queryClient.invalidateQueries({ queryKey: leitungenSchluessel(aktivesGeschoss.building_id) });
      return undefined;
    } catch (error: unknown) {
      if (error instanceof BestaetigungAbgelehnt) return { fehler: "Nicht gespeichert – die Leitungen bleiben unverändert." };
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
      const haus = auswahl.find((e) => e.id === raum.floor_id)?.building_id;
      if (haus !== undefined) await queryClient.invalidateQueries({ queryKey: stromkreiseSchluessel(haus) });
    },
    onError: (error: unknown) =>
      setFehler(
        error instanceof ApiError ? error.userMessage : "Der Raum konnte nicht entfernt werden.",
      ),
  });

  /**
   * Raum entfernen. Ist er über Wandzuordnungen mit Nachbarräumen verbunden
   * (Phase 6a), nennt eine Rückfrage deren Anzahl - sie verschwinden mit ihm.
   */
  const raumEntfernen = async (raum: RoomOut) => {
    let anzahl = 0;
    let zugeordnet: { geraet: string; kreis: string }[] = [];
    try {
      const plan = await queryClient.fetchQuery(planAbfrage(api, raum.floor_id));
      const eintrag = plan.rooms.find((r) => r.id === raum.id);
      const waende = new Set(eintrag?.walls.map((w) => w.id) ?? []);
      anzahl = (plan.wall_links ?? []).filter((k) => waende.has(k.wall_a_id) || waende.has(k.wall_b_id)).length;
      // Phase 6b.1: Geräte des Raums, die einem Stromkreis zugeordnet sind, verlieren die Zuordnung.
      const haus = auswahl.find((e) => e.id === raum.floor_id)?.building_id;
      if (haus !== undefined && eintrag !== undefined && eintrag.devices.length > 0) {
        const kreise = await queryClient.fetchQuery(stromkreiseAbfrage(api, haus));
        const boards = await queryClient.fetchQuery(verteilungenAbfrage(api, haus));
        const zuordnung = zuordnungNachGeraet(kreise.circuits);
        const typen = typenNachSchluessel(await queryClient.fetchQuery(katalogAbfrage(api)));
        zugeordnet = eintrag.devices.flatMap((g) => {
          const kreis = zuordnung.get(g.id);
          return kreis === undefined
            ? []
            : [{ geraet: geraetName(typen.get(g.device_type_key), g.label, g.device_type_key), kreis: kreisBezeichnung(kreis, boards.boards) }];
        });
      }
    } catch {
      // Ohne Planungsstand keine Zusatzfrage; der Server entscheidet ohnehin.
    }
    if (anzahl > 0 || zugeordnet.length > 0) {
      const antwort = await fragen({
        titel: anzahl > 0 ? "Raum mit Wandzuordnungen entfernen?" : "Raum mit zugeordneten Geräten entfernen?",
        text: (
          <>
            {anzahl > 0 && (
              <p>
                Der Raum „{raum.name}“ ist über {anzahl === 1 ? "eine Wandzuordnung" : `${anzahl} Wandzuordnungen`} mit
                Nachbarräumen verbunden (gemeinsame Bauwand oder getrennte Wände). Sie werden mit dem Raum entfernt; die
                Nachbarräume selbst bleiben unverändert.
              </p>
            )}
            {zugeordnet.length > 0 && (
              <>
                <p>
                  Geräte dieses Raums sind Stromkreisen zugeordnet. Mit dem Raum geht diese Zuordnung verloren; die
                  Stromkreise bleiben.
                </p>
                <ul>
                  {zugeordnet.map((z, i) => (
                    <li key={i}>
                      {z.geraet} – Stromkreis {z.kreis}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ),
        bestaetigenLabel: "Raum entfernen",
        abbrechenLabel: "Abbrechen",
        gefaehrlich: true,
      });
      if (antwort !== "bestaetigt") return;
    }
    raumLoeschen.mutate(raum);
  };

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

  const geschossWaehlen = (id: string) => {
    const zielEintrag = auswahl.find((eintrag) => eintrag.id === id);
    const ziel = zielEintrag?.label ?? "";
    // In der Steigwegverwaltung bleibt der Entwurf beim Wechsel innerhalb
    // desselben Gebäudes erhalten - nur das Grundrissgeschoss wechselt.
    const gleichesGebaeude = zielEintrag?.building_id === aktivesGeschoss?.building_id;
    if (gebaeudebezogen(ansicht) && gleichesGebaeude) {
      setGeschossId(id);
      return;
    }
    void geschossWechseln(id, gleichesGebaeude, ziel);
  };

  return (
    <div className={planungsansicht ? "flex flex-col gap-2" : STAPEL}>
      <section className={planungsansicht ? "flex flex-col gap-1" : karte()} aria-label="Räume und Grundriss">
        <div className={planungsansicht ? "sr-only" : KARTENKOPF}>
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
            Dieses Projekt ist {projektstatus === "completed" ? "abgeschlossen" : "archiviert"} und damit{" "}
            <strong>schreibgeschützt</strong>. Räume, Wände und Öffnungen lassen sich ansehen, aber
            nicht mehr ändern.
          </p>
        )}

        {planungsansicht ? (
          // Eine Zeile: Geschoss und Ansicht – platzsparend über der Arbeitsfläche.
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex items-center gap-2 text-small" htmlFor="electrical-geschoss">
              {/* Schmal sprechen Geschoss- und Ansichtsnamen für sich; die Beschriftung bleibt für Screenreader. */}
              <span className={kompakt ? "sr-only" : "text-muted"}>Geschoss</span>
              <select
                id="electrical-geschoss"
                className={eingabefeld({ kompakt: true })}
                value={aktivesGeschoss?.id ?? ""}
                onChange={(event) => geschossWaehlen(event.target.value)}
              >
                {auswahl.map((eintrag) => (
                  <option key={eintrag.id} value={eintrag.id}>
                    {eintrag.label}
                  </option>
                ))}
              </select>
            </label>
            {kompakt ? (
              // Schmal eine Auswahl statt sechs umbrechender Reiter (Entwurf §18.2).
              <label className="flex items-center gap-2 text-small" htmlFor="electrical-ansicht">
                <span className="sr-only">Ansicht</span>
                <select
                  id="electrical-ansicht"
                  className={eingabefeld({ kompakt: true })}
                  value={ansicht}
                  onChange={(event) => void ansichtWechseln(event.target.value as Ansicht)}
                >
                  {ANSICHTEN.map(({ wert, label }) => (
                    <option key={wert} value={wert}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="flex flex-wrap gap-1" role="group" aria-label="Ansicht">
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
            )}
            <button type="button" className={`${knopf("neutral", { klein: true })} ml-auto`} onClick={() => setProjektvorgaben(true)} data-testid="projektvorgaben-oeffnen">
              {kompakt ? "Vorgaben" : "Planungsvorgaben"}
            </button>
          </div>
        ) : (
          <>
        <Auswahl
          id="electrical-geschoss"
          label="Geschoss"
          value={aktivesGeschoss?.id ?? ""}
          onChange={geschossWaehlen}
        >
          {auswahl.map((eintrag) => (
            <option key={eintrag.id} value={eintrag.id}>
              {eintrag.label}
            </option>
          ))}
        </Auswahl>

        <div className="my-2 flex flex-wrap gap-1 border-b border-line" role="group" aria-label="Ansicht">
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

          </>
        )}

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
                <th>Raumtyp</th>
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
                  <td>{raum.room_type === null ? "—" : RAUMTYP_LABEL[raum.room_type]}</td>
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
                            onClick={() => void raumEntfernen(raum)}
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

      {projektvorgaben && (
        <VorgabenDialog
          modus="projekt"
          projektId={projectId}
          darfSchreiben={darfLeitungenGrundsaetzlich && !archiviert}
          sperrgrund={
            archiviert
              ? `Das Projekt ist ${projektstatus === "completed" ? "abgeschlossen" : "archiviert"} – die Projektvorgaben sind nur lesbar.`
              : !darfLeitungenGrundsaetzlich
                ? "Nur Ansicht – Projektvorgaben ändern darf, wer Leitungen bearbeiten darf."
                : null
          }
          onClose={() => setProjektvorgaben(false)}
        />
      )}
      <LeitungsplanungProvider
        key={aktivesGeschoss?.building_id ?? "ohne"}
        projectId={projectId}
        buildingId={aktivesGeschoss?.building_id}
        darfLeitungen={darfLeitungenGrundsaetzlich && !archiviert}
        darfStromkreise={darfStromkreiseGrundsaetzlich && !archiviert}
        onGeschrieben={projektAktualisieren}
        onUngespeichert={leitungUngespeichertMelden}
        onPlanung={planungMerken}
      >
      {ansicht === "editor" && aktivesGeschoss !== undefined && (
        // Die ganze Seite steht im Arbeitsbereich (6c, L1); die Arbeitsfläche hat keine eigene Karte.
        <section aria-label="Grafische Planung">
          <GrundrissEditor
            key={`${aktivesGeschoss.id}|${verteilungPlatzierung?.boardId ?? ""}`}
            arbeitsflaeche={grundrissArbeitsflaeche}
            floorId={aktivesGeschoss.id}
            buildingId={aktivesGeschoss.building_id}
            geschossLabel={aktivesGeschoss.label}
            standardhoehe_mm={aktivesGeschoss.default_ceiling_height_mm}
            darfSchreiben={darfSchreiben}
            onUngespeichert={ungespeichertMelden}
            onGespeichert={nachEditorSpeichern}
            startWandansicht={startWandansicht}
            startDeckenansicht={startDeckenansicht}
            onStartVerbraucht={() => {
              setStartWandansicht(null);
              setStartDeckenansicht(null);
            }}
            onZurueck3d={() => void ansichtWechseln("3d", { rueckkehr: true })}
            rueckkehr3dAnbieten={leitungAus3d && rueckkehr3d !== null}
            onZurueckZuMengen={leitungAusMengen ? () => void ansichtWechseln("mengen") : undefined}
            darfLeitungen={darfLeitungenGrundsaetzlich && !archiviert}
            darfStromkreise={darfStromkreiseGrundsaetzlich && !archiviert}
            onGeschrieben={projektAktualisieren}
            onGeschossWechseln={(id) => {
              const zielEintrag = auswahl.find((eintrag) => eintrag.id === id);
              void geschossWechseln(id, zielEintrag?.building_id === aktivesGeschoss.building_id, zielEintrag?.label ?? "");
            }}
            verteilung={verteilungPlatzierung?.floorId === aktivesGeschoss.id ? verteilungPlatzierung : null}
            onVerteilungEnde={(meldung) => {
              setVerteilungPlatzierung(null);
              void ansichtWechseln("stromkreise").then((gewechselt) => {
                if (gewechselt) setPlatzierungsmeldung(meldung);
              });
            }}
            onZurueckStromkreise={() => void ansichtWechseln("stromkreise")}
          />
        </section>
      )}

      {ansicht === "3d" && aktivesGeschoss !== undefined && (
        <section className={karte("kompakt")}>
          <Ansicht3dLaden
            floorId={aktivesGeschoss.id}
            geschossLabel={aktivesGeschoss.label}
            onAnsicht={(ziel) => void ansichtWechseln(ziel)}
            anfang={rueckkehr3d}
            onWandansicht={(ziel, rueckkehr) => {
              // Die 3D-Ansicht hat keinen Entwurf - der Wechsel zum Editor fragt nichts.
              setRueckkehr3d(rueckkehr);
              setStartWandansicht({ ...ziel, herkunft: "3d" });
              void ansichtWechseln("editor", { rueckkehr: true });
            }}
            onDeckenansicht={(ziel, rueckkehr) => {
              setRueckkehr3d(rueckkehr);
              setStartDeckenansicht({ ...ziel, herkunft: "3d" });
              void ansichtWechseln("editor", { rueckkehr: true });
            }}
            onLeitungBearbeiten={(ziel, rueckkehr) => {
              // Der Leitungsentwurf ist bereits offen (Provider des Gebäudes) - hier nur die Fläche.
              setRueckkehr3d(rueckkehr);
              if (ziel.art === "wand") setStartWandansicht({ raumId: ziel.raumId, wandId: ziel.wandId, seite: "innen", herkunft: "3d" });
              else if (ziel.art === "decke") setStartDeckenansicht({ raumId: ziel.raumId, herkunft: "3d" });
              setLeitungAus3d(ziel.art === "grundriss");
              void ansichtWechseln("editor", { rueckkehr: true });
            }}
          />
        </section>
      )}

      {ansicht === "steigwege" && aktivesGeschoss !== undefined && (
        <section className={karte("kompakt")}>
          <Steigwege
            key={aktivesGeschoss.building_id}
            buildingId={aktivesGeschoss.building_id}
            buildingName={aktivesGeschoss.building_name}
            aktivesGeschossId={aktivesGeschoss.id}
            onGeschoss={setGeschossId}
            darfSchreiben={darfSchreiben}
            onUngespeichert={ungespeichertMelden}
            onGeschrieben={projektAktualisieren}
            zurueck={
              vorherigeAnsicht === null || vorherigeAnsicht === "steigwege"
                ? undefined
                : {
                    label: `Zurück zu „${ANSICHTEN.find((a) => a.wert === vorherigeAnsicht)?.label ?? ""}“`,
                    onClick: () => void ansichtWechseln(vorherigeAnsicht),
                  }
            }
          />
        </section>
      )}

      {ansicht === "stromkreise" && aktivesGeschoss !== undefined && (
        <section className={karte("kompakt")}>
          <Stromkreise
            key={aktivesGeschoss.building_id}
            buildingId={aktivesGeschoss.building_id}
            buildingName={aktivesGeschoss.building_name}
            aktivesGeschossId={aktivesGeschoss.id}
            onGeschoss={setGeschossId}
            darfSchreiben={darfStromkreiseGrundsaetzlich && !archiviert}
            onUngespeichert={ungespeichertMelden}
            onGeschrieben={projektAktualisieren}
            darfPlatzieren={darfStromkreiseGrundsaetzlich && darfSchreibenGrundsaetzlich && !archiviert}
            onPlatzieren={(p) => void verteilungPlatzieren(p)}
            onImPlanZeigen={(ziel) => void imPlanZeigen(ziel)}
            meldung={platzierungsmeldung}
          />
        </section>
      )}

      {ansicht === "mengen" && aktivesGeschoss !== undefined && (
        <Mengenuebersicht
          key={aktivesGeschoss.building_id}
          buildingId={aktivesGeschoss.building_id}
          offen={mengenOffen}
          onOffen={setMengenOffen}
          onBearbeitungOeffnen={({ floorId }) => {
            // Der Leitungsentwurf ist geöffnet (Provider); nur Geschoss und Ansicht wechseln.
            if (floorId !== null && auswahl.some((e) => e.id === floorId && e.building_id === aktivesGeschoss.building_id)) setGeschossId(floorId);
            void ansichtWechseln("editor").then(() => setLeitungAusMengen(true));
          }}
        />
      )}

      </LeitungsplanungProvider>

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
                  room_type: raumdialog.raum.room_type ?? "",
                }
          }
          onSubmit={raumSpeichern}
          onClose={() => setRaumdialog(null)}
        />
      )}
    </div>
  );
}
