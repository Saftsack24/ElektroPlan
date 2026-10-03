import { ApiError } from "@elektroplan/api-client";
import type { ProjectOut } from "@elektroplan/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth, usePermission } from "../../core/auth/AuthProvider";
import { useProjectTabs } from "../../core/modules/ProjectTabs";
import { AKTION } from "../../core/ui/aktionssymbole";
import { Bestaetigung } from "../../core/ui/Bestaetigung";
import { useVerlassenBestaetigen } from "../../core/ui/Rueckfrage";
import { MitSymbol } from "../../core/ui/Symbol";
import { KNOPFZEILE, REITERLEISTE, STAPEL, karte, knopf, meldungsflaeche, reiter } from "../../core/ui/stil";
import { aktionsfehler } from "./aktionsfehler";
import { Bearbeitungsinfo } from "./Bearbeitungsinfo";
import { ProjectFilesTab } from "./ProjectFilesTab";
import { ProjectMasterDataTab } from "./ProjectMasterDataTab";
import { ProjectStructureTab } from "./ProjectStructureTab";
import { ProjektLoeschenDialog } from "./ProjektLoeschenDialog";
import { STATUS_LABEL, istLoeschbar, istSchreibgeschuetzt, istWiedereroeffenbar } from "./status";

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
  // Leere Projekte: Bearbeiter. Mit Inhalt: nur Administrator - das klärt der
  // Dialog mit der Vorprüfung, verbindlich der Server (ADR 0020).
  const darfLoeschen = usePermission("project.record.delete");
  const darfWiedereroeffnen = usePermission("project.record.reopen");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [loeschenOffen, setLoeschenOffen] = useState(false);
  // Nach der Löschung nichts mehr nachladen: Der Datensatz existiert nicht mehr.
  const [geloescht, setGeloescht] = useState(false);
  const [wiederOffen, setWiederOffen] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  // Beitraege der Fachmodule - ab Phase 3 erscheint hier die Elektroplanung.
  const modulTabs = useProjectTabs();

  const [aktiv, setAktivRoh] = useState<string>(EIGENE_TABS[0].id);
  const verlassen = useVerlassenBestaetigen();
  // Ein Tabwechsel entlaedt den bisherigen Tab. Haelt er ungespeicherte
  // Aenderungen, wird vorher gefragt (fachneutraler Core-Baustein).
  const setAktiv = (id: string) => {
    if (id === aktiv) return;
    void verlassen("Tab wechseln?", "Sie wollen zu einem anderen Tab des Projekts wechseln.", () => {
      setAktivRoh(id);
      // Änderungen in einem Tab (auch eines Fachmoduls) berühren das Projekt;
      // der Kopf mit „Zuletzt geändert" zieht beim Wechsel nach.
      void queryClient.invalidateQueries({ queryKey: ["project", projectId], exact: true });
    });
  };
  const [fehler, setFehler] = useState<string | null>(null);

  const projekt = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get("/api/v1/projects/{project_id}", { path: { project_id: projectId } }),
    enabled: !geloescht,
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
      setMeldung(null);
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: unknown) =>
      setFehler(error instanceof ApiError ? error.userMessage : "Statuswechsel fehlgeschlagen."),
  });

  const wiedereroeffnen = useMutation({
    mutationFn: (version: number) =>
      api.post("/api/v1/projects/{project_id}/reopen", {
        path: { project_id: projectId },
        ifMatch: version,
      }),
    onSuccess: async () => {
      setWiederOffen(false);
      setFehler(null);
      setMeldung("Das Projekt ist wieder in Bearbeitung und erscheint in der Liste der laufenden Projekte.");
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  if (projekt.isPending) return <p className="text-muted">Projekt wird geladen ...</p>;
  if (projekt.isError || !projekt.data) {
    return <p className={meldungsflaeche()}>Dieses Projekt ist nicht verfügbar.</p>;
  }

  const daten: ProjectOut = projekt.data;
  // ``archived`` ist ein Endzustand **und** ein Schreibschutz; der Server
  // lehnt jede Aenderung mit 409 ab (docs/api.md, Abschnitt "Projektstatus").
  // Die Oberflaeche spiegelt das, verspricht aber nichts darueber hinaus.
  const schreibgeschuetzt = istSchreibgeschuetzt(daten.status);

  return (
    <div className={STAPEL}>
      <section className={karte()}>
        <p className="text-muted">
          <Link to={daten.status === "completed" || daten.status === "archived" ? "/projects?ansicht=abgeschlossen" : "/projects"}>
            <MitSymbol icon={AKTION.zurueck}>Alle Projekte</MitSymbol>
          </Link>
        </p>
        <h1>{daten.name}</h1>
        <p className="text-muted">
          Projektnummer <code>{daten.project_number}</code> · Status{" "}
          <strong>{STATUS_LABEL[daten.status]}</strong> · Version {daten.version}
        </p>
        <Bearbeitungsinfo
          erstelltVon={daten.created_by}
          erstelltAm={daten.created_at}
          geaendertVon={daten.updated_by}
          geaendertAm={daten.updated_at}
        />
        {schreibgeschuetzt && (
          <p className={meldungsflaeche("schlicht")}>
            Dieses Projekt ist {daten.status === "completed" ? "abgeschlossen" : "archiviert"} und damit{" "}
            <strong>schreibgeschützt</strong>. Stammdaten, Gebäude, Geschosse, Dateien und die
            Planung lassen sich nicht mehr ändern, und es sind keine neuen Uploads möglich. Lesen
            und das Herunterladen bestehender Dateien bleiben erlaubt.
            {daten.status === "completed" && " Ein Administrator kann das Projekt wieder in Bearbeitung setzen."}
          </p>
        )}
        {meldung && (
          <p className={meldungsflaeche("erfolg")} role="status">
            {meldung}
          </p>
        )}
        {fehler && <p className={meldungsflaeche()}>{fehler}</p>}
        <div className={KNOPFZEILE}>
          {darfSchreiben && (
            <>
            {UEBERGAENGE.filter(
              (uebergang) =>
                (uebergang.erlaubtAb === null
                  ? daten.status !== "archived"
                  : daten.status === uebergang.erlaubtAb),
            ).map((uebergang) => (
              <button
                key={uebergang.ziel}
                className={knopf()}
                type="button"
                disabled={wechseln.isPending}
                onClick={() => wechseln.mutate({ ziel: uebergang.ziel, version: daten.version })}
              >
                {uebergang.ziel === "archive" ? (
                  <MitSymbol icon={AKTION.archivieren}>{uebergang.label}</MitSymbol>
                ) : (
                  uebergang.label
                )}
              </button>
            ))}
            </>
          )}
          {darfWiedereroeffnen && istWiedereroeffenbar(daten.status) && (
            <button className={knopf()} type="button" onClick={() => setWiederOffen(true)}>
              <MitSymbol icon={AKTION.wiederaufnehmen}>Wieder in Bearbeitung setzen</MitSymbol>
            </button>
          )}
          {darfLoeschen && istLoeschbar(daten.status) && (
            <button className={knopf("gefahr")} type="button" onClick={() => setLoeschenOffen(true)}>
              <MitSymbol icon={AKTION.loeschen}>Projekt löschen</MitSymbol>
            </button>
          )}
        </div>
      </section>

      {darfLoeschen && (
        <ProjektLoeschenDialog
          offen={loeschenOffen}
          projekt={daten}
          onAbbrechen={() => setLoeschenOffen(false)}
          onGeloescht={async () => {
            setLoeschenOffen(false);
            // Keine veraltete Detailseite im Cache oder im Verlauf lassen.
            setGeloescht(true);
            await navigate("/projects", {
              replace: true,
              state: { meldung: `Projekt ${daten.project_number} wurde endgültig gelöscht.` },
            });
            queryClient.removeQueries({ queryKey: ["project", projectId] });
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
          }}
        />
      )}

      {darfWiedereroeffnen && (
        <Bestaetigung
          offen={wiederOffen}
          titel="Projekt wieder in Bearbeitung setzen?"
          bestaetigenLabel="Wieder in Bearbeitung setzen"
          bestaetigenSymbol={AKTION.wiederaufnehmen}
          laeuft={wiedereroeffnen.isPending}
          fehler={
            wiedereroeffnen.isError
              ? aktionsfehler(wiedereroeffnen.error, "Das Projekt konnte nicht wieder geöffnet werden.")
              : null
          }
          onBestaetigen={() => wiedereroeffnen.mutate(daten.version)}
          onAbbrechen={() => {
            wiedereroeffnen.reset();
            setWiederOffen(false);
          }}
        >
          <p>
            Projekt <code>{daten.project_number}</code> <strong>{daten.name}</strong> wird von
            „Abgeschlossen" nach „In Bearbeitung" gesetzt.
          </p>
          <p>
            Danach ist es wieder bearbeitbar und erscheint wieder in der Liste der laufenden
            Projekte. Es gelten alle Regeln eines laufenden Projekts.
          </p>
        </Bestaetigung>
      )}

      <nav className={REITERLEISTE}>
        {EIGENE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={reiter(aktiv === tab.id)}
            onClick={() => setAktiv(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        {modulTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={reiter(aktiv === tab.id)}
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
            <Suspense key={tab.id} fallback={<p className="text-muted">Wird geladen ...</p>}>
              <Inhalt />
            </Suspense>
          );
        })}
    </div>
  );
}
